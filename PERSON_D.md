# PERSON_D.md — Civic data, travel & infra

**Role:** the ground everything stands on: TigerData and the migrations, the Vultr instance and deployment, Toronto open data loaders, points of interest and transit stops, **OpenTripPlanner and every travel time** (transit, car, walk, bike), **crime rates for the safety preference**, neighbourhood and ward indicators, affordability, the explorer API, `/data` and `/status`, and the Devpost write-up with every data link.
**Owns:** see `TEAM.md` section 2 (folders) and `SPEC.md` 22.1 (roles). **Contracts you provide:** migrations, deploy pipeline, civic tables, `travel_times` + `routeTimes()`, `safetyFor()`, area indicators, explorer and travel/safety routes.
Task ids match `PROGRESS.md`; task details are in `SPEC.md`.

## Current state

- **Current task:** none in progress
- **Status:** not started   <!-- not started | in progress | blocked | at sync point -->
- **Next action:** P0.8 Tiger Cloud service + migrations, P0.9 Vultr instance + placeholder deploy; P0.4 dataset link check in parallel.
- **Blockers / needs from others:** A's scaffold (P0.1) for the placeholder app.
- **Last updated:** 2026-10-15 (file created from SPEC)

## Handoff notes

> Where an unfinished task stopped, gotchas, things to verify. Replace each session.

- **OTP is on the critical path** (SPEC 7.4). Start the graph build in Phase 1, not later: TTC GTFS + Geofabrik Ontario extract clipped to Toronto + 10 km (osmium), all four modes. Needs ~4–6 GB RAM, so the Vultr instance is 4 vCPU / 8 GB. Build once, keep the graph on disk. If OTP isn't working by S3, everything falls back to labelled straight-line distance; tell the team at once.
- **Driving is free-flow** (no traffic, no parking). Return it with `method: 'otp'` and the label "driving, no traffic".
- **Precompute budget:** ~108k routes for 1,500 listings × 9 categories × 4 modes × 2 nearest; ~1.5 h at 20 req/s. Order: new listings → categories in the demo prompts (supermarket, school, rapid transit) → the rest. Run the full pass on the final snapshot before H30.
- **Groceries come from OSM** (`shop=supermarket`, `shop=greengrocer`, larger `shop=grocery`), not convenience stores. Schools need `elementary` / `secondary` subcategories from the City dataset.
- **Safety data:** TPS Neighbourhood Crime Rates, 158 neighbourhoods, 5 major crime indicators, 3-year average; `relativeRate` = neighbourhood ÷ city. Confirm the latest published years. Keep the caveats text in one place (`safety.ts`) so A and B show the same words.
- Some City dataset slugs in SPEC 8.1 are marked "(verify)". The old RentSafeTO evaluation dataset is **retired**; find its replacement. Record source URL, retrieval date and licence for every loader in the `sources` table.
- Ask the School of Cities organizers for the Toronto Civic Data Starter Guide in the first hour.
- `/status` is for judges: live counts (listings by source, observations, areas, travel times computed and % by OTP), last ingest per source, Vultr host/region, AI status, OTP status.

## Requests to others

- **To A:** the scaffold early (P0.1) so the placeholder deploy has something to run; build `/data`, `/status` and the explorer from my JSON routes.
- **To B:** the `TravelTarget`, travel-time row and safety types in the schemas (P0.5); call `routeTimes()` with a time budget, never block search on it.
- **To C:** tell me when the first ingest lands (P1.7) so the precompute job can start on real listings; hand over the final snapshot (P5.1).

---

## Task list (in order)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped. **Core** = needed for the demo. **Stretch** = drop first if behind.

### Before S1 (H0–H3) — Infra · Core
- [ ] P0.8 Tiger Cloud service (same region as Vultr); migrations 001 extensions (`postgis`, `timescaledb`, `pg_trgm`), 002 core tables (incl. `travel_times`, `ai_cache`, `sources`), 003 hypertable `listing_observations`
- [ ] P0.9 Vultr instance (4 vCPU / 8 GB), Docker Compose (`web`, `worker`, `otp`, Caddy), HTTPS, placeholder deployed, `deploy.sh` or GitHub Action; follow and correct the starter `DEPLOY.md` — record the URL below
- [ ] P0.4 Verify every dataset link in SPEC 8.1–8.2; fix the spec where a slug changed

