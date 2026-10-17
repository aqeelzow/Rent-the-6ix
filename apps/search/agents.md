# Agent instructions

@/Users/hydroxide/.codex/RTK.md

## Read before working

- Always read `spec.md` and `plan.md` before starting or resuming work.
- `spec.md` is the source of truth for requirements. `plan.md` records execution order, agreed clarifications and progress; it does not override the spec.
- If the plan and spec disagree, identify the conflict and reconcile it before implementing the affected behavior. Preserve the user's explicit clarification answers recorded in the plan.
- Read the root documents referenced by the spec when needed: `../../SPEC.md`, `../../TEAM.md`, `../../PERSON_B.md` and `../../PROGRESS.md`. Follow the team's ownership and shared-contract rules.

## Execute and track

- Follow `plan.md` in order, using the smallest complete implementation that satisfies the spec.
- Keep plan checkboxes accurate after each completed step. Record meaningful blockers, verification results and changes to the plan.
- Do not silently expand scope or replace missing dependencies with a different architecture. Use fixtures until the required team services are available.
- Verify the behavior changed, including relevant callers, schemas, fixtures and tests, before marking a step complete.
- Keep requirements in the spec and execution details in the plan. When requirements change, update the relevant specification and its change log under the team's rules, then align the plan.

## Validation cadence

- Complete each feature before running general validation once at the end. This is the default acceptance check before moving to the next feature.
- Keep validation brief and proportionate to the feature. Comprehensive validation is not necessary; use a small set of relevant existing checks.
- Avoid repeated intermediary validation, benchmarks, browser runs and separate validation-only work unless a failure or specific unresolved concern requires investigation.
- Use the database during end-of-feature validation when relevant. Reuse existing checks and evidence; repeat or broaden checks only when subsequent changes or failures justify it.
- For documentation-only changes, review the diff; no test run is needed.

## Maintain documentation and API specifications

- Keep reliable feature documentation and an API specification current as features progress, updating them in the same change as the implementation. Do this in DOCS.md
- Document implemented behavior, setup, dependencies and known limitations. Specify API methods, paths, request/response schemas, validation, errors and relevant examples; keep them consistent with shared contracts and verified behavior.
- Clearly distinguish implemented and verified behavior from planned or unavailable features. Do not mark a feature complete while its documentation or API specification is outdated.

## Respect component-owned structures

- Do not modify shared structures owned by other components, including database tables, migrations, models and exported contracts.
- Inspect the owning component's authoritative definitions before writing queries or integrations. Use its existing field names, types, relationships, nullability and semantics; do not invent or silently redefine them locally.
- If integration requires changes to another component, create or update local `change-request.md` with all required changes. For each request, identify the owner, affected structure, current contract, proposed change, reason, compatibility/data implications and dependent search work.
- Keep dependent work marked as blocked or fixture-backed until the owner provides the required contract. Update requests as they are resolved; do not implement another component's changes yourself.
