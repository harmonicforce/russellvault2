# Russell Vault AI Entry Point

Read this file first before changing the repository.

## Required reading order

1. `AGENTS.md`
2. `docs/ai/PROJECT_CONTEXT.md`
3. `docs/ai/ENGINEERING_RULES.md`
4. `docs/ai/CURRENT_STATE.md`
5. `docs/ai/PROJECT_ROADMAP.md`
6. `docs/ai/HANDOFF_PROTOCOL.md`
7. `docs/ai/WORK_ORDER_PROTOCOL.md`
8. The specific work order supplied for the current task

Do not ask the operator to paste these documents into chat. Read them from the repository.

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
- Do not call work complete until the owner-facing workflow is visible and usable on Railway.
- Do not merge or deploy with red required CI or database tests.
- Do not modify `harmonicforce/the-russellops`.

## State stewardship

`docs/ai/CURRENT_STATE.md` is maintained by ChatGPT as the independent project-state steward. Implementation agents must not edit it unless a work order explicitly grants a one-time exception.

Implementation agents update `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md` and provide the evidence required by `docs/ai/HANDOFF_PROTOCOL.md`.

## Current deployment

- Repository: `harmonicforce/russellvault2`
- Canonical and GitHub default branch: `main`
- Railway source branch: `main`
- Live app: `https://russellvault2-production.up.railway.app`
- Canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`
- Railway `VITE_SUPABASE_URL` points to `https://ncyqqitqtsyjrijieykd.supabase.co`.
- Railway exposes `/api/health` and `/api/version` for deployment verification.

### Deployment identity rule

The deployed environment is authoritative for production identity. Before any live Supabase read, migration, reset, restore, or acceptance claim, verify that the target project ref matches the project ref in Railway's deployed Supabase URL. A repository document, remembered project name, Supabase project listing, or agent handoff is not sufficient proof by itself.

`ykdyqnvmwpxhowbwhzqz` is a different Supabase project and is not the database configured by the deployed Russell Vault Railway service. Do not treat it as production merely because older repository documentation named it.

### CI truth rule

For an unmerged PR, inspect the exact PR-head required jobs. After merge, inspect the GitHub Actions workflow triggered by the push to `main` on the merge SHA as a separate release signal. A green PR-head run, Railway deployment status, or GitHub commit status must not be used to claim `main` is green when the `main` push workflow is red, timed out, cancelled, or still running.

## Work-order rule

A work order should reference repository context instead of repeating repository-wide rules. It should contain only the objective, exact scope, acceptance criteria, task-specific constraints, and final report format.

When a work order conflicts with these documents, follow the newer explicit work order only when it clearly names and intentionally overrides the conflicting rule.
