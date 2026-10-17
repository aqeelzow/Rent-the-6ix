// Load the reference figures in db/seed/benchmarks.json: `pnpm --filter worker load:benchmarks` (P2.15).
//
// The file is the source of truth and the database is a copy of it, so every row carries the
// source, period and retrieval date that `/data` will show. Upserts are keyed on `id`: re-running
// after correcting a number updates it in place, and a row deleted from the JSON is NOT deleted
// from the table (remove it by hand if that ever matters — silently dropping reference data is
// worse than leaving a stale row someone can see).
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { openDb } from "./lib/db.ts";
import { upsertSource } from "./civic/sources.ts";

const JsonValue = z.union([z.string(), z.number(), z.boolean()]);

const SourceSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
  licence: z.string().min(1),
  period: z.string().min(1).nullable().optional(),
  note: z.string().nullable().optional(),
});

const RowSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.string().min(1),
  key: z.record(z.string(), JsonValue),
  valueCad: z.number().nonnegative(),
  unit: z.string().min(1),
  period: z.string().min(1),
  sourceId: z.string().min(1),
  sample: z.boolean().default(false),
});

const FileSchema = z.strictObject({
  _comment: z.string().optional(),
  retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "retrievedAt must be YYYY-MM-DD"),
  sources: z.array(SourceSchema).min(1),
  rows: z.array(RowSchema).min(1),
});

const file = new URL("../../../db/seed/benchmarks.json", import.meta.url);
const parsed = FileSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
if (!parsed.success) {
  // A typo in a hand-edited seed file must not become a wrong number in the database.
  console.error(`db/seed/benchmarks.json is invalid:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}
const { retrievedAt, sources, rows } = parsed.data;

const sourceIds = new Set(sources.map((source) => source.id));
const unknownSource = rows.find((row) => !sourceIds.has(row.sourceId));
if (unknownSource) {
  console.error(`row ${unknownSource.id} references ${unknownSource.sourceId}, which the file does not define`);
  process.exit(1);
}

const sql = openDb();
if (!sql) {
  console.error("DATABASE_URL is not set (repo-root .env.local)");
  process.exit(1);
}
try {
  for (const source of sources) await upsertSource(sql, source);
  for (const row of rows) {
    await sql`
      insert into benchmarks (id, kind, key, value_cad, unit, period, source_id, retrieved_at, sample)
      values (${row.id}, ${row.kind}, ${sql.json(row.key)}, ${row.valueCad}, ${row.unit},
              ${row.period}, ${row.sourceId}, ${retrievedAt}, ${row.sample})
      on conflict (id) do update set
        kind = excluded.kind,
        key = excluded.key,
        value_cad = excluded.value_cad,
        unit = excluded.unit,
        period = excluded.period,
        source_id = excluded.source_id,
        retrieved_at = excluded.retrieved_at,
        sample = excluded.sample
    `;
  }
  const counts = await sql<{ kind: string; rows: string }[]>`
    select kind, count(*)::text as rows from benchmarks group by kind order by kind
  `;
  console.log(
    `benchmarks: ${rows.length} upserted (${sources.length} sources, retrieved ${retrievedAt}) — table now ${counts
      .map((row) => `${row.kind}: ${row.rows}`)
      .join(", ")}`,
  );
} finally {
  await sql.end();
}
