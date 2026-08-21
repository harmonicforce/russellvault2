# Russell Vault Work Order Protocol

## Purpose

Repository-wide context belongs in `AGENTS.md`, `CLAUDE.md`, and `docs/ai/*`. A work order should stay focused on the requested vertical slice.

## Before editing

1. Read the required files listed in `CLAUDE.md`.
2. Fetch current `main` and confirm the exact base SHA.
3. Confirm the working tree is clean.
4. Inspect the existing implementation, migrations, routes, read models, and tests relevant to the task.
5. Inspect current CI and deployment status when hosted behavior is affected.
6. If the task touches or claims anything about live Supabase, verify the target project ref against the Supabase URL configured in the deployed Railway environment before querying or mutating it.
7. Create a short-lived branch and draft PR unless the work order explicitly directs otherwise.

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
8. when release is authorized, verify the production project ref from deployed Railway configuration;
9. verify live migration parity on that exact project before applying migrations;
10. apply only the required forward migrations to the verified project;
11. recheck parity and verify the hosted workflow after deployment.

A Supabase project name, stale repository line, agent memory, or scoped `list_projects` result is not sufficient production identity evidence.

## UI workflow

Owner-facing work includes understandable labels, active workspace context, loading/empty/partial/stale/unavailable/error states where applicable, refresh recovery, iPad and desktop layouts, governed public identifiers, and direct links to the next action.

## Default completion gate

Unless the work order explicitly grants release authority:

1. run all required checks with verified exit codes;
2. push the feature branch;
3. obtain green required CI on the exact PR head;
4. update `LAST_IMPLEMENTATION_HANDOFF.md`;
5. stop before merge, live migration, Railway deployment, or production configuration changes.

## Release gate

Only when explicitly authorized:

1. confirm the exact green PR head and all four required jobs;
2. merge through GitHub without force-pushing `main`;
3. record the resulting merge SHA;
4. inspect the GitHub Actions workflow triggered by the push to `main` on that exact merge SHA and require all four jobs to pass;
5. verify the live Supabase project ref from Railway configuration;
6. verify live Supabase parity on that project and apply required migrations if authorized;
7. confirm Railway deployment success;
8. confirm `/api/version` returns the final merge SHA;
9. run task-specific hosted acceptance;
10. report rollback information and any incomplete proof.

A green PR-head run or green Railway deployment does not override a red, timed-out, cancelled, or incomplete required `main` push workflow.

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
6. exact PR-head CI run IDs and conclusions;
7. if merged, the exact `main` push workflow run ID and conclusion;
8. live Supabase project ref and how its production identity was verified;
9. live Supabase migration parity status;
10. Railway and `/api/version` status;
11. hosted acceptance result;
12. incomplete requirements and exact reasons;
13. reversions, false starts, flaky tests, blocked egress, and unchecked commands;
14. newly discovered follow-up work;
15. rollback path;
16. exact owner decision required next.

Do not describe timed-out, cancelled, hanging, skipped, or unchecked commands as passing.
