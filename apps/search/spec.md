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

## Validation

User query with natural language: something like
- "I'm looking for houses or apartments around the university of toronto. Should be within 10 minutes biking distance"
  - Locate the university of toronto general area, since no specific building is specified
  - Determine time
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