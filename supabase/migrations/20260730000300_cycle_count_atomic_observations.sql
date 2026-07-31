-- Round-aware, lifecycle-serialized, client-idempotent observations.

alter table public.cycle_count_observation_attempts
  drop constraint cycle_count_observation_attempts_outcome_check;
alter table public.cycle_count_observation_attempts
  add constraint cycle_count_observation_attempts_outcome_check check (outcome in (
    'accepted','voided','idempotent_replay','subject_already_observed',
    'idempotency_conflict','unknown_subject','out_of_scope','rejected','closed_round'));

create function app.record_cycle_count_observation_attempt(
  p_workspace_id uuid, p_session_id uuid, p_round_id uuid, p_key uuid,
  p_subject_type public.cycle_count_subject_type, p_fingerprint text, p_outcome text,
  p_actor uuid, p_item_observation_id uuid default null,
  p_lot_observation_id uuid default null, p_detail_code text default null)
returns void language sql volatile set search_path = '' as $$
  insert into public.cycle_count_observation_attempts (
    workspace_id,session_id,round_id,idempotency_key,subject_type,payload_fingerprint,
    outcome,item_observation_id,lot_observation_id,attempted_by,detail_code)
  values (p_workspace_id,p_session_id,p_round_id,p_key,p_subject_type,p_fingerprint,
    p_outcome,p_item_observation_id,p_lot_observation_id,p_actor,p_detail_code)
$$;
revoke all on function app.record_cycle_count_observation_attempt(
  uuid,uuid,uuid,uuid,public.cycle_count_subject_type,text,text,uuid,uuid,uuid,text)
  from public,anon,authenticated;

