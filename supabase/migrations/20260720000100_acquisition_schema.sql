-- Phase 4 acquisition hierarchy and source-cost ledger — migration 1: schema.
--
-- Newly created in Phase 4. Consumes the Phase 3 provenance layer (source
-- systems, import jobs, source records, external identifiers) rather than
-- bypassing or duplicating it: every normalized acquisition row below carries
-- a composite foreign key back to the immutable Phase 3 evidence it was
-- derived from. This migration creates NO second raw-import subsystem — the
-- only new "raw" concept here is acquisition_import_jobs, a job-bookkeeping
-- header (idempotency key, expected counts, status) with no payload column of
-- its own; the actual evidence stays in Phase 3's source_records.
--
-- STAGING / NON-AUTHORITATIVE, same as Phase 3. Legacy SQLite remains the
-- sole authoritative deployed system. No product, SKU, inventory lot,
-- inventory item, listing, sale, or marketplace schema is created here or
-- anywhere in Phase 4. No category (Pokemon, trading cards, sneakers, ...) is
-- hardcoded into this schema; category-shaped source fields are kept as
-- free-text metadata, never as an enum or constraint.
--
-- Conventions inherited from Phase 2/3:
--   * internal identity is a UUID primary key; governed public business
--     identifiers (public_id) are separate, immutable, per-workspace columns;
--   * workspace_id is NOT NULL and references public.workspaces;
--   * UNIQUE (id, workspace_id) lets children carry composite foreign keys so
--     cross-workspace relationships are impossible at the constraint level;
--   * evidence-bearing foreign keys are ON DELETE RESTRICT.
--
-- ACQUISITION HIERARCHY, deliberately NOT collapsed into one table:
--   channels             -- where the acquisition happened (a marketplace, a
--                           manual entry channel, ...); governed RV-CH ids.
--   suppliers            -- a canonical, human-curated seller identity;
--                           governed RV-SUP ids. NEVER auto-merged.
--   supplier_aliases      -- the exact raw source handle (e.g. a Whatnot
--                           seller username) that was OBSERVED, scoped to one
--                           source system, and its (initially 1:1, always
--                           correctable) mapping to a supplier.
--   acquisition_orders    -- one row per distinct source order identity.
--   acquisition_lots      -- the required order/show/package grouping layer
--                           INSIDE an order. For a source with no separate
--                           show/package concept (the Whatnot fixture), every
--                           order has exactly one lot — a real 1:1 today, not
--                           a schema limitation: a future source with several
--                           shows or physical packages per order fits without
--                           a migration.
--   acquisition_lot_lines -- the CURRENT placement of one line item inside one
--                           lot. Kept separate from acquisition_line_items so
--                           a correction can re-home a line into a different
--                           lot, by governed supersession, without mutating
--                           the immutable line item or its provenance.
--   acquisition_line_items-- the canonical acquired line, 1:1 with a Phase 3
--                           source_record. Preserves the ORIGINAL
--                           source-specific public id (e.g. "WN-A-000001")
--                           exactly, rather than minting a new RV-* id: this
--                           is deliberately the one governed identity in this
--                           schema that is NOT RV-*, because the instruction
--                           is to preserve it, not replace it.
--   acquisition_cost_components  -- a typed, priced, attributed cost fact.
--                           Scoped to exactly one of a line item (direct),
--                           a lot, or an order (shared, pending allocation).
--                           Governed RV-ACOST ids.
--   acquisition_cost_allocations -- an explicit, auditable split of one shared
--                           cost component's amount across specific line
--                           items. Governed RV-ACALLOC ids.
--
-- MONEY: bigint minor units (e.g. cents) with an explicit ISO-4217 currency
-- column on every priced row. Never floating point for an authoritative
-- amount. Zero is allowed only as 'documented_free', never as a stand-in for
-- missing/unknown/unallocated.
--
-- RETENTION AND DELETION RULES (enforced by grants/policies in migration 3):
--   * acquisition_line_items, acquisition_orders, acquisition_lots,
--     acquisition_import_jobs — permanent, immutable identity; corrections are
--     new governed import jobs, never edits (mirrors source_records).
--   * acquisition_lot_lines, acquisition_cost_components,
--     acquisition_cost_allocations — permanent; corrected by SUPERSESSION or
--     REVERSAL (a new row), never by rewriting history, exactly like
--     source_crosswalks.
--   * channels, suppliers, supplier_aliases — owner/import-administered
--     registries; deactivated rather than deleted where deactivation exists.

