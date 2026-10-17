// P1.13 — points of interest for travel targets and the "nearby" panel.
//
// City of Toronto is authoritative for civic facilities (libraries, parks, community centres,
// schools, universities); OpenStreetMap fills the commercial categories the City does not publish
// (supermarkets, pharmacies, clinics). `category` must stay inside the CHECK constraint on `pois`,
// and `subcategory` carries the finer distinction the engine needs (elementary vs secondary).
import type { Sql } from "postgres";
import { cityDataset, cityResourceUrl, CITY_LICENCE } from "./lib/ckan.ts";
import { fetchJson, postFormJson } from "./lib/http.ts";
import { upsertSource } from "./sources.ts";

type Category =
  | "grocery"
  | "school"
  | "university"
  | "library"
  | "park"
  | "community_centre"
  | "pharmacy"
  | "clinic";

interface PoiRow {
  id: string;
  category: Category;
  subcategory: string | null;
  name: string;
  location: string;
  source_id: string;
}

interface CityFeature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates?: unknown } | null;
}

interface FeatureCollection {
  type: string;
  features?: CityFeature[];
}

const LIBRARIES = {
  sourceId: "library-branch-general-information",
  slug: "library-branch-general-information",
  resource: "tpl-branch-general-information - 4326.geojson",
};
const PARKS = {
  sourceId: "parks-and-recreation-facilities",
  slug: "parks-and-recreation-facilities",
  resource: "Parks and Recreation Facilities - 4326.geojson",
};
const SCHOOLS = {
  sourceId: "school-locations-all-types",
  slug: "school-locations-all-types",
  resource: "School locations-all types data - 4326.geojson",
};

/** Toronto bounding box, south,west,north,east — the OSM query is limited to the city. */
const TORONTO_BBOX = "43.58,-79.64,43.86,-79.12";

async function cityFeatures(
  sql: Sql,
  ref: { sourceId: string; slug: string; resource: string },
): Promise<{ features: CityFeature[]; resourceUrl: string }> {
  const meta = await cityDataset(ref.slug);
  const url = await cityResourceUrl(ref.slug, ref.resource);
  const body = await fetchJson<FeatureCollection>(url);
  if (body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    throw new Error(`${ref.slug}: expected a GeoJSON FeatureCollection`);
  }
  await upsertSource(sql, {
    id: ref.sourceId,
    title: meta.title,
    url: meta.pageUrl,
    licence: CITY_LICENCE,
    note: url,
  });
  return { features: body.features, resourceUrl: url };
}

/**
 * The City's facility layers publish single-point features as `MultiPoint`, not `Point`, so the
 * coordinate pair is one level deeper than it looks. Multi-point features here always hold one
 * point; if that ever changes, the first is the building itself and the rest are entrances.
 */
function pointLocation(feature: CityFeature): string | null {
  const geometry = feature.geometry;
  if (!geometry) return null;
  let coordinates = geometry.coordinates;
  if (geometry.type === "MultiPoint" || geometry.type === "Point") {
    if (Array.isArray(coordinates) && Array.isArray(coordinates[0])) coordinates = coordinates[0];
  } else {
    return null;
  }
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lng, lat] = coordinates as number[];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/**
 * The City's SCHOOL_LEVEL field is "None" for every row, so the distinction comes from the name.
 * Secondary first: "AGINCOURT COLLEGIATE INSTITUTE" also contains no elementary marker, but a
 * name like "JR PUBLIC SCHOOL" would otherwise match both.
 */
function schoolLevel(name: string): "secondary" | "elementary" | null {
  const upper = name.toUpperCase();
  if (/SECONDARY|COLLEGIATE|HIGH SCHOOL|\bHS\b/.test(upper)) return "secondary";
  if (/PUBLIC SCHOOL|ELEMENTARY|JUNIOR|\bJR\b|MIDDLE|\bMDL\b/.test(upper)) return "elementary";
  return null;
}

function libraryRows(features: CityFeature[]): PoiRow[] {
  const rows: PoiRow[] = [];
  for (const feature of features) {
    const p = feature.properties;
    const code = String(p.BranchCode ?? "").trim();
    const name = String(p.BranchName ?? "").trim();
    const location = pointLocation(feature);
    if (!code || !name || !location) continue;
    rows.push({
      id: `tpl:${code}`,
      category: "library",
      subcategory: null,
      name,
      location,
      source_id: LIBRARIES.sourceId,
    });
  }
  return rows;
}

