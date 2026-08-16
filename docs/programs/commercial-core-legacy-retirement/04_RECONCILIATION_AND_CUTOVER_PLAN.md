# Reconciliation and Cutover Plan

Phase 0 deliverable 5 of 8. Procedure design only; nothing here was executed.

---

## 1. The controlling rule

> **Matching totals are not reconciliation.**

Two systems reporting the same sum is consistent with any number of
compensating errors: a missing row and a duplicated row, a transposed pair, a
row present in both but with different contents. Every import in this program is
therefore proven on **two independent levels**, and passing only the first is a
failure.

| Level | Question | Passing evidence |
|---|---|---|
| **L1 — Aggregate** | do the totals agree? | row counts, sums of each numeric field, count of distinct keys, all recorded in a reconciliation run |
| **L2 — Record** | is every individual row accounted for? | a per-key verdict for **every** key in the union of both sides: `matched_identical`, `matched_with_differences`, `source_only`, `target_only` |

L2 must cover the **union** of keys, not the intersection. Comparing only rows
present in both is how a missing row hides.

---

## 2. The reconciliation ledger

All reconciliation output lands in an append-only governed structure. It is
evidence, not a scratch file, and it survives the import that produced it.

**`reconciliation_runs`** — one execution of one comparison.
Fields: `public_id` (`RV-RECON-*`), `domain`, `source_label`, `source_sha256`,
`target_scope`, `comparison_key`, `started_at`, `completed_at`, `state`
(`running`, `completed`, `failed`), `l1_result` (jsonb), `run_by`,
`tool_version`. Append-only.

**`reconciliation_findings`** — one immutable verdict per key in the union of
source and target keys. S3.1 implements this with a unique
`(reconciliation_run_id, comparison_key_value)` constraint and a JSON array of
field-difference objects (`field`, `source`, `target`).
Fields: `reconciliation_run_id`, `comparison_key_value`, `verdict`
(`matched_identical` | `matched_with_differences` | `source_only` |
`target_only`), `field_differences` (jsonb: field, source value, target value),
`materiality` (`none` | `cosmetic` | `material` | `financial`),
plus immutable actor, process, evidence, and timestamp provenance.

**`reconciliation_finding_adjudications`** — one append-only review event
referencing a finding. States are `open`, `accepted`, `corrected`, `rejected`,
and `deferred`; non-open events require a note. The current state is the latest
event by `(adjudicated_at, id)`, or implicit `open` when no event exists. A new
event supersedes earlier review evidence without updating either the finding or
the earlier event.

**Gate:** `reconciliation_cutover_eligibility` fails closed unless the selected
run is completed and has no current `material` or `financial` finding in
`open` or `deferred`. `none` and `cosmetic` findings do not block. Accepted,
corrected, or rejected findings do not block. Domain lookup deterministically
uses its latest run. This function reports eligibility only; it performs no
cutover.

---

## 3. The 2,149 / 2,119 question — the exact procedure

This is the highest-stakes reconciliation in the program and it is deliberately
sequenced first, because every downstream cost and profit figure depends on
which acquisition lines exist.

### 3.1 What is established, and what is not

**Established from the repository [FACT]:**
- `server/seed/whatnot_purchases.json` holds 2,149 rows.
- All 2,149 `acquisition_line_id` values are distinct.
- All 2,149 `order_id` values are distinct — so `order_id` is *not* an order
  grouping in this dataset.
- Exactly 30 rows carry `business_vertical = 'Food / consumables'`, which is the
  exact predicate `flagFoodPurchases` (`server/src/db.ts:232-236`) uses.

**Recorded as an owner attestation [DOC]:** the verified production Railway
backup holds 2,119 `whatnot_purchases` rows
(`docs/architecture.md:44-45`).

**Not established [OPEN]:** whether the 30 rows absent from the backup are the
same 30 food rows. **No step in this program may assume they are.** The
numbers agreeing is a coincidence until a key-level comparison says otherwise,
and there are ordinary ways for it to be a coincidence — for example 28 food
rows plus 2 unrelated rows deleted by the same historical `DELETE`, or 30
non-food rows lost for an unrelated reason while the food rows survive.

### 3.2 Procedure