-- Enumerations ------------------------------------------------------------------
create type public.acquisition_order_status as enum (
  'open', 'completed', 'cancelled', 'refunded', 'unknown'
);
create type public.cost_component_type as enum (
  'item_price', 'shipping', 'tax', 'fee', 'discount', 'other'
);
-- 'known' — amount_minor is a real, priced amount.
-- 'documented_free' — the amount is genuinely zero AND that zero is backed by
--   evidence (evidence_note). Never used as shorthand for anything else.
-- 'unknown' — no amount is known yet. amount_minor is NULL, not zero.
create type public.cost_amount_state as enum ('known', 'documented_free', 'unknown');
-- 'direct' — the component belongs wholly to one line item.
-- 'allocated' — the component is shared (scoped to a lot or order) and has a
--   confirmed, conserving split across line items.
-- 'unresolved' — the component is shared and NOT YET allocated. This is the
--   explicit "no owner-approved rule yet" state; it is never silently
--   defaulted to zero or dropped.
create type public.cost_attribution_state as enum ('direct', 'allocated', 'unresolved');
create type public.cost_allocation_state as enum ('candidate', 'confirmed', 'reversed');
create type public.lot_line_state as enum ('active', 'superseded');

-- Governed public-id minting ------------------------------------------------------
-- Shared by every RV-* governed entity below. Random suffix (not a sequential
-- counter): avoids a hot, lock-contended counter row under concurrent staging,
-- consistent with Phase 3's import_jobs.public_id / IMP- convention.
create function app.mint_governed_public_id(p_prefix text)
returns text
language sql
volatile
set search_path = ''
as $$
  select p_prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
$$;

revoke all on function app.mint_governed_public_id(text) from public;

-- acquisition_import_jobs ---------------------------------------------------------
-- Job bookkeeping for ONE governed pass mapping an already-COMMITTED Phase 3
-- import job's source_records into the acquisition hierarchy below. Carries
-- no raw payload of its own — evidence stays in Phase 3's source_records.
-- Deliberately mirrors public.import_jobs' governance shape (idempotency,
-- status, actor, failure fields) rather than reusing that table directly:
-- import_jobs' identity is file-hash-based (an artifact being parsed); this
-- job's identity is "which already-committed Phase 3 job is being mapped",
-- a different and simpler identity that a file-hash model does not fit.
create table public.acquisition_import_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  channel_id uuid not null,
  source_import_job_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  mode text not null check (mode in ('preview', 'commit')),
  status public.import_job_status not null default 'preview',
  expected_line_count integer not null check (expected_line_count >= 0),
  actor_user_id uuid references auth.users (id),
  actor_process text not null check (actor_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_code text check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  failure_detail text check (failure_detail is null or char_length(failure_detail) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, idempotency_key),
  foreign key (source_import_job_id, workspace_id)
    references public.import_jobs (id, workspace_id) on delete restrict,
  constraint acquisition_import_jobs_failure_detail_present
    check ((status = 'failed') = (failure_code is not null)),
  constraint acquisition_import_jobs_commit_mode
    check (status <> 'committed' or mode = 'commit'),
  constraint acquisition_import_jobs_completed_after_start
    check (completed_at is null or completed_at >= started_at)
);

create index acquisition_import_jobs_workspace_idx on public.acquisition_import_jobs (workspace_id);
create index acquisition_import_jobs_status_idx on public.acquisition_import_jobs (workspace_id, status);
create index acquisition_import_jobs_source_idx
  on public.acquisition_import_jobs (source_import_job_id);

-- THE idempotency guarantee: at most one COMMITTED acquisition mapping per
-- already-committed Phase 3 import job.
create unique index acquisition_import_jobs_committed_identity_uidx
  on public.acquisition_import_jobs (workspace_id, source_import_job_id)
  where status = 'committed';

-- channels ------------------------------------------------------------------------
-- Where an acquisition happened: a marketplace platform, a manual entry
-- channel, etc. Owner-registered (see register_channel in migration 4).
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-CH-[A-Z0-9]{6,20}$'),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null check (kind in ('marketplace', 'manual', 'other')),
  description text check (description is null or char_length(description) <= 1000),
  active boolean not null default true,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  unique (workspace_id, name)
);

