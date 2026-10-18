// What /data lists (SPEC 11.6), drafted by C for D's review: every dataset the loaders recorded in
// `sources` (title, link, licence, period, retrieval date), and how many listings each collected
// site contributes. Read-only.
import "server-only";
import type { Sql } from "postgres";

export interface DataSource {
  id: string;
  title: string;
  url: string;
  licence: string;
  period: string | null;
  retrievedAt: string;
}

export interface ListingSite {
  source: string;
  /** Active listings shown in search (one copy per unit). */
  shown: number;
  newestSeenAt: string | null;
}

export async function loadDataPage(
  sql: Sql,
): Promise<{ sources: DataSource[]; sites: ListingSite[] }> {
  const [sources, sites] = await Promise.all([
    sql<
      {
        id: string;
        title: string;
        url: string;
        licence: string;
        period: string | null;
        retrieved_at: Date;
      }[]
    >`SELECT id, title, url, licence, period, retrieved_at FROM sources ORDER BY title`,
    sql<{ source: string; shown: number; newest: Date | null }[]>`
      SELECT source, count(*)::int AS shown, max(last_seen_at) AS newest
      FROM listings WHERE status = 'active' AND duplicate_of IS NULL
      GROUP BY source ORDER BY count(*) DESC`,
  ]);
  return {
    sources: sources.map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      licence: row.licence,
      period: row.period,
      retrievedAt: row.retrieved_at.toISOString().slice(0, 10),
    })),
    sites: sites.map((row) => ({
      source: row.source,
      shown: row.shown,
      newestSeenAt: row.newest?.toISOString() ?? null,
    })),
  };
}
