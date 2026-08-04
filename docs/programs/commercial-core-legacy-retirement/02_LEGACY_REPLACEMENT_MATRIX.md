# Legacy Replacement Matrix

Phase 0 deliverable 3 of 8. Audited at `885db791f98ef036ba5d6a028b5370802476c5d8`.

## How to read this

One matrix, 66 rows, 21 columns. Because 21 columns do not render legibly as a
single markdown table, the matrix is presented as **three joined views keyed by
the row `ID`**. Every row appears in all three; `ID` is the join key. The
machine-readable form is `legacy-surface-inventory.json` in this directory.

| View | Columns |
|---|---|
| **View 1 — Legacy side** | ID, Legacy domain, Legacy capability, User-facing surface, Client path, API route and method, Server implementation, SQLite source tables, Read or write |
| **View 2 — Authority and target** | ID, Existing governed overlap, Current authority, Target governed domain, Proposed target entities, Proposed governed operation or RPC, Target owner-facing surface |
| **View 3 — Disposition and gates** | ID, Data disposition, Candidate reconciliation key, Required owner decision, Cutover validation, Legacy read-only point, Legacy removal condition, Recommended implementation phase, Risk level, Notes |

**Allowed data-disposition values:** Replace · Import as current governed data ·
Import as historical evidence · Link to an existing governed record · Manual
reconciliation required · Archive only · Retain temporarily · Delete after
approved retention · Intentionally discontinue.

**Phase identifiers** refer to the slices defined in
`05_IMPLEMENTATION_SEQUENCE.md` (S0 … S12).

**Risk levels:** Low · Medium · High · Critical. Critical means an error is
financially consequential or irreversible.

---

## Row index

| ID | Domain | Capability | Disposition | Phase | Risk |
|---|---|---|---|---|---|
| A1 | Legacy Inventory | Browse / search / filter / sort lots | Replace | S3 | Low |
| A2 | Legacy Inventory | Facet counts | Replace | S3 | Low |
| A3 | Legacy Inventory | Lot detail with related links/listings/sales | Replace | S3 | Medium |
| A4 | Legacy Inventory | Create a lot | Intentionally discontinue | S3 | Medium |
| A5 | Legacy Inventory | Edit 28 lot fields | Intentionally discontinue | S3 | Medium |
| A6 | Legacy Inventory | `inventory_lots` table (1,487 rows) | Import as current governed data | S3 | High |
| A7 | Legacy Inventory | Serialized-vs-lot tracking mode | Manual reconciliation required | S3 | High |
| A8 | Legacy Inventory | Availability recompute (C-9) | Replace | S3 | Medium |
| B1 | Whatnot Purchases | Browse / filter purchase lines | Replace | S1 | Low |
| B2 | Whatnot Purchases | Spend by product type (C-12) | Replace | S2 | Medium |
| B3 | Whatnot Purchases | Facet counts | Replace | S1 | Low |
| B4 | Whatnot Purchases | Purchase detail with its allocations | Replace | S2 | Low |
| B5 | Whatnot Purchases | Owner override of `product_type` | Replace | S1 | Medium |
| B6 | Whatnot Purchases | `whatnot_purchases` table (2,149 seed rows) | Import as current governed data | S3 | Critical |
| B7 | Whatnot Purchases | `is_excluded` / `exclusion_reason` | Import as historical evidence | S3 | High |
| B8 | Whatnot Purchases | Boot classifier backfill | Intentionally discontinue | S0 | High |
| C1 | Cost Basis Links | List / filter allocations | Replace | S2 | Low |
| C2 | Cost Basis Links | Create an allocation | Replace | S2 | High |
| C3 | Cost Basis Links | Confirm / reject an allocation | Replace | S2 | Critical |
| C4 | Cost Basis Links | Individual bounds (C-3) | Replace | S2 | High |
| C5 | Cost Basis Links | Cumulative capacity (C-4) | Replace | S2 | Critical |
| C6 | Cost Basis Links | Inventory cost rollup (C-1) | Replace | S2 | Critical |
| C7 | Cost Basis Links | Purchase reconciliation rollup (C-2) | Replace | S2 | High |
| C8 | Cost Basis Links | `cost_links` table (287 seed rows) | Manual reconciliation required | S3 | Critical |
| D1 | eBay Listings | List / filter listings | Replace | S5 | Low |
| D2 | eBay Listings | Listing detail | Replace | S5 | Low |
| D3 | eBay Listings | Create a draft | Link to an existing governed record | S5 | Medium |
| D4 | eBay Listings | Edit 18 listing fields | Replace | S5 | Medium |
| D5 | eBay Listings | Manual status tracking | Replace | S5 | High |
| D6 | eBay Listings | Mirror status onto the lot | Intentionally discontinue | S5 | Medium |
| D7 | eBay Listings | `ebay_listings` table (20 seed rows) | Import as historical evidence | S5 | Medium |
| D8 | eBay Listings | `quantity_to_list` default (C-13) | Replace | S5 | High |
| E1 | Sales | List / filter sales | Replace | S6 | Low |
| E2 | Sales | Sale detail | Replace | S6 | Low |
| E3 | Sales | Record a sale | Replace | S6 | Critical |
| E4 | Sales | Net proceeds (C-5) | Replace | S8 | Critical |
| E5 | Sales | Known cost basis applied (C-6) | Replace | S8 | Critical |
| E6 | Sales | Profit after known costs (C-7) | Replace | S8 | Critical |
| E7 | Sales | Availability decrement (C-8) | Replace | S7 | Critical |
| E8 | Sales | Payment / fulfillment / tracking edit | Replace | S6 | Medium |
| E9 | Sales | Return status text | Replace | S7 | High |
| E10 | Sales | `sales` table (production-only) | Import as historical evidence | S6 | Critical |
| F1 | Health Checks | Live checks LIVE-001…006 | Replace | S10 | Medium |
| F2 | Health Checks | Stored baseline OP-001…007 | Import as historical evidence | S10 | Low |
| F3 | Health Checks | `checks` table | Archive only | S10 | Low |
| F4 | Health Checks | Health Checks page | Replace | S10 | Low |
| G1 | Legacy Dashboard | Legacy aggregate panel | Replace | S11 | Medium |
| G2 | Legacy Dashboard | Recorded value (C-10) | Intentionally discontinue | S11 | Medium |
| G3 | Legacy Dashboard | Mixed population rules (C-11) | Replace | S11 | High |
| G4 | Legacy Dashboard | Recent activity + top verticals | Replace | S11 | Low |
| H1 | Shared SQLite | `better-sqlite3` dependency | Delete after approved retention | S12 | Medium |
| H2 | Shared SQLite | `initSchema` DDL at boot | Intentionally discontinue | S12 | Medium |
| H3 | Shared SQLite | `seedIfEmpty` reseed-on-empty | Intentionally discontinue | S0 | Critical |
| H4 | Shared SQLite | `nextId` id minting | Intentionally discontinue | S12 | Low |
| H5 | Shared SQLite | `meta` dead table | Delete after approved retention | S12 | Low |
| H6 | Shared SQLite | `app_meta` classifier bookkeeping | Delete after approved retention | S12 | Low |
| H7 | Shared SQLite | `validation.ts` shared validators | Intentionally discontinue | S12 | Low |
| H8 | Shared SQLite | `lookups.json` reference lists | Link to an existing governed record | S3 | Low |
| I1 | Legacy auth / writes | `legacyWriteGuard` | Intentionally discontinue | S12 | Medium |
| I2 | Legacy auth / writes | `ALLOW_LEGACY_WRITES` | Intentionally discontinue | S12 | Medium |
| I3 | Legacy auth / writes | `ReadOnlyBanner` + `dataAdapter.ts` | Replace | S0 | Low |
| J1 | Seed / backup / deploy | `server/seed/*.json` | Archive only | S12 | Medium |
| J2 | Seed / backup / deploy | `verify-sqlite-backup.mjs` | Retain temporarily | S12 | Low |
| J3 | Seed / backup / deploy | `DATA_DIR` / `DATABASE_PATH` | Delete after approved retention | S12 | Medium |
| J4 | Seed / backup / deploy | Railway volume dependency | Delete after approved retention | S12 | High |
| J5 | Seed / backup / deploy | `/api/health` `readOnly` field | Replace | S12 | Low |

