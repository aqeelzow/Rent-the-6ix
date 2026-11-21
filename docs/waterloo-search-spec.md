# Waterloo housing search and shortlist

**Status:** Draft  
**Date:** 2026-11-20  
**Author:** Codex  
**Reviewer:** Project owner

## Context

The launch area is the City of Waterloo, Ontario. A renter can describe what they want in plain language, search housing in the city, and save listings to revisit later.

The existing app has a query parser, a destination resolver, and a shortlist that persists in browser storage. Previous [search validation](../apps/search/plan.md) recorded cold searches above two seconds and extraction-provider timeouts. The Waterloo release needs to verify the complete search flow with local queries and inventory.

## Functional requirements

- FR-1: **Waterloo scope.** Search MUST return housing within the City of Waterloo. Queries that explicitly put the rental outside the city MUST show the coverage limit. A commute destination does not change where the rental must be located.
- FR-2: **Query extraction.** Search MUST extract supported criteria such as rent, unit type, bedrooms, amenities, destinations, travel mode, and travel-time limits into editable filters. It MUST preserve the user's hard requirements and distinguish them from preferences. If extraction fails or a criterion cannot be applied, show what needs review and let the renter continue with manual filters.
- FR-3: **POI resolution.** Search MUST resolve a named point of interest (POI) to the intended local place when the prompt provides enough information. When multiple plausible places remain, show distinct choices and apply the renter's selection. When a place cannot be resolved, surface the unresolved destination and allow the renter to edit it.
- FR-4: **Duplicate locations.** Aliases, repeated mentions, and records from multiple sources for the same physical destination MUST resolve to one choice. Distinct branches, campuses, or entrances with meaningfully different routing endpoints MUST remain selectable. When the same place appears in multiple criteria, preserve each distinct mode, limit, or preference.
- FR-5: **Housing shortlist.** Renters MUST be able to save and remove listings from search results or listing details, see the same saved state in both views, and reopen saved listings from the shortlist. Each listing appears once. The shortlist MUST survive reloads in the same browser when storage is available.
- FR-6: **Route-based travel times (nice to have).** The app MAY show travel times calculated along a network route from the listing to the resolved destination for the selected mode. Show a route-based time when available. If routing is unavailable, label any approximate time as an estimate or show that the time is unavailable. The release can ship with labeled estimates, and optional routing must respect the search latency target.

## Non-functional requirements

- **NFR-1 · Search latency.** End-to-end p95 MUST be strictly below **2,000 ms**, measured from submitting a search to rendering the first usable result list, confirmed empty state, or actionable destination choice. Include extraction, POI lookup, retrieval, routing needed for active constraints, and rendering. A spinner or results that ignore an active constraint do not stop the timer. Use a representative Waterloo query mix in a production-like environment with cache misses and repeat searches. Report the sample size, concurrency, cache mix, and failures alongside p95. Include failed or timed-out attempts in the percentile calculation as exceeding the latency target.
- **NFR-2 · POI accuracy.** Correct resolution MUST exceed **99%** on a held-out set of Waterloo queries with independently verified destinations and enough context to identify one physical place. Score each POI mention against the expected identity and routing point. Count wrong places, wrong routing points, unresolved mentions, and unnecessary clarification as failures for these cases. Verify genuinely ambiguous queries separately against FR-3.

## Acceptance criteria

### AC-1: City boundary (FR-1)

Given listings on both sides of the Waterloo municipal boundary, when a renter searches for housing in Waterloo, then every returned listing is within the city. An explicit request for housing outside the city shows the coverage limit.

### AC-2: Extraction and fallback (FR-2)

Given a labeled set of Waterloo prompts, when the parser extracts the search criteria, then its output matches the expected explicit values and hard or preferred status. Include paraphrases, negation, and multiple commute constraints. Given a provider timeout or unusable output, the renter can see which criteria need review and run a manual search. Compare the existing parser, GLiNER2 Multi, and NuExtract on the same prompts. Record field-level accuracy, dropped or invented constraints, and extraction latency. [GLiNER2 Multi](https://huggingface.co/fastino/gliner2-multi-v1) · [NuExtract](https://huggingface.co/numind/NuExtract)

### AC-3: POI accuracy and ambiguity (FR-3, NFR-2)

Given the held-out POI set, when search resolves the destinations, then more than 99% match the verified places and routing points. Given a name shared by distinct branches, search presents distinct choices and uses the selected branch for the commute calculation.

### AC-4: Duplicate locations (FR-4)

Given records for the same destination under different names, when search presents destination choices, then that destination appears once. Given two modes targeting the same place, search preserves both constraints. Given two different branches with the same name, both branches remain selectable.

### AC-5: Shortlist persistence (FR-5)

Given a renter saves a listing from results, when they open its detail or reload the app, then the listing appears as saved and has one shortlist entry. When they remove it from the shortlist and reload, it remains removed.

### AC-6: Search latency (NFR-1)

Given a production-like run of representative Waterloo searches, when measured through the rendered outcome defined in NFR-1, then p95 is below 2,000 ms. Report searches that wait for routes, when enabled, and those returning a destination choice separately so the overall percentile can be interpreted.

### AC-7: Route-based travel times when enabled (FR-6)

Given route-based times are enabled, when a route is available for the selected mode, then the app displays its duration. Given routing times out or returns no route, then the app shows a labeled estimate or an unavailable state, and the search still meets NFR-1.

## Edge cases

- EC-1: An invalid extraction or provider outage leaves confirmed filters editable. An unresolved hard commute constraint must stay visible until the renter resolves or explicitly removes it.
- EC-2: A POI lookup outage surfaces an unresolved destination. A listing retrieval or routing failure surfaces an error when it prevents a valid result. A successful search with zero matches displays an empty state.
- EC-3: Matching names alone are insufficient evidence that two places are duplicates. A shared address can still have separate venues or routing entrances.
- EC-4: A saved listing that becomes unavailable stays visible and removable. If browser storage is blocked, the shortlist works for the current visit and indicates that saves may not persist.

## API contracts

The draft uses the existing endpoint contracts.

- `POST /api/search/parse` extracts the editable search intent.
- `GET /api/geo/resolve` resolves a destination or provides choices.
- `POST /api/listings/search` runs the search.
- `GET /api/listings/search/jobs/[token]` retrieves a pending search result.

The UI uses these logical outcomes across the search flow.

```ts
interface DestinationReview {
  criteria: SearchIntent
  unresolved: Destination[]
}

type SearchOutcome =
  | { status: "results"; listings: Listing[] }
  | { status: "empty" }
  | ({ status: "needs_review" } & DestinationReview)
  | { status: "error"; message: string };
```

Destination review carries a set of distinct choices when the resolver has candidates. The shortlist uses the existing client store and browser persistence.

## Data models

| Entity | Required data and constraints |
| --- | --- |
| Search intent | Supported filters, explicit requirement or preference where applicable, and destination criteria with mode and time limit where supplied. |
| Destination | Canonical place identity, display name, aliases where known, and coordinates suitable for routing. Distinct physical places retain distinct identities. |
| Listing | Stable listing identity and verified city membership for search eligibility. |
| Shortlist entry | Existing saved-listing snapshot keyed by listing identity. Enough display data remains available when the original listing disappears. |

## Out of scope

- OS-1: Housing coverage beyond the City of Waterloo.
- OS-2: Broader UI redesign, new civic features, and Marketplace integration.