create function public.observe_cycle_count_item(
  p_workspace_id uuid, p_session_id uuid, p_identifier text,
  p_observed_location_code text, p_idempotency_key uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; v_session public.cycle_count_sessions%rowtype;
  v_round public.cycle_count_rounds%rowtype; v_key public.cycle_count_observation_idempotency%rowtype;
  v_item public.inventory_items%rowtype; v_expected public.cycle_count_expected_items%rowtype;
  v_existing public.cycle_count_item_observations%rowtype; v_observation_id uuid;
  v_location_id uuid; v_matches int; v_kind public.cycle_count_item_observation_kind;
  v_identifier text := btrim(coalesce(p_identifier,''));
  v_fingerprint text := md5(jsonb_build_array(p_session_id,'item',btrim(coalesce(p_identifier,'')),
    btrim(coalesce(p_observed_location_code,'')),coalesce(p_note,''))::text);
  v_outcome text; v_detail text;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);
  if p_idempotency_key is null then
    raise exception 'an idempotency key is required' using errcode='23514';
  end if;

  -- All entry-closing transitions take this same lock before the round lock.
  select * into v_session from public.cycle_count_sessions
   where id=p_session_id and workspace_id=p_workspace_id for update;
  if v_session.id is null then
    raise exception 'cycle count not found in this workspace' using errcode='23514';
  end if;
  select * into v_round from public.cycle_count_rounds
   where id=v_session.current_round_id and workspace_id=p_workspace_id for update;
  if v_round.id is null then
    raise exception 'cycle count has no active round' using errcode='23514';
  end if;

  select * into v_key from public.cycle_count_observation_idempotency
   where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if v_key.idempotency_key is not null then
    if v_key.payload_fingerprint <> v_fingerprint or v_key.session_id <> p_session_id
       or v_key.round_id <> v_round.id or v_key.subject_type <> 'item' then
      perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
        p_idempotency_key,'item',v_fingerprint,'idempotency_conflict',v_uid,null,null,'KEY_PAYLOAD_MISMATCH');
      return jsonb_build_object('outcome','idempotency_conflict','code','IDEMPOTENCY_KEY_REUSED');
    end if;
    perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
      p_idempotency_key,'item',v_fingerprint,'idempotent_replay',v_uid,
      v_key.item_observation_id,null,'EXACT_REPLAY');
    return jsonb_build_object('outcome','idempotent_replay','canonical_outcome',v_key.canonical_outcome,
      'observation_id',v_key.item_observation_id,'round_id',v_round.id,
      'round_number',v_round.round_number);
  end if;

  if v_session.status <> 'in_progress' or v_round.status <> 'counting' then
    v_outcome := 'closed_round'; v_detail := 'ROUND_NOT_COUNTING';
  elsif v_identifier='' then
    v_outcome := 'rejected'; v_detail := 'IDENTIFIER_REQUIRED';
  else
    select l.id into v_location_id from public.storage_locations l
    join public.cycle_count_scope_locations sc on sc.location_id=l.id and sc.session_id=p_session_id
    where l.workspace_id=p_workspace_id and l.location_code=p_observed_location_code;
    if v_location_id is null then
      v_outcome := 'out_of_scope'; v_detail := 'LOCATION_OUT_OF_SCOPE';
    else
      select count(*)::int into v_matches from public.inventory_items i
       where i.workspace_id=p_workspace_id and
        (i.public_id=v_identifier or i.scan_sku=v_identifier or
         i.certificate_number=v_identifier or i.serial_number=v_identifier);
      if v_matches=0 then
        v_outcome := 'unknown_subject'; v_detail := 'IDENTIFIER_UNKNOWN';
      elsif v_matches>1 then
        v_outcome := 'rejected'; v_detail := 'IDENTIFIER_AMBIGUOUS';
      else
        select * into v_item from public.inventory_items i
         where i.workspace_id=p_workspace_id and
          (i.public_id=v_identifier or i.scan_sku=v_identifier or
           i.certificate_number=v_identifier or i.serial_number=v_identifier);
        if v_item.item_state <> 'active' then
          v_outcome := 'rejected'; v_detail := 'ITEM_NOT_ACTIVE';
        elsif v_round.round_type='recount' and not exists (
          select 1 from public.cycle_count_round_subjects rs
           where rs.round_id=v_round.id and rs.item_id=v_item.id) then
          v_outcome := 'out_of_scope'; v_detail := 'SUBJECT_NOT_IN_RECOUNT';
        else
          select * into v_existing from public.cycle_count_item_observations o
           where o.round_id=v_round.id and o.item_id=v_item.id and o.voided_at is null;
          if v_existing.id is not null then
            v_outcome := 'subject_already_observed'; v_detail := 'SUBJECT_ALREADY_OBSERVED';
            v_observation_id := v_existing.id;
          else
            select * into v_expected from public.cycle_count_expected_items e
             where e.session_id=p_session_id and e.item_id=v_item.id;
            v_kind := case when v_expected.id is null then 'unexpected_found'
              when v_expected.expected_location_id=v_location_id then 'expected_found'
              else 'wrong_location' end;
            insert into public.cycle_count_item_observations (
              session_id,workspace_id,count_round,round_id,observation_kind,expected_item_id,
              item_id,observed_location_id,raw_identifier,note,observed_by,idempotency_key)
            values (p_session_id,p_workspace_id,v_round.round_number,v_round.id,v_kind,v_expected.id,
              v_item.id,v_location_id,v_identifier,nullif(btrim(coalesce(p_note,'')),''),v_uid,
              p_idempotency_key)
            on conflict (round_id,item_id) where voided_at is null do nothing
            returning id into v_observation_id;
            if v_observation_id is null then
              select * into v_existing from public.cycle_count_item_observations o
               where o.round_id=v_round.id and o.item_id=v_item.id and o.voided_at is null;
              v_observation_id := v_existing.id;
              v_outcome := 'subject_already_observed'; v_detail := 'CONCURRENT_SUBJECT_WINNER';
            else
              v_outcome := 'accepted'; v_detail := 'ACCEPTED';
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  insert into public.cycle_count_observation_idempotency (
    workspace_id,idempotency_key,session_id,round_id,subject_type,payload_fingerprint,
    canonical_outcome,item_observation_id)
  values (p_workspace_id,p_idempotency_key,p_session_id,v_round.id,'item',v_fingerprint,
    v_outcome,v_observation_id);
  perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
    p_idempotency_key,'item',v_fingerprint,v_outcome,v_uid,v_observation_id,null,v_detail);
  return jsonb_build_object('outcome',v_outcome,'code',v_detail,
    'observation_id',v_observation_id,'round_id',v_round.id,'round_number',v_round.round_number);
