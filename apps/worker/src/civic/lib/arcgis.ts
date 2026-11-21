// City of Waterloo open data is published as ArcGIS Online hosted feature layers, not CKAN.
// A layer's `query` endpoint serves GeoJSON in WGS84 (`outSR=4326`), at most `maxRecordCount`
// features per request, so `queryAll` pages with resultOffset until the layer says it's done.
import { fetchJson } from "./http.ts";

/** The City of Waterloo's ArcGIS Online organisation (owner `OpenData_Waterloo`). */
export const WATERLOO_SERVICES =
  "https://services.arcgis.com/ZpeBVw5o1kjit7LT/ArcGIS/rest/services";
// The items on ArcGIS Online carry no licence text; the City's open data portal publishes them
// under its open government licence. Confirm the exact wording in #3 before launch.
export const WATERLOO_LICENCE = "Open Government Licence – City of Waterloo";

/** The human page for an ArcGIS Online item (what `sources.url` should point to). */
export function itemPageUrl(itemId: string): string {
  return `https://www.arcgis.com/home/item.html?id=${itemId}`;
}

/** `<services>/<name>/FeatureServer/<layer>` */
export function layerUrl(service: string, layer = 0): string {
  return `${WATERLOO_SERVICES}/${service}/FeatureServer/${layer}`;
}

export interface GeoJsonFeature<P = Record<string, unknown>> {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: P;
}

interface GeoJsonPage<P> {
  type?: string;
  features?: GeoJsonFeature<P>[];
  properties?: { exceededTransferLimit?: boolean };
  error?: { code?: number; message?: string };
}

export interface QueryOptions {
  where?: string;
  outFields?: string[];
  /** A field with a unique value per feature, so pages never overlap or skip. */
  orderBy: string;
  pageSize?: number;
  /** Called after each page with the running total. */
  onPage?: (fetched: number) => void;
}

type Fetch = <T>(url: string) => Promise<T>;

/** Every feature of a layer as WGS84 GeoJSON, paged. */
export async function queryAll<P = Record<string, unknown>>(
  layer: string,
  options: QueryOptions,
  fetch: Fetch = fetchJson,
): Promise<GeoJsonFeature<P>[]> {
  const pageSize = options.pageSize ?? 2000;
  const features: GeoJsonFeature<P>[] = [];
  for (;;) {
    const params = new URLSearchParams({
      where: options.where ?? "1=1",
      outFields: options.outFields?.join(",") ?? "*",
      orderByFields: options.orderBy,
      resultOffset: String(features.length),
      resultRecordCount: String(pageSize),
      outSR: "4326",
      f: "geojson",
    });
    const page = await fetch<GeoJsonPage<P>>(`${layer}/query?${params}`);
    if (page.error) {
      throw new Error(`arcgis: ${page.error.message ?? "query failed"} at ${layer}`);
    }
    if (page.type !== "FeatureCollection" || !Array.isArray(page.features)) {
      throw new Error(`arcgis: expected a GeoJSON FeatureCollection from ${layer}`);
    }
    features.push(...page.features);
    options.onPage?.(features.length);
    // Hosted layers flag a truncated page; an empty page also ends it, in case a server doesn't.
    if (!page.properties?.exceededTransferLimit || page.features.length === 0) return features;
  }
}
