-- 001_extensions.sql — owner: D (P0.8)
--
-- Enables the three extensions the rest of the schema depends on. No tables here,
-- so this file is safe first and safe to re-run on every deploy.
--
--   postgis      spatial columns: area joins, KNN nearest-amenity, comparables
--   timescaledb  listing_observations hypertable + the weekly rent aggregate
--   pg_trgm      fuzzy address matching and listing de-duplication
--
-- On TigerData all three are available on a fresh service; this registers them
-- in this database. If any is missing, stop and tell the team (DEPLOY.md §1).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
