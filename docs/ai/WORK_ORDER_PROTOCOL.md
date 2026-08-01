# Russell Vault Work Order Protocol

## Purpose

Repository-wide context belongs in `AGENTS.md`, `CLAUDE.md`, and `docs/ai/*`. A work order should stay focused on the requested vertical slice.

## Before editing

1. Read the required files listed in `CLAUDE.md`.
2. Fetch current `main` and confirm the exact base SHA.
3. Confirm the working tree is clean.
4. Inspect the existing implementation, migrations, routes, read models, and tests relevant to the task.
5. Inspect current CI and deployment status when hosted behavior is affected.
6. Create a short-lived branch and draft PR unless the work order explicitly directs otherwise.

Do not produce a fresh architecture review unless requested.

## Execution style

Complete one coherent vertical slice:

`schema/function → server/data client → owner UI → recovery/error states → tests → release evidence`

A capability is not complete when only one layer exists.

## Scope control

- Fix defects that directly block the requested slice.
- Do not wander into unrelated domains.
- Do not reopen settled architecture without evidence that it prevents the requested result.
- Record non-blocking discoveries in the final handoff.
- Preserve behavior outside the work order.

## Context-window discipline

Read targeted context in this order:

1. repository context documents;
2. task-specific routes and modules;
3. relevant migrations and tests;
4. current read models and functions;
5. historical material only when a conflict remains.

When a task exceeds one session, create a phased execution plan and checkpoint commits. Do not substitute a complaint about context size for a plan.

## Database workflow

When database behavior changes:

1. inspect the latest migrations and contracts;
2. create additive migrations;
3. update the shim only for Supabase-managed surfaces absent from plain PostgreSQL;
4. add pgTAP coverage;
5. reset and test from empty on the shim;
6. test on the local Supabase CI tier;
7. stop at a green draft PR unless release is explicitly authorized;
8. when release is authorized, verify live migration parity before applying migrations;
9. verify the hosted workflow after deployment.

## UI workflow

Owner-facing work includes understandable labels, active workspace context, loading/empty/error states, refresh recovery, iPad and desktop layouts, governed public identifiers, and direct links to the next action.

## Default completion gate

Unless the work order explicitly grants release authority:

1. run all required checks with verified exit codes;
2. push the feature branch;
3. obtain green required CI on the exact PR head;
4. update `LAST_IMPLEMENTATION_HANDOFF.md`;
5. stop before merge, live migration, Railway deployment, or production configuration changes.

## Release gate

Only when explicitly authorized:

1. confirm the exact green PR head;
2. merge through GitHub without force-pushing `main`;
3. verify live Supabase parity and apply required migrations;
4. confirm Railway deployment success;
5. confirm `/api/version` returns the final merge SHA;
6. run task-specific hosted acceptance;
7. report rollback information and any incomplete proof.

## State ownership

- Implementation agents update `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md`.
- Implementation agents must not edit `docs/ai/CURRENT_STATE.md` unless explicitly authorized.
- ChatGPT updates `CURRENT_STATE.md` after independent review.

## Evidence report

Every surrender report must include:

1. branch, base SHA, and final SHA;
2. PR number and state;
3. files and migrations changed;
4. owner workflows completed;
5. exact tests and results;
6. CI run IDs and conclusions;
7. live Supabase status;
8. Railway and `/api/version` status;
9. hosted acceptance result;
10. incomplete requirements and exact reasons;
11. reversions, false starts, flaky tests, blocked egress, and unchecked commands;
12. newly discovered follow-up work;
13. rollback path;
14. exact owner decision required next.

Do not describe timed-out, cancelled, hanging, skipped, or unchecked commands as passing.
