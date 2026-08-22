# Russell Vault Project Roadmap

This roadmap orders major owner-facing product slices. It is not permission to begin, merge, migrate, deploy, or release a slice without the required work-order authority and gates.

Consult `CURRENT_STATE.md` and `CURRENT_STATE.attestation.json` for the reviewed SHA, CI state, deployment-identity status, and live migration parity. This file describes sequence, not moment-to-moment release health.

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
- Daily Workbench foundation
- governed Cycle Count with blind rounds, recounts, resolutions, audit, CI, deployment, and hosted smoke acceptance
- S1.6 governed UI/design-system foundation and browser quality gate
- customizable governed Workbench

## Completed Commercial Core slices

Re-proved from executable code at the reviewed SHA. Earlier revisions of this file still listed Acquisition Receiving and Landed Cost as an unstarted "next-stage option" long after it shipped.

### S1 — Acquisition foundation

Complete for the approved scope: governed classification and rules, list/detail read surfaces, payments and shipments, exclusion/restoration semantics, owner/operator/viewer authority boundaries, and NULL-safe fail-closed acquisition mutation guards.

### S2 — Receiving, landed cost, and inventory cost basis

Complete through S2.6: receiving schema, receiving functions and acceptance hardening, governed receiving UI, governed inventory cost basis and recompute, cost-basis truth hardening and allocation withdrawal, cost allocation owner surface, and the unresolved cost queue. The cost machinery exists before historical import, as the dependency plan requires.

### S3 — Historical reconciliation and import

Completed so far: S3.1 append-only reconciliation ledger, the deterministic reconciliation ordering repair, and S3.2 deterministic offline reconciliation runner with its governed ledger adapter.

Historical production data has **not** been imported.

## Next approved owner-facing slice

### S3.3 — Reconciliation Review UI

Turn the S3.1/S3.2 evidence machinery into an owner-usable review workflow:

- reconciliation run list and detail;
- L1 aggregate evidence shown as context, never as proof of record-level parity;
- complete L2 per-key findings across the union of keys;
- exact field differences and materiality;
- append-only adjudication history and governed owner actions;
- authoritative cutover eligibility and blocker reasons read from the database;
- loading, empty, partial, unavailable, unauthorized, and error truth states;
- no historical import or cutover performed by the review UI.

## Remaining S3 execution order

After S3.3 and only after its gates pass:

4. **S3.4** inventory import functions and duplicate scan
5. **S3.5** inventory import execution and owner adjudication
6. **S3.6** acquisition import execution
7. **S3.7** cost allocation import with conservation proof
8. **S3.8** governed cutover and retirement of legacy write handlers

Historical reconciliation must answer the repository 2,149 acquisition-line set against the owner-attested 2,119 production-backup count record-by-record. Do not assume the 30-row difference is the known food subset without key-level evidence.

## Post-S3 commercial sequence

1. Listing Prep Command Center
2. Media and Photography Hardening
3. Sales, Fulfillment, and Inventory Exit
4. Operational Dashboard and Inventory Intelligence

Media may precede Listing Prep when photography is the immediate operational bottleneck. Dashboard should consume established workflow facts rather than invent provisional status models.

## Reliability and platform track

These may be scheduled as focused work orders when they block product work:

- broadened Playwright and hosted acceptance coverage;
- generated database-type synchronization;
- release/tag normalization;
- `15_acquisition_digest_parity.sql` local slowdown investigation;
- timed restore rehearsal before broad cutover;
- media orphan cleanup and storage reconciliation;
- branch cleanup after confirming no unique commits remain.

## Deferred or explicitly out of scope

- public storefront and customer accounts
- billing and tax filing
- unrestricted automated marketplace publishing
- fabricated market prices or AI inventory identification
- destructive deletion of committed inventory
- replacement of the governed inventory hierarchy

## Roadmap maintenance

The owner selects the active slice. Implementation agents may report newly discovered work but must not silently reorder the roadmap or expand scope. ChatGPT reconciles shipped state into `CURRENT_STATE.md` after independent review.
