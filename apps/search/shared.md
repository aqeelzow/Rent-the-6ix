# Search contracts and dependencies

Current baseline is upstream29a7393 in /tmp/rent-search-upstream. C’s actual listingContext/query/cache is now consumed by SQL search; A’s current nested listing.id actions/store/choice/polling contracts pass integration tests. Preserve effectiveCount and current adjustment semantics; earlier duplicate-ID shim and missing-C/A descriptions below are historical. Final250 tests/typecheck/lint/build/native smoke pass; real DB/D/provider-latency/deployed acceptance remains incomplete.


Re-audited 2026-10-17 against checkout `570300e`, the root role/spec/team records, D’s actual migrations/client and C’s actual valuation/caveats. These notes summarize contracts; owner definitions remain authoritative. The scaffold, shared schemas/engine, D migrations/client and C pure functions now exist. C server comparable lookup and D routing/safety functions remain absent. Current staged changes live in `/tmp/rent-search-current` and durable `patches/`; canonical implementation writes are unavailable in this session.

## Architecture and ownership

Keep the planned pnpm monorepo: Next.js App Router at `apps/web`, worker at `apps/worker`, pure TypeScript engine and Zod schemas at `packages/shared`. A owns scaffold, root configuration and UI. B owns `packages/shared/schemas/**`, `packages/shared/fixtures/**`, engine `filters.ts`, `home-fit.ts`, `travel.ts`, `score.ts`, web `lib/ai/**`, `lib/api/**`, `lib/parse/**`, `lib/db/candidates*` and search/detail/geo routes. C owns listings, valuation and caveats. D owns migrations, database client, geographic data, routing, safety and affordability. Never create or alter D's tables or C/D's engines locally to stand in for missing services.

Root contracts change only by agreement, with a tagged root SPEC Change log entry (TEAM section 3). B's progress belongs in root `PERSON_B.md`; only the sync runner updates root `PROGRESS.md`. Root files and canonical implementation paths are outside this workspace's writable roots. Pending updates are enumerated in `change-request.md`.

## Authoritative shapes (root SPEC section 5)

- `Pref<T> = { value: T, hard: boolean }`. `SearchIntent` contains `schemaVersion`, `rawPrompt`, `areas`, `criteria`, `travelTargets`, `safety`, optional `household` / `weights`, `sortBy`, `fieldSources` and `droppedRequests`. Empty area filters mean all Toronto. Criteria include rent (CAD/month), price fairness, bedrooms, bathrooms, size, unit types, building age, AC, pets, furnishings, parking, laundry, utilities, availability and lease term. No unstated requirement is inferred.
- `Listing` uses `monthlyRentCad`, `rentIsPerRoom`, nullable `bedrooms`, `bathrooms`, `unitType`, `sqft`, `yearBuilt`, `yearBuiltSource`; `airConditioning` is `central | yes | no | unknown`. Location is `{ lng, lat }` with `locationPrecision: exact | street | area`. Area IDs are nullable `neighbourhoodId` and `wardId`, preserving D’s migration; missing ID-based area eligibility is unconfirmed unless another OR area matches. Amenities are `yes | no | unknown` (pets also `cats_only | dogs_only`). Provenance, timestamps, duplicate ID, status and `dataStatus: live | snapshot | demo` remain required as specified. Use D’s existing db/migrations/002_core.sql for SQL columns/nullability; no migration is changed by B.
- `TravelTarget` defines primary `mode: transit | drive | walk | bike` and optional alternativeModes (OR per destination), optional `maxMinutes`, `hard`, place `query` / `resolved` or amenity `category` / `schoolLevel`. Resolution source is `address_points | maptiler | known_place`. Amenity categories are grocery, school, university, library, park, community_centre, pharmacy, clinic and rapid_transit.
- D's documented `travel_times` columns are `listing_id, target_key, mode, minutes, distance_m, poi_id, computed_at, method`. Keys use `amenity:<category>[:<schoolLevel>]` or `place:<known_place_id>`. Method is `otp | straight_line`. D’s migration permits nullable minutes/distance_m/poi_id; application rows require validated distance and explicit method/time semantics. Ad hoc destination keys and actual router interoperability still need D’s concrete implementation.
- `Valuation` includes `status: ok | insufficient_data`, optional computed amounts, `priceLabel: underpriced | reasonable | overpriced | unknown`, confidence, comparable evidence, adjustments, benchmark and method. Positive `differencePct` means below the estimate. C’s actual signature includes explicit `now: Date`; benchmark is nullable and adjustments preserve code/count evidence. Insufficient results disclose considered comparableCount, which may exceed five when the effective same-building count fails; they disclose no computed rent/comparable evidence.
- `MatchScore` contains a rounded 0–100 `total`, five parts (`value`, `price`, `travel`, `home`, `safety`) with nullable score, weight, effectiveWeight and evidence; hard-filter notes and caveats. Caveats include severity, code, title and explanation. The illustrative root API response omits some fields; use the complete section 5 contract rather than treating the example as a complete schema.
- `Area` is a neighbourhood or ward with MultiPolygon geometry. `AreaIndicator` carries nullable value, unit, period, source ID and optional sample size/note. Safety carries rate, relative rate, by-type rates, years and caveats. Never use safety when disabled.

