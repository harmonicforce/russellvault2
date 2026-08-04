# Implementation Sequence

Phase 0 deliverable 6 of 8. A recommended sequence of reviewable vertical
slices. Nothing here is implemented.

---

## 0. Where this departs from the suggested order, and why

The work order proposed: acquisition foundation → landed cost → historical
reconciliation → eBay account and policy integration → listing generation and
publishing → order and fulfillment ingestion → refunds/returns/exit → payout and
profit → pricing → AI Copilot → dashboard → SQLite removal.

Auditing the repository changed four things about that order. Each change is a
dependency correction, not a preference.

### Change 1 — A safety slice comes before everything (new **S0**)

Three facts make an immediate, feature-free slice mandatory:

- **The boot sequence writes to SQLite outside the write guard**
  (`server/src/index.ts:28-29` runs before `:83`). `ALLOW_LEGACY_WRITES` does
  not stop `seedIfEmpty`, `flagFoodPurchases`, or the classifier backfill.
- **`seedIfEmpty` repopulates any empty table from the repository JSON at every
  boot.** If the Railway volume is lost or remounted empty mid-program, the next
  boot silently writes 1,487 inventory rows, 2,149 purchase rows, 287 cost links
  and 20 listings over production — and reinstates the 30 food rows the
  production database may not have. That would destroy the very comparison
  § 3 of the reconciliation plan depends on.
- **The production `sales` table has no repository seed**
  (`server/src/seed.ts` has no `sales` block; `server/seed/sales.json` is `[]`).
  It is the one dataset that cannot be reconstructed from anything in this
  repository. It must be exported and verified before any other work begins.

Doing acquisition work first while these remain open risks losing the baseline
the whole program reconciles against.

### Change 2 — Historical inventory import moves ahead of cost import

The suggested order runs landed cost before historical reconciliation. But a
cost allocation references **both** an acquisition line and an inventory lot, so
importing legacy `cost_links` requires both endpoints to exist in governed form.
The build order for *code* is cost-before-import; the build order for *data* is
import-before-cost. Both are honoured by making **S2** the cost machinery
(schema, functions, owner surface, exercised on governed-native data) and **S3**
the historical import of all three datasets together in dependency order:
inventory → acquisitions → allocations.

### Change 3 — Marketplace **reads** ship before marketplace **writes**

The suggested order puts publishing before order ingestion. Reversing them is
strictly safer and delivers more value sooner:

- Order ingestion is **read-only** against eBay. Publishing **creates public
  commercial obligations**.
- Sales is the most defective legacy domain (three independent financial
  defects, no refund path, no reversal). Replacing it earlier retires more risk.
- Order ingestion proves the credential boundary, the idempotency design, the
  `marketplace_api_calls` evidence model, and the sync/conflict machinery
  against a read-only surface, so publishing inherits a *tested* integration
  rather than being where all of it is first exercised.
- Publishing depends on `inventory_reservations`, which does not exist anywhere
  today and which order ingestion also needs.

So: **S4** connection (read-only) → **S6** order ingestion → **S5** publishing.
The slice numbers stay aligned to the matrix; the *execution* order is
S4 → S6 → S7 → S8 → S5. This is stated explicitly in § 2.

### Change 4 — Listing publishing depends on payout reconciliation being at least designed

Not sequenced before it, but noted: a published listing generates fees the
owner will want reconciled. S5 must not ship without S8's fee model at least in
schema, or the first published sale creates a financial record the system cannot
complete.

---

## 1. Slice map

| Slice | Name | Build order | Execution order | Legacy replaced | Risk |
|---|---|---|---|---|---|
| **S0** | Safety prerequisites | 1 | 1 | none (protects everything) | Critical |
| **S1** | Acquisition foundation (owner-facing) | 2 | 2 | B1, B3, B5 | Medium |
| **S2** | Landed cost and inventory cost basis | 3 | 3 | B2, B4, C1–C7 | High |
| **S3** | Historical reconciliation and import | 4 | 4 | A1–A8, B6, B7, C8, H8 | Critical |
| **S4** | Marketplace connection (read-only) | 5 | 5 | none | High |
| **S6** | Order and fulfillment ingestion | 6 | 6 | E1, E2, E3, E8, E10 | Critical |
| **S7** | Refunds, returns, inventory exit | 7 | 7 | E7, E9 | Critical |
| **S8** | Payout and realized-profit reconciliation | 8 | 8 | E4, E5, E6 | Critical |
| **S5** | Reservations, drafts, and publishing | 9 | 9 | D1–D8 | Critical |
| **S9A** | Pricing and valuation | 10 | 10 | none | Medium |
| **S9B** | AI Copilot | 11 | 11 | none | High |
| **S10** | Governed data-quality controls | 12 | 12 | F1–F4 | Medium |
| **S11** | Command center dashboard | 13 | 13 | G1–G4 | Medium |
| **S12** | SQLite runtime removal | 14 | 14 | H, I, J | High |

