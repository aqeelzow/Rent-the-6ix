// AI extraction for listings already in TigerData (P4.10):
// `pnpm ai:backfill [--limit 50] [--sources kijiji,realtor_ca] [--full] [--apply]`.
// Reads the full description from the detail cache when the listing's page was fetched, else
// the stored excerpt (--full: only listings with a full description; the keyword rules already
// read the excerpts, so those rarely gain anything). Without --apply it only writes .cache/ai/review.csv (every value with the
// phrase it came from) for a hand check; with --apply it also updates the rows.
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { openDb } from "./lib/db.ts";
import { loadDetailCache, type DetailCache } from "./pipeline/details.ts";
import {
  AI_FIELDS,
  aiText,
  extractFields,
  geminiExtractorFromEnv,
  loadAiCache,
  MIN_UNKNOWN,
  saveAiCache,
  textHash,
  unknownFields,
  type AiField,
  type ExtractTarget,
} from "./pipeline/extract.ts";
import { csvField } from "./sources/manual.ts";
import { utilitiesPartialAllowed } from "./pipeline/upsert.ts";
import type { SourceId } from "./sources/types.ts";

const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "50" },
    sources: { type: "string" },
    full: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  },
});

const COLUMN: Record<AiField, string> = {
  airConditioning: "air_conditioning",
  utilitiesIncluded: "utilities_included",
  parking: "parking",
  petsAllowed: "pets_allowed",
  furnished: "furnished",
  laundryInSuite: "laundry_in_suite",
  sqft: "sqft",
  yearBuilt: "year_built",
  availableFrom: "available_from",
  leaseTerm: "lease_term",
};

interface Row {
  id: string;
  source: SourceId;
  source_listing_id: string;
  source_url: string;
  title: string;
  excerpt: string;
  air_conditioning: string;
  utilities_included: string | null;
  parking: string | null;
  pets_allowed: string | null;
  furnished: string | null;
  laundry_in_suite: string | null;
  sqft: number | null;
  year_built: number | null;
  year_built_source: string | null;
  available_from: string | null;
  lease_term: string | null;
  field_evidence: Record<string, string>;
}

const extractor = geminiExtractorFromEnv();
if (!extractor) {
  console.error("AI is off: set AI_PROVIDER=gemini, GEMINI_API_KEY and GEMINI_MODEL_FAST.");
  process.exit(1);
}
const sql = openDb();
if (!sql) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const limit = Number(values.limit);
const sources = values.sources?.split(",").map((s) => s.trim());
// Unknown count in SQL so only candidates are read; same fields as extract.ts.
const unknownCount = AI_FIELDS.map((f) =>
  ["sqft", "yearBuilt", "availableFrom", "leaseTerm"].includes(f)
    ? `(${COLUMN[f]} IS NULL)::int`
    : `(coalesce(${COLUMN[f]}, 'unknown') = 'unknown')::int`,
).join(" + ");
const stored = await sql<Row[]>`
  SELECT id, source, source_listing_id, source_url, title, excerpt,
    air_conditioning, utilities_included, parking, pets_allowed, furnished, laundry_in_suite,
    sqft, year_built, year_built_source, to_char(available_from, 'YYYY-MM-DD') AS available_from,
    lease_term, field_evidence
  FROM listings
  WHERE status IN ('active', 'stale') AND duplicate_of IS NULL
    AND ${sql.unsafe(unknownCount)} >= ${MIN_UNKNOWN}
    ${sources ? sql`AND source IN ${sql(sources)}` : sql``}
  ORDER BY random()`;

const detailCaches = new Map<SourceId, DetailCache>();
for (const source of new Set(stored.map((r) => r.source))) {
  detailCaches.set(source, await loadDetailCache(source));
}
const descriptionOf = (r: Row) =>
  detailCaches.get(r.source)?.[r.source_listing_id]?.patch.description ?? null;
