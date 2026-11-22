-- 010_buildings.sql — Waterloo building catalogue (RENT_K_DUBS_SPEC.md Additions 2, issue #30)
--
-- Students search and post by building name ("room in ICON"). `buildings` was RentSafeTO's table
-- and is empty in Waterloo; it now holds named buildings from db/seed/buildings.csv. Ids are slugs
-- ("icon"). The RentSafeTO columns stay, unused.
--
-- One building can have several civic numbers ("16 & 20 Barrel Yards Blvd"), so the
-- building ↔ address link is its own table. `listings.building_id` already exists.

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS name text;
-- Lower-case phrases matched case-insensitively as whole words in a listing's title or excerpt.
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';
-- Short or common words ("ICON") matched case-sensitively only.
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS strict_aliases text[] NOT NULL DEFAULT '{}';
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS kind text
    CHECK (kind IN ('student', 'rental_apartment', 'condo', 'other'));
-- Only reviewed buildings are matched to listings.
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS reviewed boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS building_addresses (
    building_id      text NOT NULL REFERENCES buildings (id) ON DELETE CASCADE,
    address_point_id text NOT NULL,
    PRIMARY KEY (building_id, address_point_id)
);

CREATE INDEX IF NOT EXISTS building_addresses_address_point_idx
    ON building_addresses (address_point_id);
CREATE INDEX IF NOT EXISTS listings_building_idx ON listings (building_id);
