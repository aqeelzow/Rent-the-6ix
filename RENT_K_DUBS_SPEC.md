# Rent the Loo: porting RentThe6ix to Waterloo

Nov 20, 2026 · @az

## Summary

Rent the Loo brings RentThe6ix to the City of Waterloo. It reuses the search and ranking engine, replaces the local data, and prioritizes reliable housing search and a functional shortlist.

**Decided (2026-11-20):**

| Decision | Choice |
| --- | --- |
| Name | Rent the Loo |
| Coverage | City of Waterloo, Ontario |
| Data depth | Full port: swap in Waterloo Region equivalents; hide features that have none |
| This document | The spec for the Waterloo port |

**Project rules.** AI interprets requests. Code calculates figures, which must be traceable and clearly labeled. Safety is opt-in, civic information stays nonpartisan, and the app works without accounts.

Based on `main` at `b4c0c4a` (2026-11-17).

## Geography model

Choose Waterloo planning districts or neighbourhood-association areas in K0 and use stable `WPD-<code>` neighbourhood IDs. Use the City of Waterloo municipal boundary for listing coverage. Drop ward pages, loaders and filters.

For census figures, assign each 2021 dissemination area to the neighbourhood containing its centroid and sum the counts. Show median household income where one dissemination area dominates, with “Not enough data” elsewhere.

**Boundary rules**

- A listing is eligible only if its verified address point or reliable location falls within the City of Waterloo boundary. Apply that check to address-point matches as well. Exclude listings with unverified or conflicting city locations until resolved.
- Explicit requests for housing outside the city show the coverage limit. Commute destinations can lie outside the city where the resolver has coverage.
- Interpret “Waterloo” as the city by default. Preserve explicit region, university, campus and branch qualifiers.

Ward pages (`/areas/ward/*`) are removed and return 404. `listings.ward_id` stays in the schema, always null.

## Data source mapping

The table identifies candidate replacements for Toronto datasets. For ArcGIS sources, page the FeatureServer query endpoint and request coordinates with `outSR=4326`.

"Found" = the dataset exists and is described; "Verify" = a P0 task must download it and confirm fields, counts and licence, as P0.4 did for Toronto.

