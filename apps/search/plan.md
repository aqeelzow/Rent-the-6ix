# Natural-language rental search — execution plan

Status: active static-search MVP work on `b/search-static-mvp` in `/tmp/rent-search-mvp`, based on canonical main `f055a38`. The supplied database is reachable with 20,956 listings (16,892 active/nonduplicate at verification). Static filters, scalar percentiles and live context detail are under native HTTP acceptance. Dynamic distance/routing work is deferred by the user. Historical status entries below describe earlier checkpoints.

## Source of truth and scope

Read `spec.md` before implementing this plan. The spec defines requirements; this plan defines execution order and records the user's clarification answers. If the two conflict, surface the discrepancy and reconcile it before implementing the affected behavior.

Build the search pipeline within the planned Next.js app: prompt parsing, editable search intent, destination resolution, deterministic filtering and ranking, and travel integration. A’s fetched main now provides the monorepo scaffold. C/D data services remain dependencies. Imports, AI explanations and ward briefings are outside this execution scope.

## Agreed clarifications

- “Cheapest” sorts all eligible matches. Explicit top/bottom percentiles select from the full eligible pool, expanding to at least 10 results when available.
- Alternative travel modes use OR: any requested mode may satisfy the limit. Separate destinations must each satisfy their own requirement.
- Broad destinations use a labelled representative point. Ambiguous campuses or business branches require a destination choice.
- Missing routing produces labelled straight-line distance and an unconfirmed time requirement. The hide-unconfirmed option excludes these results.
- Exact travel percentiles run asynchronously for up to two minutes. Incomplete routing returns an explicit unavailable result, never a supposedly exact partial percentile.

Implementation defaults: unstated criteria impose no constraints; household size does not imply bedroom requirements; interpret monetary ranges as CAD/month and rooms as bedrooms. These defaults must remain consistent with `spec.md`.

## Implementation sequence

### 1. Reconcile contracts and dependencies

- Summarize relevant root contracts and these decisions in local `shared.md`.
- Read root `TEAM.md`, `PERSON_B.md`, `SPEC.md` and `PROGRESS.md`; check requests addressed to B in the other role documents.
- Record agreed changes in the root spec and Person B handoff when implementing, following team ownership rules.
- Use the existing planned monorepo architecture; coordinate schema changes with A and D rather than creating a standalone search service.

### 2. Define shared schemas and fixtures

- Implement search-facing listing, intent, valuation, safety, travel and result schemas using Zod.
- Extend travel targets to support alternative modes while retaining single-mode compatibility.
- Add an optional numeric extreme selector containing field, direction, percentage and minimum count.
- Return destination ambiguities as structured choices.
- Provide 50 synthetic listings and representative search/detail fixtures, including unknown fields and both travel methods.

### 3. Implement parsing and resolution

- Add the Gemini provider, validated structured output, deterministic fallback parser, caching and per-IP limits.
- Preserve source phrases and hard/preference distinctions. Unsupported or unclear requests remain visible rather than becoming invented filters.
- Resolve destinations through known places, Address Points and MapTiler.
- Resolve “downtown” through an explicit configured Toronto area definition.

### 4. Implement deterministic search

- Apply cheap SQL filters before enrichment and routing. Reuse C's valuation and D's safety/travel functions.
- Implement pure filtering, home-fit, travel and five-part scoring according to the root spec, including unknown-value notes and weight renormalization.
- For alternative modes, use the best available normalized travel score per destination.
- Preserve the ordinary 500-candidate, top-100-routing flow and shared three-second routing budget.
- Ensure numeric sorting selects candidates in the requested order rather than truncating an arbitrary pool.

### 5. Implement percentile searches

- Calculate scalar percentiles before the ordinary candidate cap.
- Select `min(N, max(10, ceil(N × percentage / 100)))` listings with known values, unless the request specifies another minimum; apply existing tie-breakers at the cutoff.
- Apply all hard requirements before percentile selection.
- Travel percentiles route the full eligible pool through D's router, using the shortest requested mode per destination.
- Multiple percentile fields require clarification.

### 6. Expose and integrate APIs

- Implement parse, destination resolution, search and search-context detail routes using shared validation/error conventions.
- Extend search responses with completed or pending status; pending responses include an opaque job token and polling endpoint.
- Jobs are bounded, temporary, held in memory and removed after completion/expiry. No prompts or job payloads are persisted or logged.
- Return a clear expired-job response after restart.
- Coordinate A's destination-choice and polling UI through documented contracts.

