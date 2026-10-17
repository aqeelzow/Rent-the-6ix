// P2.14 (derived half) — area indicators computed in TigerData from tables the other civic tasks
// already loaded: RentSafeTO buildings, TTC stops and City POIs, counted inside each of the 158
// neighbourhoods and 25 wards (SPEC 5 "Area", 9.1, 9.2). Nothing is fetched; each indicator is one
// `insert … select` so no rows travel to this machine.
//
// Every row carries the dataset it was derived from as `source_id` and that dataset's retrieval
// month as `period` (these are counts "as loaded", not a census). Thin data stays visible as thin:
// an average over fewer than MIN_SCORED buildings is stored as null with a note, never as a number.
//
// `parks_ha_per_1000` from SPEC 5 needs park polygons; `pois` holds points, so this stores the
// count of parks (`parks`) instead.
import type { Sql } from "postgres";

/** Fewer evaluated buildings than this and the area's average score is "not enough data". */
export const MIN_SCORED = 3;
/** "Rapid transit within 800 m" (SPEC 9.1): a ten-minute walk to a subway or LRT stop. */
export const RAPID_RADIUS_M = 800;
/** NAD83(CSRS) / MTM zone 10: the City's own metric projection, for buffers and areas. */
const METRIC_SRID = 2952;

const KINDS = [
  { kind: "neighbourhood", table: "neighbourhoods" },
  { kind: "ward", table: "wards" },
] as const;

export interface DerivedIndicator {
  id: string;
  unit: string;
  sourceId: string;
}

export const DERIVED_INDICATORS: DerivedIndicator[] = [
  { id: "rentsafeto_buildings", unit: "buildings", sourceId: "apartment-building-registration" },
  {
    id: "rentsafeto_avg_score",
    unit: "score out of 100",
    sourceId: "apartment-building-evaluation",
  },
  { id: "transit_stops_per_km2", unit: "stops per km²", sourceId: "ttc-routes-and-schedules" },
  { id: "rapid_transit_within_800m_pct", unit: "% of area", sourceId: "ttc-routes-and-schedules" },
  { id: "libraries", unit: "libraries", sourceId: "library-branch-general-information" },
  { id: "parks", unit: "parks", sourceId: "parks-and-recreation-facilities" },
];

export interface DerivedLoad {
  rows: number;
  byIndicator: Record<string, number>;
}

/** The value expression and joins for one indicator, over area alias `a`. */
function valueSql(sql: Sql, id: string) {
  switch (id) {
    case "rentsafeto_buildings":
      return sql`(select count(*) from buildings b
                  where b.location is not null and ST_Covers(a.geometry, b.location::geometry))::float8,
                 null::int, null::text`;
    case "rentsafeto_avg_score":
      return sql`(select case when count(b.latest_score) >= ${MIN_SCORED}
                              then round(avg(b.latest_score), 1)::float8 end
                  from buildings b
                  where b.location is not null and ST_Covers(a.geometry, b.location::geometry)),
                 (select count(b.latest_score)::int from buildings b
                  where b.location is not null and ST_Covers(a.geometry, b.location::geometry)),
                 (select case when count(b.latest_score) < ${MIN_SCORED}
                              then 'fewer than ' || ${MIN_SCORED} || ' evaluated buildings' end
                  from buildings b
                  where b.location is not null and ST_Covers(a.geometry, b.location::geometry))`;
    case "transit_stops_per_km2":
      return sql`round(((select count(*) from transit_stops s
                         where ST_Covers(a.geometry, s.location::geometry))
                        / (ST_Area(a.geometry::geography) / 1e6))::numeric, 1)::float8,
                 null::int, null::text`;
    case "rapid_transit_within_800m_pct":
      return sql`round((100 * ST_Area(ST_Intersection(ST_Transform(a.geometry, ${METRIC_SRID}::int), r.zone))
                        / ST_Area(ST_Transform(a.geometry, ${METRIC_SRID}::int)))::numeric, 1)::float8,
                 null::int, null::text`;
    case "libraries":
    case "parks":
      return sql`(select count(*) from pois p
                  where p.category = ${id === "libraries" ? "library" : "park"}
                    and ST_Covers(a.geometry, p.location::geometry))::float8,
                 null::int, null::text`;
    default:
      throw new Error(`no SQL for indicator ${id}`);
  }
}

export async function loadDerivedIndicators(sql: Sql): Promise<DerivedLoad> {
  const byIndicator: Record<string, number> = {};
  let rows = 0;
  for (const indicator of DERIVED_INDICATORS) {
    const [source] = await sql<{ period: string }[]>`
      select to_char(retrieved_at, 'YYYY-MM') as period from sources where id = ${indicator.sourceId}`;
    if (!source) {
      throw new Error(`sources has no "${indicator.sourceId}" row; run its civic task first`);
    }
    byIndicator[indicator.id] = 0;
    for (const { kind, table } of KINDS) {
      // The rapid-transit zone is built once per statement: 148 stop buffers unioned.
      const result = await sql`
        with r as (
          select ST_Union(ST_Buffer(ST_Transform(location::geometry, ${METRIC_SRID}::int), ${RAPID_RADIUS_M})) as zone
          from transit_stops where is_rapid
        )
        insert into area_indicators
          (area_id, area_kind, indicator_id, value, sample_size, note, unit, period, source_id)
        select a.id, ${kind}, ${indicator.id}, ${valueSql(sql, indicator.id)},
               ${indicator.unit}, ${source.period}, ${indicator.sourceId}
        from ${sql(table)} a cross join r
        on conflict (area_id, indicator_id, period) do update set
          value = excluded.value,
          sample_size = excluded.sample_size,
          note = excluded.note,
          unit = excluded.unit,
          source_id = excluded.source_id`;
      byIndicator[indicator.id] += result.count;
      rows += result.count;
    }
  }
  return { rows, byIndicator };
}
