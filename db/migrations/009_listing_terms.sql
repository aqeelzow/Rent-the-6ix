-- 009_listing_terms.sql — student lease terms (RENT_K_DUBS_SPEC.md "Student-market fields", #35)
--
-- Waterloo rentals run on 4-, 8- and 12-month terms around co-op terms, and many are student
-- sublets ("Jan–Apr sublet", "lease takeover"). `lease_term` already holds the length as text
-- ("4 months", "12 months"); `sublet` records whether the post is a sublet or lease takeover,
-- read from its wording at ingest. Only "yes" is ever inferred; "no" is never claimed.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sublet text NOT NULL DEFAULT 'unknown'
    CHECK (sublet IN ('yes', 'no', 'unknown'));