## Verification and acceptance

- Exercise all three local examples and the three root demo prompts with Gemini and the deterministic fallback.
- Test alternative-mode OR behavior, independent destinations, ambiguous places, campus representative points and unstated criteria.
- Test hard/soft filters, missing values, hide-unconfirmed, safety opt-in and score-total consistency.
- Test percentile direction, rounding, ties, fewer than 10 matches, missing numeric values and pools exceeding 500 listings.
- Test asynchronous completion, timeout, routing failure, expiry and restart behavior.
- Validate fixtures and API errors; run typecheck, lint and relevant tests.
- Measure root latency targets on representative data, separating ordinary search from asynchronous percentiles.

## Dependencies and limits

- A supplies the scaffold and UI; C supplies listings and valuation; D supplies database migrations, geographic data, safety and routing.
- Build against fixtures until those services are available, then verify live integration.
- Check official provider documentation and current library APIs during implementation.
- Exact travel percentiles may exceed two minutes and must report unavailability honestly.
- Current implementation changes are validated in `/tmp/rent-search-current` and preserved under `patches/`; canonical app/shared/root writes are outside this session’s permitted paths. Older temporary worktree references below are historical.

## Progress

2026-10-16 — Read root TEAM/PERSON_B/SPEC/PROGRESS/CLAUDE and requests to B in A/C/D handoffs. Wrote `shared.md`, `change-request.md` and current-state/API documentation in `DOCS.md`. The repository has documents only; A's scaffold and C/D implementations are unavailable. Canonical B paths and root SPEC/PERSON_B are outside this workspace's writable scope. Root single-mode travel conflicts with the agreed alternative-mode clarification; percentile/job/ambiguity contracts are not yet published. Step 1 remains open for required shared agreement and root updates; see CR-1–CR-5. Intermediate validations will use a small synthetic sample; the final shared 50-listing fixture requirement remains intact.

- [ ] Reconcile current contracts/dependencies and publish updated B root records.
  - [x] Inspect current owner definitions and track requests in `change-request.md`.
  - [ ] Apply the current root handoff/spec patch (canonical root files are outside this session’s writable paths).
- [x] Define and validate canonical shared schemas and 50 synthetic fixtures.
- [ ] Implement parsing and destination resolution.
  - [x] Draft provider, deterministic parser, resolution, cache/limiter and tests in canonical relative paths.
  - [x] Publish B root contracts and mount in A’s fetched scaffold.
  - [x] Stage and simulate the Address Points consumer against D’s actual migration/client (exact full-address matching, fallback/deadline validation).
  - [ ] Publish/verify live Address Points, connect D-owned ai_cache and verify live providers.
- [ ] Integrate deterministic search with owner services.
  - [x] Implement and verify canonical filtering, scoring and bounded ordinary orchestration with fixtures.
  - [x] Stage authoritative read-only SQL candidate loader and simulate ordinary/percentile API consumption before enrichment/caps.
  - [x] Compose C’s actual listingContext query/cache through SQL search; validate with small simulated DB data.
  - [ ] Verify live SQL/C performance and connect authoritative D safety/travel adapters.
- [ ] Integrate percentile searches with owner routing.
  - [x] Implement and verify scalar/full-pool exact executors and bounded async jobs.
  - [ ] Verify complete live D routing and real latency.
- [ ] Expose APIs and integrate with team services.
  - [x] Implement and verify staged native parse/resolve/search/context-detail routes and bounded async job polling against eight synthetic listings.
  - [x] Mount canonical Next routes, publish B root contracts and verify native production HTTP behavior.
  - [x] Reconcile with A’s current nested listing.id contract and verify actual actions/store destination choice, selection/detail and polling integration. Earlier duplicate top-level ID shim is obsolete and removed in the upstream reconciliation.
  - [ ] Connect owner services, coordinate A’s destination/polling UI and verify live acceptance/latency.
- [ ] Complete verification and record results.
  - [x] Exercise staged APIs with fallback/mocked Gemini acceptance prompts and record synthetic ordinary/detail/async timing.
  - [x] Run canonical typecheck, lint, 57 workspace tests, production build and native fixture HTTP smoke.
  - [ ] Verify real provider/database/routing/deployed acceptance once dependencies are supplied.

