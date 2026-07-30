# AGENTS.md

This repository is worked on by multiple coding agents, principally Claude and Codex. Treat the repository as the shared memory between sessions and providers.

## Read before changing code

Read, in order:

1. `docs/ai/CURRENT_STATE.md`
2. `docs/ai/PROJECT_CONTEXT.md`
3. `docs/ai/ENGINEERING_RULES.md`
4. `docs/ai/HANDOFF_PROTOCOL.md`
5. the phase/runbook documents referenced by `CURRENT_STATE.md`

Do not infer project state from the default branch. The GitHub default branch is currently known to be wrong. Resolve the canonical working branch and verified head from `CURRENT_STATE.md` before making changes.

## Authority boundaries

- Legacy SQLite remains the authoritative deployed inventory system unless `CURRENT_STATE.md` explicitly records an owner-approved authority transfer.
- Supabase/PostgreSQL work is shadow and non-authoritative unless explicitly recorded otherwise.
- Do not deploy, change Railway configuration, change the default/deployed branch, enable dual-write, or transfer authority without explicit owner authorization.
- Do not fabricate owner-run acceptance evidence, timing results, hosted verification, credentials, or deployment status.

## Ownership of status documents

`docs/ai/CURRENT_STATE.md` is reviewer-owned. Implementation agents must not edit it.

Implementation agents may update technical documentation and must create or update `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md` at each checkpoint.

## Context-window doctrine

A context window is a checkpoint, not a project boundary.

For work larger than one session:

1. Decompose it into explicit phases.
2. Complete the current phase to a coherent, tested checkpoint.
3. Commit the checkpoint.
4. Update `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md`.
5. Continue in the next session from the committed checkpoint.

Do not shrink an authorized scope merely because one context window is insufficient.

## Required implementation behavior

- Work from the canonical branch/head recorded in `CURRENT_STATE.md`.
- Create a dedicated branch unless the owner explicitly directs otherwise.
- Preserve repository safety gates and authority boundaries.
- Run the narrowest relevant checks while developing, then the complete required validation before declaring a checkpoint complete.
- Report exact commands, results, commit SHA, branch, files changed, known gaps, and next action.
- Never claim tests or hosted checks passed unless they were actually run and observed.
- Never edit `CURRENT_STATE.md`.

## Completion report

Every implementation checkpoint must leave `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md` containing:

- agent and date
- base branch and base SHA
- working branch and head SHA
- requested scope
- completed scope
- files and migrations changed
- tests/checks run with exact results
- unresolved blockers and risks
- owner-only actions still required
- recommended next implementation step

The next agent must independently verify the repository rather than trusting the handoff blindly.