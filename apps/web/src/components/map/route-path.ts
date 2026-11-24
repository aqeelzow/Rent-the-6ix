// Real paths for the map (#24): the selected listing's trip to each of the renter's places, and the
// walk to the nearest grocery store behind a hovered trip line, along the streets and transit
// lines OpenTripPlanner routes on. Fetched from /api/route; null whenever there's no router or no
// trip, and the map keeps its straight line.
import type { FeatureCollection } from "geojson";
import type { RoutedPath } from "@/lib/geo/otp";

export type { RoutedPath };
type Mode = "walk" | "bike" | "drive" | "transit";
type Point = [number, number];

const cache = new Map<string, Promise<RoutedPath | null>>();

export function fetchPath(from: Point, to: Point, mode: Mode): Promise<RoutedPath | null> {
  const fixed = (p: Point) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`;
  const key = `${fixed(from)}|${fixed(to)}|${mode}`;
  let path = cache.get(key);
  if (!path) {
    const query = new URLSearchParams({ from: fixed(from), to: fixed(to), mode });
    path = fetch(`/api/route?${query}`)
      .then((response) => (response.ok ? (response.json() as Promise<RoutedPath>) : null))
      .catch(() => null);
    // A failure isn't remembered: the router may be back on the next selection.
    void path.then((result) => {
      if (!result) cache.delete(key);
    });
    cache.set(key, path);
  }
  return path;
}

/** Walking legs are drawn dashed; everything ridden (bus, ION, bike, car) solid. */
export const isWalk = (mode: string) => mode === "WALK";

/** A path's legs as line features, tagged with the place they lead to and whether they're walked. */
export function pathFeatures(id: string, path: RoutedPath): FeatureCollection["features"] {
  return path.legs.map((leg) => ({
    type: "Feature",
    properties: { id, walk: isWalk(leg.mode) },
    geometry: { type: "LineString", coordinates: leg.coordinates },
  }));
}

/** The point halfway along a path, by vertex count, for its label. */
export function pathMiddle(path: RoutedPath): Point | null {
  const points = path.legs.flatMap((leg) => leg.coordinates);
  return points[Math.floor(points.length / 2)] ?? null;
}

/** The routes ridden, in order ("301", "7"), for the label. */
export function ridden(path: RoutedPath): string[] {
  return path.legs.flatMap((leg) => (!isWalk(leg.mode) && leg.route ? [leg.route] : []));
}
