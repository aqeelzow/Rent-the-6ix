# Natural-language rental search — execution plan

Status: agreed plan; implementation not started.

## Source of truth and scope

Read `spec.md` before implementing this plan. The spec defines requirements; this plan defines execution order and records the user's clarification answers. If the two conflict, surface the discrepancy and reconcile it before implementing the affected behavior.

Build the search pipeline within the planned Next.js app: prompt parsing, editable search intent, destination resolution, deterministic filtering and ranking, and travel integration. The repository currently contains documents only. A's scaffold and C/D's data services are dependencies. Imports, AI explanations and ward briefings are outside this execution scope.

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
- Implementation in the planned monorepo locations needs write access beyond the current `apps/search` workspace.

## Progress

- [ ] Reconcile contracts and dependencies; write `shared.md`.
- [ ] Define schemas and fixtures.
- [ ] Implement parsing and destination resolution.
- [ ] Implement deterministic search and scoring.
- [ ] Implement percentile searches.
- [ ] Expose APIs and integrate with team services.
- [ ] Complete verification and record results.
