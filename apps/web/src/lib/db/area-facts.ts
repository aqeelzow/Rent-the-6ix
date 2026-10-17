import { AreaFactsSchema, type AreaFact, type AreaFacts } from "@rentthe6ix/shared/schemas";
import { getClient } from "../db";

// One area's facts with the city value beside each (P3.10 core, SPEC 9.1–9.3). Owner: D. The ward
// page's "at a glance" table reads this object. Crime rates are left out: they are opt-in only
// (SPEC 9.4), never part of a default view.
//
// City values follow what each figure means: counts are summed; densities and shares of area are
// weighted by area; the renter share by households; the RentSafeTO average is over every evaluated
// building. A median of medians is not the city median, so median income has no city value.

export type AreaKind = "neighbourhood" | "ward";

/** Fewer listings than this and a median asking rent is "not enough data" (null). */
export const MIN_LISTINGS = 5;
const SUM = new Set([
  "rentsafeto_buildings",
  "libraries",
  "parks",
  "dev_applications_12m",
  "residential_units_proposed_12m",
]);
const AREA_WEIGHTED = new Set(["transit_stops_per_km2", "rapid_transit_within_800m_pct"]);
const NOT_FACTS = new Set(["population"]);
export const LISTINGS_SOURCE = "rentthe6ix-listings";

export type IndicatorRow = {
  area_id: string;
  indicator_id: string;
  value: number | null;
  unit: string;
  period: string;
  source_id: string;
  sample_size: number | null;
  note: string | null;
  area_km2: number;
};
export type RentRow = {
  bedrooms: number;
  n_area: number;
  median_area: number | null;
  n_city: number;
  median_city: number | null;
};
export type SourceRow = {
  id: string;
  title: string;
  url: string;
  retrieved_at: string | Date | null;
};

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The city value for one indicator from every area's row, or null where none is meaningful. */
export function cityValueOf(
  indicatorId: string,
  rows: IndicatorRow[],
  cityRentSafeAverage: number | null,
): number | null {
  const known = rows.filter((row) => row.value !== null);
  if (known.length === 0) return null;
  if (indicatorId === "rentsafeto_avg_score") return cityRentSafeAverage;
  if (SUM.has(indicatorId)) return known.reduce((sum, row) => sum + row.value!, 0);
  if (AREA_WEIGHTED.has(indicatorId)) {
    const area = known.reduce((sum, row) => sum + row.area_km2, 0);
    return area > 0
      ? round(known.reduce((sum, r) => sum + r.value! * r.area_km2, 0) / area, 1)
      : null;
  }
  if (indicatorId === "renter_households_pct") {
    const households = known.reduce((sum, row) => sum + (row.sample_size ?? 0), 0);
    return households > 0
      ? round(known.reduce((sum, r) => sum + r.value! * (r.sample_size ?? 0), 0) / households, 1)
      : null;
  }
  return null;
}

