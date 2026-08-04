# Last Implementation Handoff

## Surrender state

- Repository / canonical branch: `harmonicforce/russellvault2`, `main`
- **Actual base SHA: `885db791f98ef036ba5d6a028b5370802476c5d8`** (`origin/main`,
  fetched this session). This matches the SHA named in the work order exactly;
  `main` had not moved.
- Work order: Commercial Core & Legacy Retirement Program — **Phase 0**
  (census, architecture, planning)
- Implementation branch: `claude/legacy-retirement-phase0-census-niq78j`
- Deliverables commit: `de32f53762c83351a30f92076b6e05d7f2480a45`. This
  document's own head SHA is the commit that records that line.
- Pull request: **draft**, into `main`. Not to be merged.
- Repository migration count: **60 → 60.** No migration was added, edited,
  replayed, or removed. Count it from the directory, not from this line:
  `ls supabase/migrations/*.sql | wc -l`
- pgTAP files: 54 → 54. Unchanged.
- Hosted Supabase parity: **not checked and not claimed.** No migration applied
  remotely; no hosted database contacted.
- Railway: not deployed, not restarted, not reconfigured; `/api/version` not
  queried.
- Hosted acceptance: not applicable — no runtime behavior changed.
- Production data, configuration and secrets: untouched.
- `docs/ai/CURRENT_STATE.md`: **not edited.** Proposed replacement text is at the
  end of this document.

## What this pass was for

This phase produced no product code. It produced the map: a complete,
evidence-backed census of every remaining legacy SQLite capability, a target
architecture for the governed replacements, a record-level reconciliation
procedure, a reviewable implementation sequence, and the list of decisions only
the owner can make.

The deliverable is not "which pages to delete". It is the connection between
user behavior, routes, persistence, calculations, authority, replacement,
reconciliation, cutover and removal — such that each later slice can be executed
safely and each removal has a measurable gate.

## Audit methodology

1. **Fetched `origin/main` first** and recorded the base SHA before reading
   anything.
2. **Read implementations, not descriptions.** Every claim marked `[FACT]` in the
   census was read at a cited path and line. Where a repository document
   disagreed with the code, the code was recorded as fact and the document as a
   stale claim (finding F-3).
3. **Enumerated exhaustively rather than sampling**: all client routes from
   `client/src/App.tsx`, all server routes by grepping `router.<method>` across
   `server/src/routes/`, all SQLite tables and indexes from the `initSchema` and
   `migrateProductType` DDL, all governed tables/views/types/functions from
   `supabase/migrations/*.sql`.
4. **Measured the seed corpus directly** with `node` rather than quoting counts
   from `README.md` — which is how the exact 30 food rows, the 2,149 distinct
   `acquisition_line_id` values, and the 2,149 distinct `order_id` values were
   established as facts rather than recollections.
5. **Traced every monetary calculation** to its expression, recorded its units
   and source fields, and classified its defects (C-1 … C-14).
6. **Cross-checked** every matrix row against the census, every JSON entry
   against the matrix, and every cited repository path and line number against
   the filesystem.
7. **Did not connect to anything.** No hosted Supabase, no Railway, no
   production database, no network resource.

## Files inspected

Client: `client/src/App.tsx`; `client/src/pages/{Dashboard,Inventory,Purchases,CostLinks,Listings,Sales,Checks}.tsx`;
`client/src/lib/{api,dataAdapter,shadowConfig,provenanceConfig,operationsDashboardApi}.ts`;
`client/src/components/ReadOnlyBanner.tsx`; `client/src/lib/{authShell,provenanceConfig}.test.ts`;
`client/package.json`.

Server: `server/src/index.ts`, `db.ts`, `seed.ts`, `ids.ts`, `validation.ts`,
`classify.ts`, `legacyWriteGuard.ts`; all eight legacy routers under
`server/src/routes/`; the nine governed routers; `server/src/provenance/fixtures.ts`;
`server/src/acquisition/commitDriver.ts`; `server/package.json`; the full test
file listing under `server/src/`.

Data: all seven files in `server/seed/` (measured, not assumed).

Database: all 60 files in `supabase/migrations/` (enumerated for tables, views,
types and functions; `20260720000100_acquisition_schema.sql`,
`20260801000500_listing_prep_schema.sql`, `20260719000600_provenance_schema.sql`
and `20260801000900_operations_dashboard_contracts.sql` read in detail); the 54
files in `supabase/tests/`.

