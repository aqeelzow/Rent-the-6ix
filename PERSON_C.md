# PERSON_C.md — Listings pipeline & valuation

**Role:** getting real Toronto listings into TigerData and judging their price: source adapters, scrubbing, normalizing (incl. size, year built, AC), geocoding, de-duplication, price observations, the worker schedule, the demo snapshot, the valuation from comparables and its price label, and the caveats (incl. scam indicators).
**Owns:** see `TEAM.md` section 2 (folders) and `SPEC.md` 22.1 (roles). **Contracts you provide:** listings in TigerData (≥ 300 by S2, ≥ 1,500 by S4), `valuate()` and `priceLabel()` in `packages/shared/engine/valuation.ts`, `caveats()`, the `/api/listings/[id]/valuation` route.
Task ids match `PROGRESS.md`; task details are in `SPEC.md`.

## Current state

- **Current task:** none in progress
- **Status:** in progress   <!-- not started | in progress | blocked | at sync point -->
- **Next action:** B to call `listingContext` from search's `enrich()` (see Requests). After D applies `005_listing_details.sql`, store `den` and move the detail cache into the DB; load the Realtor.ca run when it finishes. Then a DB-backed `enrich()` for B's search once B's schema accepts live listings. P1.5 geocode once D loads Address Points + boundaries (tables exist, empty as of 2026-10-17). Unblocked options: the `rentals_ca` results capture, or computing `deposit_before_viewing` at ingest from the full description (caveats only see the 280-char excerpt). When D's migrations land: `selectComparables` SQL (finishes P2.1), P1.6 upsert. P1.5 geocode once D's Address Points are loaded.
- **Blockers / needs from others:** B's `Listing` schema (P0.5; normalize uses a worker-local type until then), B's API conventions (P0.7) for P2.5, D's Address Points and boundaries (P1.10, P1.11; tables empty) for P1.5, a `004_` migration for `den` + detail-fetch columns.
- **Last updated:** 2026-10-17 (P2.1, P2.5 valuation route live; P1.6, P1.7: 8,500 listings in TigerData)

## Handoff notes

> Where an unfinished task stopped, gotchas, things to verify. Replace each session.

