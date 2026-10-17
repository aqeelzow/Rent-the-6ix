// One listing collection run over the given sources, used by `pnpm ingest:once` and the schedule.
// Until the database pipeline lands (P1.5–P1.6), normalized listings (scrubbed, description →
// excerpt) are written to the git-ignored apps/worker/.cache/ingest/ as JSON, with field coverage,
// and the run summary to .cache/ingest/last-run.json (the stats /status will show).
import { mkdir, writeFile } from "node:fs/promises";
import { openSession, SourceBlockedError } from "../lib/fetch.ts";
import { sources } from "../sources/index.ts";
import type { SourceId } from "../sources/types.ts";
import { normalize, type NormalizedListing } from "./normalize.ts";

export interface SourceRun {
  source: SourceId;
  status: "ok" | "unhealthy" | "error";
  pages: number;
  listings: number;
  /** Rows normalize dropped (no plausible monthly rent). */
  dropped: number;
  message?: string;
}

export interface IngestOptions {
  sources: string[];
  maxPages: number;
}

export interface IngestResult {
  finishedAt: string;
  runs: SourceRun[];
}

// The sources marked "go" in SOURCES.md.
const DEFAULT_SOURCES = "kijiji,torontorentals,zillow,realtor_ca";

/** Ingest options from env (INGEST_SOURCES, INGEST_MAX_PAGES); `manual` is loaded separately. */
export function ingestOptionsFromEnv(
  overrides: { sources?: string; pages?: string } = {},
): IngestOptions {
  const list = overrides.sources ?? process.env.INGEST_SOURCES ?? DEFAULT_SOURCES;
  return {
    sources: list
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "manual"),
    maxPages: Number(overrides.pages ?? process.env.INGEST_MAX_PAGES ?? 3),
  };
}

export async function runIngest(options: IngestOptions): Promise<IngestResult> {
  const outDir = new URL("../../.cache/ingest/", import.meta.url);
  await mkdir(outDir, { recursive: true });

  const runs: SourceRun[] = [];
  for (const id of options.sources) {
    const adapter = sources[id as SourceId];
    if (!adapter) {
      runs.push({
        source: id as SourceId,
        status: "error",
        pages: 0,
        listings: 0,
        dropped: 0,
        message: "unknown source",
      });
      continue;
    }
    const run: SourceRun = { source: adapter.id, status: "ok", pages: 0, listings: 0, dropped: 0 };
    const rows: NormalizedListing[] = [];
    // Featured listings repeat on later index pages (torontorentals); keep the first copy.
    const seen = new Set<string>();
    const session = await openSession();
    try {
      let cursor: string | null = null;
      do {
        const page = await adapter.fetchIndex(session, cursor);
        for (const raw of page.listings) {
          if (seen.has(raw.sourceListingId)) continue;
          seen.add(raw.sourceListingId);
          const listing = normalize(raw);
          if (listing) rows.push(listing);
          else run.dropped++;
        }
        run.pages++;
        cursor = page.nextCursor;
        console.log(`${adapter.id}: page ${run.pages}, ${page.listings.length} listings`);
      } while (cursor && run.pages < options.maxPages);
    } catch (error) {
      run.status = error instanceof SourceBlockedError ? "unhealthy" : "error";
      run.message = error instanceof Error ? error.message : String(error);
      console.error(`${adapter.id}: ${run.status}: ${run.message}`);
    } finally {
      await session.close();
    }
    run.listings = rows.length;
    runs.push(run);
    if (rows.length) {
      const file = new URL(
        `${adapter.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        outDir,
      );
      await writeFile(file, JSON.stringify(rows, null, 2));
      console.log(`${adapter.id}: wrote ${rows.length} listings to ${file.pathname}`);
      console.log(`${adapter.id}: field coverage ${coverage(rows)}`);
    }
  }

  const result = { finishedAt: new Date().toISOString(), runs };
  await writeFile(new URL("last-run.json", outDir), JSON.stringify(result, null, 2));
  return result;
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
