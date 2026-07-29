-- Cycle count — sessions, frozen scope, and the frozen expected snapshot.
--
-- A cycle count is a claim about what is physically on a shelf, compared
-- against what the system believed at one exact moment. Both halves of that
-- comparison have to be pinned down or the result means nothing:
--
--   * the SCOPE is resolved once, at start, into an explicit list of location
--     ids. If someone re-parents or retires a shelf mid-count, the count still
--     describes the shelves it actually walked.
--   * the EXPECTED inventory is snapshotted once, at start. Making it a live
--     query would mean the thing being measured moves while you measure it,
--     and a discrepancy could appear or vanish because of unrelated work.
--
-- Nothing in this migration mutates inventory. Counting produces evidence;
-- changing stock is a separate, explicit, governed act (20260729000300).

create type public.cycle_count_status as enum (
  'draft',
  'in_progress',
  'review',
  'completed',
  'cancelled'
);

create type public.cycle_count_scope_type as enum (
  'single_location',
  'location_and_descendants'
);

-- Sessions ------------------------------------------------------------------
create table public.cycle_count_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-CC-[A-Z0-9]{6,20}$'),
  status public.cycle_count_status not null default 'draft',
  scope_type public.cycle_count_scope_type not null,
  root_location_id uuid not null,
  include_descendants boolean not null default false,
  -- Optional narrowing. Null means "everything countable in scope".
  subtype_filter public.inventory_subtype,
  vertical_filter public.inventory_vertical,
  -- Recorded permanently: whether the counter could see expected quantities
  -- changes how much the result is worth, so it is part of the evidence.
  blind_count boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  started_by uuid references auth.users (id) on delete restrict,
  started_at timestamptz,
  snapshot_frozen_at timestamptz,
  submitted_by uuid references auth.users (id) on delete restrict,
  submitted_at timestamptz,
  completed_by uuid references auth.users (id) on delete restrict,
  completed_at timestamptz,
  completion_summary jsonb,
  completion_note text check (completion_note is null or char_length(completion_note) <= 2000),
  cancelled_by uuid references auth.users (id) on delete restrict,
  cancelled_at timestamptz,
  cancellation_reason text check (cancellation_reason is null or char_length(cancellation_reason) <= 2000),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  -- A draft has not resolved anything yet; everything past draft has.
  constraint cycle_count_started_fields check (
    (status = 'draft' and started_at is null and snapshot_frozen_at is null)
    or (status <> 'draft' and (status = 'cancelled' or (started_at is not null and snapshot_frozen_at is not null)))
  ),
  -- Terminal states always say who ended them and when.
  constraint cycle_count_completed_fields check (
    (status = 'completed') = (completed_at is not null and completed_by is not null)
  ),
  constraint cycle_count_cancelled_fields check (
    (status = 'cancelled')
      = (cancelled_at is not null and cancelled_by is not null
         and nullif(btrim(coalesce(cancellation_reason, '')), '') is not null)
  ),
  constraint cycle_count_scope_matches_type check (
    (scope_type = 'location_and_descendants') = include_descendants
  ),
  foreign key (root_location_id, workspace_id)
    references public.storage_locations (id, workspace_id) on delete restrict
);
create index cycle_count_sessions_workspace_idx
  on public.cycle_count_sessions (workspace_id, status, created_at desc);

-- The identity of a session, and every choice made when it was created, is
-- frozen: what it covers and whether it was blind decide what its result means.
--
-- started_at / started_by / snapshot_frozen_at are deliberately NOT in this
-- list even though they must never be rewritten. They are set BY the transition
-- out of draft, so freezing them from creation would block the very statement
-- that fills them in. They are write-once by lifecycle instead: only
-- start_cycle_count writes them, it runs only on a draft, and no transition
-- returns a session to draft.
create trigger cycle_count_sessions_identity_immutable
  before update on public.cycle_count_sessions
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'scope_type', 'root_location_id',
    'include_descendants', 'subtype_filter', 'vertical_filter', 'blind_count',
    'created_by', 'created_at'
  );
create trigger cycle_count_sessions_no_delete
  before delete on public.cycle_count_sessions
  for each row execute function app.forbid_update_delete();