2026-10-16 — Feature 2 draft implemented at `packages/shared/{schemas,fixtures}` with canonical relative layout and no replacement app/package scaffold. Strict Zod schemas/types include the agreed alternative-mode, numeric-selector, structured destination and async-result payloads. Fifty synthetic listings, three synthetic areas, ordinary/safety/detail responses and an eight-listing intermediate sample validate. Seven focused node:test tests passed; strict TypeScript 5 check passed against temporary Zod 4/tsx dependencies. `DOCS.md` documents exact draft payloads, setup, assumptions and limitations. AreaFilter, safety and application travel-row shapes are explicitly draft extensions awaiting owner alignment; no DB definitions were invented. Feature 2 checkbox remains open pending canonical scaffold/access, publication and owner integration (CR-1–CR-4).


2026-10-16 — Feature 3 draft implemented under `apps/web/src/lib/{ai,parse}`. Generic root AIProvider contract, Gemini REST/None fallback, one validation retry within a total 12-second deadline, known-place choices, injected Address Points → validated MapTiler fallback, bounded hash caches and per-IP limiter are implemented. Fallback covers all six local/root acceptance examples; studio search-only choice and explicitly labelled configured Downtown/Scarborough bounds extend B-owned draft intent without altering owner DB/Listing fields. Schema review removed an unsupported yearBuilt/yearBuiltSource paired-null invariant, preserving C's nullable input contract. Nineteen tests pass (seven schema plus twelve parser/provider/resolver/cache), strict TypeScript passes, provider calls are mocked and no live secrets used. `DOCS.md` contains setup, module contracts and verified limits. Canonical scaffold/root publication, live providers, owner Address Points/ai_cache and mounted routes remain externally pending; agreed user mode/percentile semantics need no repeated approval. Feature 3 local draft verification is complete, enabling feature 4 against the eight-row fixture sample.

2026-10-16 — Root walkthrough regression fixed and verified: adding “10 min walk to a supermarket” refines existing close-groceries amenity into one hard timed grocery target; it neither creates a duplicate place nor adds walking as an alternative mode to the campus transit target. Added an exact walkthrough test; all 19 tests and strict typecheck pass.

2026-10-16 — Feature4 local draft implemented in B-owned pure engine modules and injectable `lib/db/candidates.ts`, retaining the eight-row intermediate sample. Cheap filters, home-fit formulas, per-destination OR modes/AND destinations, unknown/hide semantics, factual score evidence and five-part renormalization are verified. Ordinary scoring caps500, routing caps100 with one shared3s budget; numeric rent/newest ordering precedes cap and shortest trips compares actual times. Full-pool hard enriched gates/derived numeric keys read injected cached fixture contexts; live SQL remains blocked on D's authoritative definitions. Safety score/valuation/caveats remain owner inputs, with no copied owner algorithms. Ten focused tests and strict TypeScript pass, including520-row pool/deadline tests. Feature4 local draft is ready for feature5; the overall checkbox remains open for canonical/live integration and owner contracts. No parser changes.

2026-10-16 — Feature4 eligibility regression corrected: hide-unconfirmed now removes cheap hard-home unknowns before500-cap selection while preserving deferred travel confirmation. Eligible count evaluates the full contextual pool after routing/hiding. Eleven focused tests pass, including first500 unknown bedrooms followed by20 confirmed matches and exact hidden travel counts.

2026-10-16 — Feature5 local draft implemented and verified in `lib/db/candidates-percentiles.ts` with pure `engine/score.ts` selection. Scalar selectors read/filter the full cached eligible pool before selection, route hard place targets before hide/selection under the shared3s budget, retain numeric order and allow >500 selected results. Explicit reference year makes building-age directions reproducible. Exact travel execution routes the full non-travel-eligible pool across all requested modes/destinations with one shared maximum120s deadline/abort signal, requires complete OTP rows and returns honest unavailable without partial exact results. Independent hard destinations apply before selection; mode OR/shortest selected target are verified. Seven focused percentile tests plus existing30 pass (37 total); strict TypeScript passes. DOCS.md documents contracts, edge cases and honest fixture/live limits. Feature5 local draft complete, enabling feature6 jobs/API dispatch; overall checkbox remains open for canonical scaffold/root publication and live D integration. No owner router/SQL/safety implementation or job scheduler added.

