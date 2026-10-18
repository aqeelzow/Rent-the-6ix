# DEVPOST.md — submission draft

Owner: **D** (P5.6), with everyone reviewing. Fill in the blanks after S4; paste into Devpost before the deadline. Keep claims to what the deployed app actually does.

## Name and tagline

**RentThe6ix** — Find the best-fit, best-value rental in Toronto, and see the neighbourhood around it.

## Links

- Live app: ______
- Repo (public): ______
- Demo video: ______

## Tracks

Hack the Valley × School of Cities · Gemini API · Vultr · TigerData

## Who is the user?

Toronto renters, especially students, newcomers and young families, searching on a phone. Secondary: tenant organizers and journalists comparing rents and housing pressure across neighbourhoods and wards.

## What problem are they facing?

Rental listings are scattered across sites and dozens of Facebook groups. Renters can't easily tell whether a price is fair, whether a building is maintained, how long the trip to work or the supermarket really is, or what "affordable" means once transportation is counted. The public data that would help (RentSafeTO inspections, census profiles, transit schedules, development applications) exists but renters never see it.

## How we solve it with the data we have

_(2–4 sentences: one prompt → editable filters; listings from ______ sources ranked on price vs market, travel time by transit/car/walk/bike, the home itself and optional safety; every listing paired with Toronto open data. Gemini interprets and explains; all numbers come from our engine and TigerData.)_

## How it benefits the user

_(Faster search; a clear "underpriced / reasonably priced / overpriced" check with the comparables shown; travel times labelled by how they were measured; building and neighbourhood facts at the moment of decision; neutral ward housing briefings ahead of the October 26, 2026 election.)_

## How we built it

One prompt, one pipeline. The model does the reading, a deterministic engine does the arithmetic, and TigerData holds the facts. Nothing the model says is trusted as a number: it only proposes filters, and every filter must quote the renter's own words to survive.

### The pipeline, prompt to ranked listings

1. **Interpret** — `POST /api/search/parse` sends the sentence to Gemini and validates the reply against a Zod schema of the whole search intent (rent range, bedrooms, unit type, pets, parking, laundry, availability, areas as neighbourhoods/wards/bounding boxes, travel targets with a mode and minute budget, household income, sort order, must-have vs preference). Each field carries the phrase that justified it; a field whose evidence is not in the prompt is dropped and surfaced in the UI as "requests we couldn't use" instead of silently narrowing the search. A deterministic parser runs beside the model, supplies area names and restores any hard travel bound the model softened. If the model is slow, busy or invalid, the deterministic parse answers and the UI says so. Destination names resolve through known places → City address points → the civic area table → MapTiler geocoding, capped at 3 s.
2. **Find candidates** — the intent becomes one parameterized SQL query: hard criteria are pushed into Postgres (rent range, bedrooms, unit type, year built, AC, pets, parking, laundry, utilities, availability, lease term, neighbourhood/ward/bounding box, plus `status='active'` and `duplicate_of IS NULL`). Unknown fields are handled explicitly — kept and flagged as unconfirmed, or hidden when the renter asks for confirmed-only — so "parking" never quietly matches listings that never said. A cheap in-process pass then caps the pool at 500 candidates before any expensive enrichment.
3. **Value every candidate** — instead of one database round trip per listing, the whole candidate set shares three reads: one comparable pool (PostGIS, within 1/2/3 km and 60 days, widened in code as needed), one stored-facts read, one building read. Each listing is then valued against its comparables with distance, recency, bathroom/sqft and building-age weights, adjusted for utilities, parking, furnished and in-suite laundry. Fewer than five comparables means "not enough data" rather than a confident guess; the price label widens when confidence is low. A 500-listing search costs three queries, not ~1,500.
4. **Answer travel honestly** — a target with coordinates is measured straight-line and shown as a labelled per-mode estimate (walk 4.8 km/h, transit 18 km/h with detour and wait overhead, and so on). A deployment that switches a router on replaces those rows with real times inside a shared 3 s budget; anything unrouted stays an estimate, never a fake minute. "Near a park / groceries / school / library" has no single destination, so nearest-amenity distances come back in one spatial query per category for all candidates at once.
5. **Score and rank** — must-haves remove a listing; preferences score it out of 100 and are blended by intent-sensitive weights (value vs comparables 30, travel 30, the home itself 25, price 15 — fairness rises to 45 when it is a preference rather than a filter — and safety 15 only when the renter opts in). A must-have the listing never states scores halfway and is ranked below confirmed matches rather than presented as a match; ties break on valuation confidence, then how many fields the listing actually states, then recency, then rent. Cards carry the top three comparables and the price label; the detail endpoint returns every comparable, the building record, area indicators and the explanation.
6. **Stay fast on repeat** — an identical search answers from a 60 s in-memory cache (reload, Back from a listing, React re-running an effect), AI parses are cached in Postgres by prompt, and expensive percentile questions ("cheapest 10%", "shortest trip to campus") run as bounded background jobs with a token to poll, returning "unavailable" rather than a partial answer when routed times are incomplete. On the live 23 k-listing database a 500-result search takes ~1.2 s warm and a repeat ~60 ms, with a ~2 MB response instead of 19 MB.

