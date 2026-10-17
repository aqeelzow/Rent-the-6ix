# Search integration change requests

## External blocker register — 2026-10-17

Authoritative review: upstream main `bbad7ae` (through PR23), plus C’s published `6fb65dd` benchmark consumer integrated unchanged as `956c8d0`. This register supersedes older missing-database, missing-civic-data and missing-detail-lookup statements below. Scope: outstanding external dependencies for Person B, including P2.24/P2.25 and later B features. A dependency on a later feature is not a blocker for the current static endpoints.

### Current search completion blockers

| ID | Owner | Required work from the owner | Affected B work | Evidence / acceptance to unblock |
| --- | --- | --- | --- | --- |
| EXT-1 | **C — valuation** | Optimize the existing `listingContext` path or publish a batch context/valuation function. Preserve comparable eligibility, adjustments, confidence, building caps, caveats and unknown-data semantics; define per-listing failures/cancellation behavior. | P2.24 cold-search latency and full-pool `best_value` / hard price-fairness searches; performance aspect of scalar percentiles. Existing static filters and cached detail already work. | B already pipelines eight calls and caches public context for 60 seconds. Earlier native173-result cold search8.863s versus0.523s warm; post-main-merge read-only SPEC16 searches5.406s/30.017s/2.752s. B now separates full-pool safety/travel eligibility from capped valuation: latest two-connection read-only runs5.153s/6.722s/2.856s, with500/500/317 C contexts and unchanged1628/2679/317 eligibility counts; SPEC section 19 requires search under 2 seconds. Individual read-only 32-context benchmark is not proof of full-pool performance. Unblock with the owner implementation plus representative cold/full-pool acceptance, not a reduced candidate pool or changed valuation algorithm. Source: `apps/web/src/lib/db/valuation.ts`; evidence: `validation/static-mvp-findings.md`, `validation/rent-c-context-concurrency.json`. |
| EXT-2 | **D — safety** | Publish the authoritative neighbourhood/city-rate lookup, `safetyFor` integration and `safetyScore`, with selected offence types, population/denominator method, time window, provenance, caveats and missing-data behavior. | P2.24 live safety filtering/ranking; safety enrichment in P2.25 and subsequent explanations. | **Resolved by merged PR22 and live read-only acceptance.** Published engine/safety.ts and db/safety.ts supply five-major-type rates, city denominator/caveats and score; B enrich wiring is merged. RUN_LIVE_SAFETY=1 proves real DB opt-in/off, positive score weight, caveats, exact hard-limit acceptance/rejection and null-neighbourhood unknown handling. Population data is absent; the published equal-neighbourhood city mean is explicitly caveated. |

### Dependencies for full scope, deferred or later features

