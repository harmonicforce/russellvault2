# Russell Vault Current State

Last reviewer update: 2026-08-22

This is the canonical operational ledger. Implementation agents must not edit it unless a work order explicitly grants a one-time exception.

> **Editing note.** This file was last edited by an implementation agent under a one-time exception granted by Genome Repair Work Order 1, whose scope was explicitly to repair stale production-identity and program-phase claims. Normal stewardship returns to ChatGPT.

## Who may edit this file

One maintenance model, no exceptions beyond it:

- **Auto-authorized on migration-bearing work:** the marked `machine-derived-baseline` block below, updated together with `CURRENT_STATE.attestation.json`. `scripts/ci/current-state-guard.mjs` verifies exactly that projection and fails CI if either is left behind. Updating the block is a mechanical projection of the migration set, not a state review.
- **Steward-controlled:** everything else here — narrative, program phase, CI state, blockers, shipped and not-shipped lists, next slice. Changing any of it requires an explicit work-order exception.

Implementation agents must not rewrite unrelated prose in this file.

## How to read this file

Every factual claim below is tagged with the class of evidence behind it. The classes are defined in `docs/ai/CURRENT_STATE.attestation.json`, which is the machine-readable form of this projection and is validated in CI by `scripts/ci/current-state-guard.mjs`.

- **[deployed]** — read from deployed configuration or the deployed bundle. The only class that can establish production identity.
- **[live-schema]** — read from a live database. Proves what a database contains, never which database production uses.
- **[repo]** — read from files at the reviewed commit.
- **[github]** — read from the GitHub API for an exact SHA, run id, and run attempt.
- **[unmerged]** — present only on an open PR. Never an executable baseline.
- **[not-inspectable]** — could not be checked from the verifying environment. Recorded as a blocker, never quietly converted into a claim about reality.

This is a **bounded projection**, not a live mirror. It is not pinned to exact `HEAD`: only a change to the governed migration set invalidates it, so documentation-only commits do not require an edit here.

## Reviewed baseline

- Repository: `harmonicforce/russellvault2` **[repo]**
- Canonical and GitHub default branch: `main` **[repo]**
- Railway source branch: `main` **[repo]**
- Live app: `https://russellvault2-production.up.railway.app` **[repo]**
- Reviewed merge: PR #77 **[github]**

The block below is **machine-owned**. `scripts/ci/current-state-guard.mjs` parses it and compares each field exactly against `CURRENT_STATE.attestation.json`. Each label must appear exactly once in this whole document, so a stale copy cannot coexist elsewhere. Migration-bearing work is auto-authorized to update this block and the attestation together — and nothing else in this file. Do not reformat the labels or the markers.

<!-- machine-derived-baseline:begin -->
- reviewed-main-sha: `a647b77a0f88fbaac9abc86430be58502a562bf9`
- governed-migration-count: `79`
- last-migration-name: `20260819000200_null_safe_acquisition_mutation_guards`
<!-- machine-derived-baseline:end -->

Evidence classes for the block: SHA **[github]**, count and last migration **[repo]**.

## Production identity: UNVERIFIED

**This document does not name the production Supabase project, and ordinary prose here must not.** A verified ref belongs in `CURRENT_STATE.attestation.json` alone, as historical verification evidence — never as authority for a live action.

The deployed Railway environment is the sole authority for production identity. Verification could not be performed from the environment that produced this review: the egress policy answered `403` to `CONNECT` for `russellvault2-production.up.railway.app:443`, and Railway environment variables are not stored in this repository. **[not-inspectable]**

Before any live Supabase read, migration, reset, restore, or parity claim, re-read the deployed Supabase URL from the running environment **immediately before acting** and confirm the target project ref matches it.

### Why this matters here specifically

Two real Russell Vault databases exist, and both look plausible:

| Project ref | Governed ledger | Last migration | What it is |
| --- | --- | --- | --- |
| `ncyqqitqtsyjrijieykd` | 79 | `20260819000200_null_safe_acquisition_mutation_guards` | Matches the reviewed repository set exactly. **[live-schema]** |
| `ykdyqnvmwpxhowbwhzqz` | 40 | `20260729000300_cycle_count_observations` | 39 migrations behind, stopped at the Cycle Count era. **[live-schema]** |