Infrastructure and docs: `.github/workflows/ci.yml`, `.github/pull_request_template.md`,
`railway.json`, root `package.json`, `.gitignore`, `.env.example`,
`scripts/verify-sqlite-backup.mjs`, the `scripts/` and `docs/` trees,
`README.md`, `docs/architecture.md`, `docs/ai/CURRENT_STATE.md`,
`docs/runbooks/*`.

## Deliverables created

New directory `docs/programs/commercial-core-legacy-retirement/`:

| File | Contents |
|---|---|
| `00_PROGRAM_CHARTER.md` | mission, the two-system problem stated precisely, target end state, the 17-step commercial lifecycle with current coverage measured against it, 13 governance principles, the no-dual-write rule, data-preservation rules, marketplace action rules, AI approval and provenance rules, cutover philosophy, a 10-point completion definition |
| `01_LEGACY_SURFACE_CENSUS.md` | six headline findings; consolidated enumerations of client routes, nav entries, server routes, SQLite tables/indexes/FKs, seed files, runtime dependencies, environment variables, 14 financial calculations, tests, documentation, production persistence assumptions; then a full 27-field census of domains A–J; then a 15-point completeness verification |
| `02_LEGACY_REPLACEMENT_MATRIX.md` | **66 rows × 21 columns**, presented as three ID-joined views, plus a coverage proof mapping every enumerated artifact class to its rows and a two-authoritative-writer check |
| `03_TARGET_COMMERCIAL_ARCHITECTURE.md` | 60 entities across acquisition, cost, marketplace, orders/fulfillment, financial completion, pricing/valuation and AI — 45 new, 15 existing — each with purpose, grain, identity, workspace scope, fields, relationships, mutability, audit, idempotency, authorization boundary and source-of-truth status; plus a principle-satisfaction table |
| `04_RECONCILIATION_AND_CUTOVER_PLAN.md` | the two-level reconciliation rule, an append-only reconciliation ledger, the exact seven-step procedure for the 2,149/2,119 question, per-domain reconciliation for all six datasets, duplicate/ambiguity handling, idempotency and rollback before and after cutover, and the nine-stage per-domain lifecycle |
| `05_IMPLEMENTATION_SEQUENCE.md` | 13 slices (S0–S12) with build order, execution order and a dependency graph; four documented departures from the suggested order with the dependency reason for each; a full 16-field record per slice; 60 individually reviewable PRs |
| `06_OWNER_DECISIONS.md` | 20 owner decisions (12 blocking, 8 non-blocking) each with question, why it matters, options, recommendation, consequences, blocking status and latest safe decision point; plus a section recording the engineering choices deliberately *not* escalated |
| `legacy-surface-inventory.json` | 66 machine-readable entries with the 12 required fields; validated |

Also updated: this file.

## Material findings

**F-1 — The legacy write guard does not make the legacy system read-only.**
`server/src/index.ts:28-29` calls `seedIfEmpty()` and `migrateProductType()` at
module top level; `legacyWriteGuard` is installed at `:83`. Both boot functions
issue SQLite DDL and DML — schema creation, seeding, the `flagFoodPurchases`
`UPDATE`, and the classifier backfill `UPDATE`. None passes through Express, so
`ALLOW_LEGACY_WRITES` has no effect on any of them. "Read-only in production" is
true of HTTP-originated writes only, not of the process. Consequence: making a
domain read-only requires deleting handlers and boot calls, not flipping an
environment variable.

**F-2 — Legacy surfaces are unconditional; governed surfaces are flag-gated.**
`client/src/App.tsx:284-290` mounts the seven legacy routes with no guard;
`:291-308` mounts the eighteen governed routes behind `PROVENANCE_ENABLED`,
which requires four client environment variables. A build that loses any one of
them serves `LEGACY_ONLY_NAV` — the original unauthenticated SQLite application
— with no signal that the governed system is missing. This is the reverse of the
desired failure mode.

**F-3 — `client/src/lib/dataAdapter.ts` states something the code contradicts,
and CI enforces it.** It declares the legacy SQLite adapter "the ONLY read and
write path for business data" and exports `SHADOW_WRITES_ENABLED = false`. That
was true in Phase 2 and is false at this commit. Two tests assert it
(`client/src/lib/authShell.test.ts:9`, `client/src/lib/provenanceConfig.test.ts:13`),
so a stale claim is CI-protected. `docs/supabase-shadow-foundation.md:197`
repeats it.

