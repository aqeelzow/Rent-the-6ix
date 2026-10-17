# Person B — AI & search API

**Role:** everything between the renter's words and the ranked list: shared schemas and fixtures, the Gemini provider, prompt parsing into criteria / travel targets / safety, the search route and match score, listing explanations, paste-a-listing, ward briefings, AI cache and rate limits.

**Owns:** see `TEAM.md` section 2 (folders) and `SPEC.md` 22.1 (roles).

**Contracts you provide:** `packages/shared/schemas` (all of them), fixtures, API route conventions, `scoreListing()`, the search / detail / explain / import / briefing routes. Task ids match `PROGRESS.md`; task details are in `SPEC.md`.

## Search Requirements

Describe what house you want with words. The search does the processing and creates the filters for you.

Here are the type of query filters that we need to provide:
- Number of rooms
- Size of unit
- Unit type (house/appartments/)
- Age of house
- Air conditioning
- Price range
- How reasonable the price is relative to market (underpriced, overpriced, reasonably priced)
- Safety based on general location trends
- Time to amenities (schools, supermarkets, job, etc.) via:
  - Public transport
  - Car
  - Walk
  - Bike
- determine if its a min/max query on numerical values like price, commute time, age, size, rooms. ie. bottom/top 5% with min 10 results

Performance should also be valued. Some tips:
- optimize the order of queries. ie. time consuming tasks like "Time to amenities" which require dynamic computations should be done last

## Sub-requirements

Since the database only provides a longitude and a latitude, we also need to provide a subservice to process the "Time to amenities" queries. Performance is of the essence here. We can sacrifice some quality of results for significantly faster performance. General time is fine (so long as it still provides a generally accurate way of comparing travel times between different locations). Travel time should be specific depending on the granularity of the location. ie. "university of toronto" is quite broad. if we can, then it should find a path to anywhere in that area. If thats too difficult, we can just path to the center of the university.

This subservice will also need to be able to query for locations by natural language, for example: "university of toronto", "eaton center", "TD at bay st and queens st w.". It should be able to account for both "general area" and "specific area" cases.

## Agreed search semantics (2026-10-16)

These explicit user clarifications also appear in `plan.md`. Root shared-contract updates require coordination before integration.

- Unstated criteria impose no constraints; household size does not imply bedrooms. Monetary ranges mean CAD/month; rooms mean bedrooms unless shared accommodation is explicit.
- Cheapest sorts all eligible matches. Explicit numeric top/bottom percentiles select from the full eligible pool after hard filters, using `min(N, max(minimumCount, ceil(N * percentage / 100)))` known values; minimumCount defaults to 10. Existing score tie-breakers resolve the cutoff. Multiple percentile fields require clarification.
- Alternative travel modes use OR per destination; separate destinations must each satisfy their requirement. Use the best normalized travel score per destination, and shortest requested routed time for travel percentiles.
- Broad destinations use a labelled representative point. Ambiguous campuses or branches require structured destination choices.
- Configured general-area filters such as Downtown or Scarborough appear as labelled approximate shaded regions on the results map, and the initial map view includes that region.
- Missing routing produces labelled straight-line distance and an unconfirmed time requirement; hide-unconfirmed excludes it. Never present straight-line distance as minutes.
- Exact travel percentiles run asynchronously for at most two minutes over the full eligible pool. Incomplete routing returns explicit unavailability, never an exact partial percentile. Jobs are bounded, temporary and in memory, with opaque polling tokens and an expired response after restart. Prompts and job payloads are never persisted or logged.

## Change log

- 2026-10-16: Incorporated the user's agreed plan clarifications before drafting affected schemas and behavior. Implementation scope is the search pipeline; imports, AI explanations and ward briefings remain outside this local plan.

- 2026-10-16: Search-only unit-type choice `studio` represents a whole-unit listing with bedrooms 0, while preserving the owner's existing Listing unit types. This permits room OR studio searches without adding a conjunctive bedroom restriction. Configured Downtown/Scarborough search rectangles are explicitly approximate search definitions, not official civic boundaries; authoritative geographic integration remains dependent on D.
- 2026-10-17: Configured general areas remain approximate search boxes, but are now visibly drawn and labelled on the results map; the area chip uses a concise approximate label.

## Validation examples

User query with natural language: something like
- "I'm looking for houses or apartments around the university of toronto. Should be within 10 minutes biking distance. Around 3-5k per"
  - Locate the university of toronto general area, since no specific building is specified
  - Calculate and filter by time
  - 3-5k price range
- "I work at TD Canada on bay st and queens st w. I'm looking for a place to commute, bike, or walk to work, and it should take no longer than 10 minutes."
  - Locate the relevant TD location
  - Assume one person, since no other people are mentionned
  - Age, air conditioning, number of size of unit, unit type, reasonability are all not considered (since the user doesn't specify). These should not be hard blockers
  - Estimate the time to travel via commute, walk, and bike to each of these locations
  - Return the valid results
- "I'm on a budget. I wanna live in downtown at the cheapest cost"
  - min price query
  - everything else not considered

## Potential Resources

- Consider using gemini api/nlp to break apart your query
JEV for Gemini. https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en&utm_source=chatgpt.com
- The schema and other shared information is available in the project root. See `PERSON_B.md`, `TEAM.md`, `SPEC.md`, `PROGRESS.md`. Take what you need from there, and summarize it within `shared.md` in this repo. If any of them may be dynamic (ie. maybe `PROGRESS.md`), feel free to check it every so often
