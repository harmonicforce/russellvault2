-- Immutable round evaluation, successor discrepancies, and governed reads.

create table public.cycle_count_round_item_attestations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  session_id uuid not null,
  round_id uuid not null,
  item_id uuid not null,
  attestation text not null check (attestation in ('not_found','unable_to_count')),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  idempotency_key uuid not null,
  attested_by uuid not null references auth.users(id) on delete restrict,
  attested_at timestamptz not null default now(),
  unique (id,workspace_id), unique (round_id,item_id), unique (workspace_id,idempotency_key),
  foreign key (session_id,workspace_id) references public.cycle_count_sessions(id,workspace_id),
  foreign key (round_id,workspace_id) references public.cycle_count_rounds(id,workspace_id),
  foreign key (item_id,workspace_id) references public.inventory_items(id,workspace_id)
);
create trigger cycle_count_round_item_attestations_append_only before update or delete
  on public.cycle_count_round_item_attestations for each row execute function app.forbid_update_delete();
alter table public.cycle_count_round_item_attestations enable row level security;
revoke all on public.cycle_count_round_item_attestations from public,anon,authenticated;

alter table public.cycle_count_round_results add column item_attestation_id uuid;
alter table public.cycle_count_round_results add constraint cycle_count_round_results_attestation_fk
  foreign key (item_attestation_id,workspace_id)
  references public.cycle_count_round_item_attestations(id,workspace_id);
alter table public.cycle_count_round_results add constraint cycle_count_round_results_one_item_evidence
  check (not (item_observation_id is not null and item_attestation_id is not null));

-- An absence attestation is immutable evidence. Do not allow a later scan to
-- create contradictory evidence for the same round and subject.
create function app.reject_observation_after_item_attestation()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists (select 1 from public.cycle_count_round_item_attestations a
    where a.round_id=new.round_id and a.item_id=new.item_id) then
    raise exception 'item already has an absence attestation in this round'
      using errcode='23514';
  end if;
  return new;
end $$;
create trigger cycle_count_item_observation_attestation_guard
  before insert on public.cycle_count_item_observations for each row
  execute function app.reject_observation_after_item_attestation();

create function public.list_current_cycle_count_observations(p_workspace_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid;v_round_id uuid;v_rows jsonb;
begin
 v_uid:=app.cycle_count_require_counter(p_workspace_id);
 select current_round_id into v_round_id from public.cycle_count_sessions
  where id=p_session_id and workspace_id=p_workspace_id and status='in_progress';
 if v_round_id is null then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(x order by x.recorded_at desc),'[]'::jsonb) into v_rows from (
  select o.id,'item'::text subject_kind,i.public_id subject_public_id,
    l.location_code detail,o.observed_at recorded_at
  from public.cycle_count_item_observations o
  join public.inventory_items i on i.id=o.item_id and i.workspace_id=p_workspace_id
  join public.storage_locations l on l.id=o.observed_location_id and l.workspace_id=p_workspace_id
  where o.round_id=v_round_id and o.voided_at is null
  union all
  select o.id,'lot',l.public_id,o.observed_quantity::text,o.observed_at
  from public.cycle_count_lot_observations o
  join public.inventory_lots l on l.id=o.lot_id and l.workspace_id=p_workspace_id
  where o.round_id=v_round_id and o.voided_at is null
 ) x;
 return v_rows;
end $$;
revoke all on function public.list_current_cycle_count_observations(uuid,uuid) from public,anon;
grant execute on function public.list_current_cycle_count_observations(uuid,uuid) to authenticated;

