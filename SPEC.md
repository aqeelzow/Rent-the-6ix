# RentThe6ix — Product & Build Specification

This file is the master specification for the app. Build it **phase by phase** (see "Build phases", section 22). Do not try to build everything at once.

Progress is tracked task by task in `PROGRESS.md` (task ids like `P2.4`, each tagged with its owner `[A]`, `[B]`, `[C]` or `[D]`); `CLAUDE.md` defines the workflow (update progress after every task, one commit per task, keep the deployment green). When this spec leaves a detail open, make a sensible choice, keep it simple, update this file, and add a line to the Change log (section 27).

**Event:** Hack the Valley, ~36 hours, team of 4.
**Tracks:** Hack the Valley × School of Cities (Toronto civic tech) · Gemini API · Vultr · TigerData.

---

## 1. Product summary

RentThe6ix is an AI-assisted rental search and neighbourhood comparison tool for **Toronto**. A renter describes what they need in one plain-language prompt; the app turns it into editable filters, searches listings gathered from several rental sites in one place, ranks them on value, commute, amenities and fit, and explains every ranking with real data. Every listing sits inside its **neighbourhood and ward context**, built from Toronto open data: what rent normally costs there, how renters there are doing, transit access, nearby services, the building's RentSafeTO inspection record, and what is being built nearby.

**The civic problem:** finding a rental in Toronto means checking twenty Facebook groups and five listing sites, with no way to tell whether a price is fair, whether the building is maintained, or what "affordable" means once the commute is included. The information that would help (City inspection records, neighbourhood census data, transit, development activity) is public but scattered across portals renters never visit.

**Primary users:**
1. **Renters** (students, young professionals, newcomers, families) searching for a place: the main user.
2. **Tenant organizers, community groups and journalists** comparing rents and housing pressure across neighbourhoods and wards (read-only explorer).
3. **Voters** in the 2026 municipal election who want plain, neutral facts about housing in their ward.

**Primary value proposition:** find the *best-fit, best-value* rental and understand the place around it, not just the cheapest listing.

**Example prompt:**

> I need a 2-bedroom near UofT St. George under $2,800, within 25 minutes by transit, close to groceries, cat-friendly, and I really care about getting a good deal. I make about $95k with my roommate.

**Context:** this is a hackathon build, but it must be a real, working product: every P0 feature is in scope and nothing in the demo is faked. Avoid over-engineering (no microservices, no queues, no auth, no premature abstractions).

---

## 2. Core principles (apply everywhere)

1. **AI interprets, code calculates.** Gemini turns text into structured data and writes plain-language explanations. It never produces a number the user sees. Filters, distances, rent estimates, scores and rankings come from the deterministic engine and SQL.
2. **Every number is traceable.** Each figure shows where it came from (e.g. "Median of 9 comparable 2-bedroom listings within 1.5 km, last 30 days" or "Statistics Canada table 46-10-0092-01, 2026 Q2"). Users can open the comparables, the dataset, and the date.
3. **Hard requirements vs preferences.** The parser separates must-haves (excluded if unmet) from nice-to-haves (affect the score only). Parsed criteria are shown as editable chips with the phrase that produced each one. The app never silently invents a constraint.
4. **Unknown is not "no".** Listings often leave fields blank. Unknown fields are shown as unknown, excluded from the score (weights renormalized), and never treated as failing a preference. A hard filter on an unknown field keeps the listing but marks it "not confirmed".
5. **Honest uncertainty.** Asking rents are not signed-lease rents; straight-line distance is not travel time; a building outside RentSafeTO is not a bad building. Say so wherever it matters. When data is thin, show **"Not enough data"**, never a made-up figure.
6. **Data provenance and freshness.** Every listing shows its source site, link to the original post, and when we last saw it. Demo snapshots are labelled as snapshots.
7. **Respect people.** Never re-host photos, keep only short excerpts of descriptions, and strip landlord names, phone numbers and emails before storing (contact happens on the source site). See sections 8.4–8.5.
8. **Civic, not partisan.** The app explains housing conditions and how to vote; it never ranks, summarizes, endorses or predicts candidates. Neighbourhood comparisons use one transparent indicator at a time, never "good/bad neighbourhood" labels. Safety is an **opt-in preference**: off by default, used in ranking only when the user turns it on, always shown as police-reported rates for the whole neighbourhood compared with the city (with their caveats), never as a "safe/unsafe" label for a place or a building (section 7.6).
9. **Built for Toronto.** 158 social planning neighbourhoods, 25 wards, TTC transit, CAD, metric units (km/m), `en-CA` formatting.
10. **Demo reliability.** The live demo must work with no surprises: a loaded listing snapshot in TigerData, cached AI outputs for the demo prompts, and a deterministic fallback for every AI and external call. No dead ends, no blank screens.

---

## 3. Tech stack

Use current stable versions. Check official docs for current APIs rather than relying on memory.

| Concern | Choice |
| --- | --- |
| Framework | Next.js (App Router) + TypeScript (strict), one app for UI and API routes |
| Package manager | pnpm (single repo; `apps/web`, `apps/worker`, `packages/shared`) |
| Styling / UI | Tailwind CSS + shadcn/ui, lucide-react icons |
| Client state | Zustand (search state, shortlist, compare tray) |
| Validation & shared types | zod in `packages/shared` (AI outputs, API bodies, DB rows, engine inputs) |
| Database | **TigerData** (Tiger Cloud, managed PostgreSQL) with **PostGIS** (spatial queries), **TimescaleDB hypertables** (listing price observations), continuous aggregates (rent trends by neighbourhood), `pg_trgm` (dedupe and fuzzy address match) |
| DB access | `postgres` (porsager) or Drizzle ORM for typed queries; raw SQL for spatial/time-series queries |
| Map | MapLibre GL JS; basemap tiles from MapTiler (key via env), fallback OpenFreeMap |
| Geometry | Turf.js (client), PostGIS (server) |
| Geocoding | City of Toronto Address Points (loaded into TigerData) first; MapTiler geocoding API as fallback |
| Travel times | OpenTripPlanner 2 on Vultr with TTC GTFS + Ontario OSM extract (clipped to Toronto + 10 km): transit, walk, bike and car (free-flow, no traffic); fallback to labelled straight-line distance |
| Listing ingestion | Worker in TypeScript: `undici`/`fetch` + `cheerio` for static pages, Playwright for script-rendered pages; per-source adapters (section 8.4) |
| AI | **Gemini API** via REST or the `@google/genai` SDK, behind an `AIProvider` interface; structured output with JSON schema derived from zod; `AI_PROVIDER=none` uses deterministic fallbacks |
| Charts | Plain HTML/CSS bars first; Recharts only if a chart truly needs it |
| Hosting | **Vultr** Cloud Compute instance running Docker Compose: `web` (Next.js), `worker` (ingestion + scheduled jobs + travel-time precompute), `otp` (router), Caddy for HTTPS |
| Tests | Vitest (engine, parsers, adapters with saved HTML fixtures); optional Playwright smoke test |

No user accounts. The shortlist and pasted listings live in the browser (section 15).

---

## 4. Architecture overview

```
Browser (Next.js, mobile-first)
  ├─ Prompt box + editable filter chips
  ├─ Results: ranked list ⇄ map (MapLibre), synced selection
  ├─ Listing detail: score breakdown, rent check, building record, nearby, area card
  ├─ Neighbourhood & ward explorer (choropleth + briefing)
  └─ Shortlist / compare (browser storage)
          |
          v
Vultr instance (Docker Compose)
  ├─ web: Next.js API routes
  │    ├─ /api/search/parse         Gemini: text → SearchIntent
  │    ├─ /api/listings/search      SQL hard filters → engine scoring → ranked results
  │    ├─ /api/listings/[id]/*      detail, valuation, nearby, explain
  │    ├─ /api/listings/import      Gemini: pasted listing text/URL → Listing (not stored)
  │    ├─ /api/areas/*              neighbourhood & ward indicators, briefings
  │    └─ /api/health               DB, AI, OTP status (shown on /status for judges)
  ├─ worker: source adapters → normalize → geocode → dedupe → upsert + observations
  │          → precompute travel times to amenities; scheduled every 6 h;
  │          civic data loaders (pnpm data:civic)
  └─ otp: OpenTripPlanner for transit / walk / bike / car times
          |
          v
TigerData (PostgreSQL + PostGIS + TimescaleDB + pg_trgm)
  listings · listing_observations (hypertable) · buildings · address_points
  neighbourhoods · wards · area_indicators · pois · transit_stops
  travel_times · dev_applications · benchmarks · ai_cache
```

The **engine** (`packages/shared/engine`) is pure TypeScript with no network and no randomness: filters, valuation from comparables, proximity scoring, match score, caveats. It runs on the server for search and on the client for pasted listings, producing identical results. SQL does the heavy lifting (spatial candidate selection, comparable selection); the engine does the arithmetic so it can be unit-tested.

### Folder structure

```
apps/
  web/
    src/app/
      page.tsx                 landing: prompt, example chips, "Explore neighbourhoods"
      search/page.tsx          results (list + map)
      listing/[id]/page.tsx    listing detail
      areas/page.tsx           neighbourhood & ward explorer
      areas/[kind]/[id]/page.tsx  area page + briefing
      paste/page.tsx           paste a listing
      compare/page.tsx         side-by-side (P1)
      data/page.tsx            data sources, licences, limitations, methodology
      status/page.tsx          live health: DB rows, last ingest, AI, Vultr host (for judges)
      api/...
    src/components/  search/ results/ map/ listing/ areas/ compare/ ui/
    src/lib/         ai/ db/ geo/ api/ format/
    messages/en.json
  worker/
    src/sources/     kijiji.ts rentalsca.ts zillow.ts realtor.ts manual.ts  (one adapter each)
    src/pipeline/    normalize.ts geocode.ts dedupe.ts scrub.ts upsert.ts travel-times.ts
    src/civic/       load-neighbourhoods.ts load-wards.ts load-profiles.ts load-rentsafeto.ts
                     load-address-points.ts load-pois.ts load-gtfs-stops.ts load-dev-apps.ts
                     load-benchmarks.ts load-crime.ts
    src/schedule.ts
    fixtures/        saved HTML pages per source for adapter tests
packages/
  shared/
    schemas/         intent.ts listing.ts area.ts api.ts
    engine/          filters.ts valuation.ts travel.ts home-fit.ts safety.ts score.ts caveats.ts affordability.ts
    engine/__tests__/
db/
  migrations/      001_extensions.sql 002_core.sql 003_hypertables.sql 004_aggregates.sql
  seed/            demo snapshot loader (snapshot files are git-ignored, see 8.5)
```

---

## 5. Data model

Define as zod schemas in `packages/shared/schemas`, mirrored by SQL migrations in `db/migrations`.

### SearchIntent (output of the parser, edited by the user)

Every criterion can be a **must-have** (`hard: true`, excludes listings that fail it) or a **preference** (`hard: false`, only affects the score). The parser picks one from the wording; the user can flip it on the chip.

