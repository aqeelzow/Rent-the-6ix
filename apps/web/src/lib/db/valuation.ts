// Valuation from comparables (SPEC 7.2), owner C. SQL picks the candidates (PostGIS, within the
// widest radius, same bedrooms / rooms class, seen in the window, not duplicates); the pure engine
// (packages/shared/engine/valuation.ts) re-checks the pool, widens the radius, adjusts and weights.
// Results are cached per listing for 6 h (SPEC 5).
import "server-only";
import type { Sql } from "postgres";
import { VALUATION } from "../../../../../packages/shared/engine/config";
import { benchmarkFor, type BenchmarkRow } from "../../../../../packages/shared/engine/benchmark";
import { caveats, type Caveat } from "../../../../../packages/shared/engine/caveats";
import type { Listing } from "../../../../../packages/shared/schemas/index";
import { distanceM } from "../../../../../packages/shared/engine/travel";
import {
  sameEraShare,
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
  year_built: number | null;
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
    yearBuilt: row.year_built,
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
  ${t}.sqft, ${t}.year_built, coalesce(${t}.utilities_included, 'unknown') AS utilities_included,
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
): Promise<{
  subject: ValuationSubject;
  candidates: ComparableCandidate[];
  benchmarks: BenchmarkRow[] | null;
} | null> {
  const [row] = await sql<
    (ListingFields & { lng: number; lat: number; benchmarks?: BenchmarkRow[] | null })[]
  >`
    SELECT ${sql.unsafe(FIELDS("s"))},
      ST_X(s.location::geometry) AS lng, ST_Y(s.location::geometry) AS lat,
      ${sql.unsafe(BENCHMARK_ROWS)}
    FROM listings s WHERE s.id = ${listingId}`;
  if (!row) return null;
  const subject = subjectOf(row);
  const benchmarks = row.benchmarks ?? null;
  // A whole unit with unknown bedrooms has no pool; skip the query, the engine says so.
  if (subject.unitType !== "room" && subject.bedrooms === null)
    return { subject, candidates: [], benchmarks };
  return { subject, candidates: await candidatesNear(sql, subject, row, now), benchmarks };
}

const cache = new Map<string, { at: number; value: Valuation }>();
/** listingContext's same-era share per cache key, kept with the cached valuation. */
const eraShares = new Map<string, number | null>();

function cached(key: string, now: Date): Valuation | undefined {
  const hit = cache.get(key);
  return hit && now.getTime() - hit.at < CACHE_MS ? hit.value : undefined;
}

function remember(key: string, now: Date, value: Valuation) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
    eraShares.delete(oldest);
  }
  cache.set(key, { at: now.getTime(), value });
}

/**
 * D's StatCan rent rows (P2.15) as one jsonb column, added to a query that runs anyway so the
 * benchmark costs no extra round trip.
 */
const BENCHMARK_ROWS = `(SELECT jsonb_agg(jsonb_build_object('id', b.id, 'key', b.key,
    'valueCad', b.value_cad::float8, 'period', b.period, 'sourceId', b.source_id))
  FROM benchmarks b WHERE b.kind = 'rent' AND b.value_cad IS NOT NULL) AS benchmarks`;

/** The benchmark line (P2.3): context under the rent check, never part of the estimate. */
function benchmarkOf(
  subject: Pick<ValuationSubject, "unitType" | "bedrooms">,
  rows: BenchmarkRow[] | null | undefined,
  given: Benchmark | null | undefined,
): Benchmark | null {
  return given !== undefined ? given : benchmarkFor(subject, rows ?? []);
}

/**
 * Valuation for a stored listing, cached 6 h. `benchmark` defaults to the StatCan row for the
 * listing's type and bedrooms (P2.3); the estimate never uses it.
 */
export async function listingValuation(
  sql: Sql,
  listingId: string,
  now = new Date(),
  benchmark?: Benchmark | null,
): Promise<Valuation | null> {
  const hit = cached(listingId, now);
  if (hit) return hit;
  const found = await selectComparables(sql, listingId, now);
  if (!found) return null;
  const value = valuate(
    found.subject,
    found.candidates,
    benchmarkOf(found.subject, found.benchmarks, benchmark),
    now,
  );
  remember(listingId, now, value);
  return value;
}