**F-4 — The `sales` table has no seeder and no repository copy.**
`server/src/seed.ts` has no `sales` block; `server/seed/sales.json` is `[]`.
Every production sale exists only in the live SQLite file. It is the one legacy
dataset with no reconstructable source, and securing an export of it is the
highest-priority action in the whole program.

**F-5 — The repository seed represents zero completed financial work.** Measured
directly: 1,487 inventory rows, all `record_origin='Imported Legacy'` and all
`cost_status='Uncosted'`; 287 cost links, all `Candidate`; 20 listings, all
`Draft`. Production state is unknown from here and may differ substantially.

**F-6 — The 30-row question, stated exactly.** The seed has 2,149 rows with
2,149 distinct `acquisition_line_id` values, of which **exactly 30** carry
`business_vertical = 'Food / consumables'` — the precise predicate
`flagFoodPurchases` uses. `docs/architecture.md:44-45` records the owner-verified
production backup at 2,119 rows. 2,149 − 2,119 = 30, and the food count is 30.
**Whether these are the same 30 rows remains unproven**, and no deliverable in
this pass assumes they are. The numeric coincidence is recorded as suggestive
and not as evidence.

**Additional structural findings:**

- `seedIfEmpty()` repopulates any *empty* table at every boot. A lost or
  remounted Railway volume would silently rewrite production with the initial
  import — including reinstating the 30 food rows — while leaving `sales` empty
  with no replacement. Scheduled as slice S0.
- `order_id` is distinct on all 2,149 seed purchase rows, so the legacy
  "purchase" grain is a line, not an order. The governed
  `acquisition_orders`/`acquisition_line_items` split will be 1:1 for this
  dataset, which that migration's own header anticipates.
- The SQLite `meta` table (`server/src/db.ts:185`) is created but never read or
  written; all bookkeeping uses `app_meta`. Dead schema.
- `is_excluded` and `exclusion_reason` are declared twice — in the `CREATE TABLE`
  at `db.ts:87-88` and again by `migrateProductType` at `:257-262`.
- Legacy sales carry three independent financial defects: sales tax added to net
  proceeds as income (`sales.ts:62`); cost divided by *total* rather than costed
  lot quantity (`:68`); and profit stored as a snapshot never recomputed when
  the lot is later costed (`:69-70`). Additionally `refund_amount` is not in the
  PATCH allowlist (`:142`), so a refund arriving after the sale cannot be
  entered at all.
- Health check `LIVE-002` ("no negative available quantity") can never fail,
  because both availability computations clamp at zero. `LIVE-001` compares
  `COUNT(*)` to `COUNT(DISTINCT pk)` on a primary key and also cannot fail.
- No governed inventory cost basis or COGS entity exists anywhere. This is the
  single largest gap in the governed model and the reason no governed realized
  profit is possible today.
- **The strongest structural asset found:** `server/src/provenance/fixtures.ts`
  allowlists exactly the same seven seed files the legacy seeder reads, opened
  read-only. The governed import path and the legacy seeder share a byte-identical
  source, so the two systems can be reconciled against a common artifact without
  a new export step.

## Unresolved questions

Recorded as `[OPEN]` in the census; none is answerable from this repository.

1. Whether the 30 rows absent from the production backup are the 30 food rows
   (F-6).
2. The current production row states — how many cost links are `Confirmed`, how
   many listings are `Active`, how many sales exist. The seed is the initial
   state, not the current one.
3. How many rows the production `sales` table holds (F-4).
4. Whether the Railway service currently has a persistent volume attached and
   whether `DATA_DIR`/`DATABASE_PATH` point at it.
5. Which of the 1,487 legacy inventory lots represent stock still physically
   held.
6. Whether physical stock exists in both systems — entered through governed
   intake *and* present in the legacy import — and at what scale.
7. The hosted Supabase migration ledger state.

## Verification performed

