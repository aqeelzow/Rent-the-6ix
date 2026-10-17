# PERSON_C.md — Listings pipeline & valuation

**Role:** getting real Toronto listings into TigerData and judging their price: source adapters, scrubbing, normalizing (incl. size, year built, AC), geocoding, de-duplication, price observations, the worker schedule, the demo snapshot, the valuation from comparables and its price label, and the caveats (incl. scam indicators).
**Owns:** see `TEAM.md` section 2 (folders) and `SPEC.md` 22.1 (roles). **Contracts you provide:** listings in TigerData (≥ 300 by S2, ≥ 1,500 by S4), `valuate()` and `priceLabel()` in `packages/shared/engine/valuation.ts`, `caveats()`, the `/api/listings/[id]/valuation` route.
Task ids match `PROGRESS.md`; task details are in `SPEC.md`.

## Current state

- **Current task:** P1.3 normalize (`RawListing` → `NormalizedListing`)
- **Status:** in progress   <!-- not started | in progress | blocked | at sync point -->
- **Next action:** finish P1.3, then P1.4 scrub (broader name heuristics). P1.5 geocode once D's Address Points are loaded.
- **Blockers / needs from others:** B's `Listing` schema (P0.5; normalize uses a worker-local type until then), D's migrations (P0.8) for P1.6, D's Address Points and boundaries (P1.10, P1.11) for P1.5.
- **Last updated:** 2026-10-16 (switched fetch layer to CloakBrowser; Zillow and Realtor.ca go)

## Handoff notes

> Where an unfinished task stopped, gotchas, things to verify. Replace each session.

- **Fetch logic is shared code, not per adapter** (SPEC 8.4). Two working sources plus `manual.csv` is enough for the demo.
- **Fetch layer is CloakBrowser** (stealth Chromium via `playwright-core`; `pnpm --filter worker browser:install` downloads the binary to `~/.cloakbrowser/`). Plain Playwright got 403 bot checks on rentals.ca, Zillow and Realtor.ca.
- **Working sources:** `kijiji`, `torontorentals`, `zillow`, `realtor_ca` (see `apps/worker/SOURCES.md`). `rentals_ca` is no longer blocked but no `/graphql` results response is captured; adapter needs a fresh look (low priority, `torontorentals` has the same data).
- **Known source issues:** Realtor.ca `InsertedDateUTC` is .NET ticks, not ISO; its bounding box includes listings outside Toronto (Vaughan), which P1.5 drops. Zillow postal codes come without the space.
- `pnpm ingest:once [--sources a,b] [--pages N]` writes scrubbed rows to git-ignored `apps/worker/.cache/ingest/*.json` until P1.6 upserts into TigerData. `scrub.ts` already does emails, phones, links and names after contact verbs (P1.4 still needs broader name heuristics).
- **Field coverage (2 pages each, 2026-10-16):** Kijiji 91 rows: size 31%, AC 39%, year built 0%. torontorentals 254 rows: size 99%, year built 78%, AC 0%, no description. Zillow 64 rows (1 page): baths and size 25%, no unit type or posted date. Realtor.ca 11 rows (1 page): beds and size 91%, everything else 100%. AC and Kijiji year built are the gaps; worth considering P4.10 earlier.
- **Store only `Listing` fields.** Excerpt ≤ 280 chars after scrubbing phone numbers, emails and personal names. No photos stored; thumbnail URL only if the source's terms allow linking.
- **Snapshots and raw HTML fixtures are git-ignored** and stay on the Vultr instance and team machines (SPEC 8.5). Save small HTML fixtures per source for adapter tests (strip personal info from them too).
- **New fields:** size (sq ft; convert m²), year built ("built 2018", "new construction"), AC (`central` / `yes` / `no` / `unknown`). After the building match, fill missing `yearBuilt` from RentSafeTO (`yearBuiltSource: 'rentsafeto'`). Record `fieldEvidence` for each.
- **Valuation:** pool = same unit-type class (rooms only vs rooms), same bedrooms, bathrooms ±1, seen in the last 60 days; radius 1 → 2 → 3 km until ≥ 5; adjustments for utilities/parking/furnished/laundry; weighted median and 25th–75th percentiles; confidence high/medium/low (SPEC 7.2).
- **Price label bands:** ±10% at medium/high confidence, ±15% at low; under 5 comparables → `unknown`. Wording on screen is A's, but labels and numbers come from you.
- `rent_far_below` (> 30% below) is a scam *indicator*, never an accusation.
- Check field coverage after the first ingest (what % have size, year built, AC); post it in Handoff notes so the team can decide whether worker AI extraction (P4.10) moves up.

## Requests to others

- **To D:** Address Points and neighbourhood/ward boundaries loaded early in S1→S2 (P1.10, P1.11) so geocoding and area joins work; RentSafeTO buildings with year built (P1.14); benchmarks table (P2.15) for the valuation's benchmark line.
- **To B:** add `'torontorentals'` to `Listing.source` (zillow and realtor_ca are already there).
- **To B:** the `Listing` and `Valuation` schemas include `sqft`, `yearBuilt`, `yearBuiltSource`, `airConditioning`, `priceLabel` (P0.5).
- **To A:** tell me which listing fields look wrong on real data; I'll fix the normalizer.

