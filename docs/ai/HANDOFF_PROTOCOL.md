# Russell Vault Handoff Protocol

## Purpose

A handoff must let another agent continue from repository evidence without relying on chat history, memory, or unverified claims.

## Before surrender

1. Fetch the remote branch and confirm the exact final SHA.
2. Confirm the working tree is clean.
3. Push all intended commits.
4. Open or update the draft PR.
5. Run the required validation matrix and check every exit code.
6. Inspect all required CI jobs for the exact PR head, recording the run id **and run attempt**.
7. If the work has already merged, separately inspect the workflow triggered by the push to `main` on the resulting merge SHA.
8. If making any live Supabase claim, verify the target project ref from the deployed Railway environment before querying or changing it.
9. If the change touches the governed migration set, update `docs/ai/CURRENT_STATE.attestation.json` together with the marked machine-derived baseline block in `docs/ai/CURRENT_STATE.md`.
10. Update `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md`.
11. Do not edit `CURRENT_STATE.md` beyond the standing exception: migration-bearing work may update its marked
    machine-derived baseline block and `CURRENT_STATE.attestation.json` together, and nothing else in that file.
    Narrative and program-phase edits require an explicit work-order exception.

## Required surrender record

The handoff must state:

- repository and canonical branch;
- branch, base SHA, final SHA, and PR number;
- whether the PR is draft, ready, merged, closed, or blocked;
- files and migrations changed;
- feature lifecycle and owner-facing routes delivered;
- database functions, read models, grants, and security changes;
- client/server contracts and recovery behavior;
- test commands, totals, exit codes, and exact failures;
- CI run IDs, run attempts, and conclusions for every required job on the exact PR head, disclosing any earlier failed attempt of the same run;
- if merged, the `main` push workflow run id, attempt, and conclusion on the exact merge SHA, reported separately from PR-head CI;
- the live Supabase project ref and the deployed-configuration evidence used to establish that identity, or explicitly `not checked`;
- live Supabase migration count and parity status for that verified project, or explicitly `not checked`;
- Railway deployment and `/api/version` result, or explicitly `not authorized/not checked`;
- hosted acceptance steps and results;
- production data touched, if any;
- known defects, limitations, flakiness, and skipped proof;
- rollback path;
- exact next owner decision.

## Evidence language

Use these terms precisely:

- **implemented**: code exists on the stated branch;
- **validated**: the stated automated checks passed on the exact SHA;
- **merged**: GitHub records the PR as merged;
- **main-green**: the required push workflow on the stated `main` SHA completed successfully, at a stated run attempt;
- **deployed**: Railway reports success for the stated SHA;
- **identity-verified**: the production Supabase project ref was read from deployed configuration, not from a document or a remembered value;
- **hosted-parity**: the migration ledger was checked on a project whose ref was identity-verified;
- **hosted-accepted**: the owner workflow was exercised against the deployed app and verified live schema;
- **complete**: all work-order acceptance gates are satisfied.

Do not collapse these into one word.

## Failure reporting

Report every timeout, cancellation, hang, skipped test, unverified exit code, unavailable dependency, blocked credential, and environment limitation. A per-file sweep is not equivalent to a full-suite pass. A Railway build is not a substitute for CI. Green PR-head CI is not a substitute for a green post-merge `main` push workflow. Green CI is not a substitute for hosted acceptance.

Do not convert access limitations into claims about reality. "This token cannot list the project" is not evidence that the project does not exist, and a scoped connector listing is not a census of what exists. Resolve production identity from deployed configuration before drawing conclusions from any listing.

## Cross-agent continuation

The incoming agent must:

1. read repository context;
2. verify the handoff SHA and PR directly;
3. inspect the diff relevant to the next task;
4. treat the handoff as evidence, not unquestionable authority;
5. when live systems matter, verify the deployed production target independently before acting;
6. preserve or explicitly supersede unfinished commitments.

## Handoff ownership

- The active implementation agent owns `LAST_IMPLEMENTATION_HANDOFF.md`.
- ChatGPT owns `CURRENT_STATE.md` after independent review.
- The owner controls merge, live migration, deployment, destructive action, and roadmap priority unless explicitly delegated.