| ID | Owner | Required work from the owner | Affected B work | Status / acceptance to unblock |
| --- | --- | --- | --- | --- |
| EXT-3 | **D — travel** | Publish `routeTimes(origins, targets, mode, budgetMs)` and its cache/origin/target mapping; operate OTP and amenity precomputation for all four modes. Preserve shared deadlines, alternative-mode OR behavior, per-target identity, cancellation and honest straight-line fallback. | Full P2.24 second routing pass, confirmed hard travel filters and shortest-trip sorting; exact travel percentiles; confirmed travel in P2.25. | **Explicitly deferred by the user.** P1.15 OTP setup is now published and marked complete by D; PR28 now publishes P2.11 routeTimes/cache and runtime OTP_URL integration; P2.10 amenity precomputation and a reachable live OTP service remain unverified. POIs/stops being loaded does not supply routed minutes. B orchestration and polling already work; missing-router jobs return `routing_incomplete` without valuation work. Published client/cache/budget unit coverage resolves the missing-adapter dependency; remaining acceptance needs live OTP and precompute evidence. This is not a blocker for rent/room/size/type/age/AC filters. |
| EXT-4 | **D — affordability/benchmarks; C — valuation benchmark consumption** | D publishes the affordability engine and sourced utilities and transport and other applicable cost benchmarks, with sample flags and periods. D supplies StatCan/CMHC benchmark mapping; C supplies/validates valuation benchmark lookup consumption where needed. | Full P2.24/P4.2 `lowest_true_cost`; benchmark comparison in full P2.25 and grounded P3.1/P3.3 content. | **C P2.3 StatCan consumption is resolved on this branch:** owner commit `6fb65dd` is integrated unchanged. Read-only real-DB acceptance verifies asking-only dwelling/bedroom mapping, source/period/units, unknown-bedroom nulls, search/detail equality and unchanged valuation estimates/confidence/caveats. D has loaded 11 sourced StatCan/TTC rows; missing CMHC, utilities/car samples and P3.12 affordability remain open. B still rejects unavailable true-cost sorting; StatCan benchmark context does not supply true monthly cost. Basic valuation, rent sorting and detail continue without a matching benchmark. |
| EXT-5 | **D — derived civic indicators** | Publish the required census/affordability, housing-stock/condition, development and rent-trend indicators or their query contracts, with source, period and missing-data semantics. | Full P3.3 ward/neighbourhood briefings and pre-generation for 25 wards; optional richer civic detail. | Boundaries, buildings and crime indicators are supplied. D P2.14/P3.10/P3.11 remain open; these loaded datasets do not prove all planned derived indicators exist. Unblock with the required source-backed facts. B can implement briefing validation/templates and consume available indicators independently. D's explorer HTTP API is not a prerequisite for B to read already-defined tables. |

### External deployment and UI acceptance dependencies

These require owner coordination or verification; they do not prevent implementing the B endpoint code.

| ID | Owner | Required work from the owner | Affected B work | Current boundary |
| --- | --- | --- | --- | --- |
| EXT-6 | **A + deployment owner (D for infra)** | Confirm and configure a trusted request-identity/proxy-header contract, including how spoofed incoming identity headers are handled. | P0.7/P1.24 production per-IP quotas and AI/search abuse limits. | **Vercel code/contract resolved:** official platform-header/system-env contracts verified; runtime now validates a single x-vercel-forwarded-for IP only under server VERCEL=1, preserving injected identity and safe anonymous fallback elsewhere. API quota/spoof tests and real-DB search/detail acceptance pass. Deployed URL is discovered and Vercel serving is confirmed, but new-adapter rollout/system-env access and multi-instance quota behavior are unverified. D/Vultr still needs an explicit trusted proxy contract; do not set VERCEL=1 there. |
| EXT-7 | **Deployment owner (A for Vercel; D for server deployment)** | Provide a deployment in which job creation and polling reach the same live process, or agree a revised job-state contract before changing the architecture. Supply the deployed URL/runtime configuration for verification. | Production acceptance of P2.24 asynchronous job polling. | Native single-process polling is verified. Jobs are intentionally temporary/in memory; a restart or another instance returns410. Multi-instance Vercel affinity is not proven. This matters when enabling asynchronous travel searches, which remain deferred; it does not block synchronous static search. |
| EXT-8 | **Deployment/model-account owner (A/D)** | Provision/confirm usable fast-model credentials, model access and quota in the actual deployment. | Live Gemini acceptance for P1.21/P3.1/P3.4/P5.9. | Fast-model access is confirmed by a real minimal JSON request (HTTP 200, 663 ms), and ignored local web env now selects GEMINI_MODEL_FAST=gemini-3.5-flash-lite while preserving the main model. Full structured-parser acceptance remains open: all six public examples fell back under real calls (timeouts/HTTP 503), with constraints and destination ambiguities preserved. Latest exact full-parser diagnostic with the real183-area catalogue returned HTTP429 RESOURCE_EXHAUSTED in221ms (one request, no retry or output), so current quota is independently confirmed. See validation/gemini-structured-diagnosis.json. Three-second deadline is unchanged; no successful live parse, schema-compatibility or1.5s-target claim. Deployment must independently set/verify FAST and sustained availability. B owns provider/configuration validation; deterministic fallback is available. |
| EXT-9 | **A — frontend** | Verify real API integration in the rendered/deployed list, map, filters and detail UI; mount explanation/import/briefing views as those B endpoints land, and agree/render any new building/result fields. | End-to-end search/detail acceptance; later P3.1/P3.2/P3.3 product delivery. | Local rendered desktop/mobile landing, real cards/score, editable filters/empty state, campus selection, contextual civic detail, safety opt-out and Back now pass against a read-only two-row SQL oracle (validation/rendered-search-results.json). This resolves the browser-absence/local-core-UI gap only. Live map visibility timed out with external basemap enabled; cause unresolved, isolated final run does not verify maps. Deployment rollout remains unverified. API building records are present but A BuildingSection still renders its placeholder on both viewports. A: consume DetailResponse.building and verify live map/pin/deployed flows; console also includes an unattributed resource404. Imports remain deferred by the user. |

