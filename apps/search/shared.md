# Search contracts and dependencies

Reviewed 2026-10-16 against root `TEAM.md`, `PERSON_A.md`–`PERSON_D.md`, `SPEC.md`, `PROGRESS.md`, `CLAUDE.md` and local `spec.md` / `plan.md`. These notes summarize contracts; they do not replace the owning component's definitions. The repository currently contains documents only: no app scaffold, schemas, migrations, database client, engine implementation or package scripts exist.

## Architecture and ownership

Keep the planned pnpm monorepo: Next.js App Router at `apps/web`, worker at `apps/worker`, pure TypeScript engine and Zod schemas at `packages/shared`. A owns scaffold, root configuration and UI. B owns `packages/shared/schemas/**`, `packages/shared/fixtures/**`, engine `filters.ts`, `home-fit.ts`, `travel.ts`, `score.ts`, web `lib/ai/**`, `lib/api/**`, `lib/parse/**`, `lib/db/candidates*` and search/detail/geo routes. C owns listings, valuation and caveats. D owns migrations, database client, geographic data, routing, safety and affordability. Never create or alter D's tables or C/D's engines locally to stand in for missing services.

Root contracts change only by agreement, with a tagged root SPEC Change log entry (TEAM section 3). B's progress belongs in root `PERSON_B.md`; only the sync runner updates root `PROGRESS.md`. Root files and canonical implementation paths are outside this workspace's writable roots. Pending updates are enumerated in `change-request.md`.

## Authoritative shapes (root SPEC section 5)

- `Pref<T> = { value: T, hard: boolean }`. `SearchIntent` contains `schemaVersion`, `rawPrompt`, `areas`, `criteria`, `travelTargets`, `safety`, optional `household` / `weights`, `sortBy`, `fieldSources` and `droppedRequests`. Empty area filters mean all Toronto. Criteria include rent (CAD/month), price fairness, bedrooms, bathrooms, size, unit types, building age, AC, pets, furnishings, parking, laundry, utilities, availability and lease term. No unstated requirement is inferred.
- `Listing` uses `monthlyRentCad`, `rentIsPerRoom`, nullable `bedrooms`, `bathrooms`, `unitType`, `sqft`, `yearBuilt`, `yearBuiltSource`; `airConditioning` is `central | yes | no | unknown`. Location is `{ lng, lat }` with `locationPrecision: exact | street | area`. Area IDs are `neighbourhoodId` and `wardId`. Amenities are `yes | no | unknown` (pets also `cats_only | dogs_only`). Provenance, timestamps, duplicate ID, status and `dataStatus: live | snapshot | demo` remain required as specified. Do not invent SQL column mappings: no D-owned migration exists yet.
- `TravelTarget` currently defines one `mode: transit | drive | walk | bike`, optional `maxMinutes`, `hard`, place `query` / `resolved` or amenity `category` / `schoolLevel`. Resolution source is `address_points | maptiler | known_place`. Amenity categories are grocery, school, university, library, park, community_centre, pharmacy, clinic and rapid_transit.
- D's documented `travel_times` columns are `listing_id, target_key, mode, minutes, distance_m, poi_id, computed_at, method`. Keys use `amenity:<category>[:<schoolLevel>]` or `place:<known_place_id>`. Method is `otp | straight_line`. Types/nullability and ad hoc destination keys need D's authoritative migration/schema before live queries.
- `Valuation` includes `status: ok | insufficient_data`, optional computed amounts, `priceLabel: underpriced | reasonable | overpriced | unknown`, confidence, comparable evidence, adjustments, benchmark and method. Positive `differencePct` means below the estimate.
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
