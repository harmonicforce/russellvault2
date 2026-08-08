-- S2.1 governed receiving schema.
--
-- The relational substrate that turns an acquisition into physically received
-- evidence. SCHEMA ONLY: no mutation function, no HTTP route, no UI, no
-- inventory creation, no cost basis. S2.2 owns receiving behaviour, S2.3 the
-- receiving UI, S2.4 the inventory cost basis.
--
-- THE THREE FACTS THIS MIGRATION MAKES RECORDABLE
--   EXPECTED    — acquisition evidence (acquisition_line_items.quantity), owned
--                 by the import layer and NEVER rewritten from here.
--   OBSERVED    — receiving evidence (acquisition_receipt_lines.quantity_received).
--   DIFFERENCE  — discrepancy evidence (acquisition_discrepancies).
-- A difference between EXPECTED and OBSERVED is recorded as a new downstream
-- fact. It never corrects the acquisition line, the source record, the
-- classification history, the payment evidence, or the shipment history.
--
-- RECEIPT IS NOT SHIPMENT. S1.4's acquisition_shipments owns transport and
-- tracking state (carrier, tracking number, shipped/expected/received_at,
-- status, transition history). A receipt owns what physically arrived. None of
-- the shipment's truth is copied here: a receipt that corresponds to a shipment
-- REFERENCES that governed shipment identity instead.
--
-- GRAIN
--   one acquisition order        -> many receipts       (multiple deliveries)
--   one receipt                  -> many receipt lines  (several lines per box)
--   one acquisition line         -> many receipt lines  (partial receiving,
--                                   at most one per receipt)
-- The canonical receipt-line grain is therefore (receipt, acquisition line),
-- pinned by acquisition_receipt_lines_receipt_line_uniq. This is the grain
-- 03_TARGET_COMMERCIAL_ARCHITECTURE.md § 1.2 fixes with its stated idempotency
-- key `unique (acquisition_receipt_id, acquisition_line_item_id)`.
--
-- PRODUCED INVENTORY IS DELIBERATELY NOT MODELLED HERE. The architecture's
-- receipt-line sketch carries `inventory_lot_id` / `inventory_item_id`, but a
-- single nullable pair cannot express the case it exists for — n serialized
-- units received against one acquisition line in one receipt — without either
-- breaking the (receipt, acquisition line) idempotency key above or forcing a
-- second grain. The acquisition->inventory link is left to S2.2, which owns
-- inventory creation and can add it additively without redesigning this grain.
--
-- CONVENTIONS INHERITED
--   * uuid primary key; governed RV-* public_id minted by
--     app.mint_governed_public_id;
--   * workspace_id NOT NULL referencing public.workspaces;
--   * UNIQUE (id, workspace_id, ...) on every parent so children carry
--     composite foreign keys and cross-workspace relationships are impossible
--     at the constraint level, independently of RLS;
--   * evidence-bearing foreign keys are ON DELETE RESTRICT;
--   * RLS on, same-workspace SELECT for members, and NO direct write grant:
--     the governed S2.2 functions will be the only write path.

-- Enumerations ---------------------------------------------------------------
-- The smallest closed receipt lifecycle sufficient for receiving, taken
-- verbatim from 03_TARGET_COMMERCIAL_ARCHITECTURE.md § 1.2. No speculative
-- warehouse-management states are added.
--   'open'       — the receiving session is being recorded.
--   'submitted'  — the operator asserts the physical count is complete.
--   'reconciled' — the owner has accepted the evidence (terminal).
--   'cancelled'  — the session was abandoned; its evidence stands as history
--                  and is never deleted (terminal).
create type public.acquisition_receipt_status as enum (
  'open', 'submitted', 'reconciled', 'cancelled'
);

-- The approved discrepancy taxonomy, verbatim from the target architecture.
-- Nothing is invented here: no severity scale is created because no severity
-- vocabulary has been approved, and 06_OWNER_DECISIONS.md escalates no
-- discrepancy-taxonomy question.
create type public.acquisition_discrepancy_kind as enum (
  'short_shipped', 'over_shipped', 'damaged', 'wrong_item',
  'not_as_described', 'price_mismatch', 'never_arrived'
);

create type public.acquisition_discrepancy_status as enum (
  'open', 'claimed', 'resolved', 'written_off'
);

