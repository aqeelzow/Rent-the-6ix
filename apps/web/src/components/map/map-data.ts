import type { FeatureCollection, Point, Polygon } from "geojson";
import type { SearchIntent, SearchResultItem } from "@/lib/store/types";

// GeoJSON for the results map (SPEC 12). Pure, so it's tested without a browser.

export type ScoreBand = "high" | "mid" | "low";

/** Score bands for pin colours; the legend shows the same thresholds as text. */
export const SCORE_BANDS = { high: 75, mid: 50 } as const;

/** Shades of the accent (never red/green); hex because MapLibre can't parse oklch(). */
export const BAND_COLORS: Record<ScoreBand, string> = {
  high: "#005f99",
  mid: "#4e8cbe",
  low: "#9dbbd6",
};
export const PLACE_COLOR = "#795bbf";

/** Approximate locations are circles, not pins (SPEC 12: 150–300 m). */
export const APPROX_RADIUS_M = { street: 150, area: 300 } as const;

export function scoreBand(total: number): ScoreBand {
  if (total >= SCORE_BANDS.high) return "high";
  if (total >= SCORE_BANDS.mid) return "mid";
  return "low";
}

type Position = [number, number];
type Props = { id: string; band: ScoreBand; total: number };
export type PointCollection = FeatureCollection<Point, Props>;
export type AreaCollection = FeatureCollection<Polygon, Props>;

/** A circle of `radiusM` metres around a point, as a closed polygon ring. */
export function circlePolygon(
  center: { lng: number; lat: number },
  radiusM: number,
  steps = 48,
): Position[] {
  const latRadius = radiusM / 111_320;
  const lngRadius = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const ring: Position[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([center.lng + lngRadius * Math.cos(angle), center.lat + latRadius * Math.sin(angle)]);
  }
  ring.push(ring[0]!);
  return ring;
}

/** Exact listings become clustered pins; street- or area-level ones become circles. */
export function resultsToGeoJSON(results: SearchResultItem[]): {
  points: PointCollection;
  areas: AreaCollection;
} {
  const points: PointCollection = { type: "FeatureCollection", features: [] };
  const areas: AreaCollection = { type: "FeatureCollection", features: [] };
  for (const { listing, matchScore } of results) {
    const properties: Props = {
      id: listing.id,
      band: scoreBand(matchScore.total),
      total: matchScore.total,
    };
    if (listing.locationPrecision === "exact") {
      points.features.push({
        type: "Feature",
        id: listing.id,
        properties,
        geometry: { type: "Point", coordinates: [listing.location.lng, listing.location.lat] },
      });
    } else {
      areas.features.push({
        type: "Feature",
        id: listing.id,
        properties,
        geometry: {
          type: "Polygon",
          coordinates: [
            circlePolygon(listing.location, APPROX_RADIUS_M[listing.locationPrecision]),
          ],
        },
      });
    }
  }
  return { points, areas };
}

/** Places the renter wants to reach that have coordinates, for destination pins. */
export function placePins(targets: SearchIntent["travelTargets"]) {
  return targets.flatMap((target) =>
    target.kind === "place" && target.resolved
      ? [{ id: target.id, label: target.label, lng: target.resolved.lng, lat: target.resolved.lat }]
      : [],
  );
}

/**
 * [west, south, east, north] around every listing and place, including the full extent of
 * approximate-location circles; null when there's nothing to show.
 */
export function boundsOf(
  results: SearchResultItem[],
  places: { lng: number; lat: number }[],
): [number, number, number, number] | null {
  const boxes = [
    ...results.map(({ listing }) => {
      const radiusM =
        listing.locationPrecision === "exact" ? 0 : APPROX_RADIUS_M[listing.locationPrecision];
      return { ...listing.location, radiusM };
    }),
    ...places.map((place) => ({ ...place, radiusM: 0 })),
  ];
  if (!boxes.length) return null;
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { lng, lat, radiusM } of boxes) {
    const dLat = radiusM / 111_320;
    const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
    west = Math.min(west, lng - dLng);
    east = Math.max(east, lng + dLng);
    south = Math.min(south, lat - dLat);
    north = Math.max(north, lat + dLat);
  }
  return [west, south, east, north];
}
