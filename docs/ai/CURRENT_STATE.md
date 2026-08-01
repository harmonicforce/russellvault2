# Russell Vault Current State

Last reviewer update: 2026-08-01

This is the canonical operational ledger. Implementation agents must not edit it unless a work order explicitly grants a one-time exception.

## Deployment and verification

- Repository: `harmonicforce/russellvault2`
- Canonical and GitHub default branch: `main`
- Railway source branch: `main`
- Live app: `https://russellvault2-production.up.railway.app`
- Supabase project: `ykdyqnvmwpxhowbwhzqz`
- Last reviewed merge: `2f7a73ad4380c091da65db78a6f83a52f553d93c` (PR #25)
- Repository migration count: 47
- Exact PR-head CI run `30675105213`: success
- Required jobs green: build-and-verify, shadow-db-postgres-shim, shadow-db-supabase-stack, dev-advisory-report
- Railway deployment status on the reviewed merge: success
- Hosted Cycle Count acceptance steps 1–8: reported green by the owner

The repository documents do not independently prove the live Supabase migration ledger. Each migration-bearing release must verify live parity before acceptance.

## Confirmed owner-facing foundation

- Supabase authentication, workspace selection, and first-run workspace/location setup
- workspace-scoped locations
- multi-category single and batch intake with draft recovery
- Product → SKU → Lot → Item identity hierarchy
- serialized and lot-managed inventory
- Current Inventory with server-side paging, sorting, filtering, and URL-held state
- private inventory media and signed display URLs
- item and lot detail routes
- printable inventory labels
- scan/find and governed movement
- lot adjustments, recount, split, and merge with immutable history
- correction requests, review, supersession, and duplicate voiding
- Daily Workbench foundation
- deterministic database test runner and concurrency harness

## Shipped: governed Cycle Count

Cycle Count is implemented, merged, CI-green, deployed, and owner-smoke-tested.

Confirmed capabilities include:

- location-scoped count creation and frozen snapshots;
- blind initial and recount rounds;
- immutable round evidence and latest-round results;
- atomic keyed item and lot observations with replay/conflict outcomes;
- lifecycle locking across observe, submit, recount, resolution, completion, and cancellation;
- discrepancy review and multi-subject recount selection;
- governed resolution matrix with approval-required actions;
- durable failed-attempt and item-loss evidence;
- latest-result summaries that do not double-count historical rounds;
- owner-facing list, counting, review, completion, and audit surfaces;
- Workbench integration;
- rendered client tests, server tests, pgTAP, and genuine overlapping-session concurrency tests.

The CI-repair PR corrected stale test bindings and assertions without changing the governed Cycle Count schema or functions.

## Current known incomplete or weak areas

### Media

- multi-file progress and per-file retry need production hardening;
- reorder and rotation are not fully confirmed;
- atomic primary switching, deletion recovery, and orphan reconciliation need reinforcement;
- category-aware required-photo workflows remain incomplete.

### Acquisition and cost

- owner-facing acquisition-to-inventory receiving remains incomplete;
- landed-cost allocation and inventory cost-basis read models remain incomplete;
- source and cost review queues need owner-facing completion.

### Listing and sales operations

- Listing Prep and readiness workflows are incomplete;
- marketplace publishing remains out of scope unless explicitly authorized;
- sales, fulfillment, returns, and governed inventory exit are incomplete.

### Dashboard and acceptance infrastructure

- Dashboard and Workbench intelligence remain limited;
- saved views, explainable priority rules, aging, and cross-workflow activity are incomplete;
- broad Playwright coverage and release normalization remain future work;
- `15_acquisition_digest_parity.sql` has shown an intermittent local in-suite slowdown while passing standalone and CI.

## Recommended next-stage options

Choose one coherent vertical slice:

1. Listing Prep Command Center
2. Media and Photography Hardening
3. Acquisition Receiving and Landed Cost
4. Sales, Fulfillment, and Inventory Exit
5. Operational Dashboard and Inventory Intelligence

Recommended commercial sequence:

`acquisition/cost → listing prep → media hardening → sales/fulfillment → dashboard intelligence`

Media may be moved ahead of Listing Prep when photography is the immediate operational bottleneck.

## Stewardship note

Implementation evidence belongs in `LAST_IMPLEMENTATION_HANDOFF.md`. This file is updated only after independent review of repository state, CI, deployment evidence, live migration status when relevant, and hosted acceptance.