-- Order-scoped shipment identity ---------------------------------------------
-- Purely additive to S1.4's acquisition_shipments: id is already the primary
-- key, so this constraint is satisfied by every existing row and changes no
-- behaviour. It exists so a receipt can bind to a shipment with ONE composite
-- foreign key that proves same-workspace AND same-order in the constraint
-- itself — a receipt for order A can never name order B's shipment, even from
-- a privileged internal statement.
alter table public.acquisition_shipments
  add constraint acquisition_shipments_order_scoped_uniq
  unique (id, acquisition_order_id, workspace_id);

-- acquisition_receipts -------------------------------------------------------
-- The governed identity of one physical receiving event: one receiving session
-- against one shipment, or against the order directly when no shipment record
-- exists. An order may have any number of receipts.
create table public.acquisition_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null default app.mint_governed_public_id('RV-ARCPT')
    check (public_id ~ '^RV-ARCPT-[A-Z0-9]{12}$'),
  acquisition_order_id uuid not null,
  -- Optional, and only ever a REFERENCE to S1.4's governed shipment identity.
  -- No carrier, tracking number, shipment status, or transition history is
  -- duplicated onto a receipt.
  acquisition_shipment_id uuid,
  status public.acquisition_receipt_status not null default 'open',
  -- When the goods physically arrived. Unknown while a session is still open;
  -- required once the operator asserts the count is complete, because a
  -- submitted receipt asserting an arrival with no arrival time is not
  -- evidence.
  received_at timestamptz,
  note text check (note is null or char_length(note) <= 1000),
  -- Database key on the create operation, per the cycle_count_create_idempotency
  -- convention the architecture names for this table. S2.2's open-receipt
  -- function supplies both; the fingerprint lets a replay be distinguished from
  -- a changed-payload reuse of the same key.
  create_idempotency_key text not null
    check (char_length(create_idempotency_key) between 8 and 200),
  create_fingerprint text not null check (char_length(create_fingerprint) = 64),
  -- The actor who recorded this receiving event (the architecture's
  -- `received_by`), named with the repository's governed created_by convention.
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  unique (workspace_id, create_idempotency_key),
  -- Lets a discrepancy bind to a receipt and prove same-order, same-workspace
  -- in one composite foreign key.
  constraint acquisition_receipts_order_scoped_uniq
    unique (id, acquisition_order_id, workspace_id),
  foreign key (acquisition_order_id, workspace_id)
    references public.acquisition_orders (id, workspace_id) on delete restrict,
  -- Same workspace AND same order as this receipt. NULL shipment_id leaves the
  -- relationship unconstrained (MATCH SIMPLE), which is the "no shipment record"
  -- case the grain explicitly allows.
  foreign key (acquisition_shipment_id, acquisition_order_id, workspace_id)
    references public.acquisition_shipments (id, acquisition_order_id, workspace_id)
    on delete restrict,
  constraint acquisition_receipts_submitted_has_received_at
    check (status not in ('submitted', 'reconciled') or received_at is not null),
  constraint acquisition_receipts_updated_after_created
    check (updated_at >= created_at)
);

comment on table public.acquisition_receipts is
  'One physical receiving event against an acquisition order. Authoritative for '
  'what physically arrived; never for transport state, which stays in '
  'acquisition_shipments. S2.2 owns every mutation and MUST call '
  'app.assert_acquisition_line_eligible_for_downstream before accepting a '
  'receipt line.';

create index acquisition_receipts_order_idx
  on public.acquisition_receipts (workspace_id, acquisition_order_id);
create index acquisition_receipts_received_at_idx
  on public.acquisition_receipts (workspace_id, received_at desc);
create index acquisition_receipts_status_idx
  on public.acquisition_receipts (workspace_id, status);
create index acquisition_receipts_shipment_idx
  on public.acquisition_receipts (workspace_id, acquisition_shipment_id)
  where acquisition_shipment_id is not null;

-- acquisition_receipt_lines --------------------------------------------------
-- Evidence that a quantity of one governed acquisition line physically arrived
-- in one receipt. One canonical row per (receipt, acquisition line); an
-- acquisition line partially received across several deliveries has one row per
-- receipt, which is what makes cumulative partial receiving expressible.
create table public.acquisition_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null default app.mint_governed_public_id('RV-ARL')
    check (public_id ~ '^RV-ARL-[A-Z0-9]{12}$'),
  acquisition_receipt_id uuid not null,
  acquisition_line_item_id uuid not null,
  -- Same integral representation as acquisition_line_items.quantity. A receipt
  -- line records an arrival, so recording zero units is not an arrival — the
  -- absence of a line, or a short_shipped/never_arrived discrepancy, is how
  -- "nothing came" is stated.
  quantity_received integer not null check (quantity_received > 0),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  -- Lets a discrepancy prove its receipt line belongs to the receipt it names,
  -- and concerns the acquisition line it names, in composite foreign keys.
  constraint acquisition_receipt_lines_receipt_scoped_uniq
    unique (id, acquisition_receipt_id, workspace_id),
  constraint acquisition_receipt_lines_line_scoped_uniq
    unique (id, acquisition_line_item_id, workspace_id),
  -- The canonical grain. Also the architecture's stated idempotency key.
  constraint acquisition_receipt_lines_receipt_line_uniq
    unique (acquisition_receipt_id, acquisition_line_item_id),
  foreign key (acquisition_receipt_id, workspace_id)
    references public.acquisition_receipts (id, workspace_id) on delete restrict,
  foreign key (acquisition_line_item_id, workspace_id)
    references public.acquisition_line_items (id, workspace_id) on delete restrict
);

