-- Repair: creating a cycle count is idempotent.
--
-- `create_cycle_count` takes no idempotency key and performs a bare INSERT with
-- a freshly minted RV-CC public id. A retry after a lost response — the exact
-- case a "Start cycle count" button produces on a flaky connection — creates a
-- second draft session over the same shelf. Nothing in the client can fix that:
-- a key held in browser memory proves nothing to the database.
--
-- Every other governed multi-step operation in this repository already carries
-- a key (observations, resolution attempts, loss events). Session creation was
-- the gap.
--
-- The non-idempotent function is REVOKED rather than dropped, matching the
-- convention established for the deprecated observation overloads: the object
-- stays so a hosted database that already has it is unchanged, but no
-- application role can reach it, so there is no second door into session
-- creation.

alter table public.cycle_count_sessions
  add column if not exists idempotency_key uuid;

-- A key alone is not idempotency. Without the payload bound to it, reusing a
-- key with a DIFFERENT scope silently returns the first session, so an operator
-- who corrects the shelf and presses create again is handed a count over the
-- shelf they just corrected away from -- and believes it is the one they asked
-- for. The fingerprint makes the key mean "this exact request".
--
-- md5 of a canonical jsonb array, matching the convention already established
-- for observation idempotency in 20260730000300.
alter table public.cycle_count_sessions
  add column if not exists idempotency_fingerprint text;

