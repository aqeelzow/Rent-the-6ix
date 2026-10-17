# Static MVP verification — 2026-10-17

Source: branch `b/search-static-mvp`, based on canonical/upstream main `f055a38`. Feature work delegated to subagents in `/tmp/rent-search-mvp`; no owner C/D algorithms, migrations or A UI changed.

Verified against the supplied PostgreSQL database with read-only queries: 20,956 listings; 16,892 active nonduplicate listings; 9,656 known sizes; 983 known building years; 2,685 confirmed AC listings; zero assigned neighbourhood IDs among active nonduplicates. No listing snapshots or credentials are included.

| Requirement | Current evidence |
| --- | --- |
| Natural language → static filters | Native POST parse returned confirmed rent/bedroom/type/area intent and cheapest sort; labelled deterministic fallback completed in3.074s after the new3s provider deadline. Successful live Gemini interpretation is not claimed. |
| Database static queries | Native production search returned183 confirmed downtown apartments matching independent SQL rent/bedroom/type/box criteria. Separate independent SQL/HTTP assertion covers size, building year, type and AC together. |
| Cheapest sorting and scalar percentiles | Rent ordering verified; bottom5% selected minimum10 from full183 eligible rows. Regression tests cover all scalar fields, large pools and ties. |
| Price fairness | Native hard-underpriced filter verified against a narrow live pool; owner C computes actual valuations/caveats. Broad enriched scans remain expensive. |
| Live context detail | Built server returns real listing/valuation/matchScore matching search. Missing UUID404; invalid search422; overlapping searches succeed. Civic arrays remain empty until owner adapters exist. |
| Performance | First fully cold183-row production search20.143s. Later context-expired/C-valuation-warm search3.859s; immediate fully warm repeat0.801s; warm scalar percentile0.149s; cached detail0.047s. These are individual observations, not p95 estimates. Cold/full-pool search does not meet the2s target. |
| Static safety | Unavailable: all active listing neighbourhood IDs are NULL and D's safety adapter is not published. Returned as unknown; no synthetic rates used. |
| Dynamic distance/routing | Deferred by explicit user priority; existing honest distance/unknown-time behavior retained. |
| Verification | 279 workspace tests (51 shared /144 web /84 worker), workspace lint/typecheck and fresh production build passed. Native HTTP smoke exercised the built standalone server. |

The goal remains active: consistently fast cold/full enriched searches and live static safety still need C/D owner integration (see change-request.md). No push, merge or deployment was performed. `DATABASE_URL` and existing provider credentials are only in ignored local environment files.

Run from repository root with the server live: `SEARCH_BASE_URL=http://127.0.0.1:3041 node --env-file=apps/web/.env.local apps/search/validation/static-mvp-smoke.mjs`. Result measurements are saved in `static-mvp-production-results.json`; timing order is parse, ordinary, immediate warm ordinary, scalar percentile, detail, missing detail, invalid search, two overlapping searches, combined size/year/type/AC, hard fairness.
