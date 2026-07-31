-- Governed review/history reads. Expected answers never receive table grants.

create function public.list_current_cycle_count_discrepancies(
  p_workspace_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare v_uid uuid;v_s public.cycle_count_sessions%rowtype;v_rows jsonb;
begin
  v_uid:=app.cycle_count_require_reviewer(p_workspace_id);
  select * into v_s from public.cycle_count_sessions
   where id=p_session_id and workspace_id=p_workspace_id;
  if v_s.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
  if v_s.status<>'review' then
    raise exception 'current discrepancies are available only in review' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'public_id',d.public_id,'kind',d.discrepancy_kind,'status',d.status,
    'result_id',r.id,'classification',r.classification,'subject_type',r.subject_type,
    'item_id',r.item_id,'lot_id',r.lot_id,'expected_location_id',r.expected_location_id,
    'observed_location_id',r.observed_location_id,'expected_quantity',r.expected_quantity,
    'observed_quantity',r.observed_quantity,'computed_variance',r.computed_variance,
    'post_snapshot_classification',r.post_snapshot_classification,
    'recount_outcome',d.recount_outcome,'allowed_actions',coalesce((select jsonb_agg(jsonb_build_object(
      'action',a.action,'reason_required',a.reason_required,'destination_mode',a.destination_mode,
      'quantity_mode',a.quantity_mode,'approval_required',a.approval_required) order by a.action)
      from public.cycle_count_resolution_action_rules a where a.discrepancy_kind=d.discrepancy_kind),'[]'::jsonb)
  ) order by d.detected_at,d.id),'[]'::jsonb) into v_rows
  from public.cycle_count_discrepancies d
  join public.cycle_count_round_results r on r.id=d.round_result_id and r.workspace_id=d.workspace_id
  where d.session_id=p_session_id and d.workspace_id=p_workspace_id
    and d.superseded_by_discrepancy_id is null and d.status in ('open','deferred');
  return v_rows;
end $$;

create function public.list_cycle_count_history(p_workspace_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare v_s public.cycle_count_sessions%rowtype;v_rounds jsonb;
begin
  if app.member_role(p_workspace_id) is null then raise exception 'not found' using errcode='42501'; end if;
  select * into v_s from public.cycle_count_sessions where id=p_session_id and workspace_id=p_workspace_id;
  if v_s.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
  if v_s.status not in ('review','completed','cancelled') and app.member_role(p_workspace_id)<>'owner' then
    raise exception 'history is unavailable while counting' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'public_id',r.public_id,'round_number',r.round_number,'round_type',r.round_type,
    'status',r.status,'reason',r.reason,'started_at',r.started_at,'submitted_at',r.submitted_at,
    'subject_count',(select count(*) from public.cycle_count_round_subjects s where s.round_id=r.id),
    'item_observation_count',(select count(*) from public.cycle_count_item_observations o where o.round_id=r.id),
    'lot_observation_count',(select count(*) from public.cycle_count_lot_observations o where o.round_id=r.id),
    'result_count',(select count(*) from public.cycle_count_round_results x where x.round_id=r.id)
  ) order by r.round_number),'[]'::jsonb) into v_rounds
  from public.cycle_count_rounds r where r.session_id=p_session_id and r.workspace_id=p_workspace_id;
  return jsonb_build_object('session_id',p_session_id,'status',v_s.status,'completion_summary',v_s.completion_summary,'rounds',v_rounds);
end $$;

create function public.list_cycle_count_resolution_attempts(p_workspace_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare v_uid uuid;v_rows jsonb;
begin
  v_uid:=app.cycle_count_require_reviewer(p_workspace_id);
  if not exists(select 1 from public.cycle_count_sessions where id=p_session_id and workspace_id=p_workspace_id)
    then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'discrepancy_id',a.discrepancy_id,'round_result_id',a.round_result_id,
    'action',a.action,'reason',a.reason,'reviewed_destination_code',a.reviewed_destination_code,
    'status',a.status,'failure_classification',a.failure_classification,'created_at',a.created_at,
    'last_attempted_at',a.last_attempted_at,'completed_at',a.completed_at,
    'events',coalesce((select jsonb_agg(jsonb_build_object('type',e.event_type,
      'failure_classification',e.failure_classification,'occurred_at',e.occurred_at) order by e.occurred_at)
      from public.cycle_count_resolution_attempt_events e where e.attempt_id=a.id),'[]'::jsonb)
  ) order by a.created_at),'[]'::jsonb) into v_rows
  from public.cycle_count_resolution_attempts a
  where a.workspace_id=p_workspace_id and a.session_id=p_session_id;
  return v_rows;
end $$;

revoke all on function public.list_current_cycle_count_discrepancies(uuid,uuid) from public,anon;
revoke all on function public.list_cycle_count_history(uuid,uuid) from public,anon;
revoke all on function public.list_cycle_count_resolution_attempts(uuid,uuid) from public,anon;
grant execute on function public.list_current_cycle_count_discrepancies(uuid,uuid) to authenticated;
grant execute on function public.list_cycle_count_history(uuid,uuid) to authenticated;
grant execute on function public.list_cycle_count_resolution_attempts(uuid,uuid) to authenticated;

insert into public.schema_migrations_log(migration_name)
values('20260731000100_cycle_count_review_reads');
