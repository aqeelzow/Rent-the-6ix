# TEAM.md — Four-person build

Four people build RentThe6ix at the same time in one GitHub repo, each with their own Claude Code session. This file is the shared rulebook. Each person also has their own file:

- **Person A — Frontend & map** → `PERSON_A.md`
- **Person B — AI & search API** → `PERSON_B.md`
- **Person C — Listings pipeline & valuation** → `PERSON_C.md`
- **Person D — Civic data, travel & infra** → `PERSON_D.md`

`SPEC.md` is what to build, and `CLAUDE.md` still applies, **except where this file overrides it** (section 6).

---

## 1. How to start a session (everyone)

Tell Claude Code: *"We're in team mode. Read TEAM.md and PERSON_C.md (your letter), then follow the session start protocol."*

The agent then:
1. Runs `git pull` on `main` (and rebases its current branch if it has one).
2. Reads `TEAM.md`, its own `PERSON_X.md` (Current state, Handoff notes, Requests, task list), and `CLAUDE.md`.
3. Reads only the `SPEC.md` sections for its next tasks, plus the SPEC Change log.
4. Checks the other three `PERSON_X.md` files for **requests addressed to it**.
5. States the next task id and starts.

---

## 2. Who owns what

Each person edits **only their own folders**. That's what keeps four people from colliding.

| Area | A | B | C | D |
| --- | --- | --- | --- | --- |
| Repo scaffold, root config | **owns** (P0.1–P0.3) | | | |
| Web pages & components | `apps/web/src/app/**` (pages, not `api/`), `src/components/**`, `src/lib/store/**`, `src/app/globals.css`, `public/**` | | | |
| Schemas & fixtures | reads | **owns** `packages/shared/schemas/**`, `packages/shared/fixtures/**` | reads | reads |
| Engine (`packages/shared/engine/`) | — | `filters.ts`, `home-fit.ts`, `travel.ts`, `score.ts` | `valuation.ts`, `caveats.ts` | `safety.ts`, `affordability.ts` |
| AI | — | `apps/web/src/lib/ai/**` | worker AI extraction uses B's provider (P4.10) | — |
| API conventions | uses | **owns** `apps/web/src/lib/api/**` | uses | uses |
| API routes (`apps/web/src/app/api/`) | — | `search/parse/**`, `listings/search/**`, `listings/[id]/route.ts`, `listings/[id]/explain/**`, `listings/import/**`, `listings/score/**`, `areas/[kind]/[id]/briefing/**`, `geo/resolve/**` | `listings/[id]/valuation/**` | `listings/[id]/travel/**`, `listings/[id]/nearby/**`, `areas/**` (except briefing), `health/**` |
| Server libs (`apps/web/src/lib/`) | `format/**` | `parse/**`, `db/candidates*` | `db/valuation*` | `db/**` (client, other queries), `geo/**` |
| Worker | — | — | `apps/worker/src/sources/**`, `src/pipeline/**` (except `travel-times.ts`), `src/schedule.ts`, `fixtures/`, `SOURCES.md` | `apps/worker/src/civic/**`, `src/pipeline/travel-times.ts` |
| Database | — | — | `db/seed/manual.csv` | **owns** `db/migrations/**`, `db/seed/benchmarks.json` |
| Infra | — | — | — | **owns** `docker-compose.yml`, `Caddyfile`, `deploy.sh`, `otp/**`, `DEPLOY.md` |
| Docs | | | | `DEVPOST.md` |

**Shared files** (edit rarely, in small separate commits, always pull first):
- `package.json` files / `pnpm-lock.yaml`: add dependencies in their own commit. On a lockfile conflict: take `main`'s version, run `pnpm install`, commit.
- `apps/web/messages/en.json`: add keys only under your own top-level namespaces. A: `layout`, `landing`, `search`, `filters`, `results`, `listing`, `areas`, `compare`. B: `errors`, `explain`, `import`. C: `caveats`, `valuation`. D: `travel`, `safety`, `data`, `status`, `election`. Anyone may add (never rename) keys under `common`.
- `apps/web/src/lib/store/store.ts`: only combines slices; A owns it.
- `.env.example`: add lines only.
- New SQL: ask D for a migration (or write it in your branch and have D review); never edit a merged migration.

If you need a change in someone else's area, **don't make it**. Write it under "Requests to others" in your own `PERSON_X.md` and tell that person.

---

## 3. Contracts (agree and merge by S1)

These interfaces let four people build in parallel against the same shapes. Change them only by agreement, in one small commit, with a SPEC Change log line tagged `[A]`, `[B]`, `[C]` or `[D]`.

