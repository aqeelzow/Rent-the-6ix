# Search integration change requests

## Latest status — upstream 29a7393

Supersedes older dependency notes: C’s comparable query/cache/listingContext and A’s actual search actions/UI/polling are now published. Current B composition consumes C unchanged and tests A actions against B runtime. CR-4’s missing implementation is resolved; live DB/performance acceptance remains open. CR-3 remains open for D routing/safety/geographic/cache/detail services and usable database configuration. Current SQL path returns unknown D values honestly; live detail remains503. Current patches target29a7393, while570300e variants are historical. One unfinished read/enrichment per process bounds background work but may reject overlapping searches; owner cancellation/server timeout support remains requested.


## Current audit — 2026-10-17, checkout `570300e`

This audit supersedes historical “absent from adbeb25” and resume-worktree statements below. D's `db/migrations/001–003` and `apps/web/src/lib/db.ts` now exist. C's pure `valuation.ts` and `caveats.ts` exist, but C's server comparable query, D's `geo/route-times.ts` and `engine/safety.ts` do not. CR-3 and CR-4 are partially supplied, not resolved. The staged result-identity repair now satisfies A’s existing result.id selection contract and exports its expected types; A’s destination-choice/polling UI remains pending. Address Points has an authoritative table definition, but its loader/data and resolver adapter remain unverified. No live connection or credentials were inspected.

C's actual valuation output exposed B schema incompatibilities: nullable benchmark, required adjustment code/count, and considered comparable count for insufficient-data results (including same-building caps). C also explicitly requests `torontorentals` source support in PERSON_C.md. Corrections and integration regressions are staged in `/tmp/rent-search-current`; `patches/search-interoperability.patch` preserves the reviewable diff. Applying the patch to the canonical app/shared files requires a session with write access to those paths. Owner algorithms, database migrations and UI are unchanged.


Reviewed 2026-10-17 against fetched main `adbeb25`. CR-1 is resolved in the isolated integration worktree; CR-2 B publication and CR-5 B records are complete, with A/D coordination remaining. CR-3/CR-4 remain open. Historical request descriptions below record the original contracts; status notes are authoritative for current progress. No deployed behavior is claimed.

### Address Points follow-up (staged consumer)

B's parse adapter can read existing `address_points(id,address_full,location)` using D's existing client. It matches full addresses ignoring case/whitespace, validates all returned coordinates/labels/IDs, keeps ambiguities, and binds query input. Fixture mode bypasses DB. D's `address_norm` algorithm is not published; B does not assume one or add a migration. Request to D: publish normalization/loader coverage, provide an indexed exact-match path and a server statement timeout. Current query ignores late results without canceling the shared connection (the installed postgres documentation warns cancellation may affect another query); at most one Address Points read remains in flight per process. Request deadlines stay bounded, but database work itself may outlive a timed-out request. Live PostGIS execution/performance remains unverified.

### Candidate SQL follow-up (staged B consumer)

B’s candidates-sql consumer now targets D’s actual listing columns and can be injected into ordinary/percentile search with owner enrichment. D: verify SQL/PostGIS execution, indexes, loaded data and server statement timeout on representative pools; query keeps the full cheap-eligible pool until application ordering/selection, so data-volume latency remains unproven. Near-area gates intentionally use exact existing pure distance after conservative SQL selection. C/D enrichment and ID-based live detail remain open. A: render absent neighbourhood/ward IDs as unknown; B preserves D’s nulls rather than fabricating geography, and suppresses safety without a neighbourhood ID. No A-owned file, D migration or C/D engine is changed.

### Live provider acceptance follow-up

Gemini/MapTiler keys and main model are configured; no DATABASE_URL or fast-model setting is configured. Live calls authenticate, but four of six Gemini requests exhausted12s and successful calls took7–11s. A/deployment owner: supply and validate an appropriate fast-model configuration without hardcoded model names or relaxed bounds. Existing code falls back honestly and preserves recognized explicit time requirements. D/provider data owner: supply a verified matching TD Bay/Queen address/POI; current MapTiler returns partial unrelated landforms and B correctly rejects them. These are unresolved live acceptance gates, not a request to invent a location or present fallback as Gemini success.

## CR-1 — Scaffold and canonical implementation access

**Current status:** Resolved: A scaffold fetched from main and B canonical integration verified in `/tmp/rent-search-integration`. Original workspace remains an older dirty checkpoint.

- Owner: A (scaffold), workspace administrator (write scope), B (canonical source).
- Affected structures: root pnpm manifests/config, `apps/web`, `packages/shared`; root `SPEC.md` and `PERSON_B.md` handoff.
- Current contract: TEAM requires B code in the shared schemas/engine and the Next.js app. Repository inspection found only documents, with P0.1–P0.3 unchecked.
- Proposed change: A provides the agreed scaffold and scripts; enable writes to B-owned canonical paths and agreed root specification/handoff files. Draft B modules can be staged locally with canonical relative paths until then.
- Reason: required dependencies, route mounting, exports, typecheck/lint/test and root change-log updates cannot be implemented at their intended locations now.
- Compatibility/data implications: no new standalone app, service or replacement database. No production data changes.
- Dependent work: steps 2–6 can only be drafts/fixture-backed; canonical build and live acceptance remain blocked.

## CR-2 — Publish agreed intent, destination and result extensions

**Current status:** B schema/API/root-spec publication complete. A UI consumption and D adapter interoperability remain pending; current wire contracts are in DOCS.md.

