# RentThe6ix

**Find the best-fit, best-value rental in Toronto, and see the neighbourhood around it.**

Describe what you need in plain English ("2-bed near UofT under $2,800, cat-friendly, 10 min walk to a supermarket, with AC"). RentThe6ix turns it into filters you can edit, searches listings gathered from several rental sites, and ranks them on price vs market, travel time (transit, car, walk or bike), the home itself, and, if you turn it on, neighbourhood crime rates. Every listing comes with its neighbourhood and ward context from Toronto open data: typical rents, how renters there are doing, transit, the building's RentSafeTO inspection score, and what's being built nearby.

Built at **Hack the Valley** for the Hack the Valley × School of Cities civic track, with the Gemini, Vultr and TigerData tracks.

> Status: in development. See `PROGRESS.md`.

## How it works

- **Gemini** reads your request and turns it into structured filters, explains why a listing ranks where it does, reads listings you paste from Facebook groups, and writes neutral housing briefings for each ward. It never produces a number: every figure comes from the engine and the database.
- **TigerData** (PostgreSQL with PostGIS and TimescaleDB) stores listings, price history, travel times and Toronto civic data, and runs the spatial and comparable-rent queries.
- **Vultr** hosts the app, the listing collection worker, and OpenTripPlanner, which computes every travel time.
- **Toronto open data** and Statistics Canada, CMHC, TTC and Toronto Police data give each listing its context. Full list with links and licences: the `/data` page and `SPEC.md` section 8.

## Repo layout

```
apps/web          Next.js app (UI + API routes)
apps/worker       listing collection, civic data loaders, travel-time precompute
packages/shared   zod schemas, fixtures, the pure TypeScript engine
db/migrations     SQL migrations for TigerData
db/seed           benchmarks, manual backup listings
otp/              OpenTripPlanner config (graph is built on the server, not committed)
```

## Getting started

Requirements: Node 24+, pnpm 12 (`npm install -g --allow-scripts=pnpm pnpm`), access to the team's TigerData service. Docker only if you run the worker or OTP locally.

```bash
pnpm install
cp .env.example .env.local        # at the repo root; fill in keys (ask the team; never commit them)
pnpm db:migrate                   # apply db/migrations to DATABASE_URL
pnpm data:civic                   # load Toronto civic data (D)
pnpm dev                          # web app on http://localhost:3000
```

One `.env.local` at the repo root is shared by the web app (loaded in `apps/web/next.config.ts`), the worker and scripts (`node --env-file-if-exists=../../.env.local`).

The web app runs on fixtures from `packages/shared/fixtures` until the database has data. It also runs without AI (`AI_PROVIDER=none`), without a MapTiler key (OpenFreeMap basemap), and without OTP (travel falls back to labelled straight-line distance).

### Scripts (planned; keep this list in sync as they're built)

| Script | What it does | Owner |
| --- | --- | --- |
| `pnpm dev` / `build` / `start` | web app | A |
| `pnpm typecheck` / `lint` / `test` | all packages | A |
| `pnpm format` / `format:check` | Prettier over the repo (Markdown docs excluded) | A |
| `pnpm db:migrate` | apply SQL migrations | D |
| `pnpm data:civic` | load Toronto open data, POIs, RentSafeTO, crime rates, benchmarks | D |
| `pnpm ingest:once` | one listing collection run | C |
| `pnpm travel:precompute` | fill `travel_times` for active listings | D |
| `pnpm otp:build` | build the OpenTripPlanner graph | D |

## Team docs

- `SPEC.md`: what we're building and why (the master spec)
- `TEAM.md`: how the four of us work in parallel (ownership, contracts, sync points)
- `PERSON_A.md` … `PERSON_D.md`: each person's tasks and state
- `PROGRESS.md`: master task list and data status
- `CLAUDE.md`: rules for Claude Code sessions
- `DEPLOY.md`: Vultr + TigerData + OTP setup
- `DEVPOST.md`: submission draft

## Data and limits

Asking rents are not signed-lease rents. Travel times by car assume no traffic. Crime rates are neighbourhood averages of police-reported incidents and say nothing about a specific street, building or the people who live there. Listings link back to their original source; we don't store photos or contact details. See the `/data` page for every source, date and licence.