create index channels_workspace_idx on public.channels (workspace_id);

alter table public.acquisition_import_jobs
  add foreign key (channel_id, workspace_id)
    references public.channels (id, workspace_id) on delete restrict;

-- suppliers -------------------------------------------------------------------------
-- A canonical, human-curated seller identity. NEVER created by
-- string-similarity or normalization: exactly one supplier is minted per
-- distinct raw source handle the FIRST time it is seen (see
-- app.ensure_supplier_alias in migration 4), and stays distinct from every
-- other supplier until an explicit, auditable, owner-reviewed action says
-- otherwise. This migration adds no automatic-merge path of any kind.
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-SUP-[A-Z0-9]{6,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id)
);

create index suppliers_workspace_idx on public.suppliers (workspace_id);

-- supplier_aliases ------------------------------------------------------------------
-- The exact raw handle observed for a supplier from ONE source system (e.g. a
-- Whatnot seller username). Scoped uniqueness: the SAME-looking handle from a
-- different source system is a different alias, never assumed to be the same
-- supplier. normalized_handle is stored for REVIEW/QUERY purposes only (to
-- surface "these look similar, a human should check") and is never used to
-- automatically resolve or merge anything.
create table public.supplier_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  supplier_id uuid not null,
  source_system_id uuid not null,
  raw_handle text not null check (char_length(raw_handle) between 1 and 200),
  normalized_handle text not null check (char_length(normalized_handle) between 1 and 200),
  first_seen_source_record_id uuid,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, source_system_id, raw_handle),
  foreign key (supplier_id, workspace_id)
    references public.suppliers (id, workspace_id) on delete restrict,
  foreign key (source_system_id, workspace_id)
    references public.source_systems (id, workspace_id) on delete restrict,
  foreign key (first_seen_source_record_id, workspace_id)
    references public.source_records (id, workspace_id) on delete restrict
);

create index supplier_aliases_workspace_idx on public.supplier_aliases (workspace_id);
create index supplier_aliases_supplier_idx on public.supplier_aliases (supplier_id);
-- Supports the "unresolved supplier candidate" review query: aliases sharing
-- a normalized form but pointing at different suppliers.
create index supplier_aliases_normalized_idx
  on public.supplier_aliases (workspace_id, source_system_id, normalized_handle);

-- acquisition_orders ------------------------------------------------------------------
-- One row per distinct source order identity. Duplicate source order
-- identities within the same source system are blocked at the constraint
-- level (unique on workspace_id, source_system_id, source_order_reference).
create table public.acquisition_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-ACQ-[A-Z0-9]{6,20}$'),
  channel_id uuid not null,
  supplier_id uuid not null,
  source_system_id uuid not null,
  acquisition_import_job_id uuid not null,
  -- The scoped external evidence (e.g. a Whatnot order id). NOT a canonical
  -- internal identifier; uniqueness below is scoped to the source system.
  source_order_reference text not null check (char_length(source_order_reference) between 1 and 200),
  order_status public.acquisition_order_status not null default 'unknown',
  source_reported_status text check (source_reported_status is null or char_length(source_reported_status) <= 200),
  -- Independently derived from the source's own reported line totals at
  -- staging time. Kept separate from, and never forced to equal, the live
  -- normalized cost-component total (see the discrepancy check in the
  -- import workflow and the review surface).
  source_reported_total_minor bigint check (source_reported_total_minor is null or source_reported_total_minor >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  occurred_at timestamptz,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  unique (workspace_id, source_system_id, source_order_reference),
  foreign key (channel_id, workspace_id)
    references public.channels (id, workspace_id) on delete restrict,
  foreign key (supplier_id, workspace_id)
    references public.suppliers (id, workspace_id) on delete restrict,
  foreign key (source_system_id, workspace_id)
    references public.source_systems (id, workspace_id) on delete restrict,
  foreign key (acquisition_import_job_id, workspace_id)
    references public.acquisition_import_jobs (id, workspace_id) on delete restrict,
  constraint acquisition_orders_total_requires_currency
    check (source_reported_total_minor is null or currency is not null)
);