Until 2026-08-22 this file and `CLAUDE.md` both named `ykdyqnvmwpxhowbwhzqz` as *the* Supabase project. It is an `ACTIVE_HEALTHY` database displayed as "The Russell Vault 2", so a destructive action aimed there on the strength of that line would have found a real, credible-looking Russell Vault database and damaged the wrong one.

`ncyqqitqtsyjrijieykd` matching the repository ledger is strong evidence about **a database**. It is not evidence about **which database the deployed service uses**, and it is recorded as a candidate, not as production. Note also that it does not appear in the scoped Supabase project listing available to the verifier while being directly reachable — a scoped listing's silence is not evidence of absence.

The remaining owner-only action is to read `VITE_SUPABASE_URL` from the deployed Railway service and record the result in the attestation.

## CI state: green on attempt 2 after a failed attempt 1

Do not restate this as "never failed".

- Workflow `CI`, event `push`, branch `main` **[github]**
- Head SHA: `a647b77a0f88fbaac9abc86430be58502a562bf9`
- Run `32265646383`, **attempt 2**, conclusion **success**
- Attempt 1 **failed**: `shadow-db-supabase-stack` — the "Run pgTAP suite inside the local stack" step ran roughly 12m12s on 2026-08-19 and failed. The other three required jobs were green on attempt 1.
- On attempt 2 the re-run `shadow-db-supabase-stack` job completed its pgTAP step in 59s on 2026-08-21.
- Required jobs, final state: `build-and-verify` success, `shadow-db-postgres-shim` success, `shadow-db-supabase-stack` success, `dev-advisory-report` success.

The failure mode is the known `15_acquisition_digest_parity.sql` slowness against the 12-minute job budget, not a logic defect. It recurs and remains open platform debt.

## Live migration parity

Not claimed. Parity is a statement about a **named** database, and production identity is unverified, so there is no verified production target to claim parity against. **[not-inspectable]**

## Shipped, re-proved from executable code

Each line below was re-derived from migrations, routes, and scripts at the reviewed SHA rather than carried forward from earlier prose. **[repo]**

- Supabase authentication, workspaces, first-run setup, and workspace-scoped locations
- multi-category single and batch intake with draft recovery
- Product → SKU → Lot → Item identity; serialized and lot-managed inventory
- Current Inventory with server paging/sorting/filtering and URL-held state
- private media and signed display URLs; item and lot detail routes; printable labels
- scan/find and governed movement; lot adjustment, recount, split, merge
- correction requests, review, supersession, and duplicate voiding
- governed Cycle Count with blind rounds, recounts, resolutions, and audit
- S1.6 governed UI/design-system foundation and browser quality gate
- customizable Daily Workbench
- **S1 governed acquisition** — migrations `20260804000100`–`20260806000800`; routes `/acquisitions`, `/acquisitions/:sourceSystemPublicId/:linePublicId`, `/acquisition-review`
- **S2.1–S2.3 governed receiving** — migrations `20260807000100`, `20260808000100`, `20260809000100`; routes `/receiving`, `/receiving/:receiptPublicId`
- **S2.4–S2.6 cost basis and allocation** — migrations `20260812000100`, `20260815000100`, `20260815000200`; routes `/cost`, `/cost/:componentPublicId`; cost-basis algorithm version 1.1.0
- **S3.1 reconciliation ledger** — migrations `20260815000300`, `20260819000100`; `supabase/tests/68_reconciliation_ledger.sql`
- **S3.2 offline reconciliation runner** — `scripts/reconciliation/{runner,cli,artifact,domains,ledger}.mjs`, tool version `russell-vault-reconciliation/1.0.0`

### Corrections to previously published state

The prior revision of this file described acquisition receiving, landed-cost allocation, and inventory cost-basis read models as *incomplete*, and named PR #25 with 47 migrations as the reviewed baseline. All of that was stale: the reviewed baseline is PR #77 with 79 migrations, and those three slices are shipped as listed above.

## Not shipped

