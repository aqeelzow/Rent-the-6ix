-- 005_listing_details.sql — written by C for D's review (TEAM.md section 2: "write it in your
-- branch and have D review"). 004 is reserved for D's aggregates.
--
-- * den: "1+den" units are stored as bedrooms = 1 (SPEC 8.4 step 2); the den itself was dropped
--   on upsert because listings had no column for it.
-- * detail_fetched_at / detail_rent_cad: when the worker last fetched the listing's own page, and
--   the rent at that time. A listing is fetched again only when it's new or its rent changed; this
--   replaces the worker's local cache in apps/worker/.cache/details/.

ALTER TABLE listings ADD COLUMN IF NOT EXISTS den boolean NOT NULL DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS detail_fetched_at timestamptz;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS detail_rent_cad integer
    CHECK (detail_rent_cad IS NULL OR detail_rent_cad > 0);
