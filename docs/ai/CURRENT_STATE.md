# Russell Vault Current State

Last reviewer update: 2026-08-21

This is the canonical operational ledger. Implementation agents must not edit it unless a work order explicitly grants a one-time exception.

## Deployment identity and verification

- Repository: `harmonicforce/russellvault2`
- Canonical and GitHub default branch: `main`
- Railway source branch: `main`
- Live app: `https://russellvault2-production.up.railway.app`
- Canonical deployed Supabase project: `ncyqqitqtsyjrijieykd`
- Railway `VITE_SUPABASE_URL`: `https://ncyqqitqtsyjrijieykd.supabase.co`
- `ykdyqnvmwpxhowbwhzqz` is a different Supabase project and is not the database configured by the deployed Railway service.
- Current reviewed `main` SHA: `a647b77a0f88fbaac9abc86430be58502a562bf9` (merge of PR #77).
- Repository governed migration count at that SHA: **79**.
- Hosted `ncyqqitqtsyjrijieykd` governed migration ledger: **79 / 79**, through `20260819000200_null_safe_acquisition_mutation_guards`.
- Railway deployment status on the reviewed merge: success.

### Production identity rule

The deployed Railway Supabase URL is authoritative for deciding which Supabase project is production. Before any live migration, reset, restore, acceptance, or parity claim, verify the project ref from the deployed environment. Project names, repository prose, agent memory, and scoped Supabase project listings are not sufficient substitutes.

## Current CI state: RED

`main` is currently red and new merge/release claims are blocked until the failing required job is diagnosed and repaired.

Main push workflow:

- run: `32265646383`
- event: `push`
- head: `a647b77a0f88fbaac9abc86430be58502a562bf9`
- overall conclusion: **failure**
- `build-and-verify`: green
- `shadow-db-postgres-shim`: green
- `dev-advisory-report`: green
- `shadow-db-supabase-stack`: **failed by 12-minute timeout** while executing `supabase/tests/15_acquisition_digest_parity.sql`

The exact PR-head workflow immediately before merge, run `32265592383`, was green on all four required jobs. That does not override the later red `main` push workflow.

Do not describe `main` as green until a required push workflow on the current main SHA completes successfully.

## Completed platform and governed foundation

Confirmed shipped capabilities include:

- Supabase authentication, workspace selection, and first-run workspace/location setup;
- workspace-scoped locations;
- multi-category single and batch intake with draft recovery;
- Product → SKU → Lot → Item governed identity;
- serialized and lot-managed inventory;
- Current Inventory with server paging/sorting/filtering and URL-held state;
- private media foundation, labels, scan/find, and governed movement;
- lot adjustment, recount, split, merge, correction, supersession, and duplicate voiding;
- governed Cycle Count with blind rounds, recounts, resolutions, audit, owner UI, and concurrency coverage;
- S1.6 governed UI/design-system foundation and browser quality gate;
- customizable governed Workbench with truth-state discipline;
- governed acquisition classification, read/detail surfaces, payments, shipments, and exclusions;
- governed receiving lifecycle and owner UI;
- governed cost allocation, withdrawal/recovery, inventory cost-basis derivation, and unresolved-cost owner queue.

## Commercial Core status

### S0 — Safety prerequisites

Implemented through the boot-write isolation and governed configuration work. S0.3 hosted/backup rehearsal remains deferred operational debt and is not evidence for live data restoration by itself.

### S1 — Acquisition foundation

Complete for the planned program scope, including classification, detail/read surfaces, payments/shipments, and exclusions. The latest acquisition mutation guards are NULL-safe and fail closed when their custom GUCs are unset.

### S2 — Receiving, landed cost, and inventory cost basis

Complete through **S2.6**:

- S2.1 receiving schema;
- S2.2 governed receiving functions and hardening;
- S2.3 receiving UI;
- S2.4 inventory cost-basis schema/recompute;
- S2.4.1 truth hardening and allocation withdrawal;
- S2.5 cost allocation owner surface;
- S2.6 unresolved cost queue.

Cost-basis algorithm is at version **1.1.0**. Currencies remain separate. Unresolved or overage basis is never silently rendered as zero.

### S3 — Historical reconciliation and import

Implemented:

- **S3.1** governed append-only reconciliation ledger;
- deterministic reconciliation ordering repair merged in PR #76;
- **S3.2** deterministic offline reconciliation runner and governed persistence adapter merged in PR #74.

Not yet implemented:

- **S3.3 reconciliation review UI**;
- S3.4 inventory import functions + duplicate scan;
- S3.5 inventory import execution + adjudication;
- S3.6 acquisition import execution;
- S3.7 cost allocation import + conservation proof;
- S3.8 cutover removal of legacy write handlers.

Historical import has **not** been executed. The 2,149 repository acquisition-line set versus the owner-attested 2,119 production-backup count still requires record-level reconciliation. Never assume the 30-row difference is the known food subset without key-level proof.

## Open repository/process debt

- `main` red on the Supabase-stack `15_acquisition_digest_parity.sql` timeout. This is the top blocker.
- `supabase/tests/40_cycle_count_concurrency.sql` has a known nondeterministic concurrency/timestamp assertion debt and should be repaired without weakening the genuine race proof.
- PR #75 remains open but is superseded by merged PR #76 and should not be merged.
- The client dependency audit continues to report GHSA-qwww-vcr4-c8h2; the repository's explicit BrowserRouter/no-RSC conditional audit gate is the accepted current policy. Do not call raw client `npm audit` clean.
- Cost-basis staleness is not currently evidenced because the database does not publish a read-only current-input hash for comparison with the stored recompute hash.

## Next product slice

Once required `main` CI is green, the next approved application slice is:

**S3.3 — Reconciliation Review UI**

It should extend the owner review workflow with reconciliation runs, L1 evidence, complete L2 findings, exact field differences, materiality, append-only adjudication history/actions, and authoritative cutover eligibility. It must not perform historical import or independently reimplement cutover truth in TypeScript.

After S3.3, continue in the approved order: S3.4 → S3.5 → S3.6 → S3.7 → S3.8.

## Stewardship note

Implementation evidence belongs in `LAST_IMPLEMENTATION_HANDOFF.md`. This file is updated only after independent review of repository state, CI, deployment evidence, live migration status when relevant, and hosted configuration.
