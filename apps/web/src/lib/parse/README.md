The fallback parser and destination resolver share `place-catalogue.ts`. It builds
one local index from the curated and generated JSON files at module load; known
places need neither Gemini nor an external geocoder.

Records with the same name use sourced coordinates when available and inherit
curated aliases. Conflicting curated coordinates are retained in
`placeCatalogue.conflicts` for inspection. Records sharing a name or alias merge
only when every pair of sourced coordinates is within 250 metres. Each entity
keeps its source IDs; City intersection records take precedence when merging
with nearby OSM records. Distant same-name branches remain separate choices.

Intersection aliases support reversed road order, street type abbreviations,
`and`/`&`/`/`, and omitted directions. Omitted directions broaden the candidates;
explicit directions narrow them. Bare university names retain the existing main
campus default, with all campuses available in picker mode.

Mentions use the longest matching phrase after a location cue (or at the start
of a prompt). They preserve the original text and offsets, so overlapping names
and amenity words inside a named place do not create extra destinations.
Conservative typo matching permits one insertion, deletion, substitution or
adjacent transposition in a multiword name of at least eight characters, with
an unchanged first or last word. Only one place identity resolves automatically;
equally close spellings identifying different places produce choices. Intersection
aliases and short names do not receive typo correction. Labels shorter than
three characters are excluded because they often identify a brand rather than
a destination.

The parse cache key includes the catalogue contents and parser version, so a
catalogue refresh cannot reuse interpretations from older location data.
