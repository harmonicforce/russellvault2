# Target Commercial Architecture

Phase 0 deliverable 4 of 8. **Design only — this document contains no migration
and adds no schema.** Written against
`885db791f98ef036ba5d6a028b5370802476c5d8`.

---

## 0. Conventions that apply to every entity below

Stated once so each entity section records only what is *specific* to it. These
are the repository's existing conventions, read from
`supabase/migrations/20260719000100_workspace_foundation.sql`,
`20260720000100_acquisition_schema.sql`, and
`20260801000500_listing_prep_schema.sql`.

| Convention | Applies to |
|---|---|
| **Workspace scope.** `workspace_id uuid not null references public.workspaces (id) on delete restrict`, plus `unique (id, workspace_id)` so children can carry composite foreign keys and a cross-workspace reference is impossible at the constraint level. | every entity |
| **Internal vs public identity.** `id uuid primary key default gen_random_uuid()` for internal joins; a separate immutable `public_id text` with an `RV-*` pattern check, minted by `app.mint_governed_public_id`. Owner-facing UI addresses records only by `public_id`. | every entity that a person names |
| **RLS.** Enabled on every table; policies are workspace-membership based. | every entity |
| **Authorization.** Mutations go through `SECURITY DEFINER` functions with `set search_path = ''` that re-derive the caller from the JWT and call `app.member_role` / `app.assert_workspace_role`. A client-supplied `workspace_id` is checked, never trusted. `revoke all … from public, anon; grant execute … to authenticated`. | every operation |
| **Money.** `bigint` minor units (`*_minor`) plus an explicit `currency text check (currency ~ '^[A-Z]{3}$')` on the same row. Never a float, never an implied currency. A price without a currency is rejected by a `CHECK`. | every priced row |
| **Timestamps.** `created_at`/`updated_at timestamptz not null default now()`; `app.touch_updated_at` trigger where the row is mutable. | every entity |
| **Actor.** `created_by uuid not null references auth.users (id)` on anything a person causes. | every entity |
| **Audit.** `app.log_audit_event` writes to `audit_events` for every state transition. | every operation |
| **Evidence retention.** Evidence-bearing foreign keys are `on delete restrict`. | every entity |

**Mutability vocabulary used below:**

- *immutable* — insert-only; a correction is a new row plus a supersession link.
- *append-only* — insert-only; the table *is* the history.
- *state-machine* — a fixed set of columns changes only through named transition
  functions with an enforced transition graph (the existing pattern in
  `app.enforce_cost_allocation_transition`, `app.intake_assert_transition`).
- *owner-mutable* — free fields a person edits, with `updated_at` and an audit
  event.
- *derived* — a view or a function; no storage, therefore no authority of its
  own.

**Idempotency vocabulary:**

- *none* — the operation is naturally idempotent or is not retried.
- *database key* — a `unique` constraint on an idempotency key column, following
  `cycle_count_observation_idempotency`
  (`supabase/migrations/20260802000400_cycle_count_create_idempotency.sql`).
- *natural key* — a `unique` constraint on an external identifier that makes a
  replay a no-op (e.g. a marketplace order id).

---

## 1. Acquisition

### 1.1 What already exists

`supabase/migrations/20260720000100_acquisition_schema.sql` already defines
`channels`, `suppliers`, `supplier_aliases`, `acquisition_orders`,
`acquisition_lots`, `acquisition_lot_lines`, `acquisition_line_items`,
`acquisition_cost_components`, `acquisition_cost_allocations`, and
`acquisition_import_jobs`, with a full import workflow
(`begin_acquisition_import_job` → `stage_acquisition_*` →
`finalize_acquisition_import_job`), append-only enforcement, and RLS. That
schema is the foundation and is **not** redesigned here.

What it lacks, measured against the lifecycle in the charter: **payment,
shipping, receiving, discrepancy, and classification.** An acquisition order can
be recorded but cannot be *received*, so nothing connects a purchase to the
stock it produced. That single missing link is why legacy `cost_links` exists at
all — it is a hand-built substitute for receiving.

### 1.2 New entities

---

**`acquisition_payments`**

- **Purpose** — record what was actually paid for an acquisition order, when,
  by what instrument, so that "what we owe" and "what we paid" are separable
  from "what the line items cost".
- **Grain** — one payment event against one acquisition order.
- **Identity** — `RV-APAY-*`.
- **Important fields** — `acquisition_order_id`, `paid_at`,
  `amount_minor`, `currency`, `instrument` (enum: `card`, `bank`, `balance`,
  `credit`, `other`), `external_reference`, `source_record_id` (the Phase 3
  evidence this was read from, nullable for a hand-entered payment),
  `evidence_note`.
- **Relationships** — many-to-one to `acquisition_orders` by composite FK.
- **Mutability** — append-only. A corrected payment is a new row plus a
  `reversed_payment_id` self-reference.
- **Audit** — `audit_events` on insert and on reversal.
- **Idempotency** — natural key: `unique (workspace_id, external_reference)`
  where `external_reference is not null`.
- **Authorization** — operator to insert, owner to reverse.
- **Source of truth** — authoritative for cash paid against an order.

---

**`acquisition_shipments`**

- **Purpose** — the physical consignment an order arrives in. Distinguishes "the
  order" from "the box", which is what makes partial receipt expressible.
- **Grain** — one inbound shipment.
- **Identity** — `RV-ASHIP-*`.
- **Important fields** — `acquisition_order_id`, `carrier`, `tracking_number`,
  `shipped_at`, `expected_at`, `received_at`, `status` (enum: `expected`,
  `in_transit`, `delivered`, `lost`, `cancelled`), `shipping_cost_minor`,
  `currency`.
- **Relationships** — many-to-one to `acquisition_orders`; one-to-many to
  `acquisition_receipts`. `shipping_cost_minor` is *not* a cost component; it is
  a reference figure. The allocatable cost is an
  `acquisition_cost_components` row of type `shipping` scoped to the order or
  lot, which is the existing mechanism.
- **Mutability** — state-machine over `status`.
- **Idempotency** — natural key on `(workspace_id, carrier, tracking_number)`.
- **Authorization** — operator.
- **Source of truth** — authoritative for inbound logistics state.

---

**`acquisition_receipts`** — *the missing link*

- **Purpose** — the governed act of receiving goods against an acquisition. This
  is the entity that connects the Acquisition domain to the Inventory domain,
  and its absence is the root cause of the legacy `cost_links` design.
