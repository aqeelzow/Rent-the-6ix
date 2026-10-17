import { z } from "zod";
import { getClient } from "../db";
import type { TravelTarget } from "../../../../../packages/shared/schemas/index";

/**
 * Nearest real amenity for a listing — owner D, the missing half of amenity travel targets.
 *
 * "Close to groceries" has no destination of its own: the honest answer is a different shop for
 * every listing, which is why the spec routes amenities to the *nearest* POI rather than to one
 * city-wide pin. Without this, amenity targets carry no coordinates, produce no travel rows, and
 * every card's travel line goes blank. `pois` (5.4k rows) and `transit_stops` are both GiST-indexed,
 * so one KNN query per 100 m cell is a sub-millisecond lookup.
 */

const POI_CATEGORIES = ["grocery", "school", "university", "library", "park", "community_centre", "pharmacy", "clinic"] as const;

export type AmenityCategory = NonNullable<TravelTarget["category"]>;
export type Spot = { lat: number; lng: number };
export type NearestAmenity = (spot: Spot, category: AmenityCategory) => Promise<Spot | null>;

const categorySchema = z.enum([...POI_CATEGORIES, "rapid_transit"]);
const spotSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/** `pois.category` for amenities; rapid transit comes from GTFS stops instead of POIs. */
export const isPoiCategory = (category: AmenityCategory): category is (typeof POI_CATEGORIES)[number] =>
  category !== "rapid_transit";

export const poiStatement = `
  SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
  FROM pois
  WHERE category = $1
  ORDER BY location <-> ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
  LIMIT 1
`;
export const rapidTransitStatement = `
  SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
  FROM transit_stops
  WHERE is_rapid
  ORDER BY location <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
  LIMIT 1
`;

type Client = { unsafe: (statement: string, parameters: (string | number)[]) => PromiseLike<unknown> };

/** Same 100 m rounding as the route cache: ads in one building must share one lookup. */
const cell = (spot: Spot) =>
  `${(Math.round(spot.lat / 0.001) * 0.001).toFixed(3)}:${(Math.round(spot.lng / 0.001) * 0.001).toFixed(3)}`;
export const AMENITY_CACHE_LIMIT = 20_000;

/**
 * The nearest POI of a category, cached per 100 m cell and category. A missing database, an empty
 * category or a failed query all return null: the caller then shows nothing rather than a guess.
 */
export function nearestAmenity(client: () => Client | null = getClient, limit = AMENITY_CACHE_LIMIT): NearestAmenity {
  const cache = new Map<string, Spot | null>();
  return async (spot, category) => {
    if (!categorySchema.safeParse(category).success) return null;
    const key = `${category}|${cell(spot)}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const sql = client();
      if (!sql) return null;
      const rows = isPoiCategory(category)
        ? await sql.unsafe(poiStatement, [category, spot.lng, spot.lat])
        : await sql.unsafe(rapidTransitStatement, [spot.lng, spot.lat]);
      const row = z.array(spotSchema).max(1).parse(rows)[0] ?? null;
      if (cache.size >= limit) cache.clear();
      cache.set(key, row);
      return row;
    } catch {
      return null;
    }
  };
}
