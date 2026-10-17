# SOURCES.md — listing sources: go / no-go

Owner: **C** (P0.12). Fill this in **before** writing any adapter, and keep it current. Only sources marked **go** may appear in `INGEST_SOURCES`. Rules every adapter follows are in `SPEC.md` 8.4; this file records what each site allows.

How to check a source:
1. Open `https://<site>/robots.txt`; note whether the rental search and listing paths are disallowed for all agents or for unknown bots.
2. Read the site's terms of use for automated access, scraping, crawling or data mining; quote the clause number (not the text) and paraphrase it.
3. Note whether listings are behind a login or a bot wall (CAPTCHA, JS challenge). Behind a login → **no-go**, always.
4. Decide: **go** (allowed and reachable), **no-go** (forbidden, login-walled or blocked), or **ask** (unclear; tell the team, don't collect until decided).

| Source | robots.txt (date checked) | Terms on automated access | Login / bot wall | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| Kijiji (Toronto long-term rentals) | | | | | |
| Rentals.ca | | | | | |
| Zillow (Toronto rentals) | | | | | |
| Realtor.ca (rentals) | | | | | |
| Facebook Marketplace / groups | n/a | Meta's terms prohibit automated collection | login required | **no-go** | Covered by "Paste a listing" (SPEC 10.3) |
| `manual` (hand-curated CSV) | n/a | n/a | n/a | **go** | `db/seed/manual.csv`, demo backup |

## Fallback plan

If fewer than two sources are **go**: rely on `manual.csv` (aim for 150+ hand-entered real listings with source links, split across the team if needed) plus pasted listings, and say so plainly in the UI and the pitch. Comparables need ≥ 5 similar listings nearby, so concentrate manual entries in the demo neighbourhoods (Annex / UofT, York U area, Scarborough).

## Health log

Record repeated 403/429s, layout changes that broke a parser, and when a source was paused.

| Date / time | Source | What happened | Action |
| --- | --- | --- | --- |
| | | | |
