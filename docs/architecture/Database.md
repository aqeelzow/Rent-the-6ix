# Database

PostgreSQL stores listings, benchmarks and source records. PostGIS stores neighbourhood polygons, transit stops, amenities and development application points. The civic loader writes derived measures to `area_indicators`.

Candidate search checks listing coordinates against the Waterloo boundary. The demo loader attaches districts to seeded listings. Valuation and area rent statistics exclude demo prices. Area facts join indicator values to districts and source records.

Source files include `db/migrations/`, `apps/web/src/lib/db/candidates-sql.ts`, `valuation.ts`, and `area-facts.ts`.

[Waterloo](Waterloo.md) · [Data imports](Data%20imports.md) · [Search and places](Search%20and%20places.md) · [Listing and area views](Listing%20and%20area%20views.md)
