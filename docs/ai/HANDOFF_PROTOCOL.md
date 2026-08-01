# Russell Vault Handoff Protocol

## Purpose

A handoff must let another agent continue from repository evidence without relying on chat history, memory, or unverified claims.

## Before surrender

1. Fetch the remote branch and confirm the exact final SHA.
2. Confirm the working tree is clean.
3. Push all intended commits.
4. Open or update the draft PR.
5. Run the required validation matrix and check every exit code.
6. Inspect CI for the exact PR head.
7. Update `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md`.
8. Do not edit `CURRENT_STATE.md` unless explicitly authorized.

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
- CI run IDs and conclusions for every required job;
- live Supabase migration count and parity status, or explicitly `not checked`;
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
- **deployed**: Railway reports success for the stated SHA;
- **hosted-accepted**: the owner workflow was exercised against the deployed app and live schema;
- **complete**: all work-order acceptance gates are satisfied.

Do not collapse these into one word.

## Failure reporting

Report every timeout, cancellation, hang, skipped test, unverified exit code, unavailable dependency, blocked credential, and environment limitation. A per-file sweep is not equivalent to a full-suite pass. A Railway build is not a substitute for CI. Green CI is not a substitute for hosted acceptance.

## Cross-agent continuation

The incoming agent must:

1. read repository context;
2. verify the handoff SHA and PR directly;
3. inspect the diff relevant to the next task;
4. treat the handoff as evidence, not unquestionable authority;
5. preserve or explicitly supersede unfinished commitments.

## Handoff ownership

- The active implementation agent owns `LAST_IMPLEMENTATION_HANDOFF.md`.
- ChatGPT owns `CURRENT_STATE.md` after independent review.
- The owner controls merge, live migration, deployment, destructive action, and roadmap priority unless explicitly delegated.
