// Points of interest for travel targets ("close to groceries") and the listing page's "nearby"
// panel, in and around the City of Waterloo.
//
// Everything comes from OpenStreetMap (Overpass API): its Waterloo coverage has every category
// we need, so one query replaces Toronto's mix of City open data and OSM. The box reaches a few
// km past the City line, so a listing near the edge finds the grocery store across it in
// Kitchener. `category` must stay inside the CHECK constraint on `pois`; `subcategory` carries
// the finer distinction the engine needs (elementary vs secondary school).
import type { Sql } from "postgres";
import { postFormJson } from "./lib/http.ts";
import { upsertSource } from "./sources.ts";

export type Category =
  | "grocery"
  | "school"
  | "university"
  | "library"
  | "park"
  | "community_centre"
  | "pharmacy"
  | "clinic";

export interface PoiRow {
  id: string;
  category: Category;
  subcategory: string | null;
  name: string;
  location: string;
  source_id: string;
}

/**
 * The City of Waterloo's extent (-80.626, 43.432, -80.467, 43.532) plus about 3 km on every side,
 * as Overpass wants it: south,west,north,east.
 */
export const WATERLOO_BBOX = "43.40,-80.67,43.56,-80.42";

const SOURCE_ID = "openstreetmap";

/** A load with fewer rows than this is a failed or truncated query, not Waterloo. */
const MIN_ROWS = 100;

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  /** A relation's parts with their shapes (`out geom`). */
  members?: { type: string; role?: string; geometry?: { lat: number; lon: number }[] }[];
}

interface OverpassResponse {
  elements?: OverpassElement[];
  osm3s?: { timestamp_osm_base?: string };
}

/** The OSM tags each category is read from. Convenience stores aren't groceries. */
const SELECTORS = [
  `["shop"~"^(supermarket|greengrocer|grocery)$"]`,
  `["amenity"="pharmacy"]`,
  `["amenity"~"^(clinic|doctors)$"]`,
  `["leisure"="park"]`,
  `["amenity"="school"]`,
  `["amenity"~"^(university|college)$"]`,
  `["amenity"="library"]`,
  `["amenity"="community_centre"]`,
];

/**
 * Nodes and ways come with a point (`out center`). Relations come with their parts' shapes
 * (`out geom`) instead: a relation's centre is the middle of its bounding box, which for a
 * campus in several pieces (the University of Waterloo's main campus, north campus and
 * downtown Kitchener and Stratford sites) lands in a field kilometres from any of them.
 */
export function overpassQuery(bbox = WATERLOO_BBOX): string {
  const lines = (kinds: string[]) =>
    kinds.flatMap((kind) => SELECTORS.map((selector) => `  ${kind}${selector}(${bbox});`));
  return [
    "[out:json][timeout:180];",
    `(\n${lines(["node", "way"]).join("\n")}\n);`,
    "out center tags;",
    `(\n${lines(["relation"]).join("\n")}\n);`,
    "out body geom;",
  ].join("\n");
}

/**
 * Campuses whose OSM shape is several far-apart pieces, placed at their main campus instead: the
 * nearest piece of the University of Waterloo is often a parcel south of University Avenue or the
 * north campus research lands, not where students go. (Davis Centre / Student Life Centre.)
 */
export const CAMPUS_ANCHORS: Record<string, { lat: number; lon: number }> = {
  "University of Waterloo": { lat: 43.4723, lon: -80.5449 },
};

/** A relation part smaller than this (about 1 ha) is a parcel, not a place of its own. */
const MIN_PART_AREA = 1e-6;
const [SOUTH, WEST, NORTH, EAST] = WATERLOO_BBOX.split(",").map(Number) as [
  number,
  number,
  number,
  number,
];

/**
 * A relation's outer parts as points, each at its own centroid, inside the box and large enough to
 * count. One point per part means "nearest university" finds the nearest part of the campus.
 */
export function relationParts(element: OverpassElement): { lat: number; lon: number }[] {
  const parts: { lat: number; lon: number }[] = [];
  for (const member of element.members ?? []) {
    const ring = member.geometry;
    if (member.type !== "way" || member.role === "inner" || !ring || ring.length < 4) continue;
    let area = 0;
    let lat = 0;
    let lon = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      const cross = a.lon * b.lat - b.lon * a.lat;
      area += cross;
      lon += (a.lon + b.lon) * cross;
      lat += (a.lat + b.lat) * cross;
    }
    if (Math.abs(area / 2) < MIN_PART_AREA) continue;
    // OSM's own precision, 7 decimals (about 1 cm).
    const round = (value: number) => Number(value.toFixed(7));
    const centroid = { lat: round(lat / (3 * area)), lon: round(lon / (3 * area)) };
    if (centroid.lat < SOUTH || centroid.lat > NORTH || centroid.lon < WEST || centroid.lon > EAST)
      continue;
    parts.push(centroid);
  }
  return parts;
}

/**
 * Elementary or secondary, from OSM's `isced:level` (1 = elementary, 2–3 = secondary) or else the
 * name. Secondary first: "Waterloo Collegiate Institute" has no elementary marker, but a name like
 * "JR PUBLIC SCHOOL" would otherwise match both.
 */
