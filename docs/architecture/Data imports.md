# Data imports

The worker loads City of Waterloo boundaries and development applications, GRT bus and ION stops, and OpenStreetMap amenities. The known-place generator separately builds an app-local catalogue of Waterloo intersections and ION destinations.

The 2021 Census snapshot contains 155 dissemination areas and 764 dissemination blocks. The loader assigns each to one district. It sums DA tenure counts and block population and dwelling counts. Multi-DA shelter-cost estimates use published tenant counts as weights and preserve missing data.

The demo seed loads 25 labelled rentals. The benchmark seed loads eight quarters of regional StatCan asking rents and the $104 GRT adult monthly pass.

- Load civic data with `pnpm data:civic all`
- Load seeds with `pnpm --filter worker load:benchmarks` and `pnpm --filter worker load:manual`
- Source files live in `apps/worker/src/civic/` and `db/seed/`

[Waterloo](Waterloo.md) · [Database](Database.md) · [Search and places](Search%20and%20places.md)