- **Grain** — one receiving session against one shipment (or, for an order with
  no shipment record, one order).
- **Identity** — `RV-ARCPT-*`.
- **Important fields** — `acquisition_order_id`, `acquisition_shipment_id`
  (nullable), `received_at`, `received_by`, `status` (enum: `open`,
  `submitted`, `reconciled`, `cancelled`), `note`.
- **Relationships** — one-to-many to `acquisition_receipt_lines`.
- **Mutability** — state-machine. Terminal states freeze the receipt and its
  lines, following `app.intake_freeze_terminal_group`.
- **Audit** — every transition.
- **Idempotency** — database key on the create operation, per
  `cycle_count_create_idempotency`.
- **Authorization** — operator to open and submit; owner to reconcile.
- **Source of truth** — authoritative for *what physically arrived*.

---

**`acquisition_receipt_lines`**

- **Purpose** — bind one acquisition line item to the governed inventory it
  produced, with the quantity actually received.
- **Grain** — one (receipt, acquisition line item, produced inventory subject)
  triple.
- **Identity** — `RV-ARL-*`.
- **Important fields** — `acquisition_receipt_id`, `acquisition_line_item_id`,
  `quantity_expected`, `quantity_received`, `inventory_lot_id` (nullable until
  the lot is created), `inventory_item_id` (nullable; set for serialized
  units), `condition_on_arrival`, `discrepancy_id` (nullable).
- **Relationships** — this is the join that lets cost flow from an acquisition
  line to an inventory lot **without** the legacy manual matching step. It is
  the structural replacement for `cost_links`.
- **Mutability** — immutable once its receipt is submitted; a correction
  supersedes.
- **Idempotency** — `unique (acquisition_receipt_id, acquisition_line_item_id)`.
- **Authorization** — operator.
- **Source of truth** — authoritative for the acquisition→inventory link.

---

**`acquisition_discrepancies`**

- **Purpose** — record, rather than silently absorb, a difference between what
  was ordered, paid for, shipped, and received.
- **Grain** — one discrepancy against one receipt line or one order.
- **Identity** — `RV-ADISC-*`.
- **Important fields** — `kind` (enum: `short_shipped`, `over_shipped`,
  `damaged`, `wrong_item`, `not_as_described`, `price_mismatch`,
  `never_arrived`), `severity`, `expected_value_minor`, `actual_value_minor`,
  `currency`, `status` (`open`, `claimed`, `resolved`, `written_off`),
  `resolution_note`, `resolved_by`, `resolved_at`.
- **Mutability** — state-machine.
- **Idempotency** — none (a person raises it).
- **Authorization** — operator to raise; owner to write off.
- **Source of truth** — authoritative for acquisition exceptions.

---

**`acquisition_line_classifications`** and **`classification_rules`**

- **Purpose** — replace `server/src/classify.ts` with a governed,
  version-recorded classification whose decisions are auditable and whose
  owner overrides are first-class rather than a `product_type_source='manual'`
  string.
- **Grain** — one classification decision per acquisition line item, per rule
  version.
- **Identity** — `RV-ACLS-*` / `RV-CRULE-*`.
- **Important fields** (classification) — `acquisition_line_item_id`,
  `classification` (a governed reference option, not a hardcoded enum),
  `method` (`rule`, `owner_override`, `seller_specialization`),
  `rule_id`, `rule_version`, `confidence`, `evidence` (jsonb naming the matched
  tokens), `superseded_by`.
- **Important fields** (rule) — `pattern`, `target_classification`,
  `precedence`, `version`, `active`, `authored_by`, `rationale`.
- **Relationships** — the three hardcoded seller specializations in
  `classify.ts:48-52` become `classification_rules` rows with
  `method = 'seller_specialization'` and a recorded `rationale`, so owner ground
  truth stops being a code constant.
- **Mutability** — append-only with supersession. **A rule version change never
  rewrites existing classification rows**; it inserts new ones that supersede.
  This directly fixes the legacy defect where bumping `CLASSIFIER_VERSION`
  mutated production data at boot.
- **Idempotency** — `unique (acquisition_line_item_id, rule_version)` for
  rule-derived rows.
- **Authorization** — operator to classify; owner to author rules and override.
- **Source of truth** — authoritative for what kind of thing was bought.

---

**`acquisition_line_exclusions`**

- **Purpose** — replace the boolean `is_excluded` flag with a recorded,
  reversible, reasoned decision.
- **Grain** — one exclusion decision per acquisition line item.
- **Identity** — `RV-AEXCL-*`.
- **Important fields** — `acquisition_line_item_id`, `reason` (required),
  `excluded_by`, `excluded_at`, `revoked_by`, `revoked_at`.
- **Mutability** — append-only. Un-excluding is a revocation row, never a
  deletion. **A row is never deleted, and exclusion never hides a row from a
  historical query** — only from business-view aggregates that say so.
- **Idempotency** — `unique (acquisition_line_item_id) where revoked_at is null`.
- **Authorization** — owner only. Exclusion is a financial decision.
- **Source of truth** — authoritative for which acquisitions count as business.

---

**`supplier_performance`** *(derived view)*

- **Purpose** — the capability legacy never had: what each supplier actually
  costs in discrepancies, delays and returns.
- **Grain** — one row per supplier per rolling window.
- **Fields** — `supplier_id`, `window`, `order_count`, `line_count`,
  `spend_minor`, `currency`, `discrepancy_rate`, `short_ship_rate`,
  `mean_days_to_receive`, `return_rate`, `realized_margin_minor`.
- **Mutability** — derived. No storage, no authority.

### 1.3 Source documents, import jobs, and source evidence

Unchanged and reused as-is: `source_systems`, `import_jobs`, `source_records`,
`external_identifiers`, `source_crosswalks`, `data_quality_issues`, and
`acquisition_import_jobs`. Every entity in § 1.2 that originates from an import
carries `source_record_id` back to the immutable Phase 3 evidence, per the
composite-FK convention already used by `acquisition_line_items`.

**No second raw-import subsystem is created.** That constraint is inherited from
the existing acquisition migration's header and is preserved.

---

## 2. Cost

### 2.1 What already exists