**Step 1 — Establish the backup as a fixed artifact.**
The owner supplies the already-verified backup file. Run
`node scripts/verify-sqlite-backup.mjs <path> --json` and record `sha256`,
`size_bytes`, `integrity_check`, and the per-table row counts. Every subsequent
step cites that SHA-256. If the integrity check is not `ok`, the procedure stops.
*This uses the existing read-only verifier; it opens the file
`readonly` + `query_only` and cannot modify it.*

**Step 2 — Extract, do not connect.**
Export `whatnot_purchases` from the backup **file** to a comparison artifact.
Nothing in this procedure connects to the running production service or to a
live database.

**Step 3 — L1 aggregate comparison.**
Record on both sides: row count; distinct `acquisition_line_id` count;
`SUM(total_paid)` and `SUM(quantity_purchased)` to full precision;
count by `business_vertical`; count by `order_status`; min/max `processed_date`.
**A pass here proves nothing** and is recorded only as context for step 4.

**Step 4 — L2 record comparison, keyed on `acquisition_line_id`.**
Build the union of keys. For each key emit a verdict. For
`matched_with_differences`, compare every field and record each difference with
its materiality: `total_paid`, `quantity_purchased`, `unit_cost` are
**financial**; `product_name`, `seller`, `order_id`, `processed_date`,
`business_vertical`, `order_status` are **material**; `source_file`,
`reference_number` are **cosmetic**; the four denormalized rollup columns
(`confirmed_allocated_quantity`, `remaining_quantity`,
`confirmed_allocated_cost`, `remaining_cost`) and `reconciliation_status` are
**derived** — expected to differ, since the backup reflects allocation work the
seed does not, and they are recorded, not treated as defects.

**Step 5 — Answer the 30-row question explicitly.**
Produce the set `S = {keys present in the seed and absent from the backup}` and
report:
- `|S|` — expected to be 30 if no other divergence exists, but **not assumed**;
- `|S ∩ food|` — how many of the missing keys are food rows;
- `|S \ food|` — how many missing keys are **not** food, listing each in full;
- `|food \ S|` — food rows present in the backup, listing each in full;
- the set `{keys present in the backup and absent from the seed}` — which, if
  non-empty, means production has acquisitions that never came from the workbook
  and the seed is not a superset.

**Every one of these five figures is reported, whatever it is.** The procedure
does not stop early because the first one equals 30.

**Step 6 — Owner adjudication.**
Each key in `S` gets an owner decision: `restore_from_seed`,
`confirm_intentionally_absent`, or `investigate_further`. Each key in the
reverse set gets `import_as_additional_acquisition` or `investigate_further`.
Recorded as `reconciliation_findings` adjudications.

**Step 7 — Import from the adjudicated set only.**
Governed import imports what the owner adjudicated, not what the seed contains.
The seed is a *candidate* source, never an authority.

### 3.3 What this procedure explicitly refuses to do

- It does not restore rows to the SQLite database. **No restoration is performed
  against a live database at any point in this program.**
- It does not treat `|S| = 30` as proof of anything.
- It does not skip step 5 when step 3 looks reassuring.

---

## 4. Per-domain reconciliation

Each domain follows the same eight-stage lifecycle
(§ 6) with a domain-specific key and comparison.

### 4.1 Legacy inventory — 1,487 lots

- **Key:** `inventory_lot_id`, recorded as an `external_identifiers` row against
  the governed lot, so the mapping is queryable forever.
- **Pre-import owner triage (blocking):** every one of the 1,487 rows must be
  classified **still held** / **disposed before the Vault** / **unknown**. This
  is required because `record_origin` is `Imported Legacy` for all 1,487 and
  the spreadsheet was a point-in-time snapshot; importing all of them
  unconditionally would create governed inventory for stock that no longer
  exists. See decision **D-4**.
- **Serialized handling:** 279 seed rows carry `tracking_mode = 'Serialized'`
  but have **no per-unit rows** — `reserved_child_id`/`active_child_id` are
  unpopulated placeholders. Each such lot must resolve to either *n* governed
  `inventory_items` or a `lot_managed` lot. This is a judgment call per lot, not
  a mechanical transform. See decision **D-5**.
- **Already-entered inventory:** governed intake has been in use, so some
  physical stock exists **in both systems**. Before import, run a duplicate scan
  matching legacy rows against existing governed records on
  `app.compute_sku_fingerprint` identity plus `serial_number` /
  `certification_number` where present. A candidate match becomes a
  `reconciliation_findings` row with materiality `material`, adjudicated by the
  owner as `link_to_existing` or `import_as_new`. **Nothing imports over a
  suspected duplicate without adjudication.**