### Stack

- **Gemini:** structured intent extraction against a Zod schema with per-field evidence and a deterministic second opinion; grounded explanations that are rejected if a number is not in the engine's own output; paste-a-listing extraction; ward briefings written only from loaded civic facts.
- **TigerData:** PostGIS for candidate areas, comparable radii and nearest-amenity lookups; TimescaleDB hypertable of asking-rent observations plus a continuous aggregate; pg_trgm for address matching and de-duplication; every listing, comparable and civic fact the engine reads.
- **Vultr:** one instance running Docker Compose — the Next.js app, the listing worker, Caddy in front, and OpenTripPlanner 2 behind an opt-in profile — talking to TigerData. One Dockerfile, two build targets, so web and worker share the install and build layers.
- **Next.js 16 / React 19 / TypeScript:** App Router route handlers for the API, Zod schemas shared by browser, server and model, MapLibre GL for the map, Zustand for search state. A pure engine package (filters, valuation, travel, scoring) holds the rules so they can be unit-tested without a database; the suite is 319 tests.

## Responsible interpretation

- Asking rents aren't signed-lease rents; labels need ≥ 5 comparables and widen when data is thin.
- Travel figures are distance-based estimates, labelled as estimates (driving assumes no traffic); only a routed row from the optional OpenTripPlanner deployment is presented as a measured trip, and an unrouted target stays a distance.
- Safety is opt-in, neighbourhood-level, relative to the city, with TPS caveats; never "safe/unsafe".
- No candidate or party content; election info is official links only.
- Listing collection: no photos or contact details stored.

## Challenges / what we learned / what's next

- ______
- ______
- Next: ______ (e.g. traffic-aware driving, saved-search alerts, roommate matching)

## Data sources

_(Copy every link from SPEC 8.1–8.2 that we actually used, with licence. Remove any we didn't load.)_

| Dataset | Publisher | Link | Licence |
| --- | --- | --- | --- |
| Neighbourhoods (158) | City of Toronto | https://open.toronto.ca/dataset/neighbourhoods/ | OGL – Toronto |
| Neighbourhood Profiles (2021 Census) | City of Toronto | https://open.toronto.ca/dataset/neighbourhood-profiles/ | OGL – Toronto |
| City Wards | City of Toronto | https://open.toronto.ca/dataset/city-wards/ | OGL – Toronto |
| Ward Profiles | City of Toronto | https://www.toronto.ca/city-government/council/ward-profiles/ | OGL – Toronto |
| Apartment Building Registration / Evaluations (RentSafeTO) | City of Toronto | ______ | OGL – Toronto |
| Address Points | City of Toronto | ______ | OGL – Toronto |
| TTC Routes and Schedules (GTFS) | City of Toronto / TTC | https://open.toronto.ca/dataset/ttc-routes-and-schedules/ | OGL – Toronto |
| Development Applications | City of Toronto | ______ | OGL – Toronto |
| Libraries, parks & rec, schools | City of Toronto | ______ | OGL – Toronto |
| Neighbourhood Crime Rates | Toronto Police Service | https://data.torontopolice.on.ca/pages/open-data | Open Government Licence |
| Asking rents, table 46-10-0092-01 | Statistics Canada | https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=4610009201 | Statistics Canada Open Licence |
| Rental Market Survey tables | CMHC | https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-data/data-tables/rental-market/rental-market-report-data-tables | ______ |
| OpenStreetMap (Ontario extract) | OSM contributors / Geofabrik | https://download.geofabrik.de/north-america/canada/ontario.html | ODbL |
| TTC fares | TTC | https://www.ttc.ca/fares-and-passes | — |
| Listings | ______ (sources marked go) | links on each listing | used for search; not redistributed |

## Team

- A — ______ (frontend & map)
- B — ______ (AI & search API)
- C — ______ (listings pipeline & valuation)
- D — ______ (civic data, travel & infra)
