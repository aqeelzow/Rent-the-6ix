// Upsert (SPEC 8.4 step 6): write normalized listings to TigerData, record one
// listing_observations row per sighting, and mark listings stale/removed by last_seen_at.
// Location: the source's coordinates at 'street' precision until geocoding (P1.5) upgrades a row;
// once a row has an Address Points match, later upserts keep its geocoded location.
import type { Sql } from "postgres";
import type { NormalizedListing } from "./normalize.ts";

/** Days since last seen: ≤ 7 active, 8–21 stale, > 21 removed (SPEC 5). */
export const FRESHNESS = { activeDays: 7, staleDays: 21 } as const;
const BATCH = 500;

export interface ListingRow {
  source: string;
  source_listing_id: string;
  source_url: string;
  title: string;
  excerpt: string;
  monthly_rent_cad: number;
  rent_is_per_room: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  unit_type: string | null;
  sqft: number | null;
  year_built: number | null;
  year_built_source: string | null;
  air_conditioning: string;
  location: string;
  location_precision: "street";
  address_text: string | null;
  utilities_included: string;
  parking: string;
  laundry_in_suite: string;
  furnished: string;
  pets_allowed: string;
  available_from: string | null;
  lease_term: string | null;
  first_seen_at: string;
  last_seen_at: string;
  field_evidence: Record<string, string>;
}

const COLUMNS = [
  "source",
  "source_listing_id",
  "source_url",
  "title",
  "excerpt",
  "monthly_rent_cad",
  "rent_is_per_room",
  "bedrooms",
  "bathrooms",
  "unit_type",
  "sqft",
  "year_built",
  "year_built_source",
  "air_conditioning",
  "location",
  "location_precision",
  "address_text",
  "utilities_included",
  "parking",
  "laundry_in_suite",
  "furnished",
  "pets_allowed",
  "available_from",
  "lease_term",
  "first_seen_at",
  "last_seen_at",
  "field_evidence",
] as const satisfies readonly (keyof ListingRow)[];

/** null when the listing has no coordinates yet (listings.location is required). */
export function toRow(l: NormalizedListing, observedAt: string): ListingRow | null {
  if (!l.sourceLocation) return null;
  return {
    source: l.source,
    source_listing_id: l.sourceListingId,
    source_url: l.sourceUrl,
    title: l.title,
    excerpt: l.excerpt,
    monthly_rent_cad: l.monthlyRentCad,
    rent_is_per_room: l.rentIsPerRoom,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    unit_type: l.unitType,
    sqft: l.sqft === null ? null : Math.round(l.sqft),
    year_built: l.yearBuilt,
    year_built_source: l.yearBuiltSource,
    air_conditioning: l.airConditioning,
    location: `SRID=4326;POINT(${l.sourceLocation.lng} ${l.sourceLocation.lat})`,
    location_precision: "street",
    address_text: l.addressText,
    utilities_included: l.utilitiesIncluded,
    parking: l.parking,
    laundry_in_suite: l.laundryInSuite,
    furnished: l.furnished,
    pets_allowed: l.petsAllowed,
    available_from: l.availableFrom,
    lease_term: l.leaseTerm,
    first_seen_at: observedAt,
    last_seen_at: observedAt,
    field_evidence: l.fieldEvidence,
  };
}

export interface UpsertResult {
  written: number;
  /** Skipped: no coordinates yet. */
  noLocation: number;
}

/** Insert or update listings seen at `observedAt` and add an observation for each. */
export async function upsertListings(
  sql: Sql,
  listings: NormalizedListing[],
  observedAt: string,
): Promise<UpsertResult> {
  const rows = listings.map((l) => toRow(l, observedAt)).filter((r) => r !== null);
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await sql.begin(async (tx) => {
      const written = await tx<{ id: string; source: string; monthly_rent_cad: number }[]>`
        INSERT INTO listings ${tx(batch, COLUMNS)}
        ON CONFLICT (source, source_listing_id) DO UPDATE SET
          source_url = excluded.source_url,
          title = excluded.title,
          excerpt = excluded.excerpt,
          monthly_rent_cad = excluded.monthly_rent_cad,
          rent_is_per_room = excluded.rent_is_per_room,
          bedrooms = excluded.bedrooms,
          bathrooms = excluded.bathrooms,
          unit_type = excluded.unit_type,
          sqft = excluded.sqft,
          year_built = CASE WHEN listings.year_built_source = 'rentsafeto'
            THEN listings.year_built ELSE excluded.year_built END,
          year_built_source = CASE WHEN listings.year_built_source = 'rentsafeto'
            THEN listings.year_built_source ELSE excluded.year_built_source END,
          air_conditioning = excluded.air_conditioning,
          location = CASE WHEN listings.address_point_id IS NULL
            THEN excluded.location ELSE listings.location END,
          location_precision = CASE WHEN listings.address_point_id IS NULL
            THEN excluded.location_precision ELSE listings.location_precision END,
          address_text = excluded.address_text,
          utilities_included = excluded.utilities_included,
          parking = excluded.parking,
          laundry_in_suite = excluded.laundry_in_suite,
          furnished = excluded.furnished,
          pets_allowed = excluded.pets_allowed,
          available_from = excluded.available_from,
          lease_term = excluded.lease_term,
          first_seen_at = LEAST(listings.first_seen_at, excluded.first_seen_at),
          last_seen_at = GREATEST(listings.last_seen_at, excluded.last_seen_at),
          status = 'active',
          updated_at = now(),
          field_evidence = excluded.field_evidence
        RETURNING id, source, monthly_rent_cad`;
      const observations = written.map((w) => ({
        listing_id: w.id,
        observed_at: observedAt,
        asking_rent_cad: w.monthly_rent_cad,
        status: "active",
        source: w.source,
      }));
      await tx`
        INSERT INTO listing_observations ${tx(observations)}
        ON CONFLICT (listing_id, observed_at) DO NOTHING`;
    });
  }
  return { written: rows.length, noLocation: listings.length - rows.length };
}

/** Mark listings active / stale / removed by how long ago they were last seen. Returns rows changed. */
export async function markFreshness(sql: Sql, now: Date): Promise<number> {
  const result = await sql`
    UPDATE listings SET
      status = CASE
        WHEN last_seen_at >= ${now} - make_interval(days => ${FRESHNESS.activeDays}) THEN 'active'
        WHEN last_seen_at >= ${now} - make_interval(days => ${FRESHNESS.staleDays}) THEN 'stale'
        ELSE 'removed' END,
      updated_at = now()
    WHERE status IS DISTINCT FROM CASE
        WHEN last_seen_at >= ${now} - make_interval(days => ${FRESHNESS.activeDays}) THEN 'active'
        WHEN last_seen_at >= ${now} - make_interval(days => ${FRESHNESS.staleDays}) THEN 'stale'
        ELSE 'removed' END`;
  return result.count;
}