Slice numbers match the *Recommended implementation phase* column of
`02_LEGACY_REPLACEMENT_MATRIX.md`. Where build order and execution order differ
(S5 vs S6/S7/S8), the execution order governs.

---

## 2. Dependency graph

```
S0 ─┬─> S1 ──> S2 ──> S3 ──────────────────────────┐
    │                  │                            │
    │                  └──> S4 ──> S6 ──> S7 ──> S8 ─┼──> S5
    │                                                │
    └────────────────────────────────────────────────┤
                                                     ├──> S9A ──> S9B
                                                     │
                                     S2, S3 ─────────┴──> S10 ──> S11 ──> S12
```

Hard edges:

- **S2 → S3** — the cost machinery must exist before legacy allocations import
  into it.
- **S3 → S6** — historical inventory must exist before a historical sale can
  exit it.
- **S4 → S6 → S7 → S8** — a strict chain: connection, then orders, then the
  return path that reverses them, then the payout that settles them.
- **S8 → S5** — publishing must not create fees the system cannot reconcile.
- **S6 → S5** — `inventory_reservations` is delivered in S6 and is a hard
  prerequisite for publishing (legacy defect D-8).
- **S2, S3 → S9A** — a valuation is meaningless without a cost basis.
- **S9A → S9B** — AI generation is evidence-bound; pricing evidence is part of
  its evidence set.
- **all → S12** — removal is last, always.

Soft edges: S10 can begin any time after S3 but is most useful after S8, when
there are financial invariants worth controlling. S11 is most useful last,
because it renders everything the earlier slices produce.

---

## 3. Slice detail

Each slice below carries the full sixteen-field record. Individual pull requests
within a slice are listed at the end of each entry; each is independently
reviewable and independently revertible.

---

### S0 — Safety prerequisites

| Field | Value |
|---|---|
| **Objective** | Stop every ungated write to SQLite, remove the reseed-on-empty data-loss hazard, secure an export of the one irreplaceable dataset, and correct the documentation that actively misleads the program. **No new product capability.** |
| **Dependencies** | none |
| **Schema changes** | none |
| **Server changes** | gate `seedIfEmpty()` behind an explicit `SEED_LEGACY_ON_EMPTY=true` opt-in that production does not set, so a lost volume yields an empty, visibly broken app instead of a silently reseeded one; move `flagFoodPurchases()` and the classifier backfill behind the same gate; make `/api/health` report `legacySeeded` so an empty database is detectable by the probe rather than passing green |
| **Client changes** | correct `client/src/lib/dataAdapter.ts` so it no longer asserts that legacy SQLite is the only business-data path (census F-3); keep the export surface stable for its two asserting tests |
| **Import / reconciliation** | owner captures a `.backup`-based SQLite export per `docs/runbooks/railway-backup-deploy-preflight.md`; run `node scripts/verify-sqlite-backup.mjs <path> --json`; archive the file and record its SHA-256, size, `integrity_check` and per-table row counts. **This is the baseline every later reconciliation cites.** |
| **Tests** | server test proving `seedIfEmpty` is a no-op without the opt-in; server test proving no SQLite write occurs during boot with the opt-in unset; update `server/src/seed.test.ts` to set the opt-in explicitly; update `client/src/lib/authShell.test.ts` and `client/src/lib/provenanceConfig.test.ts` for the corrected `dataAdapter` |
| **CI** | all four required jobs green |
| **Hosted acceptance** | owner confirms the deployed `/api/health` still returns `ok` and the Railway probe stays green; owner confirms the app still serves existing data (the gate must not empty anything) |
| **Owner acceptance** | backup captured, verified, archived, SHA-256 recorded; owner acknowledges that a lost volume will now produce an empty app rather than a reseeded one — **that is the intent** |
| **Rollout** | one deploy; behaviour change is confined to the boot path |
| **Rollback** | revert; the gate defaults can be flipped by an environment variable if the owner needs the old behaviour immediately |
| **Legacy capability replaced** | none — matrix rows B8, H3, I3 reach *legacy read-only* |
| **Removal unlocked** | none directly; unlocks safe execution of every later slice |
| **Risks** | changing boot behaviour on a live service. Mitigated by: the gate only *prevents* writes, never performs one; the app's read paths are untouched; if the volume is healthy nothing observable changes |
| **Scope** | small — roughly 5 files, no migration |

**PRs:** S0.1 boot-write gating + health signal · S0.2 `dataAdapter` correction
+ test updates · S0.3 (owner action, not a PR) backup capture, verification and
archival.

---

### S1 — Acquisition foundation (owner-facing)

