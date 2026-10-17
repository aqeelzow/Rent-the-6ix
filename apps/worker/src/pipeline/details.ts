// Detail pages (SPEC 8.4 step 1): fetch a listing's own page when it's new or its rent changed,
// and merge what that page adds (full description, amenities) into the index row.
// Patches are cached per source in the git-ignored apps/worker/.cache/details/, with the
// description already scrubbed, so contact details never reach disk.
// TODO(P1.6): keep this in the database (last detail fetch + rent) once listings are stored there.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { DetailPatch, RawListing, SourceId } from "../sources/types.ts";
import { scrub } from "./scrub.ts";

export interface DetailCacheEntry {
  /** Rent when the page was fetched; a different rent now means the listing changed. */
  rent: number;
  fetchedAt: string;
  patch: DetailPatch;
}

export type DetailCache = Record<string, DetailCacheEntry>;

export function needsDetail(raw: RawListing, cache: DetailCache): boolean {
  const entry = cache[raw.sourceListingId];
  return !entry || entry.rent !== raw.monthlyRentCad;
}

/** The page's values win over the index row's; null means the page doesn't say. */
export function applyPatch(raw: RawListing, patch: DetailPatch): RawListing {
  const out: RawListing = { ...raw };
  for (const [key, value] of Object.entries(patch) as [keyof DetailPatch, unknown][]) {
    if (value === null || value === undefined) continue;
    // The index snippet is a prefix of the full text; keep whichever is longer.
    if (key === "description" && (raw.description?.length ?? 0) >= String(value).length) continue;
    (out as unknown as Record<string, unknown>)[key] = value;
  }
  return out;
}

export function scrubPatch(patch: DetailPatch): DetailPatch {
  return patch.description ? { ...patch, description: scrub(patch.description) } : patch;
}

const CACHE_DIR = new URL("../../.cache/details/", import.meta.url);

/** Cached patches are scrubbed again on load, so scrub rule changes reach old entries too. */
export async function loadDetailCache(source: SourceId): Promise<DetailCache> {
  let cache: DetailCache;
  try {
    cache = JSON.parse(await readFile(new URL(`${source}.json`, CACHE_DIR), "utf8"));
  } catch {
    return {};
  }
  for (const entry of Object.values(cache)) entry.patch = scrubPatch(entry.patch);
  return cache;
}

export async function saveDetailCache(source: SourceId, cache: DetailCache): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(new URL(`${source}.json`, CACHE_DIR), JSON.stringify(cache));
}
