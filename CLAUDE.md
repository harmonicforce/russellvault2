# Russell Vault AI Entry Point

Read this file first before changing the repository.

## Required reading order

1. `docs/ai/PROJECT_CONTEXT.md`
2. `docs/ai/ENGINEERING_RULES.md`
3. `docs/ai/CURRENT_STATE.md`
4. `docs/ai/WORK_ORDER_PROTOCOL.md`
5. The specific work order supplied for the current task

Do not ask the operator to paste these documents into the chat. Read them from the repository.

## Core instruction

Implement owner-usable vertical slices in the hosted Russell Vault application. Do not replace requested implementation with architecture documents, speculative redesign, or narrow demo code.

## Non-negotiables

- Preserve the governed Product → SKU → Lot → Item inventory model.
- The server/database remains authoritative for identity, readiness, duplicate detection, serialization, movement, and immutable history.
- No raw UUID input in owner-facing UI.
- No service-role key in the browser.
- Enforce authenticated workspace isolation on every read and mutation.
- Prefer additive migrations and focused changes over rewrites.
- Do not fabricate inventory facts, condition, identity, source, cost, or marketplace data.
- Do not call work complete until it is visible and usable on Railway.
- Do not deploy with red required CI or database tests.
- Do not modify `harmonicforce/the-russellops`.

## Current-state stewardship

`docs/ai/CURRENT_STATE.md` is maintained by ChatGPT as the independent project-state steward, not by the implementation agent.

Claude must not edit, append to, or rewrite `docs/ai/CURRENT_STATE.md` unless a work order explicitly grants a one-time exception.

At the end of each work order, Claude must instead provide a concise evidence report containing:

- final commit SHA and branch;
- files and migrations changed;
- workflows completed;
- tests and CI results, including failures, cancellations, hangs, and commands whose exit codes were not verified;
- live migration and Railway verification status;
- known limitations, reversions, and newly discovered defects.

ChatGPT will inspect the repository and available CI evidence, reconcile that report against the prior state, and update `CURRENT_STATE.md` separately. Claude's report is implementation evidence, not the canonical state record.

## Current deployment

- Repository: `harmonicforce/russellvault2`
- Stable branch: `main`
- Deployment branch until Railway is confirmed switched: `claude/ui-better-spreadsheet-cjhwjb`
- Live app: `https://russellvault2-production.up.railway.app`
- Supabase project: `ykdyqnvmwpxhowbwhzqz`

## Work-order rule

A work order should reference these files instead of repeating repository-wide rules. The work order should contain only:

- objective
- exact scope
- acceptance criteria
- task-specific constraints
- final report format

When a work order conflicts with these documents, follow the newer explicit work order only if it clearly states that it intentionally overrides a named rule.
