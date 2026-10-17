-- 002_core.sql — owner: D (P0.8)
--
-- Core tables from SPEC.md section 5. Column names are snake_case versions of the
-- zod shapes B is writing in packages/shared/schemas; if B changes a field name,
-- this file gets a new migration — never an edit.
--
-- Deliberate choices:
--   * No foreign keys from listings to neighbourhoods/wards. Ingest order is
--     listings first, area joins after (SPEC 8.4), so an FK would reject rows we
--     want to keep and repair. The join is by id, with indexes.
--   * Locations are geography(Point,4326) so ST_Distance returns metres directly
--     and the KNN operator (<->) works without a cast.
--   * Three-state fields are text with a check constraint that includes 'unknown',
--     because NULL and 'unknown' mean different things to the engine (SPEC 2.4).

-- Provenance: every loader records what it read, when, and under which licence.
CREATE TABLE IF NOT EXISTS sources (
    id            text PRIMARY KEY,
    title         text NOT NULL,
    url           text NOT NULL,
    licence       text NOT NULL,
    retrieved_at  date NOT NULL,
    period        text,
    note          text
);

-- Official geographies: 158 social planning neighbourhoods, 25 wards.
CREATE TABLE IF NOT EXISTS neighbourhoods (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    number        integer,
    is_nia        boolean NOT NULL DEFAULT false,
    geometry      geometry(MultiPolygon, 4326) NOT NULL,
    source_id     text REFERENCES sources (id)
);

CREATE TABLE IF NOT EXISTS wards (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    number        integer,
    geometry      geometry(MultiPolygon, 4326) NOT NULL,
    source_id     text REFERENCES sources (id)
);

-- City of Toronto address points: offline geocoding and building matching.
CREATE TABLE IF NOT EXISTS address_points (
    id               text PRIMARY KEY,
    address_full     text NOT NULL,
    address_norm     text NOT NULL,
    location         geography(Point, 4326) NOT NULL,
    neighbourhood_id text,
    ward_id          text,
    source_id        text REFERENCES sources (id)
);

-- RentSafeTO registered buildings (3+ storeys, 10+ units).
CREATE TABLE IF NOT EXISTS buildings (
    id               text PRIMARY KEY,          -- RentSafeTO RSN
    address          text NOT NULL,
    address_point_id text,
    location         geography(Point, 4326),
    year_built       integer,
    storeys          integer,
    units            integer,
    property_type    text CHECK (property_type IN ('private', 'social_housing', 'tchc')),
    latest_score     numeric(5, 1),
    score_date       date,
    sign_colour      text,
    previous_scores  jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_id        text REFERENCES sources (id)
);

-- Listings, normalised from source adapters (SPEC 8.4).
CREATE TABLE IF NOT EXISTS listings (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source             text NOT NULL,
    source_listing_id  text NOT NULL,
    source_url         text NOT NULL,
    title              text NOT NULL,
    excerpt            text,
    monthly_rent_cad   integer NOT NULL CHECK (monthly_rent_cad > 0),
    rent_is_per_room   boolean NOT NULL DEFAULT false,
    bedrooms           integer,
    bathrooms          numeric(3, 1),
    unit_type          text CHECK (unit_type IN
                           ('apartment', 'condo', 'basement', 'house', 'townhouse', 'room')),
    sqft               integer,
    year_built         integer,
    year_built_source  text CHECK (year_built_source IN
                           ('listing', 'rentsafeto', 'ai_extracted')),
    air_conditioning   text NOT NULL DEFAULT 'unknown'
                           CHECK (air_conditioning IN ('central', 'yes', 'no', 'unknown')),
    location           geography(Point, 4326) NOT NULL,
    -- Defaults to the least precise value: geocoding only upgrades it.
    location_precision text NOT NULL DEFAULT 'area'
                           CHECK (location_precision IN ('exact', 'street', 'area')),
    address_text       text,
    address_point_id   text,
    building_id        text,
    neighbourhood_id   text,
    ward_id            text,
    utilities_included text CHECK (utilities_included IN ('yes', 'no', 'unknown')),
    parking            text CHECK (parking IN ('yes', 'no', 'unknown')),
    laundry_in_suite   text CHECK (laundry_in_suite IN ('yes', 'no', 'unknown')),
    furnished          text CHECK (furnished IN ('yes', 'no', 'unknown')),
    pets_allowed       text CHECK (pets_allowed IN
                           ('yes', 'no', 'unknown', 'cats_only', 'dogs_only')),
    available_from     date,
    lease_term         text,
    image_url          text,
    first_seen_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at       timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    status             text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'stale', 'removed')),
    duplicate_of       uuid,
    data_status        text NOT NULL DEFAULT 'live'
                           CHECK (data_status IN ('live', 'snapshot', 'demo')),
    field_evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (source, source_listing_id)
);

