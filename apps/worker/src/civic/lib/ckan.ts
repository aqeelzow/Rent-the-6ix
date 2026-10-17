// CKAN lookups for open.toronto.ca. The portal site answers HTTP 200 for *any* dataset slug,
// including nonsense, so every loader resolves its dataset and download URL here instead of
// trusting a hard-coded link. Resource URLs contain a UUID that changes when the City
// republishes a dataset, so they are resolved on every run (docs/datasets.md).
import { fetchJson } from "./http.ts";

const CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action";

/** The portal-wide terms; CKAN's per-dataset `licence_id` is mostly "notspecified". */
export const CITY_LICENCE = "Open Government Licence – Toronto";

export interface CkanResource {
  name: string;
  url: string;
  format: string;
  /** True when CKAN serves the rows through datastore_search, which supports paging. */
  datastoreActive: boolean;
}

export interface CkanDataset {
  slug: string;
  title: string;
  pageUrl: string;
  resources: CkanResource[];
}

interface PackageShow {
  success: boolean;
  result?: {
    title?: string;
    resources?: {
      name?: string;
      url?: string;
      format?: string;
      datastore_active?: boolean;
    }[];
  };
}

/** Fetch dataset metadata by slug, or throw with a readable message. */
export async function cityDataset(slug: string): Promise<CkanDataset> {
  const body = await fetchJson<PackageShow>(`${CKAN}/package_show?id=${encodeURIComponent(slug)}`);
  if (!body.success || !body.result) throw new Error(`CKAN has no dataset "${slug}"`);
  const resources = (body.result.resources ?? [])
    .filter((r) => Boolean(r.name && r.url && r.format))
    .map((r) => ({
      name: r.name as string,
      url: r.url as string,
      format: r.format as string,
      datastoreActive: r.datastore_active === true,
    }));
  if (resources.length === 0) throw new Error(`dataset "${slug}" has no downloadable resources`);
  return {
    slug,
    title: body.result.title ?? slug,
    pageUrl: `https://open.toronto.ca/dataset/${slug}/`,
    resources,
  };
}

/**
 * The datastore resource id for a named resource. Datastore paging is how the large address
 * file is loaded: the GeoJSON resource is 590 MB and cannot be parsed in memory.
 */
export async function cityDatastoreId(slug: string, name: string): Promise<string> {
  const dataset = await cityDataset(slug);
  const resource = dataset.resources.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (!resource?.datastoreActive) {
    throw new Error(`dataset "${slug}" resource "${name}" is not served by the datastore`);
  }
  const match = /\/datastore\/dump\/([0-9a-f-]{36})/i.exec(resource.url);
  if (!match) throw new Error(`cannot read a datastore id from ${resource.url}`);
  return match[1];
}

/**
 * The download URL of one named resource. Exact name first, then a case-insensitive match so a
 * City rename that only changes capitalisation doesn't break the load. Throws with the list of
 * available names, which is what you need to fix the call.
 */
export async function cityResourceUrl(slug: string, name: string): Promise<string> {
  const dataset = await cityDataset(slug);
  const wanted = name.toLowerCase();
  const match =
    dataset.resources.find((r) => r.name === name) ??
    dataset.resources.find((r) => r.name.toLowerCase() === wanted);
  if (!match) {
    throw new Error(
      `dataset "${slug}" has no resource "${name}"; available: ${dataset.resources
        .map((r) => `${r.name} [${r.format}]`)
        .join(", ")}`,
    );
  }
  return match.url;
}
