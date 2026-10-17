# CLAUDE.md

Project: **RentThe6ix** — AI-assisted rental search and neighbourhood context for Toronto (Hack the Valley; School of Cities, Gemini, Vultr and TigerData tracks).

## Project memory files

Context is reset often. These files are the project's memory; keep them accurate.

| File | Purpose | How to update |
| --- | --- | --- |
| `SPEC.md` | What to build. | Edit it when a decision changes or clarifies the spec, and add a one-line entry to its **Change log** (section 27). Never make large rewrites without the human's approval. |
| `TEAM.md` | How four people build at once: ownership, contracts, git workflow, sync points. | Change only by team agreement. |
| `PERSON_X.md` | Your own state: current task, handoff notes, requests, task list, feature map. | Update after **every** completed task. |
| `PROGRESS.md` | Master task list with shared ids, data status, environment. | In team mode, only at sync points (see `TEAM.md` section 6). |

Git history (one commit per task) is the record of what was done.

## Session start protocol (do this first, every session)

1. `git pull --rebase origin main`.
2. Read `TEAM.md`, then your own `PERSON_X.md` fully, including "Handoff notes" and "Requests".
3. Read only the `SPEC.md` sections for your next tasks, plus its Change log (don't reread the whole spec each session).
4. Run `git status` and `git log --oneline -10` to confirm the code matches your `PERSON_X.md`. If they disagree, trust the code, fix your file, and mention it.
5. State in one or two lines: current task, what you'll do next. Then start.

## During work

- Work on **one task id at a time** (e.g. `P2.4`). Mark it `[~]` in your `PERSON_X.md` when starting.
- When a task is done: verify it (run it, test it, look at it on screen), mark it `[x]`, update "Current state" and your **Feature map**, then commit.
- Commit message format: `P2.4 [C]: short description`. Small, frequent commits.
- A choice that changes or clarifies the spec → edit `SPEC.md` in place and add a Change log line (`YYYY-MM-DD P2.4 [C]: what changed and why`).
- Bugs you can't fix now → "Handoff notes" in your file (and "Known issues" in `PROGRESS.md` at the next sync).
- Blocked (missing key, account, unclear requirement, waiting on a teammate) → mark `[!]`, write the blocker in "Current state", and ask the human.
- Stop at **sync points** (`TEAM.md` section 5), not at phase ends. Continuing to your next task is fine.

## Session end protocol (before stopping or when context is getting long)

1. Make sure the app builds; run `pnpm typecheck`, `pnpm lint`, `pnpm test` (at least for touched packages).
2. Commit all work (WIP commits are fine: `P1.3 [C]: WIP normalize year built`).
3. Update your `PERSON_X.md` "Current state" and "Handoff notes" so a fresh session knows exactly what to do next. For an unfinished task, say precisely where it stopped (file, function, what's left).
4. Reply with a 3–5 line summary.

## General

- Check current official docs for library APIs (Next.js, MapLibre, Gemini API, TigerData/TimescaleDB, PostGIS, OpenTripPlanner 2, Playwright) instead of relying on memory. Gemini model names come from env vars; don't hard-code them.
- If the spec is ambiguous, choose the simplest reasonable option, update `SPEC.md`, and log it in the Change log.
- Keep `main` runnable and deployable after every merge.

## Non-negotiable rules

- **AI interprets, code calculates.** Gemini never produces or alters a number the user sees. Filters, rent estimates, price labels, travel times, safety rates, scores and rankings come from the engine in `packages/shared/engine` and SQL. AI text that mentions numbers passes a number check against its input, else it's regenerated once, else a template is used.
- The engine is pure TypeScript: no React, no fetch, no database, no `Math.random`. It must be unit-tested, and the score breakdown must always add up to the total.
- **Every figure is traceable**: valuations list their comparables and adjustments; travel times say mode and method (`otp` or `straight_line`); indicators carry source, period and sample size.
- **Honest labels:** straight-line distance is never shown as minutes; driving times say "no traffic"; asking rents are never called signed-lease rents; unknown is never treated as "no"; thin data shows "Not enough data".
- **Safety is opt-in**, uses only TPS neighbourhood rates relative to the city, always shows its caveats, and never says "safe", "unsafe", "dangerous" or anything about residents (SPEC 7.6).
- **Civic, not partisan:** no content about candidates or parties, no predictions, no AI-written election content; the election box is static official links (SPEC 9.3).
- All AI calls go through the provider interface in `apps/web/src/lib/ai` (never import a vendor SDK in feature code). AI output is validated with zod; every AI feature has a deterministic fallback, including when rate-limited (429/503).
- **Listing text is untrusted.** It goes into prompts only inside delimited data blocks, with instructions to ignore anything it says; it's sanitized before rendering.
- **Listing collection rules** (SPEC 8.4–8.5): public pages only, never log in, honour robots.txt and rate limits, identify with `USER_AGENT`, no photos stored, contact details scrubbed, Facebook never scraped. Scraped snapshots and raw HTML are git-ignored.
- **No user accounts and no user data on the server.** Shortlists and pasted listings live in the browser; pasted listings are never stored server-side.
- API keys and `DATABASE_URL` are server-only. Never import them into client components, never commit them; the repo is public for submission.
- Validate every API route body with zod. Rate-limit AI, import and geo routes. Pasted URLs: public http(s) only, private IPs blocked, 5 s timeout, 2 MB cap.
- Civic and public data are loaded by scripts into TigerData with source URL, retrieval date and licence recorded; show them on `/data`.
- User-facing strings go in `apps/web/messages/en.json` (English only). Metric units, CAD, `en-CA` formatting via `Intl`.

## Conventions

- pnpm workspaces: `apps/web`, `apps/worker`, `packages/shared`. TypeScript strict, no `any` in engine code.
- Shared schemas in `packages/shared/schemas`; infer types with `z.infer`.
- SQL migrations in `db/migrations` (numbered, never edited after merge; add a new one instead).
- Tailwind + shadcn/ui; Public Sans with tabular numerals for figures. Mobile-first.
- Name things by what renters understand ("Underpriced", "Getting around", "Paste a listing"), not internal terms.
- If the Next.js scaffold created `AGENTS.md`, read it before using Next.js APIs.