comment on table public.acquisition_receipt_lines is
  'Observed arrival of one acquisition line in one receipt. No cumulative '
  'received-quantity ceiling is enforced here: over-receipt is a physical truth '
  'the discrepancy model must be able to record. S2.2 owns the transactional '
  'decision about whether such evidence may become inventory, and owns proving '
  'the acquisition line belongs to the receipt''s order — a relationship that '
  'runs through the supersedable acquisition_lot_lines placement and therefore '
  'cannot be a static foreign key.';

-- (receipt-prefix lookups are served by acquisition_receipt_lines_receipt_line_uniq;
-- a separate index on acquisition_receipt_id would be redundant.)
-- "How much of this acquisition line has been received across all receipts" is
-- the central S2.2 and S2.4 query and is the one lookup with no covering index.
create index acquisition_receipt_lines_line_item_idx
  on public.acquisition_receipt_lines (workspace_id, acquisition_line_item_id);

-- acquisition_discrepancies --------------------------------------------------
-- Durable evidence that what physically arrived did not match what was
-- expected. A discrepancy is a record, not a repair: raising one never edits
-- the acquisition line, and never deletes receiving evidence.
create table public.acquisition_discrepancies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null default app.mint_governed_public_id('RV-ADISC')
    check (public_id ~ '^RV-ADISC-[A-Z0-9]{12}$'),
  -- Always knowable: a discrepancy raised from a receipt concerns that
  -- receipt's order, and a 'never_arrived' discrepancy concerns an order with
  -- no receipt at all.
  acquisition_order_id uuid not null,
  acquisition_receipt_id uuid,
  acquisition_receipt_line_id uuid,
  acquisition_line_item_id uuid,
  kind public.acquisition_discrepancy_kind not null,
  status public.acquisition_discrepancy_status not null default 'open',
  -- Expected and observed are recorded only where they are meaningful, and are
  -- deliberately unordered: observed > expected is legitimate overage evidence.
  quantity_expected integer check (quantity_expected is null or quantity_expected >= 0),
  quantity_observed integer check (quantity_observed is null or quantity_observed >= 0),
  expected_value_minor bigint check (expected_value_minor is null or expected_value_minor >= 0),
  actual_value_minor bigint check (actual_value_minor is null or actual_value_minor >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- The required human explanation. A discrepancy with no account of what was
  -- seen is not evidence.
  detail text not null
    check (detail = btrim(detail) and char_length(detail) between 1 and 2000),
  resolution_note text
    check (resolution_note is null or char_length(resolution_note) between 1 and 2000),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  foreign key (acquisition_order_id, workspace_id)
    references public.acquisition_orders (id, workspace_id) on delete restrict,
  -- Same workspace AND same order as this discrepancy.
  foreign key (acquisition_receipt_id, acquisition_order_id, workspace_id)
    references public.acquisition_receipts (id, acquisition_order_id, workspace_id)
    on delete restrict,
  -- The named receipt line genuinely belongs to the named receipt.
  foreign key (acquisition_receipt_line_id, acquisition_receipt_id, workspace_id)
    references public.acquisition_receipt_lines (id, acquisition_receipt_id, workspace_id)
    on delete restrict,
  -- The named receipt line genuinely concerns the named acquisition line.
  foreign key (acquisition_receipt_line_id, acquisition_line_item_id, workspace_id)
    references public.acquisition_receipt_lines (id, acquisition_line_item_id, workspace_id)
    on delete restrict,
  foreign key (acquisition_line_item_id, workspace_id)
    references public.acquisition_line_items (id, workspace_id) on delete restrict,
  -- A receipt line is only meaningful inside the receipt that produced it.
  constraint acquisition_discrepancies_line_requires_receipt
    check (acquisition_receipt_line_id is null or acquisition_receipt_id is not null),
  constraint acquisition_discrepancies_value_requires_currency
    check (currency is not null
           or (expected_value_minor is null and actual_value_minor is null)),
  constraint acquisition_discrepancies_resolution_complete
    check ((resolved_at is null) = (resolved_by is null)),
  constraint acquisition_discrepancies_terminal_is_resolved
    check ((status in ('resolved', 'written_off')) = (resolved_at is not null)),
  constraint acquisition_discrepancies_updated_after_created
    check (updated_at >= created_at)
);