1. **Schemas** (B, `packages/shared/schemas/`): `SearchIntent` (criteria as `Pref<T>`, `TravelTarget`, safety, weights), `Listing`, `Valuation` (with `priceLabel`), `MatchScore` (five parts), `Caveat`, `Area`, `AreaIndicator`, travel-time row, API request/response bodies, as in SPEC 5 and 13.
2. **Fixtures** (B, `packages/shared/fixtures/`): 50 synthetic Toronto listings with every field kind (incl. unknowns), 3 areas, travel times with both methods, one search response, one detail response. Everyone builds against these until real data lands.
3. **Valuation** (C, `packages/shared/engine/valuation.ts`): `valuate(listing, comparables, benchmarks): Valuation` and `priceLabel(differencePct, confidence): PriceLabel | 'unknown'` (pure); SQL `selectComparables(db, listing)` in `apps/web/src/lib/db/valuation.ts`.
4. **Travel** (D): table `travel_times` (SPEC 5); `routeTimes(origins, targets, mode, budgetMs): TravelTimeRow[]` in `apps/web/src/lib/geo/route-times.ts` (never throws; returns `straight_line` rows when OTP fails or the budget runs out).
5. **Safety** (D, `packages/shared/engine/safety.ts`): `safetyFor(rates, cityRates): { rate, relativeRate, byType, years, caveats } | null` and `safetyScore(relativeRate): number`. Caveat text lives only here.
6. **Score** (B, `packages/shared/engine/score.ts`): `scoreListing(listing, intent, ctx: { valuation, travel, safety }): MatchScore` (pure).
7. **Caveats** (C, `packages/shared/engine/caveats.ts`): `caveats(listing, ctx): Caveat[]` (pure).
8. **Store** (A, `apps/web/src/lib/store/`): `searchSlice.ts` (intent, results, shortlist) and the **selection contract** `hoveredListingId: string | null`, `selectedListingId: string | null`, read and set by list, map and detail.
9. **API error format** (B, `apps/web/src/lib/api/`): `{ error: { code, message, issues?, retryAfterSeconds? } }`; every route uses `jsonRoute({ name, body, rateLimit }, handler)`.

---

## 4. Git workflow

- `main` must **always run and deploy** (D's deploy pulls `main`).
- Work on short branches named `a/P1.31-chips`, `c/P2.1-valuation`. Merge to `main` as soon as a task (or a small group) works: aim for **every 1–2 hours**.
- Before merging: `git pull --rebase origin main`, then `pnpm typecheck && pnpm lint && pnpm test`. Only merge when green.
- Commit messages: `P2.1 [C]: comparables and weighted median`. One task per commit where possible.
- Never force-push `main`. Never commit `.env*` (except `.env.example`), keys, `DATABASE_URL`, scraped snapshots or raw HTML. **The repo must be public for submission.**
- Submission rule: **everything merged into `main`** by the deadline.

---

## 5. Sync points (hours after kickoff)

Kickoff: ______ (fill in). Stop at each sync point, merge to `main`, pull, and check the deployed app together for 5–10 minutes. Whoever runs the sync (default D) copies ticks into `PROGRESS.md`.

| When | A has merged | B has merged | C has merged | D has merged | Together |
| --- | --- | --- | --- | --- | --- |
| **S1 · H3** | scaffold, tokens, store + selection contract, static landing | schemas, fixtures, API conventions + stub routes | worker skeleton, adapter interface, `SOURCES.md` go/no-go | TigerData + migrations, Vultr placeholder live, dataset links checked | confirm the contracts in section 3 |
| **S2 · H12** | landing → chips, filters panel, results list + map on fixtures | Gemini provider, parse route + fallback, place resolution | 2 adapters, normalize, scrub, geocode; ≥ 300 listings | boundaries, Address Points, POIs, GTFS stops, RentSafeTO; OTP graph running | type a demo prompt: chips appear; real listings on the map |
| **S3 · H18** | live results, listing detail (rent check, home, getting around, building, area card) | candidate query, score (5 parts), two-pass search | valuation, price labels, dedupe | travel precompute running, `routeTimes()`, safety, indicators, benchmarks | the demo prompt returns real ranked listings with consistent breakdowns |
| **S4 · H24** | explorer, ward page, paste-a-listing, safety UI, shortlist | explain, import, briefings (25 cached), demo AI outputs | ≥ 1,500 listings, caveats, schedule, `manual.csv` | explorer API, rent aggregate, affordability, `/data`, `/status` | **run SPEC 23 end to end on the deployed app** |
| **S5 · H30** | P1 items that are done | P1 items that are done | P1 items; **final ingest → snapshot** | full travel precompute starts on the snapshot | **feature freeze**: bugs, polish and pitch only after this |
| **End · H36** | accessibility + mobile pass | `AI_PROVIDER=none` check | source error states | final deploy, Devpost | rehearse ×3, record video, submit |

If you're behind at a sync point, drop **Stretch** tasks first (marked in each person's file), never Core ones. If OTP isn't working by S3, D says so at the sync and travel falls back to labelled straight-line distance for the demo.

---

## 6. Overrides to CLAUDE.md in team mode

- **Progress:** track progress only in your own `PERSON_X.md` (tick tasks, Current state, Handoff notes, Requests, Feature map rows). **Don't edit `PROGRESS.md`** or anyone else's file during the build, except the sync runner copying ticks at a sync point. Task ids are shared.
- **Phases:** don't stop at the end of each SPEC phase. Work through your own task list in order and stop at the **sync points** above (and whenever blocked).
- **Spec changes:** allowed only for your own areas or agreed contracts; add a Change log line tagged with your letter.
- **Ownership:** never edit others' folders (section 2). Use "Requests to others".
- Everything else in `CLAUDE.md` still applies.

---

## 7. Keys and accounts

Share privately (not in the repo, not in chat logs you'll publish): Gemini API key, MapTiler key, `DATABASE_URL`, Vultr access. Each person puts what they need in their own `.env.local`. D sets them on the Vultr instance once.

| Account | Who sets it up | Who needs access |
| --- | --- | --- |
| GitHub repo (public at submission) | A | everyone |
| Tiger Cloud (TigerData) | D | everyone (read/write `DATABASE_URL`) |
| Vultr | D | D (others via `deploy.sh`) |
| Gemini API (Google AI Studio) | B | B, C (P4.10), the instance |
| MapTiler | A | A, B (geocoding fallback), the instance |
| Devpost team | D | everyone listed |

Rotate the Gemini key after the hackathon if it was ever pasted anywhere shared.
