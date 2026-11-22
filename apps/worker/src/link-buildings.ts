// Link listings to catalogue buildings (issue #30): `pnpm buildings [--dry-run]`.
// Also runs at the end of every geocode. A dry run lists each name match and the words that made it.
import { parseArgs } from "node:util";
import { openDb } from "./lib/db.ts";
import { linkBuildings } from "./pipeline/link-buildings.ts";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const sql = openDb();
if (!sql) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const links = await linkBuildings(sql, { dryRun: values["dry-run"] });
for (const m of links.named)
  console.log(`  ${m.buildingId.padEnd(22)} "${m.evidence}"  ${m.title}`);
console.log(`${links.byName} placed by building name, ${links.byAddress} linked by address`);
await sql.end();
