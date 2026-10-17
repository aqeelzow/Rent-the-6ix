# SOURCES.md — listing sources: go / no-go

All adapters use [CloakBrowser](https://github.com/CloakHQ/cloakbrowser) (stealth Chromium, driven through Playwright; `src/lib/fetch.ts`): one page per source, `INGEST_REQUEST_DELAY_MS` between requests, `USER_AGENT`, retries on network errors and 5xx. Kijiji, Zillow and Realtor.ca also fetch each new or changed listing's own page for the full description and amenities (`INGEST_MAX_DETAILS` per run; contact fields never read). A 401/403/429 or a bot-check page (Cloudflare, captcha) stops the source for that run and marks it `unhealthy` (no retries, captcha solving or proxies on top of CloakBrowser).

Checked 2026-10-16 with `pnpm ingest:once --sources kijiji,torontorentals,rentals_ca,zillow,realtor_ca --pages 2` (plain Playwright); rentals_ca, zillow and realtor_ca rechecked with CloakBrowser, `--pages 1`.

| Source | id | Status | How | Notes |
| --- | --- | --- | --- | --- |
| Kijiji (Toronto long-term rentals) | `kijiji` | **go** | search pages; `__NEXT_DATA__` Apollo state | 45/page, ~174 pages. Rent, beds, baths, address, coordinates 100%; size ~31%, AC ~39%, year built 0%. Description is the truncated search snippet. |
| torontorentals.com | `torontorentals` | **go** | search pages; `/graphql` results captured while the page loads | Rentals.ca network (same data as rentals.ca). ~4,000 buildings / ~7,000 floor plans, 10 buildings per page; one row per floor plan. Size ~99%, year built ~78%, no description, no AC. Building contact is never read. |
| Rentals.ca | `rentals_ca` | **no-go (parser)** | same adapter as torontorentals | No longer blocked with CloakBrowser, but no `/graphql` results response is captured ("no results response"). Adapter needs a fresh look. Its listings are covered by `torontorentals`. |
| Zillow (Toronto rentals) | `zillow` | **go** | search pages; `__NEXT_DATA__` | Plain Playwright got HTTP 403 PerimeterX captcha; CloakBrowser gets through. 64 on page 1. Rent, beds, address, postal code 100%, coordinates ~94%; baths and size ~25%; no unit type or posted date. Postal codes come without the space (`M4M2Z8`). |
| Realtor.ca (rentals) | `realtor_ca` | **go** | map page; `PropertySearch_Post` response | Plain Playwright got HTTP 403 "Sorry, you have been blocked"; CloakBrowser gets through. 11 per page; ~8,700 rentals in the box, but one map view serves only 600, so the box is split into tiles until each fits (all of it ≈ 800+ pages, about an hour at the 4 s delay). Rows are read from `LeaseRent` only (a sale row can slip into the first response). Rent, baths, address, postal code, coordinates, unit type, posted date 100%; beds and size ~91%. The bounding box includes listings outside Toronto (e.g. Vaughan); geocoding drops them. |
| Facebook Marketplace / groups | — | **no-go** | none | Needs a logged-in account and Meta's terms prohibit automated collection. Covered by Paste a listing (SPEC 10.3). |
| torontorentals.ca | — | n/a | | Domain doesn't resolve; the site is torontorentals.com. |
| manual | `manual` | go | `db/seed/manual.csv` | Demo backup (P3.33). |
