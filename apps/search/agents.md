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
