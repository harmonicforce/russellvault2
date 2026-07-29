-- Cycle count — resolving discrepancies, and closing the session.
--
-- This is the only place a count touches inventory, and it never does so
-- directly: every action delegates to the governed operation that already owns
-- that change -- move_inventory_item, adjust_lot_quantity, and a new
-- record_inventory_item_loss for shrinkage. Cycle count orchestrates and links;
-- it does not grow a parallel mutation path.
--
-- Nothing resolves itself. There is no "accept all variances": each discrepancy
-- gets an explicit action, an actor, a reason where one is owed, and a row
-- pointing at whatever governed operation it produced.

create type public.cycle_count_resolution_action as enum (
  'recount_requested',
  'item_moved_to_counted_location',
  'item_loss_recorded',
  'lot_quantity_adjusted',
  'observation_mistaken',
  'confirmed_system_location',
  'routed_to_intake',
  'explained_by_post_snapshot_activity',
  'deferred'
);

create table public.cycle_count_resolutions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  discrepancy_id uuid not null,
  action public.cycle_count_resolution_action not null,
  note text check (note is null or char_length(note) <= 1000),
  -- Whatever governed operation this produced, so the chain stays walkable.
  movement_id uuid references public.inventory_movements (id) on delete restrict,
  adjustment_id uuid references public.inventory_quantity_adjustments (id) on delete restrict,
  affected_item_id uuid,
  affected_lot_id uuid,
  expected_value integer,
  observed_value integer,
  succeeded boolean not null,
  failure_detail text check (failure_detail is null or char_length(failure_detail) <= 2000),
  resolved_by uuid not null references auth.users (id) on delete restrict,
  resolved_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint cycle_count_resolution_failure_detail check (
    succeeded or nullif(btrim(coalesce(failure_detail, '')), '') is not null
  ),
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions (id, workspace_id) on delete restrict,
  foreign key (discrepancy_id, workspace_id)
    references public.cycle_count_discrepancies (id, workspace_id) on delete restrict
);
-- One SUCCESSFUL resolution per discrepancy. Failures are kept and visible --
-- a resolution that errored is something a reviewer must see, not something to
-- retry silently over the top of.
create unique index cycle_count_resolution_once
  on public.cycle_count_resolutions (discrepancy_id)
  where succeeded;
create index cycle_count_resolutions_session_idx
  on public.cycle_count_resolutions (session_id, resolved_at desc);

create trigger cycle_count_resolutions_append_only
  before update or delete on public.cycle_count_resolutions
  for each row execute function app.forbid_update_delete();
create trigger cycle_count_resolutions_no_truncate
  before truncate on public.cycle_count_resolutions
  for each statement execute function app.forbid_update_delete();

alter table public.cycle_count_resolutions enable row level security;
revoke all on table public.cycle_count_resolutions from public, anon, authenticated;
grant select on table public.cycle_count_resolutions to authenticated;
create policy cycle_count_resolutions_select on public.cycle_count_resolutions
  for select to authenticated using (app.member_role(workspace_id) is not null);

