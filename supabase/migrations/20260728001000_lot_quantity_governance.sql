-- Operational completion — governed quantity: adjustments, splits, merges.
--
-- Until now a lot's quantity was frozen at commit. That is safe but not
-- workable: stock gets damaged, miscounted, received in a second shipment, or
-- moved half a shelf at a time, and none of that had anywhere to go. The
-- answer is not to let the client write inventory_lots.quantity -- it cannot,
-- and must not, since `authenticated` holds SELECT only. It is to give every
-- legitimate quantity change its own governed function and its own permanent
-- record of who changed what, by how much, and why.
--
-- Three operations, three shapes:
--
--   adjust  one lot's quantity moves, for a stated reason
--   split   one lot becomes two, same identity, different locations
--   merge   several compatible lots become one
--
-- All three are append-only in their history and atomic in their effect. None
-- of them can invent or destroy stock silently: every one writes a row saying
-- what it did.

-- Why a quantity changed ------------------------------------------------------
-- A bounded list. "Other" exists because reality is wider than any list, and
-- it requires a note.
create type public.quantity_adjustment_reason as enum (
  'received',
  'recount',
  'damaged',
  'lost',
  'stolen',
  'donated',
  'internal_use',
  'returned_to_supplier',
  'sold_elsewhere',
  'lot_split',
  'lot_merge',
  'other'
);

-- Whether a lot is still stock ------------------------------------------------
-- A lot is never deleted. When it is absorbed by a merge or voided by a
-- correction it stops being available inventory but stays readable, because
-- the movement and cost history hanging off it has to remain true.
create type public.inventory_lot_state as enum (
  'active',
  'absorbed',
  'void'
);

alter table public.inventory_lots
  add column lot_state public.inventory_lot_state not null default 'active';

create index inventory_lots_state_idx
  on public.inventory_lots (workspace_id, lot_state);

-- quantity and lot_state must now be able to change -- through the governed
-- functions below and nothing else. `authenticated` has SELECT only on this
-- table, so removing them from the frozen list does not open a client path;
-- it opens a SECURITY DEFINER path. Everything that defines the lot's identity
-- stays frozen exactly as before.
drop trigger inventory_lots_identity_immutable on public.inventory_lots;
create trigger inventory_lots_identity_immutable
  before update on public.inventory_lots
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'sku_id', 'tracking_mode',
    'record_origin', 'mapping_version', 'fingerprint_inputs', 'created_by_process', 'created_at'
  );

-- The permanent record of every quantity change -------------------------------
create table public.inventory_quantity_adjustments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-ADJ-[A-Z0-9]{6,20}$'),
  lot_id uuid not null,
  previous_quantity integer not null check (previous_quantity >= 0),
  change_amount integer not null,
  resulting_quantity integer not null check (resulting_quantity >= 0),
  reason public.quantity_adjustment_reason not null,
  note text check (note is null or char_length(note) <= 500),
  source_reference text check (source_reference is null or char_length(source_reference) <= 200),
  adjusted_by uuid not null references auth.users (id) on delete restrict,
  adjusted_at timestamptz not null default now(),
  unique (workspace_id, public_id),
  -- The arithmetic is checked by the database, not just by the function that
  -- wrote it: a row that does not add up cannot exist.
  check (resulting_quantity = previous_quantity + change_amount),
  foreign key (lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict
);
create index inventory_quantity_adjustments_lot_idx
  on public.inventory_quantity_adjustments (lot_id, adjusted_at desc);
create index inventory_quantity_adjustments_workspace_idx
  on public.inventory_quantity_adjustments (workspace_id);

