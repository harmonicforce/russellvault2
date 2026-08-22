# Legacy Surface Census

> **HISTORICAL — DESIGN-ONLY.** This is a point-in-time program design document,
> preserved as written. It is **not** a statement of current state. Its base
> commit, migration counts, phase status, and "not implemented" notes were true
> when written and have since moved on — much of the S1/S2/S3 work described here
> as future has shipped.
>
> For present state use `docs/ai/CURRENT_STATE.md` and the machine-readable
> `docs/ai/CURRENT_STATE.attestation.json`. For sequence use
> `docs/ai/PROJECT_ROADMAP.md`. Do not cite this file as evidence of what exists
> today, and do not rewrite its history to match the present.

Phase 0 deliverable 2 of 8.

Audited at `885db791f98ef036ba5d6a028b5370802476c5d8` (`origin/main`), by reading
the implementation. Where a document and the code disagree, the code is recorded
as fact and the document is recorded as a stale claim.

## Evidence classification

Every statement below carries one of four markers.

| Marker | Meaning |
|---|---|
| **[FACT]** | Read directly from source at the cited path and line. Reproducible by opening the file. |
| **[DOC]** | A claim made by a repository document. Recorded as a claim, and checked against the code where checkable. |
| **[INFER]** | A conclusion drawn from facts, with the reasoning stated. Not directly observed. |
| **[OPEN]** | An unresolved question. Cannot be answered from this repository. |

---

## 0. Headline findings

Six findings materially change how the retirement must be sequenced. Each is
expanded in its domain section.

### F-1 — The legacy write guard does not make the legacy system read-only **[FACT]**

`server/src/index.ts:28-29` calls `seedIfEmpty()` and `migrateProductType()` at
module top level. `server/src/index.ts:83` installs `legacyWriteGuard` many
lines later. Both boot functions issue SQLite writes:

- `seedIfEmpty()` (`server/src/seed.ts:27`) runs `initSchema()` (DDL) and then
  `INSERT OR IGNORE` batches into five tables whenever those tables are empty.
- `migrateProductType()` (`server/src/db.ts:248`) runs `CREATE TABLE`,
  `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`, calls `flagFoodPurchases()`
  (an `UPDATE` over `whatnot_purchases`), and then runs a transactional
  `UPDATE` re-tagging `product_type` on every non-manual row whenever
  `CLASSIFIER_VERSION` changes.

None of these pass through Express, so `ALLOW_LEGACY_WRITES` has no effect on
any of them. **[INFER]** Consequently the phrase "running read-only in
production" in the guard's own 403 message (`server/src/legacyWriteGuard.ts:19`)
is true only of HTTP-originated writes. It is not true of the process.

Consequence for this program: "make legacy read-only" cannot be implemented by
setting an environment variable. It requires deleting the boot calls and the
non-safe route handlers.

### F-2 — Legacy routes and pages are unconditional; governed ones are flag-gated **[FACT]**

`client/src/App.tsx:284-290` mounts the seven legacy routes with no guard.
`client/src/App.tsx:291-308` mounts all eighteen governed routes behind
`PROVENANCE_ENABLED`. `server/src/index.ts:85-92` mounts the eight legacy
routers unconditionally.