`acquisition_cost_components` (typed `item_price` | `shipping` | `tax` | `fee` |
`discount` | `other`; amount states `known` | `documented_free` | `unknown`;
attribution `direct` | `allocated` | `unresolved`) and
`acquisition_cost_allocations` (`candidate` | `confirmed` | `reversed`) with
`propose_cost_allocation`, `confirm_cost_allocation`, `reverse_cost_allocation`,
`reverse_cost_component`, and transition-enforcing triggers.

This is already **strictly better** than legacy `cost_links` in five ways: typed
components, an explicit `unresolved` state instead of a silent zero, a real
`reversed` state, integer minor units with a currency, and database-enforced
transitions.

What is missing is everything downstream of allocation: **there is no
inventory-level cost basis and no COGS anywhere in the governed model.**

### 2.2 New entities

---

**`inventory_cost_basis`**

- **Purpose** — the per-unit cost of governed inventory. This is the single
  most important missing entity in the whole system: without it there is no
  COGS, no realized profit, and no capital-tied-up figure.
- **Grain** — one row per inventory subject (item, or lot when lot-managed),
  per cost layer.
- **Identity** — `RV-ICB-*`.
- **Important fields** — `subject_kind` (`item` | `lot`), `item_id`, `lot_id`,
  `layer_seq` (integer, for FIFO layering), `quantity`, `unit_cost_minor`,
  `currency`, `basis_method` (see decision **D-8**), `attributed_quantity`
  (consumed by COGS so far), `state` (`open`, `depleted`, `superseded`),
  `derived_from_allocation_id`, `derived_from_receipt_line_id`.
- **Relationships** — traces back to `acquisition_cost_allocations` and
  `acquisition_receipt_lines`, so every cost figure has a provable origin.
  Mirrors the one-subject `CHECK` pattern used by `listing_prep`.
- **Mutability** — **derived-but-stored**, recomputed only by
  `recompute_inventory_cost_basis`; never edited by hand. Recomputation is
  deterministic: the same allocations produce the same layers.
- **Audit** — every recomputation writes an `inventory_cost_basis_events` row
  naming the trigger and the delta.
- **Idempotency** — recomputation is idempotent by construction; a
  `content_hash` over the input allocation set short-circuits a no-op run.
- **Authorization** — no direct write grant to any role. Only the recompute
  function writes it.
- **Source of truth** — authoritative for inventory cost, *derived* from
  allocations. **This is the entity that fixes legacy defect C-7**: because
  profit reads from here rather than from a snapshot, confirming a cost
  allocation later automatically corrects the profit of a sale recorded
  earlier.

---

**`inventory_cost_basis_events`**

- **Purpose** — the append-only history of why a cost basis changed.
- **Grain** — one recomputation effect on one basis row.
- **Fields** — `inventory_cost_basis_id`, `event_kind` (`created`,
  `revalued`, `consumed`, `restored`, `superseded`), `quantity_delta`,
  `unit_cost_minor_before`, `unit_cost_minor_after`, `currency`, `cause`
  (`allocation_confirmed`, `allocation_reversed`, `receipt_corrected`,
  `return_restored`), `caused_by_id`.
- **Mutability** — append-only.
- **Source of truth** — authoritative history of cost.

---

**`cogs_entries`**

- **Purpose** — the cost recognised when inventory leaves.
- **Grain** — one row per (order line, cost basis layer) consumption.
- **Identity** — `RV-COGS-*`.
- **Fields** — `marketplace_order_line_id`, `inventory_cost_basis_id`,
  `quantity`, `unit_cost_minor`, `extended_cost_minor`, `currency`,
  `recognised_at`, `reversal_of_id` (nullable).
- **Mutability** — append-only. A return inserts a reversing entry; it never
  deletes the original.
- **Idempotency** — `unique (marketplace_order_line_id, inventory_cost_basis_id)
  where reversal_of_id is null`.
- **Authorization** — no direct write; only `record_cogs_for_order_line`.
- **Source of truth** — authoritative for cost of goods sold.

---

**`unresolved_cost_queue`** *(derived view)*

- **Purpose** — make the existing `cost_attribution_state = 'unresolved'` an
  owner-facing work queue instead of an invisible database state.
- **Fields** — component, order, supplier, `amount_minor`, `currency`, age,
  candidate allocation targets, blocking reason.
- **Mutability** — derived.

### 2.3 Currency handling

One currency per priced row, stored beside the amount, never inferred. A
multi-currency acquisition records each component in its transacted currency.
Conversion, if ever required, is an explicit `fx_rates` entity with a recorded
rate, source and timestamp — **not** an implicit conversion at read time. Until
the owner confirms a second currency is in use (decision **D-20**), no
conversion machinery is built: a system with one currency should not carry the
complexity of many.

### 2.4 Provenance

Every cost figure resolves through a chain that is queryable end to end:

```
source_records            (immutable import evidence)
  → acquisition_line_items
      → acquisition_cost_components
          → acquisition_cost_allocations   (confirmed)
              → inventory_cost_basis        (recomputed, layered)
                  → cogs_entries            (recognised on sale)
                      → realized_profit     (derived view)
```

No link in that chain is a float, a snapshot, or an unrecorded assumption.

---

## 3. Marketplace

Every entity in this section is **owner-approval-gated and evidence-bound**, per
charter § 8.

---

**`marketplace_accounts`**

- **Purpose** — a connected selling account on a marketplace.
- **Grain** — one account per marketplace per workspace.
- **Identity** — `RV-MACC-*`.
- **Fields** — `marketplace` (`ebay`, …), `account_label`,
  `external_account_id`, `status` (`connected`, `expired`, `revoked`),
  `connected_at`, `scopes_granted`, `default_shipping_policy_ref`,
  `default_return_policy_ref`, `default_payment_policy_ref`.
- **Mutability** — state-machine.
- **Authorization** — owner only.
- **Source of truth** — authoritative for which accounts exist. **Holds no
  secret.**

---

**`marketplace_credentials`** — *the OAuth boundary*

- **Purpose** — hold OAuth material server-side, and nowhere else.
- **Grain** — one credential set per account.
- **Fields** — `marketplace_account_id`, `refresh_token_ref`,
  `access_token_expires_at`, `rotated_at`.
- **Critical constraints:**
  - **No column of this table is ever returned to any client.** The table has
    **no** `SELECT` grant to `authenticated`; only `SECURITY DEFINER` functions
    executing server-side may read it.
  - Token material is stored as a reference to a secret store, or encrypted at
    rest — never as plaintext in a readable column.
  - `app.has_secret_like_key`-style hygiene assertions extend to cover it, so a
    pgTAP test fails if a policy ever grants read access.
  - **No service-role key exists in the browser**, and no browser code path can
    reach this table under any RLS policy.