```ts
Pref<T> = { value: T, hard: boolean }

SearchIntent {
  schemaVersion: number
  rawPrompt: string
  areas: AreaFilter[]                 // e.g. neighbourhoods, wards, "near a point"; empty = all of Toronto
  criteria: {
    rent?: Pref<{ min?: number, max?: number }>               // price range, CAD per month
    priceFairness?: Pref<PriceLabel[]>                        // allowed labels, e.g. ['underpriced', 'reasonable'] (section 7.2)
    bedrooms?: Pref<{ min?: number, max?: number }>           // studio = 0
    bathrooms?: Pref<{ min?: number, max?: number }>
    sizeSqft?: Pref<{ min?: number, max?: number }>
    unitTypes?: Pref<(UnitType | 'studio')[]>  // studio is a search-only whole-unit choice, bedrooms 0
    buildingAge?: Pref<{ builtAfter?: number, builtBefore?: number }>   // years; "new build" = built in the last 10 years
    airConditioning?: Pref<'any' | 'central'>                 // 'any' accepts central, wall, window or portable units
    petsAllowed?: Pref<'cats' | 'dogs' | 'any'>
    furnished?: Pref<boolean>
    parking?: Pref<boolean>
    laundryInSuite?: Pref<boolean>
    utilitiesIncluded?: Pref<boolean>
    availableBy?: Pref<string>                                // ISO date
    leaseTerm?: Pref<'short_term' | '12_months'>
  }
  travelTargets: TravelTarget[]       // time to places and to kinds of amenity (section 7.4)
  safety: { enabled: boolean, hard: boolean }   // off unless the user asks; hard = "below the city rate" only (section 7.6)
  household?: { annualIncomeCad?: number, people?: number }
  weights?: { value: number, price: number, travel: number, home: number, safety: number }
  sortBy: 'best_match' | 'lowest_rent' | 'best_value' | 'shortest_trips' | 'lowest_true_cost' | 'newest'
  numericExtreme?: { field: 'rent' | 'bedrooms' | 'bathrooms' | 'sizeSqft' | 'buildingAge' | 'travel',
    direction: 'min' | 'max', percentage: number, minimumCount?: number, targetId?: string }
  // One selector only; percentage (0,100], minimumCount defaults 10; travel requires targetId.
  fieldSources: Record<string, { source: 'ai_prompt' | 'user' | 'default', phrase?: string }>
  droppedRequests: { phrase: string, reason: string }[]   // things we can't search on, shown to the user
}

TravelTarget {
  id: string
  kind: 'place' | 'amenity'
  label: string                       // "Work: 100 King St W", "Supermarket", "Elementary school"
  // place: a specific destination (job, campus, family)
  query?: string
  resolved?: { lng: number, lat: number, source: 'address_points' | 'maptiler' | 'known_place' }
  // amenity: the nearest of a kind
  category?: 'grocery' | 'school' | 'university' | 'library' | 'park' | 'community_centre'
           | 'pharmacy' | 'clinic' | 'rapid_transit'
  schoolLevel?: 'elementary' | 'secondary' | 'any'
  mode: 'transit' | 'drive' | 'walk' | 'bike'  // required primary mode, backward compatible
  alternativeModes?: ('transit' | 'drive' | 'walk' | 'bike')[] // additional distinct modes; OR within target
  maxMinutes?: number                 // if not stated, the default for the category and mode (section 7.4)
  hard: boolean                       // "must be within" vs "ideally"
}

PriceLabel = 'underpriced' | 'reasonable' | 'overpriced'
```

`fieldSources` powers the chip labels ("from: *under $2,800*"). `droppedRequests` makes it visible when a wish can't be honoured ("quiet street: no reliable data").

**Supported criteria at a glance** (parser prompt, chips and filter panel all use this list):

| Criterion | Example phrases | Data it uses |
| --- | --- | --- |
| Price range | "under $2,800", "$1,800–2,200" | listing rent |
| Price vs market | "a good deal", "not overpriced", "only underpriced" | valuation label (7.2) |
| Bedrooms / bathrooms | "2 bed", "at least 2 baths" | listing |
| Size | "over 700 sq ft", "big" → asks or drops ("big" is too vague) | listing `sqft` (often missing) |
| Unit type | "condo or apartment", "no basements" | listing |
| Building age | "built after 2010", "new build", "not an old building" | listing text, RentSafeTO year built (often missing for houses) |
| Air conditioning | "with AC", "central air" | listing |
| Pets, furnished, parking, laundry, utilities, availability, lease | as before | listing |
| Time to places | "30 min to my job at King and Bay by transit" | OTP travel time |
| Time to amenities | "10 min walk to a supermarket", "short drive to a school" | OTP travel time to the nearest of that kind |
| Safety | "safe area", "low crime" | TPS neighbourhood crime rates (opt-in, 7.6) |
| Area | "in Leslieville", "Ward 14", "east end" (→ asks or drops) | neighbourhoods, wards |

### Listing

```ts
UnitType = 'apartment' | 'condo' | 'basement' | 'house' | 'townhouse' | 'room'   // 'room' = shared accommodation

Listing {
  id: string (uuid)
  source: 'kijiji' | 'torontorentals' | 'rentals_ca' | 'zillow' | 'realtor_ca' | 'manual' | 'pasted'
  sourceListingId: string
  sourceUrl: string
  title: string
  excerpt: string                       // ≤ 280 chars, scrubbed of contact details
  monthlyRentCad: number
  rentIsPerRoom: boolean
  bedrooms: number | null               // studio = 0
  bathrooms: number | null
  unitType: UnitType | null
  sqft: number | null
  yearBuilt: number | null              // from the listing, else the matched RentSafeTO building
  yearBuiltSource: 'listing' | 'rentsafeto' | 'ai_extracted' | null
  airConditioning: 'central' | 'yes' | 'no' | 'unknown'   // 'yes' = AC of an unstated or non-central kind
  location: { lng: number, lat: number }
  locationPrecision: 'exact' | 'street' | 'area'
  addressText: string | null            // shown only when the source shows it
  addressPointId: string | null         // City Address Points match
  buildingId: string | null             // RentSafeTO registered building, if matched
  neighbourhoodId: string | null, wardId: string | null   // null until geocoded against D's boundaries (P1.10);
                                                          // area filters and safety need a match, so they skip such rows
  utilitiesIncluded: Tri, parking: Tri, petsAllowed: Tri | 'cats_only' | 'dogs_only',
  furnished: Tri, laundryInSuite: Tri   // Tri = 'yes' | 'no' | 'unknown'
  availableFrom: string | null, leaseTerm: string | null
  imageUrl: string | null               // hot-link to source thumbnail only if source terms allow; else null
  firstSeenAt, lastSeenAt, updatedAt: string
  status: 'active' | 'stale' | 'removed'      // active: seen ≤ 7 days; stale: 8–21 days; removed: > 21 days
  duplicateOf: string | null            // canonical listing id when the same unit appears on several sites
  dataStatus: 'live' | 'snapshot' | 'demo'
  fieldEvidence: Record<string, 'structured' | 'parsed_from_text' | 'ai_extracted'>
}
```

### ListingObservation (TimescaleDB hypertable on `observed_at`)

`listing_id, observed_at, asking_rent_cad, status, source`. One row each time the worker sees a listing. Feeds price-drop flags, "days on market" and neighbourhood rent trends.

### Building (RentSafeTO)

`id (RSN), address, address_point_id, location, year_built, storeys, units, property_type ('private' | 'social_housing' | 'tchc'), latest_score, score_date, sign_colour, previous_scores[]`. Only buildings with 3+ storeys and 10+ units are in the program.

### Area (neighbourhood or ward) and indicators

```ts
Area { id, kind: 'neighbourhood' | 'ward', name, number?, geometry: MultiPolygon, isNIA?: boolean }
AreaIndicator {
  areaId, indicatorId, value: number | null, unit, period: string,   // e.g. '2021 Census', '2026 Q3'
  sourceId, sampleSize?: number, note?: string
}
```

Indicator ids (section 9): `median_asking_rent_{0..3}br`, `listing_count_30d`, `renter_households_pct`, `renters_shelter_cost_30pct`, `median_household_income`, `rentsafeto_avg_score`, `rentsafeto_buildings`, `dev_applications_12m`, `residential_units_proposed_12m`, `transit_stops_per_km2`, `rapid_transit_within_800m_pct`, `libraries`, `parks_ha_per_1000`, `crime_rate_{type}` (opt-in only).

### POI, transit and travel times

`pois(id, category, subcategory, name, location, source, updated_at)` with categories `grocery` (supermarkets and grocery stores, not convenience stores), `school` (subcategory `elementary` / `secondary`), `university`, `library`, `park`, `community_centre`, `pharmacy`, `clinic`. `transit_stops(id, name, location, route_types[], is_rapid)` from TTC GTFS.

`travel_times(listing_id, target_key, mode, minutes, distance_m, poi_id, computed_at, method)`: `target_key` is `amenity:<category>[:<schoolLevel>]` or `place:<known_place_id>`; `method` is `otp` or `straight_line`. Filled by the worker for every active listing (section 7.4); ad hoc places are computed at search time and cached here too.

### Valuation (computed, cached per listing for 6 h)

```ts
Valuation {
  status: 'ok' | 'insufficient_data'
  estimatedRentCad?: number
  lowCad?: number, highCad?: number          // interquartile range of adjusted comparable rents
  differenceCad?: number, differencePct?: number   // positive = listing is below the estimate
  priceLabel: PriceLabel | 'unknown'         // section 7.2; 'unknown' when data is insufficient
  comparableCount: number                    // candidates considered; comparables may be a subset (empty when insufficient)
  effectiveCount: number                     // after the same-building cap (7.2); this drives the 5-comparable floor and confidence
  radiusM: number, windowDays: number
  confidence: 'low' | 'medium' | 'high'
  comparables: { listingId, rentCad, adjustedRentCad, distanceM, weight, lastSeenAt }[]
  adjustments: { code?, amountCad, count?, label }[]   // e.g. "utilities included: −$150 to compare", with (when known) how many comparables it moved
  benchmark: { label, valueCad, period, sourceId } | null   // context, never the estimate; null until D's benchmarks seed (P2.15)
  method: string
}
```

### MatchScore (computed per search)

```ts
MatchScore {
  total: number                               // 0–100, rounded
  parts: { id: 'value' | 'price' | 'travel' | 'home' | 'safety', score: number | null, weight: number, effectiveWeight: number, evidence: string[] }[]
  hardFilterNotes: string[]                   // e.g. "Pets: not confirmed"
  caveats: Caveat[]
}
Caveat { severity: 'info' | 'warning' | 'high', code: string, title: string, explanation: string }
```

---

## 6. Search & ranking pipeline

