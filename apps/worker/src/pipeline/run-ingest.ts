// One listing collection run over the given sources, used by `pnpm ingest:once` and the schedule.
// Until the database pipeline lands (P1.5–P1.6), normalized listings (scrubbed, description →
// excerpt) are written to the git-ignored apps/worker/.cache/ingest/ as JSON (every 10 index
// pages, then once more with detail pages merged), with field coverage,
// and the run summary to .cache/ingest/last-run.json (the stats /status will show).
import { mkdir, writeFile } from "node:fs/promises";
import { openSession, SourceBlockedError } from "../lib/fetch.ts";
import { sources } from "../sources/index.ts";
import type {
  AdapterId,
  DetailPatch,
  RawListing,
  SourceAdapter,
  SourceId,
} from "../sources/types.ts";
import type { Session } from "../lib/fetch.ts";
import type { Sql } from "postgres";
import { openDb } from "../lib/db.ts";
import {
  applyPatch,
  loadDetailCache,
  needsDetail,
  saveDetailCache,
  scrubPatch,
} from "./details.ts";
import { normalize, type NormalizedListing } from "./normalize.ts";
import { scrub } from "./scrub.ts";
import { dedupeStored } from "./dedupe-store.ts";
import {
  aiText,
  extractFields,
  geminiExtractorFromEnv,
  loadAiCache,
  saveAiCache,
  type Extractor,
} from "./extract.ts";
import { markFreshness, upsertListings } from "./upsert.ts";

export interface SourceRun {
  source: SourceId;
  status: "ok" | "unhealthy" | "error";
  pages: number;
  listings: number;
  /** Rows normalize dropped (no plausible monthly rent). */
  dropped: number;
  /** Detail pages fetched this run (new or changed listings, up to maxDetails). */
  details: number;
  /** Rows written to TigerData (0 when DATABASE_URL isn't set). */
  stored: number;
  /** Listings that gained fields from AI extraction (0 when AI is off). */
  aiFilled: number;
  message?: string;
}

export interface IngestOptions {
  sources: string[];
  maxPages: number;
  /** Detail pages per source per run; each costs one request (INGEST_REQUEST_DELAY_MS). */
  maxDetails: number;
  /** Resume a single-source run from this index cursor (e.g. "55"); first page if absent. */
  cursor?: string;
  /** Listings per source per run sent to AI extraction (cache hits are free). */
  maxAi: number;
}

export interface IngestResult {
  finishedAt: string;
  runs: SourceRun[];
}

// The sources marked "go" in SOURCES.md.
const DEFAULT_SOURCES = "kijiji,torontorentals,zillow,realtor_ca";

/**
 * Ingest options from env (INGEST_SOURCES, INGEST_MAX_PAGES, INGEST_MAX_DETAILS);
 * `manual` is loaded separately.
 */
export function ingestOptionsFromEnv(
  overrides: {
    sources?: string;
    pages?: string;
    details?: string;
    cursor?: string;
    ai?: string;
  } = {},
): IngestOptions {
  const list = overrides.sources ?? process.env.INGEST_SOURCES ?? DEFAULT_SOURCES;
  return {
    sources: list
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "manual"),
    maxPages: Number(overrides.pages ?? process.env.INGEST_MAX_PAGES ?? 3),
    maxDetails: Number(overrides.details ?? process.env.INGEST_MAX_DETAILS ?? 50),
    cursor: overrides.cursor,
    maxAi: Number(overrides.ai ?? process.env.INGEST_MAX_AI ?? 200),
  };
}

