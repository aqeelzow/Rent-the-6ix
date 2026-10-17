-- 006_ingest_runs.sql — written by C for D's review (TEAM.md section 2). One row per source per
-- worker run, for /status (SPEC 11.6, P3.31) and unhealthy-source errors (P5.5c). The worker writes
-- it only once this table exists.

CREATE TABLE IF NOT EXISTS ingest_runs (
    id           bigserial PRIMARY KEY,
    source       text NOT NULL,
    started_at   timestamptz NOT NULL,
    finished_at  timestamptz NOT NULL,
    status       text NOT NULL CHECK (status IN ('ok', 'unhealthy', 'error')),
    pages        integer NOT NULL DEFAULT 0,
    listings     integer NOT NULL DEFAULT 0,  -- normalized rows from this run
    dropped      integer NOT NULL DEFAULT 0,  -- rows normalize rejected (no rent, not housing)
    details      integer NOT NULL DEFAULT 0,  -- listing pages fetched
    stored       integer NOT NULL DEFAULT 0,  -- rows upserted into listings
    message      text                         -- the block or error, never page content
);

CREATE INDEX IF NOT EXISTS ingest_runs_source_time_idx ON ingest_runs (source, finished_at DESC);
