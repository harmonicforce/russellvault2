# Russell Vault Project Roadmap

This roadmap orders major owner-facing product slices. It is not permission to begin, merge, migrate, deploy, or release a slice without the required work-order authority and gates.

Consult `CURRENT_STATE.md` for the reviewed current SHA, CI state, deployed Supabase identity, and live migration parity. This file describes sequence, not moment-to-moment release health.

## Completed foundation

- authentication, workspaces, and first-run setup
- storage locations
- multi-category single and batch intake
- Product → SKU → Lot → Item identity
- serialized and lot-managed Current Inventory
- private media foundation
- labels and scan/find
- governed item and lot movement
- quantity adjustment, recount, split, and merge
- correction, supersession, and duplicate-void workflows
- governed Cycle Count with blind rounds, recounts, resolutions, audit, UI, CI, deployment, and hosted smoke acceptance
- S1.6 governed UI/design-system foundation and browser quality gate
- customizable governed Workbench

## Completed Commercial Core slices

### S1 — Acquisition foundation

Complete for the approved scope:

- governed acquisition classification and rules
- acquisition list/detail read surfaces
- payments and shipments
- exclusions/restoration semantics
- owner/operator/viewer authority boundaries
- NULL-safe fail-closed acquisition mutation guards

### S2 — Receiving, landed cost, and inventory cost basis

Complete through S2.6:

1. S2.1 receiving schema
2. S2.2 receiving functions and acceptance hardening
3. S2.3 governed receiving UI
4. S2.4 governed inventory cost basis and recompute
5. S2.4.1 cost-basis truth hardening and allocation withdrawal
6. S2.5 cost allocation owner surface
7. S2.6 unresolved cost queue

The cost machinery exists before historical import, as required by the dependency plan.

### S3 — Historical reconciliation and import

Completed so far:

1. **S3.1** append-only reconciliation ledger
2. deterministic reconciliation ordering repair
3. **S3.2** deterministic offline reconciliation runner and governed ledger adapter

Historical production data has **not** been imported yet.

## Current release blocker

Before the next feature merge, required `main` CI must be green. As of the current reviewed state, the Supabase-stack job on the latest `main` push timed out in `15_acquisition_digest_parity.sql`. See `CURRENT_STATE.md` for the exact SHA and workflow run.

Product work may be prepared on isolated branches, but a red required `main` gate is not to be ignored or reclassified as green because a PR-head run or Railway deployment succeeded.

## Next approved owner-facing slice

### S3.3 — Reconciliation Review UI

Turn the S3.1/S3.2 evidence machinery into an owner-usable review workflow.

Required outcome:

- reconciliation run list/detail;
- L1 aggregate evidence shown as context, never as proof of record-level parity;
- complete L2 per-key findings across the union of keys;
- exact field differences and materiality;
- append-only adjudication history and governed owner actions;
- authoritative cutover eligibility and blocker reasons from the database;
- loading, empty, partial, unavailable, unauthorized, and error truth states;
- no historical import or cutover performed by the review UI.

## Remaining S3 execution order

After S3.3 and only after its gates pass:

4. **S3.4** inventory import functions + duplicate scan
5. **S3.5** inventory import execution + owner adjudication
6. **S3.6** acquisition import execution
7. **S3.7** cost allocation import + conservation proof
8. **S3.8** governed cutover and retirement of legacy write handlers

The historical reconciliation must answer the repository 2,149 acquisition-line set versus the owner-attested 2,119 production-backup count record-by-record. Do not assume the 30-row difference is the known food subset without key-level evidence.

## Post-S3 commercial sequence

The approved high-level continuation remains:

1. **S4 — Marketplace connection, read-only first**
2. **S6 — Order and fulfillment ingestion**
3. **S7 — Refunds, returns, and governed inventory exit**
4. **S8 — Payout and realized-profit reconciliation**
5. **S5 — Reservations, listing drafts, and controlled publishing**
6. **S9A — Pricing and valuation**
7. **S9B — Evidence-bound AI Copilot**
8. **S10 — Governed data-quality controls**
9. **S11 — Command center dashboard**
10. **S12 — SQLite runtime removal, last**

Marketplace reads precede writes. Publishing must not create obligations the order/return/payout model cannot reconcile.

## Parallel reliability and platform track

These are focused repairs, not replacements for the commercial sequence, and should be taken when they block trustworthy delivery:

- restore required `main` CI to green when any mandatory job is red;
- repair the known nondeterministic `40_cycle_count_concurrency.sql` proof without weakening real concurrency;
- keep production Supabase identity tied to deployed Railway configuration rather than stale prose;
- maintain generated database-type synchronization where required;
- normalize release/tag evidence;
- complete timed restore rehearsal before broad cutover;
- harden media upload/recovery/orphan reconciliation;
- close superseded branches and PRs only after confirming no unique required work remains.

## Deferred or explicitly out of scope

- public storefront and customer accounts
- billing and tax filing
- unrestricted automated marketplace publishing
- fabricated market prices or AI inventory identification
- destructive deletion of committed inventory
- replacement of the governed inventory hierarchy

## Roadmap maintenance

The owner selects the active slice. Implementation agents may report newly discovered work but must not silently reorder the roadmap or expand scope. ChatGPT reconciles independently verified shipped state into `CURRENT_STATE.md`.
