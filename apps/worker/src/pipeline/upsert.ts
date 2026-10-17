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
  image_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
  field_evidence: Record<string, string>;
  den: boolean;
  deposit_before_viewing: boolean;
}

/** Columns from migration 005; written only once the database has them. */
const OPTIONAL_COLUMNS = ["den", "deposit_before_viewing"] as const;
const present = new WeakMap<Sql, Promise<(typeof OPTIONAL_COLUMNS)[number][]>>();

function optionalColumns(sql: Sql) {
  let columns = present.get(sql);
  if (!columns) {
    columns = sql<{ column_name: (typeof OPTIONAL_COLUMNS)[number] }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'listings' AND column_name IN ${sql(OPTIONAL_COLUMNS)}`.then((rows) =>
      rows.map((r) => r.column_name),
    );
    present.set(sql, columns);
  }
  return columns;
}

/**
 * Fields AI extraction fills (column, fieldEvidence key, its "unknown"). A later run whose rules
 * don't find the value keeps the stored AI value instead of resetting it to unknown.
 */
const AI_KEPT = [
  ["air_conditioning", "airConditioning", "'unknown'"],
  ["utilities_included", "utilitiesIncluded", "'unknown'"],
  ["parking", "parking", "'unknown'"],
  ["pets_allowed", "petsAllowed", "'unknown'"],
  ["furnished", "furnished", "'unknown'"],
  ["laundry_in_suite", "laundryInSuite", "'unknown'"],
  ["sqft", "sqft", null],
  ["available_from", "availableFrom", null],
  ["lease_term", "leaseTerm", null],
] as const;

function keepAi([column, key, unknown]: (typeof AI_KEPT)[number]): string {
  const missing = unknown ? `excluded.${column} = ${unknown}` : `excluded.${column} IS NULL`;
  return `${column} = CASE WHEN ${missing} AND listings.field_evidence ->> '${key}' = 'ai_extracted'
            THEN listings.${column} ELSE excluded.${column} END`;
}
// Fixed identifiers only, so plain SQL text is safe.
const SET_AI_KEPT = AI_KEPT.map(keepAi).join(",\n          ");

const partialOk = new WeakMap<Sql, Promise<boolean>>();

/**
 * Whether listings.utilities_included accepts 'partial' (migration 007). Until it does, a
 * 'partial' value is stored as 'unknown' rather than failing the whole batch.
 */
export function utilitiesPartialAllowed(sql: Sql): Promise<boolean> {
  let ok = partialOk.get(sql);
  if (!ok) {
    ok = sql<{ ok: boolean }[]>`
      SELECT coalesce(bool_or(pg_get_constraintdef(oid) LIKE '%partial%'), true) AS ok
      FROM pg_constraint
      WHERE conrelid = 'listings'::regclass
        AND pg_get_constraintdef(oid) LIKE '%utilities_included%'`.then(([r]) => r.ok);
    partialOk.set(sql, ok);
  }
  return ok;
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
  "image_url",
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
    image_url: l.imageUrl,
    first_seen_at: observedAt,
    last_seen_at: observedAt,
    field_evidence: l.fieldEvidence,
    den: l.den,
    deposit_before_viewing: l.depositBeforeViewing,
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
  const partial = await utilitiesPartialAllowed(sql);
  const rows = listings
    .map((l) => toRow(l, observedAt))
    .filter((r) => r !== null)
    .map((r) =>
      !partial && r.utilities_included === "partial" ? { ...r, utilities_included: "unknown" } : r,
    );
  const optional = await optionalColumns(sql);
  const columns = [...COLUMNS, ...optional];
  // Fixed identifiers from OPTIONAL_COLUMNS, so plain SQL text is safe (and empty when absent).
  const setOptional = sql.unsafe(optional.map((c) => `, ${c} = excluded.${c}`).join(""));
  const setAiKept = sql.unsafe(SET_AI_KEPT);
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await sql.begin(async (tx) => {
      const written = await tx<{ id: string; source: string; monthly_rent_cad: number }[]>`
        INSERT INTO listings ${tx(batch, columns)}
        ON CONFLICT (source, source_listing_id) DO UPDATE SET
          source_url = excluded.source_url,
          -- A run that doesn't see the thumbnail keeps the stored one.
          image_url = coalesce(excluded.image_url, listings.image_url),
          title = excluded.title,
          excerpt = excluded.excerpt,
          monthly_rent_cad = excluded.monthly_rent_cad,
          rent_is_per_room = excluded.rent_is_per_room,
          bedrooms = excluded.bedrooms,
          bathrooms = excluded.bathrooms,
          unit_type = excluded.unit_type,
          year_built = CASE WHEN listings.year_built_source = 'rentsafeto'
              OR (excluded.year_built IS NULL AND listings.year_built_source = 'ai_extracted')
            THEN listings.year_built ELSE excluded.year_built END,
          year_built_source = CASE WHEN listings.year_built_source = 'rentsafeto'
              OR (excluded.year_built IS NULL AND listings.year_built_source = 'ai_extracted')
            THEN listings.year_built_source ELSE excluded.year_built_source END,
          ${setAiKept},
          location = CASE WHEN listings.address_point_id IS NULL
            THEN excluded.location ELSE listings.location END,
          location_precision = CASE WHEN listings.address_point_id IS NULL
            THEN excluded.location_precision ELSE listings.location_precision END,
          address_text = excluded.address_text,
          first_seen_at = LEAST(listings.first_seen_at, excluded.first_seen_at),
          last_seen_at = GREATEST(listings.last_seen_at, excluded.last_seen_at),
          status = 'active',
          updated_at = now(),
          -- New evidence, plus the stored AI evidence for fields the new row doesn't have.
          field_evidence = (
            SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
            FROM jsonb_each(listings.field_evidence) e
            WHERE e.value = '"ai_extracted"'::jsonb AND NOT excluded.field_evidence ? e.key
          ) || excluded.field_evidence ${setOptional}
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
