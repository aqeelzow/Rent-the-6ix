# @rentthe6ix/shared

Code used by both `apps/web` and `apps/worker`. Plain TypeScript source, no build step: Next.js transpiles it (`transpilePackages`) and the worker runs it directly.

| Folder | What | Owner |
| --- | --- | --- |
| `schemas/` | zod schemas; types via `z.infer` (SPEC 5, 13) | B |
| `fixtures/` | synthetic Toronto listings, areas, travel times, API responses | B |
| `engine/` | pure scoring engine: no React, no fetch, no database, no `Math.random` (SPEC 7) | B, C, D (see `TEAM.md` section 2) |

Import as `@rentthe6ix/shared/schemas`, `@rentthe6ix/shared/engine/score`, `@rentthe6ix/shared/fixtures`.