export async function runIngest(options: IngestOptions): Promise<IngestResult> {
  const outDir = new URL("../../.cache/ingest/", import.meta.url);
  await mkdir(outDir, { recursive: true });
  // With DATABASE_URL, every checkpoint and the final rows are also upserted into TigerData.
  const db = openDb();
  // With AI_PROVIDER=gemini, a key and a model, unknown fields are read from descriptions.
  const extractor = geminiExtractorFromEnv();

  const runs: SourceRun[] = [];
  for (const id of options.sources) {
    const adapter = sources[id as AdapterId] as SourceAdapter | undefined;
    if (!adapter) {
      runs.push({
        source: id as SourceId,
        status: "error",
        pages: 0,
        listings: 0,
        dropped: 0,
        details: 0,
        stored: 0,
        aiFilled: 0,
        message: "unknown source",
      });
      continue;
    }
    const run: SourceRun = {
      source: adapter.id,
      status: "ok",
      pages: 0,
      listings: 0,
      dropped: 0,
      details: 0,
      stored: 0,
      aiFilled: 0,
    };
    const raws: RawListing[] = [];
    // Featured listings repeat on later index pages (torontorentals); keep the first copy.
    const seen = new Set<string>();
    // One file per source per run, rewritten every few pages so a crash or stop loses little.
    // The run's start time is also when its listings count as seen.
    const observedAt = new Date().toISOString();
    const file = new URL(`${adapter.id}-${observedAt.replace(/[:.]/g, "-")}.json`, outDir);
    const save = async (rows: NormalizedListing[]) => {
      await writeRows(file, rows);
      if (db) run.stored = await store(db, adapter.id, rows, observedAt);
    };
    const session = await openSession();
    try {
      let cursor: string | null = options.cursor ?? null;
      do {
        const page = await fetchIndexWithRetry(adapter, session, cursor);
        for (const raw of page.listings) {
          if (seen.has(raw.sourceListingId)) continue;
          seen.add(raw.sourceListingId);
          raws.push(raw);
        }
        run.pages++;
        cursor = page.nextCursor;
        console.log(`${adapter.id}: page ${run.pages}, ${page.listings.length} listings`);
        if (run.pages % CHECKPOINT_PAGES === 0) await save(normalizeAll(raws).rows);
      } while (cursor && run.pages < options.maxPages);
      await addDetails(adapter, session, raws, options.maxDetails, run);
    } catch (error) {
      run.status = error instanceof SourceBlockedError ? "unhealthy" : "error";
      run.message = error instanceof Error ? error.message : String(error);
      console.error(`${adapter.id}: ${run.status}: ${run.message}`);
    } finally {
      await session.close();
    }
    const normalized = normalizeAll(raws);
    const rows = extractor
      ? await addExtraction(extractor, normalized.rows, raws, options.maxAi, run)
      : normalized.rows;
    const dropped = normalized.dropped;
    run.dropped = dropped;
    run.listings = rows.length;
    runs.push(run);
    if (rows.length) {
      await save(rows);
      console.log(`${adapter.id}: wrote ${rows.length} listings to ${file.pathname}`);
      if (db) console.log(`${adapter.id}: ${run.stored} listings in TigerData`);
      console.log(`${adapter.id}: field coverage ${coverage(rows)}`);
    }
    if (db) await recordRun(db, run, observedAt);
  }

  if (db) {
    try {
      console.log(`freshness: ${await markFreshness(db, new Date())} listings changed status`);
      const dedupe = await dedupeStored(db);
      console.log(`dedupe: ${dedupe.duplicates} of ${dedupe.listings} listings are duplicates`);
    } finally {
      await db.end();
    }
  }
  const result = { finishedAt: new Date().toISOString(), runs };
  await writeFile(new URL("last-run.json", outDir), JSON.stringify(result, null, 2));
  return result;
}

/** One ingest_runs row per source (migration 006), for /status; skipped until the table exists. */
async function recordRun(db: Sql, run: SourceRun, startedAt: string): Promise<void> {
  try {
    const [{ exists }] = await db<{ exists: boolean }[]>`
      SELECT to_regclass('ingest_runs') IS NOT NULL AS exists`;
    if (!exists) return;
    await db`
      INSERT INTO ingest_runs (source, started_at, finished_at, status, pages, listings, dropped,
        details, stored, message)
      VALUES (${run.source}, ${startedAt}, now(), ${run.status}, ${run.pages}, ${run.listings},
        ${run.dropped}, ${run.details}, ${run.stored}, ${run.message ?? null})`;
  } catch (error) {
    console.error(
      `${run.source}: ingest_runs insert failed: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/** A database error is logged, not fatal: the JSON file still has the run. */
async function store(
  db: Sql,
  source: SourceId,
  rows: NormalizedListing[],
  observedAt: string,
): Promise<number> {
  try {
    return (await upsertListings(db, rows, observedAt)).written;
  } catch (error) {
    console.error(
      `${source}: TigerData upsert failed: ${error instanceof Error ? error.message : error}`,
    );
    return 0;
  }
}

const INDEX_ATTEMPTS = 3;

/**
 * A page whose results arrive late ("no results response") is tried again before the source is
 * given up; a block never is.
 */
async function fetchIndexWithRetry(
  adapter: SourceAdapter,
  session: Session,
  cursor: string | null,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await adapter.fetchIndex(session, cursor);
    } catch (error) {
      if (error instanceof SourceBlockedError || attempt >= INDEX_ATTEMPTS) throw error;
      console.error(
        `${adapter.id}: retrying index page (${attempt}/${INDEX_ATTEMPTS - 1}): ${String(error)}`,
      );
    }
  }
}

/** Rewrite the source's file every this many index pages. */
const CHECKPOINT_PAGES = 10;

function normalizeAll(raws: RawListing[]): { rows: NormalizedListing[]; dropped: number } {
  const rows: NormalizedListing[] = [];
  let dropped = 0;
  for (const raw of raws) {
    const listing = normalize(raw);
    if (listing) rows.push(listing);
    else dropped++;
  }
  return { rows, dropped };
}

async function writeRows(file: URL, rows: NormalizedListing[]): Promise<void> {
  await writeFile(file, JSON.stringify(rows, null, 2));
}

const MAX_DETAIL_FAILURES = 3;

/**
 * Fetch detail pages for new or changed listings (up to `max`), cache the scrubbed patches, and
 * merge every cached patch into its row. A block stops detail fetches for the source; the index
 * rows are kept.
 */
async function addDetails(
  adapter: SourceAdapter,
  session: Session,
  raws: RawListing[],
  max: number,
  run: SourceRun,
): Promise<void> {
  if (!adapter.fetchDetail) return;
  const cache = await loadDetailCache(adapter.id);
  // Building cards share one page (Zillow): fetch each URL once per run.
  const byUrl = new Map<string, DetailPatch>();
  let failures = 0;
  try {
    for (const raw of raws) {
      if (run.details >= max) break;
      if (!needsDetail(raw, cache)) continue;
      let patch = byUrl.get(raw.sourceUrl);
      if (!patch) {
        try {
          patch = scrubPatch(await adapter.fetchDetail(session, raw));
          run.details++;
          failures = 0;
        } catch (error) {
          if (error instanceof SourceBlockedError) throw error;
          if (++failures >= MAX_DETAIL_FAILURES) throw error;
          continue;
        }
        byUrl.set(raw.sourceUrl, patch);
      }
      cache[raw.sourceListingId] = {
        rent: raw.monthlyRentCad,
        fetchedAt: new Date().toISOString(),
        patch,
      };
    }
  } catch (error) {
    run.message = `details stopped: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`${adapter.id}: ${run.message}`);
  } finally {
    await saveDetailCache(adapter.id, cache);
  }
  for (let i = 0; i < raws.length; i++) {
    const entry = cache[raws[i].sourceListingId];
    if (entry) raws[i] = applyPatch(raws[i], entry.patch);
  }
  console.log(`${adapter.id}: ${run.details} detail pages fetched`);
}