- **L1:** counts by `tracking_mode`, `business_vertical`, `category`; sum of
  `quantity`.
- **L2:** per-key field comparison across the identity-bearing columns.
- **Historical sold inventory:** rows with `sold_quantity > 0` import as
  historical evidence with **zero current quantity**, so they never appear in an
  operational queue. Their sales history attaches through Domain E's import.

### 4.2 Whatnot purchases — 2,149 / 2,119

Per § 3. Additionally:

- **Preserve `WN-A-*` ids verbatim.** The governed schema already does this
  deliberately (`20260720000100_acquisition_schema.sql` header: the line item's
  public id is the *only* governed identity intentionally not `RV-*`).
- **Duplicate-import prevention:** `acquisition_import_jobs` carries an
  idempotency key and expected counts; `finalize_acquisition_import_job` fails
  if the staged count does not match the declared count. Re-running the same job
  key returns the first result. The `unique` constraint on the line item's
  public id per workspace is the backstop.
- **Manual `product_type` overrides:** every row with
  `product_type_source = 'manual'` becomes an
  `acquisition_line_classifications` row with `method = 'owner_override'` and
  the original value. These are owner ground truth and losing them is a
  material defect.
- **Exclusions:** every `is_excluded = 1` row becomes an
  `acquisition_line_exclusions` row carrying the original
  `exclusion_reason` text. **The line item itself is imported regardless of
  exclusion** — exclusion is a decision recorded against a row that exists, not
  a reason to omit it.

### 4.3 Cost allocations

- **Key:** `allocation_id`, with `(inventory_lot_id, acquisition_line_id)` as
  the secondary comparison key.
- **Ordering constraint:** cost import **must** follow inventory import (4.1)
  and acquisition import (4.2), because an allocation references both ends. An
  allocation whose lot was adjudicated *not still held*, or whose acquisition
  line is in set `S` and was not restored, is a **dangling allocation** and gets
  an explicit finding rather than a silent drop.
- **By legacy status:**
  - `Confirmed` → import as `acquisition_cost_allocations` in `confirmed` state.
    **Conservation must hold on import**: if the sum of confirmed allocations
    for a source exceeds its component total, the import fails loudly for that
    source rather than importing an over-allocation. Legacy enforced this in
    TypeScript only, so a violation is possible in production data.
  - `Candidate` → import as `candidate`, or leave for re-proposal, per decision
    **D-7**. The 287 seed rows are all `Candidate`; production may differ.
  - `Rejected` → import as historical evidence only, never as an active
    allocation.
- **Float-to-integer conversion:** every `allocated_cost` REAL becomes
  `amount_minor` by `round(value * 100)` for a 2-decimal currency. **The
  rounding delta per row and in aggregate is recorded in the reconciliation
  run.** A non-zero aggregate delta is expected and must be explained, not
  hidden — it is the cost of leaving floats behind and is worth paying once,
  visibly.
- **L2 financial check:** for every lot, governed cost basis must equal legacy
  `confirmed_cost_basis` within the recorded rounding tolerance. A lot outside
  tolerance is a `financial` finding and blocks cutover.

### 4.4 eBay listings

- **Key:** `listing_id`; `ebay_item_id` where present.
- **Split by state:** a row with a real `ebay_item_id` is a *listing that
  existed on eBay* and imports as a `marketplace_listings` row in `ended` or
  `out_of_sync` state pending reconciliation against the eBay account. A row
  with no `ebay_item_id` is a *draft* and maps to `listing_prep` — or is
  abandoned if its lot is gone.
- **Do not import `inventory_lots.listing_status`.** It is a last-write-wins
  mirror (legacy defect D-6) and carries no reliable information.
- **`photos_complete`** is a self-attested string with no link to any image and
  is **not** imported. Governed photo readiness is computed from
  `inventory_media`.

### 4.5 Sales — the highest-risk import

- **Key:** `sale_id`; `ebay_order_id` where present.
- **Blocking prerequisite:** the production `sales` table has **no repository
  seed** (census F-4). A verified export must exist before any other retirement
  step in any domain. If the volume were lost today, this dataset would be gone
  with nothing to restore from.
