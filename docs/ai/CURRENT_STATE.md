# Russell Vault Current State

Last reviewer update: 2026-07-29

This is a maintained operational ledger, not a complete project history. The project reviewer updates it after independently reviewing substantial work orders. Implementation agents must not edit it.

## Deployment

- Repository: `harmonicforce/russellvault2`
- Canonical branch: `main`
- Live app: `https://russellvault2-production.up.railway.app`
- Supabase project: `ykdyqnvmwpxhowbwhzqz`
- Last reviewed commit: `d703174f1b96103f6ca55c5e4bdab6d1d20d82f9`
- Live Supabase schema reported at 37 migrations

The context-document commit is not evidence that hosted product behavior changed.

## Confirmed implemented foundation

- Supabase authentication and workspace selection
- first-run workspace/location setup
- workspace-scoped locations
- multi-category Intake Hub
- graded card, raw card, sealed TCG, footwear, apparel, electronics, and other-collectible intake forms
- governed preview and idempotent commit flow
- single-item draft recovery
- Batch Intake with independent row outcomes and draft recovery
- Product → SKU → Lot → Item identity hierarchy
- serialized and lot-managed inventory
- Current Inventory combining individual Items and quantity Lots
- private inventory media and signed display URLs
- item and lot detail routes
- browser-printable inventory labels
- scan/find workflow
- item movement and whole-lot movement with immutable history
- Daily Workbench foundation
- plain PostgreSQL and local Supabase database test jobs
- governed inventory subtype, persisted at commit and frozen thereafter
- server-backed pagination, sorting, filtering, and URL-held query state
- expanded identity and location search with exact identifier ranking
- real bulk movement with per-record results and failure-only retry
- governed lot adjustments, recount, split, and merge with append-only history and lineage
- governed correction requests, review, supersession, and duplicate voiding without deleting or rewriting committed identity
- bounded database-test execution with explicit timeout failure reporting
- deterministic concurrent-intake harness that collects whichever worker completes first while preserving the real locking race

## Recently corrected

- database CI and storage shim compatibility
- unified Current Inventory instead of serialized-card-only inventory
- single-item draft persistence and reconciliation
- safer batch session recovery
- prevention of copying unique identifiers into “Add another like this”
- graded-card quantity removal
- server-side unique-unit identifier reinforcement
- Workbench Needs Location filter alignment
- correction and supersession workflow for immutable identity
- false-positive certificate search fixture caused by use of the grading-company argument
- intermittent self-deadlock in `26_intake_concurrency.sql`
- database runner treating a hung file as an anonymous or incomplete run instead of an explicit failure

## Known incomplete or weak areas

These are not automatically in scope for every task.

### Inventory browsing

- work-status filters remain undefined because no work-status concept exists yet
- “needs source review” and “ready for listing prep” await acquisition and listing-prep features

### Corrections and quantity control

- cycle counts are not implemented
- resolving an approved correction is a two-step operator flow; there is no guided correction wizard

### Media

- photo reorder and rotation are not confirmed
- atomic primary-media switching should be verified
- deletion recovery and orphan cleanup should be reinforced
- per-file upload retry/progress may be incomplete

### Acquisition, cost, and listing

- owner-facing acquisition-to-inventory receiving is incomplete
- landed-cost allocation is incomplete
- inventory cost-basis read models are incomplete
- Listing Prep is incomplete
- marketplace publishing remains out of scope unless explicitly requested

### Repository and verification

- hosted Railway acceptance remains unverified from the implementation environment because outbound access is gateway-blocked
- release tags are blocked by the git proxy returning 403
- hosted Playwright coverage should be added or verified
- local Supabase-stack repetition was not available for the concurrency work because Docker was unavailable; the stack CI job passed
- `15_acquisition_digest_parity.sql` can intermittently exceed the new per-file timeout in a full local suite while remaining fast standalone and in CI; the observed function is CPU-active with no lock wait, and the cause is unresolved

## Shipped: operations and corrections slice

Migrations added and reported live:

- `20260728000800_inventory_subtype`
- `20260728000900_inventory_read_model_operations`
- `20260728001000_lot_quantity_governance`
- `20260728001100_read_model_lot_state`
- `20260728001200_inventory_corrections`
- `20260728001300_read_model_record_state`

New governed functions include `adjust_lot_quantity`, `recount_lot_quantity`, `split_inventory_lot`, `merge_inventory_lots`, and `lot_merge_compatibility`. `move_inventory_lot` refuses empty and absorbed lots.

`inventory_record_overview` is a SECURITY INVOKER union over both inventory grains. Serialized parent lots and absorbed lots are excluded from current stock totals but remain available through lot detail views.

Corrections use a claim, review, and separate resolution model. Approval does not mutate or resolve the named record. Superseded records retain their identifiers, photos, and history; duplicates are voided and linked to the survivor without transferring quantity.

Reported verification for the slice: 281 client tests, clean typecheck and build, three pre-existing lint warnings, full ordered pgTAP success, and live schema/security checks. Hosted acceptance was blocked.

## Shipped: concurrency harness reliability

Reviewed commit: `d703174f1b96103f6ca55c5e4bdab6d1d20d82f9`.

No production code or migrations changed. Four files changed:

- `supabase/tests/26_intake_concurrency.sql`
- `scripts/db/test.mjs`
- `.github/workflows/ci.yml`
- `scripts/db/concurrency-deadline-proof.mjs`

Root cause: each proof launched two overlapping workers but collected results in fixed connection order. Exactly one worker is expected to wait on the other. Collecting the loser first blocked forever because the winner could not commit while the harness waited on the blocked loser.

The harness now waits for whichever connection becomes ready first, collects and commits that winner, then waits for the second. Deadlines raise SQLSTATE `55P03` with live activity diagnostics. Poll loops clear the PostgreSQL statistics snapshot so state changes are visible.

Failure cleanup terminates captured worker PIDs and re-raises the original error. This is intentionally stronger than `dblink_cancel_query` or disconnect alone, which did not reliably stop a blocked backend in testing.

The database runner now announces each file before execution, applies finite file and suite timeouts, checks exit codes and signals, reports timeouts as failures, and sweeps abandoned backends before aborting. Both database CI steps have outer time limits and strict shell handling.

Verification reviewed:

- focused shim test: 20/20 twice, 17 assertions each, no orphaned workers, roughly 2.6 seconds per run
- intentional deadline proof: bounded nonzero failure with diagnostics and cleanup
- timeout proof: forced file timeout reported as failure, not success
- full local suite: 3/5 due to the separate intermittent test-15 issue
- local Supabase repetition: unavailable because Docker was unavailable
- GitHub Actions run `30479965417`: all four required jobs reported green, including the Supabase-stack job that previously hung

The duplicate-prevention race and original assertions remain intact; only safe result-ordering and harness failure behavior changed.

## Next-work guidance

Choose one coherent vertical slice.

Recommended order:

1. cycle-count workflow
2. media hardening
3. acquisition receiving and landed-cost allocation
4. inventory cost-basis read models
5. Listing Prep and Workbench queues
6. hosted Playwright acceptance and release normalization

Treat the intermittent `15_acquisition_digest_parity.sql` slowdown as a separate focused reliability task if it begins affecting CI or blocks repeated validation of another slice.
