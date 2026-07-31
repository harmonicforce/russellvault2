-- Governed round lifecycle, frozen recount scope, and atomic observation keys.

create table public.cycle_count_round_subjects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  session_id uuid not null,
  round_id uuid not null,
  subject_type public.cycle_count_subject_type not null,
  expected_item_id uuid,
  expected_lot_id uuid,
  item_id uuid,
  lot_id uuid,
  source_discrepancy_id uuid,
  frozen_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (session_id, workspace_id) references public.cycle_count_sessions(id, workspace_id),
  foreign key (round_id, workspace_id) references public.cycle_count_rounds(id, workspace_id),
  foreign key (source_discrepancy_id, workspace_id)
    references public.cycle_count_discrepancies(id, workspace_id),
  constraint cycle_count_round_subject_identity check (
    (subject_type = 'item' and item_id is not null and lot_id is null) or
    (subject_type = 'lot' and lot_id is not null and item_id is null)
  )
);
create unique index cycle_count_round_subject_item_once
  on public.cycle_count_round_subjects(round_id, item_id) where item_id is not null;
create unique index cycle_count_round_subject_lot_once
  on public.cycle_count_round_subjects(round_id, lot_id) where lot_id is not null;
create trigger cycle_count_round_subjects_append_only
  before update or delete on public.cycle_count_round_subjects
  for each row execute function app.forbid_update_delete();

create table public.cycle_count_observation_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  session_id uuid not null,
  round_id uuid not null,
  idempotency_key uuid not null,
  subject_type public.cycle_count_subject_type not null,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{32}$'),
  outcome text not null check (outcome in (
    'accepted', 'idempotent_replay', 'subject_already_observed',
    'idempotency_conflict', 'unknown_subject', 'out_of_scope', 'closed_round')),
  item_observation_id uuid,
  lot_observation_id uuid,
  attempted_by uuid not null references auth.users(id) on delete restrict,
  attempted_at timestamptz not null default now(),
  detail_code text,
  unique (id, workspace_id),
  foreign key (session_id, workspace_id) references public.cycle_count_sessions(id, workspace_id),
  foreign key (round_id, workspace_id) references public.cycle_count_rounds(id, workspace_id)
);
create index cycle_count_observation_attempts_key_idx
  on public.cycle_count_observation_attempts(workspace_id,idempotency_key,attempted_at);
create trigger cycle_count_observation_attempts_append_only
  before update or delete on public.cycle_count_observation_attempts
  for each row execute function app.forbid_update_delete();

-- One canonical winner per client key; attempts are separate so exact replays
-- and conflicting reuse remain append-only facts instead of being overwritten.
create table public.cycle_count_observation_idempotency (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  idempotency_key uuid not null,
  session_id uuid not null,
  round_id uuid not null,
  subject_type public.cycle_count_subject_type not null,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{32}$'),
  canonical_outcome text not null,
  item_observation_id uuid,
  lot_observation_id uuid,
  created_at timestamptz not null default now(),
  primary key (workspace_id,idempotency_key),
  foreign key (session_id,workspace_id) references public.cycle_count_sessions(id,workspace_id),
  foreign key (round_id,workspace_id) references public.cycle_count_rounds(id,workspace_id)
);
create trigger cycle_count_observation_idempotency_append_only
  before update or delete on public.cycle_count_observation_idempotency
  for each row execute function app.forbid_update_delete();

alter table public.cycle_count_item_observations add column idempotency_key uuid;
alter table public.cycle_count_lot_observations add column idempotency_key uuid;
create unique index cycle_count_item_observation_idempotency
  on public.cycle_count_item_observations(workspace_id, idempotency_key)
  where idempotency_key is not null;
create unique index cycle_count_lot_observation_idempotency
  on public.cycle_count_lot_observations(workspace_id, idempotency_key)
  where idempotency_key is not null;

create function app.cycle_count_require_reviewer(p_workspace_id uuid)
returns uuid language plpgsql stable set search_path = '' as $$
declare v_uid uuid;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  if app.member_role(p_workspace_id) <> 'owner' then
    raise exception 'reviewer authority required' using errcode = '42501';
  end if;
  return v_uid;
end $$;
revoke all on function app.cycle_count_require_reviewer(uuid) from public, anon, authenticated;

