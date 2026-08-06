# Last implementation handoff — S1.5 governed acquisition-line exclusions

## Lineage and authority

- PR #49 implementation head: `42bfb9f57f3f9323a96899a5e725389c43f0f7e1`.
- PR #49 merge: `551cbb747be42285622f7a1c1f311145f755e1ed`.
- PR #49 historically had no exact-head Actions run; S1.5 does not reopen S1.4.
- Actual S1.5 base: `551cbb747be42285622f7a1c1f311145f755e1ed` (the supplied environment had no configured Git remote, so the base was verified from local history).
- Branch: `codex/s1-5-acquisition-line-exclusions`. Draft PR and canonical CI evidence must be recorded after publication.

## Implemented vertical slice

Migration `20260806000700_acquisition_line_exclusions.sql` adds the append-only `excluded` / `included` decision history, `RV-AEXCL` governed IDs, same-workspace composite line and successor references, one-current-row partial uniqueness, workspace-global operation-key uniqueness, RLS member reads, owner-only SECURITY DEFINER operations, and audit events `acquisition_line_excluded` / `acquisition_line_restored`.

Public signatures:

- `exclude_acquisition_line_by_source(uuid, text, text, text, text)`
- `restore_acquisition_line_by_source(uuid, text, text, text, text)`

Both normalize the required reason, validate the bounded key, resolve only a committed source-qualified governed-native line, serialize keys and target lines with transaction advisory locks, replay identical payloads without new history/audit, and reject changed payloads as `idempotency_conflict`. Operators/viewers can read current/history state but cannot mutate. Anonymous has no table or function capability.

The list contract adds current state, current exclusion identity/reason/time/actor and an `included`/`excluded` filter; facets count each current line once by exclusion state. Detail adds current decision plus deterministic table-derived history. Excluded lines stay visible. `app.assert_acquisition_line_eligible_for_downstream(uuid,uuid)` is internal-only and raises `acquisition_line_excluded` for a current exclusion.

Server routes are owner-only, caller-JWT-bound `POST .../exclude` and `POST .../restore`; bounded errors redact dependency details. Client transport is source-qualified. The list includes a URL-backed eligibility filter and excluded badge. Detail supplies read-only state/history for all members and reason-required owner exclusion/restoration controls.

## Verification and boundaries

Baseline reset and all 62 pre-S1.5 pgTAP files passed (2,141 assertions), including S1.4 and dblink concurrency. S1.5 reset and focused/full/repository test totals, final SHA, PR, exact canonical GitHub head, workflow run, and four job conclusions are publication-time evidence and must not be inferred before they run.

No receiving/receipt/discrepancy schema, cost basis, historical import, marketplace work, SQLite change, Railway work, hosted Supabase access/migration, S1.6 implementation, S2 implementation, or `CURRENT_STATE.md` edit is authorized or included.

## Next checkpoint and remaining risks

After owner approval of its separate plan, the next engineering checkpoint is **S1.6 — Governed UI Foundation and Russell Vault Design System**, not S2. Before surrender, record exact-head CI and expand genuine overlapping dblink exclusion decision coverage if it is not present in the final pgTAP suite.