-- Points of interest used for travel targets and the "nearby" panel.
CREATE TABLE IF NOT EXISTS pois (
    id           text PRIMARY KEY,
    category     text NOT NULL CHECK (category IN
                     ('grocery', 'school', 'university', 'library', 'park',
                      'community_centre', 'pharmacy', 'clinic')),
    subcategory  text,
    name         text NOT NULL,
    location     geography(Point, 4326) NOT NULL,
    source_id    text REFERENCES sources (id),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- TTC stops from GTFS. is_rapid drives the "rapid transit within 800 m" indicator.
CREATE TABLE IF NOT EXISTS transit_stops (
    id           text PRIMARY KEY,
    name         text NOT NULL,
    location     geography(Point, 4326) NOT NULL,
    route_types  text[] NOT NULL DEFAULT '{}',
    is_rapid     boolean NOT NULL DEFAULT false,
    source_id    text REFERENCES sources (id)
);

-- Travel times, precomputed by the worker (P2.10) and cached for ad hoc places.
-- target_key: 'amenity:<category>[:<schoolLevel>]' or 'place:<known_place_id>'.
CREATE TABLE IF NOT EXISTS travel_times (
    listing_id   uuid NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    target_key   text NOT NULL,
    mode         text NOT NULL CHECK (mode IN ('transit', 'drive', 'walk', 'bike')),
    minutes      numeric(6, 1),
    distance_m   numeric(9, 1),
    poi_id       text,
    computed_at  timestamptz NOT NULL DEFAULT now(),
    method       text NOT NULL CHECK (method IN ('otp', 'straight_line')),
    PRIMARY KEY (listing_id, target_key, mode)
);

-- Development applications near a listing and per area (SPEC 9.1).
CREATE TABLE IF NOT EXISTS dev_applications (
    id               text PRIMARY KEY,
    address          text,
    location         geography(Point, 4326),
    application_type text,
    status           text,
    proposed_units   integer,
    submitted_date   date,
    source_id        text REFERENCES sources (id)
);

-- One transparent indicator at a time (SPEC 9.2). Never a composite score.
CREATE TABLE IF NOT EXISTS area_indicators (
    area_id      text NOT NULL,
    area_kind    text NOT NULL CHECK (area_kind IN ('neighbourhood', 'ward')),
    indicator_id text NOT NULL,
    value        double precision,
    unit         text,
    period       text NOT NULL,
    source_id    text REFERENCES sources (id),
    sample_size  integer,
    note         text,
    PRIMARY KEY (area_id, indicator_id, period)
);

-- StatCan / CMHC / TTC reference figures. `sample` marks estimated values.
CREATE TABLE IF NOT EXISTS benchmarks (
    id           text PRIMARY KEY,
    kind         text NOT NULL,
    key          jsonb NOT NULL,
    value_cad    numeric(10, 2),
    unit         text,
    period       text NOT NULL,
    source_id    text REFERENCES sources (id),
    retrieved_at date NOT NULL,
    sample       boolean NOT NULL DEFAULT false
);

-- Cached AI output, keyed by a hash of the input (SPEC 10).
CREATE TABLE IF NOT EXISTS ai_cache (
    key        text PRIMARY KEY,
    route      text NOT NULL,
    payload    jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);

-- Spatial and lookup indexes the queries depend on.
CREATE INDEX IF NOT EXISTS neighbourhoods_geometry_idx ON neighbourhoods USING gist (geometry);
CREATE INDEX IF NOT EXISTS wards_geometry_idx ON wards USING gist (geometry);
CREATE INDEX IF NOT EXISTS address_points_location_idx ON address_points USING gist (location);
CREATE INDEX IF NOT EXISTS buildings_location_idx ON buildings USING gist (location);
CREATE INDEX IF NOT EXISTS pois_location_idx ON pois USING gist (location);
CREATE INDEX IF NOT EXISTS transit_stops_location_idx ON transit_stops USING gist (location);
CREATE INDEX IF NOT EXISTS travel_times_listing_idx ON travel_times (listing_id);

CREATE INDEX IF NOT EXISTS listings_location_idx ON listings USING gist (location);
CREATE INDEX IF NOT EXISTS listings_live_idx ON listings (status, data_status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS listings_candidates_idx
    ON listings (bedrooms, unit_type, monthly_rent_cad) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS listings_neighbourhood_idx ON listings (neighbourhood_id);
CREATE INDEX IF NOT EXISTS listings_ward_idx ON listings (ward_id);
CREATE INDEX IF NOT EXISTS listings_building_idx ON listings (building_id);
CREATE INDEX IF NOT EXISTS listings_address_point_idx ON listings (address_point_id);
CREATE INDEX IF NOT EXISTS listings_trgm_idx ON listings USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS address_points_trgm_idx
    ON address_points USING gin (address_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS area_indicators_lookup_idx ON area_indicators (area_kind, indicator_id);
CREATE INDEX IF NOT EXISTS dev_applications_location_idx ON dev_applications USING gist (location);
CREATE INDEX IF NOT EXISTS ai_cache_expiry_idx ON ai_cache (expires_at);