- **Import as historical evidence, never as governed fact.** Each row becomes a
  `legacy_sale_archive` row preserving all 29 columns verbatim, including
  `net_proceeds`, `known_cost_basis_applied`, `profit_after_known_costs` and
  `profit_status` — recorded as **what the legacy system asserted**, explicitly
  labelled as such.
- **Governed reconstruction, computed independently:** where an
  `ebay_order_id` exists and the eBay account can still return the order,
  reconstruct a governed `marketplace_orders` / `marketplace_order_lines` /
  `marketplace_fees` set from the marketplace's own data. Where it cannot,
  the sale remains archive-only and is labelled *unreconstructed*.
- **The comparison is the point.** Legacy-asserted profit is compared against
  governed realized profit per sale, and **differences are expected** — the
  legacy figure treats marketplace-collected sales tax as income (C-5),
  misallocates cost on partially-costed lots (C-6), and is a snapshot that never
  refreshed (C-7). Each difference is categorised by which defect explains it. A
  difference that **no** known defect explains is a `financial` finding and
  blocks cutover.
- **Inventory exit:** each historical sale's `quantity_sold` becomes an
  `inventory_exit_events` row with `cause = 'sold'` against the corresponding
  governed inventory, so governed availability agrees with legacy availability
  for imported lots. Where the lot was adjudicated *not still held*, the exit is
  recorded without an availability effect and flagged.

### 4.6 Source documents

`source_file` on inventory and purchase rows names the original document
(e.g. `Copy of Whatnot order history 2_11_26.pdf`). These become
`source_systems` / `import_jobs` / `source_records` entries through the existing
Phase 3 machinery, which the repository seed files already feed via
`server/src/provenance/fixtures.ts`. No new import subsystem is created.

### 4.7 Exclusions

Handled in 4.2. The rule is absolute: **an excluded row is never omitted from
import.** Exclusion is a governed, reasoned, revocable decision recorded against
an imported row.

### 4.8 Duplicate and ambiguous rows

| Situation | Handling |
|---|---|
| Same key twice in one source | impossible in the seed (all keys verified distinct); if found in the backup, both rows are staged and a `duplicate_candidate` `data_quality_issues` row is raised |
| Two legacy rows describing the same physical item | staged separately; a `duplicate_candidate` finding is raised; the owner merges through the existing governed correction/duplicate-voiding workflow **after** import, never by silently skipping one |
| A legacy row matching an already-governed record | § 4.1 duplicate scan; adjudicated `link_to_existing` or `import_as_new` |
| A row with a missing required identifier | staged with a `missing_required` issue and `raw_payload_snapshot` preserved; never dropped |
| A row whose identifier is ambiguous (e.g. a `LIVE BID` product name with no reference number) | imported with `confidence = low` on its classification and routed to an owner queue |
| Legacy and governed facts conflict for the same subject | a `conflict` `data_quality_issues` row; **the governed record is not overwritten** and the legacy value is retained as evidence; the owner adjudicates |

---

## 5. Idempotency, duplicate prevention, and rollback

### 5.1 Repeatable and idempotent import

Every import operation is safe to re-run:

- `acquisition_import_jobs` / `import_jobs` carry a database-held idempotency
  key; re-running with the same key returns the first attempt's outcome.
- Every imported row carries an `external_identifiers` mapping keyed on
  `(source_system, source_key)` with a `unique` constraint, so a second import
  of the same source key is a conflict, not a duplicate.
- Import functions are `insert … on conflict do nothing` **plus a recorded
  skip** — a silent no-op and a genuine insert are distinguishable in the run
  ledger.
- Declared counts are checked at finalize; a mismatch fails the job rather than
  committing a partial import.

### 5.2 Rollback before cutover

Trivial, and this is deliberate. Before cutover the governed data is additive
and unread by any authoritative surface. Rolling back means marking the import
job abandoned (`fail_acquisition_import_job` / `fail_import_job`) and, if
required, superseding the staged rows. **The legacy system is untouched
throughout**, so there is nothing to restore.

### 5.3 Rollback after cutover

Harder, and therefore constrained by design:

- The legacy tables still exist and still hold every row they held at cutover —
  they were made read-only by **deleting handlers**, not by deleting data.
- Reverting the pull request that removed the legacy write handlers restores the
  legacy write path exactly.
