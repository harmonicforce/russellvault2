# Russell Vault Project Roadmap

This roadmap orders major owner-facing product slices. It is not permission to begin or release a slice without a work order.

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

## Next-stage options

### A. Acquisition Receiving and Landed Cost

Complete the owner path from purchase/order through receiving, shared-cost allocation, unknown-cost review, and inventory cost-basis read models.

### B. Listing Prep Command Center

Create category-aware preparation requirements, readiness blockers, photos/condition/pricing/package workspaces, Ready to List queues, and audit history. Automated marketplace publishing remains out of scope unless separately authorized.

### C. Media and Photography Hardening

Add reliable multi-file uploads, per-file progress/retry, ordering, atomic primary selection, rotation, recovery, orphan reconciliation, and category-aware required-photo sets.

### D. Sales, Fulfillment, and Inventory Exit

Connect sales to governed inventory exit, fulfillment, tracking, fees, refunds, returns, and profit after known costs.

### E. Operational Dashboard and Inventory Intelligence

Build explainable priority queues, inventory health, aging, saved views, recent governed activity, and drill-down metrics.

## Recommended commercial sequence

1. Acquisition Receiving and Landed Cost
2. Listing Prep Command Center
3. Media and Photography Hardening
4. Sales, Fulfillment, and Inventory Exit
5. Operational Dashboard and Inventory Intelligence

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