**Agreed search extensions (2026-10-16 [B]).** Unstated criteria impose no constraints; household size does not imply bedrooms; money is CAD/month and numeric rooms mean bedrooms unless shared accommodation is explicit. A search-only `studio` choice matches a known whole-unit type with bedrooms 0; room OR studio does not add a conjunctive bedroom filter. Broad places use labelled representative points; ambiguous campuses/branches require structured choices. Missing routing stays a labelled straight-line distance with an unconfirmed time requirement; hide-unconfirmed removes it. Alternative-mode scoring uses the best available normalized score per destination.

Numeric sorts order the full eligible pool before the ordinary 500-candidate cap. Explicit percentiles apply all hard requirements first, then select known values using `min(N, max(minimumCount, ceil(N * percentage / 100)))`, with minimumCount 10 by default and existing cutoff tie-breakers. Building-age percentiles compare age in years, not build year. Multiple percentile fields require clarification. Scalar percentiles precede the cap. Exact travel percentiles route the full eligible pool and all requested modes, use the shortest requested time per destination, run asynchronously for at most two minutes, and return explicit unavailability if routing is incomplete; no exact partial result is returned. Ordinary search keeps its existing cap/routing budget.

1. **Parse.** `/api/search/parse` sends the prompt to Gemini with the `SearchIntent` schema (section 10.1). The server validates with zod, drops invalid values, resolves travel-target places (section 7.4), and fills `fieldSources`. Fallback: keyword/regex parser.
2. **Edit.** The UI shows every criterion as a chip: hard ones solid, preferences outlined, defaults dashed. Users can edit, remove, toggle hard ↔ preference, or add a chip. Re-running search never re-calls Gemini unless the prompt text changes.
3. **Candidate query (SQL).** Active, non-duplicate listings matching hard criteria with known values, plus listings whose value for a hard field is unknown (marked "not confirmed"); area filters via `ST_Within`; hard amenity targets via the precomputed `travel_times`; hard safety via the neighbourhood's rate. Limit 500 candidates.
4. **Enrich.** For each candidate: valuation and price label (cached), precomputed travel times to each amenity target, straight-line distance to each ad hoc place, building record, area ids, neighbourhood crime rate (only if safety is on).
5. **Score, pass 1** with the engine (section 7.5), using straight-line distance for ad hoc places.
6. **Route, pass 2.** For the top 100, get OTP times to each ad hoc place in the requested mode (parallel, 3 s budget, cached), drop any that fail a hard time limit, and score again. Results not routed in time keep their straight-line label.
7. **Sort** by the chosen mode.
8. **Return** ranked results with full score breakdown, caveats and evidence. Target < 2 s (< 3.5 s when ad hoc places need routing).
9. **Explain (on demand).** The listing detail page calls `/api/listings/[id]/explain` with only computed facts; Gemini writes 2–4 sentences (section 10.2).

**Error handling:** if Gemini fails, the filter form works by hand. If valuation, OTP or POI data is missing, listings still show, with explicit "not available" states.

---

## 7. Engine (deterministic)

All functions are pure and live in `packages/shared/engine`. Constants live in `packages/shared/engine/config.ts` with comments, and every tunable value is listed on the `/data` methodology page.

### 7.1 Hard filters

Applied in SQL, mirrored in `filters.ts` for pasted listings, for every criterion marked `hard`. Rent compares against `monthlyRentCad` (for rooms, per-room rent). Bedroom filters exclude rooms unless the user asks for rooms. Building age compares `yearBuilt`; AC `'any'` accepts `central` or `yes`. A hard `priceFairness` drops listings whose label isn't allowed. Unknown values (including `priceLabel: 'unknown'` and a missing travel time) pass but get a "not confirmed" note, so sparse listings aren't silently hidden; a toggle "Hide listings that don't confirm my must-haves" removes them.

### 7.2 Valuation from comparables

- **Pool:** active or stale listings (seen in the last 60 days), not duplicates, not the listing itself, same `unitType` class (`room` only vs rooms; `basement` vs basement + apartment with a basement flag; others pooled), same bedroom count, bathrooms within ±1.
- **Radius:** start at 1 km; widen to 2 km, then 3 km, until there are at least **5** comparables. If fewer than 5 at 3 km → `insufficient_data`.
- **Adjustments** to put comparables on the listing's terms (sample values, editable in config): utilities included ±$150/month; parking ±$100; furnished ±$150; in-suite laundry ±$50. Each adjustment is listed on the detail page.
- **Same building:** floor plans in one building (same RentSafeTO building, else same Address Point) count as at most 2 comparables: their weights are scaled by 2 ÷ (plans in that building), and the 5-comparable floor and confidence use the capped count.
- **Weights:** `w = distanceWeight × recencyWeight × similarityWeight` where distance weight = `1 / (1 + d/500 m)`, recency weight = 1 for ≤ 14 days, decaying to 0.5 at 60 days, similarity weight = 1 − 0.15 × |Δbathrooms| − 0.1 × (sqft known and differs > 25%).
- **Estimate:** weighted median of adjusted comparable rents; range = weighted 25th–75th percentiles.
- **Confidence:** high if N ≥ 12 and (IQR / median) ≤ 0.15; medium if N ≥ 8 or IQR/median ≤ 0.25; else low.
- **Difference:** `differencePct = 100 × (estimate − listed) / estimate` (positive = below estimate).
- **Price label** (the "how reasonable is the price" answer, configurable):

  | Label | Rule (medium/high confidence) | Rule (low confidence) |
  | --- | --- | --- |
  | **Underpriced** | listed ≥ 10% below the estimate | ≥ 15% below |
  | **Reasonably priced** | less than 10% either way | less than 15% either way |
  | **Overpriced** | listed ≥ 10% above the estimate | ≥ 15% above |
  | *Not enough data* | fewer than 5 comparables | |

  The wider band at low confidence keeps thin data from producing confident labels.
- **Wording:** the badge reads "Underpriced", "Reasonably priced" or "Overpriced", always with the number underneath ("$180 (8%) below similar listings nearby") and "compared with asking rents for similar listings, not signed leases" on tap. Never "a steal" or "guaranteed deal". Listings more than 30% below also get the `rent_far_below` caveat (7.7).
- **Benchmark (context, never the estimate):** Statistics Canada quarterly asking rent for the Toronto CMA and bedroom count (table 46-10-0092-01) and the CMHC Rental Market Survey zone average (occupied and vacant units, so usually lower than asking rents; the UI says why). Shown even when comparables are insufficient.

### 7.3 Affordability (true monthly cost)

- **Rent-to-income:** if the user gives income, show rent ÷ (income / 12) with the 30% shelter-cost benchmark used by CMHC and Statistics Canada. Show the number, not a judgement.
- **True monthly cost** = rent + utilities estimate (if not included; sample value by unit size, labelled) + transportation (TTC adult monthly pass price from ttc.ca stored in `benchmarks`, per person who commutes by transit; or "car" mode with a sample monthly cost from the CAA driving costs calculator, labelled).
- Shown on the detail page and as an optional sort ("lowest true monthly cost").

### 7.4 Travel time to places and amenities

Users can ask for time to **places** (job, campus, a relative's home) and to **amenities** (the nearest supermarket, school, library, park, pharmacy, clinic, rapid transit station…) by **public transit, car, walking or bike**, a primary mode plus optional alternative modes per target ("15 min walk or bike to a supermarket and 30 min by transit to work"). Alternatives use OR; separate destinations must each satisfy their own requirement.

- **Places** resolve in order: a small `known_places.json` (campuses, hospitals, major stations and employment hubs, with coordinates), City Address Points, then MapTiler geocoding. The resolved point and source show on the chip; users can drag the pin to correct it.
- **Router:** OpenTripPlanner 2 on Vultr (section 3). Modes and labels:
  - **Transit:** TTC schedule, weekday departure 8:30 am, includes walking to and from stops. Label "TTC, weekday 8:30 am".
  - **Walk:** street and path network, 4.8 km/h. Label "walking".
  - **Bike:** street network with OTP's bike profile (prefers bike lanes). Label "cycling".
  - **Car:** road network, **free-flow (no traffic)**, no parking search. Label "driving, no traffic"; never presented as a rush-hour time.
- **Amenities are precomputed:** after each ingest the worker routes every active listing to the 2 nearest (straight-line, PostGIS KNN) of each category in all four modes and keeps the faster in `travel_times` (~108k routes for 1,500 listings; ~1.5 h at 20 requests/s). Order: new listings first, then the categories used by the demo prompts, then the rest. School targets respect `schoolLevel`.
- **Places are routed at search time** for the top 100 results (section 6, pass 2) and cached by origin (rounded to 50 m) × destination × mode. `known_places` are precomputed like amenities.
- **Default targets** when the user doesn't give minutes (editable in config and on the chip):

  | Category | Walk | Bike | Transit | Car |
  | --- | --- | --- | --- | --- |
  | Supermarket, pharmacy, rapid transit | 10 | 10 | 15 | 10 |
  | School, library, park, community centre, clinic | 15 | 10 | 20 | 10 |
  | Place (job, campus) | 20 | 20 | 30 | 25 |

- **Fallback:** if OTP is down or a time isn't computed yet, use straight-line distance against a per-mode distance target (walk 800 m, bike 3 km, transit 3 km, car 6 km for the default times, scaled for custom times). It is labelled "straight-line distance, travel time not available" and is **never shown as minutes**.
- **Shown on the detail page:** every target with its time in the chosen mode, plus the other three modes for comparison, the name of the amenity reached, and the count of that amenity within 800 m.

### 7.5 Match score

Hard criteria first; then for each surviving listing five parts, each 0–100 or `null` when it doesn't apply or there's no data:

| Part | Default weight | How it's scored |
| --- | --- | --- |
| **Value** (price vs market) | 30% | `differencePct` mapped linearly: −20% → 0, 0% → 50, +20% → 100 (clamped). `null` if insufficient data. If the user asks for a good deal or a soft `priceFairness`, weight → 45%. |
| **Price** (price range) | 15% | Only when `rent` is a preference: inside the range → 100; above the max, falling linearly to 0 at 15% over; below a stated min → 100. `null` if rent is a must-have or not given (must-haves already excluded the rest). |
| **Travel** | 30% | Per target: at or under the target time → 100, falling linearly to 0 at 2× the target; averaged across targets. Straight-line fallback uses the distance targets the same way. `null` if no targets. |
| **Home** (the unit itself) | 25% | Average over the soft criteria the user gave, each scored 0–100 (below); unknown values are left out, not counted as failures. `null` if no soft unit criteria. |
| **Safety** | 0% (15% when turned on) | Section 7.6. `null` unless the user turns safety on. |

**Home sub-scores** (`home-fit.ts`):
- Bedrooms / bathrooms: inside the range → 100; one off → 50; more → 0.
- Size: inside the range → 100; falling linearly to 0 at 25% outside it.
- Unit type: listed type → 100; otherwise 0.
- Building age: inside the range → 100; falling linearly to 0 at 20 years outside it.
- Air conditioning: central → 100; other AC → 100 for `'any'`, 60 for `'central'`; none → 0.
- Pets, furnished, parking, laundry, utilities: matches → 100; doesn't → 0.
- Available by: on or before the date → 100; falling to 0 at 30 days late.

**Rules:**
- **Renormalize:** effective weight = weight ÷ sum of weights of non-null parts. Total = Σ score × effective weight. Shown in the breakdown so the bars always add up to the total.
- **Tie-breakers:** newer `lastSeenAt`, then lower rent.
- Users can change weights with five sliders (P1); the default weights are shown, not hidden.

### 7.6 Safety preference (opt-in)

Off by default. Turned on by the user (a "Consider safety" switch, or prompt phrases like "safe area" or "low crime", which turn it on and show a chip the user can remove).

- **Data:** Toronto Police Service Neighbourhood Crime Rates (158 neighbourhoods), Major Crime Indicators per 100,000 residents: assault, break and enter, auto theft, robbery, theft over. Use the average of the last 3 published years to smooth noise.
- **Measure:** `relativeRate` = the neighbourhood's combined rate ÷ the city's combined rate. A listing inherits its neighbourhood's value; nothing is computed per building or street.
- **Score:** `relativeRate` ≤ 0.5 → 100, ≥ 2.0 → 0, linear between (the city average scores 67).
- **Must-have version:** "Below the city rate" excludes listings in neighbourhoods with `relativeRate` > 1.
- **What the user sees:** "Police-reported major crime here: 0.7× the city rate (2023–2025 average, TPS)" with a breakdown by type on tap. Never "safe", "unsafe", "dangerous" or a colour-coded safety map in search results.
- **Caveats shown wherever it appears:** reported crimes only; rates are per resident, so areas with many visitors and workers (downtown, malls, nightlife) show higher rates than residents experience; TPS offsets locations, so counts near boundaries can be misassigned; a neighbourhood average says nothing about a specific street or building; describes places, not the people who live there.
- **Explanations:** Gemini may mention the rate only as the number above, with the caveat; it may not characterize a neighbourhood or its residents.

### 7.7 Caveats (shown on cards and detail)

Each has a code, severity and plain explanation:
- `rent_far_below` (warning): listed > 30% below the comparable estimate → "Unusually low for this area. Verify the listing is real before sending money." (scam indicator, P1)
- `duplicate_text_elsewhere` (warning, P1): same description on another listing at a different address/price.
- `deposit_before_viewing` (high, P1): description asks for e-transfer/deposit before a viewing (keyword rules).
- `approx_location` (info): location is street- or area-level.
- `stale` (info): not seen for 8+ days.
- `fields_unknown` (info): key fields missing (utilities, pets…).
- `rentsafeto_low` (info): building's latest score below 66% (the City's threshold for yearly evaluation), with the date.
- `price_dropped` (info): asking rent fell since first seen (from observations).
- `insufficient_comparables` (info).