| Check | Command | Result |
|---|---|---|
| Base SHA recorded before any read | `git fetch origin main && git rev-parse origin/main` | `885db791f98ef036ba5d6a028b5370802476c5d8` — matches the work order |
| Repository migration count | `ls supabase/migrations/*.sql \| wc -l` | 60 |
| Whitespace / conflict markers | `git diff --check` | clean, exit 0 |
| JSON parses | `node -e "require('./…/legacy-surface-inventory.json')"` | OK, exit 0 |
| JSON entry count, unique ids, required fields, allowed dispositions, non-empty removal gates | scripted assertion over all 66 entries | all pass |
| Every JSON `evidence_paths` entry exists | scripted `fs.existsSync` over 61 distinct paths | all exist |
| Every backticked repository path in the markdown exists | scripted over 91 distinct paths | all exist except `server/data` and `client/dist`, which are gitignored runtime paths and are described as such |
| Every `path:line` citation is within file bounds | scripted over 59 citations | all pass after correction |
| Matrix row consistency | scripted ID extraction from all four tables | Row index, View 1, View 2, View 3 each carry the same 66 unique IDs |
| Documented SQLite table names exist | `grep` against `server/src/db.ts` | all 8 found |
| Documented legacy API mount paths exist | `grep` against `server/src/index.ts` | all 10 found |
| Documented governed function names exist | `grep` against `supabase/migrations/` | all 13 sampled found |
| Cited line numbers semantically correct | manual spot-check of 48 citations | 18 were off by one to three lines and were corrected; re-verified after correction |

**Not run, and why:** the server, client and database test suites were not run,
because no product code, migration, or test was changed. Running them would
prove only that the base commit is green, which CI already established.
`git diff --stat` confirms the diff is documentation-only.

**No repository documentation or link check exists** to run —
`.github/workflows/ci.yml` has no such job. Path and citation verification was
therefore done with the scripted checks above.

## Limitations

- **This is documentation validation, not application validation.** No product
  code changed and no application behaviour was exercised. Nothing here proves
  the application works.
- Production row states are unknown (see Unresolved questions). Every statement
  about data volume in these deliverables refers to the **repository seed**
  unless it explicitly cites `docs/architecture.md`'s record of the owner's
  backup.
- The target architecture is a design. It has not been compiled, migrated, or
  tested. Entity and column names are proposals.
- The implementation sequence estimates scope qualitatively (small / medium /
  large / very large). It contains no time estimates, because none would be
  grounded.
- `docs/architecture.md`'s statement of the production backup row count is
  recorded here as an owner attestation, marked `[DOC]`. No session in this
  repository can verify it.
- Line citations were spot-checked and corrected, and all were verified to be
  within file bounds; they were not each individually re-read after correction
  beyond the 18 corrected plus the surrounding sample.

## Statement of non-impact

**No runtime behavior, hosted system, or business data was changed by this
work.**

Specifically, and without qualification:

- No file under `client/src/`, `server/src/`, `supabase/`, `scripts/`,
  `.github/`, or any package manifest was modified.
- No Supabase migration was added, edited, replayed, or removed.
- No hosted Supabase project was contacted.
- No production or any other live database was read from or written to.
- No Railway deployment, redeployment, restart, or configuration change was
  performed; no Railway environment variable was read or changed.
- No legacy write setting was changed; `ALLOW_LEGACY_WRITES` was not set,
  unset, or otherwise touched.
- No business data was migrated, deleted, restored, reconciled, or mutated.
- No product schema migration was added.
- No legacy route, page, dependency, table, or navigation entry was removed.
- `docs/ai/CURRENT_STATE.md` was not edited.
- No read-only audit script was added to the repository; verification was
  performed with inline commands that wrote nothing.

The complete diff against `885db791f98ef036ba5d6a028b5370802476c5d8` is
**nine files: eight new documents under
`docs/programs/commercial-core-legacy-retirement/` and this handoff.**

## Proposed `CURRENT_STATE.md` replacement text

Not applied. `AGENTS.md` reserves that file for the state steward and this work
order did not grant an exception. `CURRENT_STATE.md` is currently stale in two
checkable ways: it records a repository migration count of **47** when the
directory holds **60**, and a last-reviewed merge of PR #25 when PR #36 has
merged.

**Replace "Deployment and verification" with:**