- **Mutability** — owner-mutable through rotation only.
- **Authorization** — server-side functions only.
- **Source of truth** — authoritative for marketplace authentication.

---

**`marketplace_categories`** and **`marketplace_item_specifics`**

- **Purpose** — cache the marketplace's own category tree and required/optional
  item specifics, so a draft can be validated *before* a publish attempt rather
  than by a rejected API call.
- **Grain** — one category node; one specific definition per category.
- **Fields** (category) — `marketplace`, `external_category_id`, `parent_id`,
  `name`, `leaf`, `fetched_at`.
- **Fields** (specific) — `marketplace_category_id`, `name`, `required`,
  `cardinality`, `allowed_values` (jsonb), `fetched_at`.
- **Mutability** — refreshed wholesale by a governed sync; rows carry
  `fetched_at` so staleness is visible.
- **Idempotency** — natural key `(marketplace, external_category_id)`.
- **Source of truth** — **the marketplace is**, not this system. These rows are
  a dated cache and are labelled as such wherever they are shown.

---

**`marketplace_listing_drafts`**

- **Purpose** — the marketplace-shaped rendering of a `listing_prep` record:
  title, category, specifics, price, policies, photos, in the exact shape the
  API expects.
- **Grain** — one draft per (listing prep, marketplace account).
- **Identity** — `RV-MLD-*`.
- **Fields** — `listing_prep_id`, `marketplace_account_id`,
  `marketplace_category_id`, `title`, `subtitle`, `description_html`,
  `item_specifics` (jsonb), `listing_format`, `price_minor`, `currency`,
  `quantity`, `photo_media_ids` (ordered), `policy_refs`,
  `validation_state` (`incomplete`, `valid`, `rejected`), `validation_errors`.
- **Relationships** — one-to-one upstream to the existing `listing_prep`, which
  is **not** replaced. `listing_prep` stays the owner's working surface; the
  draft is its marketplace projection.
- **Mutability** — owner-mutable while unpublished; frozen once a publish
  request references it.
- **Authorization** — operator to edit, owner to submit.
- **Source of truth** — authoritative for intended listing content.

---

**`marketplace_listings`**

- **Purpose** — a listing that exists on the marketplace.
- **Grain** — one live listing.
- **Identity** — `RV-MLST-*`; plus `external_listing_id` from the marketplace.
- **Fields** — `marketplace_account_id`, `marketplace_listing_draft_id`,
  `subject_kind`/`item_id`/`lot_id` (the same one-subject `CHECK` pattern as
  `listing_prep`), `external_listing_id`, `listing_url`,
  `status` (`publishing`, `active`, `ended`, `sold_out`, `error`,
  `out_of_sync`), `quantity_listed`, `quantity_available`, `price_minor`,
  `currency`, `published_at`, `ended_at`, `last_synced_at`,
  `remote_status_raw`.
- **Mutability** — state-machine, driven *only* by publish requests and sync
  events. **Never edited by hand**: a hand-edited listing status is exactly the
  legacy defect D-5.
- **Idempotency** — natural key
  `unique (marketplace_account_id, external_listing_id)`.
- **Authorization** — no direct write grant; only the publish and sync
  functions.
- **Source of truth** — **the marketplace is authoritative; this is a
  reconciled replica.** `status = 'out_of_sync'` is a first-class value, not an
  error, and it raises a `data_quality_issues` row for adjudication.

---

**`marketplace_listing_revisions`**

- **Purpose** — the append-only history of what was sent for each revision.
- **Grain** — one revision attempt.
- **Fields** — `marketplace_listing_id`, `revision_seq`, `change_kind`
  (`price`, `quantity`, `content`, `specifics`, `end`, `relist`),
  `payload_sent` (jsonb), `approved_by`, `approved_at`,
  `marketplace_api_call_id`.
- **Mutability** — append-only.
- **Source of truth** — authoritative for what this system asked for.

---

**`marketplace_publish_requests`**

- **Purpose** — the owner-approved intent to publish, revise, end, or relist.
  **This is the approval gate.**
- **Grain** — one requested action.
- **Identity** — `RV-MPUB-*`.
- **Fields** — `marketplace_listing_draft_id` or `marketplace_listing_id`,
  `action` (`publish`, `revise`, `end`, `relist`), `requested_by`,
  `approved_by` (**not null before execution**), `approved_at`,
  `idempotency_key uuid not null unique`, `state` (`approved`, `dispatched`,
  `succeeded`, `failed`, `timed_out`, `abandoned`), `attempt_count`,
  `last_error`.
- **Mutability** — state-machine.
- **Idempotency** — database key. A retry after a timeout **re-dispatches the
  same key** and the marketplace's own idempotency, or a follow-up read,
  resolves it. A fresh request is never issued for a timed-out one.
- **Authorization** — `approved_by` must hold the owner role; a function
  enforces `approved_by is not null` before dispatch. **No automated process
  can populate `approved_by`.**
- **Source of truth** — authoritative for intent and approval.

---

**`marketplace_api_calls`**

- **Purpose** — durable request/response evidence for every outbound call.
- **Grain** — one HTTP exchange.
- **Fields** — `marketplace_account_id`, `operation`, `request_url`,
  `request_headers_redacted` (jsonb, credentials stripped),
  `request_body` (jsonb), `response_status`, `response_body` (jsonb),
  `latency_ms`, `occurred_at`, `idempotency_key`, `correlation_id`.
- **Mutability** — append-only. **Written before the effect is treated as
  real** — the call record exists even when the response never arrives.
- **Retention** — permanent, subject to redaction of anything credential-like.
- **Authorization** — owner read; no write grant outside the dispatch function.
- **Source of truth** — authoritative for what was actually exchanged.

---

**`marketplace_sync_events`**

- **Purpose** — inbound marketplace truth: status changes, quantity changes,
  ends, and sales, whether polled or pushed.
- **Grain** — one observed remote state change.
- **Fields** — `marketplace_account_id`, `external_listing_id` or
  `external_order_id`, `event_kind`, `observed_at`, `payload` (jsonb),
  `applied_at`, `conflict_state` (`none`, `conflict_raised`, `resolved`).
- **Mutability** — append-only.
- **Idempotency** — natural key on the marketplace's own event id where one
  exists; otherwise a content hash over `(external id, event_kind, payload)`.
