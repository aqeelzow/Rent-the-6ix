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

_(Faster search; a clear "underpriced / reasonably priced / overpriced" check with the comparables shown; real travel times; building and neighbourhood facts at the moment of decision; neutral ward housing briefings ahead of the October 26, 2026 election.)_

## How we built it

- **Gemini:** ______ (parse to structured filters with must-haves vs preferences; grounded explanations with a number check; paste-a-listing extraction; ward briefings)
- **TigerData:** ______ (PostGIS spatial joins and nearest-amenity queries; TimescaleDB hypertable of asking-rent observations + continuous aggregate; pg_trgm dedupe; precomputed travel times)
- **Vultr:** ______ (web app, listing worker, OpenTripPlanner router)
- Next.js, TypeScript, MapLibre, OpenTripPlanner 2, Docker

## Responsible interpretation

- Asking rents aren't signed-lease rents; labels need ≥ 5 comparables and widen when data is thin.
- Driving times assume no traffic; straight-line distance is never shown as minutes.
- Safety is opt-in, neighbourhood-level, relative to the city, with TPS caveats; never "safe/unsafe".
- No candidate or party content; election info is official links only.
- Listing collection: public pages only, robots.txt honoured, no photos or contact details stored, Facebook never scraped (paste instead).

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