| Use | Toronto source (today) | Waterloo replacement | Status |
| --- | --- | --- | --- |
| Neighbourhoods | Neighbourhoods (158) | Waterloo planning districts or [neighbourhood associations](https://services.arcgis.com/ZpeBVw5o1kjit7LT/ArcGIS/rest/services/NeighbourhoodAssociations/FeatureServer) | Found; Waterloo layer choice open |
| City boundary | Wards union | Region `Municipal_Boundary`, filtered to the City of Waterloo | Found |
| Address points (geocoding) | Toronto One Address Repository (\~525k) | Waterloo address points (has ward, district, lat/lon) | Found; verify Waterloo URL |
| Census indicators | Neighbourhood Profiles XLSX (158 columns) | StatCan 2021 Census Profile at DA level, aggregated (see Geography) | Verify table id and DA boundary file |
| Transit stops + rapid flag | TTC GTFS via CKAN | [GRT GTFS](https://www.grt.ca/about-grt/open-data/) (Region open data portal) | Found; producer URL moved, verify |
| Development applications | Toronto Development Applications | Waterloo [O. Reg. 73/23 quarterly planning data](https://www.waterloo.ca/planning-and-development/explore-planning-and-land-use-data/) | Found; Waterloo may be tabular only |
| Libraries, parks, community centres, schools | City datasets | Waterloo open data layers; OSM as fallback | Verify per layer |
| Grocery, pharmacy, clinic | OSM (Overpass) | OSM (Overpass), new bbox | No change but bbox |
| Known places (intersections) | Toronto Centreline Intersection CSV | Waterloo street intersections | Verify |
| Police-reported crime | TPS Neighbourhood Crime Rates (rates per 100k) | [WRPS annual occurrence extract](https://wrps.ca/node/84), 2019–2025, XLSX/CSV | Found; location precision unknown (see Safety) |
| Asking-rent benchmark | StatCan 46-10-0092-01, Toronto CMA | Same table, [Kitchener–Cambridge–Waterloo CMA](https://www150.statcan.gc.ca/n1/daily-quotidien/250625/dq250625b-eng.pdf) | Found |
| Zone rents | CMHC RMS, Toronto zones | CMHC RMS, KCW CMA zones | Verify zones |
| Transit cost | TTC fare cap | [GRT monthly pass $104](https://www.grt.ca/en/fares-passes/fares.aspx); U-Pass for UW, Laurier, Conestoga students | Found |
| Utility allowances | City of Toronto AMR + utility allowances | No Waterloo equivalent found; use the Ontario co-op utility allowance schedule or drop | Open question |
| OSM extract (OTP, POIs) | Geofabrik Ontario, Toronto bbox | Same file, Waterloo bbox | No change but bbox |

Licences to record in `sources`: Region of Waterloo Open Data Licence v2.0, City of Waterloo open data licence, Statistics Canada Open Licence, ODbL for OSM. WRPS publishes no licence on the occurrence page; ask before republishing derived rates.

## Features with no Waterloo equivalent

Three Toronto features go away, and one depends on a data check. Hiding a feature means removing it from the UI and the score, never showing an empty or zero value in its place.

| Feature | Why it has no equivalent | What happens |
| --- | --- | --- |
| RentSafeTO building record and score | No Waterloo program scores apartment buildings. Waterloo's [rental licensing](https://www.waterloo.ca/community-support/get-rental-housing-support/) covers only buildings under 3 storeys, and its lookup is a status check, not a dataset. | Remove the building section, the `rentsafeto_low` caveat, `rentsafeto_avg_score` / `rentsafeto_buildings` indicators and `yearBuiltSource: 'rentsafeto'`. Optional P1: for low-rise Waterloo listings, a plain link "Check this address's rental licence" with no claim about the result. |
| Neighbourhood Improvement Areas | Toronto-only designation | Drop `is_nia` from UI; keep the column `false`. |
| 311 service requests (was P1) | No equivalent open feed found | Drop from scope. |
| Neighbourhood crime rates | WRPS publishes occurrences, not rates | Build rates ourselves if locations are precise enough; else turn safety off. See Safety. |

The valuation's same-building rule loses its first key (RentSafeTO id) and falls back to Address Point id, then the 10 m same-point rule. That already exists in `apps/web/src/lib/db/valuation.ts`; only the comment and the first branch change.

Link to Waterloo’s low-rise rental licensing information and [rental housing renovation licence by-law](https://www.waterloo.ca/bylaws-and-enforcement/bylaw-directory/rental-housing-renovation-licence-bylaw/) from `/data` and “How this works.”

## Listings ingestion

Reuse the existing adapter parsers where possible. Use 300 unique active Waterloo listings across at least two sources as a provisional inventory target. Confirm it in K0 after boundary filtering and deduplication.

| Adapter | File | Today | Waterloo change |
| --- | --- | --- | --- |
| Kijiji | `sources/kijiji.ts` | `city-of-toronto`, location `l1700273` | Location slug `kitchener-waterloo`, code `l1700212` (seen in live Kijiji URLs). Keep both categories (c37 apartments, c36 rooms). The provider covers a wider area. Apply the Waterloo boundary check to every listing. |
| TorontoRentals.com | `sources/rentals-network.ts` | `/toronto` on torontorentals.com | Remove the `torontorentals` export and its entry in `sources/index.ts`; keep the enum value so old rows still parse. |
| Rentals.ca | `sources/rentals-network.ts` | `/toronto` | Use `/waterloo`. The title fallback `"Toronto"` and the address suffix `", Toronto, ON"` must use the node's own city. |
| Zillow | `sources/zillow.ts` | `/toronto-on/rentals/` | `/waterloo-on/rentals/`; title fallbacks lose "Toronto". Confirm Zillow has Waterloo rental inventory before keeping it. |
| Realtor.ca | `sources/realtor-ca.ts` | `TORONTO_BOX` 43.581–43.856, −79.639 to −79.115 | `WATERLOO_BOX` from the city boundary. Rename `TORONTO_BOX`; tile logic is unchanged. |
| Facebook groups | n/a | Paste a listing | Keep the Paste a listing flow. Marketplace collection is deferred. |
| `manual` | `db/seed/manual.csv` | Toronto rows | Replace with 20–30 hand-curated Waterloo rows before any demo. |

UW's off-campus housing board (run through Places4Students) is not collected: its terms haven't been checked, and Paste a listing already covers it. It belongs in the "not collected" row with Facebook.

**Geocode pipeline** (`pipeline/geocode.ts`, `pipeline/run-ingest.ts`):

- Load City of Waterloo address points. Replace the ward coverage check with the city boundary check and rename `outsideToronto` to `outsideCoverage` in the result and ingest log.
- Preserve municipality qualifiers during address matching to avoid assigning an out-of-city address to a similarly named Waterloo street.
- `DEFAULT_SOURCES` becomes `kijiji,rentals_ca,zillow,realtor_ca`.

**Student-market fields (recommended, P1):** Waterloo rents are heavily per-room and term-based (4-, 8- and 12-month leases around co-op terms). `rentIsPerRoom` already exists. Add `leaseTermMonths` (number or null) and a `sublet` tri-state, filled by keyword rules first ("4 month", "winter term", "sublet") and the existing AI extraction second. Comparables should match on lease term when known, else the valuation mixes 4-month furnished sublets with 12-month leases.

## Travel times, places and the parser

Route-based travel times are optional for launch. If enabled, reuse OpenTripPlanner 2 with the Ontario OSM extract and GRT schedules. Place resolution needs a Waterloo catalogue and parser context.

**Optional OTP setup (`otp/build.sh`, `otp/router-config.json`, `docker-compose.yml`)**

- Derive `CLIP_BBOX` from Waterloo and the surroundings needed for supported routes. Rename `toronto.osm.pbf` to `waterloo.osm.pbf` and `ttc-gtfs.zip` to `grt-gtfs.zip`.
- GTFS download: drop the CKAN `package_show` lookup; fetch the GRT zip from the Region open data portal. The old producer URL `regionofwaterloo.ca/opendatadownloads/GRT_GTFS.zip` [has been replaced](https://mobilitydatabase.org/feeds/gtfs/mdb-721), and an OSM user [reported a TLS handshake failure](https://community.openstreetmap.org/t/ptna-region-of-waterloo-on-ca/138835) on it, so resolve the current URL in P0 and keep the fetch configurable via `GTFS_URL`.
- The Waterloo graph is far smaller than Toronto's; the \~6 GB build RAM note in `build.sh` and `DEPLOY.md` can drop after a test build.
- P1: add Metrolinx GO GTFS for the Kitchener GO line so "commute to Toronto/Union" works. Without it, OTP returns no transit trip for out-of-region targets and the app falls back to labelled straight-line distance, which is honest but unhelpful.

**Rapid transit (`civic/transit-stops.ts`)**

Today `is_rapid` = served by GTFS `route_type` 1 or 2, because TTC streetcars are type 0. In GRT, ION light rail (route 301) is the rapid line and is most likely `route_type` 0. New rule: rapid = route 301 or any route with `route_type` in (0, 1, 2); confirm against the feed. ION Bus (302) stays non-rapid unless the team decides otherwise. `nearby-data.ts`'s platform-name cleanup ("King Station - Southbound Platform") must be re-checked against GRT stop names such as "Conestoga Station - Southbound".

**Known places (`apps/web/src/lib/parse/known_places*.json`, `civic/known-places.ts`)**

- Regenerate `known_places.generated.json` from the Waterloo lookup area and Waterloo intersections. Change the intersection ID prefix to `waterloo-intersection:` and update source ranking.
- Curate UW main campus, Laurier Waterloo campus, Conestoga Waterloo campus, Uptown Waterloo, Waterloo Park, Conestoga Mall, The Boardwalk, David Johnston Research + Technology Park and ION stations. Include explicitly named commute destinations outside the city, such as UW School of Pharmacy, Conestoga Doon, downtown Kitchener, the hospitals, Kitchener GO and the regional airport.
- Replace the group aliases in `place-catalogue.ts` (`uoft`, `u of t`, `york`) with `uw` / `uwaterloo` / `university of waterloo`, `laurier` / `wlu` / `wilfrid laurier`, `conestoga`.

**Parser and resolver**

- `lib/parse/instruction.ts`: use Waterloo geographic context and local examples. “Waterloo” defaults to the city and “UW” refers to the University of Waterloo.
- `lib/parse/resolve.ts`: use Waterloo-area destination lookup bounds and preserve qualifiers that distinguish cities and branches.
- `lib/parse/fallback.ts`: support Uptown Waterloo and the university district and recognize GRT, ION and LRT as transit terms.
- `lib/parse/areas.ts`: comments and examples; drop the `wards` half of its lookup, neighbourhoods work as is.
- Every `*.test.ts` under `lib/parse` uses Toronto prompts and coordinates; they are rewritten, not deleted (see task list).

## Civic layer, safety and costs

The area card and neighbourhood explorer use City of Waterloo comparisons where compatible data is available.

**Area card and explorer**

| Indicator | Source in Waterloo | Notes |
| --- | --- | --- |
| Typical asking rent (ours, 30 days) | Our listings | Unchanged; "Not enough data" under 5 comparables will show more often |
| Renter households % | 2021 Census, DA-aggregated | Sum of DA counts per neighbourhood |
| Renters spending 30%+ on shelter | 2021 Census, DA-aggregated | DA-level suppression leaves gaps; show "Not enough data" |
| Median household income | 2021 Census | Only where the neighbourhood is one DA-dominated unit; else hidden |
| Rapid transit within 800 m | GRT GTFS, ION stops | Metric SRID changes from EPSG:2952 (MTM 10) to EPSG:2958 (UTM 17N, NAD83 CSRS) |
| Development applications, last 12 months | Waterloo quarterly report | If the report lacks usable locations, hide the indicator and explain why on `/data`. |
| Police-reported crime (opt-in) | WRPS occurrences | Only if the safety check below passes |

The explorer shows neighbourhoods only: remove the ward toggle from the map and the ward list from `apps/web/src/app/areas/page.tsx`.

**Safety depends on data quality**

WRPS publishes one occurrence row per call with a "general location", but the page does not say what that location is. P0 opens the 2025 file (38.7 MB XLSX) and decides:

1. **Points, blocks or intersections:** geocode, count by neighbourhood, divide by 2021 Census population from the same DA aggregation, average 2023–2025. Use the closest offence groups to the five TPS indicators (assault, break and enter, auto theft, robbery, theft over $5,000). Rewrite every caveat in `engine/safety.ts` to name WRPS, and state that the rates are computed by Rent the Loo from WRPS data, not published by WRPS.
2. **Only municipality or patrol zone:** too coarse for a neighbourhood rate. Turn the safety preference, its chip, and map layer off, and say on `/data` why.

Either way, keep the rules unchanged: opt-in, never "safe" or "unsafe", the disclaimer everywhere crime appears, and the parser never sets a limit. Occurrence data counts calls, not confirmed crimes; that becomes an extra caveat.

**Benchmarks and costs (`db/seed/benchmarks.json`, `engine/benchmark.ts`)**

- Re-pull StatCan 46-10-0092-01 for the Kitchener–Cambridge–Waterloo CMA (all bedroom sizes, latest 8 quarters). Label: “Kitchener–Cambridge–Waterloo CMA average asking rent.” Keep the benchmark geography visible.
- Transit row: GRT adult monthly pass $104. Add a renter setting "I have a U-Pass" (UW, Laurier, Conestoga students) that sets transit cost to $0 in the monthly-cost view, with the note that the U-Pass is paid through tuition.
- Utilities: the Toronto AMR utility rows have no Waterloo counterpart. Until one is chosen, keep the 20 utility rows as Ontario-wide sample figures with `sample: true` and say so in the UI.
- `engine/carbon.ts`: replace the TTC notes with GRT; transit stays "not counted" unless GRT publishes per-passenger-km figures.

## Branding, copy and database

**Brand.** The CN Tower is the brand mark today: the "I" in the wordmark, the header logo and the favicon (`components/brand/cn-tower.tsx`, `app/icon.svg`, `landing.css`). The landing skyline draws the CN Tower, the Rogers Centre and a TTC streetcar (`components/landing/skyline.tsx`, `scenes.tsx`), and its wordmark reads "RENT THE 6IX".

- New mark: an original drawing, not a copy of any institution's or transit agency's logo. Suggested: a stylised ION light-rail car seen from the front, or a "K-W" monogram (the name stays, even though coverage is Waterloo only). The new mark replaces the "I" trick in the wordmark.
- New skyline: generic mid-rise towers, a light-rail train on its own track, and Silver Lake in Waterloo Park. No UW, Laurier, GRT or ION logos.
- Wordmark "RENT THE LOO"; page titles "Rent the Loo"; package scope `@rentthe6ix/shared` → `@rentkdubs/shared` (touches every import; do it in one commit with a codemod).
- Domain: `6ix.casa` needs a successor. Update `Caddyfile`, `deploy.sh` (`/srv/rentthe6ix`), `docker-compose.yml` (`name: rentthe6ix`), `Dockerfile` target tags and `vercel.json` if used.

**Copy.** `apps/web/messages/en.json` (1,039 lines) has about 50 lines naming 6ix, Toronto, TTC, UofT, Scarborough, TPS or RentSafeTO. Every example prompt changes, e.g. "2-bed near UW under $2,200, 15 min by ION, in-suite laundry" and "room near Laurier for the winter term, furnished". Hard-coded English outside `en.json` must also move: `engine/caveats.ts`, `engine/safety.ts`, `engine/benchmark.ts`, `lib/db/area-facts.ts` ("Listings RentThe6ix collected"), `lib/ai/briefing.ts` ("in Toronto").

**Database.** Start a fresh database rather than migrating Toronto rows: this keeps Toronto listings, civic data, caches and provenance separate from Waterloo. Migrations 001–008 stay as merged; add:

- `009_listing_terms.sql` (P1): `listings.lease_term_months smallint NULL`, `listings.sublet text CHECK ('yes','no','unknown')`.

Kept as they are: `buildings` (reused for building names, Additions item 2), `listing_observations`, `travel_times` or `ai_cache`. `listings.source` keeps `torontorentals` in the shared zod enum (the SQL column has no CHECK) so old fixtures still parse.

Shared schemas (`packages/shared/schemas/index.ts`): remove `'rentsafeto'` from `yearBuiltSource` only after the UI stops reading it; remove the `ward` area kind from the area filter, `AreaSchema` and the area routes (`briefing.ts`, `area-route.ts`, `safety-route.ts`).

## File-by-file change map

Paths are from the repo root. "Rewrite" = new data or logic; "Edit" = names, constants, copy; "Remove" = delete or hide.

| Area | Files | Change |
| --- | --- | --- |
| Civic loaders | `apps/worker/src/civic/areas.ts` | Rewrite: load Waterloo neighbourhoods and the city boundary from ArcGIS with stable IDs |
|  | `civic/address-points.ts` | Rewrite: load Waterloo address points; ward fields ignored |
|  | `civic/census.ts` | Rewrite: StatCan DA profile + DA boundaries → neighbourhood sums |
|  | `civic/transit-stops.ts` | Edit: GRT zip URL, rapid rule (route 301 / type 0) |
|  | `civic/dev-applications.ts` | Rewrite: Waterloo planning report; units parsing re-checked |
|  | `civic/pois.ts` | Edit: civic layers from Waterloo portals, Overpass bbox |
|  | `civic/crime.ts` | Rewrite or remove, per the safety check |
|  | `civic/buildings.ts` | Remove from `cli.ts` `all` task |
|  | `civic/area-indicators.ts` | Edit: drop RentSafeTO indicators, `METRIC_SRID` 2952 → 2958, "158 + 25" comments |
|  | `civic/known-places.ts` | Edit: bbox, intersection source, id prefix |
|  | `civic/lib/ckan.ts` → new `civic/lib/arcgis.ts` | Rewrite: paged FeatureServer query, `outSR=4326`, provenance URL |
|  | `civic/cli.ts`, `civic/*.test.ts` | Edit: task list; rewrite fixtures with Waterloo rows |
| Listings | `sources/kijiji.ts`, `rentals-network.ts`, `zillow.ts`, `realtor-ca.ts`, `sources/index.ts` | Edit per Listings ingestion table |
|  | `pipeline/geocode.ts`, `run-ingest.ts`, `normalize.ts` | Edit: coverage test, `OTHER_CITIES`, default sources, Toronto examples |
|  | `apps/worker/src/sources/*.test.ts` + saved fixtures | Rewrite with Waterloo pages (fixtures stay git-ignored) |
|  | `db/seed/manual.csv`, `db/seed/benchmarks.json`, `load-benchmarks.ts` | Rewrite data |
| OTP | `otp/build.sh`, `otp/README.md`, `docker-compose.yml`, `DEPLOY.md` | Edit: bbox, GTFS URL, file names, RAM note |
| Engine | `packages/shared/engine/caveats.ts`, `config.ts` | Remove `rentsafeto_low` + `rentSafeToLowScore`; safety indicator ids |
|  | `engine/safety.ts`, `benchmark.ts`, `carbon.ts`, `valuation.ts`, `preferred-area.ts` | Edit: source names, caveat text, comments |
|  | `packages/shared/schemas/index.ts`, `fixtures/index.ts` | Edit: drop the ward area kind, caveat copy |
| Web: places | `apps/web/src/lib/parse/instruction.ts`, `resolve.ts`, `fallback.ts`, `place-catalogue.ts`, `areas.ts`, `known_places*.json` | Rewrite per Travel times section |
| Web: areas | `app/areas/page.tsx`, `lib/db/area-facts.ts`, `area-route.ts`, `briefing.ts`, `safety-route.ts`, `candidates-detail.ts` | Edit: neighbourhoods only, city comparator, drop RentSafeTO |
|  | `components/areas/election.ts`, `election-box.tsx` | Remove, with app/areas/ward/, lib/db/ward-crime.ts, components/areas/ward-crime.tsx, ward-view.tsx and crime-reveal.tsx (no wards, no election box) |
| Web: map + geo | `components/map/results-map.tsx` | `TORONTO` centre → fit the City of Waterloo boundary |
|  | `lib/geo/otp.ts`, `route-times.ts` | Edit: `torontoDate` → `localDate`; grid-cell comment |
| Web: listing UI | `components/listing/*` (building section, nearby TTC wording), `results/*`, `safety/*` | Remove building block; "TTC stop" → "GRT stop" / "ION station" |
| Brand | `components/brand/cn-tower.tsx`, `app/icon.svg`, `components/landing/skyline.tsx`, `scenes.tsx`, `landing.css`, `app/layout.tsx` | Rewrite art and wordmark |
| Copy | `apps/web/messages/en.json` | Edit \~50 lines |
| Tests | 53 test files across web, worker and shared that name Toronto places or sources (e.g. `place-normalization.test.ts`, `geocoding.test.ts`, `chips.test.ts`, `election.test.ts`) | Rewrite inputs and expectations |
| Infra | `package.json` names, `Caddyfile`, `deploy.sh`, `Dockerfile`, `vercel.json`, `.serena/project.yml` | Edit names, domain, paths |
| DB | `db/migrations/009_listing_terms.sql`, `010_buildings.sql` | New when the corresponding features are built. |
| Docs | `README.md`, `DEPLOY.md`, `docs/datasets.md`, `apps/worker/SOURCES.md` | Create Waterloo release and source documentation. |
| Leave alone | `apps/search/**` (validation logs, patches) | Archive as Toronto history; not loaded at runtime |

## Additions requested 2026-11-20

### 1. Facebook Marketplace (deferred)

The existing Paste a listing flow covers Facebook group posts. An automated Marketplace source is a separate follow-up.

### 2. Address ↔ building name

Every address with a known building gets its name, and every name resolves to its addresses: 330 Phillip St, Waterloo, ON N2L 3W9 ↔ ICON. This matters most in the student market, where posts often name only the building ("2 bed in ICON 330 for spring") and renters search by name ("room in ICON").

**Building catalogue.** Reuse the `buildings` table and `listings.building_id`, both already in the schema and empty once RentSafeTO goes. Migration `010_buildings.sql` adds:

- `buildings`: `name` ("ICON"), `aliases text[]` ("icon 330", "icon waterloo"), `kind` (`student`, `rental_apartment`, `condo`, `other`), `source_id`, `reviewed boolean`. Id becomes a slug (`icon-waterloo`). RentSafeTO columns stay, unused.
- `building_addresses(building_id, address_point_id)`: one building, many civic numbers (towers and complexes like "109, 115 & 123 Westwood Dr").
- `listings.unit_label` ("1706", "BSMT").

**Where names come from** (each candidate keeps its source; a person approves it before it goes live):

| Source | What it gives | Notes |
| --- | --- | --- |
| `db/seed/buildings.csv` | Hand-curated name, aliases, addresses, kind | Start with purpose-built student buildings near UW and Laurier, the main source of name-only posts |
| Rentals.ca | Building `name` already on every node (`rentals-network.ts`) | Already read by the adapter; today only used in titles |
| Zillow | `buildingName` (`zillow.ts`) | Same |
| OpenStreetMap | `name` on `building=apartments` / `dormitory` / `residential` in the Waterloo box | ODbL credit |
| Listing titles | Capitalised tokens that repeat at one address ("ICON", "Sage") | Candidate report only, never auto-added |

**Matching, both directions** (`pipeline/geocode.ts` gets a building step after the Address Point match):

1. **Address → name:** a listing matched to an Address Point in `building_addresses` gets `building_id`. The card shows "ICON · 330 Phillip St".
2. **Name → address:** a listing with no usable address whose title or description names a building alias is placed at that building's address, `locationPrecision: 'exact'`, `fieldEvidence` = "building name in title". The listing's own coordinates must be within 1 km of the building, else it stays unmatched (catches "near ICON" posts for other buildings).
3. **Short or common words** like "icon", "sage" or "one" are flagged `ambiguous` and match only with a number or Waterloo context ("ICON 330", "icon on phillip") or a case-sensitive whole-word hit. AI extraction may *propose* a building name; the match itself is the code's.

**What renters get:**

- Search: building names join `known_places` (kind `building`), so "room in ICON under $1,100" filters to that building, and "10 min walk to ICON" works as a travel target. Ambiguous names show a chip to confirm ("ICON, 330 Phillip St?").
- `/building/[slug]` page: name, addresses, map, active listings, past asking rents by unit type and lease term (from `listing_observations`), nearest ION and GRT stops. Every figure keeps its source and sample size.
- Listing cards and detail: "4 other listings in ICON"; map pins group a building's listings.
- Valuation: same-building comparables key on `building_id` first, then Address Point, so all of a tower's civic numbers count as one building.
- Dedupe: same `building_id` + same `unit_label` + same bedrooms = same unit across sites.

**Check (K5.2):** 30 sampled listings near UW and Laurier get the right building or none; no false matches on the ambiguous list. Building coverage (share of listings with a `building_id`) is shown on `/status`.

### 3. Reliable search and housing shortlist

1. **Search latency.** Target end-to-end p50 under 1.5 s and p95 under 3 s, from submission to usable results, a confirmed empty state, or an actionable destination choice. Include extraction, POI lookup, retrieval, rendering and any routing the search waits for. Benchmark representative Waterloo queries with cache misses and repeats. Report sample size, concurrency, cache mix and failures on `/status`. Count errors and timeouts as exceeding the target. A deterministic first pass can show provisional results. Results that omit an active requirement do not stop the timer.
2. **Query extraction.** Extract supported rent, unit type, bedrooms, amenities and commute criteria into editable filters. Preserve hard limits, modes and preferences. Surface criteria that need review and allow manual search after an extraction failure. Compare the existing parser and the two candidate models on the same labeled Waterloo prompts covering paraphrases, negation and multiple commute constraints. Report field accuracy, dropped or invented criteria, and extraction latency. [GLiNER2 Multi](https://huggingface.co/fastino/gliner2-multi-v1) · [NuExtract](https://huggingface.co/numind/NuExtract)
3. **POI resolution.** Resolve more than **99%** of uniquely identifiable POI mentions on a held-out Waterloo query set to the independently verified place and routing point. Wrong or unresolved matches and unnecessary clarification count as failures. For genuinely ambiguous names, show distinct choices and use the selected place. Surface unresolved destinations for editing.
4. **Duplicate locations.** Merge aliases, repeated mentions and source records for the same physical POI. Keep distinct branches, campuses and materially different entrances selectable. Preserve each mode, time limit and preference when several criteria refer to the same place.
5. **Housing shortlist.** Renters can save and remove listings from results or details, see consistent saved state, and reopen each listing from one shortlist entry after reloading in the same browser. Unavailable listings stay visible and removable. If storage is blocked, saves work for the current visit and the UI explains that they may not persist. The shortlist has no notifications.
6. **Route-based travel times (nice to have).** Show the route duration for the selected mode when available and label approximate times as estimates or show that travel time is unavailable. The release can ship with labeled estimates.
7. **Other search improvements.** Map area search, student filters, additional sorts, browser-saved search queries and stable pagination remain follow-up work.

### 4. Better UI

These come from the README screenshots of the Toronto build; a 5-person test with Waterloo students goes first (task: find a 4-month room near UW under $900), and its findings reorder this list.

- **Cards:** price and the Underpriced label sit at the bottom, under seven lines. Move them to the top line. Fold the travel lines into one ("17 min transit · 5 min walk to groceries"). Drop the carbon link and the score bar from the card; keep them on the detail page.
- **Plain names:** chips say "UofT St. George campus representative point". Show the place name; keep "representative point" in the detail tooltip.
- **Map:** price pins at street zoom instead of count-only clusters; one pin per building with a listing count (item 2).
- **Mobile:** list first with a map toggle, a sticky filter and sort bar, and listing detail in a bottom sheet.
- **Landing:** Waterloo example prompts; quick-start chips (Near UW, Near Laurier, Uptown Waterloo, Room under $1,000) that fill the prompt; a Paste a listing card for Facebook group posts.
- **Thin data:** say why an estimate is missing ("needs 5 similar homes; we found 3").
- **Accessibility:** raise contrast of grey text on the dark navy; visible focus states; a keyboard-usable list for everything on the map.
- The new brand and skyline (Branding section) land in the same pass.

### 5. Blocked sources

The blocks are specific, and most come from request volume. From `apps/worker/SOURCES.md`: Kijiji returns HTTP 403 to the Vultr server's address, so it only runs from a team laptop. Rentals.ca hit a Cloudflare 429 at page 28 of about 313 and stopped. Zillow and Realtor.ca block plain Playwright but pass with CloakBrowser. `lib/fetch.ts` stops a source on 401/403/429 or a bot-check page by design, and that stays.

Not in this plan: residential or rotating proxies, CAPTCHA solving, fingerprint rotation, or ignoring `Retry-After`. Those defeat the site's access control and put the project and the server's address at risk.

What fixes the failures we've seen:

1. **Crawl less.** Waterloo is far smaller than Toronto. Crawl newest-first and stop at the first page with nothing new or changed; refresh known listings once a day instead of every 6 h; fetch detail pages only for new listings missing key fields.
2. **Resume instead of restart.** Store each source's page cursor in `ingest_runs`. A 429 ends that run, and the next run starts from the saved page no earlier than `Retry-After`.
3. **Pace per source.** Per-source delay and daily page budget (e.g. Rentals.ca 10 s between pages), small random jitter, crawls at night.
4. **Check the rules.** In K0.5, read each site's `robots.txt` and terms and record them in `SOURCES.md`; skip paths they disallow.
5. **Ask for access.** Contact Rentals.ca and Kijiji about a data feed or permission, and check whether CREA's DDF feed (through a REALTOR® sponsor) covers lease listings for Realtor.ca. A feed beats scraping for a public app.
6. **Kijiji's 403 is a decision about our server.** Don't route around it. Decide whether to keep the laptop runner, rely on Paste a listing for Kijiji, or wait for permission from item 5.
7. **See it happen.** `/status` shows per source: last good run, share of pages completed, block reason; the log flags a source unhealthy two runs in a row.

## Task list

Six phases; each keeps `main` deployable. Phase K0 decides what K2 and K3 can build, so it runs first and its findings update this doc. Ids use a `K` prefix so they don't collide with the Toronto `P` ids in `PROGRESS.md`.

**K0 — Verify data (no code changes)**

- [ ] K0.1 Resolve and download every source in the Data source mapping table; record URL, licence, row count, fields and CRS in `docs/datasets.md`.
- [ ] K0.2 Open the WRPS 2025 occurrence file; decide safety option 1 or 2.
- [ ] K0.3 Pick the Waterloo neighbourhood layer and check city coverage.
- [ ] K0.4 Confirm the GRT GTFS URL and ION's `route_type`.
- [ ] K0.5 Verify Waterloo inventory from Kijiji, Rentals.ca, Zillow and Realtor.ca. Confirm the provisional 300-listing target using unique active listings inside the city boundary.
- [ ] K0.6 Pick the utility-cost source; pick the domain.

**K1 — Rename and neutralise (app still runs on sample data)**

- [ ] K1.1 Package scope and project names (`rentthe6ix` → `rentkdubs`), one codemod commit.
- [ ] K1.2 Brand mark, favicon, landing skyline, wordmark.
- [ ] K1.3 `en.json` and hard-coded copy; example prompts.
- [x] K1.4 Remove RentSafeTO from engine, schemas, UI; tests green.
- [ ] K1.5 Map centre, resolver bounds, parser instruction, configured areas.

**K2 — Geography and civic data**

- [ ] K2.1 Add the ArcGIS loader in `civic/lib/arcgis.ts`.
- [ ] K2.2 Load neighbourhoods and the city boundary. Check for neighbourhood gaps or overlaps. Use the municipal boundary for listing eligibility.
- [ ] K2.3 Address points loader. Check: 20 random Waterloo addresses geocode within 10 m.
- [ ] K2.4 GRT stops + rapid flag. Check: every ION station flagged rapid.
- [ ] K2.5 POIs and known places regenerated.
- [ ] K2.6 Census DA aggregation. Check: neighbourhood renter counts sum to Waterloo's 2021 total within rounding.
- [ ] K2.7 Development applications.
- [ ] K2.8 Crime rates (if K0.2 = option 1), else safety off with `/data` note.
- [ ] K2.9 Area indicators; remove ward pages, ward toggle and election box; explorer shows neighbourhoods only.

**K3 — Listings, travel and costs**

- [ ] K3.1 Update adapters, ingest listings, and verify the K0 inventory target and zero results outside Waterloo.
- [ ] K3.3 Benchmarks (KCW CMA), GRT pass, U-Pass setting.
- [ ] K3.5 Manual seed rows; demo snapshot.

**K4 — Docs and release**

- [ ] K4.1 Record release decisions in this spec.
- [ ] K4.2 Create the Waterloo README, deployment guide and dataset notes. Update `/data`.
- [ ] K4.3 `grep -riE "toronto|6ix|ttc|uoft|rentsafe|tps"` over code returns only the time zone, history and archived files.
- [ ] K4.4 `pnpm typecheck && pnpm lint && pnpm test`; deploy to the new domain.

**K5 — Additions (can start after K1; K5.5 belongs before K3.1)**

- [ ] K5.1 Verify latency, extraction reliability, POI accuracy and duplicate-location handling against the search requirements.
- [ ] K5.2 Migration 010, building seed and source candidates, address and name matching, building page and search integration. Sample 30 listings near UW and Laurier and check that any assigned building is correct.
- [ ] K5.3 Verify shortlist save, reopen, remove and reload behavior.
- [ ] K5.4 UI pass after a 5-person student test: cards, plain names, price pins, mobile list-first, landing chips, contrast.
- [ ] K5.5 Crawler: newest-first stop rule, saved cursors, per-source pacing and budgets, robots/terms check, `/status` block reporting. Check: a full Waterloo run finishes with no 429.
- [ ] K5.6 Access requests to Rentals.ca, Kijiji and (via DDF) Realtor.ca; record answers in `SOURCES.md`.
- [ ] K5.7 Follow-up search improvements: map area search, student filters, new sorts, saved searches in the browser, and "Show 25 more".

Optional follow-up: build the Waterloo routing graph and verify UW to downtown Kitchener by transit. Lease term and sublet fields, GO Transit GTFS and the Waterloo rental-licence link also remain follow-up work.

## Open questions and risks

- [ ] **Safety:** is the WRPS "general location" precise enough for neighbourhood rates? If not, ship without the safety feature. (K0.2)
- [ ] **Waterloo neighbourhoods:** planning districts (fewer, census-aligned) or neighbourhood associations (named, may not cover the whole city)?
- [ ] **Thin comparables:** Waterloo has far fewer listings than Toronto, so many 3-bed or outer-neighbourhood estimates will say "Not enough data". Widen the comparables radius ladder for Waterloo, or accept it?
- [ ] **Student market:** build lease-term and sublet fields in the first release or P1? Without them, 4-month furnished sublets skew rent estimates near UW and Laurier.
- [ ] **Utilities:** which source replaces Toronto's utility allowances, or drop utilities from monthly cost?
- [ ] **Domain and hosting:** new domain; reuse the Vultr instance or a new one?
- [ ] **WRPS licence:** WRPS states no licence on the occurrence page; ask before showing derived rates.

* [ ] **Building names:** who curates and reviews the building catalogue (buildings.csv), and how often?
* [ ] **Kijiji runner:** keep the laptop runner, rely on Paste a listing, or pause Kijiji until it answers an access request?

Risk: listing sites change markup or block scrapers more readily for smaller markets. The `manual` source and Paste a listing keep the app usable if an adapter breaks, as in Toronto.

## Sources

Code references are from `aesthetic0001/rent-k-dubs` at `b4c0c4a`. Pages opened or searched on 2026-11-20:

- [GRT open data](https://www.grt.ca/about-grt/open-data/) · [GRT fares](https://www.grt.ca/en/fares-passes/fares.aspx) · [Mobility Database: GRT GTFS](https://mobilitydatabase.org/feeds/gtfs/mdb-721)
- [Region of Waterloo open data](https://www.regionofwaterloo.ca/en/regional-government/open-data.aspx)
- [City of Waterloo open data and maps](https://www.waterloo.ca/council-and-city-administration/open-data-and-maps/) · [Waterloo planning data](https://www.waterloo.ca/planning-and-development/explore-planning-and-land-use-data/) · [Waterloo rental housing support](https://www.waterloo.ca/community-support/get-rental-housing-support/)
- [WRPS statistics and data](https://wrps.ca/node/84) · [WRPS 2025 occurrence data](https://wrps.ca/resource/2025-occurrence-data)
- [StatCan Quarterly Rent Statistics release (KCW CMA)](https://www150.statcan.gc.ca/n1/daily-quotidien/250625/dq250625b-eng.pdf) · [Table 46-10-0092-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=4610009201)
- [Waterloo renovation licence by-law](https://www.waterloo.ca/bylaws-and-enforcement/bylaw-directory/rental-housing-renovation-licence-bylaw/)
