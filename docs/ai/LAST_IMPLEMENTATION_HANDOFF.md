# Last implementation handoff — S1.4

## Repository state

- Repository: `harmonicforce/russellvault2`; canonical target: `main`.
- Actual base: `0c01f1a93260a96c14b02d9420ce96b8764c87df` (PR #44 merge). S1.3 implementation head: `370b8728ff3247bddfe92f335024203cb0b2d5c4`.
- S1.3's first exact-head Supabase-stack failure occurred during GitHub runner setup (`Service Unavailable / Failed to resolve action download info`) before checkout; it was not a demonstrated repository failure.
- Branch: `codex/s1-4-acquisition-detail-payments-shipments`.
- Implementation commit: `4522b6485de1c3851d8a783b2c978ff7d36a9439`. The final handoff commit follows it.
- Draft PR and exact-head CI are blocked: this container has no `origin` remote, no GitHub authentication, and exposes no `make_pr` tool. No PR was fabricated.

## Implemented S1.4 slice

- Additive migration `20260806000200_acquisition_payments_shipments_detail.sql`; migration ledger 63 → 64.
- `acquisition_payments`: positive bigint minor units, explicit currency, closed instrument, same-workspace order/source evidence, append-only semantic fields, governed one-time reversal, request idempotency, and active external-reference protection.
- `record_acquisition_payment(uuid,text,timestamptz,bigint,text,text,text,uuid,text,text)` permits owner/operator; `reverse_acquisition_payment(uuid,text,text,text)` permits owner only.
- `acquisition_shipments`: same-workspace order/source evidence, deterministic tracking identity, informational shipping reference amount, closed status and timestamp constraints, request idempotency, and governed state updates.
- `create_acquisition_shipment(uuid,text,text,text,timestamptz,timestamptz,text,bigint,text,uuid,text,text)` and `transition_acquisition_shipment(uuid,text,text,text,timestamptz,text,text)` permit owner/operator.
- Transition graph: expected → in_transit/delivered/lost/cancelled; in_transit → delivered/lost/cancelled; lost → in_transit/delivered/cancelled; delivered/cancelled terminal.
- `get_acquisition_line_detail(uuid,text)` returns committed governed-native coverage, line/order/current placement, classification/options/history, payment history and currency-safe summary, shipments/allowed transitions, and bounded evidence.
- Classification wrappers resolve authorized public IDs and delegate to merged S1.2 functions. Automatic classification permits owner/operator; override permits owner only.
- HTTP routes: line detail/classify/override, order payment/create shipment, payment reversal, and shipment transition. Routes use caller JWT only and bounded error codes.
- Client route `/acquisitions/:publicId`, list navigation with preserved URL state, responsive cards/forms, persistent coverage truth, role-aware controls, and safe decimal-to-minor-unit conversion.
- Audit vocabulary: `acquisition_payment_recorded`, `acquisition_payment_reversed`, `acquisition_shipment_created`, `acquisition_shipment_transitioned`.
- Focused pgTAP: `59_acquisition_payments_shipments.sql` (18 assertions). Full local pgTAP passed with 1,866 assertions after one isolated rerun; an earlier concurrent run had one pre-existing Cycle Count race assertion fail while S1.4 tests passed. Root tests passed: server 463, client 558, script guards 23.

## Scope and operations

No receipt/receipt-line/discrepancy/exclusion/cost-basis/historical-import schema or UI was added. Legacy SQLite and `docs/ai/CURRENT_STATE.md` are unchanged. No hosted Supabase, hosted migration, Railway, production data, merge, or deployment action was authorized or performed. Next slice is S1.5 governed acquisition-line exclusions.

Rollback is branch/commit reversion before merge. Exact next action: restore an authenticated GitHub remote/tool, push this branch, create the one draft PR, and obtain all four exact-head CI conclusions. The work must not be represented as PR-green until then.