> - Repository: `harmonicforce/russellvault2`
> - Canonical and GitHub default branch: `main`
> - Railway source branch: `main`
> - Live app: `https://russellvault2-production.up.railway.app`
> - Supabase project: `ykdyqnvmwpxhowbwhzqz`
> - Last reviewed merge: `885db791f98ef036ba5d6a028b5370802476c5d8` (PR #36,
>   production integrity repair)
> - Repository migration count: **60**
> - pgTAP files: **54**
> - Exact PR-head CI run: *(steward to record the run id and result for PR #36)*
> - Required jobs: build-and-verify, shadow-db-postgres-shim,
>   shadow-db-supabase-stack, dev-advisory-report
> - Railway deployment status on the reviewed merge: *(steward to record)*
> - Hosted acceptance for PR #36: *(steward to record)*
>
> The repository documents do not independently prove the live Supabase
> migration ledger, and a green CI run proves nothing about the hosted app. Each
> migration-bearing release must verify live parity before acceptance, using
> `docs/runbooks/hosted-migration-parity.md`.

**Add a new section, "Legacy retirement program":**

> Phase 0 of the Commercial Core & Legacy Retirement Program is complete as
> analysis and is recorded in `docs/programs/commercial-core-legacy-retirement/`.
> It is a map and an architecture; no implementation has begun.
>
> Two systems remain in one process. Supabase is authoritative for governed
> inventory identity, intake, locations, movements, media, corrections, cycle
> counts, Listing Prep and operational readiness. SQLite remains non-authoritative
> but still supplies legacy Inventory, Whatnot Purchases, Cost Basis Links, eBay
> Listings, Sales, Health Checks and part of the Dashboard, through **24 API
> endpoints across 8 routers, 7 client routes, and 8 tables**.
>
> Three facts from the Phase 0 audit change how that retirement must proceed and
> should be treated as current state:
>
> - The legacy write guard does **not** make the legacy system read-only.
>   `seedIfEmpty()` and `migrateProductType()` run at boot, before the guard is
>   installed, and write SQLite regardless of `ALLOW_LEGACY_WRITES`.
> - `seedIfEmpty()` repopulates any empty table from the repository seed at every
>   boot. A lost Railway volume would silently rewrite production with the
>   initial import while leaving `sales` empty, because `sales` has no seeder.
> - The production `sales` table exists in no repository artifact. Securing a
>   verified export of it is the highest-priority outstanding action.
>
> The 2,149-row repository seed versus 2,119-row verified production backup
> difference remains **unadjudicated**. The seed contains exactly 30
> `Food / consumables` rows and the difference is exactly 30, but no row-level
> comparison has been performed and the two facts must not be treated as
> connected.

**Amend "Current known incomplete or weak areas" → "Acquisition and cost" to
add:**

> - There is no governed inventory cost basis and no COGS entity anywhere in the
>   model. Cost allocation exists (`acquisition_cost_components`,
>   `acquisition_cost_allocations`) but nothing downstream consumes it, so no
>   governed realized profit is computable.
> - There is no governed receiving step, so no governed link exists between an
>   acquisition line and the inventory it produced. Legacy `cost_links` is a
>   hand-built substitute for that missing link.

**Amend "Current known incomplete or weak areas" → "Listing and sales
operations" to add:**

> - Listing Prep ends at "listed", recording an `external_listing_ref` the owner
>   types by hand. There is no marketplace account, credential, category,
>   listing, publish, sync, order, fee, refund, return or payout entity in the
>   governed model.

**Add a new subsection under "Current known incomplete or weak areas":**

> ### Documentation defects found in the Phase 0 audit
>
> - `client/src/lib/dataAdapter.ts` states that the legacy SQLite adapter is the
>   only read and write path for business data and exports
>   `SHADOW_WRITES_ENABLED = false`. Both were true in Phase 2 and are false now.
>   Two client tests assert the export, so the stale claim is CI-protected.
>   `docs/supabase-shadow-foundation.md:197` repeats it.
> - The SQLite `meta` table is created but never read or written; `app_meta`
>   carries all bookkeeping.

## Owner actions carried forward

1. **Capture and verify a SQLite export, `sales` table included.** Follow
   `docs/runbooks/railway-backup-deploy-preflight.md`, then run
   `node scripts/verify-sqlite-backup.mjs <path> --json` and record the SHA-256,
   size, integrity result and per-table row counts. Nothing else in the program
   should start first.
2. **Decide D-17** (gate reseed-on-empty). It is the only decision blocking
   slice S0, and S0 blocks everything.
3. **Review `06_OWNER_DECISIONS.md`.** Twelve decisions block specific slices;
   D-8 (cost basis method) and D-1/D-2 (the 30-row adjudication) have the
   longest lead time and the least reversible consequences.
4. **Note that `docs/ai/CURRENT_STATE.md` is stale** in two checkable ways and
   that proposed replacement text is above.
