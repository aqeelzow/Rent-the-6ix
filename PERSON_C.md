# PERSON_C.md — Listings pipeline & valuation

**Role:** getting real Toronto listings into TigerData and judging their price: source adapters, scrubbing, normalizing (incl. size, year built, AC), geocoding, de-duplication, price observations, the worker schedule, the demo snapshot, the valuation from comparables and its price label, and the caveats (incl. scam indicators).
**Owns:** see `TEAM.md` section 2 (folders) and `SPEC.md` 22.1 (roles). **Contracts you provide:** listings in TigerData (≥ 300 by S2, ≥ 1,500 by S4), `valuate()` and `priceLabel()` in `packages/shared/engine/valuation.ts`, `caveats()`, the `/api/listings/[id]/valuation` route.
Task ids match `PROGRESS.md`; task details are in `SPEC.md`.

## Current state

- **Current task:** none in progress
- **Status:** not started   <!-- not started | in progress | blocked | at sync point -->
- **Next action:** P0.12 read robots.txt and terms for Kijiji, Rentals.ca, Zillow and Realtor.ca; write `apps/worker/SOURCES.md`; then the adapter interface.
- **Blockers / needs from others:** A's scaffold (P0.1) and D's migrations (P0.8).
- **Last updated:** 2026-10-15 (file created from SPEC)

## Handoff notes

> Where an unfinished task stopped, gotchas, things to verify. Replace each session.

- **Source rules are shared code, not per adapter** (SPEC 8.4): public pages only, never behind a login; honour robots.txt; one request per source every 3–5 s; `USER_AGENT` with a contact email; back off and mark the source unhealthy after repeated 403/429. **Facebook is never scraped**; it's covered by B's paste-a-listing.
- If a site's terms or robots.txt forbid it, or it blocks us, drop it and note it in `SOURCES.md`. Two working sources plus `manual.csv` is enough for the demo.
- **Store only `Listing` fields.** Excerpt ≤ 280 chars after scrubbing phone numbers, emails and personal names. No photos stored; thumbnail URL only if the source's terms allow linking.
- **Snapshots and raw HTML fixtures are git-ignored** and stay on the Vultr instance and team machines (SPEC 8.5). Save small HTML fixtures per source for adapter tests (strip personal info from them too).
- **New fields:** size (sq ft; convert m²), year built ("built 2018", "new construction"), AC (`central` / `yes` / `no` / `unknown`). After the building match, fill missing `yearBuilt` from RentSafeTO (`yearBuiltSource: 'rentsafeto'`). Record `fieldEvidence` for each.
- **Valuation:** pool = same unit-type class (rooms only vs rooms), same bedrooms, bathrooms ±1, seen in the last 60 days; radius 1 → 2 → 3 km until ≥ 5; adjustments for utilities/parking/furnished/laundry; weighted median and 25th–75th percentiles; confidence high/medium/low (SPEC 7.2).
- **Price label bands:** ±10% at medium/high confidence, ±15% at low; under 5 comparables → `unknown`. Wording on screen is A's, but labels and numbers come from you.
- `rent_far_below` (> 30% below) is a scam *indicator*, never an accusation.
- Check field coverage after the first ingest (what % have size, year built, AC); post it in Handoff notes so the team can decide whether worker AI extraction (P4.10) moves up.

## Requests to others

- **To D:** Address Points and neighbourhood/ward boundaries loaded early in S1→S2 (P1.10, P1.11) so geocoding and area joins work; RentSafeTO buildings with year built (P1.14); benchmarks table (P2.15) for the valuation's benchmark line.
- **To B:** the `Listing` and `Valuation` schemas include `sqft`, `yearBuilt`, `yearBuiltSource`, `airConditioning`, `priceLabel` (P0.5).
- **To A:** tell me which listing fields look wrong on real data; I'll fix the normalizer.

---

## Task list (in order)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped. **Core** = needed for the demo. **Stretch** = drop first if behind.

### Before S1 (H0–H3) — Rules first · Core
- [ ] P0.11 Worker package skeleton; adapter interface `{ id, fetchIndex, fetchDetail, parse }`; shared fetch layer (robots, delay, UA, backoff, unhealthy flag)

### S1 → S2 (H3–H12) — Data in · Core
- [ ] P1.1 First adapter (Kijiji or whichever is "go") + HTML fixture tests
- [ ] P1.2 Second adapter (Rentals.ca or the next "go") + fixture tests
- [ ] P1.3 Normalize: rent, bedrooms (studio = 0, 1+den), bathrooms, unit type, size, year built, AC, tri-state amenities, availability, lease + tests
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
| Source rules & adapters | `apps/worker/SOURCES.md`, `src/sources/*.ts`, `src/lib/fetch.ts`, `fixtures/` | fixtures git-ignored if they contain scraped text |
| Pipeline | `apps/worker/src/pipeline/normalize.ts`, `scrub.ts`, `geocode.ts`, `dedupe.ts`, `upsert.ts` (+ tests) | |
| Schedule | `apps/worker/src/schedule.ts` | every 6 h |
| Valuation | `packages/shared/engine/valuation.ts` (+ tests), `apps/web/src/app/api/listings/[id]/valuation/route.ts` | |
| Caveats | `packages/shared/engine/caveats.ts` (+ tests) | |
| Backup data | `db/seed/manual.csv` | |

## Environment

- **Env vars you need:** `DATABASE_URL`, `USER_AGENT`, `INGEST_SOURCES`, `INGEST_INTERVAL_HOURS`, `INGEST_REQUEST_DELAY_MS`, `GEMINI_API_KEY` (P4.10 only).
- Run ingests from the Vultr worker, not laptops, so request rates stay controlled from one place.
