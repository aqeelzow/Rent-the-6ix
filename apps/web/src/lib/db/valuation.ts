// Valuation from comparables (SPEC 7.2), owner C. SQL picks the candidates (PostGIS, within the
// widest radius, same bedrooms / rooms class, seen in the window, not duplicates); the pure engine
// (packages/shared/engine/valuation.ts) re-checks the pool, widens the radius, adjusts and weights.
// Results are cached per listing for 6 h (SPEC 5).
import "server-only";
import type { Sql } from "postgres";
import { VALUATION } from "../../../../../packages/shared/engine/config";
import { caveats, type Caveat } from "../../../../../packages/shared/engine/caveats";
import type { Listing } from "../../../../../packages/shared/schemas/index";
import {
  valuate,
  type Benchmark,
  type ComparableCandidate,
  type Tri,
  type UnitType,
  type Utilities,
  type Valuation,
  type ValuationSubject,
} from "../../../../../packages/shared/engine/valuation";

const CACHE_MS = 6 * 3_600_000;
const CACHE_MAX = 5_000;
/** Nearest candidates read per valuation; far more than the 5–12 the engine needs. */
const CANDIDATE_LIMIT = 2_000;

interface ListingFields {
  id: string;
  monthly_rent_cad: number;
  unit_type: UnitType | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  utilities_included: Utilities;
  parking: Tri;
  furnished: Tri;
  laundry_in_suite: Tri;
}

interface CandidateRow extends ListingFields {
  distance_m: number;
  last_seen_at: Date;
  duplicate_of: string | null;
  building_key: string | null;
}

function subjectOf(row: ListingFields): ValuationSubject {
  return {
    id: row.id,
    monthlyRentCad: row.monthly_rent_cad,
    unitType: row.unit_type,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    sqft: row.sqft,
    utilitiesIncluded: row.utilities_included,
    parking: row.parking,
    furnished: row.furnished,
    laundryInSuite: row.laundry_in_suite,
  };
}

export function candidateOf(row: CandidateRow): ComparableCandidate {
  return {
    ...subjectOf(row),
    distanceM: row.distance_m,
    lastSeenAt: row.last_seen_at.toISOString(),
    duplicateOf: row.duplicate_of,
    buildingKey: row.building_key,
  };
}

// Unknown amenities are stored as NULL by older rows; the engine treats both as 'unknown'.
const FIELDS = (t: string) => `
  ${t}.id, ${t}.monthly_rent_cad, ${t}.unit_type, ${t}.bedrooms, ${t}.bathrooms::float8 AS bathrooms,
  ${t}.sqft, coalesce(${t}.utilities_included, 'unknown') AS utilities_included,
  coalesce(${t}.parking, 'unknown') AS parking, coalesce(${t}.furnished, 'unknown') AS furnished,
  coalesce(${t}.laundry_in_suite, 'unknown') AS laundry_in_suite`;

/** Candidate comparables around a point for a subject that may not be stored (pasted listings). */
export async function candidatesNear(
  sql: Sql,
  subject: ValuationSubject,
  at: { lng: number; lat: number },
  now: Date,
): Promise<ComparableCandidate[]> {
  const widest = VALUATION.radiiM[VALUATION.radiiM.length - 1];
  const point = sql`ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography`;
  // Same building: RentSafeTO building, else Address Point, else the exact same point (~10 m),
  // which is how one building's floor plans arrive before geocoding.
  const rows = await sql<CandidateRow[]>`
    SELECT ${sql.unsafe(FIELDS("c"))},
      ST_Distance(c.location, ${point}) AS distance_m,
      c.last_seen_at, c.duplicate_of,
      coalesce(c.building_id, c.address_point_id,
        'pt:' || ST_AsText(ST_SnapToGrid(c.location::geometry, 0.0001))) AS building_key
    FROM listings c
    WHERE ST_DWithin(c.location, ${point}, ${widest})
      AND c.id <> ${subject.id}
      AND c.duplicate_of IS NULL
      AND c.status IN ('active', 'stale')
      AND c.last_seen_at >= ${now} - make_interval(days => ${VALUATION.windowDays})
      AND ${
        subject.unitType === "room"
          ? sql`c.unit_type = 'room'`
          : sql`c.bedrooms = ${subject.bedrooms} AND c.unit_type IS DISTINCT FROM 'room'`
      }
    ORDER BY c.location <-> ${point}
    LIMIT ${CANDIDATE_LIMIT}`;
  return rows.map(candidateOf);
}