## Integration functions (TEAM section 3)

| Owner | Canonical contract | Dependency |
| --- | --- | --- |
| C | `valuate(listing, comparables, benchmarks): Valuation`; `priceLabel(differencePct, confidence)` | Pure functions; comparables selected by C's `selectComparables(db, listing)` |
| C | `caveats(listing, ctx): Caveat[]` | Preserve owner wording and rules |
| D | `routeTimes(origins, targets, mode, budgetMs): TravelTimeRow[]` | Never throws; routing failure/budget exhaustion yields labelled straight-line rows |
| D | `safetyFor(rates, cityRates)`; `safetyScore(relativeRate)` | Pure functions; geographic lookup is separate |
| B | `scoreListing(listing, intent, { valuation, travel, safety }): MatchScore` | Pure, deterministic, no network, database or randomness |

Person B's request uses `valuate(listingId)` and `safetyFor(neighbourhoodId)`; these are inconsistent with TEAM's pure contracts. Use TEAM's explicit signatures for draft engine work and obtain owner confirmation for data lookup adapters. Full argument/row types remain unavailable.

## Search invariants

Cheap hard filters precede enrichment/routing. Ordinary search uses up to 500 candidates, scores pass 1, routes top 100 within one shared three-second budget, drops confirmed hard failures and rescores. Unknown hard values pass with a not-confirmed note; hide-unconfirmed removes them. Unknown preferences are omitted from scores. Numeric sorts must select the requested end of the full eligible pool before truncation.

Root score defaults: value 30, price 15, travel 30, home 25, safety 0; good-deal/soft fairness raises value to 45; enabled safety receives 15. Drop null parts and renormalize. Price is scored only for soft rent; home only for stated soft home criteria. Tie-break on newer `lastSeenAt`, then lower rent. Root SPEC sections 7.4–7.6 define formulas and travel defaults.

Straight-line rows expose distance, never fabricated minutes, and cannot confirm a time limit. Driving labels say no traffic. Safety is opt-in, relative neighbourhood police-reported rates with all D-owned caveats; no characterizations of residents or safe/unsafe labels.

## Agreed local clarifications awaiting shared-contract publication

These are explicit user answers in local `plan.md`, to preserve when aligning the local spec and root handoff:

