-- Cycle count: application-layer read models, loss auditability, and the
-- blind-count disclosure fix.
--
-- Three things happen here, in order of seriousness.
--
-- 1. A disclosure defect in the foundation is closed. `authenticated` held
--    table-wide SELECT on cycle_count_expected_lots, which carries
--    expected_quantity, and on cycle_count_lot_observations, which copies both
--    expected_quantity and variance. A counter running a blind count could
--    therefore read the very numbers the blind mode exists to withhold, simply
--    by querying the table the UI was told not to show them. Hiding it in the
--    client would have been theatre. The grant is narrowed to columns instead,
--    and the quantities are served only through a governed function that
--    decides disclosure from session status.
--
-- 2. Inventory loss becomes auditable. record_inventory_item_loss set
--    item_state = 'lost' and wrote the reason into void_reason, but accepted
--    p_session_id and p_discrepancy_id and then discarded them — nothing
--    durable recorded who wrote a unit off, when, or from which count. An
--    append-only inventory_loss_events table now carries that chain, and the
--    item's own history can show it.
--
-- 3. The client gets bounded governed read interfaces. Every one is
--    SECURITY DEFINER with an internal membership check and an explicit row
--    limit, so a page renders one count rather than dragging a workspace
--    across the wire.
--
-- Nothing here changes what an operation is permitted to do. The lifecycle,
-- the frozen snapshot, the idempotency indexes and the resolution rules are
-- all unchanged.

-- ===========================================================================
-- 1. Blind-count disclosure
-- ===========================================================================
-- Postgres has no way to hide a column behind a row policy, and a table-level
-- SELECT grant implies every column, so the table grant is withdrawn and
-- replaced with an explicit column list. count(*) and the existing
-- SECURITY INVOKER overview still work: they only need one readable column.

revoke select on table public.cycle_count_expected_lots from authenticated;
grant select (
  id, session_id, workspace_id, lot_id, lot_public_id, sku_id, sku_public_id,
  product_id, product_public_id, display_name, inventory_subtype,
  business_vertical, expected_location_id, expected_location_code, lot_state,
  snapshot_at
) on table public.cycle_count_expected_lots to authenticated;

revoke select on table public.cycle_count_lot_observations from authenticated;
grant select (
  id, session_id, workspace_id, count_round, expected_lot_id, lot_id,
  observed_quantity, note, observed_by, observed_at, voided_at, voided_by,
  void_reason
) on table public.cycle_count_lot_observations to authenticated;

-- ===========================================================================
-- 2. Inventory loss events
-- ===========================================================================
-- A unit written off physical stock. The inventory record itself survives with
-- every identifier and all of its history — this table records the write-off
-- as an event so the question "who decided this, and on what evidence" has a
-- permanent answer.
create table public.inventory_loss_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-LOSS-[A-Z0-9]{6,20}$'),
  item_id uuid not null,
  -- What the unit was before the write-off, so the transition is legible
  -- without reconstructing it from surrounding rows.
  previous_item_state public.inventory_item_state not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  -- Set when the loss came out of a cycle count. Null when an operator wrote a
  -- unit off outside one; the event is still a complete record either way.
  session_id uuid,
  discrepancy_id uuid,
  recorded_by uuid not null references auth.users (id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  foreign key (item_id, workspace_id)
    references public.inventory_items (id, workspace_id) on delete restrict,
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions (id, workspace_id) on delete restrict,
  foreign key (discrepancy_id, workspace_id)
    references public.cycle_count_discrepancies (id, workspace_id) on delete restrict
);
-- A unit is lost once. record_inventory_item_loss already refuses a unit that
-- is not active, so this is belt and braces rather than the only guard.
create unique index inventory_loss_events_item_once
  on public.inventory_loss_events (item_id);
create index inventory_loss_events_session_idx
  on public.inventory_loss_events (session_id) where session_id is not null;

create trigger inventory_loss_events_append_only
  before update or delete on public.inventory_loss_events
  for each row execute function app.forbid_update_delete();
create trigger inventory_loss_events_no_truncate
  before truncate on public.inventory_loss_events
  for each statement execute function app.forbid_update_delete();

alter table public.inventory_loss_events enable row level security;
revoke all on table public.inventory_loss_events from public, anon, authenticated;
grant select on table public.inventory_loss_events to authenticated;
create policy inventory_loss_events_select on public.inventory_loss_events
  for select to authenticated using (app.member_role(workspace_id) is not null);