66 rows: A×8, B×8, C×8, D×8, E×10, F×4, G×4, H×8, I×3, J×5.

---

## View 1 — Legacy side

| ID | Legacy domain | Legacy capability | User-facing surface | Client path | API route and method | Server implementation | SQLite source tables | R/W |
|---|---|---|---|---|---|---|---|---|
| A1 | Legacy Inventory | Browse/search/filter/sort/page lots | Legacy Inventory table | `client/src/pages/Inventory.tsx` | `GET /api/inventory` | `routes/inventory.ts:14` | `inventory_lots` | R |
| A2 | Legacy Inventory | Facet counts for 6 dimensions | filter sidebar | `Inventory.tsx` | `GET /api/inventory/facets` | `routes/inventory.ts:51` | `inventory_lots` | R |
| A3 | Legacy Inventory | Lot detail + links/listings/sales | row drawer | `Inventory.tsx` | `GET /api/inventory/:id` | `routes/inventory.ts:64` | `inventory_lots`, `cost_links`, `ebay_listings`, `sales` | R |
| A4 | Legacy Inventory | Create a lot | "Add" form | `Inventory.tsx:328` | `POST /api/inventory` | `routes/inventory.ts:140` → `createInventoryLot:74` | `inventory_lots` | **W** |
| A5 | Legacy Inventory | Inline edit 28 fields | row editor | `Inventory.tsx:153` | `PATCH /api/inventory/:id` | `routes/inventory.ts:185` → `updateInventoryLot:159` | `inventory_lots` | **W** |
| A6 | Legacy Inventory | Persisted lot records | — | — | — | `seed.ts:32-48` | `inventory_lots` | data |
| A7 | Legacy Inventory | `tracking_mode` string | column | `Inventory.tsx` | included in A1/A5 | `db.ts:38` | `inventory_lots` | data |
| A8 | Legacy Inventory | Recompute availability on qty edit | implicit | — | part of `PATCH /api/inventory/:id` | `routes/inventory.ts:176-180` | `inventory_lots` | **W** |
| B1 | Whatnot Purchases | Browse/filter/page purchase lines | Purchases table | `client/src/pages/Purchases.tsx` | `GET /api/purchases` | `routes/purchases.ts:12` | `whatnot_purchases` | R |
| B2 | Whatnot Purchases | Spend rollup by product type | summary strip | `Purchases.tsx` | `GET /api/purchases/type-summary` | `routes/purchases.ts:56` | `whatnot_purchases` | R |
| B3 | Whatnot Purchases | Facets (seller, recon status, vertical) | filter sidebar | `Purchases.tsx` | `GET /api/purchases/facets` | `routes/purchases.ts:87` | `whatnot_purchases` | R |
| B4 | Whatnot Purchases | Purchase detail + its allocations | row drawer | `Purchases.tsx` | `GET /api/purchases/:id` | `routes/purchases.ts:97` | `whatnot_purchases`, `cost_links` | R |
| B5 | Whatnot Purchases | Owner sets `product_type` | type dropdown | `Purchases.tsx:157` | `PATCH /api/purchases/:id` | `routes/purchases.ts:76` | `whatnot_purchases` | **W** |
| B6 | Whatnot Purchases | Persisted acquisition lines | — | — | — | `seed.ts:49-60` | `whatnot_purchases` | data |
| B7 | Whatnot Purchases | Food/consumable exclusion flag | `includeExcluded` query param | `Purchases.tsx` | filter on `GET /api/purchases` | `db.ts:230` `flagFoodPurchases` | `whatnot_purchases` | **W (boot)** |
| B8 | Whatnot Purchases | Automatic product-type classification | invisible | — | none | `db.ts:266-291`, `classify.ts` | `whatnot_purchases`, `cost_links`, `app_meta` | **W (boot)** |
| C1 | Cost Basis Links | List/filter allocations | Cost Links table | `client/src/pages/CostLinks.tsx` | `GET /api/cost-links` | `routes/costLinks.ts:150` | `cost_links` | R |
| C2 | Cost Basis Links | Create an allocation | link form | `CostLinks.tsx:39` | `POST /api/cost-links` | `routes/costLinks.ts:246` → `createCostLink:172` | `cost_links`, `inventory_lots`, `whatnot_purchases` | **W** |
| C3 | Cost Basis Links | Confirm / reject | status buttons | `CostLinks.tsx:224` | `PATCH /api/cost-links/:id` | `routes/costLinks.ts:326` → `updateCostLink:258` | same | **W** |
| C4 | Cost Basis Links | Per-row bounds check | 409 error text | — | inside C2/C3 | `routes/costLinks.ts:52-81` | `cost_links`, `inventory_lots`, `whatnot_purchases` | R |
| C5 | Cost Basis Links | Cumulative confirmation capacity | 409 error text | — | inside C2/C3 | `routes/costLinks.ts:88-133` | same | R |
| C6 | Cost Basis Links | Inventory cost rollup | lot `cost_status` badge | — | side effect of C2/C3 | `routes/costLinks.ts:8-19` | `cost_links`, `inventory_lots` | **W** |
| C7 | Cost Basis Links | Purchase reconciliation rollup | `reconciliation_status` badge | — | side effect of C2/C3 | `routes/costLinks.ts:21-39` | `cost_links`, `whatnot_purchases` | **W** |
| C8 | Cost Basis Links | Persisted allocations | — | — | — | `seed.ts:61-72` | `cost_links` | data |
| D1 | eBay Listings | List/filter listings | Listings table | `client/src/pages/Listings.tsx` | `GET /api/listings` | `routes/listings.ts:14` | `ebay_listings` | R |
| D2 | eBay Listings | Listing detail | row drawer | `Listings.tsx` | `GET /api/listings/:id` | `routes/listings.ts:8` | `ebay_listings` | R |
| D3 | eBay Listings | Create a draft from a lot | "New listing" form | `Listings.tsx:45` | `POST /api/listings` | `routes/listings.ts:87` → `createListing:36` | `ebay_listings`, `inventory_lots` | **W** |
| D4 | eBay Listings | Edit 18 listing fields | row editor | `Listings.tsx:183` | `PATCH /api/listings/:id` | `routes/listings.ts:130` → `updateListing:105` | `ebay_listings`, `inventory_lots` | **W** |
| D5 | eBay Listings | Hand-typed `listing_status`, `ebay_item_id`, `listing_url` | text inputs | `Listings.tsx` | part of D4 | `routes/listings.ts:100-103` | `ebay_listings` | **W** |
| D6 | eBay Listings | Mirror listing status onto the lot | lot badge changes | — | side effect of D3/D4 | `routes/listings.ts:82`, `:125-127` | `inventory_lots` | **W** |
| D7 | eBay Listings | Persisted listing drafts | — | — | — | `seed.ts:73-85` | `ebay_listings` | data |
| D8 | eBay Listings | Default `quantity_to_list` | prefilled field | `Listings.tsx` | inside D3 | `routes/listings.ts:42-45` | `inventory_lots` | R |
| E1 | Sales | List/filter sales | Sales table | `client/src/pages/Sales.tsx` | `GET /api/sales` | `routes/sales.ts:14` | `sales` | R |
| E2 | Sales | Sale detail | row drawer | `Sales.tsx` | `GET /api/sales/:id` | `routes/sales.ts:8` | `sales` | R |
| E3 | Sales | Record a sale | sale form | `Sales.tsx:53` | `POST /api/sales` | `routes/sales.ts:132` → `createSale:35` | `sales`, `inventory_lots`, `ebay_listings` | **W** |
| E4 | Sales | Net proceeds | "Net" column | — | inside E3 | `routes/sales.ts:62` | `sales` | **W** |
| E5 | Sales | Known cost basis applied | "Cost applied" column | — | inside E3 | `routes/sales.ts:68` | `sales`, `inventory_lots` | **W** |
| E6 | Sales | Profit + `profit_status` | "Profit" column | — | inside E3 | `routes/sales.ts:69-70` | `sales` | **W** |
| E7 | Sales | Decrement lot availability | lot availability changes | — | inside E3 | `routes/sales.ts:117-126` | `inventory_lots`, `ebay_listings` | **W** |
| E8 | Sales | Edit payment/fulfillment/tracking/order id | status editor | `Sales.tsx:223` | `PATCH /api/sales/:id` | `routes/sales.ts:144` | `sales` | **W** |
| E9 | Sales | `return_status` free text | status editor | `Sales.tsx:223` | part of E8 | `routes/sales.ts:142` | `sales` | **W** |
| E10 | Sales | Persisted sales | — | — | — | **no seeder** (`seed.ts` has no `sales` block) | `sales` | data |
| F1 | Health Checks | Six computed live checks | "Live checks" list | `client/src/pages/Checks.tsx` | `GET /api/checks` | `routes/checks.ts:6-66` | `inventory_lots`, `cost_links`, `whatnot_purchases`, `sales` | R |
| F2 | Health Checks | Seven stored baseline checks | "Imported baseline checks" | `Checks.tsx` | `GET /api/checks` | `routes/checks.ts:70` | `checks` | R |
| F3 | Health Checks | Persisted baseline rows | — | — | — | `seed.ts:86-92` | `checks` | data |
| F4 | Health Checks | Health Checks page + summary pills | `/checks` | `Checks.tsx:20-22` | — | client-side | — | R |
| G1 | Legacy Dashboard | Legacy aggregate panel | "Legacy spreadsheet-imported inventory" | `client/src/pages/Dashboard.tsx:146` | `GET /api/dashboard` | `routes/dashboard.ts:83` → `getDashboard:8` | all six business tables | R |
| G2 | Legacy Dashboard | "Recorded value" tile | stat tile | `Dashboard.tsx` | part of G1 | `routes/dashboard.ts:14` | `inventory_lots` | R |
| G3 | Legacy Dashboard | Three different population rules in one panel | all tiles | `Dashboard.tsx` | part of G1 | `routes/dashboard.ts:11-77` | all six | R |
| G4 | Legacy Dashboard | Recent sales/purchases + top verticals | lists and bars | `Dashboard.tsx` | part of G1 | `routes/dashboard.ts:67-77` | `sales`, `whatnot_purchases`, `inventory_lots` | R |
| H1 | Shared SQLite | `better-sqlite3` driver | — | — | — | `server/src/db.ts:1,15`; `server/package.json` | all | R/W |
| H2 | Shared SQLite | Schema creation at boot | — | — | — | `db.ts:19-203` via `seed.ts:28` | all 6 business + `meta` | **W (boot)** |
| H3 | Shared SQLite | Reseed any empty table at boot | — | — | — | `seed.ts:27-93` via `index.ts:28` | 5 tables | **W (boot)** |
| H4 | Shared SQLite | Sequential public id minting | ids in every legacy row | — | — | `server/src/ids.ts:3-19` | `inventory_lots`, `cost_links`, `ebay_listings`, `sales` | R |
| H5 | Shared SQLite | `meta` table | — | — | — | `db.ts:185` | `meta` | none |
| H6 | Shared SQLite | `app_meta` classifier version | — | — | — | `db.ts:208-215,249` | `app_meta` | **W (boot)** |
| H7 | Shared SQLite | Shared request validators | 400/409 error text | — | used by A4/A5/C2/C3/D3/D4/E3 | `server/src/validation.ts` | — | — |
| H8 | Shared SQLite | Static reference lists | dropdown options | `Inventory.tsx` (`/lookups`) | `GET /api/lookups` | `routes/lookups.ts:11` | none — reads `server/seed/lookups.json` | R |
| I1 | Legacy auth / writes | Production write guard | 403 + read-only banner | `client/src/components/ReadOnlyBanner.tsx` | applies to `/api/*` non-safe methods | `server/src/legacyWriteGuard.ts:15-24`, mounted `index.ts:83` | all | — |
| I2 | Legacy auth / writes | Operator write re-enable switch | — | — | — | `legacyWriteGuard.ts:11` | all | — |
| I3 | Legacy auth / writes | Read-only state surfaced to client | banner | `ReadOnlyBanner.tsx`, `dataAdapter.ts` | `GET /api/health` | `index.ts:96` | — | R |
| J1 | Seed / backup / deploy | Repository seed corpus | — | — | — | `server/seed/{inventory,whatnot_purchases,cost_links,ebay_listings,checks,sales,lookups}.json` | 5 tables | data |
| J2 | Seed / backup / deploy | Offline backup verifier | CLI report | — | — | `scripts/verify-sqlite-backup.mjs` | reads a backup file only | R |
| J3 | Seed / backup / deploy | DB path configuration | — | — | — | `db.ts:10-11` | all | — |
| J4 | Seed / backup / deploy | Persistent-volume dependency | — | — | — | `README.md:253-261`; `railway.json` | all | — |
| J5 | Seed / backup / deploy | Healthcheck endpoint | Railway probe | — | `GET /api/health` | `index.ts:96`; `railway.json` `healthcheckPath` | — | R |