| Field | Value |
|---|---|
| **Objective** | Give the owner a governed acquisition surface over the schema that already exists, and replace the code-constant classifier with governed, versioned, override-aware classification. |
| **Dependencies** | S0 |
| **Schema changes** | `acquisition_payments`, `acquisition_shipments`, `classification_rules`, `acquisition_line_classifications`, `acquisition_line_exclusions`; RLS and grants; `supplier_performance` view |
| **Server changes** | extend `server/src/routes/acquisition.ts` with `list_acquisition_lines`, `get_acquisition_facets`, `get_acquisition_line_detail`, `classify_acquisition_line`, `override_acquisition_line_classification`, `exclude_acquisition_line` |
| **Client changes** | new `/acquisitions` list with filters and facets; `/acquisitions/:publicId` detail; classification editor; exclusion action with a required reason |
| **Import / reconciliation** | none — this slice operates on governed-native data only |
| **Tests** | pgTAP: classification supersession never rewrites history; a rule-version bump inserts rather than updates; exclusion requires a reason and is owner-only; RLS isolation. Server route tests. Client tests for the classification editor |
| **CI** | four jobs green; migration-count assertion in `supabase/tests/06_provenance_structure.sql` updated |
| **Hosted acceptance** | owner applies migrations per `docs/runbooks/hosted-migration-parity.md`, confirms `/acquisitions` loads and a classification override persists |
| **Owner acceptance** | owner confirms the classification taxonomy (decision **D-6**) and that the three seller specializations from `classify.ts:48-52` are correctly expressed as rules |
| **Rollout** | flag-gated with the existing governed-surface flags |
| **Rollback** | revert the client route; the schema is additive and harmless if unused |
| **Legacy capability replaced** | B1 browse, B3 facets, B5 owner type override |
| **Removal unlocked** | `PATCH /api/purchases/:id` handler can be deleted; `/purchases` read remains for shadow comparison |
| **Risks** | taxonomy churn if D-6 is unsettled. Mitigated by making classifications append-only and superseded rather than edited |
| **Scope** | medium — ~4 migrations, ~6 endpoints, 2 pages |

**PRs:** S1.1 classification schema + rules · S1.2 classification functions +
pgTAP · S1.3 acquisition read endpoints + list page · S1.4 payments/shipments
schema + detail page · S1.5 exclusions.

---

### S2 — Landed cost and inventory cost basis

| Field | Value |
|---|---|
| **Objective** | Deliver the single largest missing capability in the governed model: an inventory-level cost basis derived from allocations, plus the owner surface for proposing, confirming and reversing them. |
| **Dependencies** | S1 |
| **Schema changes** | `acquisition_receipts`, `acquisition_receipt_lines`, `acquisition_discrepancies`, `inventory_cost_basis`, `inventory_cost_basis_events`, `unresolved_cost_queue` view; `recompute_inventory_cost_basis`; conservation triggers extended to the basis layer |
| **Server changes** | receiving endpoints; `list_cost_allocations`; wire the existing `propose_/confirm_/reverse_cost_allocation` into an owner surface; unresolved-cost queue endpoint |
| **Client changes** | `/receiving` (open a receipt, record received quantities, raise a discrepancy); `/cost` (proposal queue, confirmation, reversal, unresolved queue); cost basis shown on item and lot detail |
| **Import / reconciliation** | none yet — this slice builds the machinery S3 imports into |
| **Tests** | pgTAP: conservation cannot be violated **by direct SQL**, not merely by the API — this is the specific improvement over legacy C-4; reversal restores capacity exactly; recompute is idempotent and deterministic; a partially-costed lot yields correct per-layer cost, unlike legacy C-6; concurrency test for two simultaneous confirmations against one component |
| **CI** | four jobs green; both database tiers |
| **Hosted acceptance** | owner receives one real acquisition into inventory, allocates its cost, and confirms the cost basis appears on the resulting lot |
| **Owner acceptance** | decision **D-8** (cost basis method) settled and implemented as chosen |
| **Rollout** | flag-gated |
| **Rollback** | revert client + function grants; the basis table is derived and can be recomputed from scratch |
| **Legacy capability replaced** | B2 spend rollup, B4 purchase detail, C1–C7 (the entire cost-links domain, functionally) |
| **Removal unlocked** | `POST`/`PATCH /api/cost-links` handlers can be deleted after S3's import proves parity |
| **Risks** | **highest design risk in the program.** Cost basis method is irreversible in practice once historical data is imported under it. Mitigated by settling D-8 before this slice, and by making the basis derived-and-recomputable rather than hand-entered |
| **Scope** | large — ~6 migrations, ~10 endpoints, 3 pages |

**PRs:** S2.1 receiving schema · S2.2 receiving functions + pgTAP · S2.3
receiving UI · S2.4 cost basis schema + recompute function + pgTAP (**the
critical PR**) · S2.5 cost allocation owner surface · S2.6 unresolved cost queue.

---

### S3 — Historical reconciliation and import