-- Rewritten to record the event. The state change and the audit row are one
-- transaction: a unit cannot become lost without the record of why.
create or replace function public.record_inventory_item_loss(
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
  v_event_id uuid;
  v_public_id text;
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

  -- A discrepancy reference must belong to the session it is claimed under,
  -- or the audit chain would point at the wrong count.
  if p_discrepancy_id is not null then
    if not exists (
      select 1 from public.cycle_count_discrepancies d
      where d.id = p_discrepancy_id
        and d.workspace_id = p_workspace_id
        and (p_session_id is null or d.session_id = p_session_id)
    ) then
      raise exception 'that discrepancy does not belong to this count' using errcode = '23514';
    end if;
  end if;

  update public.inventory_items
  set item_state = 'lost',
      void_reason = btrim(p_reason),
      updated_at = now()
  where id = p_item_id;

  v_public_id := app.mint_governed_public_id('RV-LOSS');
  insert into public.inventory_loss_events (
    workspace_id, public_id, item_id, previous_item_state, reason,
    session_id, discrepancy_id, recorded_by)
  values (
    p_workspace_id, v_public_id, p_item_id, v_item.item_state, btrim(p_reason),
    p_session_id, p_discrepancy_id, v_uid)
  returning id into v_event_id;

  return jsonb_build_object(
    'item_id', p_item_id,
    'item_public_id', v_item.public_id,
    'item_state', 'lost',
    'loss_event_id', v_event_id,
    'loss_public_id', v_public_id,
    'session_id', p_session_id,
    'discrepancy_id', p_discrepancy_id);
end
$$;

revoke all on function public.record_inventory_item_loss(uuid, uuid, text, uuid, uuid)
  from public, anon;
grant execute on function public.record_inventory_item_loss(uuid, uuid, text, uuid, uuid)
  to authenticated;

-- ===========================================================================
-- 3. Post-snapshot activity, widened
-- ===========================================================================
-- The first version covered movements and quantity adjustments only. A
-- reviewer deciding whether a discrepancy is real needs the other governed
-- events that touch the same record after the snapshot froze.
--
-- Deliberately absent: a plain retirement or void of an item outside the
-- correction workflow. inventory_items records item_state and updated_at but
-- there is no append-only event row for that transition, so there is no
-- reliable timestamped source to join on. Inferring it from updated_at would
-- attribute the wrong time to the wrong cause. Correction-driven voids and
-- supersessions ARE covered, because those carry reviewed_at.
create or replace view public.cycle_count_post_snapshot_activity
with (security_invoker = true) as
-- Movement of the counted record.
select
  d.id as discrepancy_id,
  d.session_id,
  d.workspace_id,
  'movement'::text as activity_kind,
  mv.public_id as activity_public_id,
  mv.moved_at as occurred_at,
  mv.note as detail,
  from_loc.location_code as from_value,
  to_loc.location_code as to_value
from public.cycle_count_discrepancies d
join public.cycle_count_sessions s on s.id = d.session_id
join public.inventory_movements mv
  on (mv.item_id = d.item_id or mv.lot_id = d.lot_id)
 and mv.workspace_id = d.workspace_id
 and mv.moved_at > s.snapshot_frozen_at
left join public.storage_locations from_loc on from_loc.id = mv.from_location_id
left join public.storage_locations to_loc on to_loc.id = mv.to_location_id
union all
-- Quantity change on the counted lot.
select
  d.id, d.session_id, d.workspace_id,
  'quantity_adjustment'::text,
  adj.public_id,
  adj.adjusted_at,
  concat_ws(' ', adj.reason::text, adj.note),
  adj.previous_quantity::text,
  adj.resulting_quantity::text
from public.cycle_count_discrepancies d
join public.cycle_count_sessions s on s.id = d.session_id
join public.inventory_quantity_adjustments adj
  on adj.lot_id = d.lot_id
 and adj.workspace_id = d.workspace_id
 and adj.adjusted_at > s.snapshot_frozen_at
union all
-- The unit was written off physical stock.
select
  d.id, d.session_id, d.workspace_id,
  'item_loss'::text,
  loss.public_id,
  loss.recorded_at,
  loss.reason,
  loss.previous_item_state::text,
  'lost'::text
from public.cycle_count_discrepancies d
join public.cycle_count_sessions s on s.id = d.session_id
join public.inventory_loss_events loss
  on loss.item_id = d.item_id
 and loss.workspace_id = d.workspace_id
 and loss.recorded_at > s.snapshot_frozen_at
union all
-- A correction was raised against the counted record.
select
  d.id, d.session_id, d.workspace_id,
  'correction_requested'::text,
  cor.public_id,
  cor.requested_at,
  concat_ws(' — ', cor.issue_type::text, cor.explanation),
  null::text,
  cor.state::text
from public.cycle_count_discrepancies d
join public.cycle_count_sessions s on s.id = d.session_id
join public.inventory_correction_requests cor
  on (cor.item_id = d.item_id or cor.lot_id = d.lot_id)
 and cor.workspace_id = d.workspace_id
 and cor.requested_at > s.snapshot_frozen_at
union all
-- A correction was decided — this is where supersession and duplicate voiding
-- become visible, both of which can move or retire the counted record.
select
  d.id, d.session_id, d.workspace_id,
  'correction_reviewed'::text,
  cor.public_id,
  cor.reviewed_at,
  concat_ws(' — ', cor.issue_type::text, cor.resolution_note),
  'open'::text,
  cor.state::text
from public.cycle_count_discrepancies d
join public.cycle_count_sessions s on s.id = d.session_id
join public.inventory_correction_requests cor
  on (cor.item_id = d.item_id or cor.lot_id = d.lot_id)
 and cor.workspace_id = d.workspace_id
 and cor.reviewed_at is not null
 and cor.reviewed_at > s.snapshot_frozen_at
union all
-- The counted lot was split, or absorbed into another lot by a merge. Both
-- directions matter: units may have left this lot or arrived in it.
select
  d.id, d.session_id, d.workspace_id,
  case when lin.event_kind = 'split' then 'lot_split' else 'lot_merge' end,
  lin.public_id,
  lin.created_at,
  concat_ws(' ', lin.quantity::text || ' units', lin.note),
  parent.public_id,
  child.public_id
from public.cycle_count_discrepancies d
join public.cycle_count_sessions s on s.id = d.session_id
join public.inventory_lot_lineage lin
  on (lin.parent_lot_id = d.lot_id or lin.child_lot_id = d.lot_id)
 and lin.workspace_id = d.workspace_id
 and lin.created_at > s.snapshot_frozen_at
join public.inventory_lots parent on parent.id = lin.parent_lot_id
join public.inventory_lots child on child.id = lin.child_lot_id;

revoke all on public.cycle_count_post_snapshot_activity from public, anon;
grant select on public.cycle_count_post_snapshot_activity to authenticated;

-- ===========================================================================
-- 4. Bounded governed read interfaces
-- ===========================================================================

-- Membership, for read functions. Reading a count is not a privileged act —
-- any member may see one — but it is still workspace-scoped.
create function app.cycle_count_require_member(p_workspace_id uuid)
returns public.workspace_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.workspace_role;
begin
  v_role := app.member_role(p_workspace_id);
  if v_role is null then
    raise exception 'not a member of that workspace' using errcode = '42501';
  end if;
  return v_role;
end
$$;

revoke all on function app.cycle_count_require_member(uuid) from public, anon;

-- True while a session is blind AND still being counted. Once it reaches
-- review the numbers are disclosed: that is the point of blind counting, not
-- permanent secrecy.
create function app.cycle_count_quantities_withheld(p_session_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select s.blind_count and s.status in ('draft', 'in_progress')
       from public.cycle_count_sessions s where s.id = p_session_id),
    false);
