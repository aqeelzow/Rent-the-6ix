// Mark cross-site duplicates in TigerData: `pnpm --filter worker dedupe:listings` (also runs after each ingest).
import { openDb } from "./lib/db.ts";
import { dedupeStored } from "./pipeline/dedupe-store.ts";

const sql = openDb();
if (!sql) {
  console.error("DATABASE_URL is not set (repo-root .env.local)");
  process.exit(1);
}
try {
  const { listings, duplicates, changed } = await dedupeStored(sql);
  console.log(`dedupe: ${duplicates} of ${listings} listings are duplicates (${changed} changed)`);
} finally {
  await sql.end();
}
