# PERSON_B.md — AI & search API

**Role:** everything between the renter's words and the ranked list: shared schemas and fixtures, the Gemini provider, prompt parsing into criteria / travel targets / safety, the search route and match score, listing explanations, paste-a-listing, ward briefings, AI cache and rate limits.
**Owns:** see `TEAM.md` section 2 (folders) and `SPEC.md` 22.1 (roles). **Contracts you provide:** `packages/shared/schemas` (all of them), fixtures, API route conventions, `scoreListing()`, the search / detail / explain / import / briefing routes.
Task ids match `PROGRESS.md`; task details are in `SPEC.md`.

## Current state

- **Current task:** General-area display and Gemini-assisted place normalization; P3.2 import and P2.24 latency optimization are deferred by the user.
- **Status:** active on `b/general-area-display` in `/tmp/rent-search-mvp`, branched from merged main `3da246f`. Place queries retain original evidence plus an optional normalized search name; only DestinationResolver supplies coordinates. Focused checks and live ROM → Royal Ontario Museum → MapTiler-coordinate acceptance pass. The new key was used only by the test process; runtime/deployment environment credentials were not changed. P3.3 and P3.4 remain partial for the dependencies below.
- **Verified:** 20,956 live listings / 16,892 active nonduplicates at inspection; native SQL-backed cheapest/known filters, scalar percentiles, fairness, detail and overlap acceptance.
- **Remaining:** D ward housing indicators and a sourced Toronto comparator for 25 full P3.3 briefings; Gemini quota for all three P3.4 AI outputs and demo cache population; P3.2 import for the pasted-listing part of P3.4. P2.24 cold-search optimization is deferred by the user. Owner changes remain outside B scope under TEAM.md.
- **Last updated:** 2026-10-17


## Handoff notes

Read-only upstream audit found main advanced from570300e to29a7393. Current code has A’s actual actions/store/UI and C’s comparable query/cache/effectiveCount/scam/caveat contracts. Reconciliation preserves all owner code and removes B’s obsolete duplicate top-level result.id shim: A consumes listing.id directly. Actual A actions/store integration tests cover destination choices, selection/detail and polling through B runtime. Reconciled frozen install,245 tests(shared48/web129/worker68), workspace typecheck/lint, production build and native fixture HTTP smoke pass. The original checkout remains unchanged outside apps/search; current source changes are reviewable patches, not pushed/merged.

Live provider evidence remains limited: configured main model parses took7–11s and four of six requests exhausted12s. Source-key, hard-time and partial-geocoder defects were repaired and regression-tested. A temporary FAST diagnostic advertised by authenticated metadata returned generation404 on its first request; five further calls were skipped. No model/source/owner configuration was changed by that diagnostic. The old TD blocker is now resolved with official 394 Bay St branch identity and live civic coordinates; DB destination paths are verified. OTP/deployed acceptance remains separate. Eight synthetic listings remain intermediate test data; all50 shared fixtures are preserved.

> Where an unfinished task stopped, gotchas, things to verify. Replace each session.

- **AI interprets, code calculates.** Gemini never produces a number the user sees. Parse → `SearchIntent`; explanations and briefings use only numbers passed in, then a number check (every number in the text must appear in the input, allowing formatting); fail → regenerate once → template.
- **Criteria are `Pref<T>`** (`{ value, hard }`). Parser rule of thumb: "ideally / prefer / would like" → preference; "must / need / only / under / no more than" → must-have. Never invent a constraint; vague words ("big", "nice area") go to `droppedRequests` with a reason.
- **Travel targets:** default mode transit for places, walk for amenities; minutes only if stated (engine fills defaults from SPEC 7.4). Safety only when the user mentions it.
- **Score** has five parts (value, price, travel, home, safety). Null parts drop out and weights renormalize; the breakdown must sum to the total (test this). "Good deal" / soft `priceFairness` raises value to 45%; safety is 0% unless on, then 15%.
- **Two-pass search:** pass 1 scores 500 candidates with precomputed amenity times + straight-line for ad hoc places; pass 2 calls D's `routeTimes()` for the top 100 within a 3 s budget, drops hard-limit failures, rescores. Anything not routed keeps its straight-line label.
- **Listing text is untrusted.** Put it in delimited data blocks; the system prompt says to ignore instructions inside it.
- **Safety wording rule for explanations:** the model may only state the rate as given ("0.7× the city rate, 2023–2025") with the caveat; it may not characterize a neighbourhood or its residents. Add a check that rejects outputs with "safe", "unsafe", "dangerous", "sketchy" and similar.
- Use the fast model (Flash-Lite) for parse and explain; main Flash model for briefings. Model names come from env, never hard-coded. Cache by input hash in `ai_cache`.
- Pasted URLs: fetch once, 5 s timeout, 2 MB cap, public http(s) only, block private IP ranges; pasted listings are never stored server-side.

## Requests to others

