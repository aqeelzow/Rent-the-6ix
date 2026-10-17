# PERSON_A.md — Frontend & map

**Role:** everything the renter sees and touches: app scaffold and layout, landing, prompt → chips, the filters panel, results list and map, listing detail, the neighbourhood & ward explorer, paste-a-listing, the safety switch and its caveats, shortlist and compare, accessibility and mobile.
**Owns:** see `TEAM.md` section 2 (folders) and `SPEC.md` 22.1 (roles). **Contracts you provide:** the monorepo scaffold, `searchSlice.ts` (current intent, results, shortlist), the selection contract (hovered/selected listing shared by list, map and detail), reusable UI components.
Task ids match `PROGRESS.md`; task details are in `SPEC.md`.

## Current state

- **Current task:** P0.10 Layout shell, static landing, README/.env.example check
- **Status:** in progress
- **Branch:** `a/P0-foundation` (P0.1–P0.13, one commit per task; not pushed yet)
- **Next action:** P0.10, then P0.13; merge to `main` at S1.
- **Blockers / needs from others:** none yet. Build against B's fixtures (P0.6) until live routes land.
- **Last updated:** 2026-10-16 (P0.1 done: pnpm workspace, Next 16.4 in `apps/web`, `packages/shared` and `apps/worker` skeletons; `pnpm typecheck` and `pnpm build` pass. P0.2 done: shadcn + Public Sans + tokens, checked at 375 px. P0.3 done: Zustand, Vitest per package, ESLint with engine-purity rules, Prettier; root `typecheck`/`lint`/`test`/`format` green)

## Handoff notes

> Where an unfinished task stopped, gotchas, things to verify. Replace each session.

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
- **To C:** one or two real listings with full fields early (any source) so the detail page can be checked against reality, not just fixtures.

---

## Task list (in order)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped. **Core** = needed for the demo. **Stretch** = drop first if behind.

### Before S1 (H0–H3) — Foundation · Core
- [x] P0.1 Monorepo scaffold: pnpm workspaces (`apps/web`, `apps/worker`, `packages/shared`), Next.js App Router, TypeScript strict — **merge first, everyone waits on it**
- [x] P0.2 Tailwind + shadcn/ui + Public Sans + design tokens (light; dark if time), tabular numerals utility
- [x] P0.3 Zustand, Vitest, ESLint, Prettier; root scripts `typecheck`, `lint`, `test`
- [~] P0.10 Layout shell, static landing page; check the starter `README.md` and `.env.example` still match the scaffold
- [ ] P0.13 `searchSlice.ts` (intent, results, shortlist) + selection contract (`hoveredListingId`, `selectedListingId`) — merge early

### S1 → S2 (H3–H12) — Search UI on fixtures · Core
- [ ] P1.30 Landing: prompt box, 3 example chips (student, couple, family), "Explore neighbourhoods", "Paste a listing"; calls B's `/api/search/parse` (fixture until live)
- [ ] P1.31 Filter chips: must-have/preference/default styles, source phrase, must-have ⇄ preference switch, remove, "dropped requests" notice
- [ ] P1.32 Filters panel (SPEC 11.2): Price (range, price vs market), Home (rooms, size, unit type, building age, AC, pets, furnished, parking, laundry, utilities, availability, lease), Getting around (add place or amenity, mode, minutes), Safety (switch + explanation), Area; each with must-have/preference
- [ ] P1.33 Results cards (SPEC 11.2): price badge, segmented score bar, travel targets with mode icon, size/year/AC, top caveat, source + freshness, "Also on", shortlist button
- [ ] P1.34 Results map (MapLibre): clustered pins coloured by score band, approximate circles, place pins, synced hover/select with the list
- [ ] P1.35 Mobile: list with sticky Map toggle, bottom sheet on pin tap, filters as a sheet

### S2 → S3 (H10–H18) — Live search & detail · Core
- [ ] P2.35 Wire results to B's live `/api/listings/search`; loading, empty and error states
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

- **B:** schemas and fixtures (S1); parse route (S2); search, detail and explain routes (S3); import and briefing routes (S4).
- **C:** valuation route and real listings (S3).
- **D:** travel and safety routes (S3); area/explorer API and `/status` + `/data` data (S4); deployment pipeline (S1).

## Feature map (your files)

| Feature | Key files | Notes |
| --- | --- | --- |
| Layout shell, tokens | `apps/web/src/app/layout.tsx`, `src/app/globals.css`, `src/components/ui/*` | shadcn (Radix base, nova preset); tokens `price-*`, `caveat-*`, `score-*`; `figures` utility for numbers; light only |
| Store | `apps/web/src/lib/store/searchSlice.ts` (+ test) | intent, results, shortlist, selection |
| Landing | `src/app/page.tsx`, `src/components/search/prompt-box.tsx` | |
| Chips & filters | `src/components/search/filter-chips.tsx`, `filters-panel.tsx` | no Gemini call on edit |
| Results | `src/app/search/page.tsx`, `src/components/results/*`, `src/components/map/results-map.tsx` | |
| Listing detail | `src/app/listing/[id]/page.tsx`, `src/components/listing/*` | |
| Explorer | `src/app/areas/*`, `src/components/areas/*` | |
| Paste a listing | `src/components/listing/paste-listing.tsx` | |
| Compare | `src/app/compare/page.tsx` | P1 |

## Environment

- **Deployed URL:** (record when D's placeholder is live)
- **Env vars you need locally:** `NEXT_PUBLIC_MAPTILER_KEY` (map works without it on OpenFreeMap).