/**
 * AI extraction over the full descriptions (rows keep only an excerpt). A rate limit or error
 * stops it for this source; rows keep their rule-based values.
 */
async function addExtraction(
  extractor: Extractor,
  rows: NormalizedListing[],
  raws: RawListing[],
  max: number,
  run: SourceRun,
): Promise<NormalizedListing[]> {
  const rawById = new Map(raws.map((r) => [r.sourceListingId, r]));
  const cache = await loadAiCache();
  try {
    const { targets, stats } = await extractFields(
      rows,
      (i) => {
        const raw = rawById.get(rows[i].sourceListingId);
        // Scrubbed like stored text: contact details never reach the model.
        return aiText(rows[i].title, raw?.description ? scrub(raw.description) : rows[i].excerpt);
      },
      { extractor, cache, max, today: new Date().toISOString().slice(0, 10) },
    );
    run.aiFilled = stats.filled;
    const fields = Object.entries(stats.fields)
      .map(([f, n]) => `${f} ${n}`)
      .join(", ");
    console.log(
      `${run.source}: AI read ${stats.sent} of ${stats.candidates} listings with gaps, filled ${stats.filled} (${fields || "none"})`,
    );
    if (stats.stopped) console.error(`${run.source}: AI extraction stopped: ${stats.stopped}`);
    return targets;
  } finally {
    await saveAiCache(cache);
  }
}

/** Share of rows with a known value per field, e.g. "sqft 31%, yearBuilt 0%, ...". */
function coverage(rows: NormalizedListing[]): string {
  const known: Record<string, (r: NormalizedListing) => boolean> = {
    bedrooms: (r) => r.bedrooms !== null,
    bathrooms: (r) => r.bathrooms !== null,
    unitType: (r) => r.unitType !== null,
    sqft: (r) => r.sqft !== null,
    yearBuilt: (r) => r.yearBuilt !== null,
    airConditioning: (r) => r.airConditioning !== "unknown",
    utilitiesIncluded: (r) => r.utilitiesIncluded !== "unknown",
    parking: (r) => r.parking !== "unknown",
    petsAllowed: (r) => r.petsAllowed !== "unknown",
    furnished: (r) => r.furnished !== "unknown",
    laundryInSuite: (r) => r.laundryInSuite !== "unknown",
    availableFrom: (r) => r.availableFrom !== null,
    leaseTerm: (r) => r.leaseTerm !== null,
    location: (r) => r.sourceLocation !== null,
  };
  return Object.entries(known)
    .map(([field, has]) => `${field} ${Math.round((rows.filter(has).length / rows.length) * 100)}%`)
    .join(", ");
}