All scam-related caveats are framed as indicators, never accusations.

### 7.8 Tests

Vitest coverage for: intent validation and dropped requests; hard criteria with unknowns (incl. size, age, AC, price label, travel time); comparable selection, radius widening and the 5-comparable floor; adjustments; weighted median/percentiles; confidence; price label bands at each confidence level; travel scoring and the straight-line fallback; home sub-scores; safety score, hard version and off-by-default; score parts, renormalization and sum consistency; caveat rules; affordability; dedupe matching; each source adapter against saved HTML fixtures; scrubbing of phone numbers and emails.

---

## 8. Data

### 8.1 Toronto civic data (loaded by `pnpm data:civic` into TigerData)

All under the Open Government Licence – Toronto unless noted. Each loader records source URL, retrieval date and licence in a `sources` table, shown on `/data`. **P0.4 confirms every link and dataset name below before loading** (some City datasets get retired and replaced, e.g. the original RentSafeTO evaluation dataset).

> **Verified 2026-10-16 (P0.4).** Every link below resolved, and the resource each loader fetches was fetched and inspected; details, exact resource URLs, licences and the corrections are in `docs/datasets.md`. Note that `open.toronto.ca` answers HTTP 200 for any slug, so a 200 there proves nothing — resolve slugs through the CKAN API (`ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=<slug>`).

| Dataset | Used for | Link |
| --- | --- | --- |
| Neighbourhoods (158) boundaries | area lookup, explorer map | https://open.toronto.ca/dataset/neighbourhoods/ |
| Neighbourhood Profiles (2021 Census) | renter share, shelter cost burden, income | https://open.toronto.ca/dataset/neighbourhood-profiles/ (2021 file is XLSX only, 158-model; the CSVs are 2001–2016) |
| Neighbourhood Improvement Areas | NIA flag (context only) | https://open.toronto.ca/dataset/neighbourhood-improvement-areas/ |
| City Wards (25) boundaries | ward lookup, ward pages | https://open.toronto.ca/dataset/city-wards/ |
| Ward Profiles (25-ward model, 2021 Census) | ward indicators | https://www.toronto.ca/city-government/council/ward-profiles/ (HTML only, no data feed — compute ward indicators from the tables below) |
| Apartment Building Registration | RentSafeTO building list, storeys, units, year built | https://open.toronto.ca/dataset/apartment-building-registration/ |
| Apartment Building Evaluations (current) | RentSafeTO scores and dates | https://open.toronto.ca/dataset/apartment-building-evaluation/ — holds "2023 - current" plus "Pre-2023" resources |
| Address Points (Toronto One Address Repository) | geocoding listing addresses offline, building matching | https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/ |
| TTC Routes and Schedules (GTFS) | transit stops, rapid transit access, OTP | https://open.toronto.ca/dataset/ttc-routes-and-schedules/ |
| Development Applications | applications and proposed units near listings and per area | https://open.toronto.ca/dataset/development-applications/ |
| Building Permits – Active | new residential construction (P1) | https://open.toronto.ca/dataset/building-permits-active-permits/ |
| Library Branch General Information | libraries | https://open.toronto.ca/dataset/library-branch-general-information/ |
| Parks and Recreation Facilities | parks, community centres | https://open.toronto.ca/dataset/parks-and-recreation-facilities/ |
| School Locations – All Types | schools | https://open.toronto.ca/dataset/school-locations-all-types/ |
| 311 Service Requests (P1) | most common requests near a listing | https://open.toronto.ca/dataset/311-service-requests-customer-initiated/ |
| 2026 Municipal Election info | election date, official candidate list link, voting places | https://www.toronto.ca/city-government/elections/ |

Also ask the School of Cities organizers for the **Toronto Civic Data Starter Guide** and add anything useful from it here.

### 8.2 Other public data

| Source | Used for | Link |
| --- | --- | --- |
| Toronto Police Service Public Safety Data Portal: Neighbourhood Crime Rates | opt-in safety preference (7.6) and area card: per-100k rates by neighbourhood and year, with TPS caveats | https://data.tps.ca/datasets/TorontoPS::neighbourhood-crime-rates-open-data (the old `data.torontopolice.on.ca/pages/open-data` link now redirects to the portal root) |
| Statistics Canada table 46-10-0092-01 (Quarterly rent statistics, experimental) | Toronto CMA asking-rent benchmark by bedrooms and rooms | https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=4610009201 |
| CMHC Rental Market Survey data tables (Oct 2025) | average rent by survey zone and bedroom count | https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-data/data-tables/rental-market/rental-market-report-data-tables |
| OpenStreetMap (Geofabrik Ontario extract) | supermarkets and grocery stores (`shop=supermarket`, `shop=greengrocer`, larger `shop=grocery`), pharmacies, clinics (City has no grocery dataset); OTP street, path and road network | https://download.geofabrik.de/north-america/canada/ontario.html (ODbL; credit "© OpenStreetMap contributors") |
| TTC fares | monthly pass price for true monthly cost | https://www.ttc.ca/fares-and-passes |

### 8.3 Benchmarks file

`benchmarks` table (seeded from `db/seed/benchmarks.json`): StatCan CMA asking rent by bedrooms (latest quarter and last 8 quarters), CMHC zone averages mapped to neighbourhoods by centroid (approximate; labelled), TTC monthly pass price, sample utilities and car costs. Every row has `sourceId`, `period`, `retrievedAt`, and `sample: boolean`.

### 8.4 Listings: sources and ingestion

Sources the team wants, one adapter each in `apps/worker/src/sources`, each exporting `{ id, displayName, fetchIndex(cursor), fetchDetail(url), parse(html) → RawListing[] }`:

| Source | Approach | Notes |
| --- | --- | --- |
| **Kijiji** (Toronto long-term rentals) | search pages; results embedded as JSON (`__NEXT_DATA__`) | go |
| **TorontoRentals.com** (Rentals.ca network) | search pages; results from the page's /graphql call | go |
| **Rentals.ca** | same platform as TorontoRentals.com | no-go: not blocked with CloakBrowser, but no results response captured |
| **Zillow** (Toronto rentals) | search pages (`__NEXT_DATA__`) | go (with CloakBrowser) |
| **Realtor.ca** (rentals) | map page search response | go (with CloakBrowser) |
| **Facebook Marketplace / groups** | not collected (needs a login; Meta's terms prohibit automated collection) | covered by **Paste a listing** (section 10.3): the user pastes text or a link they're looking at, it's parsed and scored in their browser only |
| `manual` | hand-curated rows in `db/seed/manual.csv` | backup for the demo if adapters break |

**Rules for every adapter (enforced in shared code, not per adapter):**
- Store only the fields in `Listing`; description → ≤ 280-char excerpt after scrubbing phone numbers, emails and personal names (regex + simple heuristics); never store photos (an optional thumbnail URL only if the source's terms allow linking).
- Every listing keeps `sourceUrl`; the UI always links back to the source and never presents the listing as ours.

**Pipeline (worker, every 6 h, plus `pnpm ingest:once`):**
1. Fetch index pages for Toronto rentals → detail pages for new or changed listings.
2. **Normalize** to `RawListing` → `Listing`: rent to monthly CAD, bedrooms (studio/bachelor = 0, "1+den" = 1 with den flag), unit type, size (sq ft; m² converted), year built ("built in 2018", "new construction" → listing year, "brand new building"), air conditioning ("central air", "A/C", "window unit"), tri-state amenities, from structured fields first, then keyword rules on text (`fieldEvidence` records which). After the building match (step 4), a missing `yearBuilt` is filled from the RentSafeTO registration (`yearBuiltSource: 'rentsafeto'`).
3. **Geocode:** exact address → Address Points match (`pg_trgm` similarity on normalized address); intersection or street → street-level point; neighbourhood name only → area centroid with `locationPrecision: 'area'`. Listings outside the City of Toronto boundary are dropped.
4. **Area join:** `ST_Within` against neighbourhoods and wards; building match by `address_point_id` (or within 15 m with matching street number).
5. **Dedupe:** candidate pairs within 50 m with same bedrooms and rent within 3%, or trigram similarity of title+excerpt ≥ 0.6 → the older record becomes canonical, the other gets `duplicateOf` (results show "Also on: Kijiji, Rentals.ca").
6. **Upsert** listing and insert a `listing_observations` row; mark `stale` / `removed` by `lastSeenAt`.
7. **Travel times:** queue new and moved listings for amenity and `known_places` routing (section 7.4).
8. **Optional AI cleanup (P1):** listings with many unknown fields get one Gemini Flash-Lite extraction call over the excerpt (section 10.4), cached by content hash.

### 8.5 Demo snapshot and data handling

- Before the demo, run a full ingest and save a **snapshot** in TigerData (listings marked `dataStatus: 'snapshot'` with the snapshot date shown in the UI). The demo must not depend on live scraping.
- Snapshot files and raw HTML fixtures are **git-ignored** and stay on the Vultr instance and team machines; scraped content is not published in the public repo.
- Target: **≥ 1,500 active Toronto listings** across at least two sources, so comparables work in most central neighbourhoods. If ingestion falls short, the `manual` source and pasted listings keep the demo whole, and the app says how many listings it has.
- Listings are deleted 30 days after the hackathon unless the team confirms each source's terms allow keeping them.

---

## 9. Neighbourhood & ward context (the civic layer)

### 9.1 Area card (on every listing)

A compact card on the listing detail page: neighbourhood and ward names, then 5–6 indicators each compared with the city-wide value:
- Typical asking rent for this bedroom count here (our listings, last 30 days, N shown; "insufficient data" under 5).
- Renter households (% of households, 2021 Census).
- Renters spending 30%+ of income on shelter (2021 Census).
- Rapid transit within 800 m (% of area or yes/no for the listing).
- RentSafeTO buildings and their average score.
- Development applications in the last 12 months within 500 m of the listing, with proposed residential units (links to the City's Application Information Centre).
- Police-reported crime rates (shown when the safety preference is on, or via a "Show police-reported crime rates" toggle): rate vs city, years, breakdown by type, and the caveats in section 7.6.

### 9.2 Explorer (`/areas`)

- Choropleth of the 158 neighbourhoods (toggle to 25 wards) for **one indicator at a time**, picked from a dropdown. Legend shows quantiles and the city value. No composite "best neighbourhood" score.
- Click an area → side panel with all indicators, their periods and sources, and a link to listings there.
- **Compare areas** (P1): up to 3 areas side by side.
- **Housing pressure view:** the dropdown includes rent burden, renter share, development activity and RentSafeTO scores so organizers and journalists can explore pressure without the app ranking places for them.

### 9.3 Ward briefing (AI, grounded)

`/areas/ward/[n]` shows a "Housing in your ward" briefing: 3 short paragraphs written by Gemini **only from the computed indicators** for that ward and the city (section 10.5), then the indicator table it was written from. Every number in the text is checked against the input; failure → regenerate once → template text.

**Election info box (no AI):** election date (Monday, October 26, 2026), advance voting, links to the City's official candidate list and "where to vote" pages. After election day it switches to a link to official results. The app never summarizes, compares or ranks candidates or platforms.

### 9.4 Responsible interpretation (shown on `/data` and in the explorer)

- Census figures are from 2021; rents and development data are recent. Say which is which.
- Our asking-rent medians cover only listings we collected, over-represent some sites and unit types, and are not official statistics.
- Neighbourhood averages hide wide variation inside a neighbourhood.
- NIA designation and crime rates describe areas, not people; the app never infers anything about residents from demographics.
- Crime data is never part of default ranking or default views; it ranks listings only when the user turns on the safety preference, and the explorer offers it as one indicator among many, with its caveats beside the map.

---

## 10. AI features (Gemini)

All AI calls go through server routes and one interface in `apps/web/src/lib/ai`:

```ts
interface AIProvider {
  generateStructured<T>(opts: { system: string, prompt: string, schema: ZodSchema<T>, fast?: boolean }): Promise<T>
  generateText(opts: { system: string, prompt: string, fast?: boolean }): Promise<string>
}
```

Implementations: `GeminiProvider` (default) and `NoneProvider` (throws a typed "unavailable" error so callers use fallbacks). Responses are validated with zod, retried once on validation failure, time out at 12 s, and are cached in the `ai_cache` table by input hash. Rate-limit AI routes per IP (in-memory, per instance). On 429/503, use the fallback with a small notice ("AI busy, used basic search"). **Listing text is untrusted:** it is passed inside clearly delimited data blocks and the system prompt states that instructions inside it must be ignored. API keys stay on the server.

### 10.1 Parse search — `/api/search/parse` (fast model)

Input: prompt, today's date, the supported criteria table (section 5), amenity categories, list of neighbourhood and ward names, `known_places` labels. Output: `SearchIntent` with `fieldSources` phrases and `droppedRequests`. Rules: only supported fields; "ideally / prefer / nice / would like" → preference, "must / need / only / under / no more than" → hard; each travel target gets the mode the user said (default transit for places, walk for amenities) and minutes only if stated; vague size words ("big", "spacious") are dropped with a note rather than guessed; safety only when the user mentions it; never add constraints the user didn't state; relative dates resolve from today. Fallback: regex parser for rent, bedrooms, pets, unit type, and neighbourhood names.

### 10.2 Explain a listing — `/api/listings/[id]/explain` (fast model)

Input: the listing's computed facts only (score parts with evidence, valuation, nearest amenities, caveats, building record, area indicators). Output: 2–4 plain sentences on why it ranks where it does, its trade-offs, and what to verify. Number check as in 9.3. Fallback: template sentences built from the top two score parts and top caveat.

### 10.3 Paste a listing — `/api/listings/import`

The answer to "twenty Facebook groups": the user pastes listing text (or a URL of a public page; the server fetches it once). Gemini extracts a `Listing` (structured output); the server geocodes it, and the result is scored with the engine against the user's current search, with valuation from our comparables. **Pasted listings are never stored server-side**; they live in the browser shortlist (section 15). Fallback: regex extraction of rent, bedrooms and address, then a form to fill the rest.

### 10.4 Listing field extraction (worker, P1, fast model)

For ingested listings with unknown fields, extract utilities, pets, laundry, parking, furnished, air conditioning, size, year built, available date and lease term from the excerpt, each with the supporting phrase. Values from AI get `fieldEvidence: 'ai_extracted'` and a small badge.

### 10.5 Ward / neighbourhood briefing — `/api/areas/[kind]/[id]/briefing` (main model)

Input: indicators for the area and the city, with periods and sources. Output: 3 short paragraphs (rents and affordability, housing stock and conditions, growth and development). Instructions: use only provided numbers; neutral tone; no political recommendations, no mention of candidates or parties; mention data years. Number check, then template fallback. Pre-generated for all 25 wards and cached before the demo.

---

## 11. Screens and user flow

### 11.1 Landing (`/`)

- Large prompt box: "Describe the place you're looking for", with 3 example chips (one student, one family, one "rooms" search).
- Secondary: "Explore neighbourhoods" → `/areas`, and "Paste a listing".
- Small footer line: listing count, sources, last updated, "Asking rents, not official statistics".

### 11.2 Results (`/search`)

- Top: editable filter chips (must-have solid, preference outlined, default dashed; each with its source phrase on hover/tap and a must-have ⇄ preference switch), a "dropped" notice if any, sort selector, and a **Filters** button.
- **Filters panel** (sheet on mobile, side panel on desktop) lists every criterion from section 5 in groups, each with a must-have / preference switch: *Price* (range, price vs market: underpriced / reasonably priced / overpriced), *Home* (bedrooms, bathrooms, size, unit type, building age, AC, pets, furnished, parking, laundry, utilities, availability, lease), *Getting around* (add a place or an amenity, pick transit / car / walk / bike, set minutes), *Safety* (off by default; switch plus a one-line explanation and "How this works" link to the caveats), *Area*. Editing a chip or the panel re-runs search without calling Gemini.
- Desktop: list (~45%) and map (~55%), synced: hovering a card highlights its pin; clicking a pin scrolls to the card. Mobile: list with a sticky "Map" toggle; tapping a pin opens a bottom sheet.
- **Card:** source thumbnail or neutral placeholder, rent/month, bedrooms/bathrooms, size and year built when known, neighbourhood, match score with a bar segmented by part, price badge ("Underpriced" / "Reasonably priced" / "Overpriced" / "Not enough data") with the % underneath, the first two travel targets with mode icon and minutes (or "straight-line" distance), AC icon if present, safety rate if on, top caveat, source + "seen 2 days ago", "Also on" if deduped, add to shortlist.
- Map: listing pins (approximate locations drawn as circles), destination pins, optional neighbourhood boundary layer.

### 11.3 Listing detail (`/listing/[id]`)

Sections in order: header (rent, beds/baths, address or area, source link button, freshness, data status); **Why it ranks here** (AI explanation + score breakdown bars with evidence); **Rent check** (price label, estimate, range, difference, confidence, comparables table and mini map, adjustments, benchmark); **The home** (size, year built and its source, AC, the other unit fields, unknowns marked); **True monthly cost** (if income or a travel mode is given); **Getting around** (each travel target with the amenity or place reached and its time by transit, car, walk and bike, the chosen mode highlighted; nearest stops); **Nearby** (amenities by category); **Safety** (only if on: rate vs city with caveats); **Building** (RentSafeTO score, date, sign colour, what the score means, or "not in RentSafeTO: program covers 3+ storeys and 10+ units"); **Area** (area card, section 9.1); **Things to check** (caveats); fields we couldn't confirm.

### 11.4 Explorer (`/areas`, `/areas/[kind]/[id]`)

As in section 9.2 and 9.3.

### 11.5 Shortlist & compare (`/compare`, P1)

Up to 4 listings side by side: rent, price label, true monthly cost, score parts, size, year built, AC, travel times per target and mode, building score, area indicators, safety (if on), caveats. Rows highlight the best value per row.

### 11.6 `/data` and `/status`

- `/data`: every dataset with link, period, retrieval date, licence and how it's used; methodology (valuation, score, weights, thresholds); limitations (section 9.4); how listings are collected and handled (8.4–8.5); AI use and what is sent to Gemini.
- `/status` (for judges and the team): live counts from TigerData (listings by source and status, observations, areas), last ingest time per source, Vultr host name/region, AI provider status, OTP status.

---

## 12. Map features

- MapLibre map with a clean basemap, geocoding search, zoom controls, scale bar; satellite toggle if the tile provider supports it.
- Listing pins clustered at low zoom; colour by match score band; approximate locations as 150–300 m circles.
- Destination pins (draggable to correct geocoding).
- Layers (toggle): neighbourhood boundaries, ward boundaries, rapid transit lines and stations (from GTFS shapes), RentSafeTO buildings coloured by sign colour, development applications (P1).
- Explorer choropleth (section 9.2) with hover tooltip (name, value, period).
- Travel targets: place pins and, for the selected listing, the amenity reached for each target with the route line (from OTP).
- Isochrone overlay for a destination (P2, from OTP).

---

## 13. API contract

All bodies validated with zod; errors as `{ error: { code, message, issues?, retryAfterSeconds? } }`; 422 for validation, 429 with `Retry-After`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/search/parse` | text → `SearchIntent` |
| `POST` | `/api/listings/search` | `SearchIntent` → ranked results with `MatchScore` |
| `GET` | `/api/listings/search/jobs/[token]` | poll an exact travel percentile job; expired/consumed/restarted jobs return 410 |
| `GET` | `/api/listings/[id]` | detail, building, area ids, duplicates |
| `GET` | `/api/listings/[id]/valuation` | `Valuation` with comparables |
| `GET` | `/api/listings/[id]/nearby?categories=` | nearest POIs and stops |
| `POST` | `/api/listings/[id]/travel` | travel targets → times in all four modes, amenity reached, method (`otp` / `straight_line`) |
| `GET` | `/api/areas/[kind]/[id]/safety` | crime rates vs city, years, by type, caveats (used when safety is on) |
| `POST` | `/api/listings/[id]/explain` | AI explanation (cached) |
| `POST` | `/api/listings/import` | pasted text/URL → scored `Listing` (not stored) |
| `POST` | `/api/listings/score` | score a client-held listing against an intent |
| `GET` | `/api/areas?kind=&indicator=` | choropleth values |
| `GET` | `/api/areas/[kind]/[id]` | all indicators for one area |
| `GET` | `/api/areas/[kind]/[id]/briefing` | AI briefing (cached) |
| `GET` | `/api/geo/resolve?q=` | destination resolution |
| `GET` | `/api/health` | DB, AI, OTP, last ingest |

Search requests wrap `{ intent: SearchIntent, hideUnconfirmed?: boolean }`. Search responses distinguish `completed` (results/count/notices), `pending` (opaque job token, polling URL, expiry), and explicit `unavailable` outcomes. Jobs are bounded, temporary and in memory: execution at most 120 seconds, retained at most 180 seconds after submission, removed on first terminal poll or expiry. No prompts or job payloads are persisted or logged. Restart loses jobs and polling returns `search_job_expired`. Detail search context excludes original prompt/source phrases. Exact application request/response schemas and examples are maintained in `apps/search/DOCS.md`; database adapters and owner definitions remain separate.

Sample search result item:

```json
{
  "id": "6b1e…",
  "monthlyRentCad": 2650,
  "bedrooms": 2,
  "neighbourhood": "Annex",
  "ward": "11 University—Rosedale",
  "sqft": 820, "yearBuilt": 2012, "airConditioning": "central",
  "matchScore": { "total": 84, "parts": [
    { "id": "value", "score": 68, "effectiveWeight": 0.35, "evidence": ["Reasonably priced: $210 (7%) below 9 similar listings within 1.5 km"] },
    { "id": "travel", "score": 95, "effectiveWeight": 0.35, "evidence": ["UofT St. George: 14 min by TTC (weekday 8:30 am)", "Supermarket: 6 min walk (Metro, Bloor St W)"] },
    { "id": "home", "score": 90, "effectiveWeight": 0.30, "evidence": ["Cats allowed", "Central air", "820 sq ft (wanted 750+)"] },
    { "id": "price", "score": null, "effectiveWeight": 0, "evidence": [] },
    { "id": "safety", "score": null, "effectiveWeight": 0, "evidence": [] } ] },
  "valuation": { "status": "ok", "estimatedRentCad": 2860, "differencePct": 7.3, "priceLabel": "reasonable", "comparableCount": 9, "confidence": "medium" },
  "caveats": [{ "code": "fields_unknown", "severity": "info", "title": "Utilities not stated" }],
  "source": "rentals_ca",
  "sourceUrl": "https://…",
  "lastSeenAt": "2026-10-14T18:02:00Z",
  "dataStatus": "snapshot"
}
```

---

## 14. Use of the required technologies (what judges must see)

| Track | Meaningful use | Shown in the demo |
| --- | --- | --- |
| **Gemini** | Structured intent parsing with hard/soft separation and source phrases; pasted-listing extraction; grounded explanations and ward briefings with a number check; field extraction in the worker | Prompt → chips; paste a Facebook post → scored listing; "Why it ranks here"; ward briefing |
| **TigerData** | PostGIS (area joins, KNN nearest amenities, `ST_DWithin` comparables), precomputed `travel_times`, TimescaleDB hypertable of price observations + continuous aggregate of weekly median asking rent per neighbourhood, `pg_trgm` for dedupe and address matching | `/status` live counts; rent trend sparkline on an area page; show one comparable query and its timing |
| **Vultr** | Hosts the web app, the ingestion worker and its schedule, and the OpenTripPlanner router that computes every transit, car, walk and bike time | `/status` shows host, last ingest and travel times computed; brief look at the Vultr console |
| **School of Cities** | Toronto open data at the core of every listing and the explorer; neighbourhood and ward framing; neutral election info | Area card, explorer, ward briefing, `/data` with links |

---

## 15. Persistence (no accounts)

- **Server:** listings, observations, civic data and caches in TigerData. No user data is stored; search intents are not logged beyond request counts.
- **Browser:** the shortlist (listing ids and pasted listings) and the last search live in `localStorage`, wrapped in try/catch so the app works without it. "Clear my data" button on the shortlist.
- Share a search as a URL (intent encoded in the query string, no server storage).

---

## 16. Demo data

- **Snapshot** of ingested listings in TigerData (section 8.5), dated in the UI.
- **Three demo prompts** with cached parse and explanation outputs:
  1. Student: "Room or studio near York University under $1,300, close to the subway, furnished."
  2. Couple: the example in section 1 (2-bed near UofT St. George, cat, value).
  3. Family: "3 bedrooms in Scarborough under $3,200, near a public school and a park, parking."
- **One pasted listing** (a Facebook Marketplace-style post written by the team) to demo the import flow.
- **Ward briefings** pre-generated for all 25 wards.

---

## 17. Internationalization

English only. All UI strings in `apps/web/messages/en.json`, read with the typed `t("namespace.key", params?)` helper in `apps/web/src/lib/format/messages.ts` (works in server and client components; `{name}` placeholders). Numbers and currency via `Intl` for `en-CA`. French is a stretch goal and not planned.

---

## 18. Design direction

- Calm, trustworthy, civic. The listing and its numbers are the product; the map supports them.
- Typeface: Public Sans (or Inter) with tabular numerals for all figures.
- Palette: light neutral surfaces, deep slate text, one accent colour for primary actions and the match score; value badges green/neutral/amber; caveat severities blue/amber/red. Support dark mode if time allows.
- Mobile-first: full-width cards, sticky filter button, bottom sheets. Most renters will search on a phone.
- Accessibility: keyboard-usable controls, visible focus, WCAG AA contrast, labels on every input, alt text, colour never the only signal (bars have numbers, map colours have a legend and text), reduced motion respected, plain language (grade 8 target) in all explanations.

---

## 19. Non-functional requirements

- **Performance:** search < 2 s (excluding first AI parse); parse < 4 s with the fast model; detail page < 1.5 s with cached valuation.
- **Travel times:** amenity times for 1,500 listings × 9 categories × 4 modes precomputed within ~2 hours of a full ingest (the demo snapshot is fully precomputed before H30); search-time routing for ad hoc places within a 3 s budget.
- **Resilience:** every external call (Gemini, MapTiler, OTP, source sites) has a timeout, a cache where sensible, a user-friendly error state and a fallback.
- **Security:** keys only on the server; zod on every request body; rate limits on AI and import routes; pasted URLs fetched with a 5 s timeout, 2 MB cap, public `http(s)` only (block private IP ranges); listing text sanitized before rendering (no raw HTML).
- **Privacy:** no personal contact details stored (8.4); no user accounts; no analytics beyond request counts.
- **Code quality:** strict TypeScript, no `any` in the engine, small modules, engine unit-tested, lint + format configured.

---

## 20. Environment variables

```
# AI: gemini | none
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=              # current Flash model from Google's model list
GEMINI_MODEL_FAST=         # current Flash-Lite model

# TigerData
DATABASE_URL=              # postgres://… with sslmode=require

# Map & geocoding
NEXT_PUBLIC_MAPTILER_KEY=

# Travel times
OTP_URL=http://otp:8080
TRAVEL_PRECOMPUTE_RPS=20

# Worker
USER_AGENT="RentThe6ix hackathon bot (contact: team@example.com)"
INGEST_SOURCES=kijiji,torontorentals,zillow,realtor_ca,manual   # sources marked "go" in apps/worker/SOURCES.md
INGEST_INTERVAL_HOURS=6
INGEST_REQUEST_DELAY_MS=4000
INGEST_MAX_PAGES=3                 # index pages per source per run (pnpm ingest:once --pages N overrides)
INGEST_MAX_DETAILS=50              # listing pages per source per run, new or changed listings only (--details N)
```

Each developer keeps these in `.env.local` at the repo root; every env file, including `.env.example`, is git-ignored. The app must start and be usable (with fallbacks) when `AI_PROVIDER=none`, without a MapTiler key, and without OTP.

---

## 21. Deployment

- One Vultr Cloud Compute instance (Ubuntu LTS; 4 vCPU / 8 GB, since OTP needs ~4–6 GB for Toronto with all four modes), Docker Compose with `web`, `worker`, `otp` and Caddy. Build the OTP graph once on the instance (or locally) and keep it on disk; rebuilding takes several minutes. HTTPS via a domain or `sslip.io` hostname.
- TigerData service in the region closest to the Vultr instance (both in North America East). Enable `postgis`, `timescaledb`, `pg_trgm` in migration 001.
- GitHub Actions (or a simple `deploy.sh` over SSH): build image, push, `docker compose pull && up -d`.
- Write `DEPLOY.md` with exact steps. Deploy a placeholder by hour 3 and keep the deployment working after every phase.

---

## 22. Team roles & build phases

Each person keeps their own `PERSON_A.md` … `PERSON_D.md` (current state, handoff notes, requests to others, task list, dependencies, feature map). `PROGRESS.md` mirrors every task id with its owner. Commit messages: `P2.4 [C]: short description`.

### 22.1 Roles (4 people)

| Role | Owns | Contracts provided to others |
| --- | --- | --- |
| **A — Frontend & map** | Next.js app shell, design tokens, landing, results (list + map), filters panel and chips, listing detail, explorer UI, paste-a-listing UI, shortlist/compare, accessibility and mobile, demo flow on screen | Results store (`searchSlice`), selection contract (hovered/selected listing shared by list and map), UI components others can reuse |
| **B — AI & search API** | `AIProvider` + Gemini, `SearchIntent` schema and parser + fallback, search route (two-pass: SQL candidates → engine → OTP pass 2), match score with all five parts and home sub-scores, explain, paste-a-listing import, briefings + number check, AI cache, rate limiting | Shared schemas and API contracts in `packages/shared` by S1; fixtures; `scoreListing()` |
| **C — Listings pipeline & valuation** | Source adapters, scrubbing, normalize (incl. size, year built, AC), geocode, dedupe, observations hypertable, worker schedule, snapshot, valuation + price label, caveats incl. scam indicators, worker AI field extraction | ≥ 300 real listings by S2, ≥ 1,500 by S4; `valuate()` and `priceLabel()` by S3 |
| **D — Civic data, travel & infra** | TigerData setup and migrations, Vultr deploy, civic data loaders, POIs and transit stops, **OpenTripPlanner and travel-time precompute**, area indicators, **crime rates for the safety preference**, affordability, `/data` and `/status`, Devpost write-up and data links | Neighbourhoods/wards/POIs by S2; `travel_times` filled and `routeTimes()` by S3; indicators and `safetyFor(neighbourhoodId)` by S3 |

Everyone: write tests for their own engine/pipeline code; review one other person's PRs; rehearse the demo.

### 22.2 Contracts first and sync points

The first three hours are spent together on what lets four people work in parallel: `packages/shared/schemas` (SearchIntent with criteria and travel targets, Listing, Valuation, MatchScore, Area, API bodies), DB migrations, `.env.example`, a fixture file of 50 synthetic listings (with sizes, years, AC, precomputed travel times) and 3 areas, and the deployed placeholder. After that, each role builds against the contracts and fixtures and swaps in real data when it lands.

| Sync point | Hour | Everyone has |
| --- | --- | --- |
| **S1** | H3 | Contracts merged, placeholder live on Vultr, fixtures flowing API → UI |
| **S2** | H12 | Real listings and civic data in TigerData; prompt → chips works; results page on fixtures |
| **S3** | H18 | Real ranked search with valuation, price labels, travel times (OTP or labelled fallback), home fit; detail page live |
| **S4** | H24 | Full demo script (section 23) works end to end on the deployed app |
| **S5** | H30 | Feature freeze; only fixes, snapshot, polish and pitch after this |

### 22.3 Phases (H = hours from hacking start; tasks in `PERSON_*.md` and `PROGRESS.md`)

**Phase 0 — Foundation (H0–H3, → S1).** Monorepo scaffold, Tailwind/shadcn, Zustand, zod, Vitest, lint. [D] Tiger Cloud service + migrations; Vultr instance (8 GB) + Compose + Caddy; placeholder deployed; verify every dataset link in section 8. [B] shared schemas + API stubs returning fixtures. [A] layout shell, design tokens, static landing. [C] adapter interface + first adapter skeleton; source list in `apps/worker/SOURCES.md`.

**Phase 1 — Data in (H3–H12, → S2).** [C] two working adapters, normalize (incl. size, year built, AC), scrub, geocode, upsert, observations; first ingest. [D] neighbourhoods, wards, Address Points, TTC stops, POIs (City + OSM supermarkets), RentSafeTO buildings (incl. year built); area join SQL; OTP graph built and running. [B] Gemini provider, parse route with criteria + travel targets + safety, fallback parser, AI cache. [A] results page and filters panel against fixtures: chips with must-have ⇄ preference switch, cards, map.

**Phase 2 — Engine & search (H10–H18, → S3).** [C] comparables SQL, valuation, price label + tests; dedupe; RentSafeTO year-built fill. [D] travel-time precompute job + `routeTimes()` for ad hoc places; crime rates + `safetyFor()`; area indicators; benchmarks seed. [B] candidate query, two-pass search, match score (value, price, travel, home, safety) with renormalization + tests. [A] listing detail page: score breakdown, rent check with price label, the home, getting around (4 modes), building, area card.

**Phase 3 — Explanations & civic layer (H16–H24, → S4).** [B] explain route + number check (incl. safety wording rule); paste-a-listing import; ward briefings + cache. [D] explorer API, continuous aggregate for weekly neighbourhood rents, affordability, `/data`, `/status`. [A] explorer UI, ward page with briefing and election box, paste-a-listing UI, safety switch + caveats UI, shortlist. [C] ≥ 1,500 listings, freshness jobs, caveats incl. scam indicators.

**Phase 4 — P1 features (H22–H30, → S5), only after Phase 3 is done.** [B] weight sliders. [C] worker AI field extraction (fills AC, size, year built gaps); third/fourth source if allowed; price-drop caveat. [A] compare page; true monthly cost UI; route lines on the map; mobile polish. [D] area compare; finish precompute for all categories.

**Phase 5 — Polish & pitch (H30–H36).** Final ingest + snapshot + full travel-time precompute; pre-generate briefings and demo AI outputs; accessibility and mobile pass; empty/error states; run the demo 3 times on the deployed app on a phone and a laptop; Devpost write-up (section 24) with all data links; 2-minute video if required.

### 22.4 Priorities

- **P0 (must ship):** prompt → editable chips for every criterion in section 5 (must-have or preference); real listings in TigerData from ≥ 2 sources (or snapshot + manual); hard criteria; ranked list + map; valuation with price label or "Not enough data"; travel time to places and amenities by transit, car, walk and bike (OTP, with labelled straight-line fallback); home fit (rooms, size, unit type, building age, AC); opt-in safety preference with caveats; transparent match score + AI explanation; building record; area card; explorer with one-indicator choropleth; ward briefing with election info box; paste a listing; `/data` with links; deployed on Vultr.
- **P1:** compare, weight sliders, true monthly cost, scam indicators, price-drop alerts in UI, area compare, worker AI extraction, route lines on the map.
- **P2:** isochrones, saved-search alerts, roommate matching, traffic-aware driving times, rent trend charts beyond one sparkline, French, native app.

---

## 23. Demo walkthrough (the app must support this smoothly)

1. Landing: type the couple prompt from section 1, plus "with AC, ideally built after 2005, 10 min walk to a supermarket". Chips appear: max $2,800 (must-have), 2 bedrooms (must-have), UofT St. George within 25 min by transit, supermarket within 10 min walk, cats (must-have), AC, built after 2005, good deal, income $95k. Point out one source phrase and the "dropped" notice if any.
2. Flip "cats" from must-have to preference, and change the supermarket target from walk to bike; results update instantly (no new AI call).
3. Results: list + map; hover cards, show pins; point at a "Reasonably priced · 7% below similar" badge, "14 min TTC · 6 min walk to supermarket", and a "Utilities not stated" caveat; "Also on: Kijiji".
4. Turn on **Consider safety**: rankings shift a little; the card shows "0.7× city rate (TPS 2023–2025)"; tap to show the caveats.
5. Open the top listing: "Why it ranks here" (AI, grounded), score bars adding up to the total, rent check with 9 comparables on a mini map and the StatCan benchmark, the home (820 sq ft, built 2012 from RentSafeTO, central air), getting around with transit / car / walk / bike times side by side, true monthly cost with the TTC pass, the building's RentSafeTO score and date, and the area card (renter share, rent burden, development applications nearby).
6. Paste a Facebook Marketplace-style post: it's parsed, geocoded and scored against the same search, labelled "Underpriced" and flagged "Unusually low for this area" (scam indicator).
7. Explorer: switch the choropleth to "renters spending 30%+ on shelter", click a ward, read the briefing and the election info box.
8. `/status`: live TigerData counts, travel times computed by OTP on Vultr, last ingest, observations hypertable feeding the neighbourhood rent sparkline.
9. Close on the problem: one search instead of twenty groups, with the City's own data on every listing.

---

## 24. Submission answers (School of Cities brief)

- **Who is the user?** Toronto renters, especially students, newcomers and young families; secondarily tenant organizers and journalists.
- **What problem do they face?** Listings are scattered across many sites and groups; there's no easy way to judge a fair rent, a building's upkeep, the real cost with commuting, or what a neighbourhood is like; useful City data exists but renters never see it.
- **How do we solve it with available data?** We combine collected listings with Toronto open data (neighbourhoods, wards, census profiles, RentSafeTO, address points, TTC GTFS, development applications, City facilities), StatCan and CMHC rent benchmarks, and OpenStreetMap, then use Gemini only to understand requests and explain results computed from that data.
- **How does it benefit the user?** Faster search, fair-price context, building and neighbourhood facts at the moment of decision, and plain-language, neutral housing information for their ward ahead of the election.
- **Data sources:** every link in sections 8.1–8.2, also listed on `/data`.

---

## 25. Out of scope for now

User accounts, saved searches and alerts, messaging landlords, applications or payments, landlord reviews, legal advice or lease review, any candidate or party content, election predictions, re-hosting listing photos, cities outside Toronto, native apps.

---

## 26. Open decisions

- Whether Hack the Valley's dates fall before or after election day (October 26, 2026); the election box handles both.
- CMHC zone → neighbourhood mapping is approximate (centroid); acceptable for context only.
- OTP is now on the critical path. If the graph won't build or run on the instance by S3, every travel target falls back to labelled straight-line distance and the demo says so; driving times stay free-flow (no traffic) either way.
- Safety: confirm the latest years published in the TPS Neighbourhood Crime Rates dataset, and agree as a team on the wording before the demo (judges score "responsible interpretation").
- Size and building age are missing on many listings; check coverage after the first ingest and decide whether the worker AI extraction (P1) moves up.

---

## 27. Change log

One line per change to this spec: `YYYY-MM-DD P#.#: what changed and why`. Newest at the bottom.

- 2026-10-15 (pre-build): Market changed from Waterloo–Kitchener to Toronto for the Hack the Valley × School of Cities track; Gemini, Vultr and TigerData tracks kept.
- 2026-10-15 (pre-build): Added the civic layer: area card on every listing, neighbourhood/ward explorer, grounded ward briefings, neutral election info box (no candidate content).
- 2026-10-15 (pre-build): Listings collected from public pages of Kijiji, Rentals.ca, Zillow and Realtor.ca through per-source adapters with shared rules (robots.txt, rate limits, no logins, no photos, contact details scrubbed); Facebook Marketplace and groups handled by "Paste a listing" instead of collection.
- 2026-10-15 (pre-build): Rooms and whole units are both supported, with separate comparable pools.
- 2026-10-15 (pre-build): TypeScript end to end (Next.js web + TS worker); everything hosted on one Vultr instance with Docker Compose; TigerData with PostGIS, hypertables and pg_trgm.
- 2026-10-15 (pre-build): Team of 4 with roles A (frontend & map), B (AI & search API), C (listings pipeline & valuation), D (civic data, infra & story); phases planned over ~36 hours.
- 2026-10-15 (pre-build): Product renamed from RentRadar to RentThe6ix.
- 2026-10-15 (pre-build): Every criterion can be a must-have or a preference (`Pref<T>`). New criteria: size, building age, air conditioning, price range as a preference, price vs market (underpriced / reasonably priced / overpriced labels with confidence-dependent bands), travel time to places and amenities by transit, car, walk and bike, and an opt-in safety preference from TPS neighbourhood crime rates. Match score is now five parts (value, price, travel, home, safety). OTP moves from P1 to P0 (owned by D), with amenity times precomputed into `travel_times`; Vultr instance sized to 8 GB. Sync points S1–S5 added; per-person files `PERSON_A.md`–`PERSON_D.md`.
- 2026-10-15 (pre-build): Team docs added: `TEAM.md` (ownership, contracts, git workflow, sync points), `CLAUDE.md` (session rules), `PROGRESS.md` (master task list generated from the four person files), plus starter `README.md`, `DEPLOY.md`, `DEVPOST.md`, `.env.example`, `.gitignore` and `apps/worker/SOURCES.md`.
- 2026-10-16 [B]: Published the user-agreed alternative-mode, destination-choice, unknown-travel and full-pool percentile semantics from apps/search/plan.md; exact travel uses bounded temporary polling jobs.
- 2026-10-16 [B]: Added search-only studio selection and explicit fixture-backed search API contracts; configured Downtown/Scarborough rectangles are labelled approximate search definitions, not official civic boundaries. Owner SQL/geographic/valuation/safety/router integration remains pending.
- 2026-10-16 P0.1 [A]: Scaffold on Next.js 16.4 (App Router, Turbopack, React Compiler), Node 24, pnpm 12. Cache Components is **off**, so pages and GET route handlers render per request and DB-backed routes are never prerendered at build. `packages/shared` is plain TypeScript with no build step (Next uses `transpilePackages`), imported as `@rentthe6ix/shared/schemas`, `@rentthe6ix/shared/engine/<file>`, `@rentthe6ix/shared/fixtures`. `next build` emits `output: "standalone"` for the Docker image.
- 2026-10-16 P0.10 [A]: UI strings use a small typed `t()` over `messages/en.json` instead of next-intl (simpler, no provider or middleware). "Paste a listing" gets its own route, `/paste`. One `.env.local` at the repo root serves web (loaded by `next.config.ts`), worker and scripts. Unbuilt pages (`/search`, `/areas`, `/paste`, `/data`, `/status`) render a placeholder so early deploys have no dead links.
- 2026-10-16 P0.13 [A]: Store contract: `useAppStore(selector)` from `apps/web/src/lib/store/store.ts` (one browser store; slices combined there). Search runs as `startSearch()` → `receiveResults(id, results)` / `receiveError(id, error)`, and responses to older requests are dropped. Shortlist entries are `{ kind: "listing", id, addedAt }` or `{ kind: "pasted", id, listing, addedAt }`. Selection contract: `hoveredListingId` / `selectedListingId`, both cleared when that listing leaves the results.
- 2026-10-16 P0.12 [C]: Removed source-access rules (robots.txt, rate limits, user agent, login and bot-block drops, Facebook exclusion); privacy rules (no photos, scrubbed contact details) kept.
- 2026-10-16 P0.4 [D]: Every dataset link in 8.1–8.2 verified against the publishers' own APIs; all 14 City slugs exist and the fetched resources were inspected. Corrections: TPS crime rates move to `data.tps.ca/datasets/TorontoPS::neighbourhood-crime-rates-open-data` (the old `data.torontopolice.on.ca` page now redirects to the portal root); the RentSafeTO evaluation dataset is **not** retired — the same slug holds 2023–current and pre-2023; 2021 Neighbourhood Profiles are XLSX-only; Ward Profiles has no data feed. CKAN licence metadata is mostly `notspecified` while the portal terms are OGL-Toronto, so loaders record OGL-Toronto. Details and exact resource URLs: `docs/datasets.md`.
- 2026-10-16 P0.11 [C]: Adapters are `{ id, displayName, fetchIndex(session, cursor) → { listings: RawListing[], nextCursor } }` (index pages carry full rows on the working sources, so no `fetchDetail`/`parse(html)` step; parsing is a pure function per adapter). All fetching is plain Playwright; a 401/403/429 or bot-check page marks the source unhealthy for the run. New source `torontorentals` (torontorentals.com, Rentals.ca network); rentals.ca, Zillow and Realtor.ca are blocked, Facebook not collected (see `apps/worker/SOURCES.md`).
- 2026-10-16 P0.1 [A]: pnpm pinned to 10.34.7 (`packageManager`). Vercel's pnpm 9/10 can't read pnpm 12's lockfile, and newer pnpm switches to the pinned version automatically. The team's Vercel project builds from Root Directory `apps/web`, and `apps/web/vercel.json` pins the Next.js preset. `.env.example` is git-ignored and removed from the repo at the team's request; SPEC 20 is the variable list.
- 2026-10-16 P0.1 [A]: The Vercel project builds from the repo root. The root `vercel.json` sets `framework: nextjs`, `buildCommand: pnpm --filter web build` and `outputDirectory: apps/web/.next`, and `next` is a root devDependency so Vercel's Next.js builder detects it. The output matches a Root Directory `apps/web` build (`apps/web/vercel.json`), which also works. Root `engines.node` is `24.x`.
- 2026-10-16 P0.11 [C]: The worker fetches through CloakBrowser (stealth Chromium driven by `playwright-core`) instead of plain Playwright. Zillow and Realtor.ca now load and parse (go); rentals.ca is past Cloudflare but its results response isn't captured yet (no-go). A source that still gets a 401/403/429 or bot-check page stops for the run, with no captcha solving or proxies (`apps/worker/SOURCES.md`).
- 2026-10-16 P1.3 [C]: Normalize drops listings whose monthly rent is outside $300–25,000 (typos, weekly or sale prices). Out-of-range structured values (size 100–10,000 sq ft, bathrooms 0.5–10, year built 1800 to next 3 years) count as unknown. A yes and a no phrase for the same amenity ("furnished or unfurnished") stays `unknown`. `leaseTerm` is free text from keyword rules (`month-to-month`, `13 months`, `short-term`). "Available Dec 1" without a year means the next Dec 1 on or after the month the listing was posted. Until B's `Listing` schema lands, normalize outputs a worker-local `NormalizedListing` with the same field names.
- 2026-10-16 P2.1 [C]: `valuate(subject, candidates, benchmark, now)` takes `now` (the engine never reads the clock) and does the radius widening itself; SQL returns pool candidates within 3 km with their distance. Pool classes: rooms only with rooms; a basement with basements and apartments; every other type (incl. unknown) together, without basements. A whole unit with unknown bedrooms can't be valued (`insufficient_data`). Unknown bathrooms pass the ±1 rule with no similarity penalty; an amenity unknown on either side gets no adjustment. Weighted quantile = first value whose cumulative weight reaches q (averaged with the next on an exact boundary, so equal weights give the usual median). `PriceLabel` values are `underpriced | reasonable | overpriced`. `adjustments[]` entries also carry `code` and `count`. Constants live in `engine/config.ts` (`VALUATION`).
- 2026-10-16 P2.4 [C]: Dedupe only pairs listings from different sources (torontorentals lists each floor plan of a building at one point, and property managers reuse descriptions), and both rules need the same bedrooms (unknown never matches). The text rule needs at least 40 characters of title + excerpt on both sides. Trigram similarity is computed the way pg_trgm does it, so worker and SQL agree.
- 2026-10-16 P3.32 [C]: `caveats(listing, ctx)` takes `ctx = { valuation, building, sameTextElsewhere, now }`; caveat titles and explanations live in `engine/caveats.ts` (as safety caveat text lives in `safety.ts`), sorted high → warning → info. `fields_unknown` appears when at least 2 of utilities, pets, laundry, parking and AC are unknown, and names them. `deposit_before_viewing` needs a money word and a before-the-viewing phrase in the same sentence ("pre-screening before viewing" alone doesn't count), or an offer to mail the keys plus a money word. RentSafeTO scores are 0–100.
- 2026-10-16 P3.31 [C]: `pnpm --filter worker start` runs the worker: an ingest now, then every `INGEST_INTERVAL_HOURS`, never two at once (an overrunning run delays the next). `INGEST_SOURCES` default is the four "go" sources; `INGEST_MAX_PAGES` added to section 20. Until the DB lands, the last run's per-source stats are in `apps/worker/.cache/ingest/last-run.json`.
- 2026-10-16 P2.1 [C]: Same-building floor plans count as at most 2 comparables (weights and counts), so one tower can't set the estimate or its confidence; candidates carry a `buildingKey`.
- 2026-10-17 [C]: Detail pages (8.4 step 1) are fetched for Kijiji, Zillow and Realtor.ca: only new listings or ones whose rent changed, at most `INGEST_MAX_DETAILS` per source per run. They add the full description and structured amenities (AC incl. central, laundry, parking, pets, lease term). torontorentals building URLs don't expose details, so it has none. Until the DB stores the last fetch, patches are cached in git-ignored `apps/worker/.cache/details/`, descriptions scrubbed (and re-scrubbed on load). Contact fields on those pages (Kijiji `posterInfo`, agent blocks) are never read. Raw `airConditioning` can be `'central'` when a source says so. Scrub: no "Miss"/"Dr" titles ("Don't Miss Out", Drive); a name right before "Leasing manager"/"Superintendent" and after "DM" is removed.
- 2026-10-17 P1.6 [C]: Until geocoding (P1.5) runs, a listing's location is the source's own coordinates with `location_precision 'street'`; listings without coordinates aren't stored (location is required). Re-ingests never overwrite a geocoded location (one with an Address Points match) or a RentSafeTO year built. `listing_observations` gets one row per listing per run (`observed_at` = the run's start). `pnpm --filter worker load:cache` loads saved ingest files.
- 2026-10-17 P2.5 [C]: `GET /api/listings/[id]/valuation` serves `valuate()` over SQL candidates (PostGIS, nearest 2,000 within 3 km), cached in process for 6 h. Until geocoding provides building ids, listings at the same point (~10 m) count as one building for the same-building cap. An insufficient-data valuation still lists the comparables it found, so `comparableCount` matches the list.
- 2026-10-17 P2.4 [C]: Dedupe also never pairs two listings whose street addresses (number + street name) both exist and differ; dense downtown blocks otherwise matched separate units. It runs over all listings in TigerData after every ingest and stores `duplicate_of`.
- 2026-10-17 P1.3 [C]: Normalize drops parking spaces and storage lockers listed as rentals (a title that starts with parking, or mentions parking/locker without any housing word), treats a "room for rent" title as `unitType: 'room'` with per-room rent even when the source's structured type says house or basement (Kijiji files rooms that way, which put rooms in whole-unit comparable pools), and drops whole units under $600.
- 2026-10-17 P3.32 [C]: `duplicate_text_elsewhere` is off (`sameTextElsewhere: 0`) for now: in the collected data nearly every repeated description is a property manager's template across its own units at different prices, so the 7.7 rule would mark real listings. It needs a narrower rule (e.g. the same text at a much lower rent) before it's turned on. `listingContext()` gives search the valuation and caveats for any listing, stored or pasted.
- 2026-10-17 P4.12 [C]: `price_dropped` appears when the current asking rent is at least $25 below the first one observed (smaller changes are treated as noise), with both amounts and the first date.
