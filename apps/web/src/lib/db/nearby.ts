import {
  NearbyResponseSchema,
  PoiCategorySchema,
  type NearbyResponse,
  type PoiCategory,
} from "@rentthe6ix/shared/schemas";
import { z } from "zod";
import { ApiError, jsonRoute } from "../api/json-route";
import { getClient } from "../db";

// Nearby (P2.16, SPEC 11.3 "Nearby" and "nearest stops"). Owner: D. The nearest places in each
// category and the nearest TTC stops to one listing, as straight-line distances (never minutes:
// travel times come from OTP, SPEC 7.4). One round trip: the listing row plus every nearest-first
// lookup, each using the GiST index on `location`. Categories go in as one comma-joined string:
// `sql.array()` is sent as a bare "a,b" (a malformed literal) on a connection that hasn't loaded
// Postgres's array types yet, so the first request after a restart failed.

export const NEARBY_CATEGORIES = PoiCategorySchema.options;
/** Places per category and stops returned; enough for a detail page, cheap to query. */
export const PLACES_PER_CATEGORY = 3;
export const NEAREST_STOPS = 5;

export type NearbyRow = {
  kind: "listing" | "place" | "stop" | "rapid";
  id: string;
  name: string | null;
  category: string | null;
  subcategory: string | null;
  is_rapid: boolean | null;
  route_types: string[] | null;
  lat: number | null;
  lng: number | null;
  distance_m: number | null;
  location_precision: string | null;
};

/** Builds the response from the query's rows; null when the listing doesn't exist. */
export function nearbyFromRows(
  listingId: string,
  categories: readonly PoiCategory[],
  rows: NearbyRow[],
): NearbyResponse | null {
  const listing = rows.find((row) => row.kind === "listing");
  if (!listing) return null;
  const point = (row: NearbyRow) => ({ lat: row.lat ?? 0, lng: row.lng ?? 0 });
  const metres = (row: NearbyRow) => Math.round(row.distance_m ?? 0);
  const stop = (row: NearbyRow) => ({
    id: row.id,
    name: row.name ?? "",
    isRapid: row.is_rapid ?? false,
    routeTypes: row.route_types ?? [],
    distanceM: metres(row),
    location: point(row),
  });
  const byDistance = (a: NearbyRow, b: NearbyRow) => (a.distance_m ?? 0) - (b.distance_m ?? 0);
  const rapid = rows.find((row) => row.kind === "rapid");

  return NearbyResponseSchema.parse({
    listingId,
    locationPrecision: listing.location_precision,
    method: "straight_line",
    categories: categories.map((category) => ({
      category,
      places: rows
        .filter((row) => row.kind === "place" && row.category === category)
        .sort(byDistance)
        .map((row) => ({
          id: row.id,
          name: row.name ?? "",
          category,
          subcategory: row.subcategory,
          distanceM: metres(row),
          location: point(row),
        })),
    })),
    stops: rows
      .filter((row) => row.kind === "stop")
      .sort(byDistance)
      .map(stop),
    nearestRapid: rapid ? stop(rapid) : null,
  });
}

export async function loadNearby(
  sql: NonNullable<ReturnType<typeof getClient>>,
  listingId: string,
  categories: readonly PoiCategory[],
): Promise<NearbyResponse | null> {
  const rows = await sql<NearbyRow[]>`
    WITH l AS (SELECT id, location, location_precision FROM listings WHERE id = ${listingId})
    SELECT 'listing' AS kind, l.id::text AS id, NULL AS name, NULL AS category, NULL AS subcategory,
           NULL::boolean AS is_rapid, NULL::text[] AS route_types, NULL::float8 AS lat,
           NULL::float8 AS lng, NULL::float8 AS distance_m, l.location_precision
    FROM l
    UNION ALL
    SELECT 'place', p.id, p.name, p.category, p.subcategory, NULL, NULL,
           ST_Y(p.location::geometry), ST_X(p.location::geometry),
           ST_Distance(p.location, l.location), NULL
    FROM l
    CROSS JOIN unnest(string_to_array(${categories.join(",")}, ',')) AS c(category)
    CROSS JOIN LATERAL (
      SELECT * FROM pois WHERE pois.category = c.category
      ORDER BY pois.location <-> l.location LIMIT ${PLACES_PER_CATEGORY}
    ) p
    UNION ALL
    SELECT 'stop', s.id, s.name, NULL, NULL, s.is_rapid, s.route_types,
           ST_Y(s.location::geometry), ST_X(s.location::geometry),
           ST_Distance(s.location, l.location), NULL
    FROM l
    CROSS JOIN LATERAL (
      SELECT * FROM transit_stops ORDER BY transit_stops.location <-> l.location LIMIT ${NEAREST_STOPS}
    ) s
    UNION ALL
    SELECT 'rapid', s.id, s.name, NULL, NULL, s.is_rapid, s.route_types,
           ST_Y(s.location::geometry), ST_X(s.location::geometry),
           ST_Distance(s.location, l.location), NULL
    FROM l
    CROSS JOIN LATERAL (
      SELECT * FROM transit_stops WHERE is_rapid
      ORDER BY transit_stops.location <-> l.location LIMIT 1
    ) s`;
  return nearbyFromRows(listingId, categories, rows);
}

const Params = z.strictObject({ id: z.uuid() });
/** `?categories=grocery,school` (any of the eight); all of them when absent. */
const Categories = z
  .string()
  .max(200)
  .transform((value) => [...new Set(value.split(",").map((part) => part.trim()))])
  .pipe(z.array(PoiCategorySchema).min(1));

type Context = { params: Promise<{ id: string }> };

/** GET /api/listings/[id]/nearby?categories= (SPEC 13). */
export function createNearbyRoute(client: typeof getClient = getClient) {
  return jsonRoute<undefined, Context>(
    { name: "listings.nearby" },
    async (_input, request, context) => {
      const { id } = Params.parse(await context.params);
      const raw = new URL(request.url).searchParams.get("categories");
      const categories = raw === null ? NEARBY_CATEGORIES : Categories.parse(raw);
      const sql = client();
      if (!sql)
        throw new ApiError(503, "service_unavailable", "Nearby places temporarily unavailable");
      const nearby = await loadNearby(sql, id, categories);
      if (!nearby) throw new ApiError(404, "listing_not_found", "Listing not found");
      return nearby;
    },
  );
}
