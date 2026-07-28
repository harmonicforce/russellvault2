-- Multi-category intake — migration 2: item-level location and governed
-- movement with immutable history.
--
-- Today a serialized item has no location of its own: it inherits its lot's.
-- That cannot represent "move this one slab to another shelf" without moving
-- every sibling in the lot, so this adds inventory_items.location_id.
--
-- inventory_items and inventory_lots are currently FULLY append-only, which
-- would make any move impossible. Rather than dropping that protection, this
-- narrows it to exactly the shape storage_locations already uses: DELETE and
-- TRUNCATE stay forbidden, every identity column stays frozen, and only
-- location_id / updated_at may change. Governed public ids, the SKU
-- fingerprint, the opaque scan_sku, certificate and serial all remain
-- immutable.
--
-- Movement itself is recorded in an append-only event table, so the current
-- location is a projection of a history that can never be rewritten.

-- Item-level location -------------------------------------------------------
alter table public.inventory_items
  add column location_id uuid references public.storage_locations (id) on delete restrict;

create index inventory_items_location_idx on public.inventory_items (workspace_id, location_id);

-- Existing serialized items adopt their lot's location, so nothing is left
-- location-less by the introduction of this column. (No rows exist yet on
-- this project; the statement is written to be correct regardless.)
update public.inventory_items i
set location_id = l.location_id
from public.inventory_lots l
where l.id = i.lot_id
  and i.location_id is null
  and l.location_id is not null;

-- Narrow the append-only protection to a governed mutation surface ---------
drop trigger inventory_items_append_only on public.inventory_items;
create trigger inventory_items_no_delete
  before delete on public.inventory_items
  for each row execute function app.forbid_update_delete();
create trigger inventory_items_identity_immutable
  before update on public.inventory_items
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'lot_id', 'sku_id', 'scan_sku', 'grading_company',
    'certificate_number', 'serial_number', 'created_by_process', 'created_at'
  );

drop trigger inventory_lots_append_only on public.inventory_lots;
create trigger inventory_lots_no_delete
  before delete on public.inventory_lots
  for each row execute function app.forbid_update_delete();
create trigger inventory_lots_identity_immutable
  before update on public.inventory_lots
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'sku_id', 'tracking_mode', 'quantity',
    'record_origin', 'mapping_version', 'fingerprint_inputs', 'created_by_process', 'created_at'
  );

-- Immutable movement history ------------------------------------------------
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null unique check (public_id ~ '^RV-MOVE-[A-Z0-9]{6,20}$'),
  subject_kind text not null check (subject_kind in ('item', 'lot')),
  item_id uuid references public.inventory_items (id) on delete restrict,
  lot_id uuid references public.inventory_lots (id) on delete restrict,
  from_location_id uuid references public.storage_locations (id) on delete restrict,
  to_location_id uuid not null references public.storage_locations (id) on delete restrict,
  note text check (note is null or char_length(note) <= 500),
  moved_by uuid not null references auth.users (id),
  moved_at timestamptz not null default now(),
  -- Exactly one subject: an event moves an item or a lot, never both/neither.
  constraint inventory_movements_one_subject check (
    (subject_kind = 'item' and item_id is not null and lot_id is null)
    or (subject_kind = 'lot' and lot_id is not null and item_id is null)
  ),
  -- A move must actually change something.
  constraint inventory_movements_actually_moves check (
    from_location_id is distinct from to_location_id
  )
);

create index inventory_movements_item_idx on public.inventory_movements (workspace_id, item_id, moved_at desc);
create index inventory_movements_lot_idx on public.inventory_movements (workspace_id, lot_id, moved_at desc);
create index inventory_movements_recent_idx on public.inventory_movements (workspace_id, moved_at desc);

create trigger inventory_movements_append_only
  before update or delete on public.inventory_movements
  for each row execute function app.forbid_update_delete();
create trigger inventory_movements_append_only_truncate
  before truncate on public.inventory_movements
  for each statement execute function app.forbid_update_delete();

alter table public.inventory_movements enable row level security;
revoke all on table public.inventory_movements from public, anon, authenticated;
grant select on table public.inventory_movements to authenticated;
create policy inventory_movements_select on public.inventory_movements
  for select to authenticated using (app.member_role(workspace_id) is not null);