create trigger cycle_count_sessions_no_truncate
  before truncate on public.cycle_count_sessions
  for each statement execute function app.forbid_update_delete();

-- A completed or cancelled session is evidence, not a working document.
create function app.cycle_count_forbid_terminal_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('completed', 'cancelled') then
    raise exception 'cycle count % is % and can no longer be changed',
      old.public_id, old.status using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger cycle_count_sessions_terminal_immutable
  before update on public.cycle_count_sessions
  for each row execute function app.cycle_count_forbid_terminal_change();

-- Frozen scope ---------------------------------------------------------------
-- The exact locations this count covered, resolved once at start. Kept even if
-- a location is later re-parented or retired.
create table public.cycle_count_scope_locations (
  session_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  location_id uuid not null,
  location_code text not null,
  location_display_name text,
  depth integer not null check (depth >= 0),
  primary key (session_id, location_id),
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions (id, workspace_id) on delete restrict,
  foreign key (location_id, workspace_id)
    references public.storage_locations (id, workspace_id) on delete restrict
);

create trigger cycle_count_scope_locations_append_only
  before update or delete on public.cycle_count_scope_locations
  for each row execute function app.forbid_update_delete();
create trigger cycle_count_scope_locations_no_truncate
  before truncate on public.cycle_count_scope_locations
  for each statement execute function app.forbid_update_delete();

-- Frozen expected snapshot — serialized units --------------------------------
create table public.cycle_count_expected_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  item_id uuid not null,
  item_public_id text not null,
  scan_sku text not null,
  certificate_number text,
  serial_number text,
  grading_company text,
  sku_id uuid not null,
  sku_public_id text not null,
  product_id uuid not null,
  product_public_id text not null,
  display_name text not null,
  inventory_subtype public.inventory_subtype not null,
  business_vertical public.inventory_vertical not null,
  expected_location_id uuid not null,
  expected_location_code text not null,
  item_state public.inventory_item_state not null,
  snapshot_at timestamptz not null default now(),
  -- One row per physical unit per session. This is what makes "counted twice"
  -- impossible at the storage layer rather than by convention.
  unique (session_id, item_id),
  unique (id, workspace_id),
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions (id, workspace_id) on delete restrict,
  foreign key (item_id, workspace_id)
    references public.inventory_items (id, workspace_id) on delete restrict
);
create index cycle_count_expected_items_session_idx
  on public.cycle_count_expected_items (session_id);
create index cycle_count_expected_items_lookup_idx
  on public.cycle_count_expected_items (session_id, item_public_id);

create trigger cycle_count_expected_items_append_only
  before update or delete on public.cycle_count_expected_items
  for each row execute function app.forbid_update_delete();
create trigger cycle_count_expected_items_no_truncate
  before truncate on public.cycle_count_expected_items
  for each statement execute function app.forbid_update_delete();

-- Frozen expected snapshot — quantity lots ------------------------------------
create table public.cycle_count_expected_lots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  lot_id uuid not null,
  lot_public_id text not null,
  sku_id uuid not null,
  sku_public_id text not null,
  product_id uuid not null,
  product_public_id text not null,
  display_name text not null,
  inventory_subtype public.inventory_subtype not null,
  business_vertical public.inventory_vertical not null,
  expected_location_id uuid not null,
  expected_location_code text not null,
  expected_quantity integer not null check (expected_quantity >= 0),
  lot_state public.inventory_lot_state not null,
  snapshot_at timestamptz not null default now(),
  unique (session_id, lot_id),
  unique (id, workspace_id),
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions (id, workspace_id) on delete restrict,
  foreign key (lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict
);
create index cycle_count_expected_lots_session_idx
  on public.cycle_count_expected_lots (session_id);

create trigger cycle_count_expected_lots_append_only
  before update or delete on public.cycle_count_expected_lots
  for each row execute function app.forbid_update_delete();
create trigger cycle_count_expected_lots_no_truncate
  before truncate on public.cycle_count_expected_lots
  for each statement execute function app.forbid_update_delete();