-- The legacy start RPC freezes expected rows before changing session status.
-- This BEFORE trigger therefore creates the initial explicit round and scope in
-- the same transaction, without asking callers to supply or derive a number.
create function app.cycle_count_create_initial_round()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_round_id uuid;
begin
  if old.status = 'draft' and new.status = 'in_progress' then
    insert into public.cycle_count_rounds (
      workspace_id, session_id, public_id, round_number, round_type, status,
      created_by, created_at, started_by, started_at)
    values (new.workspace_id, new.id, app.mint_governed_public_id('RV-CCR'),
      1, 'initial', 'counting', new.created_by, new.created_at,
      new.started_by, new.started_at)
    returning id into v_round_id;

    insert into public.cycle_count_round_subjects (
      workspace_id, session_id, round_id, subject_type, expected_item_id, item_id)
    select new.workspace_id, new.id, v_round_id, 'item', e.id, e.item_id
    from public.cycle_count_expected_items e where e.session_id = new.id;
    insert into public.cycle_count_round_subjects (
      workspace_id, session_id, round_id, subject_type, expected_lot_id, lot_id)
    select new.workspace_id, new.id, v_round_id, 'lot', e.id, e.lot_id
    from public.cycle_count_expected_lots e where e.session_id = new.id;
    insert into public.cycle_count_round_lifecycle_events (
      workspace_id, session_id, round_id, from_status, to_status, actor_id)
    values (new.workspace_id, new.id, v_round_id, 'draft', 'counting', new.started_by);
    new.current_round_id := v_round_id;
  end if;
  return new;
end $$;
create trigger cycle_count_sessions_initial_round
  before update on public.cycle_count_sessions
  for each row execute function app.cycle_count_create_initial_round();

-- Serialize the legacy submission transition into the explicit round while it
-- is being replaced. The session row is already locked by the submit RPC.
create function app.cycle_count_mirror_round_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_round public.cycle_count_rounds%rowtype;
begin
  if new.current_round_id is null or new.status = old.status then return new; end if;
  select * into v_round from public.cycle_count_rounds where id=new.current_round_id for update;
  if old.status='in_progress' and new.status='review' then
    update public.cycle_count_rounds set status='submitted',submitted_by=new.submitted_by,
      submitted_at=new.submitted_at where id=v_round.id;
    insert into public.cycle_count_round_lifecycle_events
      (workspace_id,session_id,round_id,from_status,to_status,actor_id)
    values (new.workspace_id,new.id,v_round.id,v_round.status,'submitted',new.submitted_by);
  elsif new.status='cancelled' and v_round.status in ('draft','counting') then
    update public.cycle_count_rounds set status='cancelled' where id=v_round.id;
    insert into public.cycle_count_round_lifecycle_events
      (workspace_id,session_id,round_id,from_status,to_status,actor_id,reason)
    values (new.workspace_id,new.id,v_round.id,v_round.status,'cancelled',new.cancelled_by,
      new.cancellation_reason);
  end if;
  return new;
end $$;
create trigger cycle_count_sessions_mirror_round_transition
  after update on public.cycle_count_sessions
  for each row execute function app.cycle_count_mirror_round_transition();