### Current B work and scope

Static detail areas/indicators/duplicates/building, indexed Address Points, civic parsing, parse DB caching, Vercel request identity and published safety/place-routing integration are implemented and verified to the scopes recorded above. Their earlier implementation requests are resolved; deployment and live-service acceptance remain separate.

The current search plan still requires C cold-context performance/determinism, D amenity precompute and reachable live OTP, provider quota recovery, A building/map consumption and deployment rollout/affinity verification. B will integrate and validate those deliverables when available. Explanations and ward briefings are outside this local search plan. Import P3.2 is explicitly deferred until the user instructs it; it is not a next action.

### Resolved / not external blockers

Database credentials/connectivity, B canonical source publication, C's single-listing context/valuation/caveat exports, live ID lookup, shared nullable/effective-count/source compatibility, A action/store contracts, geographic/building/POI/stop/crime data and Address Points normalization are supplied. D PR15 publishes `normalizeAddress()` and the civic loaders. Some older change requests below describe these as missing; retain them as history only.

Team ownership: `TEAM.md` section2 and `apps/search/agents.md` reserve C/D algorithms/tables to their owners. B integrates their published contracts. This register records requests only; no teammate was messaged and no other owner's code, schema, data or configuration was changed.

## Historical integration notes

### Historical static MVP live follow-up — 2026-10-17

Database configuration is now supplied and verified. B static SQL filters/percentiles and live ID detail work against the existing owner tables. This supersedes older missing-DB/detail notes below.

C performance request: `listingContext` currently performs comparable/observation/building reads per listing. A cold 183-result confirmed static search took20.1 seconds in the built server; B now pipelines eight owner calls and caches validated context for60 seconds, but full fairness/best-value eligibility may scan16,892 listings and cannot rely on C's5,000-entry valuation cache. Please provide a batch context/valuation API retaining current comparable selection, caveats and confidence semantics. No owner algorithm/schema was copied or modified. B depends on that contract for consistently fast cold/full enriched searches.

D static safety revalidation: current data now has15,510 active nonduplicate listings, all assigned neighbourhoods,158 neighbourhoods and1,422 crime indicators (nine types,2023–2025). The earlier missing-assignment blocker is resolved. Current upstream main147c74b still lacks authoritative city-rate, safety lookup and score adapters; publish those contracts before B enables live rate/ranking confirmation. B does not infer a city rate by averaging neighbourhood rates, and never substitutes fixture rates. Dynamic distance/routing work is explicitly deferred by the user.

### Historical status — upstream 29a7393

Supersedes older dependency notes: C’s comparable query/cache/listingContext and A’s actual search actions/UI/polling are now published. Current B composition consumes C unchanged and tests A actions against B runtime. CR-4’s missing implementation is resolved; live DB/performance acceptance remains open. CR-3 remains open for D routing/safety/geographic/cache/detail services and usable database configuration. Current SQL path returns unknown D values honestly; live detail remains503. Current patches target29a7393, while570300e variants are historical. One unfinished read/enrichment per process bounds background work but may reject overlapping searches; owner cancellation/server timeout support remains requested.