create function public.attest_cycle_count_item_absence(
  p_workspace_id uuid,p_session_id uuid,p_item_public_id text,p_attestation text,
  p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_session public.cycle_count_sessions%rowtype;
  v_round public.cycle_count_rounds%rowtype; v_item_id uuid; v_id uuid;
  v_fingerprint text; v_key public.cycle_count_observation_idempotency%rowtype;
begin
  v_uid:=app.cycle_count_require_counter(p_workspace_id);
  if p_idempotency_key is null then raise exception 'an idempotency key is required' using errcode='23514'; end if;
  if p_attestation not in ('not_found','unable_to_count') or nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'a governed absence and reason are required' using errcode='23514';
  end if;
  v_fingerprint:=md5(jsonb_build_array(p_session_id,'item_attestation',p_item_public_id,p_attestation,btrim(p_reason))::text);
  select * into v_session from public.cycle_count_sessions where id=p_session_id and workspace_id=p_workspace_id for update;
  if v_session.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
  select * into v_round from public.cycle_count_rounds where id=v_session.current_round_id and workspace_id=p_workspace_id for update;
  if v_session.status<>'in_progress' or v_round.status<>'counting' then
    return jsonb_build_object('outcome','closed_round','code','ROUND_NOT_COUNTING');
  end if;
  select * into v_key from public.cycle_count_observation_idempotency where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if v_key.idempotency_key is not null then
    if v_key.payload_fingerprint<>v_fingerprint or v_key.round_id<>v_round.id then
      perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
        p_idempotency_key,'item',v_fingerprint,'idempotency_conflict',v_uid,null,null,'KEY_PAYLOAD_MISMATCH');
      return jsonb_build_object('outcome','idempotency_conflict','code','IDEMPOTENCY_KEY_REUSED');
    end if;
    perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
      p_idempotency_key,'item',v_fingerprint,'idempotent_replay',v_uid,null,null,'EXACT_REPLAY');
    return jsonb_build_object('outcome','idempotent_replay','canonical_outcome',v_key.canonical_outcome,'round_id',v_round.id);
  end if;
  select rs.item_id into v_item_id from public.cycle_count_round_subjects rs
  join public.inventory_items i on i.id=rs.item_id and i.workspace_id=p_workspace_id
  where rs.round_id=v_round.id and i.public_id=p_item_public_id and rs.subject_type='item';
  if v_item_id is null then return jsonb_build_object('outcome','out_of_scope','code','SUBJECT_NOT_IN_ROUND'); end if;
  if exists (select 1 from public.cycle_count_item_observations where round_id=v_round.id and item_id=v_item_id and voided_at is null) then
    return jsonb_build_object('outcome','subject_already_observed','code','SUBJECT_ALREADY_OBSERVED');
  end if;
  insert into public.cycle_count_round_item_attestations
    (workspace_id,session_id,round_id,item_id,attestation,reason,idempotency_key,attested_by)
  values (p_workspace_id,p_session_id,v_round.id,v_item_id,p_attestation,btrim(p_reason),p_idempotency_key,v_uid)
  on conflict (round_id,item_id) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('outcome','subject_already_observed','code','SUBJECT_ALREADY_ATTESTED'); end if;
  insert into public.cycle_count_observation_idempotency
    (workspace_id,idempotency_key,session_id,round_id,subject_type,payload_fingerprint,canonical_outcome)
  values (p_workspace_id,p_idempotency_key,p_session_id,v_round.id,'item',v_fingerprint,'accepted');
  perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
    p_idempotency_key,'item',v_fingerprint,'accepted',v_uid,null,null,'ABSENCE_ATTESTED');
  return jsonb_build_object('outcome','accepted','attestation_id',v_id,'round_id',v_round.id,'round_number',v_round.round_number);