create function public.mark_cycle_count_discrepancies_for_recount(
  p_workspace_id uuid, p_session_id uuid, p_discrepancy_ids uuid[], p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_session public.cycle_count_sessions%rowtype;
        v_requested int; v_eligible int; v_inserted int;
begin
  v_uid := app.cycle_count_require_reviewer(p_workspace_id);
  if nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception 'a recount selection needs a reason' using errcode = '23514';
  end if;
  v_requested := coalesce(cardinality(p_discrepancy_ids), 0);
  if v_requested = 0 or v_requested <> (select count(distinct x) from unnest(p_discrepancy_ids) x) then
    raise exception 'select at least one unique discrepancy' using errcode = '23514';
  end if;
  select * into v_session from public.cycle_count_sessions
   where id = p_session_id and workspace_id = p_workspace_id for update;
  if v_session.id is null then
    raise exception 'cycle count not found in this workspace' using errcode = '23514';
  end if;
  if v_session.status <> 'review' then
    raise exception 'recount selection is only available in review' using errcode = '23514';
  end if;
  select count(*) into v_eligible from public.cycle_count_discrepancies d
   where d.session_id = p_session_id and d.workspace_id = p_workspace_id
     and d.id = any(p_discrepancy_ids) and d.status = 'open'
     and d.superseded_by_discrepancy_id is null;
  if v_eligible <> v_requested then
    raise exception 'one or more discrepancies are not eligible' using errcode = '23514';
  end if;
  insert into public.cycle_count_recount_selections (
    workspace_id, session_id, discrepancy_id, selected_by, reason)
  select p_workspace_id, p_session_id, x, v_uid, btrim(p_reason)
  from unnest(p_discrepancy_ids) x
  on conflict (session_id, discrepancy_id) do nothing;
  get diagnostics v_inserted = row_count;
  return jsonb_build_object('outcome','selected','selected_count',v_inserted,
    'total_pending_count',(select count(*) from public.cycle_count_recount_selections
      where session_id=p_session_id and assigned_round_id is null));
end $$;
revoke all on function public.mark_cycle_count_discrepancies_for_recount(uuid,uuid,uuid[],text)
  from public, anon;
grant execute on function public.mark_cycle_count_discrepancies_for_recount(uuid,uuid,uuid[],text)
  to authenticated;

create function public.begin_cycle_count_recount(
  p_workspace_id uuid, p_session_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_session public.cycle_count_sessions%rowtype;
        v_prior public.cycle_count_rounds%rowtype; v_round_id uuid;
        v_round_number int; v_selected int;
begin
  v_uid := app.cycle_count_require_reviewer(p_workspace_id);
  if nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception 'beginning a recount needs a reason' using errcode = '23514';
  end if;
  select * into v_session from public.cycle_count_sessions
   where id=p_session_id and workspace_id=p_workspace_id for update;
  if v_session.id is null then
    raise exception 'cycle count not found in this workspace' using errcode = '23514';
  end if;
  if v_session.status <> 'review' then
    raise exception 'a recount can only begin from review' using errcode = '23514';
  end if;
  select * into v_prior from public.cycle_count_rounds
   where id=v_session.current_round_id and workspace_id=p_workspace_id for update;
  if v_prior.id is null or v_prior.status not in ('submitted','reviewed') then
    raise exception 'the current round is not reviewable' using errcode = '23514';
  end if;
  select count(*) into v_selected from public.cycle_count_recount_selections
   where session_id=p_session_id and assigned_round_id is null;
  if v_selected = 0 then
    raise exception 'select at least one discrepancy before beginning a recount'
      using errcode = '23514';
  end if;
  v_round_number := v_prior.round_number + 1;
  insert into public.cycle_count_rounds (
    workspace_id,session_id,public_id,round_number,round_type,status,parent_round_id,
    reason,created_by,started_by,started_at)
  values (p_workspace_id,p_session_id,app.mint_governed_public_id('RV-CCR'),
    v_round_number,'recount','counting',v_prior.id,btrim(p_reason),v_uid,v_uid,now())
  returning id into v_round_id;
  insert into public.cycle_count_round_subjects (
    workspace_id,session_id,round_id,subject_type,expected_item_id,expected_lot_id,
    item_id,lot_id,source_discrepancy_id)
  select p_workspace_id,p_session_id,v_round_id,
    case when d.item_id is not null then 'item' else 'lot' end::public.cycle_count_subject_type,
    d.expected_item_id,d.expected_lot_id,d.item_id,d.lot_id,d.id
  from public.cycle_count_recount_selections s
  join public.cycle_count_discrepancies d on d.id=s.discrepancy_id
  where s.session_id=p_session_id and s.assigned_round_id is null;
  update public.cycle_count_recount_selections set assigned_round_id=v_round_id
   where session_id=p_session_id and assigned_round_id is null;
  update public.cycle_count_discrepancies d
    set status='recount_requested',recount_requested_at=now(),recount_requested_by=v_uid
   where exists (select 1 from public.cycle_count_round_subjects rs
     where rs.round_id=v_round_id and rs.source_discrepancy_id=d.id);
  update public.cycle_count_rounds set status='reviewed' where id=v_prior.id;
  insert into public.cycle_count_round_lifecycle_events
    (workspace_id,session_id,round_id,from_status,to_status,actor_id,reason)
  values (p_workspace_id,p_session_id,v_prior.id,v_prior.status,'reviewed',v_uid,btrim(p_reason)),
         (p_workspace_id,p_session_id,v_round_id,'draft','counting',v_uid,btrim(p_reason));
  update public.cycle_count_sessions set status='in_progress',current_round_id=v_round_id,
    updated_at=now() where id=p_session_id;
  return jsonb_build_object('outcome','recount_started','round_id',v_round_id,
    'round_number',v_round_number,'subject_count',v_selected,'blind',true);
end $$;
revoke all on function public.begin_cycle_count_recount(uuid,uuid,text) from public,anon;
grant execute on function public.begin_cycle_count_recount(uuid,uuid,text) to authenticated;

-- Retire the unsafe one-click recount entry point. Existing clients receive a
-- structured migration direction without any lifecycle mutation.
create or replace function public.request_cycle_count_recount(
  p_workspace_id uuid, p_discrepancy_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.cycle_count_require_reviewer(p_workspace_id);
  return jsonb_build_object('outcome','operation_replaced','code','RECOUNT_SELECTION_REQUIRED',
    'message','select all discrepancies, then begin one recount round');
end $$;

alter table public.cycle_count_round_subjects enable row level security;
alter table public.cycle_count_observation_attempts enable row level security;
alter table public.cycle_count_observation_idempotency enable row level security;
revoke all on table public.cycle_count_round_subjects,public.cycle_count_observation_attempts,
  public.cycle_count_observation_idempotency
  from public,anon,authenticated;

insert into public.schema_migrations_log(migration_name)
values ('20260730000200_cycle_count_round_lifecycle');