| Field | Value |
|---|---|
| **Objective** | Import 1,487 inventory lots, 2,149 (or the adjudicated set of) acquisition lines, and the production cost allocations into the governed model, reconciled record-by-record, and answer the 30-row question. |
| **Dependencies** | S0 (verified backup), S1, S2 |
| **Schema changes** | `reconciliation_runs`, `reconciliation_findings`; `legacy_inventory_import_decisions`; import functions `import_legacy_inventory_lot`, `import_legacy_cost_link` |
| **Server changes** | reconciliation runner (read-only, offline, operating on the archived backup export and the repository seed — **never on a live database**); import orchestration reusing `begin_acquisition_import_job` → `stage_*` → `finalize_*` |
| **Client changes** | extend `/import-review` with a reconciliation view: per-key verdicts, field differences, materiality, adjudication actions |
| **Import / reconciliation** | the full procedure in `04_RECONCILIATION_AND_CUTOVER_PLAN.md` §§ 3–4, in order: inventory → acquisitions → allocations. Every key in the union of both sides gets a verdict |
| **Tests** | reconciliation runner unit tests over synthetic divergences (missing row, extra row, changed financial field, changed cosmetic field) proving each is detected and classified; pgTAP proving re-running an import is a no-op; a test proving an over-allocated legacy source **fails** import rather than importing |
| **CI** | four jobs green; the reconciliation runner has its own focused test suite |
| **Hosted acceptance** | owner reviews the reconciliation report and adjudicates every `material`/`financial` finding; owner confirms governed Current Inventory shows the expected imported stock |
| **Owner acceptance** | decisions **D-1** (30-row adjudication), **D-2** (restore or not), **D-4** (still-held triage), **D-5** (serialized handling), **D-7** (legacy allocation treatment) all resolved |
| **Rollout** | staged import behind a flag; governed cutover for inventory, acquisitions and cost happens at the **end** of this slice, atomically per domain |
| **Rollback** | before cutover: abandon the import job. After cutover: revert the handler-deletion PR; legacy data is untouched and retained |
| **Legacy capability replaced** | A1–A8, B6, B7, C8, H8 |
| **Removal unlocked** | `/inventory`, `/purchases`, `/cost-links` client routes and all their non-safe handlers |
| **Risks** | **highest data risk in the program.** A wrong import creates governed inventory that does not exist physically, or double-counts stock already entered through governed intake. Mitigated by: mandatory duplicate scanning against existing governed records; owner triage before import; every finding adjudicated; import idempotent and abandonable |
| **Scope** | very large — split across the most PRs of any slice |

**PRs:** S3.1 reconciliation ledger schema · S3.2 reconciliation runner + tests
· S3.3 reconciliation review UI · S3.4 inventory import functions + duplicate
scan · S3.5 inventory import execution + adjudication · S3.6 acquisition import
execution · S3.7 cost allocation import + conservation proof · S3.8 **cutover:
delete legacy inventory/purchases/cost-links write handlers** (one atomic PR).

---

### S4 — Marketplace connection (read-only)

| Field | Value |
|---|---|
| **Objective** | Establish the credential boundary, the durable API-evidence model, and the sync/conflict machinery — **without a single outbound write to eBay.** |
| **Dependencies** | S3 |
| **Schema changes** | `marketplace_accounts`, `marketplace_credentials`, `marketplace_categories`, `marketplace_item_specifics`, `marketplace_api_calls`, `marketplace_sync_events` |
| **Server changes** | OAuth authorization-code flow terminating server-side; token storage and rotation; a dispatcher that records a `marketplace_api_calls` row **before** treating any response as real; category and item-specifics sync; a read-only listing/order poller |
| **Client changes** | `/settings/marketplaces`: connect an account, see connection state and scopes, disconnect. **The browser never sees a token.** |
| **Import / reconciliation** | none |
| **Tests** | pgTAP asserting `marketplace_credentials` has **no** `SELECT` grant to `authenticated` or `anon` under any policy — the security contract of the whole marketplace domain; a test that a credential-shaped value cannot be returned by any function reachable from the client; dispatcher tests for timeout, 5xx, and malformed-response handling; sync idempotency tests |
| **CI** | four jobs green; a new secret-hygiene assertion extending `app.has_secret_like_key` |
| **Hosted acceptance** | owner connects the real eBay account; owner confirms categories sync; owner confirms **no** write reached eBay (verifiable from `marketplace_api_calls` — every call is a read operation) |
| **Owner acceptance** | decision **D-9** (integration scope and account) settled |
| **Rollout** | flag-gated; read-only by construction — no write operation exists in this slice's code |
| **Rollback** | revert; disconnect the account; no external state was changed |
| **Legacy capability replaced** | none |
| **Removal unlocked** | none directly; prerequisite for S6 and S5 |
| **Risks** | credential handling. Mitigated by making the no-client-grant assertion a CI-blocking pgTAP test rather than a code review convention |
| **Scope** | large |

**PRs:** S4.1 accounts + credentials schema + the security pgTAP · S4.2 OAuth
flow + rotation · S4.3 API-call evidence + dispatcher · S4.4 category and
specifics sync · S4.5 connection settings UI.

---

### S6 — Order and fulfillment ingestion *(executes before S5)*