create index acquisition_orders_workspace_idx on public.acquisition_orders (workspace_id);
create index acquisition_orders_supplier_idx on public.acquisition_orders (supplier_id);
create index acquisition_orders_channel_idx on public.acquisition_orders (channel_id);
create index acquisition_orders_job_idx on public.acquisition_orders (acquisition_import_job_id);

-- acquisition_lots --------------------------------------------------------------------
-- The required order/show/package grouping layer. At least one lot per
-- order; a source with no finer grouping data maps every order to exactly
-- one lot (sequence_no = 1, label = NULL) — see the migration header.
create table public.acquisition_lots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-ALOT-[A-Z0-9]{6,20}$'),
  order_id uuid not null,
  sequence_no integer not null default 1 check (sequence_no >= 1),
  label text check (label is null or char_length(label) <= 200),
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  unique (workspace_id, order_id, sequence_no),
  foreign key (order_id, workspace_id)
    references public.acquisition_orders (id, workspace_id) on delete restrict
);

create index acquisition_lots_workspace_idx on public.acquisition_lots (workspace_id);
create index acquisition_lots_order_idx on public.acquisition_lots (order_id);

-- acquisition_line_items ----------------------------------------------------------------
-- The canonical acquired line. 1:1 with a Phase 3 source_record. public_id is
-- the ORIGINAL source-specific public id (e.g. "WN-A-000001"), preserved
-- exactly — never renumbered, replaced, reinterpreted, or recycled.
-- source_detail carries category-shaped source fields (e.g. a marketplace's
-- "business_vertical" label) as free-text metadata ONLY: no category is ever
-- an enum value, a constraint, or a schema concept here.
create table public.acquisition_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (char_length(public_id) between 1 and 200),
  source_system_id uuid not null,
  source_record_id uuid not null,
  external_identifier_id uuid,
  acquisition_import_job_id uuid not null,
  quantity integer not null check (quantity > 0),
  description text check (description is null or char_length(description) <= 1000),
  reference_number text check (reference_number is null or char_length(reference_number) <= 200),
  source_detail jsonb not null default '{}'::jsonb,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- Duplicate source-line identity is blocked within its source system.
  unique (workspace_id, source_system_id, public_id),
  -- Exactly one canonical line item per raw source row.
  unique (workspace_id, source_record_id),
  foreign key (source_system_id, workspace_id)
    references public.source_systems (id, workspace_id) on delete restrict,
  foreign key (source_record_id, workspace_id)
    references public.source_records (id, workspace_id) on delete restrict,
  foreign key (external_identifier_id, workspace_id)
    references public.external_identifiers (id, workspace_id) on delete restrict,
  foreign key (acquisition_import_job_id, workspace_id)
    references public.acquisition_import_jobs (id, workspace_id) on delete restrict,
  constraint acquisition_line_items_detail_is_object check (jsonb_typeof(source_detail) = 'object')
);

create index acquisition_line_items_workspace_idx on public.acquisition_line_items (workspace_id);
create index acquisition_line_items_job_idx on public.acquisition_line_items (acquisition_import_job_id);
create index acquisition_line_items_source_record_idx
  on public.acquisition_line_items (source_record_id);

-- acquisition_lot_lines -------------------------------------------------------------------
-- The CURRENT placement of one line item inside one lot. Corrections
-- re-home a line via SUPERSESSION (a new row), never by rewriting this one.
create table public.acquisition_lot_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  lot_id uuid not null,
  line_item_id uuid not null,
  sequence_no integer not null default 1 check (sequence_no >= 1),
  state public.lot_line_state not null default 'active',
  superseded_by_id uuid,
  superseded_at timestamptz,
  supersedes_id uuid,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  -- Carries the line item's id ONLY while this placement is active, NULL once
  -- superseded. Because SQL treats NULLs as distinct, the unique constraint
  -- below allows any number of superseded placements to coexist while still
  -- pinning at most one ACTIVE placement per line item. A generated column lets
  -- that constraint be DEFERRABLE (a partial WHERE index cannot be), which in
  -- turn lets supersede_lot_line insert the replacement and retire the old
  -- placement in one transaction without a transient two-active collision.
  active_line_item_id uuid generated always as
    (case when state = 'active' then line_item_id else null end) stored,
  unique (id, workspace_id),
  foreign key (lot_id, workspace_id)
    references public.acquisition_lots (id, workspace_id) on delete restrict,
  foreign key (line_item_id, workspace_id)
    references public.acquisition_line_items (id, workspace_id) on delete restrict,
  foreign key (superseded_by_id, workspace_id)
    references public.acquisition_lot_lines (id, workspace_id) on delete restrict,
  foreign key (supersedes_id, workspace_id)
    references public.acquisition_lot_lines (id, workspace_id) on delete restrict,
  constraint acquisition_lot_lines_superseded_has_successor
    check ((state = 'superseded') = (superseded_by_id is not null and superseded_at is not null)),
  constraint acquisition_lot_lines_no_self_supersede
    check (superseded_by_id is distinct from id and supersedes_id is distinct from id),
  -- At most one ACTIVE placement per line item, deferred so an in-transaction
  -- re-home (insert new active + retire old) validates only at commit.
  constraint acquisition_lot_lines_one_active_uniq
    unique (workspace_id, active_line_item_id) deferrable initially deferred
);

