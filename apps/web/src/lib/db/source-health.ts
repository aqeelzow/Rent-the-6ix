// Listing-source health for /status (SPEC 11.6, P5.5c), owner C. Reads the worker's last run per
// source (`ingest_runs`, migration 006) and the newest listing seen per source, and says plainly
// when a source is blocked, failing, empty or behind. Pure `sourceHealth` + one read-only query.
import "server-only";
import type { Sql } from "postgres";

/** The worker runs every 6 h (P3.31); four missed runs in a row is "behind". */
export const STALE_HOURS = 24;
/** Error text shown on /status is the worker's own message (a block or error, never page text). */
const MESSAGE_MAX = 160;

export type SourceState = "ok" | "blocked" | "failed" | "empty" | "stale" | "no_runs";

export interface SourceRunRow {
  source: string;
  /** Latest run; null when the worker hasn't recorded one for this source yet. */
  status: "ok" | "unhealthy" | "error" | null;
  finished_at: Date | null;
  listings: number | null;
  stored: number | null;
  message: string | null;
  /** Latest run that ended ok. */
  last_ok_at: Date | null;
  active: number;
  stale: number;
  newest_seen_at: Date | null;
}

export interface SourceHealth {
  source: string;
  state: SourceState;
  lastRunAt: string | null;
  lastOkAt: string | null;
  newestSeenAt: string | null;
  /** Rows the last run collected and stored. */
  lastRunListings: number | null;
  lastRunStored: number | null;
  active: number;
  stale: number;
  message: string | null;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

/**
 * One source's state. A failed or blocked last run wins over everything (it explains the rest),
 * then a run that found nothing (often a changed page layout), then data older than STALE_HOURS.
 */
export function sourceHealth(row: SourceRunRow, now: Date): SourceHealth {
  const behind =
    row.newest_seen_at === null ||
    now.getTime() - row.newest_seen_at.getTime() > STALE_HOURS * 3_600_000;
  const state: SourceState =
    row.status === "error"
      ? "failed"
      : row.status === "unhealthy"
        ? "blocked"
        : row.status === "ok" && row.listings === 0
          ? "empty"
          : behind
            ? "stale"
            : row.status === null
              ? "no_runs"
              : "ok";
  const message = row.message?.trim() || null;
  return {
    source: row.source,
    state,
    lastRunAt: iso(row.finished_at),
    lastOkAt: iso(row.last_ok_at),
    newestSeenAt: iso(row.newest_seen_at),
    lastRunListings: row.listings,
    lastRunStored: row.stored,
    active: row.active,
    stale: row.stale,
    message:
      message && message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_MAX - 1)}…` : message,
  };
}

/**
 * Every collected source (pasted listings never reach the server, so none are here), healthiest
 * last so problems are read first. Works before migration 006: no runs, states from listings only.
 */
export async function loadSourceHealth(sql: Sql, now = new Date()): Promise<SourceHealth[]> {
  const [{ runs }] = await sql<{ runs: boolean }[]>`
    SELECT to_regclass('ingest_runs') IS NOT NULL AS runs`;
  const rows = await sql<SourceRunRow[]>`
    WITH seen AS (
      SELECT source,
        count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE status = 'stale')::int AS stale,
        max(last_seen_at) AS newest_seen_at
      FROM listings WHERE duplicate_of IS NULL GROUP BY source
    )
    ${
      runs
        ? sql`, latest AS (
            SELECT DISTINCT ON (source) source, status, finished_at, listings, stored, message
            FROM ingest_runs ORDER BY source, finished_at DESC
          ), ok AS (
            SELECT source, max(finished_at) AS last_ok_at FROM ingest_runs
            WHERE status = 'ok' GROUP BY source
          )
          SELECT coalesce(s.source, r.source) AS source, r.status, r.finished_at, r.listings,
            r.stored, r.message, ok.last_ok_at, coalesce(s.active, 0) AS active,
            coalesce(s.stale, 0) AS stale, s.newest_seen_at
          FROM seen s FULL JOIN latest r ON r.source = s.source
          LEFT JOIN ok ON ok.source = coalesce(s.source, r.source)`
        : sql`SELECT source, NULL AS status, NULL::timestamptz AS finished_at, NULL::int AS listings,
            NULL::int AS stored, NULL AS message, NULL::timestamptz AS last_ok_at, active, stale,
            newest_seen_at
          FROM seen`
    }`;
  const order: SourceState[] = ["failed", "blocked", "empty", "stale", "no_runs", "ok"];
  return rows
    .map((row) => sourceHealth(row, now))
    .sort(
      (a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.source.localeCompare(b.source),
    );
}
