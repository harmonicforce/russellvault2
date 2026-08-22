# Russell Vault Agent Entry Point

This file applies to Claude, Codex, ChatGPT-assisted coding agents, and any future implementation agent.

## Start here

Read `CLAUDE.md` and every file in its required reading order before editing.

## Operating rules

- Start from current `main` unless the work order explicitly names another base.
- Record the exact base SHA.
- Work on a short-lived branch and open a draft PR.
- Implement an owner-usable vertical slice, not backend fragments or architecture-only notes.
- Reuse existing governed models and functions before creating new systems.
- Preserve Product → SKU → Lot → Item and all workspace/security boundaries.
- Never fabricate inventory, cost, condition, identity, or marketplace facts.
- Never expose service-role credentials to the browser.
- Do not modify `docs/ai/CURRENT_STATE.md` unless explicitly authorized.
- Update `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md` before surrendering work.
- Treat every factual claim in a repository document as a hypothesis to verify, not as authority, when it conflicts with deployed configuration, GitHub, or the live governed database.
- This repository does not name the production Supabase project. Before touching live Supabase, read the target project ref from the deployed Railway environment immediately before acting. Do not infer production identity from a project name, a repository document, a remembered ref, or a scoped project listing.
- A CI claim must name the exact SHA, run id, **and run attempt**. One run id can hold a failed attempt and a later successful one. Never reduce "green after a rerun" to "never failed".
- A migration-bearing change must update `docs/ai/CURRENT_STATE.attestation.json` and its derived documentation in the same change. `scripts/ci/current-state-guard.mjs` enforces this.

## Default authority boundary

A normal work order authorizes branch work and a draft PR only. It does not authorize:

- merging to `main`;
- applying live Supabase migrations;
- changing Railway configuration;
- deploying or restarting production;
- changing branch protection;
- deleting branches or production data.

Those actions require explicit work-order authorization.

## Context and size

When the requested slice is large, create an internal phased plan, checkpoint commits, and continue in dependency order. Do not reject the request merely because it exceeds one context window.

## Surrender requirement

Use `docs/ai/HANDOFF_PROTOCOL.md` and `docs/ai/SESSION_CHECKLIST.md`. Leave the branch, PR, evidence, limitations, exact production target where relevant, and exact next decision in a state another agent can continue without reconstructing the session from chat history.

Report what you could not inspect as a blocker. An access limitation is never evidence about reality: "this token cannot list the project" does not mean the project does not exist.
