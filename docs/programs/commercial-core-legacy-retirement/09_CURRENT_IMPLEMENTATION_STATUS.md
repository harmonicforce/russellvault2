# Commercial Core & Legacy Retirement — Current Implementation Status

Reviewed: 2026-08-21

This document is the **present-tense implementation overlay** for the Commercial Core program.

The numbered documents `00` through `08` remain the design, census, architecture, cutover, decision, and implementation-plan record. Do not rewrite their historical statements merely because later slices shipped. When a planning document says something like “nothing here is implemented,” read that as the state/intent of the planning artifact when authored, not as current repository status.

For exact current SHA, CI, deployment identity, and live migration parity, `docs/ai/CURRENT_STATE.md` remains canonical.

## Current release state

- current reviewed `main`: `a647b77a0f88fbaac9abc86430be58502a562bf9`
- canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`, established from Railway's deployed `VITE_SUPABASE_URL`
- repository governed migrations: 79
- canonical hosted governed ledger: 79 / 79 through `20260819000200_null_safe_acquisition_mutation_guards`
- current `main` CI: **RED** on push workflow `32265646383`
- failing required job: `shadow-db-supabase-stack`
- observed failure: 12-minute timeout while executing `supabase/tests/15_acquisition_digest_parity.sql`

No new feature merge should be treated as release-ready until required `main` CI is green.

## S0 — Safety prerequisites

### Implemented

- boot-time legacy write isolation
- governed application configuration/fail-closed mode handling
- legacy SQLite remains explicitly non-authoritative

### Remaining operational debt

- backup/restore evidence and timed restore rehearsal remain separate owner-controlled operational gates where required by cutover/release policy

S0 debt is not permission to fabricate or reconstruct production history from repository seeds.

## S1 — Acquisition foundation

**Status: complete for the approved S1 program scope.**

Implemented capabilities include:

- governed acquisition classification options/rules/history
- classification execution and owner override paths
- acquisition list, facets, and source-qualified detail reads
- governed payments and shipments
- acquisition-line exclusions/restoration semantics
- role/workspace isolation
- direct-write guards and append-only evidence protection
- NULL-safe fail-closed acquisition mutation guards

The latest guard repair is migration:

`20260819000200_null_safe_acquisition_mutation_guards`

## S1.6 — Governed UI foundation

**Status: complete.**

The application has:

- governed truth states rather than fake zeros/empties
- responsive design-system primitives
- fixed transactional reference surfaces
- customizable Workbench where customization changes perspective, never truth
- real-browser Chromium/WebKit quality gates, accessibility checks, overflow checks, focus behavior, and visual baselines

## S2 — Receiving, landed cost, and inventory cost basis

**Status: complete through S2.6.**

### S2.1 — receiving schema

Shipped.

### S2.2 — receiving functions and acceptance hardening

Shipped, including governed open/record/correct/cancel/submit/link/unlink/discrepancy/reconcile semantics, lock-order hardening, and concurrency coverage.

### S2.3 — receiving UI

Shipped owner/operator/viewer workflows for the governed receiving lifecycle.

### S2.4 — governed inventory cost basis

Shipped:

- `inventory_cost_basis`
- contribution/event history
- current/unresolved reads
- deterministic recompute
- explicit provenance
- currency separation
- FIFO accounting layers for lot-managed inventory
- evidence-bound serialized attribution rules
- unresolved/overage never represented as silent zero

### S2.4.1 — truth hardening and allocation withdrawal

Shipped. Cost-basis algorithm version is **1.1.0**.

### S2.5 — cost allocation owner surface

Shipped `/cost` workflow with proposal, confirmation, reversal, withdrawal/recovery, and derived-basis visibility.

### S2.6 — unresolved cost queue

Shipped owner-usable triage for evidenced unresolved cost states. Basis staleness remains deliberately **not evidenced** because the database does not publish a read-only current-input hash for comparison with stored recompute input hashes.

## S3 — Historical reconciliation and import

**Status: in progress. Reconciliation machinery exists; historical import has not executed.**

### S3.1 — reconciliation ledger

Shipped:

- append-only reconciliation runs
- per-key findings
- verdict/materiality evidence
- append-only adjudication history
- fail-closed cutover eligibility

The original timestamp/UUID ordering defect was repaired by merged PR #76 using deterministic insertion sequence as the tiebreak for same-transaction history.

PR #75 targets the same defect with a different unmerged approach and is superseded. It must not be merged into current main.

### S3.2 — deterministic offline reconciliation runner

Shipped in PR #74:

- fixed-artifact comparison
- L1 aggregate context
- full-union L2 per-key findings
- explicit compared fields/materiality
- deterministic ordering/hashing
- optional persistence through governed S3.1 functions

L1 totals are context only. **Matching totals are not reconciliation.**

### S3.3 — reconciliation review UI

**Next unbuilt application slice once required main CI is green.**

Required outcome:

- run list/detail
- L1 evidence
- complete L2 findings
- exact field differences/materiality
- filtering without changing underlying truth
- append-only owner adjudication history/actions
- authoritative database cutover eligibility and blocker reasons
- truthful loading/empty/partial/unavailable/unauthorized/error states

S3.3 must not perform historical import or recreate cutover truth in TypeScript.

### S3.4 — inventory import functions + duplicate scan

Not implemented.

### S3.5 — inventory import execution + adjudication

Not executed.

### S3.6 — acquisition import execution

Not executed.

### S3.7 — cost allocation import + conservation proof

Not executed.

### S3.8 — legacy-write cutover

Not executed.

## The 2,149 versus 2,119 acquisition-line question

Still unresolved at record level.

Known evidence:

- repository source/seed set: 2,149 acquisition/Whatnot purchase lines
- owner-attested production backup count: 2,119
- numerical difference: 30

Do **not** infer that the missing 30 are exactly the known food/candy subset. S3 reconciliation must compare the union of keys and produce a verdict for every key before restoration/import/cutover decisions.

## Approved continuation after S3

After S3 completes, the dependency order remains:

`S4 marketplace read connection → S6 orders/fulfillment → S7 returns/exit → S8 payout/profit → S5 reservations/drafts/publishing → S9A pricing → S9B AI → S10 data quality → S11 command center → S12 SQLite runtime removal`

SQLite removal remains last.

## Parallel reliability debt

These do not replace S3, but they block trustworthy progress when red:

- current `15_acquisition_digest_parity.sql` Supabase-stack timeout on `main`
- known nondeterministic `40_cycle_count_concurrency.sql` proof debt
- superseded PR #75 cleanup
- client GHSA-qwww-vcr4-c8h2 remains governed by the repository's explicit BrowserRouter/no-RSC conditional audit gate; raw client `npm audit` is not clean

## Evidence hierarchy

When sources disagree, resolve them in this order for the fact being claimed:

1. deployed configuration for deployment identity;
2. live governed database for live schema/data facts;
3. GitHub current branch/PR/workflow state for repository and CI facts;
4. `docs/ai/CURRENT_STATE.md` for independently reviewed project-state synthesis;
5. implementation handoffs and historical program documents as evidence, not automatic authority.

Do not convert a connector's inability to list or see something into proof that it does not exist.
