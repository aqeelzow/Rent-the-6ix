# PERSON_A.md — Frontend & map

**Role:** everything the renter sees and touches: app scaffold and layout, landing, prompt → chips, the filters panel, results list and map, listing detail, the neighbourhood & ward explorer, paste-a-listing, the safety switch and its caveats, shortlist and compare, accessibility and mobile.
**Owns:** see `TEAM.md` section 2 (folders) and `SPEC.md` 22.1 (roles). **Contracts you provide:** the monorepo scaffold, `searchSlice.ts` (current intent, results, shortlist), the selection contract (hovered/selected listing shared by list, map and detail), reusable UI components.
Task ids match `PROGRESS.md`; task details are in `SPEC.md`.

## Current state

- **Current task:** P2.35 live results, then the listing detail page (P2.30–P2.36)
- **Status:** in progress
- **Branch:** `a/P2.30-listing-detail` (P1.30–P1.35 merged to `main` via PR #7)
- **Next action:** P2.35: cap the live list (top 50, "Show more"), a clear long-wait state, and recovery from 503s. Then the detail page: render from the search result in the store, and add `GET /api/listings/[id]?intent=…` extras (areas, indicators, duplicates, all travel rows) when they arrive.
- **Blockers / needs from others:** see "Depends on others". Nothing blocks starting; travel, building, area and benchmark sections show "not available yet" until D delivers.
- **Last updated:** 2026-10-17

## Handoff notes

> Where an unfinished task stopped, gotchas, things to verify. Replace each session.

**Session 2026-10-17 (P1.34 map):**
- **MapLibre 6 is ESM-only and loads its worker by URL.** `scripts/copy-maplibre-worker.mjs` copies the worker and shared chunk into `public/maplibre/` before `next dev` and `next build` (git-ignored). `ResultsMap` calls `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`. A `vercel build` from the repo root ships `static/maplibre/`.
- **Load MapLibre inside an effect** (`import("maplibre-gl")`); it touches `window`. **Size the container, don't position it**: `.maplibregl-map` forces `position: relative`, which collapsed an `absolute inset-0` container to nothing.
- MapLibre can't parse `oklch()`; band colours are hex in `map-data.ts` (shades of the accent).
- In development the map is on `window.__resultsMap` for browser tests (pin positions via `project()`).

**Session 2026-10-17 (P1.30):**
- **Search flow:** the landing `PromptBox` (next/form) GETs `/search?q=…`. `SearchView` calls `parseAndSearch(prompt)` from `src/lib/store/actions.ts` unless the store already holds that prompt's intent, so back/forward keeps edits. `runSearch()` re-searches with the current intent (for chip and filter edits) and polls B's `pending` jobs until done or expired. Responses are validated with B's zod schemas, and contract drift shows as an `unexpected_response` error.
- **Dev double effects:** React runs effects twice in development; `parseAndSearch` skips a prompt that's already being read (`parsingPrompt`). Stale responses are dropped by request id.
- **Format only your own files:** run `pnpm exec prettier --write <your paths>`. B's code isn't Prettier-formatted, and `pnpm format` rewrites it.
- **`pnpm test` and `pnpm lint` are green on `main`.** Running `vitest run` without `--passWithNoTests` still shows B's `node:test` files and D's `server-only.test.ts` as "No test suite found"; the repo script hides that (see Requests). `pnpm format:check` fails on about 31 of B's, C's and D's files, not ours.
- B's `SearchResult` has no top-level `id`; use `result.listing.id`.

**Session 2026-10-16 (P0 foundation):**
- **Next.js 16.4 differs from older versions.** Read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` before using Next APIs. `params`/`searchParams` are Promises; use the global `PageProps<"/route">` / `LayoutProps<"/">` types. Cache Components is off (SPEC change log P0.1).
- **pnpm is pinned to 10.34.7** (`packageManager`) because Vercel's pnpm 9/10 can't read a pnpm 12 lockfile. A global pnpm 12 hands off to 10.34.7 automatically; never commit a lockfile that starts with a `---` document (that's the pnpm 11+ format). If a global pnpm 12 is installed without `--allow-scripts=pnpm`, it stays a shell stub and the shadcn CLI fails with `spawn ENOEXEC`.
- **Vercel** (`az-e48c/rent-the-6ix`) builds from the repo root with the "Other" preset. The root `vercel.json` forces the Next.js preset and points at `apps/web/.next`, and `next` is a root devDependency only so Vercel's Next.js builder detects it. If the Root Directory is ever set to `apps/web`, `apps/web/vercel.json` covers that case. Reproduce a Vercel build locally with `npx vercel build` after writing a `.vercel/project.json` with the project's settings (`.vercel/` is git-ignored).
- **shadcn:** run `pnpm dlx shadcn@4.21.0 add <name>` from `apps/web` (Radix base, nova preset). `cn` comes from the `cn` package. Already added: badge, button, card, checkbox, dialog, drawer, input, label, popover, scroll-area, select, separator, sheet, skeleton, slider, switch, tabs, textarea, toggle, toggle-group, tooltip.
- **Strings:** `t("ns.key", params?)` from `@/lib/format/messages` is typed against `messages/en.json`. A dynamic key needs `as MessageKey`.
- **Store types are placeholders** (`src/lib/store/types.ts`). Swap them to B's schema types as soon as P0.5 lands.
- **Footer is on every page** (root layout). The full-height list + map on `/search` may need a route group without the footer (P1.33–P1.34).
- **Screenshots at 375 px:** Playwright with `channel: "chrome"` works. Headless Chrome's `--window-size` can't go below about 500 px, so don't use it for mobile checks.
- **To fix at P5.3:** the shadcn Sheet/Dialog close buttons have a hard-coded sr-only "Close"; move it to `common.close`.

- **Labels are part of the contract, not decoration.** Every travel figure shows its mode and method: "14 min TTC (weekday 8:30 am)", "8 min driving, no traffic", or "1.1 km straight-line" when OTP didn't return a time. Never show minutes for a straight-line fallback (SPEC 7.4).
- **Price badge** reads "Underpriced" / "Reasonably priced" / "Overpriced" / "Not enough data", always with the number under it and "compared with asking rents for similar listings, not signed leases" on tap (SPEC 7.2).
- **Safety** is off by default. When on, show the rate as "0.7× city rate (TPS 2023–2025)", never "safe/unsafe", no red/green safety colours on the results map, and the caveats one tap away (SPEC 7.6). Agree the exact wording with B and D before the demo.
- **Unknown is not "no".** Unknown fields show as "not stated"; a must-have the listing doesn't confirm shows a "not confirmed" note on the card, plus the "Hide listings that don't confirm my must-haves" toggle (SPEC 7.1).
- **Chips:** must-have solid, preference outlined, default dashed; each has the source phrase on hover/tap and a must-have ⇄ preference switch. Editing a chip or the filters panel re-runs search **without** calling Gemini.
- **Score bars must add up to the total** (effective weights from `MatchScore.parts`); null parts are hidden, not shown as zero.
- Approximate locations (`locationPrecision` street/area) are circles on the map, not pins.
- Mobile-first: most renters search on a phone. Check every screen at 375 px before calling it done.
- Election box on the ward page is static content, no AI: date (Mon Oct 26, 2026), advance voting, official candidate list and where-to-vote links; switches to the results link after election day.

## Requests to others

- **To B:** fixtures by S1 that include sizes, years built, AC, all five score parts (some `null`), price labels of each kind, travel times with both `otp` and `straight_line` methods, and one listing with safety on.
- **To D:** the `/status` and `/data` content as data (JSON from routes); I build the pages.
- **To D:** `DEPLOY.md` step 2 still says `cp .env.example .env`, but `.env.example` is no longer in the repo; point it at SPEC 20 instead. Vercel builds from the repo root via the root `vercel.json` (see Handoff notes).
- **To B:** (1) `apps/web/src/lib/{api,parse,db}/*.test.ts` use `node:test`. They run inside Vitest but only pass because of `--passWithNoTests`, so a failing assertion there can't fail `pnpm test`. Switch the import to `import { test } from "vitest"`; `node:assert` still works. (2) ~~lint `any`s~~ fixed on `main`. (3) B's files aren't Prettier-formatted, so `pnpm format:check` fails; run `pnpm exec prettier --write` on your paths. (4) In-memory search jobs need one server process; on Vercel, polls may land on another instance and get 410. (5) The parse `notice` is hard-coded English on the server; move it to `en.json` (`errors` namespace) if you want it translatable.
- **To B (from P1.33):** (6) The fallback parser turns "within 25 minutes by transit to UofT St. George" into two targets, "UofT St. George" and "UofT St" (it splits on the period). (7) `matchScore.hardFilterNotes` use internal names ("unitTypes: not confirmed"); please send plain words ("Type of place: not confirmed") or a field code I can translate. (8) Search results carry no neighbourhood name and no duplicates, so cards can't show the neighbourhood or "Also on: Kijiji" yet. Add `neighbourhoodName` and `alsoOn: source[]` to `SearchResult`, or tell me where to get them.
- **To D:** `apps/web/src/lib/server-only.test.ts` is a stub, but its `.test.ts` name makes Vitest collect it as an empty test file (hidden by `--passWithNoTests`). Rename it, e.g. `server-only.stub.ts`, and update the alias in `vitest.config.ts`. The `/status` page you built is in A's area; fine to keep, just tell me before changing its layout.
- **To C:** one or two real listings with full fields early (any source) so the detail page can be checked against reality, not just fixtures.

---

## Task list (in order)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped. **Core** = needed for the demo. **Stretch** = drop first if behind.

### Before S1 (H0–H3) — Foundation · Core
- [x] P0.1 Monorepo scaffold: pnpm workspaces (`apps/web`, `apps/worker`, `packages/shared`), Next.js App Router, TypeScript strict — **merge first, everyone waits on it**
- [x] P0.2 Tailwind + shadcn/ui + Public Sans + design tokens (light; dark if time), tabular numerals utility
- [x] P0.3 Zustand, Vitest, ESLint, Prettier; root scripts `typecheck`, `lint`, `test`
- [x] P0.10 Layout shell, static landing page; check the starter `README.md` and `.env.example` still match the scaffold
- [x] P0.13 `searchSlice.ts` (intent, results, shortlist) + selection contract (`hoveredListingId`, `selectedListingId`) — merge early

### S1 → S2 (H3–H12) — Search UI on fixtures · Core
- [x] P1.30 Landing: prompt box, 3 example chips (student, couple, family), "Explore neighbourhoods", "Paste a listing"; calls B's `/api/search/parse` (fixture until live)
- [x] P1.31 Filter chips: must-have/preference/default styles, source phrase, must-have ⇄ preference switch, remove, "dropped requests" notice
- [x] P1.32 Filters panel (SPEC 11.2): Price (range, price vs market), Home (rooms, size, unit type, building age, AC, pets, furnished, parking, laundry, utilities, availability, lease), Getting around (add place or amenity, mode, minutes), Safety (switch + explanation), Area; each with must-have/preference
- [x] P1.33 Results cards (SPEC 11.2): price badge, segmented score bar, travel targets with mode icon, size/year/AC, top caveat, source + freshness, "Also on", shortlist button
- [x] P1.34 Results map (MapLibre): clustered pins coloured by score band, approximate circles, place pins, synced hover/select with the list
- [x] P1.35 Mobile: list with sticky Map toggle, bottom sheet on pin tap, filters as a sheet

### S2 → S3 (H10–H18) — Live search & detail · Core
- [~] P2.35 Wire results to B's live `/api/listings/search`; loading, empty and error states
- [ ] P2.30 Listing detail page layout and header (rent, beds/baths, address or area, source button, freshness, data status)
- [ ] P2.31 Rent check: price label, estimate, range, difference, confidence, comparables table + mini map, adjustments, benchmark
- [ ] P2.33 The home: size, year built + source, AC, other fields, unknowns marked
- [ ] P2.32 Getting around: each target with the amenity/place reached and its time by transit, car, walk and bike, chosen mode highlighted, method labels
- [ ] P2.34 Building (RentSafeTO score, date, sign colour, explanation or "not in program") + area card (SPEC 9.1)
- [ ] P2.36 "Why it ranks here": score breakdown bars with evidence + slot for B's explanation

### S3 → S4 (H16–H24) — Civic layer & flows · Core
- [ ] P3.20 Explorer `/areas`: choropleth (158 neighbourhoods / 25 wards), one indicator at a time, quantile legend with city value, area side panel with sources
- [ ] P3.21 Ward page: B's briefing, the indicator table it was written from, election info box
- [ ] P3.22 Paste a listing: text or URL input, B's import route, scored result card, fallback form when extraction is partial
- [ ] P3.23 Safety UI: switch in filters and on results, rate on cards and detail, caveats sheet ("How this works")
- [ ] P3.24 Shortlist in `localStorage` (try/catch), "Clear my data", share search as URL

### S4 → S5 (H22–H30) — P1 · Stretch
- [ ] P4.20 Compare page (up to 4 listings, SPEC 11.5)
- [ ] P4.21 True monthly cost UI (rent-to-income, rent + utilities + transport) and its sort
- [ ] P4.22 Route lines on the map for the selected listing's targets
- [ ] P4.24 Weight sliders UI (B provides the scoring)
- [ ] P4.23 Mobile polish pass on detail and explorer

### S5 → end (H30–H36) — Polish
- [ ] P5.3 Accessibility pass: keyboard, focus, contrast, labels, alt text, colour never the only signal
- [ ] P5.4 Mobile pass at 375 px on every screen
- [ ] P5.5a Empty, loading and error states in your areas
- [ ] P5.7 Rehearse the demo walkthrough (SPEC 23) ×3 with everyone; drive the screen

---

## Depends on others

Status checked 2026-10-17 against `main` at `147c74b`.

| From | What A needs | For | Status |
| --- | --- | --- | --- |
| B | `POST /api/listings/search` on live data | P2.35 | ✅ live (PR #12/#13), but 77–147 s for a broad search and ~3.5 MB for 500 results; B is working on scan performance |
| B | `GET /api/listings/[id]?intent=…` for live listings | P2.30–P2.36 | ✅ live (~1.6 s); areas, indicators and duplicates come back empty until D's data lands |
| B | `/api/listings/[id]/explain` | P2.36 explanation slot | ⏳ not started (P3.1) |
| B | `/api/listings/import` + `/api/listings/score` | P3.22 paste a listing | ⏳ not started (P3.2) |
| B | `/api/areas/[kind]/[id]/briefing` | P3.21 ward page | ⏳ not started (P3.3) |
| B | Neighbourhood name and duplicate sources in `SearchResult` | card neighbourhood, "Also on" | ⏳ requested |
| C | Valuation with comparables, adjustments, confidence | P2.31 rent check | ✅ live (in search results and `/api/listings/[id]/valuation`) |
| C | Comparable coordinates | P2.31 mini map | ⏳ not in `Valuation.comparables` (only id, rent, distance); to request |
| D | Benchmarks (StatCan, CMHC) | P2.31 benchmark line | ⏳ P2.15 not started (`benchmark` is null) |
| D | `POST /api/listings/[id]/travel` + OTP times | P2.32 getting around (4 modes) | ⏳ P2.12/P1.15 not started; only one straight-line row per target today |
| D | RentSafeTO buildings | P2.34 building | ⏳ P1.14 not started; no building in the detail response |
| D | Area indicators | P2.34 area card | ⏳ P2.14 not started |
| D | `safetyFor()` + caveat text | P3.23 safety UI | ⏳ P2.13 not started |
| D | Explorer API (`/api/areas…`), boundaries | P3.20 explorer | ⏳ P3.10/P1.10 not started |
| D | Affordability engine | P4.21 true monthly cost | ⏳ P3.12 not started |
| D | `/status` and `/data` content as JSON | `/data` page | ⏳ P3.13/P3.14 not started (D built `/status` itself) |
| D | OTP route geometry | P4.22 route lines | ⏳ depends on OTP (Vultr access) |

## Feature map (your files)

| Feature | Key files | Notes |
| --- | --- | --- |
| Layout shell, tokens | `apps/web/src/app/layout.tsx`, `src/app/globals.css`, `src/components/ui/*` | shadcn (Radix base, nova preset); tokens `price-*`, `caveat-*`, `score-*`; `figures` utility for numbers; light only |
| Store | `apps/web/src/lib/store/searchSlice.ts` (+ test), `store.ts`, `types.ts` | intent, parse info, results, eligibleCount, notices, hideUnconfirmed, shortlist, selection; types re-exported from B's schemas |
| Layout shell | `src/components/layout/*` (header, mobile menu, footer, page placeholder) | nav links in `nav-links.ts` |
| Strings | `apps/web/messages/en.json`, `src/lib/format/messages.ts` (+ test) | typed `t("ns.key", params?)` |
| Landing | `src/app/page.tsx`, `src/components/search/prompt-box.tsx` | next/form GET to `/search?q=`; Enter submits, Shift+Enter adds a line |
| Search flow | `src/app/search/page.tsx`, `src/components/search/search-view.tsx`, `src/lib/store/actions.ts` (+ test) | parse → search → poll; states: parsing, searching, error + retry, ready; interim result rows until P1.33 |
| Number formats | `src/lib/format/number.ts` (+ test) | `formatCad`, `formatCount` (en-CA) |
| Chips & filters | `src/components/search/chips.ts` (+ test), `filter-chips.tsx`, `filters.ts` (+ test), `filter-fields.tsx`, `filters-panel.tsx`, `sort-select.tsx` | `buildChips(intent)`, `setChipHard`, `removeChip`, `setTargetModes`, `setTargetMinutes`; edits keep the intent valid under B's schema and never call the parser |
| Results | `src/app/search/page.tsx`, `src/components/search/search-view.tsx` (layout, mobile toggle, bottom card), `src/components/results/` (`card-data.ts` + test, `result-card.tsx`, `price-badge.tsx`, `score-bar.tsx`), `src/components/mode-icons.ts`, `src/components/use-media-query.ts`, `src/components/map/` (`map-data.ts` + test, `results-map.tsx`), `apps/web/scripts/copy-maplibre-worker.mjs` | card helpers enforce honest labels; the card is a stretched link to `/listing/[id]` (placeholder until P2.30) |
| Listing detail | `src/app/listing/[id]/page.tsx`, `src/components/listing/*` | |
| Explorer | `src/app/areas/*`, `src/components/areas/*` | |
| Paste a listing | `src/components/listing/paste-listing.tsx` | |
| Compare | `src/app/compare/page.tsx` | P1 |

## Environment

- **Deployed URL:** (record when D's placeholder is live)
- **Env vars you need locally:** `NEXT_PUBLIC_MAPTILER_KEY` (map works without it on OpenFreeMap).
