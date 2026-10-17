# Live provider acceptance (2026-10-17)

Scope: staged native production app, eight synthetic listings, real configured Gemini and MapTiler credentials read into process memory from canonical apps/web/.env.local. No env files or credential values copied. Database not configured. Configured main model used unchanged; fast-model variable absent. No C/D-owned files changed.

Authoritative reports: (initial diagnostics remain temporary), `apps/search/validation/rent-live-provider-postfix.json`, `apps/search/validation/rent-maptiler-diagnostic.json`. Each report contains only fixture prompts/evidence, public destination metadata, timings and provider HTTP status; no credentials/provider error bodies.

Initial native live run: Gemini HTTP200 on local prompts1/2, but cleaner removed both destinations; third prompt timeout/fallback. Do not interpret transport success as semantic acceptance. The system instruction did not explain source-key formatting or require a verbatim place query. Added exact `travelTargets.<target.id>` source paths and literal-query instructions. Cleaner still rejects ungrounded sources/coordinates. If any proposed travel target is removed, ParseService now falls back honestly rather than silently broadening the search. Regressions cover numeric-index source rejection and destination/time preservation.

First post-fix six-prompt run:

| Prompt | Actual parser | Parse ms | Fixture results |
| --- | --- | ---: | ---: |
| Local campus | gemini | 11114 | 8 |
| Local TD branch | fallback | 12172 | 8 |
| Local cheapest downtown | gemini | 7065 | 6 |
| Root student | fallback | 12012 | 2 |
| Root couple | fallback | 12013 | 4 |
| Root family | fallback | 12011 | 1 |

Four requests exhausted the existing provider deadline; no extra retry outside GeminiProvider was performed. No definitive authentication, quota or invalid-model response was observed. Two actual Gemini interpretations pass schema/cleaning but do not establish full acceptance. Campus target was retained but incorrectly soft; instruction subsequently clarified `within` hardness and criterion-local preference wording, with a final bounded follow-up recorded separately. All six fallback requests completed with positive expected sample counts4/8/6/2/4/1 and parse times5–122ms. None run still used real MapTiler for the unknown TD branch; Gemini calls were absent.

MapTiler's full TD query returned HTTP200 with five unrelated Toronto major landforms, each relevance0.554815. Disabling fuzzyMatch in a diagnostic produced the same results. Official MapTiler client defines relevance1 as full query match, so resolver now rejects missing/partial relevance and returns explicit unavailable for this TD query. It never substitutes the intersection or guessed coordinates. Full matching alternate-language labels remain valid without a lexical-name heuristic. Tests cover partial, missing and mixed full/partial results. Exact TD destination acceptance remains blocked on an authoritative matching address/POI/provider result. UofT St. George remains a labelled known_place representative point, resolving without external calls.

Verification after parser/source and relevance changes:64 web tests, web typecheck/lint and fresh production Next build passed. Final instruction-only hardness adjustment reran tests/build (results appended by parent if required). No live DB, safety/routing, deployed app or UI acceptance was attempted. Current model latency exceeds root target; live six-prompt Gemini acceptance is incomplete.

References consulted before changes:
- https://ai.google.dev/gemini-api/docs/structured-output
- https://docs.maptiler.com/cloud/api/geocoding/
- https://github.com/maptiler/maptiler-client-js/blob/main/src/services/geocoding.ts

Final bounded campus follow-up (`apps/search/validation/rent-live-hardness-postfix.json`): actual Gemini HTTP200/parser gemini,10,873ms,4 fixture matches. Correct rent3–5k soft, explicit house/apartment choice hard, bike10-minute requirement hard, campus query grounded and three-campus ambiguity preserved. This is one successful semantics check; it does not overturn four deadline failures or the latency failure in the six-prompt sweep.

A final defensive guard compares only fallback-recognized hard timed targets by source query/category: a model-softened, omitted or widened recognized bound triggers honest basic fallback; it does not rewrite AI values or turn unrelated destinations hard. Regression verifies soften/omit/widen recovery and preserves an explicitly preferred soft time target. Final65 web tests passed; production build passed after adding explicit SearchIntent type for closure checking. Final typecheck/lint rerun confirms the annotation.

Changed staged files only: apps/web/src/lib/parse/{instruction.ts,index.ts,resolve.ts,parse.test.ts,address-points.test.ts}. No secrets or owner files changed. Native servers exited143 and all acceptance runner sessions completed. No more provider requests planned for this feature.