### S1 → S2 (H3–H12) — Civic data & router · Core
- [ ] P1.10 Neighbourhoods (158) and wards (25) boundaries
- [ ] P1.11 Address Points (for C's geocoding and B's place resolution)
- [ ] P1.12 TTC GTFS: stops with `is_rapid`, route shapes for the map layer
- [ ] P1.13 POIs: City libraries, parks, community centres, schools (elementary/secondary); OSM supermarkets, pharmacies, clinics
- [ ] P1.14 RentSafeTO: registration (year built, storeys, units) + current evaluations (scores, dates, sign colour)
- [ ] P1.15 OTP: clip OSM, build graph (transit, walk, bike, car), run in Compose; smoke-test one route per mode
- [ ] P1.16 `sources` table filled by every loader (URL, retrieved, licence, period)

### S2 → S3 (H10–H18) — Travel, safety, indicators · Core
- [ ] P2.10 Travel-time precompute job (2 nearest × categories × 4 modes, priority order, throttle, resumable) + tests on fixtures
- [ ] P2.11 `routeTimes(origins, targets, mode, budgetMs)` for ad hoc places, cached by 50 m origin grid; straight-line fallback with `method: 'straight_line'`
- [ ] P2.12 `POST /api/listings/[id]/travel` (all four modes per target, amenity reached, method)
- [ ] P2.13 TPS crime rates loader; `safetyFor(neighbourhoodId)` (rate, relativeRate, by type, years, caveats); `/api/areas/[kind]/[id]/safety` + tests
- [ ] P2.14 Area indicators: census (renter share, shelter cost 30%+, income), RentSafeTO average, dev applications 12 m, transit access, libraries, parks
- [ ] P2.15 Benchmarks seed: StatCan 46-10-0092-01 (Toronto, by bedrooms), CMHC zone averages (centroid mapping, labelled), TTC monthly pass price, sample utilities and car costs
- [ ] P2.16 Nearby query + `/api/listings/[id]/nearby`

### S3 → S4 (H16–H24) — Explorer & transparency · Core
- [ ] P3.10 Explorer API: `/api/areas?kind=&indicator=` (incl. crime as one indicator with caveats), `/api/areas/[kind]/[id]`
- [ ] P3.11 Continuous aggregate: weekly median asking rent per neighbourhood (from C's observations) + sparkline data
- [ ] P3.12 Affordability in the engine (`affordability.ts`): rent-to-income vs 30%, true monthly cost (rent + utilities + TTC pass or car) + tests
- [ ] P3.13 `/data` content: every dataset with link, period, retrieval date, licence, use; methodology (valuation, price label, travel, score, safety); limitations (SPEC 9.4)
- [ ] P3.14 `/api/health` + `/status` data

### S4 → S5 (H22–H30) — P1 · Stretch
- [ ] P4.30 Area compare API (up to 3)
- [ ] P4.31 Precompute the remaining categories for all listings

### S5 → end (H30–H36) — Submission
- [ ] P5.2 Full travel-time precompute on C's final snapshot (check `/status` shows ~100% OTP)
- [ ] P5.5d Error states for OTP down / DB slow in your routes
- [ ] P5.6 Finish `DEVPOST.md` (draft included): SPEC 24 answers, every data link, track usage (SPEC 14), screenshots; paste into Devpost
- [ ] P5.8 Final deploy; confirm the deployed app runs the demo with the snapshot
- [ ] P5.7 Rehearse the demo walkthrough (SPEC 23) ×3 with everyone

---

## Depends on others

- **A:** scaffold (S1); pages for `/data`, `/status`, explorer.
- **B:** schemas (S1).
- **C:** listings for precompute (S2 onward); observations for the rent aggregate (S3); final snapshot (S5).

## Feature map (your files)

| Feature | Key files | Notes |
| --- | --- | --- |
| Migrations | `db/migrations/001_extensions.sql` … `004_aggregates.sql` | |
| Deploy | `docker-compose.yml`, `Caddyfile`, `deploy.sh`, `DEPLOY.md` | |
| Civic loaders | `apps/worker/src/civic/*.ts` (`pnpm data:civic`) | each writes to `sources` |
| OTP | `otp/` (router config, build script, clipped OSM, GTFS) | graph on disk, not in git |
| Travel times | `apps/worker/src/pipeline/travel-times.ts`, `apps/web/src/lib/geo/route-times.ts`, `src/app/api/listings/[id]/travel/route.ts` | |
| Safety | `packages/shared/engine/safety.ts` (+ tests), `src/app/api/areas/[kind]/[id]/safety/route.ts` | caveat text lives here |
| Indicators & explorer | `apps/worker/src/civic/indicators.ts`, `src/app/api/areas/*` | |
| Affordability | `packages/shared/engine/affordability.ts` (+ tests) | |
| Benchmarks | `db/seed/benchmarks.json` | `sample` flag per row |

## Environment

- **Deployed URL:** (record here)
- **Vultr instance:** (region, plan, IP)
- **TigerData service:** (region, service id; `DATABASE_URL` in team password manager, not in git)
- **Env vars on the instance:** everything in SPEC 20.
