import type { NearbyResponse } from "@/lib/store/types";

// What the "Nearby" section shows (SPEC 11.3), from D's nearby route. Straight-line distances only:
// never minutes (travel times come from "Getting around"), and labelled approximate when the
// listing's own point is.

const kmFormat = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const mFormat = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

/** "80 m", "350 m", "1.2 km", "12.4 km": metres to the nearest 10 under 1 km, else kilometres. */
export function formatDistance(metres: number): string {
  if (metres < 995) return `${mFormat.format(Math.max(10, Math.round(metres / 10) * 10))} m`;
  return `${kmFormat.format(metres / 1000)} km`;
}

/**
 * City datasets publish some names in capitals ("TERRY FOX PUBLIC SCHOOL"); show them in title case
 * ("Terry Fox Public School", "L'Amoreaux"). Names already in mixed case are left alone.
 */
export function displayName(name: string): string {
  if (name !== name.toUpperCase() || !/[A-Z]{3}/.test(name)) return name;
  return name
    .toLowerCase()
    .replace(
      /(^|[\s\-'(/.])(\p{L})/gu,
      (_m, lead: string, letter: string) => lead + letter.toUpperCase(),
    );
}

/** TTC GTFS names platforms ("King Station - Southbound Platform"); renters need the station. */
export function stationName(name: string): string {
  return name.replace(/\s*-\s*[^-]*\bplatform\s*$/i, "").trim() || name;
}

type Category = NearbyResponse["categories"][number]["category"];

/** Everyday needs first. */
export const CATEGORY_ORDER: Category[] = [
  "grocery",
  "pharmacy",
  "park",
  "school",
  "library",
  "clinic",
  "community_centre",
  "university",
];

export function orderedCategories(nearby: NearbyResponse): NearbyResponse["categories"] {
  const rank = (category: Category) => CATEGORY_ORDER.indexOf(category);
  return [...nearby.categories]
    .filter((group) => group.places.length > 0)
    .sort((a, b) => rank(a.category) - rank(b.category));
}

export type NearbyRow = {
  /** A POI category, or "stop" / "rapid" for transit. */
  kind: Category | "stop" | "rapid";
  name: string;
  distanceM: number;
  /** "elementary" / "secondary" for schools. */
  detail: string | null;
};

const row = (
  kind: NearbyRow["kind"],
  name: string,
  distanceM: number,
  detail: string | null = null,
) => ({
  kind,
  name: kind === "stop" || kind === "rapid" ? displayName(stationName(name)) : displayName(name),
  distanceM,
  detail,
});

const schoolLevel = (subcategory: string | null) =>
  subcategory === "elementary" || subcategory === "secondary" ? subcategory : null;

/** The compact list: the nearest place in each category, then the nearest stop and station. */
export function nearestRows(nearby: NearbyResponse): NearbyRow[] {
  const rows = orderedCategories(nearby).map(({ category, places }) =>
    row(category, places[0]!.name, places[0]!.distanceM, schoolLevel(places[0]!.subcategory)),
  );
  const stop = nearby.stops[0];
  if (stop) rows.push(row("stop", stop.name, stop.distanceM));
  if (nearby.nearestRapid)
    rows.push(row("rapid", nearby.nearestRapid.name, nearby.nearestRapid.distanceM));
  return rows;
}

/** Behind "Show more nearby": the other places in each category and the next stops. */
export function moreRows(nearby: NearbyResponse): { kind: NearbyRow["kind"]; rows: NearbyRow[] }[] {
  const groups = orderedCategories(nearby)
    .filter(({ places }) => places.length > 1)
    .map(({ category, places }) => ({
      kind: category as NearbyRow["kind"],
      rows: places
        .slice(1)
        .map((place) => row(category, place.name, place.distanceM, schoolLevel(place.subcategory))),
    }));
  if (nearby.stops.length > 1) {
    groups.push({
      kind: "stop",
      rows: nearby.stops.slice(1, 3).map((stop) => row("stop", stop.name, stop.distanceM)),
    });
  }
  return groups;
}

/** The summary tile: grocery, subway or rail, park — whichever are known. */
export function tileRows(nearby: NearbyResponse): NearbyRow[] {
  const wanted: NearbyRow["kind"][] = ["grocery", "rapid", "park"];
  const rows = nearestRows(nearby);
  return wanted.flatMap((kind) => rows.filter((r) => r.kind === kind));
}