-- Where a lot came from and what became of it ---------------------------------
create table public.inventory_lot_lineage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-LIN-[A-Z0-9]{6,20}$'),
  event_kind text not null check (event_kind in ('split', 'merge')),
  parent_lot_id uuid not null,
  child_lot_id uuid not null,
  quantity integer not null check (quantity > 0),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, public_id),
  check (parent_lot_id <> child_lot_id),
  foreign key (parent_lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict,
  foreign key (child_lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict
);
create index inventory_lot_lineage_parent_idx on public.inventory_lot_lineage (parent_lot_id);
create index inventory_lot_lineage_child_idx on public.inventory_lot_lineage (child_lot_id);

-- Both histories are evidence: append-only for every caller, owner included.
create trigger inventory_quantity_adjustments_append_only
  before update or delete on public.inventory_quantity_adjustments
  for each row execute function app.forbid_update_delete();
create trigger inventory_quantity_adjustments_append_only_truncate
  before truncate on public.inventory_quantity_adjustments
  for each statement execute function app.forbid_update_delete();

create trigger inventory_lot_lineage_append_only
  before update or delete on public.inventory_lot_lineage
  for each row execute function app.forbid_update_delete();
create trigger inventory_lot_lineage_append_only_truncate
  before truncate on public.inventory_lot_lineage
  for each statement execute function app.forbid_update_delete();

alter table public.inventory_quantity_adjustments enable row level security;
alter table public.inventory_lot_lineage enable row level security;

revoke all on table public.inventory_quantity_adjustments, public.inventory_lot_lineage
  from public, anon, authenticated;
grant select on table public.inventory_quantity_adjustments, public.inventory_lot_lineage
  to authenticated;

-- Any member may READ the history. Writing goes through the governed functions,
-- which require owner/operator.
create policy inventory_quantity_adjustments_select on public.inventory_quantity_adjustments
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy inventory_lot_lineage_select on public.inventory_lot_lineage
  for select to authenticated using (app.member_role(workspace_id) is not null);

-- Adjust ----------------------------------------------------------------------
-- p_expected_quantity is optimistic concurrency, not decoration. Two operators
-- counting the same shelf must not silently overwrite each other: if the lot
-- moved since the caller read it, this raises rather than applying a delta to
-- a number the operator never saw.
create function public.adjust_lot_quantity(
  p_workspace_id uuid,
  p_lot_id uuid,
  p_change integer,
  p_reason public.quantity_adjustment_reason,
  p_expected_quantity integer default null,
  p_note text default null,
  p_source_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_lot public.inventory_lots%rowtype;
  v_resulting integer;
  v_public text;
  v_id uuid;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  if p_change = 0 then
    raise exception 'an adjustment of zero changes nothing' using errcode = '23514';
  end if;
  if p_reason = 'other' and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'an adjustment reason of "other" requires a note' using errcode = '23514';
  end if;

  -- FOR UPDATE: the read, the arithmetic and the write are one operation.
  select * into v_lot from public.inventory_lots
  where id = p_lot_id and workspace_id = p_workspace_id
  for update;
  if v_lot.id is null then
    raise exception 'lot not found in this workspace' using errcode = '23514';
  end if;
  if v_lot.tracking_mode = 'serialized' then
    raise exception 'this lot holds individually tracked units; its quantity is the number of units'
      using errcode = '23514';
  end if;
  if v_lot.lot_state <> 'active' then
    raise exception 'this lot is no longer active inventory' using errcode = '23514';
  end if;

  if p_expected_quantity is not null and p_expected_quantity <> v_lot.quantity then
    raise exception 'this lot now holds %, not % — reload and try again',
      v_lot.quantity, p_expected_quantity using errcode = '40001';
  end if;

  v_resulting := v_lot.quantity + p_change;
  if v_resulting < 0 then
    raise exception 'this lot holds %; removing % would leave %',
      v_lot.quantity, abs(p_change), v_resulting using errcode = '23514';
  end if;

  update public.inventory_lots
  set quantity = v_resulting, updated_at = now()
  where id = p_lot_id;

  v_public := app.mint_governed_public_id('RV-ADJ');
  insert into public.inventory_quantity_adjustments (
    workspace_id, public_id, lot_id, previous_quantity, change_amount,
    resulting_quantity, reason, note, source_reference, adjusted_by)
  values (p_workspace_id, v_public, p_lot_id, v_lot.quantity, p_change,
    v_resulting, p_reason, nullif(btrim(coalesce(p_note, '')), ''),
    nullif(btrim(coalesce(p_source_reference, '')), ''), v_uid)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'public_id', v_public, 'lot_id', p_lot_id,
    'previous_quantity', v_lot.quantity, 'change_amount', p_change,
    'resulting_quantity', v_resulting);
end
$$;

revoke all on function public.adjust_lot_quantity(
  uuid, uuid, integer, public.quantity_adjustment_reason, integer, text, text) from public, anon;
grant execute on function public.adjust_lot_quantity(
  uuid, uuid, integer, public.quantity_adjustment_reason, integer, text, text) to authenticated;

-- Recount ---------------------------------------------------------------------
-- Counting a shelf produces a number, not a delta. Making the operator compute
-- the difference is how off-by-one errors get written into inventory.
create function public.recount_lot_quantity(
  p_workspace_id uuid,
  p_lot_id uuid,
  p_counted_quantity integer,
  p_expected_quantity integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.inventory_lots%rowtype;
begin
  if p_counted_quantity < 0 then
    raise exception 'a counted quantity cannot be negative' using errcode = '23514';
  end if;

  perform app.require_inventory_writer(p_workspace_id);

  select * into v_lot from public.inventory_lots
  where id = p_lot_id and workspace_id = p_workspace_id
  for update;
  if v_lot.id is null then
    raise exception 'lot not found in this workspace' using errcode = '23514';
  end if;
  if p_counted_quantity = v_lot.quantity then
    return jsonb_build_object('lot_id', p_lot_id, 'resulting_quantity', v_lot.quantity,
      'change_amount', 0, 'unchanged', true);
  end if;

  return public.adjust_lot_quantity(
    p_workspace_id, p_lot_id, p_counted_quantity - v_lot.quantity, 'recount',
    p_expected_quantity, p_note, null);
end
$$;

revoke all on function public.recount_lot_quantity(uuid, uuid, integer, integer, text)
  from public, anon;
grant execute on function public.recount_lot_quantity(uuid, uuid, integer, integer, text)
  to authenticated;

-- Split -----------------------------------------------------------------------
-- The safe way to move part of a quantity lot. The child is the SAME product
-- and the SAME SKU -- splitting for a location does not create a new kind of
-- thing, and inventing a product here would fracture identity for no reason.
create function public.split_inventory_lot(
  p_workspace_id uuid,
  p_lot_id uuid,
  p_quantity integer,
  p_to_location_code text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_lot public.inventory_lots%rowtype;
  v_to uuid;
  v_child_id uuid;
  v_child_public text;
  v_lineage_public text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_lot from public.inventory_lots
  where id = p_lot_id and workspace_id = p_workspace_id
  for update;
  if v_lot.id is null then
    raise exception 'lot not found in this workspace' using errcode = '23514';
  end if;
  if v_lot.tracking_mode = 'serialized' then
    raise exception 'this lot holds individually tracked units; move them one at a time'
      using errcode = '23514';
  end if;
  if v_lot.lot_state <> 'active' then
    raise exception 'this lot is no longer active inventory' using errcode = '23514';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'choose how many units to split off' using errcode = '23514';
  end if;
  if p_quantity > v_lot.quantity then
    raise exception 'this lot holds %, so % cannot be split off', v_lot.quantity, p_quantity
      using errcode = '23514';
  end if;
  if p_quantity = v_lot.quantity then
    -- Splitting everything is not a split; it leaves an empty parent and a
    -- lineage entry describing a move that Move Entire Lot records properly.
    raise exception 'that is the whole lot — use Move Entire Lot instead'
      using errcode = '23514';
  end if;

  v_to := app.intake_resolve_location(p_workspace_id, p_to_location_code);
  if v_to is null then
    raise exception 'destination location % is not an active location in this workspace',
      p_to_location_code using errcode = '23514';
  end if;

  -- Source shrinks, and says so in its own quantity history.
  perform public.adjust_lot_quantity(
    p_workspace_id, p_lot_id, -p_quantity, 'lot_split', v_lot.quantity,
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Split to ' || p_to_location_code), null);

  -- inventory_lots.public_id is digit-suffixed (RV-XXX-0000000001), unlike the
  -- hex ids the generic minter produces, so the child uses the same governed
  -- lot-id minter intake does.
  v_child_public := app.mint_intake_lot_public_id();
  insert into public.inventory_lots (
    workspace_id, public_id, sku_id, tracking_mode, quantity, location_id,
    record_origin, mapping_version, fingerprint_inputs, created_by_process)
  values (p_workspace_id, v_child_public, v_lot.sku_id, v_lot.tracking_mode, p_quantity, v_to,
    v_lot.record_origin, v_lot.mapping_version, v_lot.fingerprint_inputs, 'inventory.split')
  returning id into v_child_id;

  v_lineage_public := app.mint_governed_public_id('RV-LIN');
  insert into public.inventory_lot_lineage (
    workspace_id, public_id, event_kind, parent_lot_id, child_lot_id, quantity, note, created_by)
  values (p_workspace_id, v_lineage_public, 'split', p_lot_id, v_child_id, p_quantity,
    nullif(btrim(coalesce(p_note, '')), ''), v_uid);

  return jsonb_build_object(
    'source_lot_id', p_lot_id,
    'source_quantity', v_lot.quantity - p_quantity,
    'child_lot_id', v_child_id,
    'child_public_id', v_child_public,
    'child_quantity', p_quantity,
    'to_location_code', p_to_location_code);
end
$$;

revoke all on function public.split_inventory_lot(uuid, uuid, integer, text, text)
  from public, anon;
grant execute on function public.split_inventory_lot(uuid, uuid, integer, text, text)
  to authenticated;

-- Compatibility ----------------------------------------------------------------
-- Two lots may merge only if they are genuinely the same thing in the same
-- place. Same display name is NOT enough: two products can share a name and
-- differ in everything that matters, which is exactly what the SKU fingerprint
-- exists to distinguish.
create function public.lot_merge_compatibility(
  p_workspace_id uuid,
  p_survivor_lot_id uuid,
  p_absorbed_lot_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a public.inventory_lots%rowtype;
  v_b public.inventory_lots%rowtype;
  v_reasons text[] := '{}';
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select * into v_a from public.inventory_lots
  where id = p_survivor_lot_id and workspace_id = p_workspace_id;
  select * into v_b from public.inventory_lots
  where id = p_absorbed_lot_id and workspace_id = p_workspace_id;

  if v_a.id is null or v_b.id is null then
    return jsonb_build_object('compatible', false,
      'reasons', to_jsonb(array['One of these lots is not in this workspace.']));
  end if;
  if v_a.id = v_b.id then
    return jsonb_build_object('compatible', false,
      'reasons', to_jsonb(array['A lot cannot merge with itself.']));
  end if;
  if v_a.sku_id <> v_b.sku_id then
    v_reasons := array_append(v_reasons, 'These are different SKUs — same name is not the same thing.');
  end if;
  if v_a.tracking_mode <> v_b.tracking_mode then
    v_reasons := array_append(v_reasons, 'These lots are tracked differently.');
  end if;
  if v_a.tracking_mode = 'serialized' or v_b.tracking_mode = 'serialized' then
    v_reasons := array_append(v_reasons, 'Individually tracked units are not merged.');
  end if;
  if v_a.location_id is distinct from v_b.location_id then
    v_reasons := array_append(v_reasons, 'These lots are in different locations.');
  end if;
  if v_a.location_id is null then
    v_reasons := array_append(v_reasons, 'Give these lots a location before merging them.');
  end if;
  if v_a.lot_state <> 'active' or v_b.lot_state <> 'active' then
    v_reasons := array_append(v_reasons, 'One of these lots is no longer active inventory.');
  end if;

  return jsonb_build_object(
    'compatible', cardinality(v_reasons) = 0,
    'reasons', to_jsonb(v_reasons),
    'combined_quantity', v_a.quantity + v_b.quantity);
end
$$;

revoke all on function public.lot_merge_compatibility(uuid, uuid, uuid) from public, anon;
grant execute on function public.lot_merge_compatibility(uuid, uuid, uuid) to authenticated;

-- Merge ------------------------------------------------------------------------
-- One transaction, because unlike a bulk move these lots are not unrelated:
-- quantity leaving one and arriving in another must not be observable as
-- anything other than a single event.
create function public.merge_inventory_lots(
  p_workspace_id uuid,
  p_survivor_lot_id uuid,
  p_absorbed_lot_ids uuid[],
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_survivor public.inventory_lots%rowtype;
  v_absorbed public.inventory_lots%rowtype;
  v_id uuid;
  v_check jsonb;
  v_moved integer := 0;
  v_public text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  if p_absorbed_lot_ids is null or cardinality(p_absorbed_lot_ids) = 0 then
    raise exception 'choose at least one lot to merge in' using errcode = '23514';
  end if;

  -- Lock in a deterministic order so two concurrent merges over the same lots
  -- cannot deadlock each other.
  perform 1 from public.inventory_lots
  where workspace_id = p_workspace_id
    and id = any(array_append(p_absorbed_lot_ids, p_survivor_lot_id))
  order by id
  for update;

  select * into v_survivor from public.inventory_lots
  where id = p_survivor_lot_id and workspace_id = p_workspace_id;
  if v_survivor.id is null then
    raise exception 'the surviving lot is not in this workspace' using errcode = '23514';
  end if;

  foreach v_id in array p_absorbed_lot_ids loop
    v_check := public.lot_merge_compatibility(p_workspace_id, p_survivor_lot_id, v_id);
    if not (v_check->>'compatible')::boolean then
      raise exception 'these lots cannot be merged: %',
        array_to_string(array(select jsonb_array_elements_text(v_check->'reasons')), ' ')
        using errcode = '23514';
    end if;

    select * into v_absorbed from public.inventory_lots
    where id = v_id and workspace_id = p_workspace_id;

    if v_absorbed.quantity > 0 then
      perform public.adjust_lot_quantity(
        p_workspace_id, v_id, -v_absorbed.quantity, 'lot_merge', v_absorbed.quantity,
        coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                 'Merged into ' || v_survivor.public_id), null);
      perform public.adjust_lot_quantity(
        p_workspace_id, p_survivor_lot_id, v_absorbed.quantity, 'lot_merge', null,
        coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                 'Absorbed ' || v_absorbed.public_id), null);
      v_moved := v_moved + v_absorbed.quantity;
    end if;

    -- Absorbed, not deleted: its movement, adjustment and cost history stays
    -- true and readable, it simply stops being available stock.
    update public.inventory_lots
    set lot_state = 'absorbed', updated_at = now()
    where id = v_id;

    v_public := app.mint_governed_public_id('RV-LIN');
    insert into public.inventory_lot_lineage (
      workspace_id, public_id, event_kind, parent_lot_id, child_lot_id, quantity, note, created_by)
    values (p_workspace_id, v_public, 'merge', v_id, p_survivor_lot_id,
      greatest(v_absorbed.quantity, 1), nullif(btrim(coalesce(p_note, '')), ''), v_uid);
  end loop;

  select * into v_survivor from public.inventory_lots where id = p_survivor_lot_id;
  return jsonb_build_object(
    'survivor_lot_id', p_survivor_lot_id,
    'survivor_public_id', v_survivor.public_id,
    'survivor_quantity', v_survivor.quantity,
    'absorbed_count', cardinality(p_absorbed_lot_ids),
    'quantity_moved', v_moved);
end
$$;

revoke all on function public.merge_inventory_lots(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.merge_inventory_lots(uuid, uuid, uuid[], text) to authenticated;

-- Moving stock that is not there ------------------------------------------------
-- An empty or absorbed lot is not available inventory and cannot be moved as
-- though it were.
create or replace function public.move_inventory_lot(
  p_workspace_id uuid,
  p_lot_id uuid,
  p_to_location_code text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_lot public.inventory_lots%rowtype;
  v_to uuid;
  v_from uuid;
  v_public text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_lot from public.inventory_lots
  where id = p_lot_id and workspace_id = p_workspace_id
  for update;
  if v_lot.id is null then
    raise exception 'lot not found in this workspace' using errcode = '23514';
  end if;
  if v_lot.tracking_mode = 'serialized' then
    raise exception 'this lot holds individually tracked units; move them one at a time'
      using errcode = '23514';
  end if;
  if v_lot.lot_state <> 'active' then
    raise exception 'this lot is no longer active inventory' using errcode = '23514';
  end if;
  if v_lot.quantity = 0 then
    raise exception 'this lot holds nothing to move' using errcode = '23514';
  end if;

  v_to := app.intake_resolve_location(p_workspace_id, p_to_location_code);
  if v_to is null then
    raise exception 'destination location % is not an active location in this workspace',
      p_to_location_code using errcode = '23514';
  end if;

  v_from := v_lot.location_id;
  if v_from is not distinct from v_to then
    raise exception 'this lot is already in %', p_to_location_code using errcode = '23514';
  end if;

  v_public := app.mint_governed_public_id('RV-MOVE');
  insert into public.inventory_movements (
    workspace_id, public_id, subject_kind, lot_id, from_location_id, to_location_id, note, moved_by)
  values (p_workspace_id, v_public, 'lot', p_lot_id, v_from, v_to,
    nullif(btrim(coalesce(p_note, '')), ''), v_uid);

  update public.inventory_lots
  set location_id = v_to, updated_at = now()
  where id = p_lot_id;

  return jsonb_build_object('lot_id', p_lot_id, 'movement_public_id', v_public,
    'from_location_id', v_from, 'to_location_id', v_to);
end
$$;

revoke all on function public.move_inventory_lot(uuid, uuid, text, text) from public, anon;
grant execute on function public.move_inventory_lot(uuid, uuid, text, text) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260728001000_lot_quantity_governance');