/** Builds the facts for `areaId` from every area's latest indicators, listing rents and sources. */
export function assembleAreaFacts(input: {
  kind: AreaKind;
  area: { id: string; name: string; number: number | null };
  indicators: IndicatorRow[];
  rents: RentRow[];
  cityRentSafeAverage: number | null;
  sources: SourceRow[];
  today: string;
}): AreaFacts {
  const { kind, area, indicators, rents, cityRentSafeAverage, today } = input;
  const byIndicator = new Map<string, IndicatorRow[]>();
  for (const row of indicators) {
    if (NOT_FACTS.has(row.indicator_id) || row.indicator_id.startsWith("crime:")) continue;
    byIndicator.set(row.indicator_id, [...(byIndicator.get(row.indicator_id) ?? []), row]);
  }
  const facts: AreaFact[] = [];
  for (const [indicatorId, rows] of [...byIndicator].sort(([a], [b]) => a.localeCompare(b))) {
    const own = rows.find((row) => row.area_id === area.id);
    if (!own) continue;
    facts.push({
      indicatorId,
      value: own.value,
      cityValue: cityValueOf(indicatorId, rows, cityRentSafeAverage),
      unit: own.unit,
      period: own.period,
      sourceId: own.source_id,
      sampleSize: own.sample_size,
      note: own.note,
    });
  }
  const period = `30 days to ${today}`;
  const listingNote = "asking rents in listings RentThe6ix collected, not official statistics";
  for (const rent of [...rents].sort((a, b) => a.bedrooms - b.bedrooms)) {
    facts.push({
      indicatorId: `median_asking_rent_${rent.bedrooms}br`,
      value:
        rent.n_area >= MIN_LISTINGS && rent.median_area !== null
          ? Math.round(rent.median_area)
          : null,
      cityValue:
        rent.n_city >= MIN_LISTINGS && rent.median_city !== null
          ? Math.round(rent.median_city)
          : null,
      unit: "CAD/month",
      period,
      sourceId: LISTINGS_SOURCE,
      sampleSize: rent.n_area,
      note:
        rent.n_area < MIN_LISTINGS
          ? `${listingNote}; fewer than ${MIN_LISTINGS} listings`
          : listingNote,
    });
  }
  if (rents.length > 0) {
    facts.push({
      indicatorId: "listing_count_30d",
      value: rents.reduce((sum, rent) => sum + rent.n_area, 0),
      cityValue: rents.reduce((sum, rent) => sum + rent.n_city, 0),
      unit: "listings",
      period,
      sourceId: LISTINGS_SOURCE,
      sampleSize: null,
      note: "studios to 3 bedrooms, rent for the whole unit",
    });
  }
  const used = new Set(facts.map((fact) => fact.sourceId));
  const sources = input.sources
    .filter((source) => used.has(source.id))
    .map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      retrievedAt:
        source.retrieved_at === null
          ? null
          : new Date(source.retrieved_at).toISOString().slice(0, 10),
    }));
  if (used.has(LISTINGS_SOURCE)) {
    sources.push({
      id: LISTINGS_SOURCE,
      title: "Listings RentThe6ix collected",
      url: "/data",
      retrievedAt: today,
    });
  }
  return AreaFactsSchema.parse({ area: { kind, ...area }, facts, sources });
}

const TABLES = { neighbourhood: "neighbourhoods", ward: "wards" } as const;
const LISTING_COLUMN = { neighbourhood: "neighbourhood_id", ward: "ward_id" } as const;

/** The area's facts from TigerData, or null when the area doesn't exist. */
export async function loadAreaFacts(
  sql: NonNullable<ReturnType<typeof getClient>>,
  kind: AreaKind,
  areaId: string,
): Promise<AreaFacts | null> {
  const table = sql(TABLES[kind]);
  const column = sql(LISTING_COLUMN[kind]);
  const [areas, indicators, rents, sources] = await Promise.all([
    sql<{ id: string; name: string; number: number | null }[]>`
      SELECT id, name, number FROM ${table} WHERE id = ${areaId}`,
    sql<(IndicatorRow & { city_rentsafe: number | null })[]>`
      WITH latest AS (
        SELECT DISTINCT ON (area_id, indicator_id) area_id, indicator_id, value, unit, period,
               source_id, sample_size, note
        FROM area_indicators
        WHERE area_kind = ${kind} AND indicator_id NOT LIKE 'crime:%'
        ORDER BY area_id, indicator_id, period DESC
      )
      SELECT l.*, ST_Area(a.geometry::geography) / 1e6 AS area_km2,
             (SELECT round(avg(latest_score), 1)::float8 FROM buildings
              WHERE location IS NOT NULL AND latest_score IS NOT NULL) AS city_rentsafe
      FROM latest l JOIN ${table} a ON a.id = l.area_id`,
    sql<RentRow[]>`
      SELECT bedrooms,
             count(*) FILTER (WHERE ${column} = ${areaId})::int AS n_area,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_rent_cad)
               FILTER (WHERE ${column} = ${areaId}) AS median_area,
             count(*)::int AS n_city,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_rent_cad) AS median_city
      FROM listings
      WHERE status = 'active' AND duplicate_of IS NULL AND NOT rent_is_per_room
        AND last_seen_at >= now() - interval '30 days' AND bedrooms BETWEEN 0 AND 3
      GROUP BY bedrooms`,
    sql<SourceRow[]>`SELECT id, title, url, retrieved_at FROM sources`,
  ]);
  const area = areas[0];
  if (!area) return null;
  return assembleAreaFacts({
    kind,
    area,
    indicators,
    rents,
    cityRentSafeAverage: indicators[0]?.city_rentsafe ?? null,
    sources,
    today: new Date().toISOString().slice(0, 10),
  });
}

/** A URL number as the stored id: wards "1" → "01" (1–25), neighbourhoods "83" → "083". */
export function areaIdFor(kind: AreaKind, raw: string): string | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (kind === "ward") return n >= 1 && n <= 25 ? String(n).padStart(2, "0") : null;
  return n >= 1 && n <= 999 ? String(n).padStart(3, "0") : null;
}