---

## Task list (in order)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped. **Core** = needed for the demo. **Stretch** = drop first if behind.

### Before S1 (H0–H3) — Rules first · Core
- [x] P0.11 Worker package skeleton; adapter interface `{ id, fetchIndex, fetchDetail, parse }`; shared fetch layer (delay, UA, retries)

### S1 → S2 (H3–H12) — Data in · Core
- [x] P1.1 First adapter (Kijiji or whichever is "go") + HTML fixture tests
- [x] P1.2 Second adapter (torontorentals.com, Rentals.ca network; rentals.ca itself is blocked) + fixture tests
- [~] P1.3 Normalize: rent, bedrooms (studio = 0, 1+den), bathrooms, unit type, size, year built, AC, tri-state amenities, availability, lease + tests
- [ ] P1.4 Scrub phone numbers, emails, personal names; 280-char excerpt + tests
- [ ] P1.5 Geocode (Address Points via `pg_trgm`, street-level, area centroid), drop outside Toronto, neighbourhood/ward join, building match + RentSafeTO year-built fill
- [ ] P1.6 Upsert listings + `listing_observations` rows; `stale` / `removed` by `lastSeenAt`
- [ ] P1.7 First ingest: ≥ 300 real listings in TigerData; post field coverage in Handoff notes

### S2 → S3 (H10–H18) — Valuation · Core
- [ ] P2.1 Comparables SQL + `valuate()`: pool, radius widening, adjustments, weights, weighted median/percentiles, confidence + tests
- [ ] P2.2 `priceLabel()` with confidence-dependent bands + tests
- [ ] P2.3 Benchmark line (StatCan CMA asking rent, CMHC zone) from D's `benchmarks`
- [ ] P2.4 Dedupe (50 m + same bedrooms + rent within 3%, or trigram ≥ 0.6) → `duplicateOf`, "Also on" list + tests
- [ ] P2.5 Valuation cache (6 h) + `/api/listings/[id]/valuation`

### S3 → S4 (H16–H24) — Volume & caveats · Core
- [ ] P3.30 ≥ 1,500 active listings across ≥ 2 sources
- [ ] P3.31 Worker schedule (every 6 h), freshness/status job, `pnpm ingest:once`, last-ingest stats for `/status`
- [ ] P3.32 `caveats()`: approx location, stale, fields unknown, RentSafeTO low score, insufficient comparables, `rent_far_below`, `deposit_before_viewing`, `duplicate_text_elsewhere` + tests
- [ ] P3.33 `manual.csv` source as the demo backup (20–40 hand-checked rows)

### S4 → S5 (H22–H30) — P1 · Stretch
- [ ] P4.10 Worker AI field extraction (Flash-Lite) for unknown AC, size, year built, utilities, pets, laundry, parking, furnished, availability, lease; `fieldEvidence: 'ai_extracted'`; cache by content hash
- [ ] P4.11 Third/fourth source, only if `SOURCES.md` says go
- [ ] P4.12 `price_dropped` caveat from observations

### S5 → end (H30–H36) — Snapshot & polish
- [ ] P5.1 Final ingest → snapshot (`dataStatus: 'snapshot'`, dated); hand it to D for the full travel-time precompute
- [ ] P5.5c Error states for unhealthy sources on `/status`
- [ ] P5.7 Rehearse the demo walkthrough (SPEC 23) ×3 with everyone

---

## Depends on others

- **A:** scaffold (S1).
- **B:** schemas (S1).
- **D:** migrations (S1); Address Points, boundaries, RentSafeTO (S2); benchmarks (S3); OTP precompute runs on your listings.

## Feature map (your files)

| Feature | Key files | Notes |
| --- | --- | --- |
| Source rules & adapters | `apps/worker/SOURCES.md`, `src/sources/*.ts`, `src/lib/fetch.ts` | test fixtures are inline, same shape as the live data, made-up values |
| One-off run | `apps/worker/src/ingest.ts` (`pnpm ingest:once`) | output in `.cache/ingest/` |
| Pipeline | `apps/worker/src/pipeline/normalize.ts`, `scrub.ts` (done, first pass), `geocode.ts`, `dedupe.ts`, `upsert.ts` (+ tests) | |
| Schedule | `apps/worker/src/schedule.ts` | every 6 h |
| Valuation | `packages/shared/engine/valuation.ts` (+ tests), `apps/web/src/app/api/listings/[id]/valuation/route.ts` | |
| Caveats | `packages/shared/engine/caveats.ts` (+ tests) | |
| Backup data | `db/seed/manual.csv` | |

## Environment

- **Env vars you need:** `DATABASE_URL`, `USER_AGENT`, `INGEST_SOURCES`, `INGEST_INTERVAL_HOURS`, `INGEST_REQUEST_DELAY_MS`, `GEMINI_API_KEY` (P4.10 only).
- Run ingests from the Vultr worker, not laptops, so request rates stay controlled from one place.