---

## View 2 — Authority and target

| ID | Existing governed overlap | Current authority | Target governed domain | Proposed target entities | Proposed governed operation or RPC | Target owner-facing surface |
|---|---|---|---|---|---|---|
| A1 | `inventory_record_overview`, `inventory_lot_overview`, `inventory_item_overview` | SQLite | Inventory | existing | existing paged reads | `/inventory/current` |
| A2 | filter facets on Current Inventory | SQLite | Inventory | existing | `inventory_record_overview` aggregates | `/inventory/current` |
| A3 | `get_listing_prep_for_subject`, `list_inventory_media`, `inventory_lot_lineage_view` | SQLite | Inventory | + `inventory_cost_basis`, `marketplace_listings`, `marketplace_order_lines` | `get_inventory_record_detail` (new, composing cost/listing/sale) | `/inventory/current/:itemId`, `/inventory/lots/:lotId` |
| A4 | governed intake: `create_intake_session` → `commit_intake_group` | SQLite | Intake | existing | existing | `/quick-add`, `/batch-intake` |
| A5 | `request_inventory_correction`, `review_inventory_correction`, `supersede_inventory_record`, `adjust_lot_quantity` | SQLite | Inventory | existing | existing | `/corrections`, item/lot detail |
| A6 | `product_catalog`, `sellable_skus`, `inventory_lots`, `inventory_items`, `tcg_*`/`footwear_*`/`other_*` attributes | SQLite | Inventory | + `legacy_inventory_import_decisions` (new) | `stage_inventory_lot`, `mint_sku`, `mint_serialized_item` + a new `import_legacy_inventory_lot` | `/import-review` extension |
| A7 | `inventory_tracking_mode` enum, `inventory_items` | SQLite | Inventory | existing | `mint_serialized_item` per unit | legacy-import triage surface |
| A8 | `inventory_lots.quantity` + `inventory_movements` + `inventory_quantity_adjustments` | SQLite | Inventory | + `inventory_reservations` (new) | `adjust_lot_quantity`, `recount_lot_quantity` | item/lot detail |
| B1 | `acquisition_orders`, `acquisition_line_items`, `acquisition_lots` | SQLite | Acquisition | + `acquisition_receipts` (new) | new `list_acquisition_lines` | `/acquisitions` (new) |
| B2 | none (no governed spend rollup exists) | SQLite | Acquisition | `acquisition_line_classifications` (new) | new `get_acquisition_spend_summary` | `/acquisitions` summary |
| B3 | none | SQLite | Acquisition | existing | new `get_acquisition_facets` | `/acquisitions` filters |
| B4 | `acquisition_cost_components`, `acquisition_cost_allocations` | SQLite | Acquisition | existing | new `get_acquisition_line_detail` | `/acquisitions/:publicId` |
| B5 | none | SQLite | Acquisition | `acquisition_line_classifications`, `classification_rules` (new) | new `classify_acquisition_line`, `override_acquisition_line_classification` | `/acquisitions` line editor |
| B6 | `acquisition_line_items` (preserves `WN-A-*` ids verbatim), upstream `source_records` | SQLite | Acquisition | existing + `acquisition_receipts` | `begin_acquisition_import_job` → `stage_acquisition_*` → `finalize_acquisition_import_job` | `/acquisition-review` |
| B7 | `data_quality_issues`; `acquisition_line_items` metadata | SQLite | Acquisition | `acquisition_line_exclusions` (new) | new `exclude_acquisition_line` (append-only, reason required) | `/acquisitions` exclusion filter |
| B8 | none | SQLite | Acquisition | `classification_rules`, `acquisition_line_classifications` | `classify_acquisition_line` with recorded rule version and provenance | `/acquisitions` |
| C1 | `acquisition_cost_allocations` | SQLite | Cost | existing | new `list_cost_allocations` | `/cost` (new) |
| C2 | `propose_cost_allocation` | SQLite | Cost | existing | `propose_cost_allocation` | `/cost` proposal queue |
| C3 | `confirm_cost_allocation`, `reverse_cost_allocation` | SQLite | Cost | existing | `confirm_cost_allocation`, `reverse_cost_allocation` | `/cost` |
| C4 | `app.enforce_cost_allocation_initial_state` | SQLite | Cost | existing | database constraint + trigger | error surfaced in `/cost` |
| C5 | `app.enforce_cost_allocation_transition`, `app.enforce_cost_component_reversal_coherence` | SQLite | Cost | existing | database-enforced conservation | `/cost` |
| C6 | none — **no governed inventory cost basis exists** | SQLite | Cost | `inventory_cost_basis`, `inventory_cost_basis_events` (new) | new `recompute_inventory_cost_basis` (deterministic, event-sourced) | item/lot detail, `/cost` |
| C7 | `acquisition_cost_components.attribution_state` incl. `unresolved` | SQLite | Cost | existing + `unresolved_cost_queue` view (new) | derived view, no denormalized column | `/cost` unresolved queue |
| C8 | `acquisition_cost_allocations` | SQLite | Cost | + `legacy_cost_link_reconciliation` (new) | new `import_legacy_cost_link` | `/cost` reconciliation review |
| D1 | `listing_prep`, `list_listing_prep_queue` | SQLite | Marketplace | `marketplace_listings` (new) | new `list_marketplace_listings` | `/listings` (governed, new) |
| D2 | `get_listing_prep` | SQLite | Marketplace | `marketplace_listings`, `marketplace_listing_revisions` | new `get_marketplace_listing` | `/listings/:publicId` |
| D3 | `start_listing_prep`, `update_listing_prep_content` | SQLite | Marketplace | `listing_prep` (upstream) → `marketplace_listing_drafts` | `start_listing_prep`, new `create_listing_draft` | `/listing-prep`, `/listings` |
| D4 | `update_listing_prep_content`, `apply_listing_package_preset` | SQLite | Marketplace | `marketplace_listing_revisions` | new `revise_marketplace_listing` (append-only revision) | `/listings/:publicId` |
| D5 | `mark_listing_prep_listed` (manual `external_listing_ref`) | SQLite | Marketplace | `marketplace_publish_requests`, `marketplace_sync_events`, `marketplace_api_calls` | new `request_listing_publish`, `record_listing_sync_event` | `/listings` publish flow |
| D6 | `inventory_record_overview` derives state; no mirrored column | SQLite | Marketplace | derived only | none — a view, not a column | item/lot detail |
| D7 | none for `ebay_listings` rows | SQLite | Marketplace | `legacy_listing_archive` (new) | new `import_legacy_listing` | `/listings` history filter |
| D8 | none — no reservation exists anywhere | SQLite | Inventory + Marketplace | `inventory_reservations` (new) | new `reserve_inventory_for_listing`, `release_inventory_reservation` | `/listings` create flow |
| E1 | none | SQLite | Orders | `marketplace_orders`, `marketplace_order_lines` (new) | new `list_marketplace_orders` | `/orders` (new) |
| E2 | none | SQLite | Orders | + `fulfillment_events`, `marketplace_fees` | new `get_marketplace_order` | `/orders/:publicId` |
| E3 | none | SQLite | Orders | `marketplace_orders`, `marketplace_order_lines`, `inventory_reservations` | new `ingest_marketplace_order` (idempotent on marketplace order id) | `/orders` |
| E4 | none | SQLite | Financial completion | `marketplace_fees`, `payouts`, `payout_lines` | new `compute_realized_revenue` (derived view) | `/orders/:publicId`, `/finance` |
| E5 | none | SQLite | Financial completion | `inventory_cost_basis`, `cogs_entries` (new) | new `record_cogs_for_order_line` | `/finance` |
| E6 | none | SQLite | Financial completion | `realized_profit` (view, not a table) | derived view over revenue − COGS − fees | `/finance` |
| E7 | `adjust_lot_quantity`, `record_inventory_item_loss` | SQLite | Inventory exit | `inventory_exit_events` (new) | new `exit_inventory_for_order_line`, `restore_inventory_for_return` | item/lot detail, `/orders` |
| E8 | none | SQLite | Fulfillment | `fulfillment_events`, `shipments`, `shipping_labels` (new) | new `record_fulfillment_event` (append-only) | `/orders/:publicId` |
| E9 | none | SQLite | Returns | `returns`, `return_lines`, `return_dispositions` (new) | new `open_return`, `disposition_return_line` | `/returns` (new) |
| E10 | none | SQLite (production only) | Orders | `legacy_sale_archive` (new) | new `import_legacy_sale` | `/orders` history filter |
| F1 | `data_quality_issues`, `inventory_media_issues`, `cycle_count_discrepancies` | derived | Data quality | `data_quality_controls`, `data_quality_evaluations` (new) | new `evaluate_data_quality_controls`, `resolve_data_quality_issue` (existing) | `/data-quality` (new) |
| F2 | `data_quality_issues` | SQLite | Data quality | `data_quality_evaluations` with a historical marker | `import_legacy_check_result` (new) | `/data-quality` history |
| F3 | none | SQLite | Data quality | archived JSON only | none | — |
| F4 | `inventory_work_queue`, `get_operations_inventory_health` | client | Data quality | existing + new controls | existing + new | `/data-quality` |
| G1 | `get_operations_inventory_health`, `get_operations_media_backlog`, `get_listing_prep_summary` | derived | Command center | + `get_commercial_performance`, `get_capital_tied_up` (new) | new composite dashboard RPCs | `/` |
| G2 | none | derived | Command center | `inventory_valuation_observations` (new) | new `get_inventory_valuation` (with an explicit basis) | `/` |
| G3 | governed panels each carry an explicit `asOf` and population rule | derived | Command center | existing pattern | every RPC returns `asOf` + a stated population rule | `/` |
| G4 | `/api/operations-dashboard/activity` | derived | Command center | `audit_events` | existing + new commercial activity feed | `/` |
| H1 | `supabase-js` (already a server dependency) | — | — | — | — | — |
| H2 | `supabase/migrations/` + `schema_migrations_log` | — | — | — | — | — |
| H3 | `scripts/db/reset.mjs` (CI only, never production) | — | — | — | — | — |
| H4 | `app.mint_governed_public_id` | — | — | — | — | — |
| H5 | none | — | — | — | — | — |
| H6 | `schema_migrations_log` | — | — | — | — | — |
| H7 | database `CHECK` constraints + `SECURITY DEFINER` argument validation | — | — | — | — | — |
| H8 | `reference_lists`, `reference_options`, `intake_reference_lists`, `intake_reference_options` | SQLite file | Reference data | existing | existing | intake dropdowns |
| I1 | route-level `requireMember`/`requireOperator`/`requireOwner` + RLS | — | — | — | — | — |
| I2 | none | — | — | — | — | — |
| I3 | `useWorkspace`, `AuthShell` | — | — | — | — | — |
| J1 | `source_records` hold the same rows as governed evidence | — | — | — | `stage_source_records` | `/import-review` |
| J2 | none (nothing else verifies a SQLite file) | — | — | — | — | CLI |
| J3 | Supabase connection configuration | — | — | — | — | — |
| J4 | Supabase is managed; no volume | — | — | — | — | — |
| J5 | `/api/health` remains, minus `readOnly` | — | — | — | — | Railway probe |

