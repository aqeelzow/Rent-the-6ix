// Geocode stored listings against Address Points, boundaries and RentSafeTO (P1.5):
// `pnpm geocode [--dry-run]`. Also runs at the end of every ingest.
import { parseArgs } from "node:util";
import { openDb } from "./lib/db.ts";
import { geocodeStored } from "./pipeline/geocode.ts";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const sql = openDb();
if (!sql) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const started = Date.now();
const result = await geocodeStored(sql, { dryRun: values["dry-run"] });
delete result.matches;
console.log(result, `${Math.round((Date.now() - started) / 1000)} s`);
await sql.end();