-- Security --------------------------------------------------------------------
alter table public.cycle_count_sessions enable row level security;
alter table public.cycle_count_scope_locations enable row level security;
alter table public.cycle_count_expected_items enable row level security;
alter table public.cycle_count_expected_lots enable row level security;

revoke all on table
  public.cycle_count_sessions, public.cycle_count_scope_locations,
  public.cycle_count_expected_items, public.cycle_count_expected_lots
  from public, anon, authenticated;
grant select on table
  public.cycle_count_sessions, public.cycle_count_scope_locations,
  public.cycle_count_expected_items, public.cycle_count_expected_lots
  to authenticated;

create policy cycle_count_sessions_select on public.cycle_count_sessions
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy cycle_count_scope_locations_select on public.cycle_count_scope_locations
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy cycle_count_expected_items_select on public.cycle_count_expected_items
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy cycle_count_expected_lots_select on public.cycle_count_expected_lots
  for select to authenticated using (app.member_role(workspace_id) is not null);

-- Helpers ----------------------------------------------------------------------
-- The active locations a scope resolves to, right now. Called once at start and
-- then never again -- the result is stored, not re-derived.
create function app.cycle_count_resolve_scope(
  p_workspace_id uuid,
  p_root_location_id uuid,
  p_include_descendants boolean
)
returns table (location_id uuid, location_code text, display_name text, depth integer)
language sql
stable
set search_path = ''
as $$
  with recursive tree as (
    select l.id, l.location_code, l.display_name, 0 as depth
      from public.storage_locations l
     where l.id = p_root_location_id
       and l.workspace_id = p_workspace_id
       and l.retired_at is null
    union all
    select c.id, c.location_code, c.display_name, t.depth + 1
      from public.storage_locations c
      join tree t on c.parent_id = t.id
     where c.workspace_id = p_workspace_id
       and c.retired_at is null
       and p_include_descendants
  )
  select id, location_code, display_name, depth from tree;
$$;

revoke all on function app.cycle_count_resolve_scope(uuid, uuid, boolean) from public, anon;

-- Only an owner or operator may run a count. Counting produces evidence that
-- drives inventory changes, so it is not a viewer action.
create function app.cycle_count_require_counter(p_workspace_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role public.workspace_role;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  v_role := app.member_role(p_workspace_id);
  if v_role not in ('owner', 'operator') then
    raise exception 'only an owner or operator may run a cycle count'
      using errcode = '42501';
  end if;
  return v_uid;
end
$$;

revoke all on function app.cycle_count_require_counter(uuid) from public, anon;

-- Create ------------------------------------------------------------------------
create function public.create_cycle_count(
  p_workspace_id uuid,
  p_root_location_code text,
  p_include_descendants boolean default false,
  p_subtype_filter public.inventory_subtype default null,
  p_vertical_filter public.inventory_vertical default null,
  p_blind_count boolean default false,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_location uuid;
  v_public text;
  v_id uuid;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);

  -- Resolves ACTIVE locations in THIS workspace only; a retired code or a
  -- neighbour's code simply does not resolve.
  v_location := app.intake_resolve_location(p_workspace_id, p_root_location_code);
  if v_location is null then
    raise exception 'location % is not an active location in this workspace',
      p_root_location_code using errcode = '23514';
  end if;

  v_public := app.mint_governed_public_id('RV-CC');
  insert into public.cycle_count_sessions (
    workspace_id, public_id, status, scope_type, root_location_id,
    include_descendants, subtype_filter, vertical_filter, blind_count, notes, created_by)
  values (
    p_workspace_id, v_public, 'draft',
    (case when p_include_descendants then 'location_and_descendants' else 'single_location' end)
      ::public.cycle_count_scope_type,
    v_location, coalesce(p_include_descendants, false), p_subtype_filter, p_vertical_filter,
    coalesce(p_blind_count, false), nullif(btrim(coalesce(p_notes, '')), ''), v_uid)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'public_id', v_public, 'status', 'draft');
end
$$;

revoke all on function public.create_cycle_count(
  uuid, text, boolean, public.inventory_subtype, public.inventory_vertical, boolean, text)
  from public, anon;