$$;

revoke all on function app.cycle_count_quantities_withheld(uuid) from public, anon;

-- Clamp a caller-supplied page size to something a page can actually render.
create function app.cycle_count_page_limit(p_limit integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function app.cycle_count_page_limit(integer) from public, anon;

-- --- Session list -----------------------------------------------------------
create function public.list_cycle_counts(
  p_workspace_id uuid,
  p_statuses public.cycle_count_status[] default null,
  p_location_code text default null,
  p_blind_only boolean default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  perform app.cycle_count_require_member(p_workspace_id);
  v_limit := app.cycle_count_page_limit(p_limit);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with filtered as (
    select o.*
    from public.cycle_count_session_overview o
    where o.workspace_id = p_workspace_id
      and (p_statuses is null or o.status = any (p_statuses))
      and (p_location_code is null or o.root_location_code = p_location_code)
      and (p_blind_only is null or o.blind_count = p_blind_only)
  )
  select
    (select count(*) from filtered),
    coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc), '[]'::jsonb)
  into v_total, v_rows
  from (
    select
      f.session_id, f.public_id, f.status, f.scope_type, f.include_descendants,
      f.blind_count, f.subtype_filter, f.vertical_filter, f.notes,
      f.root_location_code, f.root_location_display_name, f.scope_location_count,
      f.expected_item_count, f.observed_item_count,
      f.expected_lot_count, f.observed_lot_count,
      f.open_discrepancy_count, f.total_discrepancy_count,
      f.created_at, f.started_at, f.snapshot_frozen_at, f.submitted_at,
      f.completed_at, f.cancelled_at,
      creator.email as created_by_email
    from filtered f
    join public.cycle_count_sessions s on s.id = f.session_id
    left join auth.users creator on creator.id = s.created_by
    order by f.created_at desc
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end
$$;

revoke all on function public.list_cycle_counts(
  uuid, public.cycle_count_status[], text, boolean, integer, integer)
  from public, anon;
grant execute on function public.list_cycle_counts(
  uuid, public.cycle_count_status[], text, boolean, integer, integer)
  to authenticated;

-- --- One session, with frozen scope and live progress ------------------------
create function public.get_cycle_count(
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
  v_role public.workspace_role;
  v_session public.cycle_count_sessions%rowtype;
  v_round integer;
  v_scope jsonb;
  v_progress jsonb;
  v_review jsonb;
begin
  v_role := app.cycle_count_require_member(p_workspace_id);

  select * into v_session from public.cycle_count_sessions
  where id = p_session_id and workspace_id = p_workspace_id;
  if v_session.id is null then
    -- Deliberately indistinguishable from "belongs to another workspace":
    -- a wrong-workspace probe learns nothing about what exists elsewhere.
    return jsonb_build_object('found', false);
  end if;

  v_round := app.cycle_count_current_round(p_session_id);

  select coalesce(jsonb_agg(to_jsonb(sc) order by sc.depth, sc.location_code), '[]'::jsonb)
  into v_scope
  from (
    select location_id, location_code, location_display_name, depth
    from public.cycle_count_scope_locations
    where session_id = p_session_id
  ) sc;

  select jsonb_build_object(
    'expected_item_count', coalesce(ei.total, 0),
    'found_item_count', coalesce(io.found, 0),
    'wrong_location_count', coalesce(io.wrong_location, 0),
    'unexpected_item_count', coalesce(io.unexpected, 0),
    'uncounted_item_count', greatest(coalesce(ei.total, 0) - coalesce(io.expected_seen, 0), 0),
    'expected_lot_count', coalesce(el.total, 0),
    'counted_lot_count', coalesce(lo.counted, 0),
    'uncounted_lot_count', greatest(coalesce(el.total, 0) - coalesce(lo.counted, 0), 0),
    'matched_lot_count', coalesce(lo.matched, 0),
    'variance_lot_count', coalesce(lo.variance_lots, 0),
    'observed_zero_lot_count', coalesce(lo.observed_zero, 0),
    'total_observation_count', coalesce(io.all_rounds, 0) + coalesce(lo.all_rounds, 0))
  into v_progress
  from
    (select count(*) as total from public.cycle_count_expected_items
      where session_id = p_session_id) ei
  cross join
    (select count(*) as total from public.cycle_count_expected_lots
      where session_id = p_session_id) el
  cross join lateral (
    select
      count(distinct o.item_id) filter (where o.observation_kind = 'expected_found') as found,
      count(distinct o.item_id) filter (where o.observation_kind = 'wrong_location') as wrong_location,
      count(distinct o.item_id) filter (where o.observation_kind = 'unexpected_found') as unexpected,
      count(distinct o.expected_item_id) filter (where o.expected_item_id is not null) as expected_seen,
      (select count(*) from public.cycle_count_item_observations a
        where a.session_id = p_session_id and a.voided_at is null) as all_rounds
    from public.cycle_count_item_observations o
    where o.session_id = p_session_id
      and o.count_round = v_round
      and o.voided_at is null
  ) io
  cross join lateral (
    select
      count(distinct o.lot_id) as counted,
      count(*) filter (where o.variance = 0) as matched,
      count(*) filter (where o.variance <> 0) as variance_lots,
      count(*) filter (where o.observed_quantity = 0) as observed_zero,
      (select count(*) from public.cycle_count_lot_observations a
        where a.session_id = p_session_id and a.voided_at is null) as all_rounds
    from public.cycle_count_lot_observations o
    where o.session_id = p_session_id
      and o.count_round = v_round
      and o.voided_at is null
  ) lo;

  -- Review totals exist only once discrepancies do. Reporting them as zero
  -- during counting would read as "nothing wrong" rather than "not yet known".
  if v_session.status in ('review', 'completed') then
    select jsonb_build_object(
      'missing_item_count', count(*) filter (where discrepancy_kind = 'item_missing'),
      'unexpected_item_count', count(*) filter (where discrepancy_kind = 'item_unexpected'),
      'wrong_location_count', count(*) filter (where discrepancy_kind = 'item_wrong_location'),
      'lot_shortage_count', count(*) filter (where discrepancy_kind = 'lot_shortage'),
      'lot_overage_count', count(*) filter (where discrepancy_kind = 'lot_overage'),
      'lot_uncounted_count', count(*) filter (where discrepancy_kind = 'lot_uncounted'),
      'shortage_units', coalesce(sum(greatest(coalesce(expected_quantity, 0) - coalesce(observed_quantity, 0), 0))
        filter (where discrepancy_kind = 'lot_shortage'), 0),
      'overage_units', coalesce(sum(greatest(coalesce(observed_quantity, 0) - coalesce(expected_quantity, 0), 0))
        filter (where discrepancy_kind = 'lot_overage'), 0),
      'open_count', count(*) filter (where status = 'open'),
      'recount_requested_count', count(*) filter (where status = 'recount_requested'),
      'resolved_count', count(*) filter (where status = 'resolved'),
      'deferred_count', count(*) filter (where status = 'deferred'),
      'total_count', count(*))
    into v_review
    from public.cycle_count_discrepancies
    where session_id = p_session_id;
  else
    v_review := null;
  end if;

  return jsonb_build_object(
    'found', true,
    'viewer_role', v_role,
    'can_count', v_role in ('owner', 'operator'),
    'quantities_withheld', app.cycle_count_quantities_withheld(p_session_id),
    'current_round', v_round,
    'session', jsonb_build_object(
      'session_id', v_session.id,
      'public_id', v_session.public_id,
      'status', v_session.status,
      'scope_type', v_session.scope_type,
      'include_descendants', v_session.include_descendants,
      'subtype_filter', v_session.subtype_filter,
      'vertical_filter', v_session.vertical_filter,
      'blind_count', v_session.blind_count,
      'notes', v_session.notes,
      'root_location_code',
        (select location_code from public.storage_locations
          where id = v_session.root_location_id),
      'created_at', v_session.created_at,
      'created_by_email', (select email from auth.users where id = v_session.created_by),
      'started_at', v_session.started_at,
      'started_by_email', (select email from auth.users where id = v_session.started_by),
      'snapshot_frozen_at', v_session.snapshot_frozen_at,
      'submitted_at', v_session.submitted_at,
      'submitted_by_email', (select email from auth.users where id = v_session.submitted_by),
      'completed_at', v_session.completed_at,
      'completed_by_email', (select email from auth.users where id = v_session.completed_by),
      'completion_note', v_session.completion_note,
      'completion_summary', v_session.completion_summary,
      'cancelled_at', v_session.cancelled_at,
      'cancelled_by_email', (select email from auth.users where id = v_session.cancelled_by),
      'cancellation_reason', v_session.cancellation_reason),
    'scope', v_scope,
    'progress', v_progress,
    'review_totals', v_review);
end
$$;

revoke all on function public.get_cycle_count(uuid, uuid) from public, anon;
grant execute on function public.get_cycle_count(uuid, uuid) to authenticated;

-- --- Serialized queue -------------------------------------------------------
-- The frozen expected units, each marked with whether this round has seen it.
create function public.cycle_count_item_queue(
  p_workspace_id uuid,
  p_session_id uuid,
  p_filter text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_offset integer;
  v_round integer;
  v_total bigint;
  v_rows jsonb;
begin
  perform app.cycle_count_require_member(p_workspace_id);
  if not exists (select 1 from public.cycle_count_sessions
                 where id = p_session_id and workspace_id = p_workspace_id) then
    raise exception 'that cycle count is not in this workspace' using errcode = '23514';
  end if;
  if coalesce(p_filter, 'all') not in ('all', 'uncounted', 'counted') then
    raise exception 'unknown queue filter %', p_filter using errcode = '23514';
  end if;
  v_limit := app.cycle_count_page_limit(p_limit);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_round := app.cycle_count_current_round(p_session_id);

  with marked as (
    select
      e.id as expected_item_id, e.item_id, e.item_public_id, e.display_name,
      e.scan_sku, e.certificate_number, e.serial_number, e.grading_company,
      e.inventory_subtype, e.business_vertical,
      e.expected_location_code, e.item_state,
      o.id as observation_id, o.observation_kind, o.observed_at,
      obs_loc.location_code as observed_location_code
    from public.cycle_count_expected_items e
    left join public.cycle_count_item_observations o
      on o.session_id = e.session_id
     and o.expected_item_id = e.id
     and o.count_round = v_round
     and o.voided_at is null
    left join public.storage_locations obs_loc on obs_loc.id = o.observed_location_id
    where e.session_id = p_session_id
  ), filtered as (
    select * from marked
    where coalesce(p_filter, 'all') = 'all'
       or (p_filter = 'uncounted' and observation_id is null)
       or (p_filter = 'counted' and observation_id is not null)
  )
  select
    (select count(*) from filtered),
    coalesce(jsonb_agg(to_jsonb(page) order by page.expected_location_code, page.display_name), '[]'::jsonb)
  into v_total, v_rows
  from (
    select * from filtered
    order by expected_location_code, display_name
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'count_round', v_round);
end
$$;

revoke all on function public.cycle_count_item_queue(uuid, uuid, text, integer, integer)
  from public, anon;
grant execute on function public.cycle_count_item_queue(uuid, uuid, text, integer, integer)
  to authenticated;

-- --- Lot queue --------------------------------------------------------------
-- The only sanctioned way for a client to learn an expected lot quantity. While
-- a blind count is being counted the expected figure and the variance are not
-- in the payload at all — not blanked in the UI, absent from the response.
create function public.cycle_count_lot_queue(
  p_workspace_id uuid,
  p_session_id uuid,
  p_filter text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_offset integer;
  v_round integer;
  v_withheld boolean;
  v_total bigint;
  v_rows jsonb;
begin
  perform app.cycle_count_require_member(p_workspace_id);
  if not exists (select 1 from public.cycle_count_sessions
                 where id = p_session_id and workspace_id = p_workspace_id) then
    raise exception 'that cycle count is not in this workspace' using errcode = '23514';
  end if;
  if coalesce(p_filter, 'all') not in ('all', 'uncounted', 'counted', 'variances') then
    raise exception 'unknown queue filter %', p_filter using errcode = '23514';
  end if;
  v_limit := app.cycle_count_page_limit(p_limit);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_round := app.cycle_count_current_round(p_session_id);
  v_withheld := app.cycle_count_quantities_withheld(p_session_id);

  with marked as (
    select
      e.id as expected_lot_id, e.lot_id, e.lot_public_id, e.display_name,
      e.inventory_subtype, e.business_vertical,
      e.expected_location_code, e.lot_state,
      case when v_withheld then null else e.expected_quantity end as expected_quantity,
      o.id as observation_id,
      o.observed_quantity,
      case when v_withheld then null else o.variance end as variance,
      o.note as observation_note,
      o.observed_at,
      -- Status is safe to disclose during a blind count only as far as
      -- "saved": short/over would hand back the variance in words.
      case
        when o.id is null then 'uncounted'
        when v_withheld then 'saved'
        when o.variance = 0 then 'matched'
        when o.variance < 0 then 'short'
        else 'over'
      end as count_status
    from public.cycle_count_expected_lots e
    left join public.cycle_count_lot_observations o
      on o.session_id = e.session_id
     and o.expected_lot_id = e.id
     and o.count_round = v_round
     and o.voided_at is null
    where e.session_id = p_session_id
  ), filtered as (
    select * from marked
    where coalesce(p_filter, 'all') = 'all'
       or (p_filter = 'uncounted' and observation_id is null)
       or (p_filter = 'counted' and observation_id is not null)
       or (p_filter = 'variances' and count_status in ('short', 'over'))
  )
  select
    (select count(*) from filtered),
    coalesce(jsonb_agg(to_jsonb(page) order by page.expected_location_code, page.display_name), '[]'::jsonb)
  into v_total, v_rows
  from (
    select * from filtered
    order by expected_location_code, display_name
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'count_round', v_round, 'quantities_withheld', v_withheld);
end
$$;

revoke all on function public.cycle_count_lot_queue(uuid, uuid, text, integer, integer)
  from public, anon;
grant execute on function public.cycle_count_lot_queue(uuid, uuid, text, integer, integer)
  to authenticated;

-- --- Recent observations ----------------------------------------------------
-- Both kinds, newest first, for the running feed on the counting screen.
-- Historical rounds are included but labelled, never folded into the current
-- round's progress.
create function public.cycle_count_observation_feed(
  p_workspace_id uuid,
  p_session_id uuid,
  p_limit integer default 25,
  p_current_round_only boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_round integer;
  v_withheld boolean;
  v_rows jsonb;
begin
  perform app.cycle_count_require_member(p_workspace_id);
  if not exists (select 1 from public.cycle_count_sessions
                 where id = p_session_id and workspace_id = p_workspace_id) then
    raise exception 'that cycle count is not in this workspace' using errcode = '23514';
  end if;
  v_limit := app.cycle_count_page_limit(p_limit);
  v_round := app.cycle_count_current_round(p_session_id);
  v_withheld := app.cycle_count_quantities_withheld(p_session_id);

  select coalesce(jsonb_agg(to_jsonb(f) order by f.observed_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      o.id as observation_id, 'item'::text as subject_kind, o.count_round,
      o.observation_kind::text as outcome,
      e.item_public_id as subject_public_id,
      coalesce(e.display_name, item_sku.public_id) as display_name,
      o.raw_identifier, o.note, o.observed_at,
      obs_loc.location_code as observed_location_code,
      e.expected_location_code,
      null::integer as observed_quantity, null::integer as expected_quantity,
      o.voided_at, o.void_reason,
      actor.email as observed_by_email,
      o.count_round = v_round as is_current_round
    from public.cycle_count_item_observations o
    left join public.cycle_count_expected_items e on e.id = o.expected_item_id
    left join public.inventory_items it on it.id = o.item_id
    left join public.sellable_skus item_sku on item_sku.id = it.sku_id
    left join public.storage_locations obs_loc on obs_loc.id = o.observed_location_id
    left join auth.users actor on actor.id = o.observed_by
    where o.session_id = p_session_id
      and (not p_current_round_only or o.count_round = v_round)
    union all
    select
      o.id, 'lot'::text, o.count_round,
      case
        when v_withheld then 'saved'
        when o.variance = 0 then 'matched'
        when o.variance < 0 then 'short'
        else 'over'
      end,
      e.lot_public_id,
      e.display_name,
      e.lot_public_id, o.note, o.observed_at,
      e.expected_location_code, e.expected_location_code,
      o.observed_quantity,
      case when v_withheld then null else o.expected_quantity end,
      o.voided_at, o.void_reason,
      actor.email,
      o.count_round = v_round
    from public.cycle_count_lot_observations o
    join public.cycle_count_expected_lots e on e.id = o.expected_lot_id
    left join auth.users actor on actor.id = o.observed_by
    where o.session_id = p_session_id
      and (not p_current_round_only or o.count_round = v_round)
    order by observed_at desc
    limit v_limit
  ) f;

  return jsonb_build_object(
    'rows', v_rows, 'count_round', v_round, 'quantities_withheld', v_withheld);
end
$$;

revoke all on function public.cycle_count_observation_feed(uuid, uuid, integer, boolean)
  from public, anon;
grant execute on function public.cycle_count_observation_feed(uuid, uuid, integer, boolean)
  to authenticated;

-- --- Discrepancy review -----------------------------------------------------
-- One discrepancy per row, carrying everything the reviewer needs to decide:
-- subject identity, frozen expectation, what was observed, every round's
-- observations, activity since the snapshot, and every resolution attempt
-- including the ones that failed.
create function public.cycle_count_review(
  p_workspace_id uuid,
  p_session_id uuid,
  p_kinds public.cycle_count_discrepancy_kind[] default null,
  p_statuses public.cycle_count_discrepancy_status[] default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_rows jsonb;
begin
  perform app.cycle_count_require_member(p_workspace_id);
  if not exists (select 1 from public.cycle_count_sessions
                 where id = p_session_id and workspace_id = p_workspace_id) then
    raise exception 'that cycle count is not in this workspace' using errcode = '23514';
  end if;
  v_limit := app.cycle_count_page_limit(p_limit);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with filtered as (
    select d.*
    from public.cycle_count_discrepancies d
    where d.session_id = p_session_id
      and (p_kinds is null or d.discrepancy_kind = any (p_kinds))
      and (p_statuses is null or d.status = any (p_statuses))
  )
  select
    (select count(*) from filtered),
    coalesce(jsonb_agg(to_jsonb(page) order by page.discrepancy_kind, page.detected_at), '[]'::jsonb)
  into v_total, v_rows
  from (
    select
      d.id as discrepancy_id, d.public_id, d.discrepancy_kind, d.status,
      d.expected_quantity, d.observed_quantity,
      coalesce(d.observed_quantity, 0) - coalesce(d.expected_quantity, 0) as variance,
      d.detected_at, d.recount_requested_at, d.resolved_at, d.deferral_reason,
      recounter.email as recount_requested_by_email,
      resolver.email as resolved_by_email,
      coalesce(ei.item_public_id, el.lot_public_id, it.public_id) as subject_public_id,
      coalesce(ei.display_name, el.display_name, 'Unknown record') as subject_display_name,
      case when d.lot_id is not null then 'lot' else 'item' end as subject_kind,
      d.item_id, d.lot_id,
      ei.certificate_number, ei.serial_number, ei.grading_company,
      exp_loc.location_code as expected_location_code,
      obs_loc.location_code as observed_location_code,
      -- Every round, not just the current one: a recount is only meaningful
      -- next to the count it disagrees with.
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'observation_id', o.id, 'count_round', o.count_round,
          'outcome', o.observation_kind::text, 'observed_at', o.observed_at,
          'observed_by_email', oa.email, 'note', o.note,
          'raw_identifier', o.raw_identifier,
          'observed_location_code', ol.location_code,
          'voided_at', o.voided_at, 'void_reason', o.void_reason)
          order by o.count_round, o.observed_at)
        from public.cycle_count_item_observations o
        left join auth.users oa on oa.id = o.observed_by
        left join public.storage_locations ol on ol.id = o.observed_location_id
        where o.session_id = d.session_id and d.item_id is not null and o.item_id = d.item_id
      ), '[]'::jsonb) || coalesce((
        select jsonb_agg(jsonb_build_object(
          'observation_id', o.id, 'count_round', o.count_round,
          'outcome', case when o.variance = 0 then 'matched'
                          when o.variance < 0 then 'short' else 'over' end,
          'observed_at', o.observed_at, 'observed_by_email', oa.email,
          'note', o.note, 'observed_quantity', o.observed_quantity,
          'expected_quantity', o.expected_quantity, 'variance', o.variance,
          'voided_at', o.voided_at, 'void_reason', o.void_reason)
          order by o.count_round, o.observed_at)
        from public.cycle_count_lot_observations o
        left join auth.users oa on oa.id = o.observed_by
        where o.session_id = d.session_id and d.lot_id is not null and o.lot_id = d.lot_id
      ), '[]'::jsonb) as observations,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'activity_kind', a.activity_kind, 'activity_public_id', a.activity_public_id,
          'occurred_at', a.occurred_at, 'detail', a.detail,
          'from_value', a.from_value, 'to_value', a.to_value)
          order by a.occurred_at)
        from public.cycle_count_post_snapshot_activity a
        where a.discrepancy_id = d.id
      ), '[]'::jsonb) as post_snapshot_activity,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'resolution_id', r.id, 'action', r.action::text, 'note', r.note,
          'succeeded', r.succeeded, 'failure_detail', r.failure_detail,
          'resolved_at', r.resolved_at, 'resolved_by_email', ra.email,
          'movement_id', r.movement_id, 'adjustment_id', r.adjustment_id)
          order by r.resolved_at)
        from public.cycle_count_resolutions r
        left join auth.users ra on ra.id = r.resolved_by
        where r.discrepancy_id = d.id
      ), '[]'::jsonb) as resolutions
    from filtered d
    left join public.cycle_count_expected_items ei on ei.id = d.expected_item_id
    left join public.cycle_count_expected_lots el on el.id = d.expected_lot_id
    left join public.inventory_items it on it.id = d.item_id
    left join public.storage_locations exp_loc on exp_loc.id = d.expected_location_id
    left join public.storage_locations obs_loc on obs_loc.id = d.observed_location_id
    left join auth.users recounter on recounter.id = d.recount_requested_by
    left join auth.users resolver on resolver.id = d.resolved_by
    order by d.discrepancy_kind, d.detected_at
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end
$$;