/** Test hook. */
export function clearValuationCache() {
  cache.clear();
  eraShares.clear();
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
  benchmark?: Benchmark | null,
): Promise<{ valuation: Valuation; caveats: Caveat[] }> {
  // Keyed by rent too: a pasted listing may reuse an id with a different price.
  const key = `${listing.id}:${listing.monthlyRentCad}`;
  let valuation = cached(key, now);
  let fresh: { candidates: ComparableCandidate[] } | null = null;
  if (!valuation) {
    const pooled = listing.unitType === "room" || listing.bedrooms !== null;
    const candidates = pooled ? await candidatesNear(sql, listing, listing.location, now) : [];
    valuation = valuate(listing, candidates, null, now);
    fresh = { candidates };
  }
  // The first observation and the scam flag stored at ingest; both absent for pasted listings.
  // to_jsonb keeps this working before migration 005 adds deposit_before_viewing.
  const [stored] = await sql<
    {
      deposit: boolean | null;
      asking_rent_cad: number | null;
      observed_at: Date | null;
      benchmarks?: BenchmarkRow[] | null;
    }[]
  >`
    SELECT (to_jsonb(l) ->> 'deposit_before_viewing')::boolean AS deposit,
      o.asking_rent_cad, o.observed_at, ${sql.unsafe(BENCHMARK_ROWS)}
    FROM (SELECT 1) one
    LEFT JOIN listings l ON l.id = ${listing.id}
    LEFT JOIN LATERAL (
      SELECT asking_rent_cad, observed_at FROM listing_observations
      WHERE listing_id = ${listing.id} ORDER BY observed_at LIMIT 1) o ON true`;
  if (fresh) {
    valuation = { ...valuation, benchmark: benchmarkOf(listing, stored?.benchmarks, benchmark) };
    remember(key, now, valuation);
    eraShares.set(key, sameEraShare(listing, valuation, fresh.candidates));
  }
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
        sameEraShare: eraShares.get(key) ?? null,
        firstSeen:
          stored?.asking_rent_cad && stored.observed_at
            ? { rentCad: stored.asking_rent_cad, at: stored.observed_at.toISOString() }
            : null,
        now,
      },
    ),
  };
}

// --- Batched contexts (ordinary search) ---------------------------------------------------
//
// A search values up to 500 candidates. Asking the database for each one separately is what made
// the first search slow: three round trips per listing over a two-connection pool. The pool of
// possible comparables is small (a few thousand active listings), so read it once with their
// coordinates and answer every subject from it in memory. One query per search instead of 500.

/** A comparable pool row with the coordinates needed to measure it from any subject. */
type PoolComparable = ComparableCandidate & { lng: number; lat: number };

const numberOrNull = (value: unknown): number | null => value === null || value === undefined ? null : Number(value);

function subjectOfListing(listing: Listing): ValuationSubject {
  return {
    id: listing.id,
    monthlyRentCad: listing.monthlyRentCad,
    unitType: listing.unitType,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    sqft: listing.sqft,
    yearBuilt: listing.yearBuilt,
    utilitiesIncluded: listing.utilitiesIncluded,
    parking: listing.parking,
    furnished: listing.furnished,
    laundryInSuite: listing.laundryInSuite,
  };
}

function poolComparable(row: Record<string, unknown>): PoolComparable | null {
  const id = typeof row.id === 'string' ? row.id : null;
  const rent = numberOrNull(row.monthly_rent_cad);
  const lng = numberOrNull(row.lng), lat = numberOrNull(row.lat);
  if (!id || rent === null || lng === null || lat === null || !(row.last_seen_at instanceof Date)) return null;
  return {
    id,
    monthlyRentCad: rent,
    unitType: (row.unit_type ?? null) as UnitType | null,
    bedrooms: numberOrNull(row.bedrooms),
    bathrooms: numberOrNull(row.bathrooms),
    sqft: numberOrNull(row.sqft),
    yearBuilt: numberOrNull(row.year_built),
    utilitiesIncluded: (row.utilities_included ?? 'unknown') as Utilities,
    parking: (row.parking ?? 'unknown') as Tri,
    furnished: (row.furnished ?? 'unknown') as Tri,
    laundryInSuite: (row.laundry_in_suite ?? 'unknown') as Tri,
    lastSeenAt: row.last_seen_at.toISOString(),
    duplicateOf: (row.duplicate_of ?? null) as string | null,
    buildingKey: (row.building_key ?? null) as string | null,
    lng,
    lat,
    distanceM: 0,
  };
}

