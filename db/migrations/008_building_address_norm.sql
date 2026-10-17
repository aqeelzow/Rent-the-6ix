-- 008_building_address_norm.sql — owner: D (P1.14)
--
-- `buildings.address` holds the RentSafeTO site address as published ("181-183  GERRARD ST E"),
-- which cannot be matched against `address_points.address_norm` as-is. Storing the same
-- normalisation the address loader uses (apps/worker/src/civic/lib/address.ts) lets the
-- building → address point join be an indexed equality test, and gives C the same key for
-- linking a listing to its building (the same-building valuation cap).
--
-- Also records the address point that the building matched, so a listing with an address but no
-- coordinates can inherit the building's. Nullable on purpose: a building that matches nothing
-- is still valid data, and the loader reports the coverage rather than dropping rows.

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS address_norm text;

CREATE INDEX IF NOT EXISTS buildings_trgm_idx ON buildings USING gin (address_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS buildings_address_point_idx ON buildings (address_point_id);
