# Search and places

```mermaid
flowchart TD
  Prompt[Rental prompt] --> Parse[POST /api/search/parse]
  Parse --> Interpret[Gemini or rule-based parser]
  Interpret --> Resolve[Resolve destinations]
  Catalogue[Local place catalogue] --> Resolve
  DB[(PostgreSQL and PostGIS)] -->|Address points and neighbourhoods| Resolve
  MapTiler[MapTiler geocoding fallback] --> Resolve
  Resolve --> Intent[Review and edit search criteria]
  Intent --> Search[POST /api/listings/search]
  Search -->|Ordinary search or scalar percentile| Candidates[Filter active Waterloo listings]
  Search -->|Travel percentile| Jobs[Start in-memory job and return token]
  Jobs --> Candidates
  DB -->|Listings and boundaries| Candidates
  Candidates --> Enrich[Value listings and estimate trips]
  DB -->|Rent comparables and amenities| Enrich
  Enrich --> Engine[Rank listings or select percentile]
  Engine -->|Synchronous response| Results[Listing cards and results map]
  Engine -->|Travel job result| Poll["GET /api/listings/search/jobs/:token"]
  Poll --> Results
```

- The parser produces a structured `SearchIntent`. The browser can submit edited criteria directly to listing search and pause for a destination choice when a place is ambiguous. Waterloo landmarks and intersections resolve locally. Selected Kitchener places, including the GO station, can be commute destinations.
- Ordinary search returns up to 500 ranked listings. Percentiles use the full eligible pool. A travel percentile returns a job token for polling, and the job lives in the Next.js process that starts it.
- Search estimates commute times from straight-line distances and mode-specific assumptions. When configured, OpenTripPlanner serves map routes through `/api/route`. Waterloo neighbourhood crime scoring is disabled.

Source files include `apps/web/src/lib/parse/`, `apps/web/src/lib/api/runtime.ts`, `apps/web/src/lib/db/candidates.ts`, `apps/web/src/lib/db/candidates-percentiles.ts`, and `packages/shared/engine/`.

[Waterloo](Waterloo.md) · [Data imports](Data%20imports.md) · [Database](Database.md) · [Listing and area views](Listing%20and%20area%20views.md)
