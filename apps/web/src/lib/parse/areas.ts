import { z } from "zod";
import { getClient } from "../db";
import { DestinationChoiceSchema, type DestinationResolution } from "../../../../../packages/shared/schemas/index";
import type { AddressLookup } from "./resolve";

/**
 * Toronto area names → representative points, from the `neighbourhoods` and `wards` tables.
 *
 * Parsed intents name places the way renters say them ("Liberty Village", "downtown",
 * "Scarborough"), and almost none of those are full street addresses. Without this lookup the
 * destination stays unresolved, no travel row exists and every travel figure on the card goes
 * blank — the router never gets a coordinate to route to. The City's own area tables are already
 * loaded, so the name is matched here before geocoding is ever needed.
 *
 * The answer is always a representative point (`representativePoint: true`): the centroid of the matched area
 * (or of every area the query names), never a doorway.
 */

const AREA_SIMILARITY = 0.4;
const AREA_LIMIT = 8;

const rowSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(["neighbourhood", "ward"]),
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  exact: z.boolean(),
  contains: z.boolean(),
  score: z.number(),
});

type AreaRow = z.infer<typeof rowSchema>;

/**
 * `$1` is the normalized query. Exact names win over "the query is part of the name" (so
 * "liberty village" finds "Fort York-Liberty Village"), which wins over trigram similarity for
 * typos ("kensingtn"). Both tables are small (158 + 25 rows), so the ORDER BY is cheap.
 */
export const areaStatement = `
  WITH matches AS (
    SELECT name, 'neighbourhood'::text AS kind, ST_Centroid(geometry) AS point
    FROM neighbourhoods
    UNION ALL
    SELECT name, 'ward'::text AS kind, ST_Centroid(geometry) AS point
    FROM wards
  )
  SELECT
    m.name,
    m.kind,
    ST_X(m.point) AS lng,
    ST_Y(m.point) AS lat,
    lower(m.name) = $1 AS exact,
    strpos(lower(m.name), $1) > 0 AS contains,
    similarity(lower(m.name), $1) AS score
  FROM matches m
  WHERE lower(m.name) = $1
     OR strpos(lower(m.name), $1) > 0
     OR similarity(lower(m.name), $1) >= ${AREA_SIMILARITY}
  ORDER BY exact DESC, contains DESC, score DESC, length(m.name) ASC
  LIMIT ${AREA_LIMIT}
`;

/** Rounded to ~0.1 m so equal areas always give an equal, cacheable coordinate. */
const mean = (values: number[]) => Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 1e6) / 1e6;

/**
 * One area → its centroid; several areas the query names ("Scarborough", "High Park") → the mean
 * of their centroids, labelled with the query rather than pretending one of them is the answer.
 */
export function areaResolution(query: string, rows: readonly unknown[]): DestinationResolution | undefined {
  const parsed = z.array(rowSchema).max(AREA_LIMIT).safeParse(rows);
  if (!parsed.success || !parsed.data.length) return undefined;
  // Only the strongest tier counts: an exact ward name must not be diluted by fuzzy neighbours.
  const best = parsed.data.filter((row) => row.exact === parsed.data[0].exact && row.contains === parsed.data[0].contains);
  const lat = mean(best.map((row) => row.lat));
  const lng = mean(best.map((row) => row.lng));
  const label =
    best.length === 1
      ? `${best[0].name} ${best[0].kind}`
      : `${query} area`;
  return {
    status: "resolved",
    query,
    destination: DestinationChoiceSchema.parse({
      id: best.length === 1 ? `area-${best[0].kind}-${best[0].name}` : `area-${query}`,
      label,
      resolved: { lng, lat, source: "known_place", representativePoint: true, label },
    }),
  };
}

type Client = { unsafe: (statement: string, parameters: string[]) => PromiseLike<unknown> };
/**
 * Identical concurrent lookups share one query (two renters typing "Liberty Village" at once);
 * unlike address points, a second caller is never dropped — dropping it is exactly the blank-card
 * bug this lookup exists to fix.
 */
const inFlight = new Map<string, Promise<DestinationResolution | undefined>>();
const normalizeQuery = (query: string) => query.toLowerCase().replace(/\s+/g, " ").trim();

function readArea(query: string, client: () => Client | null): Promise<DestinationResolution | undefined> {
  const key = normalizeQuery(query);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const operation = (async () => {
    try {
      const sql = client();
      if (!sql) return undefined;
      return areaResolution(query, (await sql.unsafe(areaStatement, [key])) as unknown[]);
    } catch {
      return undefined;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, operation);
  return operation;
}

/** Same shape as the address-point lookup, so the resolver can try it in the same chain. */
export function areaPointsLookup(client: () => Client | null = getClient): AddressLookup {
  return async (query, signal) => {
    if (signal.aborted) return undefined;
    let stop = () => {};
    const aborted = new Promise<undefined>((resolve) => {
      stop = () => resolve(undefined);
      signal.addEventListener("abort", stop, { once: true });
    });
    try {
      return await Promise.race([readArea(query, client), aborted]);
    } finally {
      signal.removeEventListener("abort", stop);
    }
  };
}

export type { AreaRow };
