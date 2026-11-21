# Rent K-Dubs: porting RentThe6ix to Waterloo

Nov 20, 2026 · @az

## Summary

Rent K-Dubs is RentThe6ix rebuilt for the City of Waterloo: same engine, same rules, new geography, new data, new name. The engine, UI shell, AI provider and most adapter parsing are city-neutral, so the work is mostly data loaders, config and copy, not new features.

Waterloo is one municipality, like Toronto, so the one-city-boundary model carries over. The structural changes are that wards are dropped and every hard-coded Toronto number (25 wards, 158 neighbourhoods) goes. Kitchener is out of coverage: its listings are dropped at ingest, but places in Kitchener (downtown, hospitals, Conestoga Doon, the GO station) stay as commute targets.

**Decided (2026-11-20):**

| Decision | Choice |
| --- | --- |
| Name | Rent K-Dubs |
| Coverage | City of Waterloo only (not Kitchener, Cambridge or the townships; decided 2026-11-20) |
| Data depth | Full port: swap in Waterloo Region equivalents; hide features that have none |
| This document | The spec for the port; it replaces Toronto-specific parts of `SPEC.md` once approved |

**Unchanged:** every non-negotiable rule in `CLAUDE.md` (AI interprets, code calculates; traceable figures; honest labels; opt-in safety; civic not partisan; no accounts; scraping rules). The engine in `packages/shared/engine` keeps its tests and only loses Toronto names.

Based on `main` at `b4c0c4a` (2026-11-17).

## Geography model

Areas become one level, Waterloo's named neighbourhoods, inside one city boundary. Wards are dropped entirely (decided 2026-11-20): no ward loader, ward pages, ward filter or ward toggle.

| Level | Waterloo | Id format | Replaces |
| --- | --- | --- | --- |
| City | City boundary | `waterloo` | City of Toronto boundary |
| Neighbourhood | Planning districts or neighbourhood-association areas (pick in K0) | `WPD-<code>` | 158 social planning neighbourhoods |
| Census unit (internal) | 2021 dissemination areas | StatCan DAUID | Neighbourhood Profiles columns |

**Why named neighbourhoods, not census tracts:** renters search by names like "Lakeshore" or "Beechwood", not "CT 5410014.00". Census figures are built bottom-up instead: each 2021 dissemination area (DA) is assigned to the neighbourhood holding its centroid, and counts are summed. Medians can't be summed, so `median_household_income` is shown only where one DA dominates, else "Not enough data".

**Boundary rules (replace SPEC 8.4 step 3):**