end $$;

revoke all on function public.observe_cycle_count_item(uuid,uuid,text,text,text) from authenticated;
revoke all on function public.observe_cycle_count_item(uuid,uuid,text,text,uuid,text) from public,anon;
grant execute on function public.observe_cycle_count_item(uuid,uuid,text,text,uuid,text) to authenticated;

create function public.observe_cycle_count_lot(
  p_workspace_id uuid, p_session_id uuid, p_lot_public_id text,
  p_observed_quantity integer, p_idempotency_key uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; v_session public.cycle_count_sessions%rowtype;
  v_round public.cycle_count_rounds%rowtype; v_key public.cycle_count_observation_idempotency%rowtype;
  v_expected public.cycle_count_expected_lots%rowtype;
  v_existing public.cycle_count_lot_observations%rowtype; v_observation_id uuid;
  v_fingerprint text := md5(jsonb_build_array(p_session_id,'lot',btrim(coalesce(p_lot_public_id,'')),
    p_observed_quantity,coalesce(p_note,''))::text);
  v_outcome text; v_detail text;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);
  if p_idempotency_key is null then raise exception 'an idempotency key is required' using errcode='23514'; end if;
  select * into v_session from public.cycle_count_sessions
   where id=p_session_id and workspace_id=p_workspace_id for update;
  if v_session.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
  select * into v_round from public.cycle_count_rounds
   where id=v_session.current_round_id and workspace_id=p_workspace_id for update;
  if v_round.id is null then raise exception 'cycle count has no active round' using errcode='23514'; end if;
  select * into v_key from public.cycle_count_observation_idempotency
   where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if v_key.idempotency_key is not null then
    if v_key.payload_fingerprint<>v_fingerprint or v_key.session_id<>p_session_id
       or v_key.round_id<>v_round.id or v_key.subject_type<>'lot' then
      perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
        p_idempotency_key,'lot',v_fingerprint,'idempotency_conflict',v_uid,null,null,'KEY_PAYLOAD_MISMATCH');
      return jsonb_build_object('outcome','idempotency_conflict','code','IDEMPOTENCY_KEY_REUSED');
    end if;
    perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
      p_idempotency_key,'lot',v_fingerprint,'idempotent_replay',v_uid,null,
      v_key.lot_observation_id,'EXACT_REPLAY');
    return jsonb_build_object('outcome','idempotent_replay','canonical_outcome',v_key.canonical_outcome,
      'observation_id',v_key.lot_observation_id,'round_id',v_round.id,'round_number',v_round.round_number);
  end if;
  if v_session.status<>'in_progress' or v_round.status<>'counting' then
    v_outcome:='closed_round'; v_detail:='ROUND_NOT_COUNTING';
  elsif p_observed_quantity is null or p_observed_quantity<0 then
    v_outcome:='rejected'; v_detail:='QUANTITY_INVALID';
  else
    select * into v_expected from public.cycle_count_expected_lots e
     where e.session_id=p_session_id and e.lot_public_id=p_lot_public_id;
    if v_expected.id is null then
      v_outcome:='out_of_scope'; v_detail:='LOT_NOT_IN_SNAPSHOT';
    elsif v_round.round_type='recount' and not exists (
      select 1 from public.cycle_count_round_subjects rs
       where rs.round_id=v_round.id and rs.lot_id=v_expected.lot_id) then
      v_outcome:='out_of_scope'; v_detail:='SUBJECT_NOT_IN_RECOUNT';
    else
      select * into v_existing from public.cycle_count_lot_observations o
       where o.round_id=v_round.id and o.lot_id=v_expected.lot_id and o.voided_at is null;
      if v_existing.id is not null then
        v_outcome:='subject_already_observed'; v_detail:='SUBJECT_ALREADY_OBSERVED';
        v_observation_id:=v_existing.id;
      else
        insert into public.cycle_count_lot_observations (
          session_id,workspace_id,count_round,round_id,expected_lot_id,lot_id,
          observed_quantity,expected_quantity,variance,note,observed_by,idempotency_key)
        values (p_session_id,p_workspace_id,v_round.round_number,v_round.id,v_expected.id,
          v_expected.lot_id,p_observed_quantity,v_expected.expected_quantity,
          p_observed_quantity-v_expected.expected_quantity,
          nullif(btrim(coalesce(p_note,'')),''),v_uid,p_idempotency_key)
        on conflict (round_id,lot_id) where voided_at is null do nothing
        returning id into v_observation_id;
        if v_observation_id is null then
          select * into v_existing from public.cycle_count_lot_observations o
           where o.round_id=v_round.id and o.lot_id=v_expected.lot_id and o.voided_at is null;
          v_observation_id:=v_existing.id;
          v_outcome:='subject_already_observed'; v_detail:='CONCURRENT_SUBJECT_WINNER';
        else v_outcome:='accepted'; v_detail:='ACCEPTED'; end if;
      end if;
    end if;
  end if;
  insert into public.cycle_count_observation_idempotency (
    workspace_id,idempotency_key,session_id,round_id,subject_type,payload_fingerprint,
    canonical_outcome,lot_observation_id)
  values (p_workspace_id,p_idempotency_key,p_session_id,v_round.id,'lot',v_fingerprint,
    v_outcome,v_observation_id);
  perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
    p_idempotency_key,'lot',v_fingerprint,v_outcome,v_uid,null,v_observation_id,v_detail);
  return jsonb_build_object('outcome',v_outcome,'code',v_detail,'observation_id',v_observation_id,
    'round_id',v_round.id,'round_number',v_round.round_number,
    'observed_quantity',case when v_outcome='accepted' then p_observed_quantity end);
