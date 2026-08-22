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
- Railway exposes `/api/health` and `/api/version` for deployment verification.

Machine-readable current state lives in `docs/ai/CURRENT_STATE.attestation.json`, validated by `scripts/ci/current-state-guard.mjs`. Read it before trusting any state claim in prose.

### Deployment identity rule

**This repository does not name the production Supabase project, and no document here may.** The deployed runtime is the only authority for production identity.

Before any live Supabase read, migration, reset, restore, or parity claim, read the Supabase URL configured in the deployed Railway service (`VITE_SUPABASE_URL`, or the Supabase host embedded in the bundle the live app serves) **immediately before acting**, and confirm the project ref you are about to touch matches it. A remembered ref, a project display name, a scoped Supabase project listing, an agent handoff, a repository document, and the attestation itself are each insufficient on their own.

This is not a formality. At least two real Russell Vault databases exist, both plausible-looking, and this file named the wrong one as `Supabase project` until 2026-08-22. See `projectRefRegistry` in the attestation for what each known ref actually is.

### CI truth rule

A CI claim must name the exact SHA, the run id, **and the run attempt**. The same run id can hold a failed attempt and a later successful one, so a run id alone proves nothing.

Never reduce "green after a rerun" to "never failed". State which attempt went green and what the earlier attempts did.

For an unmerged PR, inspect the required jobs on the exact PR-head SHA. After a merge, separately inspect the workflow triggered by the push to `main` on the merge SHA. Railway deployment success and GitHub commit-status summaries do not substitute for the required GitHub Actions jobs.

## Work-order rule

A work order should reference repository context instead of repeating repository-wide rules. It should contain only the objective, exact scope, acceptance criteria, task-specific constraints, and final report format.

When a work order conflicts with these documents, follow the newer explicit work order only when it clearly names and intentionally overrides the conflicting rule.