-- Newly minted serialized items inherit their lot's location ---------------
create or replace function public.mint_serialized_item(
  p_workspace_id uuid,
  p_lot_id uuid,
  p_grading_company text default null,
  p_certificate_number text default null,
  p_serial_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_lot public.inventory_lots%rowtype;
  v_public text;
  v_scan text;
  v_id uuid;
  v_attempt integer := 0;
  v_child_count integer;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  select * into v_lot from public.inventory_lots
  where id = p_lot_id and workspace_id = p_workspace_id
  for update;
  if v_lot.id is null then
    raise exception 'lot not found in this workspace' using errcode = '23514';
  end if;
  if v_lot.tracking_mode <> 'serialized' then
    raise exception 'only a serialized lot may hold serialized items' using errcode = '23514';
  end if;

  if p_certificate_number is not null and (p_grading_company is null or btrim(p_grading_company) = '') then
    raise exception 'a certificate number requires a grading company' using errcode = '23514';
  end if;

  select count(*)::integer into v_child_count
  from public.inventory_items where lot_id = p_lot_id;
  if v_child_count >= v_lot.quantity then
    raise exception 'serialized lot % is at capacity (% of % units)',
      v_lot.public_id, v_child_count, v_lot.quantity using errcode = '23514';
  end if;

  v_public := app.mint_governed_public_id('RV-ITEM');
  loop
    v_attempt := v_attempt + 1;
    v_scan := app.gen_scan_sku();
    begin
      insert into public.inventory_items (
        workspace_id, public_id, lot_id, sku_id, scan_sku, grading_company,
        certificate_number, serial_number, location_id, created_by_process)
      values (p_workspace_id, v_public, p_lot_id, v_lot.sku_id, v_scan, p_grading_company,
        p_certificate_number, p_serial_number, v_lot.location_id, 'inventory.identity')
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- Distinguish a scan-code collision (retry) from a certificate/serial
      -- duplicate, which is a real identity conflict the caller must see.
      if exists (
        select 1 from public.inventory_items
        where workspace_id = p_workspace_id
          and ((p_certificate_number is not null
                and grading_company = p_grading_company
                and certificate_number = p_certificate_number)
            or (p_serial_number is not null and serial_number = p_serial_number))
      ) then
        raise;
      end if;
      if v_attempt >= 8 then
        raise exception 'could not mint a unique scan code after % attempts', v_attempt
          using errcode = '23505';
      end if;
    end;
  end loop;

  return jsonb_build_object('id', v_id, 'public_id', v_public, 'scan_sku', v_scan);
end
$$;

revoke all on function public.mint_serialized_item(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.mint_serialized_item(uuid, uuid, text, text, text) to authenticated;

-- Governed movement ---------------------------------------------------------
-- Resolves the destination by CODE (never an id the operator could type),
-- locks the subject row, refuses retired/unknown/same-location destinations,
-- writes the history event and the new current location in one transaction.
create function public.move_inventory_item(
  p_workspace_id uuid,
  p_item_id uuid,
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
  v_item public.inventory_items%rowtype;
  v_to uuid;
  v_from uuid;
  v_public text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_item from public.inventory_items
  where id = p_item_id and workspace_id = p_workspace_id
  for update;
  if v_item.id is null then
    raise exception 'item not found in this workspace' using errcode = '23514';
  end if;

  -- Resolves only ACTIVE locations in THIS workspace: a retired destination
  -- or another workspace's code simply does not resolve.
  v_to := app.intake_resolve_location(p_workspace_id, p_to_location_code);
  if v_to is null then
    raise exception 'destination location % is not an active location in this workspace',
      p_to_location_code using errcode = '23514';
  end if;

  v_from := v_item.location_id;
  if v_from is not distinct from v_to then
    raise exception 'this item is already in %', p_to_location_code using errcode = '23514';
  end if;

  v_public := app.mint_governed_public_id('RV-MOVE');
  insert into public.inventory_movements (
    workspace_id, public_id, subject_kind, item_id, from_location_id, to_location_id, note, moved_by)
  values (p_workspace_id, v_public, 'item', p_item_id, v_from, v_to, nullif(btrim(coalesce(p_note, '')), ''), v_uid);

  update public.inventory_items
  set location_id = v_to, updated_at = now()
  where id = p_item_id;

  return jsonb_build_object(
    'moved', true, 'movement_public_id', v_public, 'item_id', p_item_id,
    'from_location_id', v_from, 'to_location_id', v_to);
end
$$;

revoke all on function public.move_inventory_item(uuid, uuid, text, text) from public, anon;
grant execute on function public.move_inventory_item(uuid, uuid, text, text) to authenticated;

-- Whole-lot movement for quantity-tracked inventory. Deliberately refuses
-- serialized lots: those hold individually tracked units, and moving the lot
-- record would silently relocate every sibling unit. Serialized inventory
-- moves one item at a time through move_inventory_item.
create function public.move_inventory_lot(
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
  values (p_workspace_id, v_public, 'lot', p_lot_id, v_from, v_to, nullif(btrim(coalesce(p_note, '')), ''), v_uid);

  update public.inventory_lots
  set location_id = v_to, updated_at = now()
  where id = p_lot_id;

  return jsonb_build_object(
    'moved', true, 'movement_public_id', v_public, 'lot_id', p_lot_id,
    'from_location_id', v_from, 'to_location_id', v_to);
end
$$;

revoke all on function public.move_inventory_lot(uuid, uuid, text, text) from public, anon;
grant execute on function public.move_inventory_lot(uuid, uuid, text, text) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260728000300_item_location_and_movement');