---

## View 3 — Disposition and gates

| ID | Data disposition | Candidate reconciliation key | Required owner decision | Cutover validation | Legacy read-only point | Legacy removal condition | Phase | Risk | Notes |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Replace | n/a (read surface) | none | governed list reproduces legacy list for imported rows | S3 | `/inventory` route deleted from `App.tsx` | S3 | Low | Current Inventory already exceeds it |
| A2 | Replace | n/a | none | facet counts match per dimension | S3 | with A1 | S3 | Low | |
| A3 | Replace | `inventory_lot_id` | none | detail shows the same related records | S3 | with A1 | S3 | Medium | Needs cost + listing + order joins that do not exist yet |
| A4 | Intentionally discontinue | n/a | **D-3** (see `06_OWNER_DECISIONS.md`) | governed intake is the only creation path | S3 | `POST /api/inventory` handler deleted | S3 | Medium | Governed intake is strictly better; no import needed |
| A5 | Intentionally discontinue | n/a | **D-3** | corrections workflow covers every edit the owner actually makes | S3 | `PATCH /api/inventory/:id` handler deleted | S3 | Medium | Free-field editing is replaced by governed correction, deliberately |
| A6 | Import as current governed data | `inventory_lot_id` → `external_identifiers` | **D-4** (which rows are still held) | 1:1 row count + per-row field comparison for still-held rows | after import verified | reconciliation ledger has no unadjudicated rows | S3 | High | 1,487 rows; all `Uncosted`, all `Imported Legacy` |
| A7 | Manual reconciliation required | `inventory_lot_id` + `tracking_mode` | **D-5** (serialize 279 lots or not) | each serialized legacy lot yields the right number of `inventory_items` | with A6 | every serialized legacy lot resolved | S3 | High | `reserved_child_id`/`active_child_id` are unpopulated placeholders |
| A8 | Replace | n/a | none | governed availability equals legacy availability for imported lots | S3 | with A5 | S3 | Medium | The `max(0,…)` clamp must **not** be reproduced |
| B1 | Replace | n/a | none | governed list reproduces legacy list row-for-row | S1 | `/purchases` route deleted | S1 | Low | |
| B2 | Replace | n/a | **D-6** (classification taxonomy) | spend by class matches C-12 within a stated tolerance in minor units | S2 | with B1 | S2 | Medium | Float→integer conversion changes totals; tolerance must be stated |
| B3 | Replace | n/a | none | facet counts match | S1 | with B1 | S1 | Low | |
| B4 | Replace | `acquisition_line_id` | none | detail shows the same allocations | S2 | with B1 | S2 | Low | |
| B5 | Replace | `acquisition_line_id` | **D-6** | every manual `product_type_source='manual'` override preserved with its provenance | S1 | `PATCH /api/purchases/:id` handler deleted | S1 | Medium | Manual overrides are owner ground truth and must not be lost |
| B6 | Import as current governed data | `acquisition_line_id` (`WN-A-*`, 2,149 distinct) | **D-1**, **D-2** | 2,149 governed lines; each field compared; sum of `total_paid` matches in minor units | after import + reconciliation verified | 30-row question adjudicated (F-6) and ledger clean | S3 | Critical | `order_id` is unique per line → 1:1 order:line |
| B7 | Import as historical evidence | `acquisition_line_id` | **D-1** | all 30 seed food rows present in governed data and flagged, not absent | S3 | with B6 | S3 | High | Exclusion must be a recorded decision, not a deletion |
| B8 | Intentionally discontinue | n/a | **D-6** | no boot process mutates data | **S0** | boot call removed from `index.ts` | S0 | High | Deploy-triggered data mutation must stop before anything else |
| C1 | Replace | n/a | none | governed list reproduces legacy list | S2 | `/cost-links` route deleted | S2 | Low | |
| C2 | Replace | `allocation_id` | none | proposal produces an equivalent governed candidate | S2 | `POST /api/cost-links` handler deleted | S2 | High | |
| C3 | Replace | `allocation_id` | **D-7** (treatment of legacy Confirmed rows) | every legacy Confirmed row has a governed `confirmed` counterpart | S2 | `PATCH /api/cost-links/:id` handler deleted | S2 | Critical | Legacy has no reversal; governed does |
| C4 | Replace | n/a | none | equivalent rejection for each legacy-rejected case, proven by test | S2 | with C2 | S2 | High | Move the invariant from TypeScript into the database |
| C5 | Replace | n/a | none | conservation enforced by constraint; a direct SQL violation fails | S2 | with C3 | S2 | Critical | The strongest single improvement in the cost domain |
| C6 | Replace | `inventory_lot_id` | **D-8** (cost basis method) | governed cost basis equals C-1 per lot within a stated minor-unit tolerance | S2 | with C3 | S2 | Critical | **No governed equivalent exists today** — this is net-new |
| C7 | Replace | `acquisition_line_id` | none | governed remaining equals C-2 per line; negatives remain visible | S2 | with C3 | S2 | High | Preserve the deliberate non-clamping |
| C8 | Manual reconciliation required | `allocation_id` + (`inventory_lot_id`, `acquisition_line_id`) | **D-7** | every production row classified: imported, re-proposed, abandoned, or evidence-only | after A6 and B6 | ledger clean | S3 | Critical | Seed is 287 all-Candidate; production state unknown |
| D1 | Replace | n/a | none | governed list reproduces legacy list | S5 | `/listings` route deleted | S5 | Low | |
| D2 | Replace | `listing_id` | none | detail parity | S5 | with D1 | S5 | Low | |
| D3 | Link to an existing governed record | `listing_id` → `listing_prep.public_id` | **D-9** (marketplace integration scope) | each active legacy draft linked to a `listing_prep` or a `marketplace_listing` | S5 | `POST /api/listings` handler deleted | S5 | Medium | Listing Prep already covers the draft content model, better |
| D4 | Replace | `listing_id` | none | revisions are append-only and reproduce the current legacy state | S5 | `PATCH /api/listings/:id` handler deleted | S5 | Medium | |
| D5 | Replace | `ebay_item_id` | **D-9**, **D-10** (publication approval) | a published listing has a durable request/response record and a reconciled remote status | S5 | with D4 | S5 | High | Legacy has no integration at all |
| D6 | Intentionally discontinue | n/a | none | no governed table stores a mirrored listing status | S5 | with D4 | S5 | Medium | Last-write-wins across listings is a defect, not a feature |
| D7 | Import as historical evidence | `listing_id` | **D-9** | 20+ rows archived with their final state | S5 | with D1 | S5 | Medium | |
| D8 | Replace | n/a | none | two listings cannot both claim the same units — proven by a concurrency test | S5 | with D3 | S5 | High | Requires `inventory_reservations`, which does not exist |
| E1 | Replace | n/a | none | governed list reproduces the legacy list | S6 | `/sales` route deleted | S6 | Low | |
| E2 | Replace | `sale_id` | none | detail parity | S6 | with E1 | S6 | Low | |
| E3 | Replace | `ebay_order_id` (where present), else `sale_id` | **D-11** (order ingestion source) | ingestion is idempotent on the marketplace order id | S6 | `POST /api/sales` handler deleted | S6 | Critical | |
| E4 | Replace | `sale_id` | **D-12** (sales-tax treatment) | governed revenue excludes marketplace-remitted tax; difference vs C-5 explained per sale | S8 | with E3 | S8 | Critical | C-5 is wrong; the replacement must not reproduce it |
| E5 | Replace | `sale_id` + `inventory_lot_id` | **D-8** | governed COGS derives from `inventory_cost_basis`, not a lot-average snapshot | S8 | with E3 | S8 | Critical | C-6 misallocates on partial costing |
| E6 | Replace | `sale_id` | **D-8**, **D-12** | realized profit recomputes when cost basis changes — proven by test | S8 | with E3 | S8 | Critical | C-7 is a permanent snapshot; the replacement is a derived view |
| E7 | Replace | `sale_id` | none | inventory exit is an append-only event and is reversible by a return | S7 | with E3 | S7 | Critical | `max(0,…)` must not be reproduced |
| E8 | Replace | `sale_id` | none | every status change is an append-only fulfillment event | S6 | `PATCH /api/sales/:id` handler deleted | S6 | Medium | |
| E9 | Replace | `sale_id` | **D-13** (return disposition policy) | a return restores or disposes inventory through a governed operation | S7 | with E8 | S7 | High | Legacy `return_status` triggers nothing |
| E10 | Import as historical evidence | `sale_id`; `ebay_order_id` as a secondary | **D-11** | every production row archived with its legacy-asserted profit preserved as an assertion | after export verified | export verified, archived, retention elapsed | S6 | Critical | **Production-only dataset — export before anything else** |
| F1 | Replace | `check_id` | none | each of LIVE-001…006 has a governed control that can actually fail | S10 | `/checks` route deleted | S10 | Medium | LIVE-001 and LIVE-002 are structurally dead as written |
| F2 | Import as historical evidence | `check_id` (`OP-001`…`OP-007`) | none | 7 rows archived with an explicit as-of date | S10 | with F1 | S10 | Low | |
| F3 | Archive only | `check_id` | none | JSON archived under this program directory | S10 | with F1 | S10 | Low | |
| F4 | Replace | n/a | **D-14** (alerting channel) | governed surface shows owner, priority, evidence, and resolution history | S10 | with F1 | S10 | Low | |
| G1 | Replace | n/a | **D-15** (which tiles matter) | every retained legacy tile has a governed equivalent with a stated population rule | S11 | `GET /api/dashboard` call removed from `Dashboard.tsx` | S11 | Medium | |
| G2 | Intentionally discontinue | n/a | **D-15** | replaced by an explicit valuation with a stated basis | S11 | with G1 | S11 | Medium | `recorded_unit_value × quantity` over all lots is not a meaningful figure |
| G3 | Replace | n/a | none | every panel states its population rule and `asOf` | S11 | with G1 | S11 | High | Three inconsistent rules in one panel today |
| G4 | Replace | n/a | none | activity feed covers acquisitions, listings, orders and corrections | S11 | with G1 | S11 | Low | |
| H1 | Delete after approved retention | n/a | **D-16** (retention period) | `server/package.json` has no `better-sqlite3`; CI green | after A–G removed | all of A–G at their removal condition | S12 | Medium | |
| H2 | Intentionally discontinue | n/a | none | no DDL runs at boot | S12 | with H1 | S12 | Medium | |
| H3 | Intentionally discontinue | n/a | **D-17** (immediate gating) | an empty database does not repopulate itself | **S0** | opt-in gate added in S0; call deleted in S12 | S0 | Critical | Live data-loss hazard for the whole program window |
| H4 | Intentionally discontinue | n/a | none | no new legacy ids are minted | S12 | with H1 | S12 | Low | |
| H5 | Delete after approved retention | n/a | none | table absent from the archived schema dump | S12 | with H1 | S12 | Low | Already dead |
| H6 | Delete after approved retention | n/a | none | with H5 | S12 | with H1 | S12 | Low | |
| H7 | Intentionally discontinue | n/a | none | no source file imports `validation.ts` | S12 | with H1 | S12 | Low | Used only by legacy routes |
| H8 | Link to an existing governed record | list name | **D-18** (list ownership) | every legacy dropdown option exists as a governed `reference_option` | S3 | `GET /api/lookups` handler deleted | S3 | Low | 13 lists in `lookups.json` |
| I1 | Intentionally discontinue | n/a | none | no `/api` route writes SQLite | S12 | with H1 | S12 | Medium | Insufficient as a cutover mechanism (F-1) |
| I2 | Intentionally discontinue | n/a | none | the variable is unread anywhere | S12 | with H1 | S12 | Medium | Owner must be told it stops working |
| I3 | Replace | n/a | none | `dataAdapter.ts` no longer asserts a false claim; the two tests updated | **S0** | banner removed with I1 | S0 | Low | F-3 — corrected first because it misleads the whole program |
| J1 | Archive only | file SHA-256 | **D-16** | files archived with recorded SHA-256 before removal from `server/seed/` | S12 | with H1 | S12 | Medium | Also the governed import fixture source — archive, do not delete, until import is complete |
| J2 | Retain temporarily | n/a | **D-16** | verifier still runs against the archived backup | never (offline tool) | retention elapsed | S12 | Low | Should outlive SQLite in the runtime |
| J3 | Delete after approved retention | n/a | none | variables unread; owner notified before removal from Railway | S12 | with H1 | S12 | Medium | |
| J4 | Delete after approved retention | n/a | **D-19** (volume decommission) | service runs with no volume attached | S12 | final backup verified and archived | S12 | High | Detaching the volume destroys the live SQLite data permanently |
| J5 | Replace | n/a | none | `/api/health` still returns `ok`; `readOnly` removed; Railway probe still green | S12 | with I1 | S12 | Low | Changing the healthcheck response shape is deployment-affecting |

