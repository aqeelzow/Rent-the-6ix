// One listing collection run: `pnpm ingest:once [--sources kijiji,torontorentals] [--pages 5]`.
// Until the database pipeline lands (P1.5–P1.6), results are written to the git-ignored
// apps/worker/.cache/ingest/ as JSON, already scrubbed (description → excerpt).
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { openSession, SourceBlockedError } from "./lib/fetch.ts";
import { excerpt } from "./pipeline/scrub.ts";
import { sources } from "./sources/index.ts";
import type { RawListing, SourceId } from "./sources/types.ts";

export interface SourceRun {
  source: SourceId;
  status: "ok" | "unhealthy" | "error";
  pages: number;
  listings: number;
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
      message: "unknown source",
    });
    continue;
  }
  const run: SourceRun = { source: adapter.id, status: "ok", pages: 0, listings: 0 };
  const rows: (Omit<RawListing, "description"> & { excerpt: string })[] = [];
  const session = await openSession();
  try {
    let cursor: string | null = null;
    do {
      const page = await adapter.fetchIndex(session, cursor);
      for (const { description, ...listing } of page.listings)
        rows.push({ ...listing, excerpt: excerpt(description) });
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
  }
}

await writeFile(
  new URL("last-run.json", outDir),
  JSON.stringify({ finishedAt: new Date().toISOString(), runs }, null, 2),
);
console.table(runs);
if (runs.every((r) => r.status !== "ok")) process.exitCode = 1;
