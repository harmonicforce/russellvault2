# Last Implementation Handoff

- Agent: Claude, followed by reviewer stewardship correction
- Date: 2026-07-29
- Base branch: `claude/ui-better-spreadsheet-cjhwjb`
- Base SHA: `16ac93a` (operations-slice base recorded in current state)
- Working branch: `claude/ui-better-spreadsheet-cjhwjb`
- Head SHA: `990b83eea26f8de4b3987204471d95ea6c21e270`
- PR: historical mega-PR line; not a useful review unit

## Requested scope

Complete the operations slice over the governed inventory model, then correct repository governance so implementation agents no longer edit the reviewer-owned current-state ledger.

## Completed in this checkpoint

- Governed inventory subtype persisted at commit and frozen thereafter.
- Workspace-wide server-backed inventory pagination, sorting, filtering, expanded search, and exact-identifier ranking.
- Bulk movement with per-record outcomes and retry-failures-only behavior.
- Governed lot adjustments, recount, split, and merge with append-only quantity history and lineage.
- Governed correction request/review/supersession flow.
- Six migrations applied to live Supabase, bringing the recorded total to 35.
- `WORK_ORDER_PROTOCOL.md` corrected so Claude must provide evidence rather than edit `CURRENT_STATE.md`.

## Files and migrations changed

See `docs/ai/CURRENT_STATE.md` under “Shipped: operations slice (2026-07-28)” for the six migrations and the reviewed capability summary. The final governance correction at `990b83e` changes `docs/ai/WORK_ORDER_PROTOCOL.md` only.

## Validation actually run

| Command/check | Result |
|---|---|
| Client tests | 281 passed at the operations-slice checkpoint |
| Client typecheck | passed |
| Client build | passed |
| Lint | passed with 3 pre-existing fast-refresh warnings |
| Full pgTAP against reset plain-PostgreSQL shim | passed |
| Live Supabase migration inspection | 35 migrations confirmed; four inventory read models confirmed SECURITY INVOKER |
| Hosted Railway acceptance | not verified by the implementation environment; egress was blocked with 403 CONNECT |

## Current production branch

- Owner-confirmed on 2026-07-30: Railway deploys from `main`.
- `main` is therefore both the canonical stable branch and the Railway deployment branch.
- The older statement that production still used `claude/ui-better-spreadsheet-cjhwjb` is superseded.
- An incoming agent must still inspect the actual `main` head and compare it with any newer work branches before implementation.

## Not run or not verified

- Hosted `/api/version` and end-to-end Railway acceptance were not verified by the prior implementation environment.
- The local Supabase-stack concurrency suite is not reliably green because `26_intake_concurrency.sql` can hang nondeterministically.

## Known issues and risks

- `supabase/tests/26_intake_concurrency.sql` can deadlock its own harness after the bounded busy-wait expires, then block forever in `dblink_get_result`.
- Cycle counts are not implemented.
- Media hardening, owner-facing acquisition/cost completion, Listing Prep, release tags, and hosted Playwright remain incomplete.
- Branch ancestry and exact head alignment must be verified before starting new implementation; do not assume the former Claude-named line is ahead of `main`.

## Owner-only actions

- Authorize any production deployment or configuration change beyond the existing `main` deployment.
- Provide access or perform hosted acceptance where the implementation environment cannot reach Railway.

## Exact next step

First independently establish the current `main` head, open PRs, and any unmerged descendants. Then choose one coherent vertical slice. The recommended engineering sequence is:

1. repair the nondeterministic `26_intake_concurrency.sql` harness without weakening its real concurrency guarantee;
2. then implement governed Cycle Count as the next inventory-control slice, including frozen scope/snapshot, blind counting, serialized and lot-managed counts, discrepancy/recount/resolution workflows, Workbench integration, browser coverage, migrations, and complete evidence reporting.

The incoming agent must independently verify this handoff and must not edit `CURRENT_STATE.md`.