create index acquisition_lot_lines_workspace_idx on public.acquisition_lot_lines (workspace_id);
create index acquisition_lot_lines_lot_idx on public.acquisition_lot_lines (lot_id);
create index acquisition_lot_lines_line_item_idx on public.acquisition_lot_lines (line_item_id);

-- (one-active-per-line-item is enforced by the deferrable unique constraint above)
-- Linear supersession chains only (mirrors source_crosswalks).
create unique index acquisition_lot_lines_one_successor_uidx
  on public.acquisition_lot_lines (superseded_by_id) where superseded_by_id is not null;
create unique index acquisition_lot_lines_one_predecessor_uidx
  on public.acquisition_lot_lines (supersedes_id) where supersedes_id is not null;

-- acquisition_cost_components -----------------------------------------------------------
-- A typed, priced, attributed cost fact, scoped to EXACTLY ONE of a line item
-- (direct), a lot, or an order (shared, pending allocation).
create table public.acquisition_cost_components (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-ACOST-[A-Z0-9]{6,20}$'),
  line_item_id uuid,
  lot_id uuid,
  order_id uuid,
  component_type public.cost_component_type not null,
  amount_state public.cost_amount_state not null,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  attribution_state public.cost_attribution_state not null,
  -- Required evidence text when amount_state = 'documented_free'.
  evidence_note text check (evidence_note is null or char_length(evidence_note) <= 2000),
  -- Direct provenance link when this amount came straight from one raw field.
  source_record_id uuid,
  acquisition_import_job_id uuid not null,
  reversed_by_id uuid,
  reversed_at timestamptz,
  reverses_id uuid,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  foreign key (line_item_id, workspace_id)
    references public.acquisition_line_items (id, workspace_id) on delete restrict,
  foreign key (lot_id, workspace_id)
    references public.acquisition_lots (id, workspace_id) on delete restrict,
  foreign key (order_id, workspace_id)
    references public.acquisition_orders (id, workspace_id) on delete restrict,
  foreign key (source_record_id, workspace_id)
    references public.source_records (id, workspace_id) on delete restrict,
  foreign key (acquisition_import_job_id, workspace_id)
    references public.acquisition_import_jobs (id, workspace_id) on delete restrict,
  foreign key (reversed_by_id, workspace_id)
    references public.acquisition_cost_components (id, workspace_id) on delete restrict,
  foreign key (reverses_id, workspace_id)
    references public.acquisition_cost_components (id, workspace_id) on delete restrict,
  constraint acquisition_cost_components_one_scope
    check (num_nonnulls(line_item_id, lot_id, order_id) = 1),
  constraint acquisition_cost_components_amount_known
    check (amount_state <> 'known' or amount_minor is not null),
  constraint acquisition_cost_components_amount_unknown
    check (amount_state <> 'unknown' or amount_minor is null),
  -- Zero is allowed ONLY when documented, and documentation is required.
  constraint acquisition_cost_components_documented_free
    check (amount_state <> 'documented_free' or (amount_minor = 0 and evidence_note is not null)),
  constraint acquisition_cost_components_known_nonzero_or_free
    check (amount_state <> 'known' or amount_minor > 0 or evidence_note is not null),
  constraint acquisition_cost_components_attribution_direct
    check (attribution_state <> 'direct' or line_item_id is not null),
  constraint acquisition_cost_components_attribution_shared
    check (attribution_state = 'direct' or (lot_id is not null or order_id is not null)),
  constraint acquisition_cost_components_reversed_has_successor
    check ((reversed_at is not null) = (reversed_by_id is not null)),
  constraint acquisition_cost_components_no_self_reverse
    check (reversed_by_id is distinct from id and reverses_id is distinct from id)
);

