import type { FeatureCollection, Point, Polygon } from "geojson";
import { distanceM } from "@rentthe6ix/shared/engine/travel";
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

/**
 * The City of Toronto with a ~10 km margin, [west, south, east, north]. The map fits to listings
 * inside it, so one badly geocoded listing can't zoom the map out to another province or state.
 */
export const TORONTO_REGION: [number, number, number, number] = [-79.76, 43.49, -78.99, 43.95];
/** How far the map may be panned: the Greater Toronto Area and a bit more. */
export const MAP_MAX_BOUNDS: [number, number, number, number] = [-80.6, 43.1, -78.3, 44.4];

const inRegion = ({ lng, lat }: { lng: number; lat: number }) =>
  lng >= TORONTO_REGION[0] &&
  lng <= TORONTO_REGION[2] &&
  lat >= TORONTO_REGION[1] &&
  lat <= TORONTO_REGION[3];

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
type SearchAreaProps = { id: string; label: string };
export type SearchAreaCollection = FeatureCollection<Polygon, SearchAreaProps>;

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

/** Configured general-area filters are approximate rectangles, shown separately from listing areas. */
export function searchAreasToGeoJSON(areas: SearchIntent["areas"]): SearchAreaCollection {
  return {
    type: "FeatureCollection",
    features: areas.flatMap((area) => {
      if (area.kind !== "configured") return [];
      const [west, south, east, north] = area.bounds;
      return [
        {
          type: "Feature" as const,
          properties: {
            id: area.id,
            label: area.label.replace(
              " approximate configured search boundary (not an official boundary)",
              " (approx.)",
            ),
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
              ],
            ],
          },
        },
      ];
    }),
  };
}

/** Places the renter wants to reach that have coordinates, for destination pins. */
export function placePins(targets: SearchIntent["travelTargets"]) {
  return targets.flatMap((target) =>
    target.kind === "place" && target.resolved
      ? [{ id: target.id, label: target.label, lng: target.resolved.lng, lat: target.resolved.lat }]
      : [],
  );
}

/** Listings this close together are treated as one building (units in the same block). */
export const SAME_PLACE_M = 30;

/** Every result at the same place as the given listing (itself included), in result order. */
export function listingsAtSamePlace(results: SearchResultItem[], id: string): SearchResultItem[] {
  const origin = results.find((result) => result.listing.id === id);
  if (!origin) return [];
  return results.filter(
    (result) => distanceM(origin.listing.location, result.listing.location) <= SAME_PLACE_M,
  );
}

/** True when every one of these listings sits at the same place (so zooming can't split them). */
export function allAtSamePlace(results: SearchResultItem[], ids: string[]): boolean {
  const here = new Set(ids);
  const located = results.filter((result) => here.has(result.listing.id));
  const first = located[0];
  return (
    located.length > 1 &&
    located.every(
      (result) => distanceM(first!.listing.location, result.listing.location) <= SAME_PLACE_M,
    )
  );
}

/**
 * From the selected listing to each place the renter named: the quickest routed time over the
 * renter's modes, else a straight-line distance (from the travel rows, else computed). A
 * straight-line route never carries minutes (SPEC 7.4).
 */
export type RouteToPlace = {
  id: string;
  label: string;
  from: [number, number];
  to: [number, number];
} & (
  | { kind: "routed"; mode: SearchIntent["travelTargets"][number]["mode"]; minutes: number }
  | { kind: "straight_line"; distanceM: number }
);

export function routesToPlaces(
  result: SearchResultItem,
  targets: SearchIntent["travelTargets"],
): RouteToPlace[] {
  const { location } = result.listing;
  return targets.flatMap((target): RouteToPlace[] => {
    if (target.kind !== "place" || !target.resolved) return [];
    const base = {
      id: target.id,
      label: target.label,
      from: [location.lng, location.lat] as [number, number],
      to: [target.resolved.lng, target.resolved.lat] as [number, number],
    };
    const modes = [target.mode, ...(target.alternativeModes ?? [])];
    const rows = result.travel.filter(
      (row) => row.targetId === target.id && modes.includes(row.mode),
    );
    const routed = rows
      .filter((row) => row.method === "otp" && row.minutes !== null)
      .sort((a, b) => a.minutes! - b.minutes!)[0];
    if (routed) {
      return [{ ...base, kind: "routed", mode: routed.mode, minutes: Math.round(routed.minutes!) }];
    }
    const line = rows.find((row) => row.method === "straight_line");
    return [
      {
        ...base,
        kind: "straight_line",
        distanceM: line?.distanceM ?? distanceM(location, target.resolved),
      },
    ];
  });
}

/**
 * [west, south, east, north] around every listing and place, including the full extent of
 * approximate-location circles; null when there's nothing to show.
 */
export function boundsOf(
  results: SearchResultItem[],
  places: { lng: number; lat: number }[],
  searchAreas: SearchIntent["areas"] = [],
): [number, number, number, number] | null {
  const boxes = [
    ...results
      .filter(({ listing }) => inRegion(listing.location))
      .map(({ listing }) => {
        const radiusM =
          listing.locationPrecision === "exact" ? 0 : APPROX_RADIUS_M[listing.locationPrecision];
        return { ...listing.location, radiusM };
      }),
    ...places.filter(inRegion).map((place) => ({ ...place, radiusM: 0 })),
    ...searchAreas.flatMap((area) => {
      if (area.kind !== "configured") return [];
      const [west, south, east, north] = area.bounds;
      return [
        { lng: west, lat: south, radiusM: 0 },
        { lng: east, lat: north, radiusM: 0 },
      ].filter(inRegion);
    }),
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
