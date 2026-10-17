-- 003_hypertables.sql — owner: D (P0.8)
--
-- One row each time the worker sees a listing. Feeds price-drop flags, "days on
-- market", and the weekly neighbourhood rent aggregate (P3.11, migration 004).
--
-- Order matters: create the table, then convert it, then index. Converting an
-- existing table with rows needs migrate_data => TRUE, which is why that is set.

CREATE TABLE IF NOT EXISTS listing_observations (
    listing_id       uuid NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    observed_at      timestamptz NOT NULL,
    asking_rent_cad  integer NOT NULL CHECK (asking_rent_cad > 0),
    status           text NOT NULL CHECK (status IN ('active', 'stale', 'removed')),
    source           text NOT NULL,
    -- The primary key must include the partitioning column on a hypertable.
    PRIMARY KEY (listing_id, observed_at)
);

SELECT create_hypertable(
    'listing_observations',
    'observed_at',
    if_not_exists => TRUE,
    migrate_data  => TRUE
);

-- Weekly chunks: the demo writes a few thousand rows, and this keeps each chunk
-- small enough to compress later without thinking about it.
SELECT set_chunk_time_interval('listing_observations', INTERVAL '7 days');

CREATE INDEX IF NOT EXISTS listing_observations_listing_time_idx
    ON listing_observations (listing_id, observed_at DESC);
