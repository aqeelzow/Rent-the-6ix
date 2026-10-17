// Valuation from comparables (SPEC 7.2), owner C. SQL picks the candidates (PostGIS, within the
// widest radius, same bedrooms / rooms class, seen in the window, not duplicates); the pure engine
// (packages/shared/engine/valuation.ts) re-checks the pool, widens the radius, adjusts and weights.
// Results are cached per listing for 6 h (SPEC 5).
import "server-only";
import type { Sql } from "postgres";
import { VALUATION } from "../../../../../packages/shared/engine/config";
import {
  valuate,
  type Benchmark,
  type ComparableCandidate,
  type Tri,
  type UnitType,
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
  utilities_included: Tri;
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

/** The listing and its candidate comparables, or null when the listing doesn't exist. */
export async function selectComparables(
  sql: Sql,
  listingId: string,
  now: Date,
): Promise<{ subject: ValuationSubject; candidates: ComparableCandidate[] } | null> {
  const [subject] = await sql<ListingFields[]>`
    SELECT ${sql.unsafe(FIELDS("s"))} FROM listings s WHERE s.id = ${listingId}`;
  if (!subject) return null;
  const widest = VALUATION.radiiM[VALUATION.radiiM.length - 1];
  // Same building: RentSafeTO building, else Address Point, else the exact same point (~10 m),
  // which is how one building's floor plans arrive before geocoding.
  const rows = await sql<CandidateRow[]>`
    SELECT ${sql.unsafe(FIELDS("c"))},
      ST_Distance(c.location, s.location) AS distance_m,
      c.last_seen_at, c.duplicate_of,
      coalesce(c.building_id, c.address_point_id,
        'pt:' || ST_AsText(ST_SnapToGrid(c.location::geometry, 0.0001))) AS building_key
    FROM listings s
    JOIN listings c ON ST_DWithin(c.location, s.location, ${widest})
    WHERE s.id = ${listingId}
      AND c.id <> s.id
      AND c.duplicate_of IS NULL
      AND c.status IN ('active', 'stale')
      AND c.last_seen_at >= ${now} - make_interval(days => ${VALUATION.windowDays})
      AND CASE WHEN s.unit_type = 'room' THEN c.unit_type = 'room'
               ELSE c.bedrooms = s.bedrooms AND c.unit_type IS DISTINCT FROM 'room' END
    ORDER BY c.location <-> s.location
    LIMIT ${CANDIDATE_LIMIT}`;
  return { subject: subjectOf(subject), candidates: rows.map(candidateOf) };
}

const cache = new Map<string, { at: number; value: Valuation }>();

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
  const hit = cache.get(listingId);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.value;
  const found = await selectComparables(sql, listingId, now);
  if (!found) return null;
  const value = valuate(found.subject, found.candidates, benchmark, now);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(listingId, { at: now.getTime(), value });
  return value;
}

/** Test hook. */
export function clearValuationCache() {
  cache.clear();
}

/**
 * The engine's valuation in the API shape (`ValuationSchema`): adjustments carry only label and
 * amount; the label already says how many comparables were adjusted.
 */
export function toApiValuation(v: Valuation) {
  return { ...v, adjustments: v.adjustments.map(({ label, amountCad }) => ({ label, amountCad })) };
}