-- Partial, so the column stays optional for rows created before this migration
-- and for any future internal caller that has no key to offer.
create unique index if not exists cycle_count_sessions_idempotency_key_unique
  on public.cycle_count_sessions (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- The replay-or-conflict decision, in one place so the ordinary path and the
-- lost-race path cannot answer it differently.
--
-- A matching fingerprint is the retry this mechanism exists for. A different
-- one is key reuse across a changed request: the original session is neither
-- returned nor modified, because handing back a count over a shelf the operator
-- has since corrected away from is worse than refusing. Reported as an outcome
-- rather than raised, matching the observation idempotency convention in
-- 20260730000300, so the caller can act on `code` without parsing a message.
create or replace function app.cycle_count_create_replay(
  p_existing public.cycle_count_sessions,
  p_fingerprint text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_existing.idempotency_fingerprint is distinct from p_fingerprint
      then jsonb_build_object(
        'outcome', 'idempotency_conflict',
        'code', 'IDEMPOTENCY_KEY_REUSED')
    else jsonb_build_object(
      'id', p_existing.id,
      'public_id', p_existing.public_id,
      'status', p_existing.status,
      'outcome', 'idempotent_replay')
  end
$$;

revoke all on function app.cycle_count_create_replay(public.cycle_count_sessions, text)
  from public, anon, authenticated;

create or replace function public.create_cycle_count_session(
  p_workspace_id uuid,
  p_root_location_code text,
  p_idempotency_key uuid,
  p_include_descendants boolean default false,
  p_subtype_filter public.inventory_subtype default null,
  p_vertical_filter public.inventory_vertical default null,
  p_blind_count boolean default true,
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
  v_existing public.cycle_count_sessions%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_descendants boolean := coalesce(p_include_descendants, false);
  v_blind boolean := coalesce(p_blind_count, true);
  v_fingerprint text;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);

  if p_idempotency_key is null then
    raise exception 'an idempotency key is required to create a cycle count'
      using errcode = '23514';
  end if;

  -- Resolved BEFORE the key is looked up, because the fingerprint must describe
  -- the location this request actually names, not the code string it used: two
  -- codes can resolve to one location, and a code can be re-pointed. The cost is
  -- that a replay whose location has since been retired raises instead of
  -- replaying -- it still creates nothing, so the no-double-create guarantee is
  -- untouched, and refusing is safer than returning a session whose scope can no
  -- longer be confirmed.
  --
  -- Resolves ACTIVE locations in THIS workspace only; a retired code or a
  -- neighbour's code simply does not resolve.
  v_location := app.intake_resolve_location(p_workspace_id, p_root_location_code);
  if v_location is null then
    raise exception 'location % is not an active location in this workspace',
      p_root_location_code using errcode = '23514';
  end if;

  -- Every dimension that changes what gets counted. Normalized first, so
  -- 'BIN-A ' and 'BIN-A', or null and false, are the same request rather than a
  -- spurious conflict.
  v_fingerprint := md5(jsonb_build_array(
    v_location,
    v_descendants,
    coalesce(p_subtype_filter::text, ''),
    coalesce(p_vertical_filter::text, ''),
    v_blind,
    coalesce(v_notes, ''))::text);

  select * into v_existing from public.cycle_count_sessions
   where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return app.cycle_count_create_replay(v_existing, v_fingerprint);
  end if;

  v_public := app.mint_governed_public_id('RV-CC');
  begin
    insert into public.cycle_count_sessions (
      workspace_id, public_id, status, scope_type, root_location_id,
      include_descendants, subtype_filter, vertical_filter, blind_count, notes,
      created_by, idempotency_key, idempotency_fingerprint)
    values (
      p_workspace_id, v_public, 'draft',
      (case when v_descendants then 'location_and_descendants' else 'single_location' end)
        ::public.cycle_count_scope_type,
      v_location, v_descendants, p_subtype_filter, p_vertical_filter,
      v_blind, v_notes, v_uid,
      p_idempotency_key, v_fingerprint)
    returning id into v_id;
  exception when unique_violation then
    -- Two presses raced past the read above. The index settles it; the loser
    -- returns the winner's session rather than an error the operator cannot
    -- act on.
    select * into v_existing from public.cycle_count_sessions
     where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
    -- Only if a row for THIS key really exists. The unique violation could have
    -- come from somewhere else entirely -- the public_id index, a constraint
    -- added later -- and swallowing that would report a replay that never
    -- happened and hide a real fault. Re-raise what we cannot explain.
    if v_existing.id is null then
      raise;
    end if;
    return app.cycle_count_create_replay(v_existing, v_fingerprint);
  end;

  return jsonb_build_object('id', v_id, 'public_id', v_public, 'status', 'draft',
                            'outcome', 'created');
end
$$;

revoke all on function public.create_cycle_count_session(
  uuid, text, uuid, boolean, public.inventory_subtype, public.inventory_vertical, boolean, text)
  from public, anon;
grant execute on function public.create_cycle_count_session(
  uuid, text, uuid, boolean, public.inventory_subtype, public.inventory_vertical, boolean, text)
  to authenticated;

-- The non-idempotent path is closed to every application role.
revoke all on function public.create_cycle_count(
  uuid, text, boolean, public.inventory_subtype, public.inventory_vertical, boolean, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The blind-count boundary belongs in the database
-- ---------------------------------------------------------------------------

-- start_cycle_count returned the expected item, lot and unit counts to every
-- caller. The Express route deleted those three fields, but the browser's cycle
-- count transport calls this function DIRECTLY through PostgREST, so a boundary
-- enforced only in one transport was not a boundary at all. Same signature, so
-- no new overload.

create or replace function public.start_cycle_count(
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

  -- A blind count must not be told what it is expected to find, and the
  -- boundary belongs HERE rather than in one transport: the Express route
  -- stripped these three fields, but the browser transport calls this function
  -- directly, so anything that only the route removed was still reaching the
  -- operator's machine.
  if v_s.blind_count then
    return jsonb_build_object(
      'session_id', p_session_id,
      'status', 'in_progress',
      'snapshot_frozen_at', v_now,
      'blind_count', true);
  end if;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'in_progress',
    'snapshot_frozen_at', v_now,
    'blind_count', false,
    'expected_item_count', v_items,
    'expected_lot_count', v_lots,
    'expected_unit_count', v_units);
end
$$;

insert into public.schema_migrations_log (migration_name)
values ('20260802000400_cycle_count_create_idempotency');
