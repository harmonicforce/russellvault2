# Last implementation handoff — S1.4 acceptance hardening

## Repository state

- Repository `harmonicforce/russellvault2`; target `main`; base `d5a5ef71a067ab768e650a91b3efa52eb8cb5746` (PR #45 merge).
- PR #45 implementation head: `3e5926207228822d34ee2b7d8b93474cee8dc9f5`; merge: `d5a5ef71a067ab768e650a91b3efa52eb8cb5746`.
- Branch: `codex/s1-4-acceptance-hardening`.
- The original `59_acquisition_payments_shipments.sql` remains its 18 structural assertions; PR #45 had no focused rendered-client acceptance or complete route-contract suite.

## Implemented repairs

- Additive migration `20260806000300_acquisition_payments_shipments_hardening.sql` (repository ledger 64 → 65); the merged migration was not edited.
- Append-only `acquisition_payment_reversals` and `acquisition_shipment_transitions` ledgers with governed public IDs, same-workspace FKs, workspace-global keys, canonical JSON SHA-256 fingerprints, actors/times/reasons, RLS, and denied direct authenticated writes.
- Payment create now prevalidates source evidence and distinguishes duplicate external reference. Reversal uses the ledger before state, links payment to its event, and replays durably.
- Shipment create restricts initial state and distinguishes duplicate tracking/source/currency/reference validation. Transition replay is ledger-authoritative, locks state, records applied/no-op outcome, and audits applied transitions only.
- Server bounded mappings include duplicate reference/tracking, invalid source/initial state, stale state, idempotency and integrity failures without returning database text.
- Client no longer creates the reversal key inside the mutation function, removes prompt-based reasons, exposes reason inputs, restricts initial shipment state, and includes shipment timestamps and reference amount/currency.
- Focused pgTAP `60_acquisition_payment_shipment_execution.sql`: 30 assertions. Baseline full pgTAP before edits: 1,866 assertions. Final totals and exact-head CI are recorded after final verification.

## Scope and operations

No exclusion, receipt, receiving, discrepancy, cost-basis, historical-import, or SQLite work. `docs/ai/CURRENT_STATE.md` is unchanged. No hosted Supabase, hosted migration, Railway, production-data, merge, or deployment action. S1.5 may start only after this hardening PR is green.

Rollback: revert the hardening commit before merge. Next decision: review the green draft PR; do not merge as part of this work order.