- **Source of truth** — authoritative record of what the marketplace said.

---

**`marketplace_offers`**

- **Purpose** — buyer offers and counter-offers, which legacy modelled as a
  `best_offer` text field that did nothing.
- **Grain** — one offer or counter.
- **Fields** — `marketplace_listing_id`, `direction` (`inbound`, `outbound`),
  `amount_minor`, `currency`, `quantity`, `expires_at`, `status` (`open`,
  `accepted`, `declined`, `countered`, `expired`), `decided_by`, `decided_at`.
- **Mutability** — state-machine.
- **Authorization** — **accepting an offer is financially consequential and
  requires the owner role**, and is on the prohibited-autonomous-action list.
- **Source of truth** — the marketplace; reconciled here.

---

**`inventory_reservations`**

- **Purpose** — stop two listings, or a listing and a sale, from claiming the
  same physical units. Legacy has no equivalent (defect D-8).
- **Grain** — one reservation of a quantity of one inventory subject for one
  purpose.
- **Identity** — `RV-RSV-*`.
- **Fields** — `subject_kind`/`item_id`/`lot_id`, `quantity`, `purpose`
  (`listing`, `order`, `hold`), `marketplace_listing_id` or
  `marketplace_order_line_id`, `state` (`held`, `consumed`, `released`,
  `expired`), `expires_at`.
- **Invariant** — **enforced in the database**: the sum of `held` reservations
  for a subject may never exceed its available quantity. This is a multi-row
  invariant and therefore belongs in PostgreSQL, following the pattern of the
  existing cost-conservation triggers, not in TypeScript.
- **Mutability** — state-machine.
- **Idempotency** — database key on the reserve operation.
- **Source of truth** — authoritative for committed-but-not-yet-shipped stock.

---

## 4. Orders and fulfillment

---

**`marketplace_orders`**

- **Purpose** — an order placed by a buyer on a marketplace.
- **Grain** — one marketplace order.
- **Identity** — `RV-MORD-*`; plus `external_order_id`.
- **Fields** — `marketplace_account_id`, `external_order_id`, `placed_at`,
  `buyer_reference` (pseudonymous; see the note on personal data below),
  `ship_to_region`, `currency`, `item_subtotal_minor`,
  `shipping_charged_minor`, `tax_collected_minor`, `order_total_minor`,
  `payment_state` (`pending`, `paid`, `partially_refunded`, `refunded`),
  `order_state` (`open`, `fulfilled`, `cancelled`, `closed`),
  `source_sync_event_id`.
- **Personal data** — buyer name and address are **not** stored in this system.
  Shipping is executed against the marketplace's own record. Only a
  pseudonymous buyer reference and a shipping region are retained, which is what
  analytics needs and is the minimum that fulfillment reconciliation requires.
- **Mutability** — state-machine, driven by sync events.
- **Idempotency** — natural key
  `unique (marketplace_account_id, external_order_id)`. **This makes order
  ingestion replay-safe by construction** — the defect that makes legacy
  `POST /api/sales` dangerous.
- **Authorization** — no direct write; only `ingest_marketplace_order`.
- **Source of truth** — the marketplace; reconciled here.

---

**`marketplace_order_lines`**

- **Grain** — one line of one order.
- **Identity** — `RV-MORDL-*`.
- **Fields** — `marketplace_order_id`, `marketplace_listing_id`,
  `subject_kind`/`item_id`/`lot_id`, `quantity`, `unit_price_minor`,
  `extended_price_minor`, `currency`, `line_state` (`open`, `fulfilled`,
  `cancelled`, `returned`, `partially_returned`).
- **Relationships** — the anchor for `cogs_entries`, `inventory_exit_events`,
  `marketplace_fees`, `return_lines`.
- **Mutability** — state-machine.
- **Source of truth** — the marketplace.

---

**`shipments`**, **`shipping_labels`**, **`fulfillment_events`**

- **`shipments`** — one outbound consignment for one or more order lines.
  Fields: `marketplace_order_id`, `carrier`, `service`, `tracking_number`,
  `shipped_at`, `delivered_at`, `state`. Idempotency: natural key on
  `(carrier, tracking_number)`.
- **`shipping_labels`** — one purchased label. Fields: `shipment_id`,
  `cost_minor`, `currency`, `purchased_at`, `voided_at`, `external_label_id`,
  `marketplace_api_call_id`. **Buying a label spends money**, so it carries an
  approval and a `marketplace_api_calls` evidence row exactly like a publish.
  Append-only; a void is a new row.
- **`fulfillment_events`** — the append-only operational history: `picked`,
  `packed`, `weighed`, `label_purchased`, `handed_off`, `in_transit`,
  `delivered`, `exception`. Fields: `marketplace_order_id`,
  `marketplace_order_line_id` (nullable), `event_kind`, `occurred_at`,
  `actor`, `detail` (jsonb). **This replaces the legacy single mutable
  `fulfillment_status` string**, which lost every intermediate state.

---

**`order_cancellations`**, **`refunds`**

- **`order_cancellations`** — `marketplace_order_id`, `scope` (`order` |
  `line`), `reason`, `requested_by` (`buyer` | `seller` | `marketplace`),
  `cancelled_at`, `restores_inventory` (boolean, decided by policy).
  Append-only.
- **`refunds`** — `marketplace_order_id`, `marketplace_order_line_id`
  (nullable), `kind` (`full`, `partial`, `shipping_only`, `goodwill`),
  `amount_minor`, `currency`, `reason`, `issued_at`, `external_refund_id`,
  `marketplace_api_call_id`. Append-only; idempotent on
  `external_refund_id`. **Issuing a refund is a prohibited autonomous action.**
  This entity fixes legacy defect (d): a refund arriving after the sale was
  recorded is simply not enterable today.

---

**`returns`**, **`return_lines`**, **`return_dispositions`**

- **`returns`** — `marketplace_order_id`, `external_return_id`, `opened_at`,
  `reason_category`, `state` (`requested`, `authorized`, `in_transit`,
  `received`, `closed`, `denied`), `closed_at`. State-machine; idempotent on
  `external_return_id`. **Authorizing a return is owner-gated.**
- **`return_lines`** — `return_id`, `marketplace_order_line_id`,
  `quantity_requested`, `quantity_received`, `condition_on_return`.