- Keep a listing only if its point is inside the Waterloo boundary (Region `Municipal_Boundary` layer, 7 features, filtered to 1).
- A listing whose address says Waterloo stays if it is within 300 m of the boundary (same `EDGE_M` rule as today). The Kitchener border runs through dense housing (Belmont, Westmount, Uptown's south edge), so the edge rule matters more than it did in Toronto.
- Drop listings that name Kitchener, Cambridge, Guelph, Woolwich, Elmira, St. Jacobs, Breslau, Wilmot, Baden, New Hamburg, Stratford or Brantford and have no Address Point match.
- "Waterloo" alone is ambiguous (city, region, university). The parser keeps it as the city unless the text says "region" or "university"/"UW"/"uWaterloo".

Ward pages (`/areas/ward/*`) are removed and return 404. `listings.ward_id` stays in the schema, always null.

## Data source mapping

Every Toronto dataset the loaders read has a Waterloo replacement except RentSafeTO, Neighbourhood Improvement Areas and the 311 feed. Most Waterloo data is ArcGIS Hub (Esri REST/GeoJSON, UTM 17N / EPSG:26917), not CKAN, so `civic/lib/ckan.ts` gives way to a small `civic/lib/arcgis.ts` that pages a FeatureServer `query` endpoint and asks for `outSR=4326`.

"Found" = the dataset exists and is described; "Verify" = a P0 task must download it and confirm fields, counts and licence, as P0.4 did for Toronto.

| Use | Toronto source (today) | Waterloo replacement | Status |
| --- | --- | --- | --- |
| Neighbourhoods | Neighbourhoods (158) | Waterloo planning districts or [neighbourhood associations](https://services.arcgis.com/ZpeBVw5o1kjit7LT/ArcGIS/rest/services/NeighbourhoodAssociations/FeatureServer) | Found; Waterloo layer choice open |
| City boundary | Wards union | Region `Municipal_Boundary` (7 features, filtered to Waterloo) | Found |
| Address points (geocoding) | Toronto One Address Repository (\~525k) | Waterloo address points (has ward, district, lat/lon) | Found; verify URL |
| Census indicators | Neighbourhood Profiles XLSX (158 columns) | StatCan 2021 Census Profile at DA level, aggregated (see Geography) | Verify table id and DA boundary file |
| Transit stops + rapid flag | TTC GTFS via CKAN | [GRT GTFS](https://www.grt.ca/about-grt/open-data/) (Region open data portal) | Found; producer URL moved, verify |
| Development applications | Toronto Development Applications | Waterloo [O. Reg. 73/23 quarterly planning data](https://www.waterloo.ca/planning-and-development/explore-planning-and-land-use-data/) | Found; may be tabular only (no points) |
| Building permits (P1) | Building Permits – Active | None found for Waterloo (Kitchener publishes one; out of coverage) | Dropped unless K0.1 finds one |
| Libraries, parks, community centres, schools | City datasets | Waterloo open data layers; OSM as fallback | Verify per layer |
| Grocery, pharmacy, clinic | OSM (Overpass) | OSM (Overpass), new bbox | No change but bbox |
| Known places (intersections) | Toronto Centreline Intersection CSV | Waterloo street intersections | Verify |
| Police-reported crime | TPS Neighbourhood Crime Rates (rates per 100k) | [WRPS annual occurrence extract](https://wrps.ca/node/84), 2019–2025, XLSX/CSV | Found; location precision unknown (see Safety) |
| Asking-rent benchmark | StatCan 46-10-0092-01, Toronto CMA | Same table, [Kitchener–Cambridge–Waterloo CMA](https://www150.statcan.gc.ca/n1/daily-quotidien/250625/dq250625b-eng.pdf) | Found |
| Zone rents | CMHC RMS, Toronto zones | CMHC RMS, KCW CMA zones | Verify zones |
| Transit cost | TTC fare cap | [GRT monthly pass $104](https://www.grt.ca/en/fares-passes/fares.aspx); U-Pass for UW, Laurier, Conestoga students | Found |
| Utility allowances | City of Toronto AMR + utility allowances | No Waterloo equivalent found; use the Ontario co-op utility allowance schedule or drop | Open question |
| OSM extract (OTP, POIs) | Geofabrik Ontario, Toronto bbox | Same file, Waterloo-area bbox | No change but bbox |

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

Waterloo renter rules to surface instead (copy, not data): the licence requirement for low-rise rentals, and the 2026 renoviction licence by-law ([by-law 2026-012](https://www.waterloo.ca/bylaws-and-enforcement/bylaw-directory/rental-housing-renovation-licence-bylaw/)). These go on `/data` and in "How this works" as links.

## Listings ingestion

Four of five adapters keep their parsers and change only their search URLs or map box; TorontoRentals.com is dropped because it has no Waterloo sister site. Kijiji's "Kitchener / Waterloo" location shows about 1,400–2,900 rentals at a time, most of them in Kitchener, so the SPEC 8.5 target drops from 1,500 to **300 active Waterloo listings** across at least two sources (confirm in K0.5).

| Adapter | File | Today | Waterloo change |
| --- | --- | --- | --- |
| Kijiji | `sources/kijiji.ts` | `city-of-toronto`, location `l1700273` | Location slug `kitchener-waterloo`, code `l1700212` (seen in live Kijiji URLs). Keep both categories (c37 apartments, c36 rooms). Kijiji has no Waterloo-only location: this one also returns Kitchener, Cambridge and nearby towns, and the boundary rule drops them. |
| TorontoRentals.com | `sources/rentals-network.ts` | `/toronto` on torontorentals.com | Remove the `torontorentals` export and its entry in `sources/index.ts`; keep the enum value so old rows still parse. |
| Rentals.ca | `sources/rentals-network.ts` | `/toronto` | `/waterloo`. The title fallback `"Toronto"` and the address suffix `", Toronto, ON"` become Waterloo. |
| Zillow | `sources/zillow.ts` | `/toronto-on/rentals/` | `/waterloo-on/rentals/`; title fallbacks lose "Toronto". Confirm Zillow has Waterloo rental inventory before keeping it. |
| Realtor.ca | `sources/realtor-ca.ts` | `TORONTO_BOX` 43.581–43.856, −79.639 to −79.115 | `WATERLOO_BOX` from the loaded boundary, roughly 43.43–43.53, −80.62 to −80.47. Rename `TORONTO_BOX`; tile logic is unchanged. |
| Facebook groups | n/a | Paste a listing | Marketplace: Apify actor (Additions, item 1). Groups: still Paste a listing, since they need membership. |
| `manual` | `db/seed/manual.csv` | Toronto rows | Replace with 20–30 hand-curated Waterloo rows before any demo. |

UW's off-campus housing board (run through Places4Students) is not collected: its terms haven't been checked, and Paste a listing already covers it. It belongs in the "not collected" row with Facebook.

**Geocode pipeline** (`pipeline/geocode.ts`, `pipeline/run-ingest.ts`):

- Address Points come from Waterloo's one table.
- Replace the "outside every ward" test with "outside the Waterloo boundary"; rename `outsideToronto` to `outsideCoverage` in the result and the ingest log line.
- Rewrite `OTHER_CITY`: today it lists GTA towns and even contains "Waterloo" as a foreign city. New list: Kitchener, Cambridge, Guelph, Woolwich, Elmira, St. Jacobs, Breslau, Wilmot, New Hamburg, Baden, Stratford, Brantford, Toronto, Mississauga, Hamilton, London.
- The keep-near-edge regex changes from `toronto` vs GTA names to `waterloo` vs the list above.
- `DEFAULT_SOURCES` becomes `kijiji,rentals_ca,zillow,realtor_ca`.

**Student-market fields (recommended, P1):** Waterloo rents are heavily per-room and term-based (4-, 8- and 12-month leases around co-op terms). `rentIsPerRoom` already exists. Add `leaseTermMonths` (number or null) and a `sublet` tri-state, filled by keyword rules first ("4 month", "winter term", "sublet") and the existing AI extraction second. Comparables should match on lease term when known, else the valuation mixes 4-month furnished sublets with 12-month leases.

## Travel times, places and the parser

Travel times keep OpenTripPlanner 2 with the same Ontario OSM file; only the clip box, the GTFS feed and the rapid-transit rule change. Place resolution needs the most hand work, because the parser's knowledge of local names is built from Toronto files and a Toronto-specific prompt.

**OTP (`otp/build.sh`, `otp/router-config.json`, `docker-compose.yml`, `DEPLOY.md` §4)**

- `CLIP_BBOX` → Waterloo plus \~10 km, about `-80.75,43.30,-80.25,43.60` (covers Kitchener, Cambridge and the 401 for trips out). Rename `toronto.osm.pbf` → `waterloo.osm.pbf`, `ttc-gtfs.zip` → `grt-gtfs.zip`.
- GTFS download: drop the CKAN `package_show` lookup; fetch the GRT zip from the Region open data portal. The old producer URL `regionofwaterloo.ca/opendatadownloads/GRT_GTFS.zip` [has been replaced](https://mobilitydatabase.org/feeds/gtfs/mdb-721), and an OSM user [reported a TLS handshake failure](https://community.openstreetmap.org/t/ptna-region-of-waterloo-on-ca/138835) on it, so resolve the current URL in P0 and keep the fetch configurable via `GTFS_URL`.
- The Waterloo-area graph is far smaller than Toronto's; the \~6 GB build RAM note in `build.sh` and `DEPLOY.md` can drop after a test build.
- P1: add Metrolinx GO GTFS for the Kitchener GO line so "commute to Toronto/Union" works. Without it, OTP returns no transit trip for out-of-region targets and the app falls back to labelled straight-line distance, which is honest but unhelpful.

**Rapid transit (`civic/transit-stops.ts`)**

Today `is_rapid` = served by GTFS `route_type` 1 or 2, because TTC streetcars are type 0. In GRT, ION light rail (route 301) is the rapid line and is most likely `route_type` 0. New rule: rapid = route 301 or any route with `route_type` in (0, 1, 2); confirm against the feed. ION Bus (302) stays non-rapid unless the team decides otherwise. `nearby-data.ts`'s platform-name cleanup ("King Station - Southbound Platform") must be re-checked against GRT stop names such as "Conestoga Station - Southbound".

**Known places (`apps/web/src/lib/parse/known_places*.json`, `civic/known-places.ts`)**

- Delete `known_places.generated.json` (35,323 Toronto rows) and regenerate with the Waterloo bbox, `43.43,-80.62,43.53,-80.47`, and Waterloo intersections instead of `intersection-file-city-of-toronto`. Id prefix `toronto-intersection:` → `waterloo-intersection:`; update `sourceRank` in `place-catalogue.ts`.
- Rewrite the 27 hand-curated rows in `known_places.json`. In Waterloo: UW main campus, Laurier Waterloo campus, Conestoga Waterloo campus, Uptown Waterloo, Waterloo Park, Conestoga Mall, The Boardwalk, David Johnston Research + Technology Park, plus every ION station (from GTFS, not typed by hand). Commute targets outside coverage (they resolve, but no listings are shown there): UW School of Pharmacy (downtown Kitchener), Conestoga Doon, Downtown Kitchener, Communitech, Grand River Hospital, St. Mary's General Hospital, Kitchener Central Station / GO, Region of Waterloo International Airport.
- Replace the group aliases in `place-catalogue.ts` (`uoft`, `u of t`, `york`) with `uw` / `uwaterloo` / `university of waterloo`, `laurier` / `wlu` / `wilfrid laurier`, `conestoga`.

**Parser and resolver**

- `lib/parse/instruction.ts`: rewrite the geographic context for Waterloo, Ontario. Replace "The Well" example with a Waterloo one (e.g. "near the boardwalk" = The Boardwalk shopping centre). Add: "Waterloo" alone is the city; "UW" is the University of Waterloo; listings are Waterloo only, but Kitchener places are valid commute targets.
- `lib/parse/resolve.ts`: `torontoBounds` → `regionBounds` (Waterloo plus Kitchener, `43.37,-80.62,43.53,-80.37`, so commute targets resolve); the suffix-strip regex `toronto, ontario` → `(kitchener|waterloo)(, ontario)?`.
- `lib/parse/fallback.ts`: the configured boxes `downtown` and `scarborough` become `uptown` (Uptown Waterloo) and `university district` (Northdale); mode regex drops `ttc|subway`, adds `grt|ion|lrt`.
- `lib/parse/areas.ts`: comments and examples; drop the `wards` half of its lookup, neighbourhoods work as is.
- Every `*.test.ts` under `lib/parse` uses Toronto prompts and coordinates; they are rewritten, not deleted (see task list).

## Civic layer, safety and costs

The area card and the neighbourhood explorer keep their design; the indicator list shrinks by two (RentSafeTO) and every "vs Toronto" comparison becomes "vs Waterloo".

**Area card and explorer (SPEC 9.1, 9.2)**

| Indicator | Source in Waterloo | Notes |
| --- | --- | --- |
| Typical asking rent (ours, 30 days) | Our listings | Unchanged; "Not enough data" under 5 comparables will show more often |
| Renter households % | 2021 Census, DA-aggregated | Sum of DA counts per neighbourhood |
| Renters spending 30%+ on shelter | 2021 Census, DA-aggregated | DA-level suppression leaves gaps; show "Not enough data" |
| Median household income | 2021 Census | Only where the neighbourhood is one DA-dominated unit; else hidden |
| Rapid transit within 800 m | GRT GTFS, ION stops | Metric SRID changes from EPSG:2952 (MTM 10) to EPSG:2958 (UTM 17N, NAD83 CSRS) |
| Development applications, last 12 months | Waterloo quarterly report | If it is tabular without points, the indicator is hidden and `/data` says why |
| Police-reported crime (opt-in) | WRPS occurrences | Only if the safety check below passes |

The explorer shows neighbourhoods only: remove the ward toggle from the map and the ward list from `apps/web/src/app/areas/page.tsx`.

**Safety (SPEC 7.6) — gated on a data check**

WRPS publishes one occurrence row per call with a "general location", but the page does not say what that location is. P0 opens the 2025 file (38.7 MB XLSX) and decides:

1. **Points, blocks or intersections:** geocode, count by neighbourhood, divide by 2021 Census population from the same DA aggregation, average 2023–2025. Use the closest offence groups to the five TPS indicators (assault, break and enter, auto theft, robbery, theft over $5,000). Rewrite every caveat in `engine/safety.ts` to name WRPS, and state that the rates are computed by Rent K-Dubs from WRPS data, not published by WRPS.
2. **Only municipality or patrol zone:** too coarse for a neighbourhood rate. Turn the safety preference, its chip, and map layer off, and say on `/data` why.

Either way, keep the rules unchanged: opt-in, never "safe" or "unsafe", the disclaimer everywhere crime appears, and the parser never sets a limit. Occurrence data counts calls, not confirmed crimes; that becomes an extra caveat.

**Benchmarks and costs (`db/seed/benchmarks.json`, `engine/benchmark.ts`)**

- Re-pull StatCan 46-10-0092-01 for the Kitchener–Cambridge–Waterloo CMA (all bedroom sizes, latest 8 quarters). Label: "Waterloo-area average asking rent". The CMA also includes Kitchener and Cambridge; say so in the label's note.
- Transit row: GRT adult monthly pass $104. Add a renter setting "I have a U-Pass" (UW, Laurier, Conestoga students) that sets transit cost to $0 in the monthly-cost view, with the note that the U-Pass is paid through tuition.
- Utilities: the Toronto AMR utility rows have no Waterloo counterpart. Until one is chosen, keep the 20 utility rows as Ontario-wide sample figures with `sample: true` and say so in the UI.
- `engine/carbon.ts`: replace the TTC notes with GRT; transit stays "not counted" unless GRT publishes per-passenger-km figures.

## Branding, copy and database

**Brand.** The CN Tower is the brand mark today: the "I" in the wordmark, the header logo and the favicon (`components/brand/cn-tower.tsx`, `app/icon.svg`, `landing.css`). The landing skyline draws the CN Tower, the Rogers Centre and a TTC streetcar (`components/landing/skyline.tsx`, `scenes.tsx`), and its wordmark reads "RENT THE 6IX".

- New mark: an original drawing, not a copy of any institution's or transit agency's logo. Suggested: a stylised ION light-rail car seen from the front, or a "K-W" monogram (the name stays, even though coverage is Waterloo only). The new mark replaces the "I" trick in the wordmark.
- New skyline: generic mid-rise towers, a light-rail train on its own track, and Silver Lake in Waterloo Park. No UW, Laurier, GRT or ION logos.
- Wordmark "RENT K-DUBS"; page titles "Rent K-Dubs"; package scope `@rentthe6ix/shared` → `@rentkdubs/shared` (touches every import; do it in one commit with a codemod).
- Domain: `6ix.casa` needs a successor. Update `Caddyfile`, `deploy.sh` (`/srv/rentthe6ix`), `docker-compose.yml` (`name: rentthe6ix`), `Dockerfile` target tags and `vercel.json` if used.

**Copy.** `apps/web/messages/en.json` (1,039 lines) has about 50 lines naming 6ix, Toronto, TTC, UofT, Scarborough, TPS or RentSafeTO. Every example prompt changes, e.g. "2-bed near UW under $2,200, 15 min by ION, in-suite laundry" and "room near Laurier for the winter term, furnished". Hard-coded English outside `en.json` must also move: `engine/caveats.ts`, `engine/safety.ts`, `engine/benchmark.ts`, `lib/db/area-facts.ts` ("Listings RentThe6ix collected"), `lib/ai/briefing.ts` ("in Toronto").

**Database.** Start a fresh database rather than migrating Toronto rows: Toronto listings, civic tables and caches have no use in Waterloo, and `sources` would mix both cities on `/data`. Migrations 001–008 stay as merged; one city means no new geography columns. Add:

- `009_listing_terms.sql` (P1): `listings.lease_term_months smallint NULL`, `listings.sublet text CHECK ('yes','no','unknown')`.

Kept as they are: `buildings` (reused for building names, Additions item 2), `listing_observations`, `travel_times` or `ai_cache`. `listings.source` keeps `torontorentals` in the shared zod enum (the SQL column has no CHECK) so old fixtures still parse.

Shared schemas (`packages/shared/schemas/index.ts`): remove `'rentsafeto'` from `yearBuiltSource` only after the UI stops reading it; remove the `ward` area kind from the area filter, `AreaSchema` and the area routes (`briefing.ts`, `area-route.ts`, `safety-route.ts`).

## File-by-file change map

Paths are from the repo root. "Rewrite" = new data or logic; "Edit" = names, constants, copy; "Remove" = delete or hide.

| Area | Files | Change |
| --- | --- | --- |
| Civic loaders | `apps/worker/src/civic/areas.ts` | Rewrite: load Waterloo neighbourhoods and city boundary from ArcGIS, prefixed ids |
|  | `civic/address-points.ts` | Rewrite: Waterloo ArcGIS source; ward fields ignored |
|  | `civic/census.ts` | Rewrite: StatCan DA profile + DA boundaries → neighbourhood sums |
|  | `civic/transit-stops.ts` | Edit: GRT zip URL, rapid rule (route 301 / type 0) |
|  | `civic/dev-applications.ts` | Rewrite: Waterloo quarterly report; units parsing re-checked |
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
| Web: map + geo | `components/map/results-map.tsx` | `TORONTO` centre → Waterloo (about −80.53, 43.47), zoom |
|  | `lib/geo/otp.ts`, `route-times.ts` | Edit: `torontoDate` → `localDate`; grid-cell comment |
| Web: listing UI | `components/listing/*` (building section, nearby TTC wording), `results/*`, `safety/*` | Remove building block; "TTC stop" → "GRT stop" / "ION station" |
| Brand | `components/brand/cn-tower.tsx`, `app/icon.svg`, `components/landing/skyline.tsx`, `scenes.tsx`, `landing.css`, `app/layout.tsx` | Rewrite art and wordmark |
| Copy | `apps/web/messages/en.json` | Edit \~50 lines |
| Tests | 53 test files across web, worker and shared that name Toronto places or sources (e.g. `place-normalization.test.ts`, `geocoding.test.ts`, `chips.test.ts`, `election.test.ts`) | Rewrite inputs and expectations |
| Infra | `package.json` names, `Caddyfile`, `deploy.sh`, `Dockerfile`, `vercel.json`, `.serena/project.yml` | Edit names, domain, paths |
| DB | `db/migrations/009_listing_terms.sql`, `010_buildings.sql` | New |
| Docs | `README.md`, `SPEC.md`, `CLAUDE.md`, `docs/datasets.md`, `apps/worker/SOURCES.md`, `DEVPOST.md`, `PROGRESS.md`, `PERSON_*.md`, `TEAM.md` | Rewrite Toronto sections; archive Hack the Valley material |
| Leave alone | `apps/search/**` (validation logs, patches) | Archive as Toronto history; not loaded at runtime |

## Additions requested 2026-11-20

Five additions. Two change how listings get in (Facebook, blocked sources), and three change what renters see (address pages, search, UI). One line holds across all five: no proxy rotation, CAPTCHA solving or logged-in crawling. Those get around a site saying no, and the fetch layer was built to stop at that point. Marketplace through Apify is the one accepted exception (item 1).

### 1. Facebook Marketplace via Apify

Decided 2026-11-20: Marketplace becomes a source, `facebook_marketplace`, fed by Apify's [Facebook Marketplace Scraper](https://apify.com/apify/facebook-marketplace-scraper) (`apify/facebook-marketplace-scraper`), not our own crawler. This reverses the Toronto team's no-go in `apps/worker/SOURCES.md`; record the reversal there and in the SPEC change log.

**What the actor offers** ([input schema](https://apify.com/apify/facebook-marketplace-scraper/input-schema)): three inputs. `startUrls` (required) takes Marketplace location, category or search URLs; `resultsLimit` caps listings per run; `includeListingDetails` (default off) adds description, coordinates, timestamp and listing attributes. It has no login, cookie or proxy input. Pricing is per result: from $2.60 per 1,000 listings on paid plans, with a free plan of $5 monthly credit (about 800 items). Prices on the page are inconsistent, so confirm in K0.7.

**Adapter (`apps/worker/src/sources/facebook-marketplace.ts`).** It calls Apify's REST API instead of CloakBrowser, so it does not use `Session`:

1. **Index run, cheap:** `startUrls` = the Waterloo property-rentals page (slug to confirm, e.g. `facebook.com/marketplace/waterloo/propertyrentals`; Marketplace's radius will pull in Kitchener, which the boundary rule drops), `includeListingDetails: false`, `resultsLimit` from `APIFY_FB_RESULTS_LIMIT`. Start the run, poll until it finishes, read the dataset items.
2. **Detail run, new listings only:** ids not yet in `listings` go into a second run with `includeListingDetails: true`, if the actor accepts item URLs as `startUrls` (K0.7). Otherwise run details on everything with a lower limit.
3. **Map to `RawListing`:** `id` → `sourceListingId`; `listingUrl` → `sourceUrl`; `marketplace_listing_title` → title; `listing_price` → `monthlyRentCad`; `custom_sub_titles_with_rendering_flags` → beds/baths by keyword rules; `location` and detail coordinates → `lat`/`lng` with `locationPrecision: 'area'` unless the text has a street address or building name that matches (item 2); detail description → `description`; `is_live` / `is_pending` / `is_sold` → status.
4. **Drop at the door** (never stored or logged): `marketplace_listing_seller`, `is_viewer_seller`, `origin_group`, `listing_video`, `delivery_types`. `primary_listing_photo` is not stored; `imageUrl` stays null unless the team approves hot-linking Facebook's CDN.
5. Add `facebook_marketplace` to `AdapterId`, the shared `source` enum and `DEFAULT_SOURCES`; the existing scrub, normalize, geocode, dedupe and freshness steps run unchanged.

**Config (server-only, SPEC 20):** `APIFY_TOKEN`, `APIFY_FB_RESULTS_LIMIT` (default 300), `APIFY_FB_MONTHLY_BUDGET_USD` (the worker skips the run once the month's spend, read from Apify's run stats, reaches it). Schedule: once a day, not every 6 h.

**Cost:** at 300 listings a day plus details for new ones, roughly 10,000–15,000 results a month, about $26–$75 at the listed per-1,000 prices. Confirm after the first week.

**Caveats the team accepts with this choice:**

- The project's own fetch rules (stop on a block, no proxies) don't reach inside Apify: how the actor gets past Facebook is Apify's business, not visible to us. Note this on `/data` and in `SOURCES.md`.
- The actor's output includes seller data; dropping it in the adapter is a hard rule with a test that fails if any seller field reaches `listings`.
- Listing text is untrusted like every source: delimited in prompts, sanitised before rendering.
- If a run fails or returns zero items, the source shows unhealthy on `/status` and the app runs on the other sources.

Facebook *group* posts are not covered by the actor and still come in through Paste a listing.

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

### 3. Better search

The biggest search problem is speed. `PERSON_B.md` records main-model parses of 7–11 s, with four of six live requests hitting the 12 s timeout. The README screenshot also shows travel times as distance-based estimates and "Showing 25 of 1,988". In order of impact:

1. **Results in about a second.** Run the deterministic parser (`lib/parse/fallback.ts`, already written) first and show results at once. The AI parse then refines the chips, showing "Refined your filters" with an undo. Use the fast model for parsing by default and the main model only on retry. Target: time to first results p50 under 1.5 s, p95 under 3 s, shown on `/status`.
2. **Search where you look.** A "Search this area" button after panning the map, draw-an-area, and a multi-select of named neighbourhoods.
3. **Student filters:** whole unit vs room (`rentIsPerRoom` exists), lease term 4/8/12 months, sublet, furnished. These need the P1 fields from Listings ingestion.
4. **Real travel times in ranking:** wire OTP into search so "15 min by ION" filters on routed times, not straight-line estimates.
5. **Sorts:** add price per bedroom and nearest to a chosen place, next to the six in `SearchIntentSchema.sortBy`.
6. **Saved searches in the browser:** saved in local storage with "4 new since your last visit". No accounts and nothing on the server; push alerts are out because they need stored subscriptions.
7. **"Show 25 more"** with stable ordering, replacing a fixed first page.

### 4. Better UI

These come from the README screenshots of the Toronto build; a 5-person test with Waterloo students goes first (task: find a 4-month room near UW under $900), and its findings reorder this list.

- **Cards:** price and the Underpriced label sit at the bottom, under seven lines. Move them to the top line. Fold the travel lines into one ("17 min transit · 5 min walk to groceries"). Drop the carbon link and the score bar from the card; keep them on the detail page.
- **Plain names:** chips say "UofT St. George campus representative point". Show the place name; keep "representative point" in the detail tooltip.
- **Map:** price pins at street zoom instead of count-only clusters; one pin per building with a listing count (item 2).
- **Mobile:** list first with a map toggle, a sticky filter and sort bar, and listing detail in a bottom sheet.
- **Landing:** Waterloo example prompts; quick-start chips (Near UW, Near Laurier, Uptown, Room under $1,000) that fill the prompt; a Paste a listing card for Facebook group posts.
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
- [ ] K0.3 Pick Waterloo's neighbourhood layer (planning districts vs neighbourhood associations).
- [ ] K0.4 Confirm the GRT GTFS URL and ION's `route_type`.
- [ ] K0.5 Check Kijiji `l1700212`, Rentals.ca `/waterloo`, Zillow and Realtor.ca return Waterloo results; count active listings per source inside the Waterloo boundary.
- [ ] K0.6 Pick the utility-cost source; pick the domain.
- [ ] K0.7 One Apify run on the Waterloo rentals URL (resultsLimit 50, with and without details): confirm URL slugs, fields, whether item URLs work as startUrls, and the real per-1,000 price. Record in `SOURCES.md`; go or no-go.

**K1 — Rename and neutralise (app still runs on sample data)**

- [ ] K1.1 Package scope and project names (`rentthe6ix` → `rentkdubs`), one codemod commit.
- [ ] K1.2 Brand mark, favicon, landing skyline, wordmark.
- [ ] K1.3 `en.json` and hard-coded copy; example prompts.
- [ ] K1.4 Remove RentSafeTO from engine, schemas, UI; tests green.
- [ ] K1.5 Map centre, resolver bounds, parser instruction, configured areas.

**K2 — Geography and civic data**

- [ ] K2.1 `civic/lib/arcgis.ts`.
- [ ] K2.2 Neighbourhoods and city boundary loader. Check: every listing point inside coverage lands in exactly one neighbourhood.
- [ ] K2.3 Address points loader. Check: 20 random Waterloo addresses geocode within 10 m.
- [ ] K2.4 GRT stops + rapid flag. Check: every ION station flagged rapid.
- [ ] K2.5 POIs and known places regenerated.
- [ ] K2.6 Census DA aggregation. Check: neighbourhood renter counts sum to Waterloo's 2021 total within rounding.
- [ ] K2.7 Development applications.
- [ ] K2.8 Crime rates (if K0.2 = option 1), else safety off with `/data` note.
- [ ] K2.9 Area indicators; remove ward pages, ward toggle and election box; explorer shows neighbourhoods only.

**K3 — Listings, travel and costs**

- [ ] K3.1 Adapters and geocode coverage rule; first full ingest. Check: ≥ 300 active listings, 0 outside Waterloo.
- [ ] K3.2 OTP graph for the Waterloo area. Check: UW → Downtown Kitchener by transit returns an `otp` time (out-of-coverage targets must still route).
- [ ] K3.3 Benchmarks (KCW CMA), GRT pass, U-Pass setting.
- [ ] K3.5 Manual seed rows; demo snapshot.

**K4 — Docs and release**

- [ ] K4.1 Rewrite `SPEC.md` Toronto sections from this doc, with a Change log line.
- [ ] K4.2 `README`, `DEPLOY.md`, `CLAUDE.md` project line, `docs/datasets.md`, `/data` page.
- [ ] K4.3 `grep -riE "toronto|6ix|ttc|uoft|rentsafe|tps"` over code returns only the time zone, history and archived files.
- [ ] K4.4 `pnpm typecheck && pnpm lint && pnpm test`; deploy to the new domain.

**K5 — Additions (can start after K1; K5.5 belongs before K3.1)**

- [ ] K5.1 Instant results from the deterministic parser, AI refinement with undo; time-to-first-results on `/status`.
- [ ] K5.2 Migration 010, `buildings.csv seed, OSM/Rentals.ca/Zillow candidates, address ↔ name matching, /building/[slug] page, building names in search. Check: 30 sampled listings near UW and Laurier get the right building or none`.
- [ ] K5.3 `facebook_marketplace` adapter (Apify API) with fixture tests from a saved dataset; Facebook formats in the paste parser for group posts. Check: a one-page Waterloo run returns listings with rent, beds and area, and stores no seller fields.
- [ ] K5.4 UI pass after a 5-person student test: cards, plain names, price pins, mobile list-first, landing chips, contrast.
- [ ] K5.5 Crawler: newest-first stop rule, saved cursors, per-source pacing and budgets, robots/terms check, `/status` block reporting. Check: a full Waterloo run finishes with no 429.
- [ ] K5.6 Access requests to Rentals.ca, Kijiji and (via DDF) Realtor.ca; record answers in `SOURCES.md`.
- [ ] K5.7 Search: map area search, student filters, new sorts, saved searches in the browser, "Show 25 more".

P1 after release: lease term and sublet fields (migration 009), GO Transit GTFS, Waterloo rental-licence link.

## Open questions and risks

- [ ] **Safety:** is the WRPS "general location" precise enough for neighbourhood rates? If not, ship without the safety feature. (K0.2)
- [ ] **Waterloo neighbourhoods:** planning districts (fewer, census-aligned) or neighbourhood associations (named, may not cover the whole city)?
- [ ] **Thin comparables:** Waterloo alone has far fewer listings than Toronto, so many 3-bed or outer-neighbourhood estimates will say "Not enough data". Widen the comparables radius ladder, or accept it?
- [ ] **Student market:** build lease-term and sublet fields in the first release or P1? Without them, 4-month furnished sublets skew rent estimates near UW and Laurier.
- [ ] **Utilities:** which source replaces Toronto's utility allowances, or drop utilities from monthly cost?
- [ ] **Domain and hosting:** new domain; reuse the Vultr instance or a new one?
- [ ] **WRPS licence:** WRPS states no licence on the occurrence page; ask before showing derived rates.
- [ ] **Hackathon framing:** the README, DEVPOST and SPEC tie the project to Hack the Valley and the School of Cities Toronto track. Keep that history in an "Origins" note or remove it?

* [ ] **Building names:** who curates and reviews the building catalogue (buildings.csv), and how often?
* [ ] **Kijiji runner:** keep the laptop runner, rely on Paste a listing, or pause Kijiji until it answers an access request?
* [ ] **Marketplace upkeep:** who owns the Apify account and monthly budget, and do we show a thumbnail from Facebook's CDN or none?

Risk: listing sites change markup or block scrapers more readily for smaller markets. The `manual` source and Paste a listing keep the app usable if an adapter breaks, as in Toronto.

## Sources

Code references are from `aesthetic0001/rent-k-dubs` at `b4c0c4a`. Pages opened or searched on 2026-11-20:

- [GRT open data](https://www.grt.ca/about-grt/open-data/) · [GRT fares](https://www.grt.ca/en/fares-passes/fares.aspx) · [Mobility Database: GRT GTFS](https://mobilitydatabase.org/feeds/gtfs/mdb-721)
- [Region of Waterloo open data](https://www.regionofwaterloo.ca/en/regional-government/open-data.aspx)
- [City of Waterloo open data and maps](https://www.waterloo.ca/council-and-city-administration/open-data-and-maps/) · [Waterloo planning data](https://www.waterloo.ca/planning-and-development/explore-planning-and-land-use-data/) · [Waterloo rental housing support](https://www.waterloo.ca/community-support/get-rental-housing-support/)
- [WRPS statistics and data](https://wrps.ca/node/84) · [WRPS 2025 occurrence data](https://wrps.ca/resource/2025-occurrence-data)
- [StatCan Quarterly Rent Statistics release (KCW CMA)](https://www150.statcan.gc.ca/n1/daily-quotidien/250625/dq250625b-eng.pdf) · [Table 46-10-0092-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=4610009201)
- [Waterloo renovation licence by-law](https://www.waterloo.ca/bylaws-and-enforcement/bylaw-directory/rental-housing-renovation-licence-bylaw/)