create index acquisition_cost_components_workspace_idx
  on public.acquisition_cost_components (workspace_id);
create index acquisition_cost_components_line_idx
  on public.acquisition_cost_components (line_item_id);
create index acquisition_cost_components_lot_idx
  on public.acquisition_cost_components (lot_id);
create index acquisition_cost_components_order_idx
  on public.acquisition_cost_components (order_id);
create index acquisition_cost_components_job_idx
  on public.acquisition_cost_components (acquisition_import_job_id);
create unique index acquisition_cost_components_one_successor_uidx
  on public.acquisition_cost_components (reversed_by_id) where reversed_by_id is not null;
create unique index acquisition_cost_components_one_predecessor_uidx
  on public.acquisition_cost_components (reverses_id) where reverses_id is not null;

-- acquisition_cost_allocations -----------------------------------------------------------
-- An explicit, auditable split of one shared cost component's amount across
-- specific line items. 'method' is a caller-supplied identifier, not a
-- system-invented one: nothing in this schema or the workflow guesses a
-- method to make a total balance.
create table public.acquisition_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-ACALLOC-[A-Z0-9]{6,20}$'),
  cost_component_id uuid not null,
  line_item_id uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  method text not null check (method ~ '^[a-z][a-z0-9_]{1,63}$'),
  state public.cost_allocation_state not null default 'candidate',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  reversed_by_id uuid,
  reversed_at timestamptz,
  reverses_id uuid,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  foreign key (cost_component_id, workspace_id)
    references public.acquisition_cost_components (id, workspace_id) on delete restrict,
  foreign key (line_item_id, workspace_id)
    references public.acquisition_line_items (id, workspace_id) on delete restrict,
  foreign key (reversed_by_id, workspace_id)
    references public.acquisition_cost_allocations (id, workspace_id) on delete restrict,
  foreign key (reverses_id, workspace_id)
    references public.acquisition_cost_allocations (id, workspace_id) on delete restrict,
  constraint acquisition_cost_allocations_confirmed_has_reviewer
    check (state <> 'confirmed' or (reviewed_by is not null and reviewed_at is not null)),
  constraint acquisition_cost_allocations_candidate_unreviewed
    check (state <> 'candidate' or (reviewed_by is null and reviewed_at is null)),
  -- Reversal is a plain retraction: it does not require a paired replacement
  -- allocation row (unlike acquisition_cost_components, where a reversal
  -- corrects one specific fact with one specific successor). A fresh
  -- propose/confirm cycle after a reversal may split the component across an
  -- entirely different set of line items, so reversed_by_id/reverses_id are
  -- optional here and only ever set if a specific corrective allocation
  -- exists to point at.
  constraint acquisition_cost_allocations_reversed_has_timestamp
    check ((state = 'reversed') = (reversed_at is not null)),
  constraint acquisition_cost_allocations_reversed_by_implies_state
    check (reversed_by_id is null or state = 'reversed'),
  constraint acquisition_cost_allocations_no_self_reverse
    check (reversed_by_id is distinct from id and reverses_id is distinct from id)
);

create index acquisition_cost_allocations_workspace_idx
  on public.acquisition_cost_allocations (workspace_id);
create index acquisition_cost_allocations_component_idx
  on public.acquisition_cost_allocations (cost_component_id);
create index acquisition_cost_allocations_line_idx
  on public.acquisition_cost_allocations (line_item_id);
create unique index acquisition_cost_allocations_one_successor_uidx
  on public.acquisition_cost_allocations (reversed_by_id) where reversed_by_id is not null;
create unique index acquisition_cost_allocations_one_predecessor_uidx
  on public.acquisition_cost_allocations (reverses_id) where reverses_id is not null;

insert into public.schema_migrations_log (migration_name)
values ('20260720000100_acquisition_schema');
