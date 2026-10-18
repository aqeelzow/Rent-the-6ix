import { safetyCaveats } from "@rentthe6ix/shared/engine/safety";
import { AreaChoroplethSchema, type AreaChoropleth } from "@rentthe6ix/shared/schemas";
import { z } from "zod";
import { ApiError, jsonRoute } from "../api/json-route";
import { getClient } from "../db";
import type { AreaKind } from "./area-facts";
import { crimeTableSource, safetyForListing, type CrimeTable } from "./safety";

// GET /api/areas?kind=&indicator= (SPEC 13, P3.10 choropleth). Owner: D. One indicator for every
// neighbourhood or ward, with outlines simplified to ~10 m (131 KB for the 158 neighbourhoods).
// `crime` is the police-reported major-crime rate relative to the city (SPEC 7.6): neighbourhoods
// only, because TPS publishes no ward figures, and always with its caveats.

/** ~10 m at Toronto's latitude: keeps the shapes, drops 87% of the points. */
const SIMPLIFY_DEGREES = 0.0001;
const TABLES = { neighbourhood: "neighbourhoods", ward: "wards" } as const;

type OutlineRow = {
  id: string;
  name: string;
  geometry: AreaChoropleth["features"][number]["geometry"];
};
type ValueRow = {
  area_id: string;
  value: number | null;
  unit: string;
  period: string;
  source_id: string;
};

/** The crime layer: each neighbourhood's rate ÷ the city's, from the same table search uses. */
export function crimeChoropleth(outlines: OutlineRow[], table: CrimeTable): AreaChoropleth {
  const years = [...table.byArea.values()].find((rates) => rates.years.length > 0)?.years ?? [];
  return AreaChoroplethSchema.parse({
    kind: "neighbourhood",
    indicator: "crime",
    unit: "× city rate",
    period: years.length > 0 ? `${years[0]}–${years.at(-1)}` : null,
    cityValue: 1,
    sourceId: "neighbourhood-crime-rates",
    caveats: safetyCaveats(table.city),
    features: outlines.map((outline) => ({
      ...outline,
      value: safetyForListing(table, outline.id).safety?.relativeRate ?? null,
    })),
  });
}

export async function loadChoropleth(
  sql: NonNullable<ReturnType<typeof getClient>>,
  kind: AreaKind,
  indicator: string,
  crimeTable: () => Promise<CrimeTable | null>,
): Promise<AreaChoropleth | null> {
  const outlines = await sql<OutlineRow[]>`
    SELECT id, name,
           ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geometry, ${SIMPLIFY_DEGREES}::float8)), 5)::json
             AS geometry
    FROM ${sql(TABLES[kind])} ORDER BY id`;
  if (indicator === "crime") {
    if (kind !== "neighbourhood") return null;
    const table = await crimeTable();
    return table ? crimeChoropleth(outlines, table) : null;
  }
  const values = await sql<ValueRow[]>`
    SELECT DISTINCT ON (area_id) area_id, value, unit, period, source_id
    FROM area_indicators
    WHERE area_kind = ${kind} AND indicator_id = ${indicator}
    ORDER BY area_id, period DESC`;
  if (values.length === 0) return null;
  const byArea = new Map(values.map((row) => [row.area_id, row]));
  return AreaChoroplethSchema.parse({
    kind,
    indicator,
    unit: values[0]!.unit,
    period: values[0]!.period,
    cityValue: null,
    sourceId: values[0]!.source_id,
    caveats: [],
    features: outlines.map((outline) => ({
      ...outline,
      value: byArea.get(outline.id)?.value ?? null,
    })),
  });
}

const Query = z.strictObject({
  kind: z.enum(["neighbourhood", "ward"]),
  indicator: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .max(64),
});

/** Outlines and values change only when D reloads data; keep each layer for an hour. */
const CACHE_MS = 60 * 60 * 1000;

export function createChoroplethRoute(
  client: typeof getClient = getClient,
  crimeTable: () => Promise<CrimeTable | null> = crimeTableSource(client),
) {
  const cache = new Map<string, { at: number; value: AreaChoropleth }>();
  return jsonRoute({ name: "areas.choropleth" }, async (_input, request) => {
    const url = new URL(request.url);
    const { kind, indicator } = Query.parse(Object.fromEntries(url.searchParams));
    const key = `${kind}|${indicator}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const sql = client();
    if (!sql) throw new ApiError(503, "service_unavailable", "Area data temporarily unavailable");
    const value = await loadChoropleth(sql, kind, indicator, crimeTable);
    if (!value) throw new ApiError(404, "indicator_not_found", "No such indicator for these areas");
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}