- **S3.3 reconciliation review UI** — no client route or page mounts any reconciliation surface at the reviewed SHA **[repo]**
- **S3.4–S3.8** historical import execution, adjudication, acquisition import, cost-allocation import with conservation proof, and governed cutover **[repo]**
- Historical production data has **not** been imported.

Legacy SQLite surfaces (`/inventory`, `/purchases`, `/cost-links`, `/listings`, `/sales`, `/checks`) remain mounted ungated during transition. They are not governed truth and must never be conflated with it.

## Known incomplete or weak areas

### Media

- multi-file progress and per-file retry need production hardening
- reorder and rotation are not fully confirmed
- atomic primary switching, deletion recovery, and orphan reconciliation need reinforcement
- category-aware required-photo workflows remain incomplete

### Listing and sales operations

- Listing Prep readiness workflows are incomplete
- marketplace publishing remains out of scope unless explicitly authorized
- sales, fulfillment, returns, and governed inventory exit are incomplete

### Platform and process debt

- `15_acquisition_digest_parity.sql` approaches the 12-minute Supabase-stack job budget and has now caused a real `main` attempt-1 failure. Top platform debt.
- `supabase/tests/40_cycle_count_concurrency.sql` carries known nondeterministic timing debt; repair it without weakening the genuine race proof.
- The client dependency audit reports `GHSA-qwww-vcr4-c8h2`; the repository's conditional BrowserRouter/no-RSC audit gate is the accepted policy. Do not call raw client `npm audit` clean.
- Cost-basis staleness is not evidenced: the database publishes no read-only current-input hash to compare against the stored recompute hash.
- Broad Playwright coverage and release/tag normalization remain future work.
- Deployment identity is not machine-verifiable from CI, because CI cannot read Railway configuration. The attestation records this as a standing blocker rather than guessing.

## Open pull requests

Unmerged work is never an executable baseline. **[unmerged]**

- **PR #78** (`docs/state-truth-sweep-2026-08-21`, head `ea8dc27`) — superseded by the Genome Repair Work Order 1 branch, which preserves its valid corrections. Its production-identity and program-phase corrections were sound. Its "Current CI state: RED" section was written against attempt 1 of run `32265646383` and went stale when attempt 2 of that same run succeeded on the same SHA. It also asserted a canonical deployed project ref that its own evidence did not establish from deployed configuration.
- **PR #75** (`codex/create-repair-branch-for-s3.1.1-adjudication-ordering`, head `453075c`) — superseded by merged PR #76, which fixed the same defect on `main` as `20260819000100_reconciliation_deterministic_ordering`. Its migration `20260818000100` is not on `main` and would collide with the reviewed ledger. It should be closed rather than merged; that is an owner decision.

## Active program position

Two sequences run in parallel and must not be confused. `docs/ai/GENOME_PROGRAM_REGISTRY.md` is authoritative for the reliability track and carries the full ordered list of 17 work orders with their prerequisites; `PROJECT_ROADMAP.md` for the product track.

- **Active slice:** WO1 — Production Identity and Control-Plane Truth, delivered as **PR #79** (draft, not merged).
- **Next after PR #79 merges:** **WO2 — Legacy Confidentiality Membrane.**
- **S3.3 — Reconciliation Review UI** remains planned but is **not** the next slice. It is carried by **WO13 — Reconciliation Review and Cutover Safety Loop**, gated on WO4, WO5, WO7, WO9 and WO11. Its product scope is unchanged and recorded in `PROJECT_ROADMAP.md`.

An earlier revision of this file named S3.3 as the immediate next slice. That predated the Genome Repair sequencing and is corrected here.

The product continuation after S3.3, when reached, remains S3.4 → S3.5 → S3.6 → S3.7 → S3.8.

## Stewardship note

Implementation evidence belongs in `LAST_IMPLEMENTATION_HANDOFF.md`. This file is updated only after independent review of repository state, CI for an exact SHA and run attempt, deployment evidence, live migration status when relevant, and hosted acceptance.

When updating it, update `CURRENT_STATE.attestation.json` in the same change. CI fails if the governed migration set moves and either one is left behind.
