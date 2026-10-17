// Load ingest JSON files into TigerData: `pnpm --filter worker load:cache [file …]`.
// With no files, loads the newest file per source in .cache/ingest/. Each row is upserted as seen
// at the time in the file name (kijiji-2026-10-17T04-40-09-143Z.json), then freshness is updated.
import { readdir, readFile } from "node:fs/promises";
import { openDb } from "./lib/db.ts";
import type { NormalizedListing } from "./pipeline/normalize.ts";
import { markFreshness, upsertListings } from "./pipeline/upsert.ts";

const dir = new URL("../.cache/ingest/", import.meta.url);
const STAMP = /^([a-z_]+)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/;

const sql = openDb();
if (!sql) {
  console.error("DATABASE_URL is not set (repo-root .env.local)");
  process.exit(1);
}

let files = process.argv.slice(2).map((f) => f.split("/").pop()!);
if (!files.length) {
  const newest = new Map<string, string>();
  for (const f of (await readdir(dir)).sort()) {
    const m = f.match(STAMP);
    if (m) newest.set(m[1], f);
  }
  files = [...newest.values()];
}

try {
  for (const file of files) {
    const m = file.match(STAMP);
    if (!m) throw new Error(`not an ingest file: ${file}`);
    const observedAt = `${m[2]}T${m[3]}:${m[4]}:${m[5]}.${m[6]}Z`;
    const rows: NormalizedListing[] = JSON.parse(await readFile(new URL(file, dir), "utf8"));
    const { written, noLocation } = await upsertListings(sql, rows, observedAt);
    console.log(`${file}: ${written} upserted, ${noLocation} without coordinates skipped`);
  }
  console.log(`freshness: ${await markFreshness(sql, new Date())} listings changed status`);
} finally {
  await sql.end();
}