### Historical audit — 2026-10-17, checkout `570300e`

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

## Static MVP update — 2026-10-17

Database configuration is now supplied and parent verified real listings are loaded. B's ID-based live detail lookup is implemented; details no longer require civic adapters to return listing/valuation/score. D-owned civic areas/indicators and live duplicate adapters remain unavailable and return empty arrays. Overlapping candidate/context operations are bounded at eight rather than one; D statement timeout/cancellation remains requested for production. Parent is assessing live SQL/enrichment latency before declaring acceptance.


TD Bay/Queen acceptance resolved (2026-10-17): official TD/Payments Canada records identify 394 Bay St; B's known-place entry uses actual D Address Points row 8067834 and passes a read-only live exact-coordinate comparison. Explicit branch aliases resolve without accepting generic TD/other intersections. The earlier request for owner/provider matching data is fulfilled by published data; no further external deliverable is needed for this case. P1.23's known/civic/MapTiler paths are verified. Source links and representative-point limitations are recorded in DOCS.md; provider quota/latency remains a separate acceptance gate.


2026-10-17 deployed acceptance update (EXT-6–9): the public URL is now known from the repository homepage and production Vercel static search/detail passed independent actual-DB count/ID/order/field and contextual identity checks. The earlier request to supply a URL is fulfilled. Evidence:validation/deployed-search-results.json. This is published-main acceptance only; `b/search-plan-completion` still needs rollout, including civic/building detail, guarded ranking, benchmark and trusted-identity changes. The one production synthetic parse used labelled fallback, so Gemini availability/configuration remains open. Browser-rendered list/map/filter/detail and multi-instance in-memory job affinity are not verified. Owner action: deploy the reviewed branch through the existing release process and verify those specific product/runtime gates; no new architecture or owner code is introduced by this audit.


2026-10-17 main538b18f recheck: D routeTimes/cache/OTP client and runtime composition are published (PR28), resolving the missing-export portion of EXT-3. OTP_URL is not configured locally and both local router addresses are unreachable; actual routed minutes/precompute remain unverified. Fresh repeated owner-context performance measurements changed despite canonicalized array order, so EXT-1 additionally needs C to investigate equal-distance comparable boundary determinism before tuning concurrency. No owner algorithms or data were changed.


2026-10-17 P2.24 partial-routing acceptance: audited D’s follow-up against published `createRouteTimes` and B’s `routeCandidateContexts`. Ordinary routing already applies each completed mode independently before waiting for the other modes; a completed mode survives a hanging mode. D’s existing 250 ms return margin returns completed pairs together with labelled straight-line/null-minute rows for unfinished pairs. No B algorithm change or new streaming contract is needed for this published adapter. A router promise that never exposes its intermediate rows cannot provide those rows to B; incremental callbacks would require a separate owner contract, not removal of the shared three-second deadline.

`candidates-routing.test.ts` adds a default regression for completed-mode retention and ignored late responses, plus opt-in `RUN_LIVE_PARTIAL_ROUTING=1` acceptance. Actual read-only SQL selected three distinct real listing origin cells; the published D adapter used controlled router answers/hangs. Both requested modes were exercised: completed bike rows survived pending transit, an independent failed destination excluded its listing, unknown-only listings retained notes unless hidden, and score totals remained consistent. Partial coverage still returns unavailable for exact travel percentiles. Two tests pass with the live flag. This closes the B partial-row follow-up for the current adapter, not P2.24 as a whole: live OTP, amenity precompute, representative latency and the two-minute full-pool live-routing acceptance remain open. No live OTP, C valuation benchmark, database writes or owner-code changes were performed.