- **`return_dispositions`** — the decision about the physical item:
  `return_line_id`, `disposition` (`restock_sellable`, `restock_damaged`,
  `dispose`, `return_to_supplier`, `keep_for_parts`), `decided_by`,
  `decided_at`, `resulting_inventory_lot_id` / `resulting_inventory_item_id`,
  `revaluation_note`. Append-only. **A restocked item is not automatically
  restored at its original cost basis** — the disposition records whether it
  comes back sellable or impaired, which is what `inventory_cost_basis_events`
  then reflects.

---

**`inventory_exit_events`**

- **Purpose** — the governed, reversible act of inventory leaving.
- **Grain** — one exit (or restoration) of a quantity of one subject.
- **Fields** — `subject_kind`/`item_id`/`lot_id`, `quantity`, `direction`
  (`exit` | `restore`), `cause` (`sold`, `returned_to_stock`, `cancelled`,
  `lost`, `disposed`, `returned_to_supplier`), `marketplace_order_line_id`
  (nullable), `return_disposition_id` (nullable), `occurred_at`.
- **Mutability** — append-only. **Availability is the sum of movements and exit
  events, never a stored counter** — which structurally removes legacy defects
  C-8 (`max(0,…)` hiding oversale) and E7 (no reversal path).
- **Relationship to existing entities** — composes with the existing
  `inventory_movements`, `inventory_quantity_adjustments`, and
  `inventory_loss_events` rather than duplicating them; `record_inventory_item_loss`
  remains the path for non-commercial loss.
- **Source of truth** — authoritative for commercial inventory departure.

---

## 5. Financial completion

---

**`marketplace_fees`**

- **Grain** — one fee charged against one order or order line.
- **Fields** — `marketplace_order_id`, `marketplace_order_line_id` (nullable),
  `fee_kind` (`final_value`, `insertion`, `store_subscription`,
  `advertising`, `promoted_listing`, `international`, `payment_processing`,
  `other`), `amount_minor`, `currency`, `charged_at`, `source_sync_event_id`,
  `attribution_state` (`direct`, `allocated`, `unresolved`).
- **Mutability** — append-only.
- **Note** — `attribution_state` deliberately mirrors
  `cost_attribution_state`: an account-level fee (a store subscription) is
  `unresolved` until an owner-approved rule allocates it, and is **never
  silently spread or dropped**. This is the same discipline the acquisition
  schema already applies to shared costs.
- **Source of truth** — the marketplace's fee report.

---

**`payouts`**, **`payout_lines`**, **`payout_reconciliations`**

- **`payouts`** — `marketplace_account_id`, `external_payout_id`,
  `paid_at`, `gross_minor`, `fees_minor`, `refunds_minor`, `net_minor`,
  `currency`, `bank_reference`, `state` (`announced`, `paid`, `failed`).
  Idempotent on `external_payout_id`.
- **`payout_lines`** — `payout_id`, `marketplace_order_id` (nullable),
  `marketplace_order_line_id` (nullable), `line_kind` (`sale`, `fee`,
  `refund`, `adjustment`, `dispute`, `shipping_label`), `amount_minor`,
  `currency`, `external_reference`.
- **`payout_reconciliations`** — the append-only evidence that a payout was
  matched: `payout_id`, `expected_net_minor`, `reported_net_minor`,
  `variance_minor`, `state` (`matched`, `variance_open`, `variance_accepted`,
  `disputed`), `adjudicated_by`, `note`. **A variance is never absorbed
  silently**; it opens a `data_quality_issues` row.

This is the capability legacy has no trace of: money *actually received* is a
different fact from money *expected*, and the difference is where marketplace
accounting errors live.

---

**Derived financial views (no storage, no authority):**

- **`realized_revenue`** — per order line: `extended_price_minor` +
  `shipping_charged_minor` allocated to the line − refunds.
  **Marketplace-collected sales tax is excluded**, because the marketplace
  remits it. This is the deliberate, documented correction of legacy defect C-5.
- **`realized_cost`** — the sum of `cogs_entries` for the line, net of
  reversals.
- **`realized_profit`** — `realized_revenue` − `realized_cost` −
  attributed `marketplace_fees` − attributed `shipping_labels` −
  attributed packaging cost.
- **Packaging cost** is an `acquisition_cost_components` row of type `other`
  against a supplies acquisition, allocated per shipment by an owner-approved
  rule. It is not invented per order.

Because all three are views over append-only inputs, **profit recomputes
automatically** when a cost allocation is confirmed months after the sale.
Legacy defect C-7 cannot recur by construction.

---

## 6. Pricing and valuation

---

**`valuation_observations`**

- **Purpose** — an observed market data point for a SKU or item.
- **Grain** — one observation.
- **Fields** — `sku_id` or `item_id`, `observed_at`, `source`
  (`marketplace_sold`, `marketplace_active`, `price_guide`, `owner_estimate`),
  `condition_context`, `grade_context`, `amount_minor`, `currency`,
  `sample_size`, `observation_url`, `collected_by_process`.
- **Mutability** — append-only. Observations are never revised; a better
  observation is a new row.
- **Source of truth** — authoritative for *what was observed*, never for what
  something is worth.

---

**`comparable_evidence`**

- **Grain** — one comparable linked to one recommendation.
- **Fields** — `price_recommendation_id`, `valuation_observation_id`,
  `similarity_score`, `similarity_basis` (jsonb naming the matched attributes),
  `weight`, `included` (boolean), `exclusion_reason`.
- **Mutability** — append-only.
- **Purpose** — a recommendation must be able to answer "which comparables, and
  why those". An excluded comparable and its reason are retained.

---

**`price_recommendations`**

- **Grain** — one recommendation for one subject at one point in time.
- **Identity** — `RV-PREC-*`.
- **Fields** — `subject_kind`/`item_id`/`lot_id`, `generated_at`,
  `method_version`, `expected_sale_price_minor`,
  `liquidation_value_minor`, `recommended_list_price_minor`,
  `recommended_floor_minor`, `currency`, `confidence` (`high`, `medium`,
  `low`, `insufficient_evidence`), `evidence_count`,
  `missing_evidence` (jsonb), `superseded_by`, `owner_decision`
  (`accepted`, `overridden`, `ignored`), `owner_price_minor`.
- **Mutability** — append-only with supersession.
- **Critical rule** — `confidence = 'insufficient_evidence'` is a **valid and
  expected outcome**, and in that state no price is emitted. The system must be
  able to say "I don't know" rather than produce a number with no basis. This is
  the pricing-domain expression of the "visible dependency failure instead of
  fabricated zero" principle.