| Field | Value |
|---|---|
| **Objective** | Replace the legacy Sales domain with governed marketplace orders, reservations, and append-only fulfillment — ingesting from eBay read-only. |
| **Dependencies** | S4 |
| **Schema changes** | `inventory_reservations`, `marketplace_orders`, `marketplace_order_lines`, `shipments`, `shipping_labels`, `fulfillment_events`, `marketplace_fees`, `legacy_sale_archive` |
| **Server changes** | `ingest_marketplace_order` (idempotent on `(account, external_order_id)`), `record_fulfillment_event`, `reserve_inventory_for_listing`, `release_inventory_reservation`; label purchase behind owner approval with its own API-call evidence |
| **Client changes** | `/orders` list and `/orders/:publicId` detail; pick/pack/ship workflow; reservation state on item and lot detail |
| **Import / reconciliation** | import the archived production `sales` rows into `legacy_sale_archive` verbatim, preserving the legacy-asserted profit figures **as assertions**; where `ebay_order_id` resolves, reconstruct a governed order from eBay's own data and record both |
| **Tests** | pgTAP: reservations sum ≤ availability **enforced in the database**, proven by a concurrency test with two simultaneous reservations; order ingestion is idempotent under replay; fulfillment history is append-only and no intermediate state is lost (the specific legacy defect); an order line cannot exit more inventory than is reserved |
| **CI** | four jobs green |
| **Hosted acceptance** | owner confirms a real eBay order ingests once and only once; owner ships one order end-to-end through the governed workflow |
| **Owner acceptance** | decisions **D-11** (ingestion source and backfill horizon), **D-13** (return policy, at least in outline) |
| **Rollout** | flag-gated; cutover atomically deletes `POST`/`PATCH /api/sales` |
| **Rollback** | revert the cutover PR; legacy `sales` data retained and untouched |
| **Legacy capability replaced** | E1, E2, E3, E8, E10 |
| **Removal unlocked** | `/sales` client route and its write handlers |
| **Risks** | double-ingesting an order, or reserving stock that is not there. Mitigated by natural-key idempotency and a database-enforced reservation invariant |
| **Scope** | very large |

**PRs:** S6.1 reservations schema + invariant + concurrency pgTAP (**the
critical PR**) · S6.2 orders schema · S6.3 ingestion function + idempotency
tests · S6.4 fulfillment events + pick/pack/ship UI · S6.5 shipping labels
(owner-approved, with API evidence) · S6.6 legacy sales archive import ·
S6.7 **cutover: delete legacy sales write handlers**.

---

### S7 — Refunds, returns, and inventory exit

| Field | Value |
|---|---|
| **Objective** | Make the commercial tail reversible: refunds, returns, dispositions, and an inventory exit model that can be undone. |
| **Dependencies** | S6 |
| **Schema changes** | `order_cancellations`, `refunds`, `returns`, `return_lines`, `return_dispositions`, `inventory_exit_events` |
| **Server changes** | `open_return`, `disposition_return_line`, `exit_inventory_for_order_line`, `restore_inventory_for_return`; refund issuance behind owner approval with API evidence |
| **Client changes** | `/returns` queue; disposition workflow; refund action on order detail |
| **Import / reconciliation** | historical sales with a non-null legacy `return_status` are surfaced as an owner queue for retrospective classification — the legacy text triggered nothing and its meaning must be recovered by hand |
| **Tests** | pgTAP: a restored return increases availability exactly once; a double-processed return is rejected; an exit event is never destructive — availability is the sum of events, never a stored counter (the structural fix for legacy C-8); refund issuance rejects a non-owner caller |
| **CI** | four jobs green |
| **Hosted acceptance** | owner processes one real return end-to-end, including disposition and inventory restoration |
| **Owner acceptance** | decision **D-13** (return disposition policy) fully settled |
| **Rollout** | flag-gated |
| **Rollback** | revert; exit events are append-only so no history is lost |
| **Legacy capability replaced** | E7 availability decrement, E9 return status |
| **Removal unlocked** | completes the Sales-domain replacement |
| **Risks** | inventory restored at the wrong cost basis. Mitigated by `return_dispositions` recording whether stock returns sellable or impaired, feeding `inventory_cost_basis_events` |
| **Scope** | large |

**PRs:** S7.1 exit-event schema + availability-as-sum migration · S7.2
cancellations and refunds · S7.3 returns and dispositions · S7.4 returns UI ·
S7.5 historical return-status triage queue.

---

### S8 — Payout and realized-profit reconciliation

| Field | Value |
|---|---|
| **Objective** | Close the financial loop: fees, payouts, payout reconciliation, COGS recognition, and a realized profit that **recomputes** instead of freezing. |
| **Dependencies** | S2 (cost basis), S6, S7 |
| **Schema changes** | `cogs_entries`, `payouts`, `payout_lines`, `payout_reconciliations`; views `realized_revenue`, `realized_cost`, `realized_profit` |
| **Server changes** | payout ingestion; `record_cogs_for_order_line`; variance adjudication |
| **Client changes** | `/finance`: payouts, variances, realized profit by order/SKU/period; profit shown on order detail |
| **Import / reconciliation** | for every archived legacy sale, compare legacy-asserted profit against governed realized profit and **attribute each difference to C-5 (tax as income), C-6 (cost misallocation) or C-7 (stale snapshot)**. An unattributed difference is a `financial` finding and blocks acceptance |
| **Tests** | pgTAP: confirming a cost allocation **after** a sale changes that sale's realized profit — the direct proof that legacy defect C-7 cannot recur; marketplace-collected tax is excluded from revenue; a payout variance opens a `data_quality_issues` row rather than being absorbed; COGS reversal on return is exact |
| **CI** | four jobs green |
| **Hosted acceptance** | owner reconciles one real eBay payout to zero unexplained variance |
| **Owner acceptance** | decision **D-12** (sales-tax treatment) settled and its effect on historical comparisons accepted |
| **Rollout** | flag-gated |
| **Rollback** | revert; all three profit surfaces are views, so nothing stored is lost |
| **Legacy capability replaced** | E4, E5, E6 |
| **Removal unlocked** | the legacy profit columns become archive-only |
| **Risks** | owner sees different profit numbers than legacy reported and cannot tell whether the new ones are right. Mitigated by requiring every difference to be *attributed to a named legacy defect* rather than merely reported |
| **Scope** | large |

