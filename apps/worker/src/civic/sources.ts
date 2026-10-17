// Provenance for every civic loader (P1.16): one `sources` row per dataset, written before the
// rows it describes. `/data` renders this table, so the page can never claim a dataset the
// loaders did not actually read. Every civic table has an FK to `sources`, which is why this is
// the first thing every loader calls.
import type { Sql } from "postgres";

export interface SourceInput {
  /** Dataset slug, e.g. "neighbourhoods" — also the FK value on the data rows. */
  id: string;
  title: string;
  /** Human page for the dataset (not the download URL). */
  url: string;
  licence: string;
  /** null means "not period-specific" (boundaries, addresses, POIs). */
  period?: string | null;
  /** The exact resource URL fetched, and anything else a reader needs to judge it. */
  note?: string | null;
}

/** Upsert one provenance row and record today as the retrieval date. */
export async function upsertSource(sql: Sql, source: SourceInput): Promise<void> {
  const retrievedAt = new Date().toISOString().slice(0, 10);
  await sql`
    insert into sources (id, title, url, licence, retrieved_at, period, note)
    values (${source.id}, ${source.title}, ${source.url}, ${source.licence}, ${retrievedAt},
            ${source.period ?? null}, ${source.note ?? null})
    on conflict (id) do update set
      title = excluded.title,
      url = excluded.url,
      licence = excluded.licence,
      retrieved_at = excluded.retrieved_at,
      period = excluded.period,
      note = excluded.note
  `;
}