- **Authorization** — recommendations are advisory. **Applying one to a live
  listing is a `marketplace_publish_requests` revision and therefore
  owner-approved.**
- **Source of truth** — advisory only; never authoritative for a price.

---

**Derived valuation views:**

- **`unrealized_margin`** — `expected_sale_price_minor` −
  `inventory_cost_basis.unit_cost_minor` − expected fees, per unit of current
  stock. Rows with no cost basis or no recommendation are reported as
  **unknown**, not as zero.
- **`inventory_aging`** — days since receipt, bucketed, over current stock only
  (the `inventory_record_overview` population rule).
- **`sell_through_and_velocity`** — units sold ÷ units held, and mean days to
  sell, by SKU / category / supplier / acquisition channel over a rolling
  window.
- **`capital_tied_up`** — Σ `inventory_cost_basis` over current stock, split by
  aging bucket and by listing state. This is the figure legacy's "Recorded
  value" tile (C-10) gestured at and got wrong.

---

## 7. AI

The architecture's controlling requirement: **an AI-generated statement must be
traceable to the governed facts that support it, and must not reach a
marketplace without a human approval.**

---

**`ai_generation_requests`**

- **Grain** — one request for generated content.
- **Identity** — `RV-AIREQ-*`.
- **Fields** — `purpose` (`listing_title`, `listing_description`,
  `item_specifics`, `condition_summary`, `daily_brief`,
  `pricing_rationale`), `subject_kind`/`item_id`/`lot_id`/`listing_prep_id`,
  `model_identifier`, `model_version`, `prompt_template_id`,
  `prompt_template_version`, `parameters` (jsonb), `requested_by`,
  `requested_at`, `state` (`pending`, `succeeded`, `failed`, `rejected`),
  `idempotency_key uuid not null unique`.
- **Mutability** — state-machine.
- **Idempotency** — database key; a retry returns the first attempt's result.
- **Source of truth** — authoritative for what was asked and of which model.

---

**`ai_generation_evidence`** — *the binding*

- **Purpose** — record exactly which governed rows were read to produce the
  generation. **This table is what makes a generated claim checkable.**
- **Grain** — one governed fact used by one generation request.
- **Fields** — `ai_generation_request_id`, `fact_table`, `fact_id`,
  `fact_public_id`, `fact_snapshot` (jsonb — the values *as read*, so a later
  change to the source row does not silently rewrite history),
  `used_for` (which part of the output it supported).
- **Mutability** — append-only, immutable.
- **Rule** — a generation with **zero** evidence rows for a factual claim is
  rejected at the function boundary. Purely stylistic output (formatting,
  tone) is permitted with no evidence and is labelled as such.

---

**`ai_generations`**

- **Grain** — one produced output.
- **Fields** — `ai_generation_request_id`, `output` (jsonb, structured per
  purpose), `claims` (jsonb: each factual assertion paired with the
  `ai_generation_evidence` ids that support it), `confidence`,
  `missing_evidence` (jsonb: the facts the model needed and did not have),
  `token_usage`, `produced_at`.
- **Mutability** — immutable.
- **Rule** — `missing_evidence` is surfaced in the UI beside the output. The
  model states what it could not establish rather than filling the gap. It never
  asserts condition, grade, authenticity, completeness, provenance, or a
  measurement that no governed fact supports.

---

**`ai_generation_reviews`**

- **Grain** — one human decision on one generation.
- **Fields** — `ai_generation_id`, `decision` (`approved`, `edited_approved`,
  `rejected`), `edited_output` (jsonb, when the owner changed it),
  `rejection_reason`, `reviewed_by`, `reviewed_at`.
- **Mutability** — append-only.
- **Rule** — **only an `approved` or `edited_approved` review may be referenced
  by a `marketplace_listing_drafts` row.** A database `CHECK` (or a trigger)
  enforces that a draft's AI-sourced content column can only cite an approved
  generation. Rejected generations are retained, with their reason, as evidence
  of what the system got wrong.

---

**`ai_prohibited_actions`** *(registry, seeded by migration)*

- **Purpose** — make the prohibition enumerable and testable rather than a
  paragraph in a document.
- **Fields** — `action_key`, `description`, `enforced_by` (the function or
  constraint that blocks it).
- **Seeded rows** — `publish_listing`, `revise_listing_price`, `end_listing`,
  `relist_item`, `accept_offer`, `issue_refund`, `authorize_return`,
  `purchase_shipping_label`, `adjust_inventory_quantity`,
  `confirm_cost_allocation`, `exclude_acquisition_line`.
- **Test requirement** — a pgTAP test asserts that for every row, the named
  enforcing function rejects a caller whose actor is an AI process. The registry
  is only meaningful if it is checked.

---

**Audit history.** Every AI request, evidence set, generation and review writes
`audit_events`, so "why does this listing say that" is answerable months later
from the database alone.

---

## 8. Entity summary

