# Search integration patches

Current baseline: upstream main `29a7393`. Verified implementation: `/tmp/rent-search-upstream`, branch `b/search-owner-integration`.

- `search-interoperability.patch`: current B-owned source/tests; preserves newer A/C/D contracts.
- `search-owner-handoff.patch`: current B handoff and tagged specification records.
- `*-570300e.patch`: historical checkpoints only; do not apply over newer owner code.

Both current patches pass `git apply --check` against29a7393. Original checkout remains570300e with canonical app/shared paths read-only. No secrets, dependency/config changes, push, merge or deployment are included.