end $$;

revoke all on function public.observe_cycle_count_lot(uuid,uuid,text,integer,text) from authenticated;
revoke all on function public.observe_cycle_count_lot(uuid,uuid,text,integer,uuid,text) from public,anon;
grant execute on function public.observe_cycle_count_lot(uuid,uuid,text,integer,uuid,text) to authenticated;

create function public.void_cycle_count_observation(
  p_workspace_id uuid, p_session_id uuid, p_observation_id uuid,
  p_subject_kind text, p_reason text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid; v_session public.cycle_count_sessions%rowtype; v_round public.cycle_count_rounds%rowtype;
  v_key public.cycle_count_observation_idempotency%rowtype; v_round_id uuid; v_fingerprint text;
  v_type public.cycle_count_subject_type;
begin
  v_uid:=app.cycle_count_require_counter(p_workspace_id);
  if p_idempotency_key is null then raise exception 'an idempotency key is required' using errcode='23514'; end if;
  if p_subject_kind not in ('item','lot') then raise exception 'subject kind must be item or lot' using errcode='23514'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'voiding needs a reason' using errcode='23514'; end if;
  v_type:=p_subject_kind::public.cycle_count_subject_type;
  v_fingerprint:=md5(jsonb_build_array(p_session_id,'void',p_observation_id,p_subject_kind,btrim(p_reason))::text);
  select * into v_session from public.cycle_count_sessions
   where id=p_session_id and workspace_id=p_workspace_id for update;
  if v_session.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
  select * into v_round from public.cycle_count_rounds
   where id=v_session.current_round_id and workspace_id=p_workspace_id for update;
  if v_round.id is null then raise exception 'cycle count has no active round' using errcode='23514'; end if;
  select * into v_key from public.cycle_count_observation_idempotency
   where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if v_key.idempotency_key is not null then
    if v_key.payload_fingerprint<>v_fingerprint or v_key.session_id<>p_session_id or v_key.round_id<>v_round.id then
      perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
        p_idempotency_key,v_type,v_fingerprint,'idempotency_conflict',v_uid,null,null,'KEY_PAYLOAD_MISMATCH');
      return jsonb_build_object('outcome','idempotency_conflict','code','IDEMPOTENCY_KEY_REUSED');
    end if;
    perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
      p_idempotency_key,v_type,v_fingerprint,'idempotent_replay',v_uid,
      v_key.item_observation_id,v_key.lot_observation_id,'EXACT_REPLAY');
    return jsonb_build_object('outcome','idempotent_replay','canonical_outcome',v_key.canonical_outcome,
      'observation_id',p_observation_id,'round_id',v_round.id);
  end if;
  if v_session.status<>'in_progress' or v_round.status<>'counting' then
    insert into public.cycle_count_observation_idempotency values
      (p_workspace_id,p_idempotency_key,p_session_id,v_round.id,v_type,v_fingerprint,
       'closed_round',case when v_type='item' then p_observation_id end,
       case when v_type='lot' then p_observation_id end,now());
    perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
      p_idempotency_key,v_type,v_fingerprint,'closed_round',v_uid,null,null,'ROUND_NOT_COUNTING');
    return jsonb_build_object('outcome','closed_round','code','ROUND_NOT_COUNTING');
  end if;
  if v_type='item' then
    update public.cycle_count_item_observations set voided_at=now(),voided_by=v_uid,void_reason=btrim(p_reason)
     where id=p_observation_id and workspace_id=p_workspace_id and session_id=p_session_id
       and round_id=v_round.id and voided_at is null returning round_id into v_round_id;
  else
    update public.cycle_count_lot_observations set voided_at=now(),voided_by=v_uid,void_reason=btrim(p_reason)
     where id=p_observation_id and workspace_id=p_workspace_id and session_id=p_session_id
       and round_id=v_round.id and voided_at is null returning round_id into v_round_id;
  end if;
  if v_round_id is null then
    insert into public.cycle_count_observation_idempotency (
      workspace_id,idempotency_key,session_id,round_id,subject_type,payload_fingerprint,
      canonical_outcome,item_observation_id,lot_observation_id)
    values (p_workspace_id,p_idempotency_key,p_session_id,v_round.id,v_type,v_fingerprint,'rejected',
      case when v_type='item' then p_observation_id end,
      case when v_type='lot' then p_observation_id end);
    perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
      p_idempotency_key,v_type,v_fingerprint,'rejected',v_uid,
      case when v_type='item' then p_observation_id end,
      case when v_type='lot' then p_observation_id end,'OBSERVATION_NOT_LIVE_IN_CURRENT_ROUND');
    return jsonb_build_object('outcome','rejected','code','OBSERVATION_NOT_LIVE_IN_CURRENT_ROUND');
  end if;
  insert into public.cycle_count_observation_idempotency (
    workspace_id,idempotency_key,session_id,round_id,subject_type,payload_fingerprint,
    canonical_outcome,item_observation_id,lot_observation_id)
  values (p_workspace_id,p_idempotency_key,p_session_id,v_round.id,v_type,v_fingerprint,'voided',
    case when v_type='item' then p_observation_id end,case when v_type='lot' then p_observation_id end);
  perform app.record_cycle_count_observation_attempt(p_workspace_id,p_session_id,v_round.id,
    p_idempotency_key,v_type,v_fingerprint,'voided',v_uid,
    case when v_type='item' then p_observation_id end,
    case when v_type='lot' then p_observation_id end,'VOIDED');
  return jsonb_build_object('outcome','voided','observation_id',p_observation_id,'round_id',v_round.id);
end $$;

revoke all on function public.void_cycle_count_observation(uuid,uuid,text,text) from authenticated;
revoke all on function public.void_cycle_count_observation(uuid,uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.void_cycle_count_observation(uuid,uuid,uuid,text,text,uuid) to authenticated;

insert into public.schema_migrations_log(migration_name)
values ('20260730000300_cycle_count_atomic_observations');