---

## Coverage proof

Every legacy artifact enumerated in `01_LEGACY_SURFACE_CENSUS.md` maps to at
least one row above.

| Artifact class | Count | Matrix rows |
|---|---|---|
| Legacy client routes | 7 | `/` → G1; `/inventory` → A1–A3; `/purchases` → B1–B4; `/cost-links` → C1–C3; `/listings` → D1–D2; `/sales` → E1–E2; `/checks` → F1–F4 |
| Legacy API endpoints | 24 | A1,A2,A3,A4,A5 (5) · B1,B2,B3,B4,B5 (5) · C1,C2,C3 (3) · D1,D2,D3,D4 (4) · E1,E2,E3,E8 (4) · G1 (1) · F1/F2 (1, `GET /api/checks`) · H8 (1, `GET /api/lookups`) = **24** |
| SQLite tables | 8 | `inventory_lots`→A6 · `whatnot_purchases`→B6 · `cost_links`→C8 · `ebay_listings`→D7 · `sales`→E10 · `checks`→F3 · `meta`→H5 · `app_meta`→H6 |
| Indexes | 13 | covered with their tables (A6, B6, C8, D7, E10) |
| Material calculations | 14 | C-1→C6 · C-2→C7 · C-3→C4 · C-4→C5 · C-5→E4 · C-6→E5 · C-7→E6 · C-8→E7 · C-9→A8 · C-10→G2 · C-11→G3 · C-12→B2 · C-13→D8 · C-14→B6 |
| Seed files | 7 | J1 (all), plus A6/B6/C8/D7/F3 for the loaded five, E10 for the never-loaded `sales.json`, H8 for `lookups.json` |
| Boot-time writes | 3 | `initSchema`→H2 · `seedIfEmpty`→H3 · `migrateProductType`/`flagFoodPurchases`/classifier→B7,B8,H6 |
| Environment variables | 4 legacy | `DATA_DIR`,`DATABASE_PATH`→J3 · `NODE_ENV`,`ALLOW_LEGACY_WRITES`→I1,I2 |
| Navigation arrays | 4 | `PRIMARY_NAV` legacy entry→A1 · `LEGACY_NAV`→B1,C1,D1,E1 · `TOOLS_NAV` legacy entry→F4 · `LEGACY_ONLY_NAV`→G1 (removed with the last route) |
| Legacy tests | 11 server + 6 client | retired alongside their subject rows; `legacyWriteGuard.test.ts`→I1, `seed.test.ts`→H3/J1, `authShell.test.ts`+`provenanceConfig.test.ts`→I3 |
| Deployment assets | 4 | `railway.json` healthcheck→J5 · volume→J4 · backup verifier→J2 · runbooks→J2/J4 |

**Two-authoritative-writer check.** In View 3, every row whose disposition
creates a governed write path has a *Legacy read-only point* at or before the
phase in which that governed path becomes authoritative. No row schedules a
governed write before its legacy counterpart is revoked. Rows H3 and I3 are
scheduled at S0 precisely because leaving them until later would leave a second
writer (the boot sequence) active throughout the program.