2026-10-16 — Feature 6 staged API implementation verified in `lib/api/{json-route,jobs,runtime}.ts` and five native `app/api` routes. Root JSON/Zod422, shared/start/poll429 with Retry-After, sanitized500, absent-listing404 and expired/consumed/restarted-job410 are implemented. Explicit server fixture mode uses eight demo rows; default listing dependencies return503. Context detail requires redacted prompt metadata and reuses bounded ordinary routing/scoring. Exact travel jobs share globalThis runtime per process, use cryptographically opaque tokens, cap16 retained jobs, abort at120s, expire180s after submission including unpolled terminals, and remove after first terminal poll. No prompts/job payloads are persisted/logged. Seven API tests and strict TypeScript pass; all six local/root prompts run through API fallback and mocked Gemini REST. Synthetic20iteration median/p95milliseconds: parse0.20/3.70, ordinary1.14/1.75, scalar0.53/0.82, detail0.17/0.51, asyncmock2.34/2.67. DOCS specifies actual payloads/errors/setup/lifecycle/privacy and verified limits. Canonical A mounting/build/lint, root publication and C/D contracts/live integrations remain pending (CR-1–CR-5); overall integration and plan completion remain unchecked.

Feature 6 final review — added positive student/family fixture matches (furnished studioCAD1,250; three-bedroom Scarborough-coordinate home with parking), so API acceptance is not vacuous. Shared `routeCandidateContexts` preserves ordinary routing behavior for search and detail, including stale detail status and duplicates; failure-to-match home filters does not discard detail travel facts. Final44-test suite and strict typecheck of all tests, benchmark and five route entries pass. DOCS top API status/table/error/lifecycle descriptions reconciled with current implementation, rather than only adding historical notes.

2026-10-16 — Current feature only: reconciled B pipeline with fetched main `adbeb25` in isolated `/tmp/rent-search-integration`. Converted B tests to Vitest, web imports to shared package exports, and search/detail result payloads to top-level `id` equal to `listing.id`; exported A-compatible SearchResultItem and API error payload types without editing A's store. Canonical source replaces historical local staging paths. Root records were three-way merged preserving A/C changes. Gates and native Next fixture HTTP checks are in progress; live C/D adapters are still unavailable. User requested finishing this current integration feature, then stopping with handoff; no additional feature work is authorized for this run.

2026-10-17 — Current integration feature production-build fix: removed `.js` suffixes from B local TypeScript imports/re-exports to match A's bundler style, and statically imported validated known-place JSON instead of reading an asset path with node:fs. Canonical web typecheck (including Next route typegen), lint and44 web Vitest tests pass under Node24. Prior13 shared tests/typecheck passed. Production build/native HTTP smoke remain the parent’s final integration checks; no new feature or A/C/D configuration changes were made.

2026-10-17 — Current API feature complete; stopped at the user’s request before further features/integrations. Fetched main `adbeb25` and integrated B source in `/tmp/rent-search-integration`, branch `b/search-pipeline-integration`. A scaffold is present; no authoritative C/D implementation exists at that snapshot. Node24.22.0/pnpm10.34.7: workspace typecheck/lint,57 tests (13 shared,44 web), frozen offline install and fresh production Next16.4.2 build pass. Required web Zod dependency is a separate commit `2b2d641`; no owner algorithms or A UI were changed. Native production fixture HTTP checks cover all five routes, six fallback prompts (result counts4/8/6/2/4/1), positive student/family matches, detail score/travel consistency, campus ambiguity/representative point,422 errors, unknown410 jobs, opaque pending jobs, cross-route polling, honest routing_incomplete and consumed410. Local server stopped. Smoke artifact: `/tmp/rent-search-http-smoke.py`. Provider tests mock Gemini; external provider/DB/router/deployed behavior remains unverified. Prior progress entries describe historical staging, not current blockers.

Resume environment: put `/tmp/rent-search-validation/node_modules/node/bin` and `/tmp/rent-search-validation/node_modules/.bin` first on PATH; run repository pnpm scripts from the integration worktree. Dependencies are installed; frozen lockfile store is `/tmp/rent-search-pnpm-store`. System Node22/global pnpm12 are unsuitable for this scaffold. The original branch `search` remains a dirty earlier publication checkpoint, including unrelated untracked root package manifests/node_modules; preserve those files and reconcile intentionally after resuming. Do not rerun the older publisher script or overwrite the verified integration from that checkpoint. Nothing pushed or merged.

2026-10-17 — Follow-up for Vercel failure at `93ef406`: closed the unclosed `engineConfig` object, removed `.js` suffixes from web parse imports, and declared Zod as a direct web dependency with the lockfile updated. Web typecheck passes. Local production build is blocked by sandbox denial of Turbopack's helper port; verify on Vercel after this branch is published.