**PRs:** S8.1 COGS schema + recognition · S8.2 fee attribution · S8.3 payouts
and reconciliation · S8.4 realized-profit views + the recompute proof · S8.5
finance UI · S8.6 historical profit comparison report.

---

### S5 — Reservations, drafts, and publishing *(executes last of the marketplace chain)*

| Field | Value |
|---|---|
| **Objective** | Publish to eBay under owner approval, with durable evidence, idempotent dispatch, and reconciled status. **The first slice that writes to an external commercial system.** |
| **Dependencies** | S4, S6 (reservations), S8 (fee model) |
| **Schema changes** | `marketplace_listing_drafts`, `marketplace_listings`, `marketplace_listing_revisions`, `marketplace_publish_requests`, `marketplace_offers`, `legacy_listing_archive` |
| **Server changes** | draft validation against cached categories and specifics; `request_listing_publish` (owner approval required before dispatch); `revise_marketplace_listing`; end and relist; status reconciliation from `marketplace_sync_events`; conflict raising |
| **Client changes** | `/listings` governed list and detail; publish flow with an explicit approval step; revision history; offers; conflict queue |
| **Import / reconciliation** | legacy `ebay_listings` split by `ebay_item_id` presence — real listings reconcile against the eBay account, drafts map to `listing_prep`, orphans are abandoned with a reason |
| **Tests** | pgTAP: a publish request with `approved_by is null` **cannot dispatch**; a replayed publish with the same idempotency key does not create a second listing; a timeout resolves by replay, never by re-issue; every dispatch has a `marketplace_api_calls` row; two listings cannot reserve the same units |
| **CI** | four jobs green |
| **Hosted acceptance** | owner publishes **one** low-value item end to end, verifies it on eBay, revises its price, ends it, and confirms every step has durable evidence and a reconciled status |
| **Owner acceptance** | decisions **D-9**, **D-10** (approval model) settled; owner explicitly authorizes the first live publish |
| **Rollout** | **staged, and the most cautious in the program.** Sandbox first if eBay offers one; then a single owner-selected item; then general availability. Each stage is a separate owner authorization |
| **Rollback** | end the published listing through the governed path; revert the client route. **Note: an eBay listing that existed cannot be un-created** — only ended. This is the one genuinely irreversible external effect in the program |
| **Legacy capability replaced** | D1–D8 |
| **Removal unlocked** | `/listings` client route and its write handlers |
| **Risks** | **Critical.** A publish bug creates real public commercial obligations. Mitigated by: mandatory owner approval per action; single-item staged rollout; the integration machinery already proven read-only in S4 and S6; idempotency proven by test before any live dispatch |
| **Scope** | very large |

**PRs:** S5.1 draft schema + validation against cached specifics · S5.2 listings
+ revisions schema · S5.3 publish-request approval gate + pgTAP (**must merge
and soak before S5.4**) · S5.4 dispatch + idempotency + evidence · S5.5 status
reconciliation and conflict queue · S5.6 offers · S5.7 publishing UI · S5.8
legacy listing archive + **cutover**.

---

### S9A — Pricing and valuation

| Field | Value |
|---|---|
| **Objective** | Turn observed market data into explainable recommendations, and give the owner unrealized margin, aging, sell-through and capital tied up. |
| **Dependencies** | S2, S3, S6 |
| **Schema changes** | `valuation_observations`, `comparable_evidence`, `price_recommendations`; views `unrealized_margin`, `inventory_aging`, `sell_through_and_velocity`, `capital_tied_up` |
| **Server changes** | observation collection from the marketplace (read-only); recommendation generation with explicit confidence |
| **Client changes** | pricing panel on item/lot detail with its comparables shown; a pricing-review queue |
| **Import / reconciliation** | legacy `recorded_unit_value` imports as a `valuation_observations` row with `source = 'owner_estimate'` — **not** as a cost or a market value |
| **Tests** | insufficient evidence yields `confidence = 'insufficient_evidence'` and **no price**; every recommendation cites at least one comparable; excluded comparables retain their exclusion reason |
| **CI** | four jobs green |
| **Hosted acceptance** | owner reviews recommendations for ten real items and judges them defensible |
| **Owner acceptance** | owner accepts that "insufficient evidence" is a valid, expected output |
| **Rollout** | flag-gated; advisory only |
| **Rollback** | revert; nothing authoritative depends on it |
| **Legacy capability replaced** | none (legacy has no pricing) |
| **Removal unlocked** | supports G2's discontinuation of the legacy "Recorded value" tile |
| **Risks** | a bad recommendation applied to a live listing. Mitigated by recommendations being advisory and application going through the owner-approved revision path |
| **Scope** | medium-large |

