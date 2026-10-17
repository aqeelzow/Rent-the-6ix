import { z } from "zod";
import { getClient } from "../db";
import { distanceM, targetModes } from "../../../../../packages/shared/engine/travel";
import { TravelTimeRowSchema, type Listing, type TravelTarget, type TravelTimeRow } from "../../../../../packages/shared/schemas/index";

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

/** Bound value or array of bound values, as the driver takes them. */
export type SqlParameter = string | number | number[];
type Client = { unsafe: (statement: string, parameters: SqlParameter[]) => PromiseLike<unknown> };

/**
 * Nearest POI for many origins in one query, per category.
 *
 * One lookup per (listing, category) is what the connection pool cannot afford: the client holds
 * two connections and each round trip is tens of milliseconds, so 300 lookups measured ~4 s — the
 * entire routing budget. A lateral join returns the same answers for every origin at once, which is
 * why missing amenity distances are filled after routing instead of before it.
 */
export const poiBatchStatement = `
  SELECT o.idx::int AS idx, ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng
  FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS o(lng, lat, idx)
  CROSS JOIN LATERAL (
    SELECT location FROM pois
    WHERE category = $3
    ORDER BY location <-> ST_SetSRID(ST_MakePoint(o.lng, o.lat), 4326)::geography
    LIMIT 1
  ) p
`;
export const rapidTransitBatchStatement = `
  SELECT o.idx::int AS idx, ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng
  FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS o(lng, lat, idx)
  CROSS JOIN LATERAL (
    SELECT location FROM transit_stops
    WHERE is_rapid
    ORDER BY location <-> ST_SetSRID(ST_MakePoint(o.lng, o.lat), 4326)::geography
    LIMIT 1
  ) p
`;

const batchRowSchema = z.object({ idx: z.number(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/**
 * `amenityDistances(listings, targets)` — the labelled distance from every listing to its nearest
 * POI of each amenity category, as `straight_line` rows.
 *
 * The router answers for the candidates it can reach inside the budget; this fills the rest so a
 * card never reads "travel time not available" while showing a place's distance on the same line.
 * Rows never claim minutes, and a listing with no POI nearby gets no row at all.
 */
export type AmenityDistances = (
  listings: readonly Listing[],
  targets: readonly TravelTarget[],
) => Promise<TravelTimeRow[]>;

export function amenityDistances(client: () => Client | null = getClient, now: () => Date = () => new Date()): AmenityDistances {
  return async (listings, targets) => {
    try {
      const amenities = targets.filter((target) => target.kind === "amenity" && target.category);
      if (!listings.length || !amenities.length) return [];
      const sql = client();
      if (!sql) return [];
      const computedAt = now().toISOString();
      const lngs = listings.map((listing) => listing.location.lng);
      const lats = listings.map((listing) => listing.location.lat);
      const byCategory = new Map<AmenityCategory, TravelTarget[]>();
      for (const target of amenities) byCategory.set(target.category!, [...(byCategory.get(target.category!) ?? []), target]);

      const groups = await Promise.all([...byCategory].map(async ([category, categoryTargets]) => {
        const rows = isPoiCategory(category)
          ? await sql.unsafe(poiBatchStatement, [lngs, lats, category])
          : await sql.unsafe(rapidTransitBatchStatement, [lngs, lats]);
        const spots = new Map<number, Spot>();
        for (const row of z.array(batchRowSchema).parse(rows)) spots.set(row.idx, { lat: row.lat, lng: row.lng });
        return { categoryTargets, spots };
      }));

      const output: TravelTimeRow[] = [];
      for (const { categoryTargets, spots } of groups) {
        listings.forEach((listing, index) => {
          const spot = spots.get(index + 1);
          if (!spot) return;
          for (const target of categoryTargets) for (const mode of targetModes(target)) {
            output.push(TravelTimeRowSchema.parse({
              listingId: listing.id,
              targetId: target.id,
              mode,
              distanceM: Math.round(distanceM(listing.location, spot)),
              minutes: null,
              poiId: null,
              computedAt,
              method: "straight_line",
            }));
          }
        });
      }
      return output;
    } catch {
      return [];
    }
  };
}

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