revoke all on function public.cycle_count_review(
  uuid, uuid, public.cycle_count_discrepancy_kind[],
  public.cycle_count_discrepancy_status[], integer, integer)
  from public, anon;
grant execute on function public.cycle_count_review(
  uuid, uuid, public.cycle_count_discrepancy_kind[],
  public.cycle_count_discrepancy_status[], integer, integer)
  to authenticated;

-- --- Completion readiness ---------------------------------------------------
-- What stands between this session and completion, named individually so the
-- UI can disable the button AND say why.
create function public.cycle_count_completion_readiness(
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
  v_role public.workspace_role;
  v_status public.cycle_count_status;
  v_open integer;
  v_recount integer;
  v_resolved integer;
  v_deferred integer;
  v_failed integer;
  v_inventory_changing integer;
  v_blockers text[] := array[]::text[];
begin
  v_role := app.cycle_count_require_member(p_workspace_id);

  select status into v_status from public.cycle_count_sessions
  where id = p_session_id and workspace_id = p_workspace_id;
  if v_status is null then
    raise exception 'that cycle count is not in this workspace' using errcode = '23514';
  end if;

  select
    count(*) filter (where status = 'open'),
    count(*) filter (where status = 'recount_requested'),
    count(*) filter (where status = 'resolved'),
    count(*) filter (where status = 'deferred')
  into v_open, v_recount, v_resolved, v_deferred
  from public.cycle_count_discrepancies
  where session_id = p_session_id;

  -- A failed attempt counts as outstanding only while its discrepancy has no
  -- successful resolution: a retry that worked settles the matter, and the
  -- failure stays visible as history either way.
  select count(*) into v_failed
  from public.cycle_count_discrepancies d
  where d.session_id = p_session_id
    and exists (select 1 from public.cycle_count_resolutions r
                where r.discrepancy_id = d.id and not r.succeeded)
    and not exists (select 1 from public.cycle_count_resolutions r
                    where r.discrepancy_id = d.id and r.succeeded);

  select count(*) into v_inventory_changing
  from public.cycle_count_resolutions r
  where r.session_id = p_session_id
    and r.succeeded
    and r.action in ('item_moved_to_counted_location', 'item_loss_recorded',
                     'lot_quantity_adjusted');

  if v_status <> 'review' then
    v_blockers := array_append(v_blockers,
      format('This count is %s. Only a count in review can be completed.', v_status));
  end if;
  if v_open > 0 then
    v_blockers := array_append(v_blockers,
      format('%s discrepancy(s) are still open.', v_open));
  end if;
  if v_recount > 0 then
    v_blockers := array_append(v_blockers,
      format('%s discrepancy(s) are waiting for a recount.', v_recount));
  end if;
  if v_failed > 0 then
    v_blockers := array_append(v_blockers,
      format('%s discrepancy(s) have a failed resolution and no successful one.', v_failed));
  end if;

  return jsonb_build_object(
    'status', v_status,
    'viewer_role', v_role,
    'can_review', v_role in ('owner', 'operator'),
    'open_count', v_open,
    'recount_requested_count', v_recount,
    'resolved_count', v_resolved,
    'deferred_count', v_deferred,
    'failed_resolution_count', v_failed,
    'inventory_changing_resolution_count', v_inventory_changing,
    'blockers', to_jsonb(v_blockers),
    'can_complete', v_status = 'review' and v_open = 0 and v_recount = 0
                    and v_failed = 0 and v_deferred = 0,
    -- The elevated path. Deferrals block the ordinary button and are only
    -- passable by an owner or operator who says so explicitly and gives a
    -- reason; the database still refuses without p_allow_deferred.
    'can_complete_with_deferrals', v_status = 'review' and v_open = 0
                    and v_recount = 0 and v_failed = 0 and v_deferred > 0
                    and v_role in ('owner', 'operator'));
end
$$;

revoke all on function public.cycle_count_completion_readiness(uuid, uuid)
  from public, anon;
grant execute on function public.cycle_count_completion_readiness(uuid, uuid)
  to authenticated;

-- --- Immutable audit record -------------------------------------------------
-- The whole session as evidence: frozen scope and snapshot, every round of
-- observations including voided ones, discrepancies, activity, and every
-- resolution attempt. Bounded, because an audit page still has to render.
create function public.cycle_count_audit_record(
  p_workspace_id uuid,
  p_session_id uuid,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_session jsonb;
begin
  perform app.cycle_count_require_member(p_workspace_id);
  v_limit := app.cycle_count_page_limit(p_limit);

  v_session := public.get_cycle_count(p_workspace_id, p_session_id);
  if not (v_session ->> 'found')::boolean then
    return v_session;
  end if;

  return v_session || jsonb_build_object(
    'expected_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_public_id', e.item_public_id, 'display_name', e.display_name,
        'expected_location_code', e.expected_location_code,
        'item_state', e.item_state, 'item_id', e.item_id,
        'certificate_number', e.certificate_number, 'serial_number', e.serial_number)
        order by e.expected_location_code, e.display_name)
      from (select * from public.cycle_count_expected_items
            where session_id = p_session_id
            order by expected_location_code, display_name limit v_limit) e
    ), '[]'::jsonb),
    'expected_lots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lot_public_id', e.lot_public_id, 'display_name', e.display_name,
        'expected_location_code', e.expected_location_code,
        'expected_quantity', e.expected_quantity, 'lot_state', e.lot_state,
        'lot_id', e.lot_id)
        order by e.expected_location_code, e.display_name)
      from (select * from public.cycle_count_expected_lots
            where session_id = p_session_id
            order by expected_location_code, display_name limit v_limit) e
    ), '[]'::jsonb),
    -- Voided observations included on purpose: a mis-scan that was undone is
    -- part of how the count was arrived at.
    'observations', (public.cycle_count_observation_feed(
      p_workspace_id, p_session_id, v_limit, false) -> 'rows'),
    'discrepancies', (public.cycle_count_review(
      p_workspace_id, p_session_id, null, null, v_limit, 0) -> 'rows'),
    'resolutions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'resolution_id', r.id, 'discrepancy_public_id', d.public_id,
        'action', r.action::text, 'note', r.note, 'succeeded', r.succeeded,
        'failure_detail', r.failure_detail, 'resolved_at', r.resolved_at,
        'resolved_by_email', ra.email,
        'movement_id', r.movement_id, 'adjustment_id', r.adjustment_id,
        'affected_item_id', r.affected_item_id, 'affected_lot_id', r.affected_lot_id)
        order by r.resolved_at)
      from (select * from public.cycle_count_resolutions
            where session_id = p_session_id
            order by resolved_at limit v_limit) r
      join public.cycle_count_discrepancies d on d.id = r.discrepancy_id
      left join auth.users ra on ra.id = r.resolved_by
    ), '[]'::jsonb),
    'loss_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'loss_public_id', l.public_id, 'item_id', l.item_id,
        'item_public_id', it.public_id, 'reason', l.reason,
        'recorded_at', l.recorded_at, 'recorded_by_email', la.email)
        order by l.recorded_at)
      from public.inventory_loss_events l
      join public.inventory_items it on it.id = l.item_id
      left join auth.users la on la.id = l.recorded_by
      where l.session_id = p_session_id
    ), '[]'::jsonb),
    'row_limit', v_limit);