**PRs:** S9A.1 observations + collection · S9A.2 recommendations + evidence ·
S9A.3 valuation views · S9A.4 pricing UI.

---

### S9B — AI Copilot

| Field | Value |
|---|---|
| **Objective** | Evidence-bound generation of listing content and a daily brief, with mandatory human approval and enumerated prohibitions. |
| **Dependencies** | S9A, S5 (drafts), S2 (cost facts), media |
| **Schema changes** | `ai_generation_requests`, `ai_generation_evidence`, `ai_generations`, `ai_generation_reviews`, `ai_prohibited_actions` (migration-seeded) |
| **Server changes** | generation orchestration recording model, prompt template and version; evidence collection **before** generation; review workflow; enforcement that a draft may only cite an approved generation |
| **Client changes** | generation panel on `listing_prep` / draft detail showing the output, the evidence behind each claim, and what was missing; approve / edit-and-approve / reject; AI-authored content labelled everywhere before approval |
| **Import / reconciliation** | none |
| **Tests** | a factual claim with zero evidence rows is rejected at the function boundary; a rejected generation cannot be cited by a draft; **for every `ai_prohibited_actions` row, the named enforcing function rejects an AI actor** — the registry is only meaningful if checked; `missing_evidence` is populated and surfaced when a fact is absent |
| **CI** | four jobs green |
| **Hosted acceptance** | owner generates content for five real items, confirms every factual statement traces to a governed record, and confirms the model states what it could not establish rather than inventing it |
| **Owner acceptance** | owner accepts the approval model and the prohibition list |
| **Rollout** | flag-gated; approval is mandatory from day one, never added later |
| **Rollback** | revert; approved content already published is unaffected |
| **Legacy capability replaced** | none |
| **Removal unlocked** | supports S11's AI daily brief |
| **Risks** | a fabricated claim reaching a listing. Mitigated by: evidence binding enforced in the database, not the prompt; approval enforced by constraint; prohibitions enumerated and CI-tested |
| **Scope** | large |

**PRs:** S9B.1 request/evidence/generation schema + the evidence-binding
constraint · S9B.2 prohibited-actions registry + enforcement tests (**merge
before any generation reaches a draft**) · S9B.3 generation orchestration ·
S9B.4 review workflow + UI · S9B.5 daily brief.

---

### S10 — Governed data-quality controls

| Field | Value |
|---|---|
| **Objective** | Replace six checks — two of which cannot fail as written — with a control framework that detects, prioritizes, assigns, and records resolution. |
| **Dependencies** | S3 (minimum), S8 (for the controls worth having) |
| **Schema changes** | `data_quality_controls`, `data_quality_evaluations`; extend the existing `data_quality_issues` |
| **Server changes** | `evaluate_data_quality_controls` (scheduled and on demand); reuse the existing `resolve_data_quality_issue` |
| **Client changes** | `/data-quality`: prioritized queue, owner assignment, evidence per finding, resolution history |
| **Import / reconciliation** | the 7 stored `OP-*` rows import as dated historical evaluations |
| **Tests** | each of LIVE-001…006 has a governed control; **LIVE-002 is restated so oversale is detectable** — legacy clamps availability at zero so the check is structurally dead; a control that finds nothing records a passing evaluation with a timestamp, so a stale pass is distinguishable from a fresh one |
| **CI** | four jobs green |
| **Hosted acceptance** | owner sees a real finding, is assigned it, resolves it, and the resolution is recorded |
| **Owner acceptance** | decision **D-14** (alerting channel) |
| **Rollout** | flag-gated |
| **Rollback** | revert |
| **Legacy capability replaced** | F1–F4 |
| **Removal unlocked** | `/checks` client route |
| **Risks** | alert fatigue. Mitigated by prioritization and owner assignment rather than an undifferentiated list |
| **Scope** | medium |

**PRs:** S10.1 control schema + evaluation · S10.2 the six replacement controls
+ pgTAP · S10.3 data-quality UI · S10.4 historical baseline import + **cutover**.

---

### S11 — Command center dashboard