const rows = values.full
  ? stored.filter((r) => (descriptionOf(r)?.length ?? 0) > r.excerpt.length)
  : stored;
const texts = rows.map((r) => aiText(r.title, descriptionOf(r) || r.excerpt));

const tri = (v: string | null) => (v ?? "unknown") as never;
const targets: ExtractTarget[] = rows.map((r) => ({
  airConditioning: tri(r.air_conditioning),
  utilitiesIncluded: tri(r.utilities_included),
  parking: tri(r.parking),
  petsAllowed: tri(r.pets_allowed),
  furnished: tri(r.furnished),
  laundryInSuite: tri(r.laundry_in_suite),
  sqft: r.sqft,
  yearBuilt: r.year_built,
  yearBuiltSource: r.year_built_source as ExtractTarget["yearBuiltSource"],
  availableFrom: r.available_from,
  leaseTerm: r.lease_term,
  fieldEvidence: r.field_evidence as ExtractTarget["fieldEvidence"],
}));

const cache = await loadAiCache();
const today = new Date().toISOString().slice(0, 10);
const started = Date.now();
const { targets: filled, stats } = await extractFields(targets, (i) => texts[i], {
  extractor,
  cache,
  max: limit,
  today,
});
await saveAiCache(cache);

// One review line per filled field: the value, the model's phrase, and how much text it had.
const review = [["source", "url", "field", "value", "phrase", "text_chars"].join(",")];
const updates: { row: Row; set: Record<string, unknown> }[] = [];
for (let i = 0; i < rows.length; i++) {
  const changed = unknownFields(targets[i]).filter(
    (f) => filled[i].fieldEvidence[f] === "ai_extracted",
  );
  if (!changed.length) continue;
  const answer = cache[textHash(texts[i])] ?? {};
  for (const f of changed) {
    review.push(
      [
        rows[i].source,
        rows[i].source_url,
        f,
        String(filled[i][f]),
        answer[f]?.phrase ?? "",
        String(texts[i].length),
      ]
        .map(csvField)
        .join(","),
    );
  }
  const set: Record<string, unknown> = Object.fromEntries(
    changed.map((f) => [COLUMN[f], filled[i][f]]),
  );
  if (changed.includes("yearBuilt")) set.year_built_source = "ai_extracted";
  updates.push({ row: rows[i], set });
}
const reviewFile = new URL("../.cache/ai/review.csv", import.meta.url);
await writeFile(reviewFile, review.join("\n") + "\n");

console.log(
  `${rows.length} stored listings with ${MIN_UNKNOWN}+ unknown fields; sent ${stats.sent} to the model in ${Math.round((Date.now() - started) / 1000)} s; ${stats.filled} gained fields.`,
);
console.log(
  "filled:",
  Object.entries(stats.fields)
    .map(([f, n]) => `${f} ${n}`)
    .join(", ") || "none",
);
if (stats.stopped) console.error(`stopped: ${stats.stopped}`);
console.log(`review: ${decodeURIComponent(reviewFile.pathname)}`);

if (values.apply && updates.length && !(await utilitiesPartialAllowed(sql))) {
  // Before migration 007, 'partial' would fail the update: leave those fields unknown.
  for (const u of updates)
    if (u.set.utilities_included === "partial") delete u.set.utilities_included;
}
if (values.apply && updates.length) {
  await sql.begin(async (tx) => {
    for (const { row, set } of updates) {
      if (!Object.keys(set).length) continue;
      const evidence = Object.fromEntries(
        Object.keys(set)
          .filter((c) => c !== "year_built_source")
          .map((c) => [
            Object.keys(COLUMN).find((f) => COLUMN[f as AiField] === c)!,
            "ai_extracted",
          ]),
      );
      await tx`
        UPDATE listings SET ${tx(set)},
          field_evidence = field_evidence || ${tx.json(evidence)}, updated_at = now()
        WHERE id = ${row.id}`;
    }
  });
  console.log(`applied to ${updates.length} listings`);
}
await sql.end();