- **Governed writes made after cutover would not be present in SQLite.** So a
  post-cutover rollback is a *forward* reconciliation: export the governed
  activity since cutover and adjudicate it into the legacy store, or accept the
  gap knowingly.
- Because of that asymmetry, the observation window before removing a legacy
  handler is not ceremony. It is the interval in which a rollback is still
  cheap.
- **Retention protects the option.** Legacy tables are not dropped until the
  owner-approved retention period elapses (decision **D-16**), so even a late
  rollback has data to reconcile against.

---

## 6. The per-domain lifecycle

Every domain traverses these eight stages in order. A stage may not be skipped,
and each has an exit condition that is checkable rather than judged.

```
1 Schema  →  2 Controlled import  →  3 Reconciliation  →  4 Owner review
     →  5 Shadow comparison  →  6 Governed cutover  →  7 Legacy read-only
         →  8 Retention  →  9 Removal
```

| Stage | Activity | Exit condition |
|---|---|---|
| **1 Schema** | forward migrations creating the target entities, RLS, functions; pgTAP contracts | migrations replay from empty on both CI database tiers; `supabase/tests/06_provenance_structure.sql` migration-count assertion updated; hosted parity verified by the owner |
| **2 Controlled import** | run the governed import from the adjudicated source into staging | job finalized with declared counts matching; every row carries provenance to a `source_records` row |
| **3 Reconciliation** | L1 then L2 per § 1; ledger written | a `reconciliation_runs` row in `completed` state with a finding for **every** key in the union |
| **4 Owner review** | owner adjudicates findings | zero findings of materiality `material` or `financial` remain `open` |
| **5 Shadow comparison** | governed reads run beside legacy reads for an agreed window; outputs diffed | differences on the agreed comparison set are either zero or individually explained in the ledger |
| **6 Governed cutover** | **one pull request** that enables the governed write path **and** deletes the legacy non-safe handlers for that domain | CI green; the governed surface is the only writer; owner acceptance recorded |
| **7 Legacy read-only** | legacy reads remain for comparison; no legacy write path exists | `grep` shows no `router.post`/`patch`/`delete` in that domain's legacy router |
| **8 Retention** | legacy tables retained, read-only, for the approved period | period elapsed; no rollback invoked; ledger still clean |
| **9 Removal** | delete the legacy router, page, route, nav entry, tests, and eventually the table | the removal condition in `02_LEGACY_REPLACEMENT_MATRIX.md` View 3 is met and recorded |

**Stage 6 is atomic and is the no-dual-write guarantee.** Enabling the governed
writer and revoking the legacy writer in one reviewable change means there is no
window — not even a deploy-length one — in which both can mutate the same fact.

---

## 7. Cutover validation per domain

What must be demonstrated at stage 5 before stage 6 is permitted.

| Domain | Shadow comparison | Passing criterion |
|---|---|---|
| Acquisition | governed acquisition list vs `GET /api/purchases` for the same filters | identical key sets; `total_paid` sums agree within the recorded rounding delta |
| Cost | governed cost basis per lot vs legacy `confirmed_cost_basis` | agreement within tolerance for every lot; zero unexplained differences |
| Inventory | governed Current Inventory vs `GET /api/inventory` for imported rows | identical key sets after excluding rows adjudicated *not still held* |
| Listings | governed listing list vs `GET /api/listings` | every legacy row linked or explicitly abandoned |
| Orders / Sales | governed realized profit vs legacy `profit_after_known_costs` | every difference attributed to C-5, C-6 or C-7; zero unattributed |
| Data quality | governed controls vs `GET /api/checks` live results | each of LIVE-001…006 has a governed control returning the same verdict on the same data — **and LIVE-002 restated so it can actually fail** |
| Dashboard | governed tiles vs `GET /api/dashboard` | each retained tile agrees, or its difference is explained by a stated population-rule change |

---

## 8. What this plan does not do

Stated explicitly so no later reader infers otherwise.

- It does not connect to a production database.
- It does not restore, delete, mutate, or migrate any business data.
- It does not apply, edit, or replay a hosted Supabase migration.
- It does not deploy or reconfigure Railway.
- It does not assume the 30-row difference and the 30 food rows are the same
  rows.
- It does not treat an aggregate match as reconciliation.
- It does not create any interval in which two systems can write the same fact.