| # | Entity | Domain | New or existing | Mutability | Source of truth |
|---|---|---|---|---|---|
| 1 | `channels` | Acquisition | existing | registry | this system |
| 2 | `suppliers` | Acquisition | existing | registry | this system |
| 3 | `supplier_aliases` | Acquisition | existing | append-only | observed source |
| 4 | `acquisition_orders` | Acquisition | existing | immutable | source evidence |
| 5 | `acquisition_lots` | Acquisition | existing | immutable | source evidence |
| 6 | `acquisition_lot_lines` | Acquisition | existing | supersession | this system |
| 7 | `acquisition_line_items` | Acquisition | existing | immutable | source evidence |
| 8 | `acquisition_import_jobs` | Acquisition | existing | state-machine | this system |
| 9 | `acquisition_payments` | Acquisition | **new** | append-only | this system |
| 10 | `acquisition_shipments` | Acquisition | **new** | state-machine | this system |
| 11 | `acquisition_receipts` | Acquisition | **new** | state-machine | this system |
| 12 | `acquisition_receipt_lines` | Acquisition | **new** | immutable | this system |
| 13 | `acquisition_discrepancies` | Acquisition | **new** | state-machine | this system |
| 14 | `acquisition_line_classifications` | Acquisition | **new** | append-only | this system |
| 15 | `classification_rules` | Acquisition | **new** | versioned | owner |
| 16 | `acquisition_line_exclusions` | Acquisition | **new** | append-only | owner |
| 17 | `supplier_performance` | Acquisition | **new (view)** | derived | none |
| 18 | `acquisition_cost_components` | Cost | existing | state-machine | this system |
| 19 | `acquisition_cost_allocations` | Cost | existing | state-machine | this system |
| 20 | `inventory_cost_basis` | Cost | **new** | derived-stored | this system |
| 21 | `inventory_cost_basis_events` | Cost | **new** | append-only | this system |
| 22 | `cogs_entries` | Cost | **new** | append-only | this system |
| 23 | `unresolved_cost_queue` | Cost | **new (view)** | derived | none |
| 24 | `marketplace_accounts` | Marketplace | **new** | state-machine | this system |
| 25 | `marketplace_credentials` | Marketplace | **new** | rotation-only | secret store |
| 26 | `marketplace_categories` | Marketplace | **new** | dated cache | marketplace |
| 27 | `marketplace_item_specifics` | Marketplace | **new** | dated cache | marketplace |
| 28 | `marketplace_listing_drafts` | Marketplace | **new** | owner-mutable → frozen | this system |
| 29 | `marketplace_listings` | Marketplace | **new** | state-machine | marketplace (replica) |
| 30 | `marketplace_listing_revisions` | Marketplace | **new** | append-only | this system |
| 31 | `marketplace_publish_requests` | Marketplace | **new** | state-machine | this system |
| 32 | `marketplace_api_calls` | Marketplace | **new** | append-only | exchange record |
| 33 | `marketplace_sync_events` | Marketplace | **new** | append-only | marketplace |
| 34 | `marketplace_offers` | Marketplace | **new** | state-machine | marketplace |
| 35 | `inventory_reservations` | Inventory | **new** | state-machine | this system |
| 36 | `marketplace_orders` | Orders | **new** | state-machine | marketplace |
| 37 | `marketplace_order_lines` | Orders | **new** | state-machine | marketplace |
| 38 | `shipments` | Fulfillment | **new** | state-machine | this system |
| 39 | `shipping_labels` | Fulfillment | **new** | append-only | carrier |
| 40 | `fulfillment_events` | Fulfillment | **new** | append-only | this system |
| 41 | `order_cancellations` | Orders | **new** | append-only | marketplace |
| 42 | `refunds` | Orders | **new** | append-only | marketplace |
| 43 | `returns` | Returns | **new** | state-machine | marketplace |
| 44 | `return_lines` | Returns | **new** | state-machine | this system |
| 45 | `return_dispositions` | Returns | **new** | append-only | owner |
| 46 | `inventory_exit_events` | Inventory | **new** | append-only | this system |
| 47 | `marketplace_fees` | Financial | **new** | append-only | marketplace |
| 48 | `payouts` | Financial | **new** | state-machine | marketplace |
| 49 | `payout_lines` | Financial | **new** | append-only | marketplace |
| 50 | `payout_reconciliations` | Financial | **new** | state-machine | this system |
| 51 | `realized_revenue` / `realized_cost` / `realized_profit` | Financial | **new (views)** | derived | none |
| 52 | `valuation_observations` | Pricing | **new** | append-only | observation |
| 53 | `comparable_evidence` | Pricing | **new** | append-only | this system |
| 54 | `price_recommendations` | Pricing | **new** | append-only | advisory only |
| 55 | `unrealized_margin` / `inventory_aging` / `sell_through_and_velocity` / `capital_tied_up` | Pricing | **new (views)** | derived | none |
| 56 | `ai_generation_requests` | AI | **new** | state-machine | this system |
| 57 | `ai_generation_evidence` | AI | **new** | immutable | this system |
| 58 | `ai_generations` | AI | **new** | immutable | model output |
| 59 | `ai_generation_reviews` | AI | **new** | append-only | owner |
| 60 | `ai_prohibited_actions` | AI | **new (registry)** | migration-seeded | policy |

**No speculative entity.** Each of the 60 attaches to a named lifecycle step in
charter § 4 and to at least one row of
`02_LEGACY_REPLACEMENT_MATRIX.md` View 2.

---

## 9. How this architecture satisfies the required principles

| Principle | Where it is realised |
|---|---|
| Workspace-scoped data | § 0, every entity |
| Caller-token authorization | § 0; `marketplace_credentials` has no client grant at all |
| RLS | § 0 |
| Governed `SECURITY DEFINER` functions | every mutation; `inventory_cost_basis`, `cogs_entries`, `marketplace_listings` and `marketplace_orders` have **no** direct write grant to any role |
| Database-enforced multi-row invariants | `inventory_reservations` sum ≤ availability; cost conservation (existing triggers extended to `inventory_cost_basis`); one active listing per reserved unit |
| Append-only evidence | `marketplace_api_calls`, `marketplace_sync_events`, `fulfillment_events`, `inventory_exit_events`, `inventory_cost_basis_events`, `cogs_entries`, `ai_generation_evidence` |
| Explicit state machines | receipts, shipments, publish requests, listings, orders, returns, payouts |
| Integer money in minor units | every `*_minor` column; no float anywhere in this design |
| Explicit currency | a `CHECK` rejects an amount without a currency |
| Database-held idempotency | `marketplace_publish_requests.idempotency_key`, `ai_generation_requests.idempotency_key`, and natural keys on every external identifier |
| Stable public ids | `RV-*` on all 45 new tables that a person names |
| No raw UUID in owner-facing UI | surfaces address `public_id` only |
| Revoke deprecated operations | legacy SQLite handlers are deleted; governed functions superseded during the program are revoked, not dropped |
| Visible dependency failure, not a fabricated zero | `cost_amount_state = 'unknown'`, `cost_attribution_state = 'unresolved'`, `confidence = 'insufficient_evidence'`, `marketplace_listings.status = 'out_of_sync'`, `unrealized_margin` reporting **unknown** |
| Current queues separated from historical evidence | operational views follow the existing `inventory_record_overview` population rule; `legacy_*_archive` tables are historical-only and never appear in a work queue |
| Owner approval for marketplace publication and financially consequential actions | `marketplace_publish_requests.approved_by`, `marketplace_offers` acceptance, `refunds`, `returns` authorization, `shipping_labels` purchase, all listed in `ai_prohibited_actions` |
| No service-role key in the browser | `marketplace_credentials` § 3 |
| No silent AI assertions | `ai_generation_evidence`, `missing_evidence`, mandatory `ai_generation_reviews` before any external effect |