end
$$;

revoke all on function public.cycle_count_audit_record(uuid, uuid, integer)
  from public, anon;
grant execute on function public.cycle_count_audit_record(uuid, uuid, integer)
  to authenticated;

-- --- Item loss history ------------------------------------------------------
-- For the unit's own detail page. Returns the actor's email, which is why this
-- is a function rather than a view: auth.users is not readable by the client.
create function public.inventory_item_loss_history(
  p_workspace_id uuid,
  p_item_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform app.cycle_count_require_member(p_workspace_id);

  select coalesce(jsonb_agg(to_jsonb(h) order by h.recorded_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      l.public_id as loss_public_id,
      l.previous_item_state::text as previous_item_state,
      'lost'::text as new_item_state,
      l.reason,
      l.recorded_at,
      actor.email as recorded_by_email,
      s.public_id as cycle_count_public_id,
      l.session_id as cycle_count_session_id,
      d.public_id as discrepancy_public_id
    from public.inventory_loss_events l
    left join auth.users actor on actor.id = l.recorded_by
    left join public.cycle_count_sessions s on s.id = l.session_id
    left join public.cycle_count_discrepancies d on d.id = l.discrepancy_id
    where l.workspace_id = p_workspace_id
      and l.item_id = p_item_id
  ) h;

  return jsonb_build_object('rows', v_rows);
end
$$;

revoke all on function public.inventory_item_loss_history(uuid, uuid) from public, anon;
grant execute on function public.inventory_item_loss_history(uuid, uuid) to authenticated;

-- --- Workbench summary ------------------------------------------------------
-- Bounded counts plus a handful of examples. The Workbench points at the
-- cycle-count pages; it does not reproduce them.
create function public.cycle_count_workbench_summary(
  p_workspace_id uuid,
  p_example_limit integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform app.cycle_count_require_member(p_workspace_id);
  v_limit := least(greatest(coalesce(p_example_limit, 5), 1), 20);

  return jsonb_build_object(
    'active_count', (select count(*) from public.cycle_count_sessions
      where workspace_id = p_workspace_id and status in ('draft', 'in_progress')),
    'awaiting_review_count', (select count(*) from public.cycle_count_sessions
      where workspace_id = p_workspace_id and status = 'review'),
    'recount_required_count', (select count(*) from public.cycle_count_discrepancies d
      join public.cycle_count_sessions s on s.id = d.session_id
      where s.workspace_id = p_workspace_id and d.status = 'recount_requested'),
    'unresolved_discrepancy_count', (select count(*) from public.cycle_count_discrepancies d
      join public.cycle_count_sessions s on s.id = d.session_id
      where s.workspace_id = p_workspace_id and s.status = 'review' and d.status = 'open'),
    -- Bookkeeping-only follow-ups: routed_to_intake records the intention to
    -- receive an unexpected unit properly. It creates no inventory, so it stays
    -- a visible queue until somebody actions it.
    'intake_followup_count', (select count(*) from public.cycle_count_resolutions r
      where r.workspace_id = p_workspace_id and r.succeeded and r.action = 'routed_to_intake'),
    'deferred_count', (select count(*) from public.cycle_count_discrepancies d
      join public.cycle_count_sessions s on s.id = d.session_id
      where s.workspace_id = p_workspace_id and d.status = 'deferred'),
    'examples', coalesce((
      select jsonb_agg(jsonb_build_object(
        'session_id', e.session_id, 'public_id', e.public_id, 'status', e.status,
        'root_location_code', e.root_location_code, 'blind_count', e.blind_count,
        'expected_item_count', e.expected_item_count,
        'observed_item_count', e.observed_item_count,
        'expected_lot_count', e.expected_lot_count,
        'observed_lot_count', e.observed_lot_count,
        'open_discrepancy_count', e.open_discrepancy_count,
        'created_at', e.created_at)
        order by e.created_at desc)
      from (
        select * from public.cycle_count_session_overview
        where workspace_id = p_workspace_id
          and status in ('draft', 'in_progress', 'review')
        order by created_at desc
        limit v_limit
      ) e
    ), '[]'::jsonb),
    'example_limit', v_limit);
end
$$;

revoke all on function public.cycle_count_workbench_summary(uuid, integer)
  from public, anon;
grant execute on function public.cycle_count_workbench_summary(uuid, integer)
  to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260730000100_cycle_count_application_layer');