- **Fetch logic is shared code, not per adapter** (SPEC 8.4). Two working sources plus `manual.csv` is enough for the demo.
- **Fetch layer is CloakBrowser** (stealth Chromium via `playwright-core`; `pnpm --filter worker browser:install` downloads the binary to `~/.cloakbrowser/`). Plain Playwright got 403 bot checks on rentals.ca, Zillow and Realtor.ca.
- **Working sources:** `kijiji`, `torontorentals`, `zillow`, `realtor_ca` (see `apps/worker/SOURCES.md`). `rentals_ca` is no longer blocked but no `/graphql` results response is captured; adapter needs a fresh look (low priority, `torontorentals` has the same data).
- **Known source issues:** Realtor.ca's bounding box includes listings outside Toronto (Vaughan), which P1.5 drops. Realtor.ca paging works (fixed in `fetch.ts`: a hash-only URL change goes via `about:blank` so the page reloads). One map view serves only 600 of ~8,700 rentals, so `realtor-ca.ts` splits the Toronto box into tiles: a view reporting more than `MaxRecords` splits in four (not below ~1.1 km); the cursor is JSON `{ queue, page }` (`nextTileCursor`). 12 live pages → 127 unique listings. A full pass is ~800+ pages (~1 h); set `INGEST_MAX_PAGES` accordingly on the Vultr worker. (.NET-tick dates and unspaced postal codes are fixed: `ticksToIso` in the adapter, `postalCode()` in normalize.)
- **Normalize (P1.3)** is `apps/worker/src/pipeline/normalize.ts`: `normalize(raw, now) → NormalizedListing | null` (null = rent outside $300–25,000). Output is a worker-local type matching SPEC 5 minus what geocode/upsert add (id, location, area ids, building, timestamps, status, dataStatus); it also carries `den`, `postalCode` and `sourceLocation` for geocoding. Swap to B's `Listing` schema when P0.5 lands. `ingest:once` now writes normalized rows and prints field coverage per source.
- **Detail pages:** `fetchDetail()` on Kijiji (same `__NEXT_DATA__` shape as search: full HTML description, all attributes, `agreementtype` → lease), Zillow (`/homedetails/` via `gdpClientCache`; `/apartments/` and `/b/` via `gdp.building`, `/b/` is usually empty) and Realtor.ca (server-rendered label/value pairs: Cooling, Appliances Included, Total Parking Spaces). torontorentals building URLs render the search map, so no detail there. `src/pipeline/details.ts`: `needsDetail` (new or rent changed), `applyPatch` (page wins, nulls never erase, longer description kept), cache in `.cache/details/<source>.json` (scrubbed, re-scrubbed on load). One live page each (15 details): Realtor.ca AC 0 → 100%, parking 0 → 100%, laundry 0 → 82%; Kijiji full descriptions + lease 100%. Full descriptions surfaced real contacts: scrub now also catches "Name Leasing manager" and "DM Name", and no longer treats "Don't Miss Out" as a name.
- **TigerData (P1.6, P1.7):** `src/pipeline/upsert.ts`: `upsertListings` (ON CONFLICT (source, source_listing_id); one `listing_observations` row per sighting, idempotent per `observed_at`) and `markFreshness` (active ≤ 7 d, stale 8–21, removed > 21). Location = source coordinates at `location_precision 'street'` until P1.5; rows with an `address_point_id` keep their geocoded location, and `year_built_source 'rentsafeto'` is never overwritten. `runIngest` upserts at every 10-page checkpoint and at the end when `DATABASE_URL` is set (DB errors are logged, the JSON file still has the run). `pnpm --filter worker load:cache [file…]` loads JSON files (newest per source by default), seen at the file's timestamp. Loaded 2026-10-17: Kijiji 3,975, torontorentals 1,367 (pages 1–54; resume run in progress), Zillow 1,363 (9 without coordinates skipped); Realtor.ca run still going. Not stored yet: `den` and detail-fetch columns (need a `004_` migration), `duplicateOf` (dedupe still has to run against the DB). Rent extremes checked (2026-10-17): the $12k–$25k top is real luxury (Forest Hill, Yorkville); the bottom had parking spaces, rooms filed as whole units and $300 "studios". normalize now drops parking/locker titles (`isNotHousing`, careful with "1BR – Parking included"), makes room-for-rent titles rooms over Kijiji's structured type (`isRoomListing`), and drops whole units under $600. Applied to TigerData: 4 deleted, 47 relabelled rooms (56 rooms total).
- **Manual source (P3.33, waiting on a human check):** `db/seed/manual.csv` (header only, committed) loads with `pnpm --filter worker load:manual`; a row loads only with a `checked_on` date (someone opened the source page that day). `pnpm --filter worker manual:candidates` pre-fills 36 candidates (12 per SPEC 16 demo prompt) into the git-ignored `apps/worker/.cache/manual-candidates.csv`: open each `source_url`, fix fields, set `checked_on`, copy 20–40 good rows into manual.csv. Excerpts are left out (scraped text stays out of the public repo, SPEC 8.5). **Demo gap:** the student prompt ("room or studio near York U under $1,300") has only 9 rooms + 7 studios within 8 km, because the Kijiji adapter scrapes Apartments & Condos only; rooms live in Kijiji's "Room Rentals & Roommates" category.
- **Schedule (P3.31):** `pnpm --filter worker start` (src/index.ts) runs `runIngest()` (src/pipeline/run-ingest.ts) now and every `INGEST_INTERVAL_HOURS` via `every()` in src/schedule.ts; no overlap, failures logged. Still to do once the DB lands: freshness job (`stale` / `removed` by `lastSeenAt`) and last-ingest stats in the DB for `/status` (today: `.cache/ingest/last-run.json`).
- `pnpm ingest:once [--sources a,b] [--pages N]` writes scrubbed rows to git-ignored `apps/worker/.cache/ingest/*.json` until P1.6 upserts into TigerData. `scrub.ts` (P1.4) removes emails, phones, links, messaging IDs (WeChat/WhatsApp/IG…, @handles) and names by context: after contact verbs, "my name is / I'm", Mr./Mrs./Dr., and a sign-off at the end or before a removed phone/email. No name list; a `NOT_A_NAME` stop list keeps "Contact Us Today" intact. 100 real Kijiji/Realtor.ca rows: 0 removals, 0 false positives (snippets rarely carry contact info; recheck when detail pages are fetched).
- **Field coverage after normalize (2 pages each, 2026-10-16):** Kijiji 90 rows: unit type 59%, size 54%, AC 56%, parking/pets 56–57%, available 48%, year built 0%. torontorentals 347 rows: size 99%, year built 93%, pets 98%, AC/utilities/laundry/parking 0%, available 27%. Zillow 122 rows: baths 32%, size 30%, unit type 2%, nothing else. Realtor.ca 11 rows (1 page): beds and size 91%, unit type 100%, amenities 0%. Text rules add little: Kijiji only gives a truncated snippet, torontorentals no description, and Zillow/Realtor.ca index pages carry no amenity text. AC, utilities and year built (outside torontorentals) are the gaps: P4.10 or detail pages would close them.
- **Store only `Listing` fields.** Excerpt ≤ 280 chars after scrubbing phone numbers, emails and personal names. No photos stored; thumbnail URL only if the source's terms allow linking.
- **Snapshots and raw HTML fixtures are git-ignored** and stay on the Vultr instance and team machines (SPEC 8.5). Save small HTML fixtures per source for adapter tests (strip personal info from them too).
- **New fields:** size (sq ft; convert m²), year built ("built 2018", "new construction"), AC (`central` / `yes` / `no` / `unknown`). After the building match, fill missing `yearBuilt` from RentSafeTO (`yearBuiltSource: 'rentsafeto'`). Record `fieldEvidence` for each.
- **Dedupe (P2.4)** is `apps/worker/src/pipeline/dedupe.ts`: `isDuplicate`, `findDuplicates` (oldest = canonical), `alsoOn`, and a pg_trgm-compatible `similarity()`. Cross-source only, same bedrooms on both rules, text rule needs ≥ 40 chars. On 564 real cached listings: 1 duplicate (94 Caledonia Park Rd #4, Kijiji = Zillow), and every cross-source same-bedroom pair within 150 m was a different address. **Stored in TigerData** (2026-10-17): `src/pipeline/dedupe-store.ts` `dedupeStored()` loads every listing not removed, runs `findDuplicates` (≈ 10 s for 9,115) and writes `duplicate_of`, clearing pairs that stopped matching; runs after every DB ingest and as `pnpm --filter worker dedupe:listings` (not `dedupe`: that's pnpm's own lockfile command and rewrites `pnpm-lock.yaml`). New guard: two different street addresses (`streetKey()`: number + first street word, any source's spelling) never match; without it, separate $2,000 1-beds 40 m apart downtown matched. Result: 1,298 duplicates (Kijiji+torontorentals 827, Kijiji+Zillow 340, torontorentals+Zillow 131); samples all the same address. Kijiji is nearly always canonical because it was loaded first. `ingest:once` now skips a `sourceListingId` already seen in the run (torontorentals repeats featured buildings on later pages).
- **Caveats (P3.32)** are `packages/shared/engine/caveats.ts`: `caveats(listing, ctx)` with `ctx = { valuation, building, sameTextElsewhere, now }`; text lives in the file (like `safety.ts`), most severe first; constants in `engine/config.ts` (`CAVEATS`). `fields_unknown` needs ≥ 2 of utilities/pets/laundry/parking/AC unknown. `deposit_before_viewing` = a money word + a before-viewing phrase in one sentence, or "mail you the keys" + a money word. It only sees title + 280-char excerpt: 0 of 1,615 cached rows even mention a deposit, so it (and P1.4 name scrubbing) only bites once full descriptions are fetched. `sameTextElsewhere` comes from SQL (P1.6). `price_dropped` is P4.12.
- **Search context (`listingContext`)**, in `apps/web/src/lib/db/valuation.ts`: `listingContext(sql, listing, now?, benchmark?) → { valuation, caveats }`, C's half of B's `ScoreContext` (travel/safety are D's). Works for stored and pasted listings: `candidatesNear(sql, subject, location, now)` queries by point, not id (SPEC 10.3). Reads the RentSafeTO building for `rentsafeto_low`. `sameTextElsewhere` is 0 on purpose: in TigerData nearly every repeated description is a property manager's template across its own units (136 pairs, 35 triples, groups up to 11), so SPEC 7.7's rule would flag real listings; needs a better rule (e.g. same text + much lower rent) before it's on. Live check, 8 random listings: 28–125 ms, every valuation/caveat passes B's schemas. `approx_location` shows on every listing until P1.5. The route now returns `ValuationSchema.parse(valuation)` (D's PR #5 made benchmark nullable and added `effectiveCount`).
- **Valuation route (P2.1, P2.5):** `apps/web/src/lib/db/valuation.ts`: `selectComparables` (one PostGIS query: `ST_DWithin` 3 km, same bedrooms / rooms class, active or stale, seen ≤ 60 d, not duplicates, nearest 2,000 by `<->`), `listingValuation` (6 h in-process cache), `toApiValuation` (adjustments → `{ label, amountCad }` for B's schema). Same-building key = `building_id`, else `address_point_id`, else the point snapped to ~10 m (one building's floor plans before geocoding). `GET /api/listings/[id]/valuation` via B's `jsonRoute`: 404 unknown id, 422 bad uuid, 503 without `DATABASE_URL`. Live, 9 random listings across 3 sources: 54–220 ms each (first call opens the connection), 6–239 comparables at 1 km. Insufficient-data valuations now still list the comparables found. `benchmark` is null until D's benchmarks (P2.3), so the response doesn't yet pass B's `ValuationSchema` (benchmark required); with a benchmark it does (tested).
- **Valuation engine is in** `packages/shared/engine/valuation.ts` (constants in `engine/config.ts`, section `VALUATION`): `valuate(subject, candidates, benchmark, now)` and `priceLabel(differencePct, confidence)`. SQL only has to return pool candidates within 3 km with `distanceM`, `lastSeenAt`, `duplicateOf`; the engine re-checks the pool, picks the radius, adjusts and weights. Checked on ~500 real cached listings (straight-line distances): 16% insufficient, rest mostly reasonable, under/over roughly balanced. Same-building floor plans are capped (decided 2026-10-16): one building counts as at most 2 comparables in weight, the 5-comparable floor and confidence (`maxPerBuilding`; SQL must return `buildingKey` = RentSafeTO building id, else Address Points id). On the real sample this cut "high" confidence from ~250 to 6 listings. **Open question for the team:** after the cap, torontorentals (purpose-built, often newer towers) comes out mostly overpriced (155 over / 14 under) and Kijiji/Zillow mostly underpriced, because the similarity weight ignores building age and type. Options: add a year-built / purpose-built similarity term, or pool purpose-built rentals separately. Not changed yet.
- **Valuation rules:** pool = same unit-type class (rooms only vs rooms), same bedrooms, bathrooms ±1, seen in the last 60 days; radius 1 → 2 → 3 km until ≥ 5; adjustments for utilities/parking/furnished/laundry; weighted median and 25th–75th percentiles; confidence high/medium/low (SPEC 7.2).
- **Price label bands:** ±10% at medium/high confidence, ±15% at low; under 5 comparables → `unknown`. Wording on screen is A's, but labels and numbers come from you.
- `rent_far_below` (> 30% below) is a scam *indicator*, never an accusation.
- Check field coverage after the first ingest (what % have size, year built, AC); post it in Handoff notes so the team can decide whether worker AI extraction (P4.10) moves up.

## Requests to others

In priority order (what unblocks the most first). Updated 2026-10-17.

- **To D (now):** review and apply `db/migrations/005_listing_details.sql` (`den`, `detail_fetched_at`, `detail_rent_cad` on `listings`; numbered 005 because 004 is your aggregates). Dry-run in a rolled-back transaction on TigerData passed. Once applied, C switches upsert to store `den` and the worker's detail cache to these columns. Also: the stray `tatus` file at the repo root (from PR #1) can be deleted.
- **To D (done):** P0.8 Tiger Cloud + migrations: `listings` (SPEC 5 fields incl. `sqft`, `yearBuilt`, `yearBuiltSource`, `airConditioning`, `fieldEvidence`, `duplicateOf`, `status`, `firstSeenAt`/`lastSeenAt`), `listing_observations` hypertable, `buildings`, `sources`; plus a `DATABASE_URL` for me. Unblocks P1.6 upsert, P1.7 first ingest (≥ 300 by S2), `selectComparables` (P2.1), the valuation route + cache (P2.5), freshness job (P3.31), volume (P3.30). Please also add a listing column for the last detail-page fetch (`detail_fetched_at`, `detail_rent_cad`) so the worker can stop using its local cache.
- **To D (2):** P1.11 Address Points and P1.10 neighbourhood/ward boundaries, for P1.5 geocoding (drops listings outside Toronto, e.g. Realtor.ca's Vaughan rows) and the area join.
- **To D (3):** P1.14 RentSafeTO buildings (year built, `address_point_id`, latest score + date): building match, year-built fill, the `rentsafeto_low` caveat, and the `buildingKey` valuation uses to cap same-building floor plans.
- **To D (4):** P2.15 benchmarks (StatCan 46-10-0092-01 by bedrooms, CMHC zones) for the valuation's benchmark line (P2.3).
- **To D (5):** P0.9 Vultr instance, so ingests run from there, not laptops. The worker starts with `pnpm --filter worker start` and needs the CloakBrowser binary (`pnpm --filter worker browser:install`).
- **To B (now):** live search can use C's part: call `listingContext(getClient(), listing)` from `apps/web/src/lib/db/valuation.ts` in `SearchDependencies.enrich` for `valuation` + `caveats` (stored or pasted listings; 28–125 ms each, 6 h cache). The schema items (torontorentals source, nullable area ids and benchmark, adjustment `code`/`count`, `effectiveCount`) and the lint failure were fixed in PR #5. Thanks!
- **To B (done, merged):** P0.5 schemas: `Listing` (add `'torontorentals'` to `source`; `sqft`, `yearBuilt`, `yearBuiltSource`, `airConditioning`), `Valuation` (`priceLabel: 'underpriced' | 'reasonable' | 'overpriced' | 'unknown'`; `adjustments[]` with `code`, `amountCad`, `count`, `label`), `Caveat`. My worker/engine types match SPEC 5 field names, so the swap is small.
- **To B (2):** P0.7 API conventions, so I can build `/api/listings/[id]/valuation` (P2.5) on them.
- **To B (3, stretch):** P1.20 `AIProvider`, for worker field extraction (P4.10).
- **To A:** nothing blocking. Once real listings show in the UI, tell me which fields look wrong; I'll fix the normalizer.

---

## Task list (in order)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped. **Core** = needed for the demo. **Stretch** = drop first if behind.

### Before S1 (H0–H3) — Rules first · Core
- [x] P0.11 Worker package skeleton; adapter interface `{ id, fetchIndex, fetchDetail, parse }`; shared fetch layer (delay, UA, retries)

### S1 → S2 (H3–H12) — Data in · Core
- [x] P1.1 First adapter (Kijiji or whichever is "go") + HTML fixture tests
- [x] P1.2 Second adapter (torontorentals.com, Rentals.ca network; rentals.ca itself is blocked) + fixture tests
- [x] P1.3 Normalize: rent, bedrooms (studio = 0, 1+den), bathrooms, unit type, size, year built, AC, tri-state amenities, availability, lease + tests
- [x] P1.4 Scrub phone numbers, emails, personal names; 280-char excerpt + tests
- [ ] P1.5 Geocode (Address Points via `pg_trgm`, street-level, area centroid), drop outside Toronto, neighbourhood/ward join, building match + RentSafeTO year-built fill
- [x] P1.6 Upsert listings + `listing_observations` rows; `stale` / `removed` by `lastSeenAt`
- [x] P1.7 First ingest: ≥ 300 real listings in TigerData; post field coverage in Handoff notes

### S2 → S3 (H10–H18) — Valuation · Core
- [x] P2.1 Comparables SQL + `valuate()`: pool, radius widening, adjustments, weights, weighted median/percentiles, confidence + tests
- [x] P2.2 `priceLabel()` with confidence-dependent bands + tests
- [ ] P2.3 Benchmark line (StatCan CMA asking rent, CMHC zone) from D's `benchmarks`
- [x] P2.4 Dedupe (50 m + same bedrooms + rent within 3%, or trigram ≥ 0.6) → `duplicateOf`, "Also on" list + tests
- [x] P2.5 Valuation cache (6 h) + `/api/listings/[id]/valuation`

### S3 → S4 (H16–H24) — Volume & caveats · Core
- [ ] P3.30 ≥ 1,500 active listings across ≥ 2 sources
- [~] P3.31 Worker schedule (every 6 h), freshness/status job, `pnpm ingest:once`, last-ingest stats for `/status`
- [x] P3.32 `caveats()`: approx location, stale, fields unknown, RentSafeTO low score, insufficient comparables, `rent_far_below`, `deposit_before_viewing`, `duplicate_text_elsewhere` + tests
- [~] P3.33 `manual.csv` source as the demo backup (20–40 hand-checked rows)

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
| Pipeline | `apps/worker/src/pipeline/normalize.ts`, `scrub.ts`, `dedupe.ts` (matching only), `details.ts`, `upsert.ts` (done), `geocode.ts` (todo) (+ tests); `src/load-cache.ts`; `src/lib/db.ts` | normalize: structured fields first, then keyword rules; `fieldEvidence` per field |
| Schedule | `apps/worker/src/schedule.ts` (`every`), `src/index.ts` (`pnpm --filter worker start`), `src/pipeline/run-ingest.ts` | every 6 h; freshness job + DB stats todo |
| Valuation | `packages/shared/engine/valuation.ts`, `engine/config.ts` (`VALUATION`), `apps/web/src/lib/db/valuation.ts` (`selectComparables`, `listingValuation`), `apps/web/src/app/api/listings/[id]/valuation/route.ts` (+ tests, all done) | 6 h cache in-process |
| Caveats | `packages/shared/engine/caveats.ts` (+ tests, done), `engine/config.ts` (`CAVEATS`) | text lives in caveats.ts |
| Backup data | `db/seed/manual.csv` | |

## Environment

- **Env vars you need:** `DATABASE_URL`, `USER_AGENT`, `INGEST_SOURCES`, `INGEST_INTERVAL_HOURS`, `INGEST_REQUEST_DELAY_MS`, `GEMINI_API_KEY` (P4.10 only).
- Run ingests from the Vultr worker, not laptops, so request rates stay controlled from one place.