`PROVENANCE_ENABLED` resolves through
`client/src/lib/provenanceConfig.ts:isProvenanceUiEnabled`, which requires
`VITE_SHADOW_IMPORT === 'repository-fixtures'` **and**
`getShadowAuthConfig` returning non-null, which itself requires
`VITE_SHADOW_AUTH === 'supabase'` **and** both `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (`client/src/lib/shadowConfig.ts:18-21`).

**[INFER]** A build that loses any one of four client environment variables
serves `LEGACY_ONLY_NAV` (`client/src/App.tsx:79-87`) — the original
unauthenticated SQLite application — with no visible signal that the governed
system is missing. This is the reverse of the desired failure mode and is the
strongest argument for retiring the legacy surface rather than merely hiding it.

### F-3 — `client/src/lib/dataAdapter.ts` states something the code contradicts **[FACT]/[DOC]**

`client/src/lib/dataAdapter.ts:3-8` states: *"The legacy SQLite REST adapter
(lib/api.ts → /api → server/src) is the ONLY read and write path for business
data. The Supabase shadow database is non-authoritative: the client touches it
solely for authentication and workspace-membership checks."* It exports
`SHADOW_WRITES_ENABLED = false as const`.

That was true in Phase 2. It is false at this commit: `client/src/pages/`
contains governed pages that write inventory, media, cycle counts, and listing
prep to Supabase through `server/src/routes/`, and `docs/architecture.md:15`
records Supabase as authoritative for inventory identity, movement and history.

`SHADOW_WRITES_ENABLED` is asserted by two tests
(`client/src/lib/authShell.test.ts:9`,
`client/src/lib/provenanceConfig.test.ts:13`), so the false statement is
CI-enforced. **[INFER]** This is a documentation defect that will actively
mislead the retirement work; it is scheduled for correction in
`05_IMPLEMENTATION_SEQUENCE.md` slice 0.

### F-4 — The `sales` table has no seeder and no historical data **[FACT]**

`server/src/seed.ts:27-92` seeds `inventory_lots`, `whatnot_purchases`,
`cost_links`, `ebay_listings`, and `checks`. It contains **no** block for
`sales`. `server/seed/sales.json` is `[]` (2 bytes) and is referenced only by
the provenance fixture allowlist (`server/src/provenance/fixtures.ts:72-78`)
and its test.

**[INFER]** Every row in the production `sales` table, if any, was created at
runtime through `POST /api/sales` and exists in no repository artifact. It is
therefore the one legacy dataset with no reconstructable source, and the one
that most needs a backup-based export before anything else happens.
**[OPEN]** How many rows the production `sales` table holds is not knowable from
this repository.

### F-5 — The repository seed represents zero completed financial work **[FACT]**

Measured directly from the seed files:

| File | Rows | Distinct key | Notable |
|---|---|---|---|
| `server/seed/inventory.json` | 1,487 | 1,487 `inventory_lot_id` | `record_origin` is `Imported Legacy` for all 1,487; `cost_status` is `Uncosted` for all 1,487; `tracking_mode` is `Lot-managed` ×1,208 / `Serialized` ×279 |
| `server/seed/whatnot_purchases.json` | 2,149 | 2,149 `acquisition_line_id`; 2,149 distinct `order_id` | exactly 30 rows have `business_vertical = 'Food / consumables'` |
| `server/seed/cost_links.json` | 287 | 287 `allocation_id` | `allocation_status` is `Candidate` for all 287 |
| `server/seed/ebay_listings.json` | 20 | 20 `listing_id` | `listing_status` is `Draft` for all 20 |
| `server/seed/checks.json` | 7 | `OP-001`…`OP-007` | |
| `server/seed/sales.json` | 0 | — | never loaded (F-4) |
| `server/seed/lookups.json` | n/a | 13 named lists | read directly by the route, never seeded into SQLite |

**[INFER]** Because `order_id` is distinct on all 2,149 rows, the legacy
"purchase" grain is a *line*, not an order. The `acquisition_orders` /
`acquisition_line_items` split already present in the governed schema
(`supabase/migrations/20260720000100_acquisition_schema.sql`) will therefore
produce a 1:1 order:line relationship for this dataset — which that migration's
own header comment anticipates and explains as intentional.

**[OPEN]** Production may diverge from the seed: the owner may have confirmed
allocations, activated listings, and recorded sales since deployment. The seed
is the *initial* state, not the current one. Nothing in this repository reveals
production's current row states.

### F-6 — The 30-row question, stated exactly **[FACT]/[OPEN]**

**[FACT]** `server/seed/whatnot_purchases.json` contains 2,149 rows. Exactly 30
carry `business_vertical = 'Food / consumables'`, which is the predicate
`flagFoodPurchases` (`server/src/db.ts:232-236`) uses to set `is_excluded = 1`.

**[DOC]** `docs/architecture.md:44-45` records that the owner-verified
production Railway backup contains 2,119 `whatnot_purchases` rows.

**[FACT]** 2,149 − 2,119 = 30, and the food-row count is also 30.

**[OPEN]** **Whether these are the same 30 rows is unknown and unproven.** No
`acquisition_line_id`-level comparison between the seed and the backup exists in
this repository. `docs/architecture.md:46-52` states this explicitly and this
census does not weaken it. The numeric coincidence is suggestive and is not
evidence. `04_RECONCILIATION_AND_CUTOVER_PLAN.md` § 3 defines the procedure that
would settle it.

---

## 1. Consolidated inventories

### 1.1 Client routes — complete enumeration **[FACT]**

Source: `client/src/App.tsx:283-309`. 25 routes total.

**Legacy (7) — unconditional:**

| Path | Component | File |
|---|---|---|
| `/` | `Dashboard` | `client/src/pages/Dashboard.tsx` |
| `/inventory` | `Inventory` | `client/src/pages/Inventory.tsx` |
| `/purchases` | `Purchases` | `client/src/pages/Purchases.tsx` |
| `/cost-links` | `CostLinks` | `client/src/pages/CostLinks.tsx` |
| `/listings` | `Listings` | `client/src/pages/Listings.tsx` |
| `/sales` | `Sales` | `client/src/pages/Sales.tsx` |
| `/checks` | `Checks` | `client/src/pages/Checks.tsx` |

`/` is a hybrid: `Dashboard.tsx` renders `WorkspaceSummarySection` (governed,
via `createOperationsDashboardTransport`) above a legacy SQLite panel fed by
`GET /api/dashboard`.

**Governed (18) — behind `PROVENANCE_ENABLED`:**

`/quick-add`, `/batch-intake`, `/workbench`, `/scan`,
`/inventory/lots/:lotId`, `/inventory/current`, `/inventory/move`,
`/corrections`, `/inventory/current/:itemId`, `/intake-sessions`,
`/locations`, `/cycle-counts`, `/photo-issues`, `/listing-prep`,
`/listing-prep/:prepId`, `/import-review`, `/acquisition-review`,
`/inventory-identity`.

### 1.2 Legacy navigation entries — complete enumeration **[FACT]**

Source: `client/src/App.tsx:48-87`.

| Array | Line | Entries | When rendered |
|---|---|---|---|
| `PRIMARY_NAV` | 48 | 12; one is legacy: `/inventory` labelled **"Legacy Inventory"** (line 54) | `PROVENANCE_ENABLED` true |
| `LEGACY_NAV` | 63 | 4: `/purchases`, `/cost-links`, `/listings`, `/sales` | inside the collapsed "Tools & legacy" group |
| `TOOLS_NAV` | 70 | 4; one is legacy: `/checks` "Health Checks" (line 74) | same group |
| `LEGACY_ONLY_NAV` | 79 | 7: all legacy routes | `PROVENANCE_ENABLED` **false** — the fallback shell |

`ToolsNavGroup` (line 157) concatenates `LEGACY_NAV` and `TOOLS_NAV`.
`/` (Dashboard) appears in both `PRIMARY_NAV` and `LEGACY_ONLY_NAV`.

Total distinct legacy nav destinations: **7**.

### 1.3 Server routes — complete enumeration

**Legacy, SQLite-backed — 24 endpoints across 8 routers [FACT]**

Mounted at `server/src/index.ts:85-92`, all *after* `legacyWriteGuard`
(line 83).

| # | Method | Path | Implementation | Tables touched | R/W |
|---|---|---|---|---|---|
| 1 | GET | `/api/inventory` | `routes/inventory.ts:14` | `inventory_lots` | R |
| 2 | GET | `/api/inventory/facets` | `routes/inventory.ts:51` | `inventory_lots` | R |
| 3 | GET | `/api/inventory/:id` | `routes/inventory.ts:64` | `inventory_lots`, `cost_links`, `ebay_listings`, `sales` | R |
| 4 | POST | `/api/inventory` | `routes/inventory.ts:140` → `createInventoryLot` :74 | `inventory_lots` | **W** |
| 5 | PATCH | `/api/inventory/:id` | `routes/inventory.ts:185` → `updateInventoryLot` :159 | `inventory_lots` | **W** |
| 6 | GET | `/api/purchases` | `routes/purchases.ts:12` | `whatnot_purchases` | R |
| 7 | GET | `/api/purchases/type-summary` | `routes/purchases.ts:56` | `whatnot_purchases` | R |
| 8 | PATCH | `/api/purchases/:id` | `routes/purchases.ts:76` | `whatnot_purchases` | **W** |
| 9 | GET | `/api/purchases/facets` | `routes/purchases.ts:87` | `whatnot_purchases` | R |
| 10 | GET | `/api/purchases/:id` | `routes/purchases.ts:97` | `whatnot_purchases`, `cost_links` | R |
| 11 | GET | `/api/cost-links` | `routes/costLinks.ts:150` | `cost_links` | R |
| 12 | POST | `/api/cost-links` | `routes/costLinks.ts:246` → `createCostLink` :172 | `cost_links`, `inventory_lots`, `whatnot_purchases` | **W** |
| 13 | PATCH | `/api/cost-links/:id` | `routes/costLinks.ts:326` → `updateCostLink` :258 | `cost_links`, `inventory_lots`, `whatnot_purchases` | **W** |
| 14 | GET | `/api/listings/:id` | `routes/listings.ts:8` | `ebay_listings` | R |
| 15 | GET | `/api/listings` | `routes/listings.ts:14` | `ebay_listings` | R |
| 16 | POST | `/api/listings` | `routes/listings.ts:87` → `createListing` :36 | `ebay_listings`, `inventory_lots` | **W** |
| 17 | PATCH | `/api/listings/:id` | `routes/listings.ts:130` → `updateListing` :105 | `ebay_listings`, `inventory_lots` | **W** |
| 18 | GET | `/api/sales/:id` | `routes/sales.ts:8` | `sales` | R |
| 19 | GET | `/api/sales` | `routes/sales.ts:14` | `sales` | R |
| 20 | POST | `/api/sales` | `routes/sales.ts:132` → `createSale` :35 | `sales`, `inventory_lots`, `ebay_listings` | **W** |
| 21 | PATCH | `/api/sales/:id` | `routes/sales.ts:144` | `sales` | **W** |
| 22 | GET | `/api/dashboard` | `routes/dashboard.ts:83` → `getDashboard` :8 | all six business tables | R |
| 23 | GET | `/api/checks` | `routes/checks.ts:69` | `checks`, `inventory_lots`, `cost_links`, `whatnot_purchases`, `sales` | R |
| 24 | GET | `/api/lookups` | `routes/lookups.ts:11` | none (reads `server/seed/lookups.json`) | R |

**9 of 24 are writes.** All 9 are inside the guard's scope; all 9 are reachable
in production if `ALLOW_LEGACY_WRITES=true`; none of them is the only way SQLite
gets written (see F-1).

**Inventory-mutating legacy routes — the complete set [FACT]:** #4, #5, #12,
#13, #16, #17, #20. `#20 POST /api/sales` is the only one that decrements
availability (`routes/sales.ts:117-126`). `#12`/`#13` mutate `cost_status` and
`confirmed_cost_basis` on `inventory_lots` via `recomputeInventoryRollup`
(`routes/costLinks.ts:8`). `#16`/`#17` overwrite `inventory_lots.listing_status`
(`routes/listings.ts:82`, `:125-127`). `#21 PATCH /api/sales/:id` does **not**
touch inventory.

**Non-SQLite runtime endpoints [FACT]:** `GET /api/health`
(`server/src/index.ts:96`) and `GET /api/version` (`:102`). Neither reads
SQLite. `/api/health` reports `readOnly: !legacyWritesEnabled` and is the
Railway healthcheck target (`railway.json`).

**Governed routers — mounted before the guard, 9 routers [FACT]**

`server/src/index.ts:50-81`: `/api/provenance`, `/api/acquisition`,
`/api/inventory-identity`, `/api/intake`, `/api/locations`,
`/api/cycle-counts`, `/api/media`, `/api/listing-prep`,
`/api/operations-dashboard`. None imports `../db.js`; verified by
`grep -rl "from '../db.js'" server/src` returning only the ten legacy files
listed in § 1.6.

### 1.4 SQLite tables and indexes — complete enumeration **[FACT]**

Source: `server/src/db.ts:19-203` (`initSchema`) and `:248-264`
(`migrateProductType`).

**8 tables:**

| Table | PK | Created at | Columns | Purpose |
|---|---|---|---|---|
| `inventory_lots` | `inventory_lot_id` | `db.ts:21` | 46 | legacy inventory record |
| `whatnot_purchases` | `acquisition_line_id` | `db.ts:69` | 19 + 4 added by migration = 23 | legacy acquisition line |
| `cost_links` | `allocation_id` | `db.ts:91` | 20 | legacy cost allocation |
| `ebay_listings` | `listing_id` | `db.ts:114` | 25 | legacy listing draft |
| `sales` | `sale_id` | `db.ts:143` | 29 | legacy sale + fulfillment + profit |
| `checks` | `check_id` | `db.ts:175` | 7 | imported baseline reconciliation checks |
| `meta` | `key` | `db.ts:185` | 2 | **DEAD — never read or written** |
| `app_meta` | `key` | `db.ts:249` | 2 | classifier version bookkeeping |

**[FACT]** `meta` is created by `initSchema` but every read and write in the
codebase targets `app_meta` (`db.ts:209`, `:213`, `:249`). `grep` for
`FROM meta` / `INTO meta` across the repository returns nothing.
`meta` is dead schema and can be dropped without replacement.

