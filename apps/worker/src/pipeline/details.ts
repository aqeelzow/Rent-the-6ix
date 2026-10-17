// Detail pages (SPEC 8.4 step 1): fetch a listing's own page when it's new or its rent changed,
// and merge what that page adds (full description, amenities) into the index row.
// Patches are cached per source in the git-ignored apps/worker/.cache/details/, with the
// description already scrubbed, so contact details never reach disk.
// The cache stays on disk (full descriptions aren't stored in TigerData, SPEC 8.5; the worker needs a
// persistent volume for it). TigerData records when each listing's page was fetched and at what
// rent (detail_fetched_at / detail_rent_cad, migration 005), for coverage on /status.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Sql } from "postgres";
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

/**
 * Record each cached fetch on its stored listing (detail_fetched_at, detail_rent_cad), in batches;
 * only rows that changed are written. Returns rows updated. No-op before migration 005.
 */
export async function recordDetailFetches(
  sql: Sql,
  source: SourceId,
  cache: DetailCache,
): Promise<number> {
  const [{ ok }] = await sql<{ ok: boolean }[]>`
    SELECT count(*) = 2 AS ok FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name IN ('detail_fetched_at', 'detail_rent_cad')`;
  if (!ok) return 0;
  const entries = Object.entries(cache);
  let updated = 0;
  for (let i = 0; i < entries.length; i += 1_000) {
    const batch = entries.slice(i, i + 1_000);
    updated += (
      await sql`
        UPDATE listings l SET detail_fetched_at = d.at, detail_rent_cad = d.rent
        FROM unnest(${batch.map(([id]) => id)}::text[], ${batch.map(([, e]) => e.fetchedAt)}::timestamptz[],
          ${batch.map(([, e]) => Math.round(e.rent))}::int[]) AS d(id, at, rent)
        WHERE l.source = ${source} AND l.source_listing_id = d.id
          AND (l.detail_fetched_at IS DISTINCT FROM d.at OR l.detail_rent_cad IS DISTINCT FROM d.rent)`
    ).count;
  }
  return updated;
}