export function schoolLevel(name: string, isced?: string): "secondary" | "elementary" | null {
  if (isced) {
    const levels = isced.split(/[;,-]/).map((level) => Number(level.trim()));
    if (levels.some((level) => level === 2 || level === 3)) return "secondary";
    if (levels.some((level) => level === 1 || level === 0)) return "elementary";
  }
  const upper = name.toUpperCase();
  if (/SECONDARY|COLLEGIATE|HIGH SCHOOL|\bHS\b/.test(upper)) return "secondary";
  if (/PUBLIC SCHOOL|ELEMENTARY|JUNIOR|\bJR\b|MIDDLE|\bMDL\b|CATHOLIC SCHOOL/.test(upper)) {
    return "elementary";
  }
  return null;
}

/**
 * One OSM element as POI rows: one for a node or way, one per part for a relation (ids suffixed
 * "#1", "#2"…). Empty when it's unnamed, unplaced or not one of ours.
 */
export function poiRows(element: OverpassElement): PoiRow[] {
  const anchor = CAMPUS_ANCHORS[element.tags?.name?.trim() ?? ""];
  if (anchor) {
    // One point at the heart of the main campus, whatever shape OSM gives it.
    const row = poiRow({ ...element, lat: anchor.lat, lon: anchor.lon });
    return row ? [row] : [];
  }
  if (element.type !== "relation") {
    const row = poiRow(element);
    return row ? [row] : [];
  }
  return relationParts(element).flatMap((part, i) => {
    const row = poiRow({ ...element, center: part });
    return row ? [{ ...row, id: `${row.id}#${i + 1}` }] : [];
  });
}

/** One OSM element as a POI row, or null when it's unnamed, unplaced or not one of ours. */
export function poiRow(element: OverpassElement): PoiRow | null {
  const tags = element.tags ?? {};
  const name = tags.name?.trim();
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!name || lat === undefined || lon === undefined) return null;
  let category: Category;
  let subcategory: string | null = null;
  if (tags.shop && /^(supermarket|greengrocer|grocery)$/.test(tags.shop)) {
    category = "grocery";
    subcategory = tags.shop;
  } else if (tags.amenity === "pharmacy") category = "pharmacy";
  else if (tags.amenity === "clinic" || tags.amenity === "doctors") {
    category = "clinic";
    subcategory = tags.amenity;
  } else if (tags.amenity === "university" || tags.amenity === "college") {
    category = "university";
    subcategory = tags.amenity;
  } else if (tags.amenity === "school") {
    category = "school";
    subcategory = schoolLevel(name, tags["isced:level"]);
  } else if (tags.amenity === "library") category = "library";
  else if (tags.amenity === "community_centre") category = "community_centre";
  else if (tags.leisure === "park") category = "park";
  else return null;
  return {
    id: `osm:${element.type}/${element.id}`,
    category,
    subcategory,
    name,
    location: `SRID=4326;POINT(${lon} ${lat})`,
    source_id: SOURCE_ID,
  };
}

export interface PoiLoad {
  written: number;
  removed: number;
  byCategory: Record<string, number>;
}

export async function loadPois(sql: Sql): Promise<PoiLoad> {
  const body = await postFormJson<OverpassResponse>(
    "https://overpass-api.de/api/interpreter",
    `data=${encodeURIComponent(overpassQuery())}`,
  );
  // An element can match two selectors (a park that's also a community centre); first wins.
  const byId = new Map<string, PoiRow>();
  for (const element of body.elements ?? []) {
    for (const row of poiRows(element)) if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const rows = [...byId.values()];
  if (rows.length < MIN_ROWS) {
    throw new Error(`pois: only ${rows.length} rows from Overpass; keeping the current table`);
  }

  await upsertSource(sql, {
    id: SOURCE_ID,
    title: "OpenStreetMap — Overpass API",
    url: "https://www.openstreetmap.org/copyright",
    licence: "ODbL 1.0",
    period: body.osm3s?.timestamp_osm_base?.slice(0, 10) ?? null,
    note: `Overpass bbox ${WATERLOO_BBOX}; © OpenStreetMap contributors`,
  });

  // 500 rows per statement keeps the parameter count well inside Postgres' limit.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      insert into pois ${sql(chunk, "id", "category", "subcategory", "name", "location", "source_id")}
      on conflict (id) do update set
        category = excluded.category,
        subcategory = excluded.subcategory,
        name = excluded.name,
        location = excluded.location,
        source_id = excluded.source_id,
        updated_at = now()
    `;
  }
  // Places gone from OSM (and any earlier source's rows) leave with this load.
  const removed = (await sql`delete from pois where not (id = any(${rows.map((row) => row.id)}))`)
    .count;

  const counts = await sql<{ category: string; count: number }[]>`
    select category, count(*)::int as count from pois group by category order by category
  `;
  const byCategory: Record<string, number> = {};
  for (const row of counts) byCategory[row.category] = row.count;
  return { written: rows.length, removed, byCategory };
}