/**
 * Every listing that could be a comparable for any of `subjects`, with coordinates.
 * The SQL filters are the same ones `candidatesNear` applies per subject; distance, the widest
 * radius and the nearest-first limit are applied in `comparablesFor`.
 */
export async function comparablePool(sql: Sql, subjects: readonly Listing[], now: Date): Promise<PoolComparable[]> {
  const bedrooms = [...new Set(subjects.filter(listing => listing.unitType !== 'room' && listing.bedrooms !== null).map(listing => listing.bedrooms!))];
  const classFilter = bedrooms.length ? `(c.unit_type = 'room' OR c.bedrooms = ANY($2::int[]))` : `c.unit_type = 'room'`;
  const statement = `
    SELECT ${FIELDS('c')},
      ST_X(c.location::geometry) AS lng, ST_Y(c.location::geometry) AS lat,
      c.last_seen_at, c.duplicate_of,
      coalesce(c.building_id, c.address_point_id,
        'pt:' || round(ST_X(c.location::geometry)::numeric, 4) || ':' || round(ST_Y(c.location::geometry)::numeric, 4)) AS building_key
    FROM listings c
    WHERE c.status IN ('active', 'stale')
      AND c.duplicate_of IS NULL
      AND c.last_seen_at >= $1::timestamptz - make_interval(days => ${VALUATION.windowDays})
      AND ${classFilter}`;
  const parameters: (string | number[])[] = bedrooms.length ? [now.toISOString(), bedrooms] : [now.toISOString()];
  const rows = await sql.unsafe(statement, parameters);
  if (!Array.isArray(rows)) throw new Error('Invalid comparable rows');
  return rows.map(row => poolComparable(row as Record<string, unknown>)).filter((row): row is PoolComparable => row !== null);
}

/** The pool sorted by latitude; lets one subject skip the rest of the city with a binary search. */
export function comparablePoolIndex(pool: readonly PoolComparable[]): PoolComparable[] {
  return [...pool].sort((a, b) => a.lat - b.lat);
}

/** First index whose latitude is at least `value`; `index` is sorted by latitude. */
function firstAtOrAbove(index: readonly PoolComparable[], value: number): number {
  let low = 0, high = index.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (index[middle].lat < value) low = middle + 1; else high = middle;
  }
  return low;
}

/** The nearest comparables for one subject, in the same order and with the same cap as `candidatesNear`. */
export function comparablesFor(subject: Listing, index: readonly PoolComparable[]): ComparableCandidate[] {
  const wanted = subjectOfListing(subject);
  if (wanted.unitType !== 'room' && wanted.bedrooms === null) return [];
  const widest = VALUATION.radiiM[VALUATION.radiiM.length - 1];
  // A cheap latitude/longitude box rejects most of the city before trigonometry. Without it every
  // subject measured its distance to every active two-bedroom listing in Toronto.
  const latSpan = widest / 111_320;
  const lngSpan = latSpan / Math.max(0.1, Math.cos((subject.location.lat * Math.PI) / 180));
  const nearby: PoolComparable[] = [];
  const north = subject.location.lat + latSpan;
  for (let i = firstAtOrAbove(index, subject.location.lat - latSpan); i < index.length && index[i].lat <= north; i++) {
    const candidate = index[i];
    if (candidate.id === wanted.id) continue;
    if (wanted.unitType === 'room' ? candidate.unitType !== 'room' : candidate.unitType === 'room' || candidate.bedrooms !== wanted.bedrooms) continue;
    if (Math.abs(candidate.lat - subject.location.lat) > latSpan || Math.abs(candidate.lng - subject.location.lng) > lngSpan) continue;
    // The SQL pool already applied the window and duplicate filters; the engine re-checks both.
    const metres = distanceM(subject.location, candidate);
    if (metres > widest) continue;
    nearby.push({ ...candidate, distanceM: metres });
  }
  nearby.sort((a, b) => a.distanceM - b.distanceM);
  return nearby.slice(0, CANDIDATE_LIMIT);
}

