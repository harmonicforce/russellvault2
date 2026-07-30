# Russell Vault Cross-Agent Entry Point

This repository is worked on by Claude and Codex. The repository, not chat history, is the shared memory.

## Required reading order

1. `CLAUDE.md`
2. `docs/ai/PROJECT_CONTEXT.md`
3. `docs/ai/ENGINEERING_RULES.md`
4. `docs/ai/CURRENT_STATE.md`
5. `docs/ai/WORK_ORDER_PROTOCOL.md`
6. `docs/ai/HANDOFF_PROTOCOL.md`
7. `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md`
8. the current work order

## Agent-neutral rules

- Verify the canonical branch and head before changing code. Do not infer state from the GitHub default branch.
- `docs/ai/CURRENT_STATE.md` is reviewer-owned. Claude and Codex must not edit it unless a work order grants an explicit one-time exception.
- Implementation agents update `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md` at each committed checkpoint.
- A context window is a checkpoint, not a project boundary. Decompose large work, commit coherent phases, write the handoff, and resume. Do not shrink authorized scope merely because a session is ending.
- Never fabricate tests, CI, hosted verification, owner workflows, timing data, deployment state, or exit-code success.
- Preserve the governed Product → SKU → Lot → Item model, workspace isolation, immutable history, and server/database authority.
- Do not deploy, change Railway or Supabase production state, normalize branches, or transfer authority unless the work order explicitly authorizes it.

The incoming agent must independently verify the outgoing handoff. Repository evidence wins when documentation and implementation disagree.