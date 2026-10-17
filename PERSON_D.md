# PERSON_D.md — Civic data, travel & infra

**Role:** the ground everything stands on: TigerData and the migrations, the Vultr instance and deployment, Toronto open data loaders, points of interest and transit stops, **OpenTripPlanner and every travel time** (transit, car, walk, bike), **crime rates for the safety preference**, neighbourhood and ward indicators, affordability, the explorer API, `/data` and `/status`, and the Devpost write-up with every data link.
**Owns:** see `TEAM.md` section 2 (folders) and `SPEC.md` 22.1 (roles). **Contracts you provide:** migrations, deploy pipeline, civic tables, `travel_times` + `routeTimes()`, `safetyFor()`, area indicators, explorer and travel/safety routes.
Task ids match `PROGRESS.md`; task details are in `SPEC.md`.

## Current state

- **Current task:** P2.10 travel-time precompute — the one table search actually needs and the largest unbuilt piece left
- **Status:** in progress   <!-- not started | in progress | blocked | at sync point -->
- **Next action:** P2.10/P2.11 — the OTP client, the resumable precompute job into `travel_times`, and `routeTimes()`; nothing travel-related exists yet (no `apps/worker/src/pipeline/travel-times.ts`, no `apps/web/src/lib/geo/`). Then P2.13 safety (`safetyFor()`, city baseline, route — data already loaded).
- **Blockers / needs from others:** P0.9 is blocked only on a Vultr instance (account access) — the stack files themselves are done. Nothing blocks P2.10/P2.13 locally; the graph is built and OTP runs in Compose.
- **Last updated:** 2026-10-17 (worker-cache volume added and verified; benchmarks seeded from official StatCan/TTC figures; P1.15 closed: 215 MB graph, four-mode smoke test green; crime indicators verified live)

## Handoff notes

> Where an unfinished task stopped, gotchas, things to verify. Replace each session.