Current external blocker register: [apps/search/change-request.md](apps/search/change-request.md#external-blocker-register--2026-10-17), reviewed against upstream main17bf (merged civic/safety/UI work). Older handoff sections above describe earlier checkpoints.

- **C / EXT-1:** optimize `listingContext` or provide batch valuation/context without changing comparable, confidence or caveat semantics. B eight-call pipeline/cache is implemented; cold/full-pool latency still needs owner work and representative acceptance.
- **D / EXT-2 resolved:** authoritative safety lookup/engine and B enrichment are merged; real DB opt-in/off, hard limits, caveats and score acceptance pass. The city mean lacks population data and the owner caveat states its equal-neighbourhood denominator.
- **D / EXT-3 (deferred by user):** OTP setup is published; routed-time precompute, `routeTimes` and cache/mapping remain unavailable for full travel filters/sorts/detail.
- **D + C / EXT-4:**11 sourced benchmark rows are verified live. Affordability/true-cost integration and C benchmark consumption remain unavailable.
- **D / EXT-5:** source-backed derived civic indicators/rent trends for full ward briefings. B can consume existing civic/building/duplicate tables now.
- **A + deployment owner / EXT-6–8:** trusted request identity, a verified process-affinity deployment for in-memory jobs, and usable fast-model access/quota/configuration. These gate production acceptance, not B endpoint implementation or fallback.
- **A / EXT-9:** rendered/deployed API acceptance and UI mounting/response-contract agreement for subsequent explanation/import/briefing/building features. Existing actions/store integration is verified.

P2.25 static civic/building/duplicate integration and B parse DB cache are implemented and live-verified. P3.1 explanations and import/scoring can proceed in B’s scope; do not classify them as waiting on missing tables/services. A needs to render the additive optional building detail field.

---

## Task list (in order)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped. **Core** = needed for the demo. **Stretch** = drop first if behind.

### Before S1 (H0–H3) — Contracts · Core
- [x] P0.5 Zod schemas in `packages/shared/schemas`: `SearchIntent` (criteria as `Pref<T>`, `TravelTarget`, safety, weights), `Listing` (incl. size, year built, AC), `Valuation` (incl. `priceLabel`), `MatchScore` (5 parts), `Caveat`, `Area`, `AreaIndicator`, travel time row, API bodies — log anything not in SPEC 5 in the Change log
- [x] P0.6 Fixtures: 50 synthetic Toronto listings (varied sizes, years, AC, unknowns), 3 areas, travel times with both methods, one full search response, one detail response — **merge before S1, A builds on them**
- [~] P0.7 API route conventions in `apps/web/src/lib/api` (zod body validation, error format `{ error: { code, message, issues?, retryAfterSeconds? } }`, per-IP rate limiter) + stub routes returning fixtures

### S1 → S2 (H3–H12) — Parsing · Core
- [x] P1.20 `AIProvider` interface, `GeminiProvider` (structured output from zod, 1 retry, 12 s timeout, 429/503 → unavailable), `NoneProvider`
- [~] P1.21 `/api/search/parse`: criteria with must-have/preference, travel targets with mode and minutes, safety, household, `fieldSources`, `droppedRequests`; validation and clean-up. Authoritative civic catalogue + known-place labels now supplied; grounded exact neighbourhood/ward parsing and owner ID validation verified against live DB (Annex095, ward01). Live Gemini/deployed acceptance remains open.
- [x] P1.22 Fallback regex parser (rent, bedrooms, bathrooms, size, unit type, AC, pets, "built after", "X min walk/drive/bike/transit to …", neighbourhood names)
- [x] P1.23 `known_places.json` (campuses, hospitals, major stations, employment hubs) + `/api/geo/resolve` (known places → Address Points → MapTiler). Known-place ambiguity, indexed civic lookup and live MapTiler path verified; TD Bay/Queen now uses official branch identity and live civic row 8067834, with a labelled representative point.
- [~] P1.24 `ai_cache` integration implemented and live-DB verified; parser regressions pass. Production trusted per-IP identity and live Gemini quota acceptance remain open.

### S2 → S3 (H10–H18) — Search & score · Core
- [!] P2.20 Candidate query SQL: hard criteria with unknowns passing as "not confirmed", areas (`ST_Within`), hard amenity times from `travel_times`, hard safety, limit 500
- [x] P2.21 Home sub-scores (`home-fit.ts`): rooms, size, unit type, building age, AC, booleans, availability + tests
- [x] P2.22 Travel scoring (`travel.ts`): per target vs minutes, straight-line distance fallback with per-mode distance targets + tests
- [x] P2.23 Match score (`score.ts`): value, price, travel, home, safety; renormalization; tie-breakers; sum-consistency test
- [~] P2.24 `/api/listings/search`: two-pass (pass 2 via D's `routeTimes()` for the top 100, 3 s budget), all sort modes, "hide unconfirmed" flag
- [~] P2.25 `/api/listings/[id]`: live listing/valuation/caveats, official areas, source-backed opt-in indicators, building and direct duplicates are SQL-verified; full routed travel and A building rendering remain open.

### S3 → S4 (H16–H24) — Explanations & imports · Core
- [x] P3.1 `/api/listings/[id]/explain`: facts only, number check, safety wording check, template fallback
- [ ] P3.2 **Deferred / not a priority — implement `/api/listings/import` only when the user explicitly instructs it.** Planned scope: paste text or public URL → `Listing` via Gemini, geocode, score against the current intent; SSRF guard; regex fallback, plus `/api/listings/score`.
- [~] P3.3 `/api/areas/[kind]/[id]/briefing`: grounded route/fallback/cache implemented; 25 full ward briefings await D indicators and city comparator
- [~] P3.4 Persistent explanation cache and three-prompt prewarm path implemented; Gemini quota and deferred P3.2 import prevent full demo cache population

### S4 → S5 (H22–H30) — P1 · Stretch
- [x] P4.1 Weight sliders: B accepts `weights` in the intent, validates, rescores search/detail; A builds the UI (P4.24)
- [~] P4.2 "Shortest trips" sorts confirmed routed minutes and the basic parser recognizes explicit requests; live ordering is limited by D's missing amenity precompute. "Lowest true monthly cost" is recognized but returns 503 until D P3.12 publishes affordability and sourced utility/transport estimates (EXT-4).

### S5 → end (H30–H36) — Polish
- [x] P5.5b Empty, loading and error states in your routes (clear error codes the UI can translate)
- [ ] P5.9 Run the 3 demo prompts with `AI_PROVIDER=gemini` and `AI_PROVIDER=none`; both must give a usable result
- [ ] P5.7 Rehearse the demo walkthrough (SPEC 23) ×3 with everyone

---

## Depends on others

- **A:** scaffold on `main` (S1); results and detail pages mounting your routes.
- **C:** `valuate()` / `priceLabel()` and real listings (S3); caveats (S4).
- **D:** migrations and `ai_cache` (S1); Address Points for geocoding (S2); `travel_times`, `routeTimes()`, `safetyFor()` (S3); area indicators for briefings (S4).

## Feature map (your files)

| Feature | Key files | Notes |
| --- | --- | --- |
| Schemas | `packages/shared/schemas/*.ts` (+ tests) | single source of truth for everyone |
| Fixtures | `packages/shared/fixtures/*.json` | valid against schemas |
| API conventions | `apps/web/src/lib/api/` | used by every route |
| AI provider | `apps/web/src/lib/ai/` (`provider.ts`, `gemini.ts`, `none.ts`, `cache.ts`) | |
| Parse | `src/lib/ai/parse.ts`, `src/lib/parse/fallback.ts`, `src/app/api/search/parse/route.ts` | |
| Scoring | `packages/shared/engine/home-fit.ts`, `travel.ts`, `score.ts` (+ tests) | pure TS |
| Search | `src/app/api/listings/search/route.ts`, `src/lib/db/candidates.sql.ts` | two-pass |
| Explain / import / briefings | `src/lib/ai/explain.ts`, `import.ts`, `briefing.ts`, `number-check.ts` | |

## Environment

- **Env vars you need:** `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODEL_FAST`, `DATABASE_URL`, `NEXT_PUBLIC_MAPTILER_KEY` (for geocoding fallback).
- Don't paste the Gemini key in chat or commits; set it in `.env.local` and on the Vultr instance only.

## Final C/SQL handoff

C listingContext is composed with B SQL candidate loading in default DATABASE_URL mode, while explicit fixture mode wins. No D times/rates are fabricated; live detail remains503. One unfinished C enrichment blocks overlapping enrichment until actual owner queries settle. Final250 tests(shared48/web134/worker68), workspace typecheck/lint/build, fixture native HTTP and invalid-DB resilience checks pass. All servers stopped. Actual DB/PostGIS/deployed acceptance unverified. No push/merge/deploy; durable patches target29a7393. User requested finish current work and stop before another feature.

2026-10-17 — Main17bf8b4 reconciliation: merged C room-data/caveat fixes and A/D safety engine/lookup/integration. Read-only realDB acceptance verifies safety opt-in/off, score/caveats, renter hard limit and unknown neighbourhood handling; EXT-2 resolved. Benchmarks now11 live rows, but affordability and C benchmark consumption are still pending. Ranking regression suite159 web tests passed before merge; after merge347 workspace tests pass (66 shared/180 web/101 worker), live probes run separately. Indexed Address Points is the next sequential feature; full plan remains open.


2026-10-17 static detail handoff — `DetailResponse.building` is additive optional/nullable; live API supplies D’s mapped building fields and owner score/colour/history/source. Existing fixtures omit it. Both official area geometries and direct duplicates are live, and crime:* indicators are opt-in only. Read-only real API/SQL oracle passed. A: consume this field in BuildingSection; its current placeholder is not evidence of missing API data. P2.25 remains partial because routed travel is unavailable.