- Cheapest sorts all eligible matches; an explicit top/bottom percentage selects from the full eligible known-value pool with default minimum 10, capped by available count.
- Alternative modes are OR within a destination; each separate destination must satisfy its own requirement. The score takes the best normalized mode per destination.
- Broad destinations use a labelled representative point. Ambiguous campus/branch queries require structured choices.
- Missing routing returns labelled distance and unconfirmed time, subject to hide-unconfirmed.
- Exact travel percentiles route the full eligible pool, asynchronously for at most two minutes; incomplete routing returns unavailable, never an exact partial percentile. Jobs are bounded and temporary; prompts/payloads are never persisted or logged.
- Unstated criteria impose no constraints; household count does not imply bedrooms; money is CAD/month and rooms mean bedrooms.

Root SPEC currently has no numeric extreme selector, alternative-mode array, destination ambiguity response or asynchronous job API. Root section 7.4 explicitly says one mode per target. See change requests before publishing these contract extensions.

## Requests addressed to B

A needs fixture sizes/year/AC, all five score parts including nulls, each price label, both travel methods and a safety-enabled case. C needs `sqft`, `yearBuilt`, `yearBuiltSource`, `airConditioning` and `priceLabel` in schemas. D needs travel target/row and safety schemas and requires a routing time budget. Interim validation may use a small synthetic sample per the user's instruction; final shared fixtures still require 50 listings, three areas and representative search/detail responses.

## Scope and validation

This execution plan covers schemas/fixtures, parsing/resolution, deterministic search, percentiles and parse/search/detail/geo APIs. Imports, explanations and briefings remain root product requirements but are explicitly excluded from this local execution plan. Draft code must preserve canonical module layout rather than substitute a separate search service. Live DB/OTP/Gemini validation waits for actual owner services/credentials. The full plan remains incomplete until shared-contract updates, canonical integration and required verification are complete.

## Current integration snapshot — 2026-10-17

The initial documents-only review above is historical. Main `adbeb25` supplies A’s Next16.4.2/Node24/pnpm10.34.7/Vitest5 scaffold. B schemas/fixtures/engine/APIs and root contracts are integrated and verified in `/tmp/rent-search-integration`, branch `b/search-pipeline-integration`; see DOCS.md and plan.md for final gates. C/D owner implementations remain absent from that snapshot; CR-3/CR-4 stay open. User requested stopping after the current API feature, so further work requires resuming.

## Current staged integration contracts

- Address Points consumer uses existing `getClient()` and `address_points(id,address_full,location)`, bound exact full-address matching and validated ambiguity. No address_norm normalization rule is assumed. One in-flight DB read per process; the shared deadline stops request work and ignores late results without canceling the shared connection. D still needs to provide an indexed normalization contract/server statement timeout and verify loaded data.
- Search/detail result envelopes require UUID id===listing.id for A’s existing selection store. Shared SearchResultItem/ApiErrorPayload and API barrel payload type ApiError are staged with regression evidence; A’s own store/UI is unchanged.
- C valuation/caveats run against eight synthetic listings for intermediate validation. No benchmark is invented; sparse data remains insufficient. This proves fixture interoperability, not C’s missing comparable-query service or live valuation acceptance.
- Source publication and B root handoff/spec updates are reviewable patches; all live-provider/database/router/UI acceptance requirements remain open.

- P2.20 candidate source: optional asynchronous loadCandidates(request,signal?) runs before ordinary/percentile enrichment and selection. sqlCandidateLoader consumes D’s actual listing columns and validates mapped rows; no owner enrichment query/algorithm is invented. Default runtime remains fixture-backed or unavailable until owner services are composed. Database row errors become service-unavailable. PostgreSQL/PostGIS execution remains unverified.

- Live provider audit: credentials/main model exist but no fast-model setting or DATABASE_URL. Source instructions, hard-time preservation and full-relevance geocoder gates are staged and regression-tested. Live Gemini success is distinct from timeout/basic fallback; current7–11s successes/four deadline failures and missing TD match leave acceptance open. All saved provider evidence is synthetic/public fixture data with credential scan clear.