- **Migrations are live (P0.8).** 001–003 plus C's 005–007 and D's 008 applied to the TigerData service (2026-10-17); `schema_migrations` records the checksum of each, and `db/migrate.mjs` **refuses to run a file whose checksum changed**. Once 002 is merged, every schema change is a new `004_*.sql` — never an edit.
- **No local `psql` on D's machine.** Use the Tiger CLI instead: `tiger db uri --with-password` (note: emits `postgresql://`, not `postgres://`), `tiger db query --command "select …"`, `tiger db query --file path.sql` for multi-statement files. `tiger` lives at `%LOCALAPPDATA%\Programs\TigerCLI\tiger.exe`. The CLI runs multi-statement files in one implicit transaction and commits on success — for throwaway checks, open with `BEGIN` and end with `ROLLBACK`.
- **Data health check: `db/queries/civic-status.sql`** (read-only, owner D). Run `tiger db query --file db/queries/civic-status.sql --read-only` from the repo root — eight queries covering every table's row count, whether the civic data reaches the listings, and one demo listing resolved end-to-end. Verified exit 0 on 2026-10-17. Nothing in it writes, so it is safe during a demo. Never check migrations by running SQL by hand: `schema_migrations` holds a checksum per file and a manual write makes `pnpm db:migrate` refuse the repo copy.
- **Early smoke-test (rolled back) still describes the schema, not the contents:** insert a listing omitting `location_precision` → defaults to `'area'`; KNN `<->` on `geography` returns metres (Parkdale→Union ≈ 4,860 m). The tables are no longer empty — see the loaders bullet above for real counts.
- **TigerData service is healthy — the "refusing connections" scare was transient.** `tiger service list` shows `ha5vgeeas8` `READY`; read-only, write-capable and `postgres.js` connections all succeed (~390 ms), `max_connections` is 200 with ~20 in use, and `pnpm db:migrate --status` reports `pending: none`. One earlier `CONNECT_TIMEOUT` in `db:migrate --status` did not reproduce, cause unknown. Untested: connections **from the Vultr instance**, because P0.9 has no instance yet.
- **Rotate the `tsdbadmin` password.** It was pasted into a shared thread, so it is in that transcript. Tiger console → service → reset password, then update `.env.local` everywhere and the instance env. TEAM.md section 7 says the same for every shared key.
- **`person-c` already contains this work.** Commit `bac2652` (the civic loaders, `008`, this file) is an ancestor of `origin/person-c`; local `devansh` is 19 behind and 0 ahead. Only `db/queries/civic-status.sql` was still uncommitted when this note was written.
- **`location_precision` default is `'area'`** — the least precise legal value. It originally defaulted to `'approx'`, which its own CHECK rejected; every insert would have failed. Keep new enum-ish columns' defaults inside their permitted sets.
- **Deployment stack is written and locally proven (P0.9).** `docker compose up -d --build` on this Windows machine brought up `web` (healthy), `worker` (exits 0 until C's loop lands — hence `restart: on-failure`) and `caddy` serving HTTPS with the security headers; `http://` → 308. Both image targets build; Next's standalone bundle lands at `apps/web/server.js`. What remains is the instance: create it, `git clone` into `/srv/rentthe6ix`, write `.env` (needs `SITE_HOST`, now in `.env.example`), run the same command, then `DEPLOY_HOST=… SITE_HOST=… ./deploy.sh` for every update afterwards. `deploy.sh` has only been syntax-checked, not run.
- **`docker compose` needs `.env` to exist** next to the compose file, and `SITE_HOST` has no default — both fail loudly on purpose. The OTP service sits behind the `otp` profile so a missing or stale graph can never break a deploy; `deploy.sh` rebuilds only `web worker`.
- **The worker cache is now a named volume (C's request, verified 2026-10-17).** `worker-cache:/app/apps/worker/.cache` in `docker-compose.yml`, so `--build` and container re-creation no longer discard the detail-page cache, the Gemini extract cache or the ingest snapshots. The path is derived from the code — every cache path is `new URL('../../.cache/…', import.meta.url)` from `apps/worker/src/**`, which resolves to `/app/apps/worker/.cache` because the worker stage's `WORKDIR` is `/app` (confirmed by printing the resolved path inside the built image, not by reading the Dockerfile). Tested with the real `rentthe6ix-worker` image: wrote a file through that URL, re-ran a fresh container on the same volume, file survived; a container without the volume had no `.cache` at all. `docker compose down -v` still deletes it.
- **Dataset links verified (P0.4).** `docs/datasets.md` has the exact resource URLs, formats and licences. Three corrections matter for the loaders: TPS crime rates are at `data.tps.ca` now (wide format: 158 neighbourhood rows × 222 columns, `*_RATE_2014…2025`), the RentSafeTO evaluation dataset is **not** retired, and the 2021 Neighbourhood Profiles are **XLSX only** (transposed sheet). The City portal returns HTTP 200 for *any* slug — never check a City link by status code, use the CKAN API.
- **Civic loaders are live (P1.10–P1.14, P1.16).** `pnpm data:civic [areas|addresses|pois|stops|buildings|crime|all]` in `apps/worker/src/civic/`. Loaded and verified 2026-10-17: 158 neighbourhoods, 25 wards, 525,372 address points (100% in a neighbourhood and a ward), 5,400 POIs, 9,409 TTC stops (148 rapid), 3,613 RentSafeTO buildings, 1,422 crime indicators, 11 `sources` rows. Every task is idempotent and re-runnable; each writes its `sources` row before its data.
- **Node 22.16 cannot run `.ts` by default**, so C's scripts and the loader need `NODE_OPTIONS=--experimental-strip-types` on this machine (`node --env-file-if-exists=../../.env.local src/civic/cli.ts`). Node 24 on the instance needs nothing.
- **Four City exports bite in the same way: the geometry is `MultiPoint`, not `Point`** (libraries, parks, schools). Reading `coordinates[0]` as a number silently yields zero rows — the POI task now fails loudly if any category is empty, because that is exactly how it failed the first time.
- **Codes are zero-padded in the boundary tables but not in the police file.** TPS `HOOD_158` is `83`, the City's `AREA_SHORT_CODE` is `083`; the crime loader pads. TPS also ships a UTF-8 BOM on the header row.
- **Resolve resource URLs at load time, never hard-code them.** `lib/ckan.ts` looks up the dataset and the named resource on every run, and its error lists the available names. Two real names differ from `docs/datasets.md`: the TTC archive is `TTC Routes and Schedules Data`, and the RentSafeTO file is `Apartment Building Registration Data CSV`.
- **The City's asset layers repeat an asset id** (one row per amenity), which Postgres rejects in a single `ON CONFLICT` batch; the POI loader collapses duplicates and reports how many. `buildings.address_norm` + migration `008` is what lets a building match an address point (98.7% do).
- **Unverified:** the RentSafeTO sign-colour bands (green ≥85, yellow 70–84, red <70) come from Toronto Community Housing and a law-firm summary, not from the City's own dataset; confirm before `/data` quotes them. Park/community-centre rows missing from the load are the 11 library features with no point geometry — accounted for, not lost.
- **Toolchain on D's machine:** Node 22.16 against the repo's `engines: >=24` (installs fine; `next build` is the risk). Corepack's pnpm cache is broken — use `npx pnpm@10.34.7 <script>`, which matches `packageManager` in the root `package.json` and keeps the lockfile unchanged.

- **OTP is built and answering (P1.15), on this machine only.** `./otp/build.sh` downloads the 1.03 GB Geofabrik Ontario extract plus the TTC GTFS zip, clips to `-79.77,43.49,-78.99,43.95` (Toronto + ~10 km) and writes `graph.obj`; the run took ~40 min and is resumable only by `--fresh`. The graph is in `otp/data/` (not `graphs/` — the image's entrypoint owns `/var/opentripplanner`, and a second directory argument aborts the build); `otp/data` and `otp/downloads` are git-ignored, so a fresh clone needs the build again. Start it with `docker compose --profile otp up -d otp` — the profile keeps a missing graph from breaking `docker compose up -d`. `./otp/smoke-test.sh` runs a throwaway Node container on the compose network because the service publishes no host port (OTP has no auth). Rebuild with `--fresh` when the City publishes a new GTFS feed; the `2.7.0` graph is not guaranteed loadable by another OTP version.
- **Sane travel times for Parkdale → U of T (43.6395,-79.431 → 43.6629,-79.3957):** walk 69 min, bike 33, drive 14, transit 44. If walk and transit come back identical, transit fell back to walking — that is a stale feed or an hour with no service, not a routing bug. The smoke test now picks the fastest itinerary and, for transit, the fastest one with a non-walk leg; before that it read `itineraries[0]`, which OTP often fills with the direct walk, and reported a 69 min "transit" trip that was just walking.
- **Driving is free-flow** (no traffic, no parking). Return it with `method: 'otp'` and the label "driving, no traffic".
- **Precompute budget:** ~108k routes for 1,500 listings × 9 categories × 4 modes × 2 nearest; ~1.5 h at 20 req/s. Order: new listings → categories in the demo prompts (supermarket, school, rapid transit) → the rest. Run the full pass on the final snapshot before H30.
- **Groceries come from OSM** (`shop=supermarket`, `shop=greengrocer`, larger `shop=grocery`), not convenience stores. Schools need `elementary` / `secondary` subcategories from the City dataset.
- **Benchmarks are loaded from the real StatCan file, not from a secondary summary (P2.15).** `db/seed/benchmarks.json` holds 11 rows: Toronto CMA **2026 Q2** asking rent by dwelling — apartment 0/1/2/3+ = $1,750 / $2,090 / $2,650 / $3,270, house 2/3+ = $2,710 / $3,630, room $840 — plus paid rent for 1 and 2 bedroom apartments ($1,840 / $2,160), and TTC fares. Figures came from the official CSV (`https://www150.statcan.gc.ca/n1/tbl/csv/46100092-eng.zip`, note the shorter name — `4610009201-eng.zip` is 404), Toronto CMA DGUID `2021S0503535`, and match the table page. Two traps: **asking ≠ paid** (asking is what new listings advertise; paid is what sitting tenants pay, so only asking belongs in a comparable-rent check), and StatCan publishes no paid rent for studios or 3+ bedroom apartments — those cells are absent, not zero. On transit: **the TTC Adult Monthly Pass no longer exists** — discontinued 2026-08-31, replaced by monthly fare capping (47 eligible fares, adult PRESTO $3.30), so the seeded monthly figure is $155.10 = 47 × $3.30 and is flagged `sample: true` because it is derived. Do not quote the old $156 pass or the $143 12-month pass as today's price. The loader validates the file with zod and refuses an unknown `sourceId` — both paths tested by breaking the file (exit 1, no rows written).
- **Safety data is loaded, the function is not (P2.13).** `area_indicators` holds 1,422 rows = 158 neighbourhoods × 9 offences (`crime:assault`, `autotheft`, `biketheft`, `breakenter`, `homicide`, `robbery`, `shooting`, `theftfrommv`, `theftover`), period `2023–2025`, unit `per 100,000`, source `neighbourhood-crime-rates`, and every row joins to `neighbourhoods.id`. What is missing: `packages/shared/engine/safety.ts` (none of `safetyFor`, `safetyScore`, the caveat text exists), the neighbourhood→rates lookup, `GET /api/areas/[kind]/[id]/safety`, and a **city baseline** — `area_kind` is constrained to neighbourhood/ward so there is no city row, and `relativeRate` needs Σ counts ÷ Σ population using the `POPULATION_2025` column the loader currently drops. Until then `apps/web/src/lib/api/runtime.ts` passes a hardcoded `safetyScore: 80`, so an enabled safety preference contributes a constant to every listing. Keep the caveats text in that one file so A and B show the same words.
- Some City dataset slugs in SPEC 8.1 are marked "(verify)", but all were resolved in `docs/datasets.md` (P0.4). The RentSafeTO evaluation dataset is **not** retired — `apartment-building-evaluation` still carries 2023-current plus pre-2023. Record source URL, retrieval date and licence for every loader in the `sources` table.
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
- [x] P0.8 Tiger Cloud service (same region as Vultr); migrations 001 extensions (`postgis`, `timescaledb`, `pg_trgm`), 002 core tables (incl. `travel_times`, `ai_cache`, `sources`), 003 hypertable `listing_observations` — applied 2026-10-17, verified live
- [~] P0.9 Vultr instance (4 vCPU / 8 GB), Docker Compose (`web`, `worker`, `otp`, Caddy), HTTPS, placeholder deployed, `deploy.sh` or GitHub Action; follow and correct the starter `DEPLOY.md` — record the URL below. **Files done and tested locally** (`Dockerfile`, `docker-compose.yml`, `Caddyfile`, `deploy.sh`, `.dockerignore`, rewritten `DEPLOY.md`); **left: create the instance, `SITE_HOST`, first deploy**.
- [x] P0.4 Verify every dataset link in SPEC 8.1–8.2; fix the spec where a slug changed — done 2026-10-16, recorded in `docs/datasets.md`

### S1 → S2 (H3–H12) — Civic data & router · Core
- [x] P1.10 Neighbourhoods (158) and wards (25) boundaries — loaded 2026-10-17 via `pnpm data:civic areas`; 158/25 rows, all SRID 4326, all valid, `AREA_SHORT_CODE` is the id (zero-padded, e.g. `044`)
- [x] P1.11 Address Points (for C's geocoding and B's place resolution) — 525,372 rows via `pnpm data:civic addresses`, paged from the CKAN datastore (the GeoJSON is 590 MB); 100% assigned a neighbourhood and a ward; `normalizeAddress()` in `apps/worker/src/civic/lib/address.ts` is the shared key for C's geocoder
- [~] P1.12 TTC GTFS: stops with `is_rapid`, route shapes for the map layer — 9,409 stops, 148 rapid (`route_type` 1/2) via `pnpm data:civic stops`; **route shapes not loaded** (no table for them — needs a decision with A)
- [x] P1.13 POIs: City libraries, parks, community centres, schools (elementary/secondary); OSM supermarkets, pharmacies, clinics — 5,400 rows in 8 categories from 4 datasets via `pnpm data:civic pois`
- [x] P1.14 RentSafeTO: registration (year built, storeys, units) + current evaluations (scores, dates, sign colour) — 3,613 buildings via `pnpm data:civic buildings`; 3,593 with a score, 3,565 matched to an address point on `address_norm`
- [x] P1.15 OTP: clip OSM, build graph (transit, walk, bike, car), run in Compose; smoke-test one route per mode — graph built 2026-10-17 (215 MB `otp/data/graph.obj` from a 225 MB save, OTP 2.7.0) and `./otp/smoke-test.sh` exits 0 for Parkdale → U of T: walk 69 min, bike 33, drive 14, transit 44 (`WALK+BUS+WALK+SUBWAY+WALK`)
- [x] P1.16 `sources` table filled by every loader (URL, retrieved, licence, period) — 11 rows; every loader writes its row before its data, and a loader that changes a dataset's resource URL updates it

### S2 → S3 (H10–H18) — Travel, safety, indicators · Core
- [ ] P2.10 Travel-time precompute job (2 nearest × categories × 4 modes, priority order, throttle, resumable) + tests on fixtures
- [ ] P2.11 `routeTimes(origins, targets, mode, budgetMs)` for ad hoc places, cached by 50 m origin grid; straight-line fallback with `method: 'straight_line'`
- [ ] P2.12 `POST /api/listings/[id]/travel` (all four modes per target, amenity reached, method)
- [~] P2.13 TPS crime rates loader; `safetyFor(neighbourhoodId)` (rate, relativeRate, by type, years, caveats); `/api/areas/[kind]/[id]/safety` + tests — loader done (1,422 indicators = 158 × 9 offences, three-year average 2023–2025, `pnpm data:civic crime`); **`safetyFor()` and the route are not written**
- [ ] P2.14 Area indicators: census (renter share, shelter cost 30%+, income), RentSafeTO average, dev applications 12 m, transit access, libraries, parks
- [~] P2.15 Benchmarks seed: StatCan 46-10-0092-01 (Toronto, by bedrooms), CMHC zone averages (centroid mapping, labelled), TTC monthly pass price, sample utilities and car costs — **11 rows loaded 2026-10-17** from the real StatCan CSV (Toronto CMA, 2026 Q2, asking + paid rent by dwelling type) and TTC's current fares; `db/seed/benchmarks.json` + `pnpm --filter worker load:benchmarks` (validated, upsert by id). **Left: CMHC zone averages, utilities and car-cost samples.**
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
| Benchmarks | `db/seed/benchmarks.json`, `apps/worker/src/load-benchmarks.ts` (`pnpm --filter worker load:benchmarks`) | `sample` flags the derived monthly-cap row; CMHC/utilities/car costs still missing |

## Environment

- **Deployed URL:** (record here)
- **Vultr instance:** (region, plan, IP)
- **TigerData service:** id `ha5vgeeas8`, created 2026-10-17, region `x2mp9efr75` (Tiger Cloud); host `ha5vgeeas8.x2mp9efr75.tsdb.cloud.timescale.com:31237`, db `tsdb`, user `tsdbadmin`, TLS required. `DATABASE_URL` lives in `.env.local` on D's machine (git-ignored) — send it to the team privately, never in git. Applied: `postgis 3.6.4`, `timescaledb 2.30.2`, `pg_trgm 1.6`. **Migrations applied: 001, 002, 003, 005, 006, 007, 008** (2026-10-17); `004` is still free for D's aggregates.
- **Env vars on the instance:** everything in SPEC 20.