function parkRows(features: CityFeature[]): PoiRow[] {
  const rows: PoiRow[] = [];
  for (const feature of features) {
    const p = feature.properties;
    const type = String(p.TYPE ?? "");
    const category: Category | null =
      type === "Park" ? "park" : type === "Community Centre" || type === "Civic Centre" ? "community_centre" : null;
    const id = String(p.ASSET_ID ?? "").trim();
    const name = String(p.ASSET_NAME ?? "").trim();
    const location = pointLocation(feature);
    if (!category || !id || !name || !location) continue;
    rows.push({
      id: `park:${id}`,
      category,
      subcategory: type,
      name,
      location,
      source_id: PARKS.sourceId,
    });
  }
  return rows;
}

function schoolRows(features: CityFeature[]): PoiRow[] {
  const rows: PoiRow[] = [];
  for (const feature of features) {
    const p = feature.properties;
    const id = String(p.OBJECTID ?? "").trim();
    const name = String(p.NAME ?? "").trim();
    const typeDesc = String(p.SCHOOL_TYPE_DESC ?? "");
    const location = pointLocation(feature);
    if (!id || !name || !location) continue;
    const isPostSecondary = typeDesc === "University" || typeDesc === "College";
    rows.push({
      id: `school:${id}`,
      category: isPostSecondary ? "university" : "school",
      subcategory: isPostSecondary ? typeDesc.toLowerCase() : schoolLevel(name),
      name,
      location,
      source_id: SCHOOLS.sourceId,
    });
  }
  return rows;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  osm3s?: { timestamp_osm_base?: string };
}

async function osmRows(sql: Sql): Promise<PoiRow[]> {
  const query = `[out:json][timeout:120];
(
  node["shop"~"^(supermarket|greengrocer|grocery)$"](${TORONTO_BBOX});
  way["shop"~"^(supermarket|greengrocer|grocery)$"](${TORONTO_BBOX});
  node["amenity"="pharmacy"](${TORONTO_BBOX});
  way["amenity"="pharmacy"](${TORONTO_BBOX});
  node["amenity"~"^(clinic|doctors)$"](${TORONTO_BBOX});
  way["amenity"~"^(clinic|doctors)$"](${TORONTO_BBOX});
);
out center tags;`;

  const body = await postFormJson<OverpassResponse>(
    "https://overpass-api.de/api/interpreter",
    `data=${encodeURIComponent(query)}`,
  );
  const elements = body.elements ?? [];
  const rows: PoiRow[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!name || lat === undefined || lon === undefined) continue;
    const category: Category | null =
      tags.amenity === "pharmacy"
        ? "pharmacy"
        : tags.amenity === "clinic" || tags.amenity === "doctors"
          ? "clinic"
          : tags.shop && /^(supermarket|greengrocer|grocery)$/.test(tags.shop)
            ? "grocery"
            : null;
    if (!category) continue;
    rows.push({
      id: `osm:${element.type}/${element.id}`,
      category,
      subcategory: category === "grocery" ? (tags.shop ?? null) : (tags.amenity ?? null),
      name,
      location: `SRID=4326;POINT(${lon} ${lat})`,
      source_id: "openstreetmap",
    });
  }

  await upsertSource(sql, {
    id: "openstreetmap",
    title: "OpenStreetMap — Overpass API",
    url: "https://www.openstreetmap.org/copyright",
    licence: "ODbL 1.0",
    period: body.osm3s?.timestamp_osm_base?.slice(0, 10) ?? null,
    note: `Overpass bbox ${TORONTO_BBOX}; © OpenStreetMap contributors`,
  });
  return rows;
}

export interface PoiLoad {
  written: number;
  byCategory: Record<string, number>;
}

export async function loadPois(sql: Sql): Promise<PoiLoad> {
  const libraries = await cityFeatures(sql, LIBRARIES);
  const parks = await cityFeatures(sql, PARKS);
  const schools = await cityFeatures(sql, SCHOOLS);
  const candidates: PoiRow[] = [
    ...libraryRows(libraries.features),
    ...parkRows(parks.features),
    ...schoolRows(schools.features),
    ...(await osmRows(sql)),
  ];

  // The City's asset layers list one row per amenity for the same asset id, and Postgres refuses
  // an ON CONFLICT batch that touches one row twice, so duplicates are collapsed here (first wins)
  // and reported — a sudden spike means the id choice for that layer is wrong.
  const byId = new Map<string, PoiRow>();
  for (const row of candidates) if (!byId.has(row.id)) byId.set(row.id, row);
  const rows = [...byId.values()];

  console.log(
    `  pois: ${rows.length} rows from ${new Set(rows.map((r) => r.source_id)).size} sources (${candidates.length - rows.length} duplicate ids collapsed)`,
  );
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

  const counts = await sql<{ category: string; count: number }[]>`
    select category, count(*)::int as count from pois group by category order by category
  `;
  const byCategory: Record<string, number> = {};
  for (const row of counts) byCategory[row.category] = row.count;
  return { written: rows.length, byCategory };
}
