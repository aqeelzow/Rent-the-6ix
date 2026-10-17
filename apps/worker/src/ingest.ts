// One listing collection run: `pnpm ingest:once [--sources kijiji,torontorentals] [--pages 5]`.
// Until the database pipeline lands (P1.5–P1.6), normalized listings (scrubbed, description →
// excerpt) are written to the git-ignored apps/worker/.cache/ingest/ as JSON, with field coverage.
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { openSession, SourceBlockedError } from "./lib/fetch.ts";
import { normalize, type NormalizedListing } from "./pipeline/normalize.ts";
import { sources } from "./sources/index.ts";
import type { SourceId } from "./sources/types.ts";

export interface SourceRun {
  source: SourceId;
  status: "ok" | "unhealthy" | "error";
  pages: number;
  listings: number;
  /** Rows normalize dropped (no plausible monthly rent). */
  dropped: number;
  message?: string;
}

const { values } = parseArgs({
  options: {
    sources: { type: "string", default: process.env.INGEST_SOURCES ?? "kijiji,torontorentals" },
    pages: { type: "string", default: process.env.INGEST_MAX_PAGES ?? "3" },
  },
});

const maxPages = Number(values.pages);
const requested = values.sources
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s && s !== "manual");
const outDir = new URL("../.cache/ingest/", import.meta.url);
await mkdir(outDir, { recursive: true });

const runs: SourceRun[] = [];
for (const id of requested) {
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
  const session = await openSession();
  try {
    let cursor: string | null = null;
    do {
      const page = await adapter.fetchIndex(session, cursor);
      for (const raw of page.listings) {
        const listing = normalize(raw);
        if (listing) rows.push(listing);
        else run.dropped++;
      }
      run.pages++;
      cursor = page.nextCursor;
      console.log(`${adapter.id}: page ${run.pages}, ${page.listings.length} listings`);
    } while (cursor && run.pages < maxPages);
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

await writeFile(
  new URL("last-run.json", outDir),
  JSON.stringify({ finishedAt: new Date().toISOString(), runs }, null, 2),
);
console.table(runs);
if (runs.every((r) => r.status !== "ok")) process.exitCode = 1;

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