- Owners: B (schemas/API/spec), A (editable chips, destination choices, polling UI), D (travel interoperability).
- Affected structures: `SearchIntent`, `TravelTarget`, destination resolution, search response, root SPEC sections 5–7/13/15/19 and B handoff.
- Current contract: one `mode` per travel target, numeric sort without percentile selector, no structured ambiguity or pending-search API. Local plan records explicit user answers for OR modes and exact async percentiles.
- Proposed change: preserve single-mode compatibility while adding alternative modes; optional numeric extreme selector (field/direction/percentage/minimum count); structured destination choices; labelled broad representative points; completed/pending/unavailable job outcomes with opaque polling token and an explicit expired response. Keep separate destinations conjunctive. Publish exact accepted schemas/routes with the implementation, rather than treating this request as their finalized wire format.
- Reason: root one-mode behavior conflicts with agreed local alternatives, and full-pool percentile jobs need visible status and UI integration.
- Compatibility/data implications: retain old single-mode requests; reject multiple percentile fields with clarification. Exact travel selection cannot use a partial pool. Jobs remain bounded, temporary, in memory, never persist or log prompts/payloads, and expire on restart. Confirm that short-lived jobs satisfy the no-user-data persistence rule. Schema/version handling and root change log require shared-contract agreement.
- Dependent work: schema extensions, alternative-mode scoring/filtering, percentile selection and job APIs; A's controls and polling.

## CR-3 — D's authoritative database, routing and safety definitions

**Current status:** Open: authoritative implementation absent from fetched main `adbeb25`; continue fixture-backed until D provides definitions.

- Owner: D; B consumes them.
- Affected structures: D migrations/client, listing/area queries, `travel_times`, Address Points/POIs, safety lookup, `routeTimes` types and cache keys, `ai_cache`.
- Current contract: SPEC lists tables and `travel_times` column names without concrete SQL types/nullability; no migrations or exported definitions exist. TEAM specifies `routeTimes(origins, targets, mode, budgetMs)` and pure `safetyFor(rates, cityRates)`, while role requests mention `safetyFor(neighbourhoodId)`.
- Proposed change: provide authoritative migrations, client and exported routing/safety input/output types; identify the lookup adapter separately from the pure engine; specify ad hoc destination cache keys, straight-line row minutes/nullability and failure semantics. Confirm how to share a total routing budget across mode calls and how full-pool routing observes a two-minute deadline. Provide Address Points and configured Toronto area boundaries, including an agreed downtown definition, before live geographic integration.
- Reason: B must not invent SQL columns, nullability, geographic boundaries or replace D services. Exact percentile eligibility and unknown time handling need unambiguous row semantics.
- Compatibility/data implications: D owns any new migration; merged migrations remain untouched. Straight-line distances never imply confirmed minutes. Preserve existing single-mode routing callers; no schema/table change requested without D review.
- Dependent work: candidate SQL, live resolution, safety filtering, AI cache, two-pass search and exact travel percentiles remain fixture-backed.

## CR-4 — C's valuation and enrichment definitions

**Current status:** Open: authoritative implementation absent from fetched main `adbeb25`; continue fixture-backed until C provides definitions.

- Owner: C; B consumes them.
- Affected structures: `packages/shared/engine/valuation.ts`, `caveats.ts`, comparable queries, listing row mapping and benchmark inputs.
- Current contract: TEAM declares pure `valuate(listing, comparables, benchmarks)` and `priceLabel(differencePct, confidence)`, with separate `selectComparables(db, listing)`; Person B's request instead says `valuate(listingId)`. No implementations exist.
- Proposed change: C publishes canonical pure exports and concrete context types, plus its server lookup/cache function if applicable. Confirm mapping from D listing rows to the shared `Listing`, valuation unknown states and benchmark availability.
- Reason: B can score known fixture valuations now but cannot fabricate C's comparable selection, prices or caveats.
- Compatibility/data implications: keep insufficient-data/unknown labels, evidence and confidence; do not insert invented estimates or change owner schemas locally.
- Dependent work: live enrichment, price-fairness hard filtering, value scoring and detail responses remain fixture-backed.

## CR-5 — Root record updates when canonical work lands

**Current status:** B root SPEC/PERSON_B updated in integration branch. PROGRESS.md remains owned by the sync runner; no ticks copied there.

- Owner: B for its handoff/spec areas; A/D for shared contract agreement; sync runner for `PROGRESS.md`.
- Affected structures: root SPEC Change log, `PERSON_B.md`, optional sync summary.
- Current contract: root B handoff and master progress say not started; local plan clarifications have not been published in the root spec.
- Proposed change: record accepted clarifications and shared schema/API changes in root SPEC with `[B]` entries; update B task status, blockers, feature map and requests after each canonical task. The sync runner alone copies ticks into master progress.
- Reason: local progress must not imply shared delivery or silently override root contracts.
- Compatibility/data implications: documentation only; preserve the user's clarification answers and the agreed search-only execution scope.
- Dependent work: step 1 cannot be fully checked off while required root records/shared agreement are outstanding.


2026-10-16 — B-owned draft intent extensions for publication: SearchUnitTypeSchema accepts virtual `studio` while Listing UnitType remains unchanged; filters match studio to bedrooms 0 in a known whole-unit type and OR it with room, preserving unknown hard values. AreaFilter accepts `{kind:"configured",id,label,bounds:[west,south,east,north]}` for explicitly approximate configured search boundaries (Downtown/Scarborough); no D area IDs or civic geometry are invented. Owner: B schema publication with A UI/D geographic integration. Current root intent cannot represent room OR studio or configured rectangles. Reason: preserve root demo and local Downtown request. Compatibility: additive search payload variants only; no migration/data changes. Dependent engine/API work must handle these variants, and owner area lookup can replace boxes when authoritative definitions arrive. Root publication completed in the integration branch; A/D consumption remains pending.