**Columns added post-hoc to `whatnot_purchases` by `migrateProductType` [FACT]:**
`product_type` (`db.ts:251`), `product_type_source` (`:255`), `is_excluded`
(`:258`), `exclusion_reason` (`:261`). The last two are also declared in the
`CREATE TABLE` at `db.ts:87-88`, so on a fresh database they exist twice over —
harmless because of the `hasColumn` check, but it means the two definitions must
be kept in agreement by hand.

**13 indexes:**

`idx_inventory_product`, `idx_inventory_vertical`, `idx_inventory_cost_status`,
`idx_inventory_listing_status` (`db.ts:190-193`);
`idx_purchases_product`, `idx_purchases_seller`, `idx_purchases_recon`
(`:194-196`); `idx_costlinks_lot`, `idx_costlinks_line` (`:197-198`);
`idx_listings_lot`, `idx_listings_status` (`:199-200`);
`idx_sales_lot` (`:201`); `idx_purchases_type` (`:252`, inside the migration).

**Declared foreign keys [FACT]** (`PRAGMA foreign_keys = ON` at `db.ts:17`):
`cost_links.inventory_lot_id → inventory_lots`,
`cost_links.acquisition_line_id → whatnot_purchases`,
`ebay_listings.inventory_lot_id → inventory_lots`,
`sales.listing_id → ebay_listings`,
`sales.inventory_lot_id → inventory_lots`.
**No views. No triggers. No `CHECK` constraints. No `NOT NULL` on any business
column.**

### 1.5 Seed files — complete enumeration **[FACT]**

`server/seed/` contains 7 files. Row counts and states are in F-5. Loading
behavior:

- Loaded by `seedIfEmpty()` when the target table is empty, via
  `INSERT OR IGNORE` (`server/src/seed.ts:16-25`): `inventory.json`,
  `whatnot_purchases.json`, `cost_links.json`, `ebay_listings.json`,
  `checks.json`.
- **Never loaded:** `sales.json` (F-4).
- Read at request time, not seeded: `lookups.json`
  (`server/src/routes/lookups.ts:7` — read once at module load).

All 7 files are simultaneously the allowlisted fixture set for the governed
provenance import adapter (`server/src/provenance/fixtures.ts:37-77`), which
opens them read-only. **[INFER]** This is the single most important structural
asset for the retirement: the governed import path already reads exactly the
same bytes the legacy seeder reads, so the two systems can be reconciled against
a common source without a new export step.

### 1.6 Runtime dependency on SQLite — complete enumeration **[FACT]**

`better-sqlite3` is imported in exactly one file: `server/src/db.ts:1`.
It is declared at `server/package.json` dependencies (`"better-sqlite3": "^12.11.1"`)
with `@types/better-sqlite3` in devDependencies.

Ten files import the `db` handle (`grep -rl "from '\.\./db.js'\|from './db.js'" server/src`):

`server/src/index.ts`, `server/src/seed.ts`, `server/src/ids.ts`,
`server/src/routes/inventory.ts`, `server/src/routes/purchases.ts`,
`server/src/routes/costLinks.ts`, `server/src/routes/listings.ts`,
`server/src/routes/sales.ts`, `server/src/routes/dashboard.ts`,
`server/src/routes/checks.ts`.

Non-runtime references: `scripts/verify-sqlite-backup.mjs` loads
`better-sqlite3` through `createRequire` from the server dependency root
(`:71-84`) — a read-only offline verifier, not a runtime path.
`README.md` and `docs/architecture.md` describe it; `docs/repo-structure-review.md`
mentions it.

**[INFER]** Removal is therefore a ten-file change plus one dependency removal,
plus the standalone verifier's dependency resolution. The verifier is the one
artifact that should *survive* SQLite's removal from the runtime, because it is
how a retained backup stays checkable.

### 1.7 Environment variables — complete enumeration **[FACT]**

| Variable | Read at | Effect | Legacy or governed |
|---|---|---|---|
| `DATA_DIR` | `server/src/db.ts:10` | directory for `vault.db`; defaults to `server/data` | legacy |
| `DATABASE_PATH` | `server/src/db.ts:11` | full path override for `vault.db` | legacy |
| `NODE_ENV` | `server/src/legacyWriteGuard.ts:9` | `production` arms the write guard | legacy |
| `ALLOW_LEGACY_WRITES` | `server/src/legacyWriteGuard.ts:11` | `'true'` re-enables HTTP writes in production | legacy |
| `PORT` | `server/src/index.ts:139` | listen port, default 4000 | shared |
| `GIT_COMMIT_SHA` | `server/src/index.ts:104` | manual SHA override for `/api/version` | shared |
| `RAILWAY_GIT_COMMIT_SHA` | `server/src/index.ts:104` | host-provided SHA | shared |
| `VITE_SHADOW_AUTH` | `client/src/lib/shadowConfig.ts:18` | must equal `supabase` | governed |
| `VITE_SUPABASE_URL` | `client/src/lib/shadowConfig.ts:19` | required | governed |
| `VITE_SUPABASE_ANON_KEY` | `client/src/lib/shadowConfig.ts:20` | required | governed |
| `VITE_SHADOW_IMPORT` | `client/src/lib/provenanceConfig.ts:24` | must equal `repository-fixtures` | governed |
| `SHADOW_DB_RUNNER` | `.github/workflows/ci.yml` | selects `supabase-cli` vs shim in CI | CI only |

**[OPEN]** Which of these are actually set on the Railway service, and to what,
is not knowable from this repository. `docs/runbooks/g0a-manifest-template.md`
is the template the owner uses to capture them.

Server-side Supabase configuration is read in
`server/src/provenance/config.ts` and `server/src/provenance/auth.ts`;
**[FACT]** `server/src/provenance/config.ts` participates in
`app.has_secret_like_key`-style hygiene checks and no service-role key is
referenced in any `client/src` file.

### 1.8 Financial calculations — complete enumeration

Every monetary or quantity computation performed by legacy code, with units and
source fields. **All legacy money is SQLite `REAL` (IEEE-754 double), with no
currency column anywhere.** **[FACT]**

| ID | Calculation | Source | Formula | Units | Defect |
|---|---|---|---|---|---|
| C-1 | Inventory cost rollup | `routes/costLinks.ts:8-19` | `confirmed_cost_basis = Σ cost_links.allocated_cost WHERE allocation_status='Confirmed'`; `cost_status = qty≤0 ? 'Uncosted' : qty≥lot.quantity ? 'Costed' : 'Partially Costed'` | float dollars | float accumulation; no currency |
| C-2 | Purchase reconciliation rollup | `routes/costLinks.ts:21-39` | `remaining_quantity = quantity_purchased − Σ allocated_quantity`; `remaining_cost = total_paid − Σ allocated_cost`; **deliberately not clamped at 0** so over-allocation stays visible for LIVE-005 | float dollars / count | float; the non-clamping is a *correct* prior fix, preserve the intent |
| C-3 | Individual allocation bound | `routes/costLinks.ts:52-81` | rejects `allocated_quantity > purchase.quantity_purchased`, `> lot.quantity`, or `allocated_cost > total_paid + 1e-6` | float | epsilon `1e-6` is arbitrary against dollar-denominated floats |
| C-4 | Cumulative confirmation capacity | `routes/costLinks.ts:88-133` | Σ of *other* Confirmed rows + this one must not exceed source qty, source cost, or lot capacity | float | enforced in TypeScript inside a `db.transaction`, not by a database constraint |
| C-5 | Net proceeds | `routes/sales.ts:62` | `gross_item_price + shipping_charged + sales_tax_collected − ebay_fees − promotion_fees − shipping_label_cost − refund_amount − other_expense` | float dollars | **treats marketplace-collected sales tax as seller income.** eBay remits it; it is not revenue |
| C-6 | Known cost basis applied | `routes/sales.ts:68` | `(lot.confirmed_cost_basis / lot.quantity) × quantity_sold`, only when `cost_status` is `Costed` or `Partially Costed`, else `0` | float dollars | divides by *total* lot quantity, not costed quantity, so a partially-costed lot under-applies cost per unit |
| C-7 | Profit after known costs | `routes/sales.ts:69-70` | `Unavailable` → `null`; otherwise `net_proceeds − known_cost_basis_applied` | float dollars | **snapshot, never recomputed.** A sale recorded while the lot is `Uncosted` keeps `profit_status='Unavailable'` permanently even after its cost links are later confirmed |
| C-8 | Availability after sale | `routes/sales.ts:117-121` | `sold_quantity += quantity_sold`; `available_quantity = max(0, lot.quantity − sold_quantity)` | count | `max(0,…)` hides oversale; LIVE-002 then reports 0 because the value can never go negative |
| C-9 | Availability after quantity edit | `routes/inventory.ts:176-180` | `available_quantity = max(0, quantity − sold_quantity)` | count | same clamp |
| C-10 | Dashboard recorded value | `routes/dashboard.ts:14` | `Σ (recorded_unit_value × quantity)` over **all** lots | float dollars | includes sold-out lots; `recorded_unit_value` is owner-entered, not a valuation |
| C-11 | Dashboard totals | `routes/dashboard.ts:11-77` | counts and sums per § 8 | mixed | purchase totals filter `is_excluded = 0`; inventory and sales totals apply no exclusion |
| C-12 | Purchase type summary | `routes/purchases.ts:56-71` | `Σ total_paid` grouped by `COALESCE(product_type,'Unreviewed')`, `is_excluded = 0` | float dollars | float `SUM` over 2,119+ rows |
| C-13 | Listing default quantity | `routes/listings.ts:42-45` | `quantity_to_list` defaults to `lot.available_quantity` or 1 | count | no reservation — two listings can both claim the same units |
| C-14 | Unit cost (imported) | seed data only | `unit_cost` is present in the seed; **no code recomputes it** | float dollars | stale by construction if `total_paid` or `quantity_purchased` were ever corrected |

