// Load the hand-checked demo backup: `pnpm --filter worker load:manual` (SPEC 8.4 `manual`, P3.33).
// Rows in db/seed/manual.csv without a checked_on date are skipped. Rows are upserted as seen now,
// so reload before a demo: like any listing, they go stale after 7 days and removed after 21.
import { readFile } from "node:fs/promises";
import { openDb } from "./lib/db.ts";
import { normalize, type NormalizedListing } from "./pipeline/normalize.ts";
import { upsertListings } from "./pipeline/upsert.ts";
import { parseManual } from "./sources/manual.ts";

const file = new URL("../../../db/seed/manual.csv", import.meta.url);
const { listings, skipped } = parseManual(await readFile(file, "utf8"));
const rows = listings.map((l) => normalize(l)).filter((l): l is NormalizedListing => l !== null);
console.log(
  `manual.csv: ${rows.length} rows to load, ${skipped} skipped (no checked_on or missing fields)`,
);

const sql = openDb();
if (!sql) {
  console.error("DATABASE_URL is not set (repo-root .env.local)");
  process.exit(1);
}
try {
  const { written, noLocation } = await upsertListings(sql, rows, new Date().toISOString());
  console.log(`manual: ${written} upserted, ${noLocation} without lat/lng skipped`);
} finally {
  await sql.end();
}