| Field | Value |
|---|---|
| **Objective** | One authoritative dashboard where every number opens the records it counted, every panel states its population rule and `asOf`, and a dependency failure is legible rather than a fabricated zero. |
| **Dependencies** | S8, S9A, S9B, S10 |
| **Schema changes** | none — composite read functions only |
| **Server changes** | `get_commercial_performance`, `get_capital_tied_up`, extended activity feed |
| **Client changes** | rebuild `Dashboard.tsx` as a single governed surface; **remove the `GET /api/dashboard` call** |
| **Import / reconciliation** | none |
| **Tests** | client tests asserting every tile links to a filtered queue returning the counted records; a dependency failure renders a named error, not `0`; every panel carries an `asOf` |
| **CI** | four jobs green |
| **Hosted acceptance** | owner confirms every tile they use is present, correct, and clickable |
| **Owner acceptance** | decision **D-15** (which legacy tiles matter) |
| **Rollout** | flag-gated |
| **Rollback** | revert |
| **Legacy capability replaced** | G1–G4 |
| **Removal unlocked** | `GET /api/dashboard`; and with it, the **last** legacy client route — `LEGACY_ONLY_NAV` can be deleted |
| **Risks** | losing a figure the owner relied on. Mitigated by D-15 being settled before build |
| **Scope** | medium |

**PRs:** S11.1 commercial performance + capital-tied-up functions · S11.2
dashboard rebuild · S11.3 activity feed · S11.4 **cutover: remove the legacy
dashboard call and the legacy nav arrays**.

---

### S12 — SQLite runtime removal

| Field | Value |
|---|---|
| **Objective** | Remove `better-sqlite3` from the production runtime and retire the legacy infrastructure. |
| **Dependencies** | S3, S5, S6, S7, S8, S10, S11 all complete; retention period elapsed |
| **Schema changes** | none |
| **Server changes** | delete `server/src/db.ts`, `seed.ts`, `ids.ts`, `validation.ts`, `classify.ts`, and the eight legacy routers; remove `seedIfEmpty()`/`migrateProductType()` from `index.ts`; delete `legacyWriteGuard.ts`; remove `readOnly` from `/api/health`; remove `better-sqlite3` and `@types/better-sqlite3` from `server/package.json` |
| **Client changes** | delete `lib/api.ts`, `ReadOnlyBanner`, `dataAdapter.ts`, and the seven legacy pages |
| **Import / reconciliation** | final backup captured, verified with `scripts/verify-sqlite-backup.mjs`, archived with a recorded SHA-256; `server/seed/*.json` archived under this program directory before deletion |
| **Tests** | delete the 11 legacy server test files and the affected client tests; add a guard test asserting no source file imports `better-sqlite3` |
| **CI** | four jobs green with the dependency removed |
| **Hosted acceptance** | owner confirms the app runs with **no volume attached**; `/api/health` green; `/api/version` reports the expected SHA |
| **Owner acceptance** | decisions **D-16** (retention), **D-19** (volume decommission); owner acknowledges detaching the volume destroys the live SQLite data permanently |
| **Rollout** | code removal first, in one deploy; **volume detachment is a separate, later owner action** so a rollback still has data |
| **Rollback** | revert the removal PR; the volume, if still attached, still holds the data. **After volume detachment there is no rollback** — only the archived backup |
| **Legacy capability replaced** | H, I, J |
| **Removal unlocked** | the program is complete |
| **Risks** | removing the volume too early. Mitigated by separating code removal from volume detachment by the full retention period |
| **Scope** | medium — mostly deletion, but touches deployment |

**PRs:** S12.1 delete legacy routers and pages · S12.2 delete legacy
infrastructure + dependency + guard test · S12.3 archive seeds and rewrite
`README.md` / `docs/architecture.md` / the runbooks · S12.4 (owner action)
volume decommission after retention.

---

## 4. Recommended first slice

**S0 — Safety prerequisites.**

It is the only slice that must be first. It ships no feature, and that is the
point: until the boot-time writes are gated and the `sales` export is secured,
every later reconciliation is being measured against a baseline that a single
volume event could silently rewrite. It is also small, low-risk, and touches no
migration.

**Owner decisions blocking S0:** only **D-17** (agreement to gate
reseed-on-empty, accepting that a lost volume will produce a visibly empty app
rather than a silently reseeded one). Everything else in S0 is an engineering
change plus one owner backup action.

---

## 5. Cross-cutting requirements

Applying to every slice.

- **Migration-count assertion.** `supabase/tests/06_provenance_structure.sql`
  asserts the repository migration count and names the migrations; every slice
  adding a migration updates it or CI fails.
- **Both database tiers.** Every pgTAP assertion must pass on both
  `shadow-db-postgres-shim` and `shadow-db-supabase-stack`. The two ship
  incompatible pgTAP overloads, so a single-tier assertion is a defect.
- **Forward-only migrations.** Existing migration files are never edited. A
  `create or replace view` may only append columns.
- **Hosted parity is separate from deployment.** A green Railway deploy says
  nothing about which migrations the hosted database has. Each migration-bearing
  slice verifies parity through `docs/runbooks/hosted-migration-parity.md`.
- **`docs/ai/CURRENT_STATE.md` is not edited by implementation agents.** Each
  slice proposes replacement text in
  `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md`.
- **Three dependency roots.** Install and audit root, `client/` and `server/`
  separately.
- **Cutover PRs are atomic and alone.** A PR that deletes a legacy write handler
  contains nothing else, so its revert is exact.