**[INFER]** C-5, C-6, C-7 together mean the legacy realized-profit figure is not
merely imprecise — it is structurally wrong in three independent ways (tax
treated as income, cost misallocated on partial costing, and never refreshed).
It must not be imported as a governed fact. It may be imported as *historical
evidence of what the legacy system asserted*, which is a different thing.

### 1.9 Tests referring to legacy domains — complete enumeration **[FACT]**

Server (`vitest`, `server/package.json` `"test": "vitest run"`):

| File | Covers | Notes |
|---|---|---|
| `server/src/seed.test.ts` | boot preserves 2,149 rows | `:13` asserts total 2149 pre-flag; `:22` asserts 2149 post-flag. Sets `DATABASE_PATH=':memory:'` at `:3` |
| `server/src/db.test.ts` | `migrateProductType`, `flagFoodPurchases` | |
| `server/src/classify.test.ts` | `classifyPurchase`, `CLASSIFIER_VERSION` | |
| `server/src/validation.test.ts` | `requirePositiveInteger`, `requireNonNegativeNumber` | shared by legacy routes only |
| `server/src/legacyWriteGuard.test.ts` | guard on/off matrix incl. `ALLOW_LEGACY_WRITES=true` | does **not** cover boot-time writes (F-1) |
| `server/src/routes/inventory.test.ts` | `createInventoryLot`, `updateInventoryLot` | |
| `server/src/routes/costLinks.test.ts` | C-1…C-4 bounds and rollups | the densest legacy test file |
| `server/src/routes/listings.test.ts` | `createListing`, `updateListing` | |
| `server/src/routes/sales.test.ts` | `createSale` incl. C-5…C-8 | |
| `server/src/routes/dashboard.test.ts` | `getDashboard` | |
| `server/src/provenance/legacyDecoupling.test.ts` | proves governed routes work with `ALLOW_LEGACY_WRITES` unset | the guard-decoupling contract |

Client (`vitest`): `client/src/pages/Dashboard.test.tsx`,
`client/src/App.governedNav.test.tsx`, `client/src/App.responsive.test.tsx`,
`client/src/components/ReadOnlyBanner.test.ts`,
`client/src/lib/authShell.test.ts`, `client/src/lib/provenanceConfig.test.ts`
(the last two assert `SHADOW_WRITES_ENABLED === false`, see F-3).

**No pgTAP test covers any legacy concept**, because no legacy concept exists in
the governed database. The 54 files in `supabase/tests/` cover workspace, intake,
provenance, acquisition, inventory identity, cycle count, media, listing prep,
and the operations dashboard.

**[FACT]** `supabase/tests/06_provenance_structure.sql` asserts the repository
migration count and names the migrations, so any migration added by this program
must update that assertion or CI fails.

### 1.10 Documentation referring to legacy surfaces **[FACT]**