/** Stored facts caveats need, read for every candidate in one query. */
type StoredFacts = {
  deposit: boolean | null;
  asking_rent_cad: number | null;
  observed_at: Date | null;
  benchmarks?: BenchmarkRow[] | null;
};
type BuildingFact = { latest_score: string | number | null; score_date: Date | null };

/**
 * The same valuation and caveats as `listingContext`, for many listings and three queries.
 * Callers that value one listing keep `listingContext`; search uses this.
 */
export async function listingContexts(
  sql: Sql,
  listings: readonly Listing[],
  now = new Date(),
  benchmark?: Benchmark | null,
): Promise<Map<string, { valuation: Valuation; caveats: Caveat[] }>> {
  const result = new Map<string, { valuation: Valuation; caveats: Caveat[] }>();
  if (!listings.length) return result;
  const keyOf = (listing: Listing) => `${listing.id}:${listing.monthlyRentCad}`;
  const fresh = listings.filter(listing => !cached(keyOf(listing), now));
  const computed = new Map<string, { valuation: Valuation; candidates: ComparableCandidate[] }>();

  // Stored facts and building scores do not depend on the comparable pool, so they are read in
  // parallel with it instead of after it.
  const ids = listings.map(listing => listing.id);
  const buildingIds = [...new Set(listings.map(listing => listing.buildingId).filter((id): id is string => id !== null))];
  const facts = Promise.all([
    sql.unsafe(
      `SELECT l.id, (to_jsonb(l) ->> 'deposit_before_viewing')::boolean AS deposit,
        o.asking_rent_cad, o.observed_at, ${BENCHMARK_ROWS}
      FROM listings l
      LEFT JOIN LATERAL (
        SELECT asking_rent_cad, observed_at FROM listing_observations
        WHERE listing_id = l.id ORDER BY observed_at LIMIT 1) o ON true
      WHERE l.id = ANY($1::uuid[])`,
      [ids],
    ),
    buildingIds.length
      ? sql.unsafe(`SELECT id, latest_score, score_date FROM buildings WHERE id = ANY($1::text[])`, [buildingIds])
      : Promise.resolve([]),
  ]);
  // Observed below; if the comparable read fails first this rejection must not go unhandled.
  facts.catch(() => {});
  if (fresh.length) {
    const index = comparablePoolIndex(await comparablePool(sql, fresh, now));
    for (const listing of fresh) {
      const candidates = comparablesFor(listing, index);
      computed.set(keyOf(listing), { valuation: valuate(subjectOfListing(listing), candidates, null, now), candidates });
    }
  }
  const [storedRows, buildingRows] = await facts;
  if (!Array.isArray(storedRows) || !Array.isArray(buildingRows)) throw new Error('Invalid context rows');
  const stored = new Map(storedRows.map(row => [(row as unknown as { id: string }).id, row as unknown as StoredFacts]));
  const buildings = new Map(buildingRows.map(row => [(row as unknown as { id: string }).id, row as unknown as BuildingFact]));

  for (const listing of listings) {
    const key = keyOf(listing);
    const facts = stored.get(listing.id);
    const freshValue = computed.get(key);
    let valuation = freshValue?.valuation ?? cached(key, now)!;
    if (freshValue) {
      valuation = { ...valuation, benchmark: benchmarkOf(listing, facts?.benchmarks, benchmark) };
      remember(key, now, valuation);
      eraShares.set(key, sameEraShare(listing, valuation, freshValue.candidates));
    }
    const building = listing.buildingId ? buildings.get(listing.buildingId) : undefined;
    result.set(listing.id, {
      valuation,
      caveats: caveats(
        { ...listing, depositBeforeViewing: facts?.deposit ?? false },
        {
          valuation,
          building: building
            ? {
                latestScore: building.latest_score === null ? null : Number(building.latest_score),
                scoreDate: building.score_date?.toISOString().slice(0, 10) ?? null,
              }
            : null,
          sameTextElsewhere: 0,
          sameEraShare: eraShares.get(key) ?? null,
          firstSeen:
            facts?.asking_rent_cad && facts.observed_at
              ? { rentCad: facts.asking_rent_cad, at: facts.observed_at.toISOString() }
              : null,
          now,
        },
      ),
    });
  }
  return result;
}