2026-10-17 — Active resume audited canonical `search-next` at `570300e`; prior temporary integration worktree is gone. Created fresh secret-free `/tmp/rent-search-current` validation copy and installed frozen-lockfile dependencies with Node24.21/pnpm10.34.7. Feature4 subagent inspected newly present C valuation/caveats and D migrations/client; D routing/safety and C comparable queries remain absent. Prerequisite feature2 correction accepts actual C nullable benchmark, adjustment code/count, insufficient considered counts (including same-building caps), and C-requested torontorentals provenance. Fixture enrichment now executes C valuation/caveats on eight synthetic listings with fixed time; sparse pools honestly report insufficient_data. Feature3 subagent restored static validated known-place JSON import for production bundling. Six B test files now use Vitest rather than mixed node:test registration; lint-only test fixes preserve checks. Shared45 + web49 tests, both package typechecks/lints and production Next build pass. Native production fixture smoke confirms fallback parse, positive two-result cheapest query, honest null-benchmark valuation, search/detail score/valuation consistency and three-campus ambiguity. Server stopped. Source changes are staged only in the writable copy; durable `patches/search-interoperability.patch` passes `git apply --check` against canonical checkout. Canonical app/shared writes and root handoff publication remain outside permitted paths; no merge/push/deploy or owner UI change. Goal remains active: owner live integrations and full acceptance/latency are not complete.

2026-10-17 — Continued from verified prior progress (not a stopped process). Feature3 subagent implemented B-owned Address Points consumer against D’s actual address_points migration and getClient: bound exact full-address query, validated outputs/ambiguity, absent/failed/aborted lookup fallback, one in-flight read guard, no geocoder call after the shared deadline, and fixture-mode DB bypass. Four tests use two simulated addresses; live PostGIS/normalization/index/server timeout remain external. Feature6 subagent repaired the current result.id/listing.id mismatch across shared schema, fixtures, ordinary/percentile/detail builders, with strict equality and A-compatible type exports; two regressions exercise actual A store selection/error behavior without editing A files. All151 workspace tests (shared45/worker51/web55), workspace typechecks/lints and production Next build pass. Native standalone fixture HTTP smoke verifies all five routes, positive two-result search, strict identity and score/detail consistency, campus choices,422, pending/cross-route polling/routing_incomplete/consumed410. Eight-iteration synthetic median/p95ms: fallback2.90/4.46, ordinary4.37/4.70, scalar4.33/6.01, detail3.25/3.58; these do not prove live latency. Reproducible smoke saved at validation/native-http-smoke.py; server stopped. Source patch and separate B root handoff/spec patch are staged for review/application; canonical files remain unchanged outside allowed apps/search. Plan remains incomplete pending canonical publication, C comparable-query/cache, D safety/routing/loaded geographic services, persistent-cache integration, A destination/polling UI and real provider/database/deployed acceptance.

2026-10-17 — Feature4 SQL subagent added read-only candidates-sql consumer and asynchronous candidate-source hook consumed by ordinary and percentile execution before caps. Bound hard cheap gates use D’s existing listing columns; mapped numeric/date/null data validates before enrichment; pure filters preserve exact geography and unknown semantics. Parent aligned nullable civic IDs with D’s migration and added OR/hide regression without fake IDs or safety. Seven loader tests cover simulated rows, injection bindings, filters, 520-row full-pool ordering/percentiles, API503 failures and abort/background-read recovery. Shared46 + worker51 + web62 =159 tests, workspace typechecks/lints and production build passed; native standalone fixture smoke passed all five routes and server stopped. PostgreSQL/PostGIS execution is unverified because no DATABASE_URL is configured; owner enrichment and live detail remain open. Existing Gemini/MapTiler keys and main model configuration were found without exposing values, so live provider acceptance is continuing instead of assuming credentials absent.

2026-10-17 — Completed the current live-provider validation/fix feature and stopped before another feature as requested for handoff. Real configured Gemini/MapTiler calls against eight fixture rows exposed source-key/query instructions that lost travel targets, and partial geocoder matches that offered unrelated locations. Fixed explicit evidence/key/query/hardness instructions, guarded loss or changes to recognized hard timed targets with honest fallback, and required full geocoder relevance with regressions. Final web65 tests, web typecheck/lint and fresh production build pass; earlier unchanged shared46/worker51 tests and workspace gates pass (162 total current tests). Parent native standalone HTTP fixture smoke passes all five routes; server stopped. Six live Gemini cases:2 provider interpretations/4 deadline fallbacks; subsequent campus semantics verified hard bike10/soft rent3–5k/ambiguity/4 results at10.873s. Successful calls7–11s and12s timeouts do not meet4s parse latency. TD branch stays unavailable rather than accepting partial landforms. All6 none/fallback cases return4/8/6/2/4/1 matches. Sanitized evidence under validation/; keys only read in process memory and checked absent in saved reports. Remaining: canonical write/publication; live DB URL/data/PostGIS execution; C comparable-query/cache; D safety/routing/geographic services; A destination/polling/trusted identity UI; fast-model/runtime latency configuration and authoritative TD match; complete live/deployed acceptance. Goal is not complete or paused by this status handoff.