comment on table public.acquisition_discrepancies is
  'Evidence that observed receiving did not match expected acquisition. '
  'quantity_observed may legitimately exceed quantity_expected: the schema must '
  'be able to record an overage even where S2.2 later refuses to turn it into '
  'inventory without review.';

create index acquisition_discrepancies_order_idx
  on public.acquisition_discrepancies (workspace_id, acquisition_order_id);
create index acquisition_discrepancies_receipt_idx
  on public.acquisition_discrepancies (workspace_id, acquisition_receipt_id)
  where acquisition_receipt_id is not null;
create index acquisition_discrepancies_line_item_idx
  on public.acquisition_discrepancies (workspace_id, acquisition_line_item_id)
  where acquisition_line_item_id is not null;
-- The unresolved-discrepancy queue S2.3 and S2.6 read.
create index acquisition_discrepancies_open_idx
  on public.acquisition_discrepancies (workspace_id, status, created_at)
  where status in ('open', 'claimed');

-- Direct-write denial --------------------------------------------------------
-- Follows app.guard_acquisition_event_rows from S1.4: even a path that reaches
-- these rows with table privileges cannot rewrite or erase receiving evidence
-- unless it has explicitly declared itself a governed receiving mutation. S2.2
-- sets this GUC inside its SECURITY DEFINER functions; nothing else does.
--
-- The coalesce is load-bearing and deliberately NOT the S1.4 spelling.
-- current_setting(name, true) returns NULL for a GUC that was never set in the
-- session, and `NULL <> 'on'` evaluates to NULL, which plpgsql's IF treats as
-- false — so the bare comparison lets exactly the session this guard exists to
-- stop straight through. Comparing a coalesced value fails closed instead.
create function app.guard_acquisition_receiving_rows()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.governed_receiving_mutation', true), '') <> 'on' then
    raise exception 'governed_write_required' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

revoke all on function app.guard_acquisition_receiving_rows() from public;

create trigger acquisition_receipts_guard
  before update or delete on public.acquisition_receipts
  for each row execute function app.guard_acquisition_receiving_rows();
create trigger acquisition_receipt_lines_guard
  before update or delete on public.acquisition_receipt_lines
  for each row execute function app.guard_acquisition_receiving_rows();
create trigger acquisition_discrepancies_guard
  before update or delete on public.acquisition_discrepancies
  for each row execute function app.guard_acquisition_receiving_rows();

create trigger acquisition_receipts_no_truncate
  before truncate on public.acquisition_receipts
  execute function app.forbid_update_delete();
create trigger acquisition_receipt_lines_no_truncate
  before truncate on public.acquisition_receipt_lines
  execute function app.forbid_update_delete();
create trigger acquisition_discrepancies_no_truncate
  before truncate on public.acquisition_discrepancies
  execute function app.forbid_update_delete();

-- Row-level security and grants ----------------------------------------------
-- Same-workspace members (owner, operator, viewer) may READ receiving evidence,
-- matching the governed read model S1 established for acquisition evidence.
-- Nobody holds a direct write grant, and anon holds nothing at all.
alter table public.acquisition_receipts enable row level security;
alter table public.acquisition_receipt_lines enable row level security;
alter table public.acquisition_discrepancies enable row level security;

create policy acquisition_receipts_member_read on public.acquisition_receipts
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy acquisition_receipt_lines_member_read on public.acquisition_receipt_lines
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy acquisition_discrepancies_member_read on public.acquisition_discrepancies
  for select to authenticated using (app.member_role(workspace_id) is not null);

revoke all on
  public.acquisition_receipts,
  public.acquisition_receipt_lines,
  public.acquisition_discrepancies
from public, anon, authenticated;

grant select on
  public.acquisition_receipts,
  public.acquisition_receipt_lines,
  public.acquisition_discrepancies
to authenticated;

insert into public.schema_migrations_log(migration_name)
values ('20260807000100_s2_receiving_schema');