grant execute on function public.create_cycle_count(
  uuid, text, boolean, public.inventory_subtype, public.inventory_vertical, boolean, text)
  to authenticated;

-- Scope preview -------------------------------------------------------------------
-- What a draft WOULD cover if started now. Explicitly not stored: it is a
-- planning aid, and it is expected to differ from the frozen snapshot if the
-- operator waits before starting.
create function public.preview_cycle_count_scope(
  p_workspace_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s public.cycle_count_sessions%rowtype;
  v_locations int;
  v_items int;
  v_lots int;
  v_units bigint;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select * into v_s from public.cycle_count_sessions
  where id = p_session_id and workspace_id = p_workspace_id;
  if v_s.id is null then
    raise exception 'cycle count not found in this workspace' using errcode = '23514';
  end if;

  -- Resolved inline rather than into a temp table: this function is STABLE, and
  -- a preview must not write anything, not even scratch state.
  select count(*)::int into v_locations
  from app.cycle_count_resolve_scope(
    p_workspace_id, v_s.root_location_id, v_s.include_descendants);

  select count(*)::int into v_items
  from public.inventory_items i
  join public.inventory_lots l on l.id = i.lot_id
  join public.sellable_skus sk on sk.id = i.sku_id
  where i.workspace_id = p_workspace_id
    and i.item_state = 'active'
    and coalesce(i.location_id, l.location_id) in (
      select location_id from app.cycle_count_resolve_scope(
        p_workspace_id, v_s.root_location_id, v_s.include_descendants))
    and (v_s.subtype_filter is null or sk.inventory_subtype = v_s.subtype_filter)
    and (v_s.vertical_filter is null or sk.business_vertical = v_s.vertical_filter);

  select count(*)::int, coalesce(sum(l.quantity), 0) into v_lots, v_units
  from public.inventory_lots l
  join public.sellable_skus sk on sk.id = l.sku_id
  where l.workspace_id = p_workspace_id
    and l.tracking_mode = 'lot_managed'
    and l.lot_state = 'active'
    and l.quantity > 0
    and l.location_id in (
      select location_id from app.cycle_count_resolve_scope(
        p_workspace_id, v_s.root_location_id, v_s.include_descendants))
    and (v_s.subtype_filter is null or sk.inventory_subtype = v_s.subtype_filter)
    and (v_s.vertical_filter is null or sk.business_vertical = v_s.vertical_filter);

  return jsonb_build_object(
    'session_id', p_session_id,
    'location_count', v_locations,
    'expected_item_count', v_items,
    'expected_lot_count', v_lots,
    'expected_unit_count', v_units);
end
$$;

revoke all on function public.preview_cycle_count_scope(uuid, uuid) from public, anon;
grant execute on function public.preview_cycle_count_scope(uuid, uuid) to authenticated;

-- Start ---------------------------------------------------------------------------
-- The moment the count becomes real: scope resolved and stored, expected
-- inventory snapshotted, status advanced. All in one transaction, so a session
-- can never exist in a half-frozen state.
create function public.start_cycle_count(
  p_workspace_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_s public.cycle_count_sessions%rowtype;
  v_now timestamptz := now();
  v_items int;
  v_lots int;
  v_units bigint;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);

  select * into v_s from public.cycle_count_sessions
  where id = p_session_id and workspace_id = p_workspace_id
  for update;
  if v_s.id is null then
    raise exception 'cycle count not found in this workspace' using errcode = '23514';
  end if;
  if v_s.status <> 'draft' then
    raise exception 'only a draft cycle count can be started (this one is %)', v_s.status
      using errcode = '23514';
  end if;

  -- Freeze the scope. Recorded as ids AND codes: the id keeps the join honest,
  -- the code keeps the audit readable if the location is later renamed.
  insert into public.cycle_count_scope_locations (
    session_id, workspace_id, location_id, location_code, location_display_name, depth)
  select p_session_id, p_workspace_id, r.location_id, r.location_code, r.display_name, r.depth
  from app.cycle_count_resolve_scope(
    p_workspace_id, v_s.root_location_id, v_s.include_descendants) r;

  if not exists (select 1 from public.cycle_count_scope_locations where session_id = p_session_id) then
    raise exception 'the root location is no longer active; this count has nothing to cover'
      using errcode = '23514';
  end if;

  -- Freeze expected serialized units. An item's effective location is its own
  -- if set, otherwise its lot's -- the same rule the inventory read models use.
  insert into public.cycle_count_expected_items (
    session_id, workspace_id, item_id, item_public_id, scan_sku, certificate_number,
    serial_number, grading_company, sku_id, sku_public_id, product_id, product_public_id,
    display_name, inventory_subtype, business_vertical, expected_location_id,
    expected_location_code, item_state, snapshot_at)
  select
    p_session_id, p_workspace_id, i.id, i.public_id, i.scan_sku, i.certificate_number,
    i.serial_number, i.grading_company, sk.id, sk.public_id, p.id, p.public_id,
    p.display_name, sk.inventory_subtype, sk.business_vertical,
    coalesce(i.location_id, l.location_id), loc.location_code, i.item_state, v_now
  from public.inventory_items i
  join public.inventory_lots l on l.id = i.lot_id
  join public.sellable_skus sk on sk.id = i.sku_id
  join public.product_catalog p on p.id = sk.product_id
  join public.storage_locations loc on loc.id = coalesce(i.location_id, l.location_id)
  where i.workspace_id = p_workspace_id
    -- Superseded, voided and lost units are not physical stock.
    and i.item_state = 'active'
    and coalesce(i.location_id, l.location_id) in (
      select location_id from public.cycle_count_scope_locations where session_id = p_session_id)
    and (v_s.subtype_filter is null or sk.inventory_subtype = v_s.subtype_filter)
    and (v_s.vertical_filter is null or sk.business_vertical = v_s.vertical_filter);

  -- Freeze expected quantity lots. Serialized parent lots are excluded because
  -- their units are counted individually above -- counting both would count the
  -- same physical stock twice. Absorbed and voided lots are not stock at all,
  -- and an empty lot has nothing to find.
  insert into public.cycle_count_expected_lots (
    session_id, workspace_id, lot_id, lot_public_id, sku_id, sku_public_id, product_id,
    product_public_id, display_name, inventory_subtype, business_vertical,
    expected_location_id, expected_location_code, expected_quantity, lot_state, snapshot_at)
  select
    p_session_id, p_workspace_id, l.id, l.public_id, sk.id, sk.public_id, p.id, p.public_id,
    p.display_name, sk.inventory_subtype, sk.business_vertical,
    l.location_id, loc.location_code, l.quantity, l.lot_state, v_now
  from public.inventory_lots l
  join public.sellable_skus sk on sk.id = l.sku_id
  join public.product_catalog p on p.id = sk.product_id
  join public.storage_locations loc on loc.id = l.location_id
  where l.workspace_id = p_workspace_id
    and l.tracking_mode = 'lot_managed'
    and l.lot_state = 'active'
    and l.quantity > 0
    and l.location_id in (
      select location_id from public.cycle_count_scope_locations where session_id = p_session_id)
    and (v_s.subtype_filter is null or sk.inventory_subtype = v_s.subtype_filter)
    and (v_s.vertical_filter is null or sk.business_vertical = v_s.vertical_filter);

  update public.cycle_count_sessions
  set status = 'in_progress',
      started_at = v_now,
      started_by = v_uid,
      snapshot_frozen_at = v_now,
      updated_at = v_now
  where id = p_session_id;

  select count(*)::int into v_items
  from public.cycle_count_expected_items where session_id = p_session_id;
  select count(*)::int, coalesce(sum(expected_quantity), 0) into v_lots, v_units
  from public.cycle_count_expected_lots where session_id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'in_progress',
    'snapshot_frozen_at', v_now,
    'expected_item_count', v_items,
    'expected_lot_count', v_lots,
    'expected_unit_count', v_units);
end
$$;

revoke all on function public.start_cycle_count(uuid, uuid) from public, anon;
grant execute on function public.start_cycle_count(uuid, uuid) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260729000200_cycle_count_core');
