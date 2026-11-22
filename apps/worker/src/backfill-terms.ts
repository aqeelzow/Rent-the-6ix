// Fill lease terms and sublets (#35) on stored listings from their title and excerpt:
// `pnpm terms [--dry-run]`. Ingest fills both from the full description; this catches listings
// stored before the rules existed. A stored lease term is never overwritten, and sublet is only
// ever set to "yes".
import { parseArgs } from "node:util";
import { openDb } from "./lib/db.ts";
import { leaseTermFromText, subletFromText } from "./pipeline/normalize.ts";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const sql = openDb();
if (!sql) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const rows = await sql<
  { id: string; title: string; excerpt: string | null; lease_term: string | null; sublet: string }[]
>`SELECT id, title, excerpt, lease_term, sublet FROM listings WHERE status <> 'removed'`;
let terms = 0;
let sublets = 0;
for (const r of rows) {
  const text = `${r.title}\n${r.excerpt ?? ""}`.toLowerCase();
  const term = r.lease_term === null ? leaseTermFromText(text) : null;
  const sublet = r.sublet !== "yes" && subletFromText(text) === "yes";
  if (!term && !sublet) continue;
  if (term) terms++;
  if (sublet) sublets++;
  if (values["dry-run"]) continue;
  await sql`
    UPDATE listings SET
      lease_term = coalesce(lease_term, ${term}),
      field_evidence = CASE WHEN ${term}::text IS NULL THEN field_evidence
        ELSE field_evidence || '{"leaseTerm": "parsed_from_text"}'::jsonb END,
      sublet = CASE WHEN ${sublet} THEN 'yes' ELSE sublet END,
      updated_at = now()
    WHERE id = ${r.id}`;
}
console.log(
  `${values["dry-run"] ? "would fill" : "filled"} ${terms} lease terms and ${sublets} sublets on ${rows.length} listings`,
);
await sql.end();
