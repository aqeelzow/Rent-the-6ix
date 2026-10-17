# SOURCES.md — listing sources: go / no-go

All adapters use plain Playwright (`src/lib/fetch.ts`): one page per source, `INGEST_REQUEST_DELAY_MS` between requests, `USER_AGENT`, retries on network errors and 5xx. A 401/403/429 or a bot-check page (Cloudflare, captcha) stops the source for that run and marks it `unhealthy`; we don't work around blocks.

Checked 2026-10-16 with `pnpm ingest:once --sources kijiji,torontorentals,rentals_ca,zillow,realtor_ca --pages 2`.

| Source | id | Status | How | Notes |
| --- | --- | --- | --- | --- |
| Kijiji (Toronto long-term rentals) | `kijiji` | **go** | search pages; `__NEXT_DATA__` Apollo state | 45/page, ~174 pages. Rent, beds, baths, address, coordinates 100%; size ~31%, AC ~39%, year built 0%. Description is the truncated search snippet. |
| torontorentals.com | `torontorentals` | **go** | search pages; `/graphql` results captured while the page loads | Rentals.ca network (same data as rentals.ca). ~4,000 buildings / ~7,000 floor plans, 10 buildings per page; one row per floor plan. Size ~99%, year built ~78%, no description, no AC. Building contact is never read. |
| Rentals.ca | `rentals_ca` | **no-go (blocked)** | same adapter as torontorentals | HTTP 403 Cloudflare "Just a moment..." on the first request. Its listings are covered by `torontorentals`. |
| Zillow (Toronto rentals) | `zillow` | **no-go (blocked)** | search pages; `__NEXT_DATA__` | HTTP 403 PerimeterX "Press & Hold" captcha. Parser written but **unverified** against a live page. |
| Realtor.ca (rentals) | `realtor_ca` | **no-go (blocked)** | map page; `PropertySearch_Post` response | HTTP 403 "Sorry, you have been blocked". Parser written but **unverified**. |
| Facebook Marketplace / groups | — | **no-go** | none | Needs a logged-in account and Meta's terms prohibit automated collection. Covered by Paste a listing (SPEC 10.3). |
| torontorentals.ca | — | n/a | | Domain doesn't resolve; the site is torontorentals.com. |
| manual | `manual` | go | `db/seed/manual.csv` | Demo backup (P3.33). |