/** A stored listing and its candidate comparables, or null when the listing doesn't exist. */
export async function selectComparables(
  sql: Sql,
  listingId: string,
  now: Date,
): Promise<{ subject: ValuationSubject; candidates: ComparableCandidate[] } | null> {
  const [row] = await sql<(ListingFields & { lng: number; lat: number })[]>`
    SELECT ${sql.unsafe(FIELDS("s"))},
      ST_X(s.location::geometry) AS lng, ST_Y(s.location::geometry) AS lat
    FROM listings s WHERE s.id = ${listingId}`;
  if (!row) return null;
  const subject = subjectOf(row);
  // A whole unit with unknown bedrooms has no pool; skip the query, the engine says so.
  if (subject.unitType !== "room" && subject.bedrooms === null) return { subject, candidates: [] };
  return { subject, candidates: await candidatesNear(sql, subject, row, now) };
}

const cache = new Map<string, { at: number; value: Valuation }>();

function cached(key: string, now: Date): Valuation | undefined {
  const hit = cache.get(key);
  return hit && now.getTime() - hit.at < CACHE_MS ? hit.value : undefined;
}

function remember(key: string, now: Date, value: Valuation) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now.getTime(), value });
}

/**
 * Valuation for a stored listing, cached 6 h. `benchmark` is null until D's benchmarks table is
 * loaded (P2.3); the estimate never uses it.
 */
export async function listingValuation(
  sql: Sql,
  listingId: string,
  now = new Date(),
  benchmark: Benchmark | null = null,
): Promise<Valuation | null> {
  const hit = cached(listingId, now);
  if (hit) return hit;
  const found = await selectComparables(sql, listingId, now);
  if (!found) return null;
  const value = valuate(found.subject, found.candidates, benchmark, now);
  remember(listingId, now, value);
  return value;
}

/** Test hook. */
export function clearValuationCache() {
  cache.clear();
}

/**
 * Owner C's part of search's `ScoreContext` (packages/shared/engine/score.ts): the valuation and
 * the caveats for any listing, stored or pasted (SPEC 10.3: pasted listings are valued against our
 * comparables). Travel and safety come from D.
 * `sameTextElsewhere` is 0 for now: in TigerData nearly every repeated description is a property
 * manager's template across its own units, so the SPEC 7.7 rule would mostly flag real listings.
 */
export async function listingContext(
  sql: Sql,
  listing: Listing,
  now = new Date(),
  benchmark: Benchmark | null = null,
): Promise<{ valuation: Valuation; caveats: Caveat[] }> {
  // Keyed by rent too: a pasted listing may reuse an id with a different price.
  const key = `${listing.id}:${listing.monthlyRentCad}`;
  let valuation = cached(key, now);
  if (!valuation) {
    const pooled = listing.unitType === "room" || listing.bedrooms !== null;
    const candidates = pooled ? await candidatesNear(sql, listing, listing.location, now) : [];
    valuation = valuate(listing, candidates, benchmark, now);
    remember(key, now, valuation);
  }
  // The first observation and the scam flag stored at ingest; both absent for pasted listings.
  // to_jsonb keeps this working before migration 005 adds deposit_before_viewing.
  const [stored] = await sql<
    { deposit: boolean | null; asking_rent_cad: number | null; observed_at: Date | null }[]
  >`
    SELECT (to_jsonb(l) ->> 'deposit_before_viewing')::boolean AS deposit,
      o.asking_rent_cad, o.observed_at
    FROM (SELECT 1) one
    LEFT JOIN listings l ON l.id = ${listing.id}
    LEFT JOIN LATERAL (
      SELECT asking_rent_cad, observed_at FROM listing_observations
      WHERE listing_id = ${listing.id} ORDER BY observed_at LIMIT 1) o ON true`;
  const [building] = listing.buildingId
    ? await sql<{ latest_score: string | null; score_date: Date | null }[]>`
        SELECT latest_score, score_date FROM buildings WHERE id = ${listing.buildingId}`
    : [];
  return {
    valuation,
    caveats: caveats(
      { ...listing, depositBeforeViewing: stored?.deposit ?? false },
      {
        valuation,
        building: building
          ? {
              latestScore: building.latest_score === null ? null : Number(building.latest_score),
              scoreDate: building.score_date?.toISOString().slice(0, 10) ?? null,
            }
          : null,
        sameTextElsewhere: 0,
        firstSeen:
          stored?.asking_rent_cad && stored.observed_at
            ? { rentCad: stored.asking_rent_cad, at: stored.observed_at.toISOString() }
            : null,
        now,
      },
    ),
  };
}