-- Shrinkage -------------------------------------------------------------------
-- A serialized unit that is genuinely gone. The record survives with all its
-- identifiers and history; it simply stops being physical stock, so it can
-- never be counted, moved or sold again. Deleting it would erase the evidence
-- that it ever existed, which is exactly what an audit needs.
create function public.record_inventory_item_loss(
  p_workspace_id uuid,
  p_item_id uuid,
  p_reason text,
  p_session_id uuid default null,
  p_discrepancy_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role public.workspace_role;
  v_item public.inventory_items%rowtype;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  v_role := app.member_role(p_workspace_id);
  if v_role not in ('owner', 'operator') then
    raise exception 'only an owner or operator can write off a unit' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why this unit is being written off' using errcode = '23514';
  end if;

  select * into v_item from public.inventory_items
  where id = p_item_id and workspace_id = p_workspace_id
  for update;
  if v_item.id is null then
    raise exception 'that unit is not in this workspace' using errcode = '23514';
  end if;
  if v_item.item_state <> 'active' then
    raise exception 'that unit is already %', v_item.item_state using errcode = '23514';
  end if;

  update public.inventory_items
  set item_state = 'lost',
      void_reason = btrim(p_reason),
      updated_at = now()
  where id = p_item_id;

  return jsonb_build_object(
    'item_id', p_item_id,
    'item_public_id', v_item.public_id,
    'item_state', 'lost',
    'session_id', p_session_id,
    'discrepancy_id', p_discrepancy_id);
end
$$;

revoke all on function public.record_inventory_item_loss(uuid, uuid, text, uuid, uuid)
  from public, anon;
grant execute on function public.record_inventory_item_loss(uuid, uuid, text, uuid, uuid)
  to authenticated;

-- Recount ------------------------------------------------------------------------
-- Sends a discrepancy back to the floor. The original observation is untouched:
-- a recount is a second opinion, not a correction of the first.
create function public.request_cycle_count_recount(
  p_workspace_id uuid,
  p_discrepancy_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_d public.cycle_count_discrepancies%rowtype;
  v_status public.cycle_count_status;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);

  select * into v_d from public.cycle_count_discrepancies
  where id = p_discrepancy_id and workspace_id = p_workspace_id
  for update;
  if v_d.id is null then
    raise exception 'discrepancy not found in this workspace' using errcode = '23514';
  end if;
  if v_d.status <> 'open' then
    raise exception 'this discrepancy is % and cannot be sent for recount', v_d.status
      using errcode = '23514';
  end if;

  select status into v_status from public.cycle_count_sessions where id = v_d.session_id;
  if v_status <> 'review' then
    raise exception 'recounts are requested from review (this count is %)', v_status
      using errcode = '23514';
  end if;

  update public.cycle_count_discrepancies
  set status = 'recount_requested', recount_requested_at = now(), recount_requested_by = v_uid
  where id = p_discrepancy_id;

  -- Recorded as not-yet-succeeded on purpose: asking for a recount is a step
  -- in resolving the discrepancy, not the resolution. The partial unique index
  -- only covers succeeded rows, so this never blocks the real resolution later.
  insert into public.cycle_count_resolutions (
    session_id, workspace_id, discrepancy_id, action, note,
    affected_item_id, affected_lot_id, succeeded, failure_detail, resolved_by)
  values (v_d.session_id, p_workspace_id, p_discrepancy_id, 'recount_requested',
    nullif(btrim(coalesce(p_note, '')), ''), v_d.item_id, v_d.lot_id, false,
    'sent for recount; awaiting a second observation', v_uid);

  -- The session goes back to counting so a fresh round can be recorded.
  update public.cycle_count_sessions
  set status = 'in_progress', updated_at = now()
  where id = v_d.session_id;

  return jsonb_build_object('outcome', 'recount_requested', 'discrepancy_id', p_discrepancy_id);
end
$$;

revoke all on function public.request_cycle_count_recount(uuid, uuid, text) from public, anon;
grant execute on function public.request_cycle_count_recount(uuid, uuid, text) to authenticated;

-- Resolve --------------------------------------------------------------------------
-- One entry point, dispatching to the governed operation each action needs. A
-- failure is RECORDED and re-raised: the reviewer sees the attempt, and the
-- discrepancy stays open rather than quietly appearing handled.
create function public.resolve_cycle_count_discrepancy(
  p_workspace_id uuid,
  p_discrepancy_id uuid,
  p_action public.cycle_count_resolution_action,
  p_note text default null,
  p_to_location_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_d public.cycle_count_discrepancies%rowtype;
  v_status public.cycle_count_status;
  v_movement uuid;
  v_adjustment uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_delta integer;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);

  select * into v_d from public.cycle_count_discrepancies
  where id = p_discrepancy_id and workspace_id = p_workspace_id
  for update;
  if v_d.id is null then
    raise exception 'discrepancy not found in this workspace' using errcode = '23514';
  end if;

  -- Idempotency: a second attempt reports the existing resolution instead of
  -- applying the inventory change twice.
  if v_d.status = 'resolved' then
    return jsonb_build_object('outcome', 'already_resolved', 'discrepancy_id', p_discrepancy_id);
  end if;

  select status into v_status from public.cycle_count_sessions where id = v_d.session_id;
  if v_status not in ('review', 'in_progress') then
    raise exception 'this count is % and its discrepancies can no longer be resolved', v_status
      using errcode = '23514';
  end if;

  if p_action = 'deferred' and v_note is null then
    raise exception 'a deferral needs a reason' using errcode = '23514';
  end if;
  if p_action = 'recount_requested' then
    raise exception 'use request_cycle_count_recount for recounts' using errcode = '23514';
  end if;

  if p_action = 'item_moved_to_counted_location' then
    if v_d.item_id is null then
      raise exception 'this discrepancy has no unit to move' using errcode = '23514';
    end if;
    perform public.move_inventory_item(
      p_workspace_id, v_d.item_id,
      coalesce(p_to_location_code,
        (select l.location_code from public.storage_locations l
          where l.id = v_d.observed_location_id)),
      coalesce(v_note, 'Relocated by cycle count'));
    select id into v_movement from public.inventory_movements
    where item_id = v_d.item_id and workspace_id = p_workspace_id
    order by moved_at desc limit 1;

  elsif p_action = 'item_loss_recorded' then
    if v_d.item_id is null then
      raise exception 'this discrepancy has no unit to write off' using errcode = '23514';
    end if;
    perform public.record_inventory_item_loss(
      p_workspace_id, v_d.item_id,
      coalesce(v_note, 'Not found during cycle count'), v_d.session_id, p_discrepancy_id);

  elsif p_action = 'lot_quantity_adjusted' then
    if v_d.lot_id is null or v_d.observed_quantity is null then
      raise exception 'this discrepancy has no counted quantity to apply' using errcode = '23514';
    end if;
    -- The adjustment is expressed as the delta the count actually observed,
    -- against the quantity the lot holds right now -- so a lot changed since
    -- the snapshot raises a stale-quantity conflict instead of overwriting it.
    select v_d.observed_quantity - l.quantity into v_delta
    from public.inventory_lots l where l.id = v_d.lot_id;
    if v_delta = 0 then
      raise exception 'this lot already holds the counted quantity' using errcode = '23514';
    end if;
    perform public.adjust_lot_quantity(
      p_workspace_id, v_d.lot_id, v_delta, 'recount',
      (select quantity from public.inventory_lots where id = v_d.lot_id),
      coalesce(v_note, 'Cycle count variance'), null);
    select id into v_adjustment from public.inventory_quantity_adjustments
    where lot_id = v_d.lot_id and workspace_id = p_workspace_id
    order by adjusted_at desc limit 1;

  elsif p_action in ('observation_mistaken', 'confirmed_system_location',
                     'routed_to_intake', 'explained_by_post_snapshot_activity', 'deferred') then
    -- Bookkeeping outcomes: they change no inventory, and say so.
    null;
  else
    raise exception 'unsupported resolution action %', p_action using errcode = '23514';
  end if;

  insert into public.cycle_count_resolutions (
    session_id, workspace_id, discrepancy_id, action, note, movement_id, adjustment_id,
    affected_item_id, affected_lot_id, expected_value, observed_value, succeeded, resolved_by)
  values (v_d.session_id, p_workspace_id, p_discrepancy_id, p_action, v_note,
    v_movement, v_adjustment, v_d.item_id, v_d.lot_id,
    v_d.expected_quantity, v_d.observed_quantity, true, v_uid);

  update public.cycle_count_discrepancies
  set status = (case when p_action = 'deferred' then 'deferred' else 'resolved' end)
                 ::public.cycle_count_discrepancy_status,
      resolved_at = now(), resolved_by = v_uid,
      deferral_reason = case when p_action = 'deferred' then v_note else deferral_reason end
  where id = p_discrepancy_id;

  return jsonb_build_object(
    'outcome', case when p_action = 'deferred' then 'deferred' else 'resolved' end,
    'discrepancy_id', p_discrepancy_id,
    'action', p_action,
    'movement_id', v_movement,
    'adjustment_id', v_adjustment);
end
$$;

revoke all on function public.resolve_cycle_count_discrepancy(
  uuid, uuid, public.cycle_count_resolution_action, text, text) from public, anon;
grant execute on function public.resolve_cycle_count_discrepancy(
  uuid, uuid, public.cycle_count_resolution_action, text, text) to authenticated;

-- Completion ---------------------------------------------------------------------------
create function public.complete_cycle_count(
  p_workspace_id uuid,
  p_session_id uuid,
  p_allow_deferred boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_s public.cycle_count_sessions%rowtype;
  v_open int;
  v_recount int;
  v_deferred int;
  v_summary jsonb;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);

  select * into v_s from public.cycle_count_sessions
  where id = p_session_id and workspace_id = p_workspace_id
  for update;
  if v_s.id is null then
    raise exception 'cycle count not found in this workspace' using errcode = '23514';
  end if;
  if v_s.status <> 'review' then
    raise exception 'only a cycle count in review can be completed (this one is %)', v_s.status
      using errcode = '23514';
  end if;

  select
    count(*) filter (where status = 'open')::int,
    count(*) filter (where status = 'recount_requested')::int,
    count(*) filter (where status = 'deferred')::int
  into v_open, v_recount, v_deferred
  from public.cycle_count_discrepancies where session_id = p_session_id;

  -- Nothing unresolved is allowed to vanish into a completed count.
  if v_open > 0 or v_recount > 0 then
    raise exception
      'cannot complete: % discrepancies are still open and % are awaiting recount',
      v_open, v_recount using errcode = '23514';
  end if;
  if v_deferred > 0 and not coalesce(p_allow_deferred, false) then
    raise exception 'cannot complete: % discrepancies are deferred', v_deferred
      using errcode = '23514';
  end if;
  if v_deferred > 0 and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'completing with deferred discrepancies needs a reason' using errcode = '23514';
  end if;

  select jsonb_build_object(
    'expected_items', (select count(*) from public.cycle_count_expected_items
                        where session_id = p_session_id),
    'found_items', (select count(distinct item_id) from public.cycle_count_item_observations
                     where session_id = p_session_id and voided_at is null
                       and observation_kind in ('expected_found', 'wrong_location')),
    'missing_items', (select count(*) from public.cycle_count_discrepancies
                       where session_id = p_session_id and discrepancy_kind = 'item_missing'),
    'unexpected_items', (select count(*) from public.cycle_count_discrepancies
                          where session_id = p_session_id and discrepancy_kind = 'item_unexpected'),
    'wrong_location_items', (select count(*) from public.cycle_count_discrepancies
                              where session_id = p_session_id
                                and discrepancy_kind = 'item_wrong_location'),
    'expected_units', (select coalesce(sum(expected_quantity), 0)
                        from public.cycle_count_expected_lots where session_id = p_session_id),
    'observed_units', (select coalesce(sum(observed_quantity), 0)
                        from public.cycle_count_lot_observations
                        where session_id = p_session_id and voided_at is null),
    'shortage_units', (select coalesce(sum(-variance), 0)
                        from public.cycle_count_lot_observations
                        where session_id = p_session_id and voided_at is null and variance < 0),
    'overage_units', (select coalesce(sum(variance), 0)
                       from public.cycle_count_lot_observations
                       where session_id = p_session_id and voided_at is null and variance > 0),
    'net_variance', (select coalesce(sum(variance), 0)
                      from public.cycle_count_lot_observations
                      where session_id = p_session_id and voided_at is null),
    'recount_rounds', (select coalesce(max(count_round), 1)
                        from public.cycle_count_lot_observations where session_id = p_session_id),
    'resolutions_applied', (select count(*) from public.cycle_count_resolutions
                             where session_id = p_session_id and succeeded),
    'deferred_discrepancies', v_deferred
  ) into v_summary;

  update public.cycle_count_sessions
  set status = 'completed', completed_at = now(), completed_by = v_uid,
      completion_summary = v_summary,
      completion_note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = p_session_id;

  return jsonb_build_object('outcome', 'completed', 'session_id', p_session_id,
    'summary', v_summary);
end
$$;

revoke all on function public.complete_cycle_count(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.complete_cycle_count(uuid, uuid, boolean, text) to authenticated;

-- Cancellation ----------------------------------------------------------------------------
-- A count that has already changed inventory cannot be cancelled: cancellation
-- would imply nothing happened, and something did.
create function public.cancel_cycle_count(
  p_workspace_id uuid,
  p_session_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_s public.cycle_count_sessions%rowtype;
  v_applied int;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why this count is being cancelled' using errcode = '23514';
  end if;

  select * into v_s from public.cycle_count_sessions
  where id = p_session_id and workspace_id = p_workspace_id
  for update;
  if v_s.id is null then
    raise exception 'cycle count not found in this workspace' using errcode = '23514';
  end if;
  if v_s.status not in ('draft', 'in_progress', 'review') then
    raise exception 'a % cycle count cannot be cancelled', v_s.status using errcode = '23514';
  end if;

  select count(*)::int into v_applied
  from public.cycle_count_resolutions
  where session_id = p_session_id and succeeded
    and action in ('item_moved_to_counted_location', 'item_loss_recorded', 'lot_quantity_adjusted');
  if v_applied > 0 then
    raise exception
      'cannot cancel: % inventory changes have already been applied from this count', v_applied
      using errcode = '23514';
  end if;

  update public.cycle_count_sessions
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
      cancellation_reason = btrim(p_reason), updated_at = now()
  where id = p_session_id;

  return jsonb_build_object('outcome', 'cancelled', 'session_id', p_session_id);
end
$$;

revoke all on function public.cancel_cycle_count(uuid, uuid, text) from public, anon;
grant execute on function public.cancel_cycle_count(uuid, uuid, text) to authenticated;

-- Read models ---------------------------------------------------------------------------
-- SECURITY INVOKER throughout: each underlying table's RLS is re-checked for the
-- querying role, so these compose visibility rather than widening it.
create view public.cycle_count_session_overview
with (security_invoker = true) as
select
  s.id as session_id,
  s.workspace_id,
  s.public_id,
  s.status,
  s.scope_type,
  s.include_descendants,
  s.blind_count,
  s.subtype_filter,
  s.vertical_filter,
  s.notes,
  s.created_at,
  s.started_at,
  s.snapshot_frozen_at,
  s.submitted_at,
  s.completed_at,
  s.cancelled_at,
  s.cancellation_reason,
  s.completion_summary,
  root.location_code as root_location_code,
  root.display_name as root_location_display_name,
  (select count(*) from public.cycle_count_scope_locations sc where sc.session_id = s.id)
    as scope_location_count,
  (select count(*) from public.cycle_count_expected_items e where e.session_id = s.id)
    as expected_item_count,
  (select count(distinct o.item_id) from public.cycle_count_item_observations o
     where o.session_id = s.id and o.voided_at is null) as observed_item_count,
  (select count(*) from public.cycle_count_expected_lots e where e.session_id = s.id)
    as expected_lot_count,
  (select count(distinct o.lot_id) from public.cycle_count_lot_observations o
     where o.session_id = s.id and o.voided_at is null) as observed_lot_count,
  (select count(*) from public.cycle_count_discrepancies d
     where d.session_id = s.id and d.status in ('open', 'recount_requested'))
    as open_discrepancy_count,
  (select count(*) from public.cycle_count_discrepancies d where d.session_id = s.id)
    as total_discrepancy_count
from public.cycle_count_sessions s
join public.storage_locations root on root.id = s.root_location_id;

revoke all on public.cycle_count_session_overview from public, anon;
grant select on public.cycle_count_session_overview to authenticated;

-- Inventory activity since the snapshot froze, for the records this count is
-- arguing about. Surfaced as a WARNING, never as an automatic dismissal: a
-- later movement may explain a discrepancy, or may be unrelated, and only a
-- person can tell which.
create view public.cycle_count_post_snapshot_activity
with (security_invoker = true) as
select
  d.id as discrepancy_id,
  d.session_id,
  d.workspace_id,
  'movement'::text as activity_kind,
  mv.public_id as activity_public_id,
  mv.moved_at as occurred_at,
  mv.note as detail
from public.cycle_count_discrepancies d
join public.cycle_count_sessions s on s.id = d.session_id
join public.inventory_movements mv
  on (mv.item_id = d.item_id or mv.lot_id = d.lot_id)
 and mv.workspace_id = d.workspace_id
 and mv.moved_at > s.snapshot_frozen_at
union all
select
  d.id, d.session_id, d.workspace_id,
  'quantity_adjustment'::text,
  adj.public_id,
  adj.adjusted_at,
  concat_ws(' ', adj.reason::text, adj.note)
from public.cycle_count_discrepancies d
join public.cycle_count_sessions s on s.id = d.session_id
join public.inventory_quantity_adjustments adj
  on adj.lot_id = d.lot_id
 and adj.workspace_id = d.workspace_id
 and adj.adjusted_at > s.snapshot_frozen_at;

revoke all on public.cycle_count_post_snapshot_activity from public, anon;
grant select on public.cycle_count_post_snapshot_activity to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260729000400_cycle_count_resolution');
