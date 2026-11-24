# Search and places

The parser turns a prompt into structured rent, home and commute criteria. The resolver checks the place catalogue, civic areas and address points before falling back to geocoding. Waterloo landmarks and intersections resolve locally. Selected Kitchener places, including the GO station, can be commute destinations.

Search applies the Waterloo listing boundary, enriches matching candidates with valuation and travel data, and sends results and destination pins to the web app. Waterloo neighbourhood crime scoring is disabled.

Source files include `apps/web/src/lib/parse/`, `apps/web/src/lib/api/runtime.ts`, and `apps/web/src/lib/db/candidates-context.ts`.

[Waterloo](Waterloo.md) · [Data imports](Data%20imports.md) · [Database](Database.md) · [Listing and area views](Listing%20and%20area%20views.md)
