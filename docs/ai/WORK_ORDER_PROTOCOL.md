# Russell Vault Work Order Protocol

## Purpose

This protocol keeps future work orders compact. Repository-wide context belongs in `CLAUDE.md` and `docs/ai/*`, not repeated in every prompt.

## How to begin a work order

Before editing:

1. Read `CLAUDE.md`.
2. Read all files listed there.
3. Confirm the current branch and commit.
4. Inspect the existing implementation relevant to the task.
5. Inspect current CI and deployment status when the task affects hosted behavior.
6. List the exact files, migrations, routes, and tests likely to change.

Do not produce a fresh architecture review unless the work order explicitly requests one.

## Execution style

A work order should be implemented as one coherent vertical slice.

For each capability, complete the chain:

`schema/function → server or data client → owner UI → recovery/error states → tests → live migration → Railway verification`

Do not report a capability complete when only one layer exists.

## Scope control

The task-specific work order is authoritative for scope.

While implementing:

- fix directly blocking defects discovered in touched code;
- do not wander into unrelated domains;
- do not reopen settled architecture without evidence that it prevents the requested result;
- record newly discovered non-blocking work in the final report rather than silently expanding the task;
- preserve working behavior outside the work order.

## Context-window discipline

Do not load the entire repository or giant historical PR diff when unnecessary.

Use this sequence:

1. repository context documents;
2. task-specific routes and modules;
3. relevant migrations and tests;
4. current read models/functions;
5. only then inspect historical material if a conflict remains.

Prefer targeted file reads and searches.

Do not ask the operator to repaste repository rules already present in these documents.

## Database workflow

When adding or changing database behavior:

1. inspect the latest migrations and existing function contracts;
2. create an additive migration;
3. update the plain PostgreSQL shim only when the migration uses a Supabase-managed surface absent from the shim;
4. add or update pgTAP coverage;
5. reset and test from an empty database;
6. test against the local Supabase stack;
7. apply the migration to the live Supabase project;
8. verify the hosted app against the live schema.

## UI workflow

Owner-facing work must include:

- understandable labels;
- active workspace context;
- loading and empty states;
- actionable errors;
- refresh/navigation recovery where data entry is involved;
- iPad and desktop layouts;
- no internal identifiers except governed public or scan IDs;
- direct links to the next logical action.

## Completion gate

Before claiming completion:

1. run all required repository checks;
2. confirm required CI is green;
3. push to the canonical deployment branch;
4. confirm Railway deployment success;
5. verify `/api/version` returns the final SHA;
6. run the task-specific hosted acceptance path;
7. update `docs/ai/CURRENT_STATE.md` with:
   - final SHA;
   - what changed;
   - what was verified;
   - known remaining limitations.

## Final response format

Unless a work order specifies otherwise, report only:

1. final commit SHA;
2. live URL;
3. CI result;
4. migrations applied;
5. owner workflows completed;
6. hosted acceptance result;
7. incomplete requirements with exact reasons;
8. newly discovered follow-up items.

Do not include a long narrative of routine implementation steps.