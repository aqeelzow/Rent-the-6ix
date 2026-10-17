# PROGRESS.md

> The master task list and the single source of truth for where the build is. Read this at the start of every session.
> **Team mode (see `TEAM.md`):** during the hackathon each person tracks progress in their own `PERSON_X.md`. This file keeps the shared task ids and is updated **at each sync point** by whoever runs the sync (default: D), by copying the ticks from the four `PERSON_X.md` files.
> History lives in git commits; spec changes live in the `SPEC.md` Change log.

## Current state

- **Current sync point:** before S1
- **Status:** not started   <!-- not started | in progress | blocked | at sync point | submitted -->
- **Kickoff time:** _(fill in; sync points are hours after this, see TEAM.md section 5)_
- **Next action:** everyone starts their P0 tasks; A merges the scaffold (P0.1) first.
- **Blockers / needs from the team:** none
- **Last updated:** 2026-10-15 (created from SPEC)

## Handoff notes

> Anything the whole team must know that isn't obvious from the checklist. Replace (don't accumulate) at each sync point.

- _(none yet)_

## Task status legend

`[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (reason in Known issues) · `[-]` dropped (reason in the SPEC.md Change log)

Task ids (e.g. `P2.4`) are shared by `PERSON_X.md`, commit messages (`P2.4 [C]: …`) and the SPEC.md Change log. Owner in brackets. **Stretch** tasks are dropped first when behind; Core never.

---

## Phase checklists

### P0 — Foundation (H0–H3 → S1)
- [ ] P0.1 [A] Monorepo scaffold: pnpm workspaces (`apps/web`, `apps/worker`, `packages/shared`), Next.js App Router, TypeScript strict — **merge first, everyone waits on it**
- [ ] P0.2 [A] Tailwind + shadcn/ui + Public Sans + design tokens (light; dark if time), tabular numerals utility
- [ ] P0.3 [A] Zustand, Vitest, ESLint, Prettier; root scripts `typecheck`, `lint`, `test`
- [ ] P0.4 [D] Verify every dataset link in SPEC 8.1–8.2; fix the spec where a slug changed
- [ ] P0.5 [B] Zod schemas in `packages/shared/schemas`: `SearchIntent` (criteria as `Pref<T>`, `TravelTarget`, safety, weights), `Listing` (incl. size, year built, AC), `Valuation` (incl. `priceLabel`), `MatchScore` (5 parts), `Caveat`, `Area`, `AreaIndicator`, travel time row, API bodies — log anything not in SPEC 5 in the Change log
- [ ] P0.6 [B] Fixtures: 50 synthetic Toronto listings (varied sizes, years, AC, unknowns), 3 areas, travel times with both methods, one full search response, one detail response — **merge before S1, A builds on them**
- [ ] P0.7 [B] API route conventions in `apps/web/src/lib/api` (zod body validation, error format `{ error: { code, message, issues?, retryAfterSeconds? } }`, per-IP rate limiter) + stub routes returning fixtures
- [ ] P0.8 [D] Tiger Cloud service (same region as Vultr); migrations 001 extensions (`postgis`, `timescaledb`, `pg_trgm`), 002 core tables (incl. `travel_times`, `ai_cache`, `sources`), 003 hypertable `listing_observations`
- [ ] P0.9 [D] Vultr instance (4 vCPU / 8 GB), Docker Compose (`web`, `worker`, `otp`, Caddy), HTTPS, placeholder deployed, `deploy.sh` or GitHub Action; follow and correct the starter `DEPLOY.md` — record the URL below
- [ ] P0.10 [A] Layout shell, static landing page; check the starter `README.md` and `.env.example` still match the scaffold
- [ ] P0.11 [C] Worker package skeleton; adapter interface `{ id, fetchIndex, fetchDetail, parse }`; shared fetch layer (delay, UA, retries)
- [ ] P0.12 [C] List the sources in `apps/worker/SOURCES.md`
- [ ] P0.13 [A] `searchSlice.ts` (intent, results, shortlist) + selection contract (`hoveredListingId`, `selectedListingId`) — merge early
- **Done when:** Placeholder live on Vultr, TigerData has the extensions and core tables, schemas and fixtures merged, fixtures flow from a stub API route to the UI.

### P1 — Data in (H3–H12 → S2)
- [ ] P1.1 [C] First adapter (Kijiji or whichever is "go") + HTML fixture tests
- [ ] P1.2 [C] Second adapter (Rentals.ca or the next "go") + fixture tests
- [ ] P1.3 [C] Normalize: rent, bedrooms (studio = 0, 1+den), bathrooms, unit type, size, year built, AC, tri-state amenities, availability, lease + tests
- [ ] P1.4 [C] Scrub phone numbers, emails, personal names; 280-char excerpt + tests
- [ ] P1.5 [C] Geocode (Address Points via `pg_trgm`, street-level, area centroid), drop outside Toronto, neighbourhood/ward join, building match + RentSafeTO year-built fill
- [ ] P1.6 [C] Upsert listings + `listing_observations` rows; `stale` / `removed` by `lastSeenAt`
- [ ] P1.7 [C] First ingest: ≥ 300 real listings in TigerData; post field coverage in Handoff notes
- [ ] P1.10 [D] Neighbourhoods (158) and wards (25) boundaries
- [ ] P1.11 [D] Address Points (for C's geocoding and B's place resolution)
- [ ] P1.12 [D] TTC GTFS: stops with `is_rapid`, route shapes for the map layer
- [ ] P1.13 [D] POIs: City libraries, parks, community centres, schools (elementary/secondary); OSM supermarkets, pharmacies, clinics
- [ ] P1.14 [D] RentSafeTO: registration (year built, storeys, units) + current evaluations (scores, dates, sign colour)
- [ ] P1.15 [D] OTP: clip OSM, build graph (transit, walk, bike, car), run in Compose; smoke-test one route per mode
- [ ] P1.16 [D] `sources` table filled by every loader (URL, retrieved, licence, period)
- [ ] P1.20 [B] `AIProvider` interface, `GeminiProvider` (structured output from zod, 1 retry, 12 s timeout, 429/503 → unavailable), `NoneProvider`
- [ ] P1.21 [B] `/api/search/parse`: criteria with must-have/preference, travel targets with mode and minutes, safety, household, `fieldSources`, `droppedRequests`; validation and clean-up
- [ ] P1.22 [B] Fallback regex parser (rent, bedrooms, bathrooms, size, unit type, AC, pets, "built after", "X min walk/drive/bike/transit to …", neighbourhood names)
- [ ] P1.23 [B] `known_places.json` (campuses, hospitals, major stations, employment hubs) + `/api/geo/resolve` (known places → Address Points → MapTiler)
- [ ] P1.24 [B] `ai_cache` (input hash) + per-IP limits on AI routes; parse tests with 10 sample prompts
- [ ] P1.30 [A] Landing: prompt box, 3 example chips (student, couple, family), "Explore neighbourhoods", "Paste a listing"; calls B's `/api/search/parse` (fixture until live)
- [ ] P1.31 [A] Filter chips: must-have/preference/default styles, source phrase, must-have ⇄ preference switch, remove, "dropped requests" notice
- [ ] P1.32 [A] Filters panel (SPEC 11.2): Price (range, price vs market), Home (rooms, size, unit type, building age, AC, pets, furnished, parking, laundry, utilities, availability, lease), Getting around (add place or amenity, mode, minutes), Safety (switch + explanation), Area; each with must-have/preference
- [ ] P1.33 [A] Results cards (SPEC 11.2): price badge, segmented score bar, travel targets with mode icon, size/year/AC, top caveat, source + freshness, "Also on", shortlist button
- [ ] P1.34 [A] Results map (MapLibre): clustered pins coloured by score band, approximate circles, place pins, synced hover/select with the list
- [ ] P1.35 [A] Mobile: list with sticky Map toggle, bottom sheet on pin tap, filters as a sheet
- **Done when:** Real listings and civic data in TigerData with neighbourhood and ward names; OTP answers one route per mode; a prompt produces editable chips; results page renders fixtures.

### P2 — Engine & search (H10–H18 → S3)
- [ ] P2.1 [C] Comparables SQL + `valuate()`: pool, radius widening, adjustments, weights, weighted median/percentiles, confidence + tests
- [ ] P2.2 [C] `priceLabel()` with confidence-dependent bands + tests
- [ ] P2.3 [C] Benchmark line (StatCan CMA asking rent, CMHC zone) from D's `benchmarks`
- [ ] P2.4 [C] Dedupe (50 m + same bedrooms + rent within 3%, or trigram ≥ 0.6) → `duplicateOf`, "Also on" list + tests
- [ ] P2.5 [C] Valuation cache (6 h) + `/api/listings/[id]/valuation`
- [ ] P2.10 [D] Travel-time precompute job (2 nearest × categories × 4 modes, priority order, throttle, resumable) + tests on fixtures
- [ ] P2.11 [D] `routeTimes(origins, targets, mode, budgetMs)` for ad hoc places, cached by 50 m origin grid; straight-line fallback with `method: 'straight_line'`
- [ ] P2.12 [D] `POST /api/listings/[id]/travel` (all four modes per target, amenity reached, method)
- [ ] P2.13 [D] TPS crime rates loader; `safetyFor(neighbourhoodId)` (rate, relativeRate, by type, years, caveats); `/api/areas/[kind]/[id]/safety` + tests
- [ ] P2.14 [D] Area indicators: census (renter share, shelter cost 30%+, income), RentSafeTO average, dev applications 12 m, transit access, libraries, parks
- [ ] P2.15 [D] Benchmarks seed: StatCan 46-10-0092-01 (Toronto, by bedrooms), CMHC zone averages (centroid mapping, labelled), TTC monthly pass price, sample utilities and car costs
- [ ] P2.16 [D] Nearby query + `/api/listings/[id]/nearby`
- [ ] P2.20 [B] Candidate query SQL: hard criteria with unknowns passing as "not confirmed", areas (`ST_Within`), hard amenity times from `travel_times`, hard safety, limit 500
- [ ] P2.21 [B] Home sub-scores (`home-fit.ts`): rooms, size, unit type, building age, AC, booleans, availability + tests
- [ ] P2.22 [B] Travel scoring (`travel.ts`): per target vs minutes, straight-line distance fallback with per-mode distance targets + tests
- [ ] P2.23 [B] Match score (`score.ts`): value, price, travel, home, safety; renormalization; tie-breakers; sum-consistency test
- [ ] P2.24 [B] `/api/listings/search`: two-pass (pass 2 via D's `routeTimes()` for the top 100, 3 s budget), all sort modes, "hide unconfirmed" flag
- [ ] P2.25 [B] `/api/listings/[id]` detail route (listing, building, area ids, duplicates, travel, valuation)
- [ ] P2.30 [A] Listing detail page layout and header (rent, beds/baths, address or area, source button, freshness, data status)
- [ ] P2.31 [A] Rent check: price label, estimate, range, difference, confidence, comparables table + mini map, adjustments, benchmark
- [ ] P2.32 [A] Getting around: each target with the amenity/place reached and its time by transit, car, walk and bike, chosen mode highlighted, method labels
- [ ] P2.33 [A] The home: size, year built + source, AC, other fields, unknowns marked
- [ ] P2.34 [A] Building (RentSafeTO score, date, sign colour, explanation or "not in program") + area card (SPEC 9.1)
- [ ] P2.35 [A] Wire results to B's live `/api/listings/search`; loading, empty and error states
- [ ] P2.36 [A] "Why it ranks here": score breakdown bars with evidence + slot for B's explanation
- **Done when:** A demo prompt returns real ranked listings with consistent score breakdowns, price labels (or "Not enough data"), travel times (OTP or labelled straight-line) and home fit; the detail page shows all of it.

### P3 — Explanations & civic layer (H16–H24 → S4)
- [ ] P3.1 [B] `/api/listings/[id]/explain`: facts only, number check, safety wording check, template fallback
- [ ] P3.2 [B] `/api/listings/import` (paste text or public URL → `Listing` via Gemini, geocode, score against the current intent; SSRF guard; regex fallback) + `/api/listings/score`
- [ ] P3.3 [B] `/api/areas/[kind]/[id]/briefing`: indicators only, neutral, no candidates or parties, number check, template fallback; pre-generate all 25 wards
- [ ] P3.4 [B] Cached parse and explain outputs for the 3 demo prompts (SPEC 16) and the demo pasted listing
- [ ] P3.10 [D] Explorer API: `/api/areas?kind=&indicator=` (incl. crime as one indicator with caveats), `/api/areas/[kind]/[id]`
- [ ] P3.11 [D] Continuous aggregate: weekly median asking rent per neighbourhood (from C's observations) + sparkline data
- [ ] P3.12 [D] Affordability in the engine (`affordability.ts`): rent-to-income vs 30%, true monthly cost (rent + utilities + TTC pass or car) + tests
- [ ] P3.13 [D] `/data` content: every dataset with link, period, retrieval date, licence, use; methodology (valuation, price label, travel, score, safety); limitations (SPEC 9.4)
- [ ] P3.14 [D] `/api/health` + `/status` data
- [ ] P3.20 [A] Explorer `/areas`: choropleth (158 neighbourhoods / 25 wards), one indicator at a time, quantile legend with city value, area side panel with sources
- [ ] P3.21 [A] Ward page: B's briefing, the indicator table it was written from, election info box
- [ ] P3.22 [A] Paste a listing: text or URL input, B's import route, scored result card, fallback form when extraction is partial
- [ ] P3.23 [A] Safety UI: switch in filters and on results, rate on cards and detail, caveats sheet ("How this works")
- [ ] P3.24 [A] Shortlist in `localStorage` (try/catch), "Clear my data", share search as URL
- [ ] P3.30 [C] ≥ 1,500 active listings across ≥ 2 sources
- [ ] P3.31 [C] Worker schedule (every 6 h), freshness/status job, `pnpm ingest:once`, last-ingest stats for `/status`
- [ ] P3.32 [C] `caveats()`: approx location, stale, fields unknown, RentSafeTO low score, insufficient comparables, `rent_far_below`, `deposit_before_viewing`, `duplicate_text_elsewhere` + tests
- [ ] P3.33 [C] `manual.csv` source as the demo backup (20–40 hand-checked rows)
- **Done when:** The full demo walkthrough (SPEC 23) works end to end on the deployed app, with `AI_PROVIDER=gemini` and with `AI_PROVIDER=none`.

### P4 — P1 features (H22–H30 → S5) · Stretch, only after S4
- [ ] P4.1 [B] Weight sliders: accept `weights` in the intent, validate, rescore (A builds the UI, P4.24)
- [ ] P4.2 [B] Sorts "shortest trips" and "lowest true monthly cost" (uses D's affordability)
- [ ] P4.10 [C] Worker AI field extraction (Flash-Lite) for unknown AC, size, year built, utilities, pets, laundry, parking, furnished, availability, lease; `fieldEvidence: 'ai_extracted'`; cache by content hash
- [ ] P4.11 [C] Third/fourth source, only if `SOURCES.md` says go
- [ ] P4.12 [C] `price_dropped` caveat from observations
- [ ] P4.20 [A] Compare page (up to 4 listings, SPEC 11.5)
- [ ] P4.21 [A] True monthly cost UI (rent-to-income, rent + utilities + transport) and its sort
- [ ] P4.22 [A] Route lines on the map for the selected listing's targets
- [ ] P4.23 [A] Mobile polish pass on detail and explorer
- [ ] P4.24 [A] Weight sliders UI (B provides the scoring)
- [ ] P4.30 [D] Area compare API (up to 3)
- [ ] P4.31 [D] Precompute the remaining categories for all listings
- **Done when:** Each P1 feature works or is cleanly hidden. **Feature freeze at S5 (H30).**

### P5 — Snapshot, polish & submission (H30–H36)
- [ ] P5.1 [C] Final ingest → snapshot (`dataStatus: 'snapshot'`, dated); hand it to D for the full travel-time precompute
- [ ] P5.2 [D] Full travel-time precompute on C's final snapshot (check `/status` shows ~100% OTP)
- [ ] P5.3 [A] Accessibility pass: keyboard, focus, contrast, labels, alt text, colour never the only signal
- [ ] P5.4 [A] Mobile pass at 375 px on every screen
- [ ] P5.5a [A] Empty, loading and error states in your areas
- [ ] P5.5b [B] Empty, loading and error states in your routes (clear error codes the UI can translate)
- [ ] P5.5c [C] Error states for unhealthy sources on `/status`
- [ ] P5.5d [D] Error states for OTP down / DB slow in your routes
- [ ] P5.6 [D] Finish `DEVPOST.md` (draft included): SPEC 24 answers, every data link, track usage (SPEC 14), screenshots; paste into Devpost
- [ ] P5.7 [A,B,C,D] Rehearse the demo walkthrough (SPEC 23) ×3, all together on the deployed app (phone and laptop)
- [ ] P5.8 [D] Final deploy; confirm the deployed app runs the demo with the snapshot
- [ ] P5.9 [B] Run the 3 demo prompts with `AI_PROVIDER=gemini` and `AI_PROVIDER=none`; both must give a usable result
- **Done when:** Snapshot loaded and fully precomputed, demo rehearsed 3 times, Devpost submitted with every data link, everything merged to `main`.

---

## Feature map

> Where each feature lives. Merged from the four `PERSON_X.md` feature maps at each sync point, so a fresh session can find code without searching the whole repo.

| Feature | Key files | Owner | Notes |
| --- | --- | --- | --- |
| _(filled in as features are built)_ | | | |

## Known issues

> Bugs, limitations, and blocked items. Remove entries when fixed.

- _(none yet)_

## Data status

> Filled in by C and D as data lands; shown to judges on `/status`.

| Item | Count / state | Updated |
| --- | --- | --- |
| Active listings (by source) | — | — |
| Listing field coverage (size / year built / AC) | — | — |
| Civic datasets loaded (of SPEC 8.1–8.2) | — | — |
| Travel times computed (% by OTP) | — | — |
| Ward briefings cached (of 25) | — | — |

## Environment & deployment

- **Production URL:** _(Vultr, record at P0.9)_
- **Vultr instance:** _(region, plan, IP)_
- **TigerData service:** _(region, service id; connection string in the team's password manager only)_
- **Env vars set on the instance:** —