end $$;
revoke all on function public.attest_cycle_count_item_absence(uuid,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.attest_cycle_count_item_absence(uuid,uuid,text,text,text,uuid) to authenticated;

alter table public.cycle_count_round_results
  add constraint cycle_count_round_results_item_observation_fk
    foreign key (item_observation_id,workspace_id)
    references public.cycle_count_item_observations(id,workspace_id),
  add constraint cycle_count_round_results_lot_observation_fk
    foreign key (lot_observation_id,workspace_id)
    references public.cycle_count_lot_observations(id,workspace_id);

-- Review sessions evaluated by the legacy submit function already have
-- discrepancies. Give each one an immutable result in its migrated initial
-- round so governed reads and resolution attempts retain their provenance.
do $$
declare d public.cycle_count_discrepancies%rowtype;v_round_id uuid;v_result_id uuid;
  v_item_observation uuid;v_lot_observation uuid;
begin
 for d in select * from public.cycle_count_discrepancies where round_result_id is null loop
  select current_round_id into v_round_id from public.cycle_count_sessions where id=d.session_id;
  if v_round_id is null then continue; end if;
  select id into v_item_observation from public.cycle_count_item_observations
   where round_id=v_round_id and item_id=d.item_id and voided_at is null limit 1;
  select id into v_lot_observation from public.cycle_count_lot_observations
   where round_id=v_round_id and lot_id=d.lot_id and voided_at is null limit 1;
  insert into public.cycle_count_round_results(
   workspace_id,session_id,round_id,subject_type,expected_item_id,expected_lot_id,item_id,lot_id,
   item_observation_id,lot_observation_id,expected_present,expected_location_id,
   observed_location_id,expected_quantity,observed_quantity,computed_variance,classification)
  values(d.workspace_id,d.session_id,v_round_id,
   case when d.item_id is not null then 'item' else 'lot' end::public.cycle_count_subject_type,
   d.expected_item_id,d.expected_lot_id,d.item_id,d.lot_id,v_item_observation,v_lot_observation,
   d.discrepancy_kind<>'item_unexpected',d.expected_location_id,d.observed_location_id,
   d.expected_quantity,d.observed_quantity,
   case when d.expected_quantity is not null and d.observed_quantity is not null
    then d.observed_quantity-d.expected_quantity end,
   case d.discrepancy_kind when 'item_missing' then 'missing'
    when 'item_unexpected' then 'unexpected' when 'item_wrong_location' then 'wrong_location'
    when 'lot_shortage' then 'shortage' when 'lot_overage' then 'overage'
    else 'uncounted' end::public.cycle_count_round_result_classification)
  on conflict do nothing returning id into v_result_id;
  if v_result_id is null then
   select id into v_result_id from public.cycle_count_round_results
    where round_id=v_round_id and
     ((d.item_id is not null and item_id=d.item_id) or (d.lot_id is not null and lot_id=d.lot_id));
  end if;
  update public.cycle_count_discrepancies set round_result_id=v_result_id where id=d.id;
 end loop;
end $$;

create function app.cycle_count_kind_for_result(
  p_subject_type public.cycle_count_subject_type,
  p_expected_present boolean, p_expected_location uuid, p_observed_location uuid,
  p_expected_quantity integer, p_observed_quantity integer)
returns public.cycle_count_discrepancy_kind language sql immutable set search_path='' as $$
  select case
    when p_subject_type='item' and coalesce(p_expected_present,true) and p_observed_location is null
      then 'item_missing'::public.cycle_count_discrepancy_kind
    when p_subject_type='item' and not coalesce(p_expected_present,true)
      then 'item_unexpected'::public.cycle_count_discrepancy_kind
    when p_subject_type='item' and p_expected_location is distinct from p_observed_location
      then 'item_wrong_location'::public.cycle_count_discrepancy_kind
    when p_subject_type='lot' and p_observed_quantity is null
      then 'lot_uncounted'::public.cycle_count_discrepancy_kind
    when p_subject_type='lot' and p_observed_quantity < p_expected_quantity
      then 'lot_shortage'::public.cycle_count_discrepancy_kind
    when p_subject_type='lot' and p_observed_quantity > p_expected_quantity
      then 'lot_overage'::public.cycle_count_discrepancy_kind
  end
$$;
revoke all on function app.cycle_count_kind_for_result(
  public.cycle_count_subject_type,boolean,uuid,uuid,integer,integer)
  from public,anon,authenticated;

create function public.submit_cycle_count_round(
  p_workspace_id uuid, p_session_id uuid, p_confirm_uncounted boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid; v_session public.cycle_count_sessions%rowtype;
  v_round public.cycle_count_rounds%rowtype; v_missing_items int; v_missing_lots int;
  v_result_count int; v_discrepancy_count int;
begin
  v_uid:=app.cycle_count_require_counter(p_workspace_id);
  select * into v_session from public.cycle_count_sessions
   where id=p_session_id and workspace_id=p_workspace_id for update;
  if v_session.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
  select * into v_round from public.cycle_count_rounds
   where id=v_session.current_round_id and workspace_id=p_workspace_id for update;
  if v_round.id is null then raise exception 'cycle count has no active round' using errcode='23514'; end if;
  if v_session.status='review' and v_round.status='submitted' then
    return jsonb_build_object('outcome','already_submitted','round_id',v_round.id,
      'round_number',v_round.round_number);
  end if;
  if v_session.status<>'in_progress' or v_round.status<>'counting' then
    return jsonb_build_object('outcome','closed_round','code','ROUND_NOT_COUNTING');
  end if;

  select count(*) filter (where rs.subject_type='item' and io.id is null and ia.id is null)::int,
         count(*) filter (where rs.subject_type='lot' and lo.id is null)::int
    into v_missing_items,v_missing_lots
  from public.cycle_count_round_subjects rs
  left join public.cycle_count_item_observations io
    on io.round_id=rs.round_id and io.item_id=rs.item_id and io.voided_at is null
  left join public.cycle_count_lot_observations lo
    on lo.round_id=rs.round_id and lo.lot_id=rs.lot_id and lo.voided_at is null
  left join public.cycle_count_round_item_attestations ia
    on ia.round_id=rs.round_id and ia.item_id=rs.item_id
  where rs.round_id=v_round.id;

  if v_round.round_type='recount' and (v_missing_items>0 or v_missing_lots>0) then
    return jsonb_build_object('outcome','incomplete_round','code','RECOUNT_SCOPE_INCOMPLETE',
      'missing_item_count',v_missing_items,'missing_lot_count',v_missing_lots);
  end if;
  if v_round.round_type='initial' and (v_missing_items>0 or v_missing_lots>0)
     and not coalesce(p_confirm_uncounted,false) then
    return jsonb_build_object('outcome','confirmation_required','code','UNCOUNTED_SUBJECTS',
      'uncounted_item_count',v_missing_items,'uncounted_lot_count',v_missing_lots);
  end if;

  -- Results for every frozen subject. Predecessors come from the discrepancy
  -- that selected a recount subject, never from mutable discrepancy status.
  insert into public.cycle_count_round_results (
    workspace_id,session_id,round_id,subject_type,expected_item_id,expected_lot_id,
    item_id,lot_id,item_observation_id,lot_observation_id,item_attestation_id,expected_present,
    expected_location_id,observed_location_id,expected_quantity,observed_quantity,
    computed_variance,classification,post_snapshot_classification,predecessor_result_id)
  select p_workspace_id,p_session_id,v_round.id,rs.subject_type,rs.expected_item_id,
    rs.expected_lot_id,rs.item_id,rs.lot_id,io.id,lo.id,ia.id,
    (rs.expected_item_id is not null or rs.expected_lot_id is not null),
    coalesce(ei.expected_location_id,el.expected_location_id),io.observed_location_id,
    el.expected_quantity,lo.observed_quantity,
    case when lo.id is not null then lo.observed_quantity-el.expected_quantity end,
    case
      when v_round.round_type='initial' and rs.subject_type='item' and io.id is null then 'missing'
      when v_round.round_type='initial' and rs.subject_type='item'
        and io.observed_location_id=ei.expected_location_id then 'matched'
      when v_round.round_type='initial' and rs.subject_type='item' then 'wrong_location'
      when v_round.round_type='initial' and rs.subject_type='lot' and lo.id is null then 'uncounted'
      when v_round.round_type='initial' and lo.observed_quantity=el.expected_quantity then 'matched'
      when v_round.round_type='initial' and lo.observed_quantity<el.expected_quantity then 'shortage'
      when v_round.round_type='initial' then 'overage'
      when rs.subject_type='item' and ia.attestation='not_found'
        and pr.observed_location_id is null then 'confirmed_after_recount'
      when rs.subject_type='item' and ia.id is not null then 'unresolved_after_recount'
      when rs.subject_type='item' and io.observed_location_id=ei.expected_location_id
        then 'matched_after_recount'
      when rs.subject_type='item' and io.observed_location_id=pr.observed_location_id
        then 'confirmed_after_recount'
      when rs.subject_type='item' then 'changed_after_recount'
      when lo.observed_quantity=el.expected_quantity then 'matched_after_recount'
      when lo.observed_quantity=pr.observed_quantity then 'confirmed_after_recount'
      else 'changed_after_recount'
    end::public.cycle_count_round_result_classification,
    case
      when rs.subject_type='item' and i.item_state::text is distinct from ei.item_state::text
        then 'item_state_changed'
      when rs.subject_type='item' and i.location_id is distinct from ei.expected_location_id
        then 'location_changed'
      when rs.subject_type='lot' and l.quantity is distinct from el.expected_quantity
        then 'quantity_changed'
      else 'none'
    end::public.cycle_count_post_snapshot_classification,
    d.round_result_id
  from public.cycle_count_round_subjects rs
  left join public.cycle_count_expected_items ei on ei.id=rs.expected_item_id
  left join public.cycle_count_expected_lots el on el.id=rs.expected_lot_id
  left join public.cycle_count_item_observations io
    on io.round_id=rs.round_id and io.item_id=rs.item_id and io.voided_at is null
  left join public.cycle_count_lot_observations lo
    on lo.round_id=rs.round_id and lo.lot_id=rs.lot_id and lo.voided_at is null
  left join public.cycle_count_round_item_attestations ia
    on ia.round_id=rs.round_id and ia.item_id=rs.item_id
  left join public.cycle_count_discrepancies d on d.id=rs.source_discrepancy_id
  left join public.cycle_count_round_results pr on pr.id=d.round_result_id
  left join public.inventory_items i on i.id=rs.item_id
  left join public.inventory_lots l on l.id=rs.lot_id
  where rs.round_id=v_round.id;

  -- Unexpected initial sightings are results too, but not part of expected
  -- progress. The frozen expected snapshot remains unchanged.
  insert into public.cycle_count_round_results (
    workspace_id,session_id,round_id,subject_type,item_id,item_observation_id,
    expected_present,observed_location_id,classification)
  select p_workspace_id,p_session_id,v_round.id,'item',io.item_id,io.id,false,
    io.observed_location_id,'unexpected'
  from public.cycle_count_item_observations io
  where v_round.round_type='initial' and io.round_id=v_round.id
    and io.voided_at is null and io.expected_item_id is null
    and not exists (select 1 from public.cycle_count_round_subjects rs
      where rs.round_id=v_round.id and rs.item_id=io.item_id);

  if v_round.round_type='initial' then
    insert into public.cycle_count_discrepancies (
      session_id,workspace_id,public_id,discrepancy_kind,status,expected_item_id,
      expected_lot_id,item_id,lot_id,expected_quantity,observed_quantity,
      expected_location_id,observed_location_id,round_result_id)
    select p_session_id,p_workspace_id,app.mint_governed_public_id('RV-CCD'),
      app.cycle_count_kind_for_result(r.subject_type,r.expected_present,
        r.expected_location_id,r.observed_location_id,r.expected_quantity,r.observed_quantity),
      'open',r.expected_item_id,r.expected_lot_id,r.item_id,r.lot_id,
      r.expected_quantity,r.observed_quantity,r.expected_location_id,r.observed_location_id,r.id
    from public.cycle_count_round_results r
    where r.round_id=v_round.id and r.classification<>'matched';
  else
    -- Matched recounts close their historical discrepancy without deleting it.
    update public.cycle_count_discrepancies d set status='resolved',resolved_at=now(),
      resolved_by=v_uid,recount_outcome='matched_after_recount'
    from public.cycle_count_round_subjects rs
    join public.cycle_count_round_results r on r.round_id=rs.round_id
      and ((r.item_id=rs.item_id and rs.item_id is not null) or
           (r.lot_id=rs.lot_id and rs.lot_id is not null))
    where rs.round_id=v_round.id and d.id=rs.source_discrepancy_id
      and r.classification='matched_after_recount';

    with successors as (
      insert into public.cycle_count_discrepancies (
        session_id,workspace_id,public_id,discrepancy_kind,status,expected_item_id,
        expected_lot_id,item_id,lot_id,expected_quantity,observed_quantity,
        expected_location_id,observed_location_id,round_result_id,recount_outcome)
      select p_session_id,p_workspace_id,app.mint_governed_public_id('RV-CCD'),
        app.cycle_count_kind_for_result(r.subject_type,r.expected_present,
          r.expected_location_id,r.observed_location_id,r.expected_quantity,r.observed_quantity),
        'open',r.expected_item_id,r.expected_lot_id,r.item_id,r.lot_id,
        r.expected_quantity,r.observed_quantity,r.expected_location_id,r.observed_location_id,
        r.id,r.classification
      from public.cycle_count_round_subjects rs
      join public.cycle_count_round_results r on r.round_id=rs.round_id
        and ((r.item_id=rs.item_id and rs.item_id is not null) or
             (r.lot_id=rs.lot_id and rs.lot_id is not null))
      where rs.round_id=v_round.id and r.classification<>'matched_after_recount'
      returning id,round_result_id
    )
    update public.cycle_count_discrepancies prior set status='resolved',resolved_at=now(),
      resolved_by=v_uid,superseded_by_discrepancy_id=s.id,
      recount_outcome=r.classification
    from successors s
    join public.cycle_count_round_results r on r.id=s.round_result_id
    join public.cycle_count_round_subjects rs on rs.round_id=r.round_id
      and ((rs.item_id=r.item_id and r.item_id is not null) or
           (rs.lot_id=r.lot_id and r.lot_id is not null))
    where prior.id=rs.source_discrepancy_id;
  end if;

  select count(*)::int into v_result_count from public.cycle_count_round_results where round_id=v_round.id;
  select count(*)::int into v_discrepancy_count from public.cycle_count_discrepancies
   where session_id=p_session_id and status='open' and superseded_by_discrepancy_id is null;
  -- Updating the session invokes the lifecycle mirror while holding both locks;
  -- it marks exactly this round submitted and appends the transition event.
  update public.cycle_count_sessions set status='review',submitted_by=v_uid,
    submitted_at=now(),updated_at=now() where id=p_session_id;
  return jsonb_build_object('outcome','submitted','round_id',v_round.id,
    'round_number',v_round.round_number,'result_count',v_result_count,
    'active_discrepancy_count',v_discrepancy_count);
end $$;

revoke all on function public.submit_cycle_count_for_review(uuid,uuid,boolean) from authenticated;
revoke all on function public.submit_cycle_count_round(uuid,uuid,boolean) from public,anon;
grant execute on function public.submit_cycle_count_round(uuid,uuid,boolean) to authenticated;

create view public.cycle_count_latest_round_results with (security_invoker=true) as
select distinct on (r.session_id,r.subject_type,coalesce(r.item_id,r.lot_id)) r.*
from public.cycle_count_round_results r
join public.cycle_count_rounds cr on cr.id=r.round_id
where cr.status in ('submitted','reviewed','closed')
order by r.session_id,r.subject_type,coalesce(r.item_id,r.lot_id),cr.round_number desc;
revoke all on public.cycle_count_latest_round_results from public,anon,authenticated;

create function public.list_cycle_count_round_results(
  p_workspace_id uuid,p_session_id uuid,p_round_id uuid default null)
returns setof public.cycle_count_round_results language plpgsql security definer
stable set search_path='' as $$
declare v_uid uuid; v_session public.cycle_count_sessions%rowtype;
begin
  v_uid:=app.cycle_count_require_reviewer(p_workspace_id);
  select * into v_session from public.cycle_count_sessions
   where id=p_session_id and workspace_id=p_workspace_id;
  if v_session.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
  if v_session.status='in_progress' then
    raise exception 'expected results remain blind while counting' using errcode='42501';
  end if;
  return query select r.* from public.cycle_count_round_results r
   where r.workspace_id=p_workspace_id and r.session_id=p_session_id
     and (p_round_id is null or r.round_id=p_round_id)
   order by r.evaluated_at,r.id;
end $$;
revoke all on function public.list_cycle_count_round_results(uuid,uuid,uuid) from public,anon;
grant execute on function public.list_cycle_count_round_results(uuid,uuid,uuid) to authenticated;

create function public.get_cycle_count_round_progress(p_workspace_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare v_uid uuid; v_session public.cycle_count_sessions%rowtype;
  v_round public.cycle_count_rounds%rowtype; v_items int; v_lots int; v_expected int;
  v_history int; v_total_observations int; v_hide_expected boolean;
begin
  v_uid:=app.cycle_count_require_counter(p_workspace_id);
  select * into v_session from public.cycle_count_sessions
   where id=p_session_id and workspace_id=p_workspace_id;
  if v_session.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
  select * into v_round from public.cycle_count_rounds where id=v_session.current_round_id;
  select count(*)::int into v_expected from public.cycle_count_round_subjects where round_id=v_round.id;
  select count(*)::int into v_items from public.cycle_count_item_observations
   where round_id=v_round.id and voided_at is null;
  select count(*)::int into v_lots from public.cycle_count_lot_observations
   where round_id=v_round.id and voided_at is null;
  select count(*)::int into v_history from public.cycle_count_rounds where session_id=p_session_id;
  select ((select count(*) from public.cycle_count_item_observations where session_id=p_session_id)+
          (select count(*) from public.cycle_count_lot_observations where session_id=p_session_id))::int
    into v_total_observations;
  v_hide_expected:=v_session.blind_count and v_session.status='in_progress';
  return jsonb_build_object('round_id',v_round.id,'round_number',v_round.round_number,
    'round_type',v_round.round_type,'round_status',v_round.status,
    'current_round_expected_subject_count',case when v_hide_expected then null else v_expected end,
    'current_round_observed_item_count',v_items,'current_round_observed_lot_count',v_lots,
    'current_round_remaining_count',case when v_hide_expected then null else greatest(v_expected-v_items-v_lots,0) end,
    'historical_round_count',v_history,'total_historical_observations',v_total_observations,
    'blind',v_hide_expected);
end $$;
revoke all on function public.get_cycle_count_round_progress(uuid,uuid) from public,anon;
grant execute on function public.get_cycle_count_round_progress(uuid,uuid) to authenticated;

insert into public.schema_migrations_log(migration_name)
values ('20260730000400_cycle_count_round_results');