| File | Legacy content | Status |
|---|---|---|
| `README.md` | lines 11, 31-33, 87-88, 106, 147, 239, 253-271: seed counts, `vault.db` path, volume instructions, the 2,149/2,119 note | accurate at audit; must be rewritten as each domain retires |
| `docs/architecture.md` | lines 11-19 (two-system table), 25-71 (safety notices), 73-84 (write guard), 218-228 (SQLite paths/WAL) | accurate at audit |
| `docs/ai/CURRENT_STATE.md` | records migration count **47** and last reviewed merge PR #25 | **STALE.** Actual count 60; PR #36 merged. Not edited by this work order |
| `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md` | prior pass (PR #36), base `ac0441c5…`, 56→60 migrations | superseded by this pass |
| `docs/runbooks/railway-backup-deploy-preflight.md` | the SQLite backup procedure, WAL warning, restore steps | load-bearing for retirement; must survive until the tables are dropped |
| `docs/runbooks/g0a-manifest-template.md` | captures `DATA_DIR`, `DATABASE_PATH`, volume presence | same |
| `docs/runbooks/hosted-migration-parity.md` | how hosted migration truth is established | governed; unaffected |
| `docs/supabase-shadow-foundation.md` | line 197 repeats the `dataAdapter.ts` claim | inherits defect F-3 |
| `.github/pull_request_template.md` | lines 37-38 restate the 2,149/2,119 caution | keep until adjudicated |
| `docs/repo-structure-review.md` | mentions `better-sqlite3` | informational |

### 1.11 Production persistence assumptions **[FACT]/[DOC]/[OPEN]**

**[FACT]** `server/src/db.ts:13` does `fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })`
then opens the database, creating it if absent. `journal_mode = WAL` at `:16`.

**[FACT]** `seedIfEmpty()` reseeds any *empty* table from the repository JSON at
every boot. **[INFER]** If the Railway volume is lost, detached, or remounted
empty, the next boot silently repopulates `inventory_lots` with 1,487 rows,
`whatnot_purchases` with 2,149 rows, `cost_links` with 287 Candidate rows,
`ebay_listings` with 20 Draft rows, and `checks` with 7 rows — overwriting the
production state with the initial import and, critically, **restoring the 30
food rows the production database may not have**. The `sales` table would
remain empty because it has no seeder (F-4), so recorded sales would be lost
outright with no automatic replacement.

**[DOC]** `README.md:253-261` instructs mounting a Railway volume and setting
`DATA_DIR=/data`. `README.md:270-271` documents deleting `vault.db` from the
volume as the supported way to reseed — i.e. the reseed-on-empty behavior is
intentional, not accidental.

**[DOC]** `docs/architecture.md:224-228` and
`docs/runbooks/railway-backup-deploy-preflight.md:31,70-71` both warn that
copying `vault.db` alone while the writer is live is not a consistent backup
because of WAL.

**[OPEN]** Whether the Railway service currently has a persistent volume
attached, and whether `DATA_DIR`/`DATABASE_PATH` point at it, is not knowable
from this repository. `docs/architecture.md:96-101` records that the owner
collected and verified backup evidence before the Phase 0 merge (Gate G0A
READY) but states that no Claude session has Railway access.

**Consequence for this program [INFER]:** the reseed-on-empty path is a live
data-loss hazard for the whole retirement window. It should be disabled — not
by removing the seeder outright, which breaks local development and 11 tests,
but by gating `seedIfEmpty()` on an explicit opt-in that production does not
set. This is scoped as slice 0 in `05_IMPLEMENTATION_SEQUENCE.md`.

---

## 2. Domain census

### Domain A — Legacy Inventory

| Field | Value |
|---|---|
| **User-facing purpose** | Browse, search, filter, sort and inline-edit the 1,487 spreadsheet-imported lots; create a new lot |
| **Navigation entry** | `PRIMARY_NAV` "Legacy Inventory" (`App.tsx:54`); `LEGACY_ONLY_NAV` "Inventory" (`:81`) |
| **Client route** | `/inventory` |
| **Client files** | `client/src/pages/Inventory.tsx` (396 lines); mutations at `:153` (PATCH), `:328` (POST); types `InventoryLot` in `client/src/lib/api.ts` |
| **API endpoints** | GET `/api/inventory`, GET `/api/inventory/facets`, GET `/api/inventory/:id`, POST `/api/inventory`, PATCH `/api/inventory/:id` |
| **Server files** | `server/src/routes/inventory.ts`, `server/src/ids.ts`, `server/src/validation.ts`, `server/src/db.ts` |
| **SQLite tables** | `inventory_lots` (46 columns); indexes `idx_inventory_product`, `idx_inventory_vertical`, `idx_inventory_cost_status`, `idx_inventory_listing_status` |
| **Seed file** | `server/seed/inventory.json` — 1,487 rows, all `record_origin='Imported Legacy'`, all `cost_status='Uncosted'` |
| **Important fields** | `inventory_lot_id`, `sellable_sku`, `tracking_mode` (`Lot-managed` \| `Serialized`), `quantity`, `available_quantity`, `sold_quantity`, `cost_status`, `confirmed_cost_basis`, `listing_status`, `location_code`, `recorded_unit_value`, `business_vertical`, `category`, plus category-specific attributes (`card_number`, `grading_company`, `numeric_grade`, `certification_number`, `shoe_size`, `apparel_size`, `serial_number`) |
| **Writes** | insert a lot with server-minted `RV-N-######` id + `T`-prefixed SKU + `RV-ITEM-N-` reserved child id (`inventory.ts:81-83`); patch 28 allowlisted fields (`:150-157`); recompute `available_quantity` on a quantity change |
| **Calculations** | C-9 |
| **Financial assumptions** | `recorded_unit_value` is owner-entered and is **not** a cost basis or a valuation; `confirmed_cost_basis` is written only by the cost-links rollup (C-1), never by this route |
| **Inventory assumptions** | one flat row per lot; `tracking_mode='Serialized'` is a *string*, with no per-unit rows — `reserved_child_id`/`active_child_id` are placeholders that nothing populates; no location hierarchy (`location_code` is free text); no movement history; no state machine |
| **Tests** | `server/src/routes/inventory.test.ts`, `server/src/seed.test.ts` |
| **Known defects** | `nextId()` (`ids.ts:3-19`) selects every matching id, parses each, and takes the max — an O(n) scan per insert, and correct only because `better-sqlite3` is synchronous within one process; no uniqueness constraint backs it. No `NOT NULL` on any business column. Serialized lots have no serialized units. `available_quantity` is clamped ≥ 0 so oversale is invisible (C-8/C-9) |
| **Governed overlap** | **Substantial.** `product_catalog` → `sellable_skus` → `inventory_lots` → `inventory_items`; `inventory_movements`, `inventory_lot_lineage`, `inventory_quantity_adjustments`, `inventory_correction_requests`, `inventory_loss_events`, `storage_locations`; views `inventory_record_overview`, `inventory_lot_overview`, `inventory_item_overview`, `inventory_location_balances`, `inventory_work_queue`; category attribute tables `tcg_*`, `footwear_*`, `other_*`; functions `mint_sku`, `mint_serialized_item`, `stage_inventory_lot`, `move_inventory_lot`, `move_inventory_item`, `adjust_lot_quantity`, `recount_lot_quantity`, `split_inventory_lot`, `merge_inventory_lots`, `supersede_inventory_record` |
| **Data authority** | Supabase for anything entered through governed intake. SQLite holds 1,487 rows that exist nowhere else |
| **Historical value** | High. This is the original workbook import and the only record of pre-Vault holdings |
| **Replacement recommendation** | Replace the surface entirely with Current Inventory. Import the 1,487 rows as governed lots/items with an `Imported Legacy` provenance marker, after owner triage of which rows are still physically held |
| **Removal prerequisites** | (1) all 1,487 rows classified as still-held / disposed / unknown; (2) still-held rows imported and reconciled 1:1 by `inventory_lot_id`; (3) `/inventory` receives no traffic for one owner-agreed observation window; (4) no governed surface reads `/api/inventory` |

### Domain B — Whatnot Purchases

| Field | Value |
|---|---|
| **User-facing purpose** | Browse the imported Whatnot purchase file; filter by seller, vertical, reconciliation status, product type; see spend by product type; hand-correct an ambiguous product type |
| **Navigation entry** | `LEGACY_NAV` "Whatnot Purchases" (`App.tsx:64`), also in `LEGACY_ONLY_NAV` (`:83`) |
| **Client route** | `/purchases` |
| **Client files** | `client/src/pages/Purchases.tsx` (234 lines); mutation at `:157`; types `WhatnotPurchase`, `ProductType`, `TypeSummary` in `lib/api.ts` |
| **API endpoints** | GET `/api/purchases`, GET `/api/purchases/type-summary`, GET `/api/purchases/facets`, GET `/api/purchases/:id`, PATCH `/api/purchases/:id` |
| **Server files** | `server/src/routes/purchases.ts`, `server/src/classify.ts`, `server/src/db.ts` |
| **SQLite tables** | `whatnot_purchases`; indexes `idx_purchases_product`, `idx_purchases_seller`, `idx_purchases_recon`, `idx_purchases_type` |
| **Seed file** | `server/seed/whatnot_purchases.json` — 2,149 rows, 2,149 distinct `acquisition_line_id`, 2,149 distinct `order_id`, 30 `Food / consumables` |
| **Important fields** | `acquisition_line_id` (`WN-A-######`), `order_id`, `processed_date`, `seller`, `product_name`, `quantity_purchased`, `total_paid`, `unit_cost`, `order_status`, `source_file`, `is_excluded`, `exclusion_reason`, `product_type`, `product_type_source`, plus the four denormalized reconciliation columns |
| **Writes** | `PATCH /api/purchases/:id` sets `product_type` + `product_type_source='manual'`; **boot-time** `flagFoodPurchases` (`db.ts:230`) and the classifier backfill (`db.ts:266-291`) |
| **Calculations** | C-2 (written by the cost-links router, not this one), C-12, C-14 |
| **Financial assumptions** | `total_paid` is the line total in unstated currency; `unit_cost` is imported and never recomputed; no shipping, tax, fee, or discount is modelled anywhere — a Whatnot order's shipping cost simply does not exist in this schema |
| **Inventory assumptions** | none. A purchase line is never linked to received stock except through `cost_links` |
| **Tests** | `server/src/db.test.ts`, `server/src/classify.test.ts`, `server/src/seed.test.ts` |
| **Known defects** | `order_id` is unique per line, so there is no order grain. `CLASSIFIER_VERSION` bumps silently re-tag every non-manual row at boot (`db.ts:266-291`) — a data mutation triggered by a code deploy. The classifier hardcodes three seller specializations (`classify.ts:48-52`) as owner ground truth with no database record of that assertion. No currency column |
| **Governed overlap** | **Strong and already built.** `channels`, `suppliers`, `supplier_aliases`, `acquisition_orders`, `acquisition_lots`, `acquisition_lot_lines`, `acquisition_line_items`, `acquisition_cost_components`, `acquisition_import_jobs`; upstream `source_systems`, `import_jobs`, `source_records`, `external_identifiers`, `source_crosswalks`, `data_quality_issues`; functions `begin_acquisition_import_job`, `stage_acquisition_orders`, `stage_acquisition_lots`, `stage_acquisition_line_items`, `stage_acquisition_cost_components`, `finalize_acquisition_import_job`, `get_committed_acquisition_summary`. Client surface `/acquisition-review`, server `server/src/routes/acquisition.ts` (19 endpoints), driver `server/src/acquisition/commitDriver.ts` — which is already written for a 2,149-line job in bounded batches (`commitDriver.ts:10,92`) |
| **Data authority** | SQLite. The governed acquisition schema is explicitly staging/non-authoritative per its own migration header |
| **Historical value** | **Highest of any legacy dataset.** It is the sole record of what was bought, from whom, when, and for how much |
| **Replacement recommendation** | Replace with governed Acquisition: orders, receiving, import evidence, discrepancies, landed cost, supplier performance, unresolved queues. The import machinery already exists and reads the same file |
| **Removal prerequisites** | (1) all 2,149 lines imported as `acquisition_line_items` preserving `WN-A-*` ids exactly; (2) row-level reconciliation against the production backup complete and the 30-row question adjudicated (F-6); (3) `product_type` decisions migrated to a governed classification with recorded provenance; (4) `/purchases` traffic at zero for the observation window |

### Domain C — Cost Basis Links

| Field | Value |
|---|---|
| **User-facing purpose** | Propose, confirm and reject allocations of purchase spend onto inventory lots; the only path by which a legacy lot acquires a cost basis |
| **Navigation entry** | `LEGACY_NAV` "Cost Basis Links" (`App.tsx:65`); `LEGACY_ONLY_NAV` (`:84`) |
| **Client route** | `/cost-links` |
| **Client files** | `client/src/pages/CostLinks.tsx` (296 lines); POST at `:39`, PATCH at `:224` |
| **API endpoints** | GET `/api/cost-links`, POST `/api/cost-links`, PATCH `/api/cost-links/:id` |
| **Server files** | `server/src/routes/costLinks.ts` (336 lines — the most logic-dense legacy file), `server/src/validation.ts`, `server/src/ids.ts` |
| **SQLite tables** | `cost_links`; indexes `idx_costlinks_lot`, `idx_costlinks_line`. Writes through to `inventory_lots` and `whatnot_purchases` |
| **Seed file** | `server/seed/cost_links.json` — 287 rows, all `Candidate` |
| **Important fields** | `allocation_id` (`RV-ALLOC-######`), `inventory_lot_id`, `acquisition_line_id`, `allocated_quantity`, `allocated_cost`, `allocation_status` (`Candidate`\|`Confirmed`\|`Rejected`), `match_confidence`, `match_method`, `supporting_evidence`, `row_status`, plus six denormalized snapshot columns copied from the lot and purchase at creation |
| **Writes** | insert with duplicate-pair guard and bounds checks, inside `db.transaction`; patch six allowlisted fields with re-validation; both recompute C-1 and C-2 |
| **Calculations** | C-1, C-2, C-3, C-4 |
| **Financial assumptions** | conservation is enforced in application code (C-3/C-4), not by the database. `allocated_cost` may be any non-negative float ≤ source `total_paid`; there is no requirement that an allocation's cost be proportional to its quantity. No shipping/tax/fee component exists to allocate |
| **Inventory assumptions** | a lot's cost capacity is `lot.quantity`; a purchase's is `quantity_purchased`. Both are floats |
| **Tests** | `server/src/routes/costLinks.test.ts` |
| **Known defects** | Conservation invariants live in TypeScript; a direct SQL write bypasses all of them. Float epsilon `1e-6` (`costLinks.ts:42`). `Rejected` rows are excluded from the duplicate guard, so a pair can be rejected and re-created indefinitely with no lineage. No reversal concept — a confirmed allocation is un-done by editing its status, which silently rewrites the rollups with no record that it was ever confirmed. The six denormalized snapshot columns go stale the moment the lot or purchase is edited |
| **Governed overlap** | **Strong and already built, and materially better.** `acquisition_cost_components` (typed: `item_price`\|`shipping`\|`tax`\|`fee`\|`discount`\|`other`; states `known`\|`documented_free`\|`unknown`; attribution `direct`\|`allocated`\|`unresolved`), `acquisition_cost_allocations` (`candidate`\|`confirmed`\|`reversed`); functions `propose_cost_allocation`, `confirm_cost_allocation`, `reverse_cost_allocation`, `reverse_cost_component`; triggers `app.enforce_cost_allocation_transition`, `app.enforce_cost_component_reversal_coherence`, `app.enforce_cost_allocation_initial_state` |
| **Data authority** | SQLite |
| **Historical value** | Medium. 287 unconfirmed candidates in the seed; production state unknown **[OPEN]** |
| **Replacement recommendation** | Replace with governed allocation: explainable matching, recorded confidence, first-class reversal, database-enforced source-total conservation, and — the piece that does not exist anywhere today — an inventory-level cost basis and COGS read model |
| **Removal prerequisites** | (1) every production `cost_links` row with status `Confirmed` re-expressed as a governed `acquisition_cost_allocations` row in `confirmed` state with conservation proven; (2) `Candidate` rows either re-proposed or explicitly abandoned with a reason; (3) `Rejected` rows imported as historical evidence only; (4) a governed inventory-cost-basis read model exists and its totals are reconciled against C-1 for every lot |

### Domain D — eBay Listings

| Field | Value |
|---|---|
| **User-facing purpose** | Create a listing draft against a lot, record title/price/policies/photos-complete, and hand-track its status through to Sold |
| **Navigation entry** | `LEGACY_NAV` "eBay Listings" (`App.tsx:66`); `LEGACY_ONLY_NAV` (`:85`) |
| **Client route** | `/listings` |
| **Client files** | `client/src/pages/Listings.tsx` (240 lines); POST at `:45`, PATCH at `:183` |
| **API endpoints** | GET `/api/listings`, GET `/api/listings/:id`, POST `/api/listings`, PATCH `/api/listings/:id` |
| **Server files** | `server/src/routes/listings.ts` |
| **SQLite tables** | `ebay_listings`; indexes `idx_listings_lot`, `idx_listings_status`. Writes through to `inventory_lots.listing_status` |
| **Seed file** | `server/seed/ebay_listings.json` — 20 rows, all `Draft` |
| **Important fields** | `listing_id` (`RV-LST-######`), `inventory_lot_id`, `listing_title`, `list_price`, `minimum_acceptable_price`, `photos_complete` (text `'Yes'`/`'No'`), `photo_reference`, `shipping_policy`, `return_policy`, `listing_format`, `best_offer`, `promotion_rate_percent`, `ebay_category_id`, `ebay_item_id`, `listing_url`, `listed_date`, `listing_status` |
| **Writes** | insert a draft, defaulting `quantity_to_list` to `available_quantity`, and set `inventory_lots.listing_status='Has draft'`; patch 18 fields, auto-stamp `listed_date` on first transition to `Active`, and mirror `listing_status` onto the lot |
| **Calculations** | C-13 |
| **Financial assumptions** | `list_price` and `minimum_acceptable_price` are floats with no currency. `promotion_rate_percent` is stored but used in no calculation anywhere |
| **Inventory assumptions** | **none enforced.** `quantity_to_list` is not reserved and not checked against other open listings — two listings can each claim the full available quantity of one lot |
| **Tests** | `server/src/routes/listings.test.ts` |
| **Known defects** | **No eBay integration of any kind.** `ebay_item_id`, `listing_url` and `listing_status` are free-text fields a human types. `listing_status` is an unconstrained string mirrored onto the lot on every patch, so the last listing edited wins the lot's status regardless of the others. `photos_complete` is a self-attested `'Yes'`/`'No'` string with no connection to any stored image |
| **Governed overlap** | **Partial, and the strongest existing foundation.** `listing_prep` carries subject (item or lot), status, priority, assignee, working title, condition summary, description notes, defect disclosures, included items, research notes, format, `quantity_to_list`, **integer** `asking_price_minor`/`minimum_price_minor` with an explicit `currency`, package dimensions and weight, shipping/return policy refs, and `external_listing_ref` + `listed_at`. Supporting: `listing_prep_checks`, `listing_prep_events`, `listing_prep_requirements`, `listing_package_presets`, views `listing_prep_readiness`, `listing_prep_candidates`; functions `start_listing_prep`, `update_listing_prep_content`, `set_listing_prep_check`, `evaluate_listing_prep_readiness`, `transition_listing_prep`, `bulk_listing_prep_action`, `apply_listing_package_preset`, `mark_listing_prep_listed`. Photo truth comes from `inventory_media` + `inventory_media_readiness_current`, not a self-attested string |
| **Data authority** | SQLite for `ebay_listings`; Supabase for `listing_prep`. **These are two different concepts, not two copies of one** — Listing Prep ends where a listing is created elsewhere |
| **Historical value** | Low. 20 draft rows in the seed; production state unknown **[OPEN]** |
| **Replacement recommendation** | Governed marketplace listing: real eBay synchronization, AI-assisted drafts bound to governed evidence, category and item specifics, publish/revise/end/relist with durable API evidence, status reconciliation, pricing recommendations. Listing Prep becomes its upstream stage rather than being replaced |
| **Removal prerequisites** | (1) governed listing entity exists with publish/revise/end/relist and durable request-response evidence; (2) every production `ebay_listings` row with a real `ebay_item_id` linked to a governed listing; (3) drafts without an item id migrated to `listing_prep` or abandoned; (4) `inventory_lots.listing_status` no longer read by any surface |

### Domain E — Sales

| Field | Value |
|---|---|
| **User-facing purpose** | Record a sale against a lot with gross price, shipping, tax, fees and expenses; see net proceeds and profit; track payment, fulfillment, tracking and return status |
| **Navigation entry** | `LEGACY_NAV` "Sales" (`App.tsx:67`); `LEGACY_ONLY_NAV` (`:86`) |
| **Client route** | `/sales` |
| **Client files** | `client/src/pages/Sales.tsx` (273 lines); POST at `:53`, PATCH at `:223` |
| **API endpoints** | GET `/api/sales`, GET `/api/sales/:id`, POST `/api/sales`, PATCH `/api/sales/:id` |
| **Server files** | `server/src/routes/sales.ts` |
| **SQLite tables** | `sales`; index `idx_sales_lot`. Writes through to `inventory_lots` and `ebay_listings` |
| **Seed file** | `server/seed/sales.json` exists but is `[]` and **is never loaded** (F-4) |
| **Important fields** | `sale_id` (`RV-SALE-######`), `listing_id`, `inventory_lot_id`, `ebay_order_id`, `sold_date`, `quantity_sold`, `gross_item_price`, `shipping_charged`, `sales_tax_collected`, `ebay_fees`, `promotion_fees`, `shipping_label_cost`, `refund_amount`, `other_expense`, `net_proceeds`, `known_cost_basis_applied`, `profit_after_known_costs`, `profit_status`, `payment_status`, `fulfillment_status`, `tracking_number`, `delivered_date`, `return_status` |
| **Writes** | `POST` runs in `db.transaction`: validates `quantity_sold ≤ available_quantity` (`sales.ts:48-51`), computes C-5/C-6/C-7, inserts, then decrements lot availability (C-8) and marks the listing `Sold` when availability reaches 0. `PATCH` edits only seven status/tracking fields and recomputes nothing |
| **Calculations** | C-5, C-6, C-7, C-8 |
| **Financial assumptions** | all eight money inputs are owner-typed floats with no currency. Fees are entered by hand, not fetched. There is no payout, no settlement, no marketplace reconciliation, and no concept of money actually received |
| **Inventory assumptions** | a sale permanently decrements `sold_quantity`; there is no reversal. A cancelled or returned sale cannot restore inventory through any route |
| **Tests** | `server/src/routes/sales.test.ts` |
| **Known defects** | **The most defective legacy domain.** (a) `sales_tax_collected` is added to net proceeds as income (C-5) though the marketplace remits it. (b) Cost is divided by *total* lot quantity even when only part of the lot is costed (C-6). (c) `profit_after_known_costs` and `profit_status` are snapshots never recomputed when the lot is later costed (C-7) — a sale recorded before its cost links are confirmed reads `Unavailable` forever. (d) `refund_amount` is **not** in the PATCH allowlist (`sales.ts:142`), so a refund arriving after the sale is recorded cannot be entered at all. (e) `return_status` is editable text that triggers no inventory restoration. (f) No reversal path: a mistaken sale is unfixable without direct SQL |
| **Governed overlap** | **None.** There is no governed order, sale, fee, refund, return, payout, or realized-profit entity. The nearest governed concepts are `record_inventory_item_loss` and `adjust_lot_quantity`, which are inventory operations, not commercial ones |
| **Data authority** | SQLite, exclusively, with no repository-side copy |
| **Historical value** | **Potentially the highest-risk dataset**, precisely because it exists only in production (F-4) |
| **Replacement recommendation** | Replace with the full governed commercial tail: marketplace orders, order lines, reservation, picking, packing, shipping labels, tracking, fulfillment events, cancellations, refunds, returns, returned-item disposition, inventory exit and restoration, marketplace fees, advertising fees, payouts, payout reconciliation, and a *derived* realized-profit read model that recomputes rather than snapshots |
| **Removal prerequisites** | (1) a production export of `sales` exists and is verified — **this must happen before any other retirement step, because nothing else can reconstruct it**; (2) every row imported as historical evidence with its legacy-asserted profit preserved as an assertion, not a fact; (3) governed realized profit computed independently and the two compared per sale with differences explained; (4) inventory exit for each historical sale reconciled against governed stock |

### Domain F — Health Checks

| Field | Value |
|---|---|
| **User-facing purpose** | Show integrity checks over identities, relationships and reconciliation, split into "Live checks" and "Imported baseline checks" |
| **Navigation entry** | `TOOLS_NAV` "Health Checks" (`App.tsx:74`); `LEGACY_ONLY_NAV` (`:86`) |
| **Client route** | `/checks` |
| **Client files** | `client/src/pages/Checks.tsx` (83 lines) |
| **API endpoints** | GET `/api/checks` |
| **Server files** | `server/src/routes/checks.ts` |
| **SQLite tables** | reads `checks` (stored) and computes over `inventory_lots`, `cost_links`, `whatnot_purchases`, `sales` (live). No writes |
| **Seed file** | `server/seed/checks.json` — 7 rows, `OP-001`…`OP-007` |
| **Important fields** | `check_id`, `test`, `actual`, `expected`, `difference`, `status` (`PASS`\|`WARN`\|`FAIL`), `notes` |
| **Writes** | none |
| **Live checks — the complete set** | `LIVE-001` inventory ids unique (`checks.ts:12`); `LIVE-002` no negative `available_quantity` (`:19`); `LIVE-003` cost links resolve to a lot (`:30`); `LIVE-004` cost links resolve to a purchase (`:41`); `LIVE-005` no purchase line over-allocated, i.e. `remaining_quantity < 0` (`:50`); `LIVE-006` sales have a known cost basis — status `WARN`, not `FAIL` (`:61`) |
| **Calculations** | counts only |
| **Known defects** | `LIVE-002` can never fail, because C-8/C-9 clamp `available_quantity` at 0 — the check is structurally dead. `LIVE-001` compares `COUNT(*)` to `COUNT(DISTINCT pk)` on a primary key, so it can never fail either. `LIVE-003`/`LIVE-004` restate declared foreign keys that SQLite already enforces (`PRAGMA foreign_keys = ON`). `LIVE-005` is the only genuinely load-bearing check. The 7 stored `OP-*` checks are frozen import-time results presented alongside live ones with no date, so a stale `PASS` looks current. No check is actionable: there is no owner, no queue, no resolution record, and no alert |
| **Governed overlap** | **Partial.** `data_quality_issues` (typed `malformed_row`\|`conflict`\|`duplicate_candidate`\|`count_discrepancy`\|`total_discrepancy`\|`blocked_mapping`\|`missing_required`; severity; status; `resolved_by`/`resolved_at`/`resolution_note`; `raw_payload_snapshot`) with `resolve_data_quality_issue`; `inventory_media_issues` with `reconcile_inventory_media` and `resolve_inventory_media_issue`; `inventory_work_queue`; `get_operations_inventory_health`; `cycle_count_discrepancies` with a full governed resolution matrix. These are import- and media-scoped, not commercial-integrity-scoped |
| **Data authority** | derived; no authority of its own |
| **Historical value** | Low for the 7 stored rows; the *check definitions* are worth preserving as requirements |
| **Replacement recommendation** | Governed data-quality controls: a control registry, scheduled evaluation, anomaly detection, prioritized repair queues with an owner, evidence attached to each finding, alerting, and auditable resolution — with every legacy check re-expressed as a governed control **that can actually fail** |
| **Removal prerequisites** | (1) `LIVE-001`…`LIVE-006` re-expressed as governed controls over governed data (`LIVE-002` reformulated so oversale is detectable); (2) the 7 `OP-*` baseline results imported as dated historical evidence; (3) a governed data-quality surface exists with owner assignment and resolution history |

### Domain G — Legacy Dashboard

| Field | Value |
|---|---|
| **User-facing purpose** | "Today at a glance": legacy inventory, purchase, cost-link, listing and sales totals, recent activity, and value by vertical |
| **Navigation entry** | `PRIMARY_NAV` "Dashboard" (`App.tsx:49`); `LEGACY_ONLY_NAV` (`:80`) |
| **Client route** | `/` |
| **Client files** | `client/src/pages/Dashboard.tsx` (300 lines) — **hybrid**: `WorkspaceSummarySection` (`:24`) reads the governed operations dashboard; the legacy panel below reads `GET /api/dashboard` (`:146`) |
| **API endpoints** | GET `/api/dashboard` |
| **Server files** | `server/src/routes/dashboard.ts` |
| **SQLite tables** | reads all six business tables. No writes |
| **Seed file** | none |
| **Calculations** | C-10, C-11 |
| **Financial assumptions** | "Recorded value" is `Σ (recorded_unit_value × quantity)` over **all** lots including fully sold ones (C-10) — it is not a valuation, not a cost, and not net of sales. Purchase totals filter `is_excluded = 0`; inventory and sales totals do not filter anything. **[INFER]** The two halves of the page therefore apply different population rules, and the legacy panel's own figures apply three different ones |
| **Inventory assumptions** | every `inventory_lots` row is current stock; there is no lifecycle state to exclude |
| **Tests** | `server/src/routes/dashboard.test.ts`, `client/src/pages/Dashboard.test.tsx` |
| **Known defects** | Sums float money across 1,487 rows. `topVerticals` is limited to 8 with no "other" bucket, so the parts do not sum to the whole. No `asOf` timestamp on the legacy panel, unlike the governed panels which carry one. Numbers are not clickable — they do not open the records they counted, which is the exact defect the governed dashboard was repaired to fix (see `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md`) |
| **Governed overlap** | **Partial and operationally superior.** `get_operations_inventory_health`, `get_operations_media_backlog`, `get_listing_prep_summary`, `get_media_readiness_summary`, views `inventory_work_queue`, `listing_prep_candidates`, `listing_prep_readiness`; client `client/src/lib/operationsDashboardApi.ts`; server `server/src/routes/operationsDashboard.ts` (`/health`, `/work`, `/workflows`, `/media-readiness`, `/activity`). **Gap:** the governed dashboard has no commercial dimension at all — no spend, no capital tied up, no sales, no margin |
| **Data authority** | derived |
| **Historical value** | None; it is purely a projection |
| **Replacement recommendation** | One authoritative command center: work priorities, commercial performance, capital tied up, listing and sales funnels, pricing reviews, exception queues, and an AI daily brief — every tile opening the exact records it counted, every panel carrying an `asOf`, and a dependency failure rendering as a named failure rather than a fabricated `0` |
| **Removal prerequisites** | (1) governed equivalents exist for every legacy tile the owner still uses, each with a stated population rule; (2) the owner confirms which legacy tiles are genuinely used and which are noise; (3) `Dashboard.tsx` no longer calls `GET /api/dashboard` |

### Domain H — Shared SQLite infrastructure

| Field | Value |
|---|---|
| **User-facing purpose** | none directly; it is what the other six domains stand on |
| **Files** | `server/src/db.ts` (connection, `initSchema`, `migrateProductType`, `flagFoodPurchases`, `meta`/`setMeta`), `server/src/seed.ts`, `server/src/ids.ts`, `server/src/validation.ts`, `server/src/classify.ts` |
| **Tables** | all 8 (§ 1.4), including dead `meta` |
| **Writes** | **at boot, ungated:** `initSchema` DDL; `seedIfEmpty` inserts; `migrateProductType` DDL + `flagFoodPurchases` UPDATE + classifier backfill UPDATE (F-1) |
| **Calculations** | none directly; hosts `nextId` and the shared validators |
| **Known defects** | F-1 (boot writes bypass the guard). Reseed-on-empty is a silent data-restoration hazard (§ 1.11). `nextId` is an O(n) scan with no uniqueness backstop. `meta` is dead schema. `is_excluded`/`exclusion_reason` are declared twice (`db.ts:87-88` and `:257-262`) and must be kept in agreement by hand. `CLASSIFIER_VERSION` bumps mutate production data on deploy |
| **Governed overlap** | `supabase/migrations/` + `scripts/db/reset.mjs` + `scripts/db/test.mjs` + `public.schema_migrations_log` are the governed equivalents of `initSchema`/`migrateProductType`, and are forward-only, replayable, and CI-verified |
| **Data authority** | n/a |
| **Historical value** | the schema is the documentation of what the legacy system meant |
| **Replacement recommendation** | Not replaced — **removed**, once every dependent domain has crossed. `server/src/validation.ts` is used only by legacy routes and goes with them. `scripts/verify-sqlite-backup.mjs` is retained as an offline verifier for the archived backup |
| **Removal prerequisites** | all of A–G removed; then delete `db.ts`, `seed.ts`, `ids.ts`, `validation.ts`, `classify.ts`, `server/seed/*.json` (after archiving), and the `better-sqlite3` + `@types/better-sqlite3` dependencies |

### Domain I — Legacy authentication and write controls

| Field | Value |
|---|---|
| **User-facing purpose** | prevent accidental legacy writes in production; tell the operator the app is read-only |
| **Client files** | `client/src/components/ReadOnlyBanner.tsx` (+ `.test.ts`), which polls `GET /api/health`; `client/src/lib/dataAdapter.ts` (stale, F-3) |
| **Server files** | `server/src/legacyWriteGuard.ts` (24 lines), mounted at `server/src/index.ts:83` |
| **Endpoints** | `GET /api/health` returns `{ ok, readOnly }` |
| **Env vars** | `NODE_ENV`, `ALLOW_LEGACY_WRITES` |
| **Behavior** | `legacyWritesEnabled = !isProduction || ALLOW_LEGACY_WRITES === 'true'`. When disabled, any non-`GET`/`HEAD`/`OPTIONS` under `/api` gets `403 { error, readOnly: true }`. Governed routers are mounted *before* the guard and are deliberately exempt (`server/src/index.ts:34-49`), a decoupling asserted by `server/src/provenance/legacyDecoupling.test.ts` |
| **Authentication** | **there is none on the legacy surface.** No token, no session, no workspace, no role. Anyone who can reach the URL can read every legacy row, and can write them if the flag is on |
| **Tests** | `server/src/legacyWriteGuard.test.ts`, `server/src/provenance/legacyDecoupling.test.ts`, `client/src/components/ReadOnlyBanner.test.ts` |
| **Known defects** | F-1 — boot writes bypass it entirely, so "read-only" is not true of the process. Reads are never blocked, so the unauthenticated read surface is permanent while the routes exist. `ALLOW_LEGACY_WRITES` is a single global switch: it cannot be scoped to one domain, so partial cutover cannot be expressed through it |
| **Governed overlap** | Supabase Auth + `workspaces`/`workspace_members` + `app.member_role`/`app.assert_workspace_role` + RLS + per-route `requireMember`/`requireOperator`/`requireOwner` |
| **Data authority** | n/a |
| **Replacement recommendation** | Retire with the routes. Per-domain read-only is achieved by deleting that domain's non-safe handlers, not by a global flag. The `ReadOnlyBanner` becomes unnecessary once no legacy write path exists |
| **Removal prerequisites** | no `/api` route remains that writes SQLite; `dataAdapter.ts` corrected or deleted along with its two asserting tests |

### Domain J — Seed, backup, restore and deployment dependencies

| Field | Value |
|---|---|
| **Purpose** | get data into a fresh install; get data out for safekeeping; keep it alive across redeploys |
| **Seeding** | `seedIfEmpty()` at `server/src/index.ts:28`; `npm run seed` → `server/src/seed.ts:94-97`; `npm run seed` at repository root delegates to the server |
| **Backup** | `scripts/verify-sqlite-backup.mjs` (read-only: SHA-256, `PRAGMA integrity_check`, per-table row counts, JSON output, exit codes 0/2/3/4); `npm run verify:backup` at root and in `server/package.json` |
| **Runbooks** | `docs/runbooks/railway-backup-deploy-preflight.md` (capture with `.backup`, never copy `vault.db` alone under WAL, restore steps, manifest fields); `docs/runbooks/g0a-manifest-template.md` (captures `DATA_DIR`, `DATABASE_PATH`, volume presence and use) |
| **Deployment** | `railway.json`: NIXPACKS, `npm run build` → `npm run start`, healthcheck `/api/health`, restart ON_FAILURE ×10. `npm run start` → `server`'s `NODE_ENV=production tsx src/index.ts`. `npm run build` installs both workspaces and builds the client; `server/src/index.ts:113-125` serves `client/dist` with an SPA fallback |
| **CI** | `.github/workflows/ci.yml`, four jobs: `build-and-verify`, `shadow-db-supabase-stack`, `shadow-db-postgres-shim`, `dev-advisory-report`. The workflow explicitly never deploys and never touches a remote database |
| **Known defects** | Reseed-on-empty silently restores the initial import over a lost volume (§ 1.11) — and would restore the 30 food rows to a production database that may not have them. `sales` has no seeder, so that table alone is lost with no replacement (F-4). No automated backup exists; capture is a manual owner procedure. The healthcheck `/api/health` succeeds even when SQLite is empty, so a volume loss does not fail the health probe |
| **Governed overlap** | `scripts/db/reset.mjs` + `scripts/db/test.mjs` replay every migration from empty in CI; `public.schema_migrations_log` makes hosted parity checkable; `docs/runbooks/hosted-migration-parity.md` is the owner procedure |
| **Replacement recommendation** | Retain the backup verifier and the preflight runbook through the whole program and past SQLite's removal — they are how the archived backup stays checkable. Gate `seedIfEmpty()` behind an explicit opt-in immediately (slice 0). Archive `server/seed/*.json` under the program directory before deleting them from `server/seed/` |
| **Removal prerequisites** | final backup captured, verified with `verify-sqlite-backup.mjs`, archived at an owner-recorded location and SHA-256; retention period elapsed; runbooks rewritten to describe the archive rather than a live database |

---

## 3. Completeness verification

| # | Check | Result |
|---|---|---|
| 1 | All client routes enumerated | ✅ 25 (7 legacy + 18 governed), § 1.1 |
| 2 | All server routes enumerated | ✅ 24 legacy SQLite-backed + 2 runtime + 9 governed routers, § 1.3 |
| 3 | All SQLite tables and material indexes enumerated | ✅ 8 tables, 13 indexes, 5 FKs, § 1.4 |
| 4 | Overlapping Supabase tables/domains enumerated | ✅ per domain in § 2 |
| 5 | All seed files enumerated | ✅ 7, § 1.5 |
| 6 | All SQLite references enumerated | ✅ 1 import, 10 handle consumers, § 1.6 |
| 7 | All legacy-write-control references enumerated | ✅ Domain I + § 1.7 |
| 8 | All legacy navigation entries enumerated | ✅ 4 arrays, 7 destinations, § 1.2 |
| 9 | Every artifact appears in census or matrix | ✅ cross-checked against `legacy-surface-inventory.json` |
| 10 | Every matrix row has a disposition | ✅ see `02_LEGACY_REPLACEMENT_MATRIX.md` § 4 |
| 11 | Every removal recommendation has a measurable gate | ✅ "Removal prerequisites" per domain; matrix column *Legacy removal condition* |
| 12 | Every monetary calculation documented with units and source fields | ✅ C-1…C-14, § 1.8 |
| 13 | Every inventory-mutating legacy route identified | ✅ 7 routes, § 1.3 |
| 14 | No proposed cutover creates two authoritative writers | ✅ charter § 6; matrix *Legacy read-only point* precedes every governed-authoritative row |
| 15 | JSON parses | ✅ verified, see the handoff |