2026-10-17 — Read-only remote audit found main advanced to29a7393 (C query/cache, effectiveCount schema, scam/caveat updates and A actual search UI/actions/polling). Cloned main to /tmp/rent-search-upstream; feature subagent ported only still-needed B fixes, preserving all A/C/D files and current schemas. Removed obsolete duplicate result.id compatibility from the new baseline because A now consumes listing.id. Added actual A-actions↔B-runtime tests for ambiguity selection, nested identity/detail and real async polling. Frozen install, shared48/web129/worker68=245 tests, workspace typecheck/lint, production build and parent native fixture HTTP smoke passed; server stopped. Source work is on b/search-owner-integration; original checkout untouched. Fast-model diagnostic on earlier checkpoint used explicit temporary verified metadata model but generateContent returned404; stopped remaining5 trials, no model/config change, no Gemini success/latency claim. Sanitized evidence saved under validation/rent-fast-model-*. Existing C lookup is now available, so C context integration is the next feature rather than treating that service as absent. DB URL/D routing/safety/live/deployed acceptance remain unavailable.

2026-10-17 — Finished current feature and handoff at user’s request. SQL default runtime now composes C’s published listingContext/cache with B candidate loading; fixture mode takes precedence, absent/invalid DB is sanitized503, missing D safety/travel stays unknown, and unavailable live detail stays503. Abort-aware composition bounds unfinished C work until owner queries settle. Six focused tests exercise actual C code with a small tagged DB sample, valuation/effectiveCount/caveats/fairness/cache and cancellation/errors. Final250 tests(shared48/web134/worker68), typecheck/lint/build pass. Native standalone fixture smoke and invalidDB503/parse/known-place resilience checks pass; servers stopped. Durable source and B root handoff patches now target upstream29a7393, verified against clean worktree. Older570300e patches remain historical. No further feature started; no push/merge/deploy. Full objective remains incomplete for live DB/D services/provider performance/deployed acceptance and canonical publication.

2026-10-17 — Active static-search MVP on b/search-static-mvp in /tmp/rent-search-mvp. Added B-owned bound UUID detail lookup and real detail scoring/valuation; no synthetic geography is returned in live mode. Replaced single-operation global rejection with bounded eight-operation capacity for overlapping reads/enrichment. Added bare numeric budget parsing and focused regression coverage, including unknown units, SQL binding/absence/errors, owner context and capacity recovery. Current web138 tests pass; raw Vitest without package script flags additionally reports the existing server-only alias stub has no test suite. TypeScript check passes. Parent is measuring live database performance and acceptance; dynamic routing remains deferred.

2026-10-17 — B SQL dependencies now reuse the existing clone-preserving MemoryCache for validated public C owner context (60-second TTL, 1,000 entries per dependency instance). Keys hash the full listing, including rent and updated timestamp; prompts/intents are never cached. Failed or aborted reads are not cached. Warm requests reuse valuation and stored caveats without repeated owner SQL; observation/building changes can lag by up to60 seconds. Tests cover reuse across intents, mutation isolation, changed listing fields, expiry and failed/aborted reads.

2026-10-17 — Static MVP production audit: 279 workspace tests (51 shared/144 web/84 worker), workspace lint/typecheck and fresh build pass. Native standalone database smoke verifies independent SQL counts183, cheapest ordering, minimum10 scalar percentile, size/year/type/AC, hard fairness, real detail/score identity,404/422 and concurrent search. Fast-provider timeout now3s; live response was labelled fallback3.074s. Fully cold production search20.143s, later context-expired/C-cache-warm3.859s, immediate warm0.801s, scalar0.149s, detail0.047s (individual observations). Safety remains unknown: zero assigned neighbourhood IDs in active data, D safety adapter absent. Goal remains active for cold/full enriched performance and static safety; dynamic routing explicitly deferred. Detailed evidence is validation/static-mvp-findings.md. Source branch is local; no push/merge/deploy.
