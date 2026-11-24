import { z } from "zod";
import { distanceM } from "@rentkdubs/shared/engine/travel";

/**
 * GET /api/places/search?q=walmart&near=lat,lng: named places around Waterloo ("Walmart",
 * "Costco", "Sobeys on King") for the map's nearby panel, nearest first. Backed by Photon
 * (photon.komoot.io), OpenStreetMap's free place search, kept to the Region by a bounding box.
 * Only the words searched and the listing's (public) point are sent; never anything about the
 * renter. 502 when Photon is down, so the panel says so instead of showing nothing.
 */

export const PHOTON_URL = "https://photon.komoot.io/api/";
/** Kitchener, Waterloo and Cambridge, west,south,east,north (Photon's bbox order). */
const REGION_BBOX = "-80.75,43.30,-80.20,43.60";
export const MAX_RESULTS = 5;

export type FoundPlace = {
  name: string;
  /** "70 Bridgeport Road East, Waterloo", or null when OSM has no address for it. */
  address: string | null;
  distanceM: number;
  location: { lng: number; lat: number };
};

const querySchema = z.object({
  q: z.string().trim().min(2).max(80),
  near: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .transform((value) => {
      const [lat, lng] = value.split(",").map(Number) as [number, number];
      return { lat, lng };
    }),
});

const photonSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z
        .object({
          name: z.string().optional(),
          housenumber: z.string().optional(),
          street: z.string().optional(),
          city: z.string().optional(),
        })
        .passthrough(),
    }),
  ),
});

/** Photon's answer as places, nearest first, one per name and address. */
export function placesFromPhoton(body: unknown, near: { lat: number; lng: number }): FoundPlace[] {
  const parsed = photonSchema.safeParse(body);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const places: FoundPlace[] = [];
  for (const feature of parsed.data.features) {
    const { name, housenumber, street, city } = feature.properties;
    if (!name) continue;
    const [lng, lat] = feature.geometry.coordinates;
    const line = [housenumber, street].filter(Boolean).join(" ");
    const address = [line, city].filter(Boolean).join(", ") || null;
    const key = `${name}|${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      name,
      address,
      location: { lng, lat },
      distanceM: Math.round(distanceM(near, { lng, lat })),
    });
  }
  return places.sort((a, b) => a.distanceM - b.distanceM).slice(0, MAX_RESULTS);
}

export function createPlaceSearchHandler(fetchImpl: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
    const { q, near } = parsed.data;
    const url = new URL(PHOTON_URL);
    url.search = new URLSearchParams({
      q,
      lat: String(near.lat),
      lon: String(near.lng),
      bbox: REGION_BBOX,
      limit: "15",
      lang: "en",
    }).toString();
    try {
      const response = await fetchImpl(url, {
        headers: { "user-agent": "RentTheLoo/0.1 (+https://github.com/aesthetic0001/rent-k-dubs)" },
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) return Response.json({ error: "search_unavailable" }, { status: 502 });
      return Response.json(
        { places: placesFromPhoton(await response.json(), near) },
        { headers: { "cache-control": "public, max-age=86400" } },
      );
    } catch {
      return Response.json({ error: "search_unavailable" }, { status: 502 });
    }
  };
}
