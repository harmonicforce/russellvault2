# Last Implementation Handoff

## Surrender state

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`
- Available base SHA: `a0f47470778cce7cd9a48ff872174871e78bb69d` (`Draft: Correct operational dashboard contracts`); its parent is `fba3ed1`, the local PR #29 merge. On the 2026-08-02 recheck the task checkout still contained no remote refs or PR #31 objects. The configured repository integration was unavailable, so updated remote `main`, PR #30/#31 state, later fixes, and commit `ad3ed0e4c12eb0ebcf5e78658d940b600990e856` could not be independently compared. No Workbench-owned files were modified or reconstructed.
- Implementation branch: `codex/correct-operational-dashboard-contracts`
- Final branch SHA: see the draft PR head/final report (this handoff is committed with the implementation).
- Pull request: draft metadata created after commit; no merge authorized.
- Migration: `20260801000900_operations_dashboard_contracts.sql`; repository-only, not applied live.
- Live Supabase, Railway, `/api/version`, hosted acceptance: not authorized and not checked.
- Production data/configuration/secrets touched: none.
- `docs/ai/CURRENT_STATE.md`: not edited.

## Confirmed defects fixed

- Governed panels now mount while the legacy dashboard request is pending or failed.
- Inventory Health uses one membership-checked server aggregate over available current records. It excludes inactive items, inactive/absorbed/zero-quantity lots, and serialized parent lots, and returns exact lot count/unit totals without a PostgREST row response.
- The work queue now considers active inventory and only `lifecycle = 'active'` media, so soft-deleted/reserved media does not satisfy missing-photo work.
- Priority candidates are bounded independently to 20 per rule, deduplicated by task key, deterministically sorted, then globally limited to 20.
- Canonical destinations are `needsLocation=1`, `needsPhotos=1`, `/inventory/current/:itemId`, and `/inventory/lots/:lotId`.
- Dependency failures are explicit HTTP 503 `panel_unavailable` responses rather than empty successes.

## Bounded incomplete behavior improved

- Workflow summaries now have a typed client contract and render governed Media/Photo Issues and Listing Prep counts with accepted filters.
- The movement-only panel is labeled **Recent Movements**.
- Priority copy identifies age points as inventory-record age, not exception age.

## Validation evidence

- `npm run typecheck`: passed, server and client.
- Focused tests: server 3 passed; client transport 2 passed.
- Rendered Dashboard regression tests: 3 passed, covering legacy pending/failure resilience, governed workflow values, canonical task/activity links, and four-panel refresh.
- `npm run test`: server 27 files/396 tests, client 27 files/369 tests, guard/audit 23 tests; passed.
- `npm run lint`: exit 0 with seven pre-existing warnings.
- `npm run build:ci`: passed; existing Vite large-chunk advisory remains.
- `npm run db:reset && npm run db:test`: blocked before reset because `psql` is absent (`spawnSync psql ENOENT`). The new migration therefore lacks local pgTAP execution evidence in this container.
- Exact-head GitHub CI and screenshot/browser validation: not available in this task environment.

## Limitations and next decision

No saved views, configurable priority weights, cost/value intelligence, or broad activity union was added. The Workbench-owned files and behavior were not modified. Rollback is a revert of this corrective commit and its unapplied migration. The owner must decide whether to accept the focused draft for CI/database-tier review; do not merge or deploy until the exact PR head has required CI and migration validation.
