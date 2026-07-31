-- Governed resolution matrix, durable attempts, loss provenance, latest-result completion.

create table public.cycle_count_resolution_action_rules (
  discrepancy_kind public.cycle_count_discrepancy_kind not null,
  action text not null,
  required_role public.workspace_role not null default 'owner',
  reason_required boolean not null default true,
  destination_mode text not null check (destination_mode in ('none','observed','reviewed')),
  quantity_mode text not null check (quantity_mode in ('none','latest_observed')),
  downstream_function text,
  completion_state public.cycle_count_discrepancy_status not null default 'resolved',
  approval_required boolean not null default false,
  primary key(discrepancy_kind,action)
);
insert into public.cycle_count_resolution_action_rules values
 ('item_missing','item_loss_recorded','owner',true,'none','none','record_inventory_item_loss', 'resolved',true),
 ('item_missing','confirmed_system_location','owner',true,'none','none',null,'resolved',false),
 ('item_missing','deferred','owner',true,'none','none',null,'deferred',false),
 ('item_unexpected','routed_to_intake','owner',true,'none','none',null,'resolved',false),
 ('item_unexpected','observation_mistaken','owner',true,'none','none',null,'resolved',false),
 ('item_unexpected','deferred','owner',true,'none','none',null,'deferred',false),
 ('item_wrong_location','item_moved_to_counted_location','owner',true,'observed','none','move_inventory_item','resolved',false),
 ('item_wrong_location','item_moved_to_reviewed_location','owner',true,'reviewed','none','move_inventory_item','resolved',true),
 ('item_wrong_location','confirmed_system_location','owner',true,'none','none',null,'resolved',false),
 ('item_wrong_location','explained_by_post_snapshot_activity','owner',true,'none','none',null,'resolved',false),
 ('item_wrong_location','deferred','owner',true,'none','none',null,'deferred',false),
 ('lot_shortage','lot_quantity_adjusted','owner',true,'none','latest_observed','adjust_lot_quantity','resolved',true),
 ('lot_shortage','explained_by_post_snapshot_activity','owner',true,'none','none',null,'resolved',false),
 ('lot_shortage','deferred','owner',true,'none','none',null,'deferred',false),
 ('lot_overage','lot_quantity_adjusted','owner',true,'none','latest_observed','adjust_lot_quantity','resolved',true),
 ('lot_overage','explained_by_post_snapshot_activity','owner',true,'none','none',null,'resolved',false),
 ('lot_overage','deferred','owner',true,'none','none',null,'deferred',false),
 ('lot_uncounted','observation_mistaken','owner',true,'none','none',null,'resolved',false),
 ('lot_uncounted','deferred','owner',true,'none','none',null,'deferred',false);
alter table public.cycle_count_resolution_action_rules enable row level security;
revoke all on public.cycle_count_resolution_action_rules from public,anon,authenticated;

create table public.cycle_count_resolution_attempts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
  session_id uuid not null, discrepancy_id uuid not null, round_result_id uuid not null,
  idempotency_key uuid not null, action text not null, reason text,
  reviewed_destination_code text, status text not null default 'pending'
    check(status in ('pending','executing','succeeded','failed')),
  failure_classification text, movement_id uuid, adjustment_id uuid,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  last_attempted_at timestamptz, completed_at timestamptz,
  unique(workspace_id,idempotency_key), unique(id,workspace_id),
  foreign key(session_id,workspace_id) references public.cycle_count_sessions(id,workspace_id),
  foreign key(discrepancy_id,workspace_id) references public.cycle_count_discrepancies(id,workspace_id),
  foreign key(round_result_id,workspace_id) references public.cycle_count_round_results(id,workspace_id)
);
create table public.cycle_count_resolution_attempt_events (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
  attempt_id uuid not null,event_type text not null check(event_type in ('created','started','failed','succeeded','recovered')),
  actor_id uuid not null references auth.users(id),failure_classification text,
  occurred_at timestamptz not null default now(),unique(id,workspace_id),
  foreign key(attempt_id,workspace_id) references public.cycle_count_resolution_attempts(id,workspace_id)
);
create trigger cycle_count_resolution_attempt_events_append_only before update or delete
 on public.cycle_count_resolution_attempt_events for each row execute function app.forbid_update_delete();
alter table public.cycle_count_resolution_attempts enable row level security;
alter table public.cycle_count_resolution_attempt_events enable row level security;
revoke all on public.cycle_count_resolution_attempts,public.cycle_count_resolution_attempt_events
 from public,anon,authenticated;

alter table public.inventory_items add column retirement_reason text;
create table public.inventory_loss_events (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
  public_id text not null check(public_id ~ '^RV-LOSS-[A-Z0-9]{6,20}$'),item_id uuid not null,
  actor_id uuid not null references auth.users(id),reason text not null,
  occurred_at timestamptz not null default now(),prior_item_state public.inventory_item_state not null,
  resulting_item_state public.inventory_item_state not null,cycle_count_session_id uuid,
  discrepancy_id uuid,resolution_attempt_id uuid,idempotency_key uuid not null,
  governed_metadata jsonb not null default '{}'::jsonb,unique(id,workspace_id),
  unique(workspace_id,public_id),unique(workspace_id,idempotency_key),
  foreign key(item_id,workspace_id) references public.inventory_items(id,workspace_id),
  foreign key(cycle_count_session_id,workspace_id) references public.cycle_count_sessions(id,workspace_id),
  foreign key(discrepancy_id,workspace_id) references public.cycle_count_discrepancies(id,workspace_id),
  foreign key(resolution_attempt_id,workspace_id) references public.cycle_count_resolution_attempts(id,workspace_id)
);
create trigger inventory_loss_events_append_only before update or delete on public.inventory_loss_events
 for each row execute function app.forbid_update_delete();
alter table public.inventory_loss_events enable row level security;
revoke all on public.inventory_loss_events from public,anon,authenticated;

create function public.create_cycle_count_resolution_attempt(
 p_workspace_id uuid,p_discrepancy_id uuid,p_action text,p_reason text,
 p_reviewed_destination_code text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid;v_d public.cycle_count_discrepancies%rowtype;v_s public.cycle_count_sessions%rowtype;
 v_rule public.cycle_count_resolution_action_rules%rowtype;v_id uuid;v_existing public.cycle_count_resolution_attempts%rowtype;
begin
 v_uid:=app.cycle_count_require_reviewer(p_workspace_id);
 if p_idempotency_key is null then raise exception 'idempotency key required' using errcode='23514'; end if;
 select * into v_existing from public.cycle_count_resolution_attempts where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
 if v_existing.id is not null then
  if v_existing.discrepancy_id<>p_discrepancy_id or v_existing.action<>p_action or
     coalesce(v_existing.reason,'')<>coalesce(nullif(btrim(p_reason),''),'') or
     coalesce(v_existing.reviewed_destination_code,'')<>coalesce(p_reviewed_destination_code,'') then
   return jsonb_build_object('outcome','idempotency_conflict','code','IDEMPOTENCY_KEY_REUSED');
  end if;
  return jsonb_build_object('outcome','idempotent_replay','attempt_id',v_existing.id,'status',v_existing.status);
 end if;
 select * into v_d from public.cycle_count_discrepancies where id=p_discrepancy_id and workspace_id=p_workspace_id;
 if v_d.id is null then raise exception 'discrepancy not found in this workspace' using errcode='23514'; end if;
 select * into v_s from public.cycle_count_sessions where id=v_d.session_id and workspace_id=p_workspace_id;
 if v_s.status<>'review' or v_d.status not in ('open','deferred') or v_d.superseded_by_discrepancy_id is not null then
  return jsonb_build_object('outcome','conflict','code','DISCREPANCY_NOT_CURRENTLY_RESOLVABLE');
 end if;
 if v_d.round_result_id is null then
  return jsonb_build_object('outcome','conflict','code','RESULT_LINK_REQUIRED'); end if;
 select * into v_rule from public.cycle_count_resolution_action_rules where discrepancy_kind=v_d.discrepancy_kind and action=p_action;
 if v_rule.action is null then return jsonb_build_object('outcome','invalid_action','code','ACTION_KIND_FORBIDDEN'); end if;
 if v_rule.reason_required and nullif(btrim(coalesce(p_reason,'')),'') is null then
  return jsonb_build_object('outcome','invalid_action','code','REASON_REQUIRED'); end if;
 if v_rule.destination_mode='observed' and p_reviewed_destination_code is not null then
  return jsonb_build_object('outcome','invalid_action','code','COUNTED_DESTINATION_CANNOT_BE_OVERRIDDEN'); end if;
 if v_rule.destination_mode='reviewed' and nullif(btrim(coalesce(p_reviewed_destination_code,'')),'') is null then
  return jsonb_build_object('outcome','invalid_action','code','DESTINATION_REQUIRED'); end if;
 insert into public.cycle_count_resolution_attempts(workspace_id,session_id,discrepancy_id,round_result_id,
  idempotency_key,action,reason,reviewed_destination_code,created_by)
 values(p_workspace_id,v_d.session_id,v_d.id,v_d.round_result_id,p_idempotency_key,p_action,
  nullif(btrim(p_reason),''),nullif(btrim(p_reviewed_destination_code),''),v_uid) returning id into v_id;
 insert into public.cycle_count_resolution_attempt_events(workspace_id,attempt_id,event_type,actor_id)
 values(p_workspace_id,v_id,'created',v_uid);
 return jsonb_build_object('outcome','created','attempt_id',v_id,'status','pending');
end $$;

create function public.execute_cycle_count_resolution_attempt(p_workspace_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid;v_a public.cycle_count_resolution_attempts%rowtype;v_d public.cycle_count_discrepancies%rowtype;
 v_s public.cycle_count_sessions%rowtype;v_r public.cycle_count_round_results%rowtype;
 v_rule public.cycle_count_resolution_action_rules%rowtype;v_code text;v_delta int;v_move uuid;v_adjust uuid;
begin
 v_uid:=app.cycle_count_require_reviewer(p_workspace_id);
 select * into v_a from public.cycle_count_resolution_attempts where id=p_attempt_id and workspace_id=p_workspace_id for update;
 if v_a.id is null then raise exception 'resolution attempt not found in this workspace' using errcode='23514'; end if;
 if v_a.status='succeeded' then return jsonb_build_object('outcome','already_succeeded','attempt_id',v_a.id); end if;
 select * into v_s from public.cycle_count_sessions where id=v_a.session_id and workspace_id=p_workspace_id for update;
 select * into v_d from public.cycle_count_discrepancies where id=v_a.discrepancy_id and workspace_id=p_workspace_id for update;
 select * into v_r from public.cycle_count_round_results where id=v_a.round_result_id and workspace_id=p_workspace_id;
 if v_s.status<>'review' then return jsonb_build_object('outcome','conflict','code','RESOLUTION_REQUIRES_REVIEW'); end if;
 if v_d.round_result_id<>v_r.id or v_d.superseded_by_discrepancy_id is not null or v_d.status not in ('open','deferred') then
  return jsonb_build_object('outcome','conflict','code','RESULT_NO_LONGER_CURRENT'); end if;
 select * into v_rule from public.cycle_count_resolution_action_rules where discrepancy_kind=v_d.discrepancy_kind and action=v_a.action;
 update public.cycle_count_resolution_attempts set status='executing',last_attempted_at=now(),failure_classification=null where id=v_a.id;
 insert into public.cycle_count_resolution_attempt_events(workspace_id,attempt_id,event_type,actor_id)
 values(p_workspace_id,v_a.id,case when v_a.status='failed' then 'recovered' else 'started' end,v_uid);
 begin
  if v_a.action='item_moved_to_counted_location' then
   select location_code into v_code from public.storage_locations where id=v_r.observed_location_id and workspace_id=p_workspace_id;
   if v_code is null then raise exception 'accepted result has no counted location' using errcode='23514'; end if;
   perform public.move_inventory_item(p_workspace_id,v_r.item_id,v_code,v_a.reason);
   select id into v_move from public.inventory_movements where workspace_id=p_workspace_id and item_id=v_r.item_id order by moved_at desc limit 1;
  elsif v_a.action='item_moved_to_reviewed_location' then
   perform public.move_inventory_item(p_workspace_id,v_r.item_id,v_a.reviewed_destination_code,v_a.reason);
   select id into v_move from public.inventory_movements where workspace_id=p_workspace_id and item_id=v_r.item_id order by moved_at desc limit 1;
  elsif v_a.action='lot_quantity_adjusted' then
   select v_r.observed_quantity-l.quantity into v_delta from public.inventory_lots l where l.id=v_r.lot_id and l.workspace_id=p_workspace_id;
   if v_delta<>0 then
    perform public.adjust_lot_quantity(p_workspace_id,v_r.lot_id,v_delta,'recount',
      (select quantity from public.inventory_lots where id=v_r.lot_id),v_a.reason,null);
    select id into v_adjust from public.inventory_quantity_adjustments where workspace_id=p_workspace_id and lot_id=v_r.lot_id order by adjusted_at desc limit 1;
   end if;
  elsif v_a.action='item_loss_recorded' then
   update public.inventory_items set item_state='lost',retirement_reason=v_a.reason,updated_at=now() where id=v_r.item_id and workspace_id=p_workspace_id and item_state='active';
   if not found then raise exception 'item is no longer active' using errcode='23514'; end if;
   insert into public.inventory_loss_events(workspace_id,public_id,item_id,actor_id,reason,prior_item_state,
    resulting_item_state,cycle_count_session_id,discrepancy_id,resolution_attempt_id,idempotency_key,governed_metadata)
   values(p_workspace_id,app.mint_governed_public_id('RV-LOSS'),v_r.item_id,v_uid,v_a.reason,'active','lost',
    v_s.id,v_d.id,v_a.id,v_a.id,jsonb_build_object('source','cycle_count_resolution'));
  end if;
 exception when others then
  v_code:=case when sqlstate='23514' then 'GOVERNED_VALIDATION_FAILED'
    when sqlstate='23505' then 'IDEMPOTENT_CONFLICT' when sqlstate='42501' then 'AUTHORIZATION_CHANGED'
    else 'GOVERNED_ACTION_FAILED' end;
 end;
 if v_code is not null and v_move is null and v_adjust is null and v_a.action not in
   ('confirmed_system_location','routed_to_intake','observation_mistaken','explained_by_post_snapshot_activity','deferred') then
  update public.cycle_count_resolution_attempts set status='failed',failure_classification=v_code where id=v_a.id;
  insert into public.cycle_count_resolution_attempt_events(workspace_id,attempt_id,event_type,actor_id,failure_classification)
  values(p_workspace_id,v_a.id,'failed',v_uid,v_code);
  return jsonb_build_object('outcome','failed','attempt_id',v_a.id,'failure_classification',v_code);
 end if;
 update public.cycle_count_resolution_attempts set status='succeeded',movement_id=v_move,adjustment_id=v_adjust,completed_at=now() where id=v_a.id;
 update public.cycle_count_discrepancies set status=v_rule.completion_state,resolved_at=now(),resolved_by=v_uid,
  deferral_reason=case when v_rule.completion_state='deferred' then v_a.reason end where id=v_d.id;
 insert into public.cycle_count_resolution_attempt_events(workspace_id,attempt_id,event_type,actor_id) values(p_workspace_id,v_a.id,'succeeded',v_uid);
 return jsonb_build_object('outcome','succeeded','attempt_id',v_a.id,'movement_id',v_move,'adjustment_id',v_adjust);
end $$;

revoke all on function public.resolve_cycle_count_discrepancy(uuid,uuid,public.cycle_count_resolution_action,text,text) from authenticated;
revoke all on function public.create_cycle_count_resolution_attempt(uuid,uuid,text,text,text,uuid) from public,anon;
revoke all on function public.execute_cycle_count_resolution_attempt(uuid,uuid) from public,anon;
grant execute on function public.create_cycle_count_resolution_attempt(uuid,uuid,text,text,text,uuid) to authenticated;
grant execute on function public.execute_cycle_count_resolution_attempt(uuid,uuid) to authenticated;

create function public.record_inventory_item_loss_event(
 p_workspace_id uuid,p_item_id uuid,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid;v_item public.inventory_items%rowtype;v_event public.inventory_loss_events%rowtype;v_id uuid;
begin
 v_uid:=app.cycle_count_require_reviewer(p_workspace_id);
 if p_idempotency_key is null or nullif(btrim(coalesce(p_reason,'')),'') is null then
  raise exception 'loss requires a reason and idempotency key' using errcode='23514'; end if;
 select * into v_event from public.inventory_loss_events where workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
 if v_event.id is not null then
  if v_event.item_id<>p_item_id or v_event.reason<>btrim(p_reason) then
   return jsonb_build_object('outcome','idempotency_conflict','code','IDEMPOTENCY_KEY_REUSED'); end if;
  return jsonb_build_object('outcome','idempotent_replay','event_id',v_event.id);
 end if;
 select * into v_item from public.inventory_items where id=p_item_id and workspace_id=p_workspace_id for update;
 if v_item.id is null then raise exception 'item not found in this workspace' using errcode='23514'; end if;
 if v_item.item_state<>'active' then return jsonb_build_object('outcome','conflict','code','ITEM_NOT_ACTIVE'); end if;
 update public.inventory_items set item_state='lost',retirement_reason=btrim(p_reason),updated_at=now() where id=p_item_id;
 insert into public.inventory_loss_events(workspace_id,public_id,item_id,actor_id,reason,prior_item_state,
  resulting_item_state,idempotency_key,governed_metadata)
 values(p_workspace_id,app.mint_governed_public_id('RV-LOSS'),p_item_id,v_uid,btrim(p_reason),
  v_item.item_state,'lost',p_idempotency_key,jsonb_build_object('source','direct_governed_loss')) returning id into v_id;
 return jsonb_build_object('outcome','recorded','event_id',v_id,'item_id',p_item_id);
end $$;
revoke all on function public.record_inventory_item_loss(uuid,uuid,text,uuid,uuid) from authenticated;
revoke all on function public.record_inventory_item_loss_event(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.record_inventory_item_loss_event(uuid,uuid,text,uuid) to authenticated;

create function public.complete_cycle_count_latest(p_workspace_id uuid,p_session_id uuid,p_allow_deferred boolean,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid;v_s public.cycle_count_sessions%rowtype;v_r public.cycle_count_rounds%rowtype;
 v_open int;v_deferred int;v_summary jsonb;
begin
 v_uid:=app.cycle_count_require_reviewer(p_workspace_id);
 select * into v_s from public.cycle_count_sessions where id=p_session_id and workspace_id=p_workspace_id for update;
 if v_s.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
 select * into v_r from public.cycle_count_rounds where id=v_s.current_round_id and workspace_id=p_workspace_id for update;
 if v_s.status<>'review' then return jsonb_build_object('outcome','conflict','code','COMPLETION_REQUIRES_REVIEW'); end if;
 select count(*) filter(where status in ('open','recount_requested'))::int,count(*) filter(where status='deferred')::int
 into v_open,v_deferred from public.cycle_count_discrepancies where session_id=p_session_id and superseded_by_discrepancy_id is null;
 if v_open>0 or (v_deferred>0 and not p_allow_deferred) then return jsonb_build_object('outcome','blocked','open_count',v_open,'deferred_count',v_deferred); end if;
 select jsonb_build_object(
  'latest_result_count',count(*),'found_items',count(*) filter(where subject_type='item' and observed_location_id is not null),
  'lot_observed_total',coalesce(sum(observed_quantity) filter(where subject_type='lot'),0),
  'lot_expected_total',coalesce(sum(expected_quantity) filter(where subject_type='lot'),0),
  'shortage_units',coalesce(sum(greatest(-computed_variance,0)) filter(where subject_type='lot'),0),
  'overage_units',coalesce(sum(greatest(computed_variance,0)) filter(where subject_type='lot'),0),
  'net_variance',coalesce(sum(computed_variance) filter(where subject_type='lot'),0),
  'historical_round_count',(select count(*) from public.cycle_count_rounds where session_id=p_session_id))
 into v_summary from public.cycle_count_latest_round_results where session_id=p_session_id;
 update public.cycle_count_rounds set status='closed' where id=v_r.id;
 update public.cycle_count_sessions set status='completed',completed_by=v_uid,completed_at=now(),completion_summary=v_summary,completion_note=nullif(btrim(p_note),''),updated_at=now() where id=p_session_id;
 return jsonb_build_object('outcome','completed','summary',v_summary);
end $$;
revoke all on function public.complete_cycle_count(uuid,uuid,boolean,text) from authenticated;
revoke all on function public.complete_cycle_count_latest(uuid,uuid,boolean,text) from public,anon;
grant execute on function public.complete_cycle_count_latest(uuid,uuid,boolean,text) to authenticated;

-- Governed attempts supersede legacy resolution rows, so cancellation must
-- treat either source of a successful inventory mutation as durable evidence.
create or replace function public.cancel_cycle_count(
 p_workspace_id uuid,p_session_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid;v_s public.cycle_count_sessions%rowtype;v_applied int;
begin
 v_uid:=app.cycle_count_require_counter(p_workspace_id);
 if nullif(btrim(coalesce(p_reason,'')),'') is null then
  raise exception 'say why this count is being cancelled' using errcode='23514'; end if;
 select * into v_s from public.cycle_count_sessions
  where id=p_session_id and workspace_id=p_workspace_id for update;
 if v_s.id is null then raise exception 'cycle count not found in this workspace' using errcode='23514'; end if;
 if v_s.status not in ('draft','in_progress','review') then
  raise exception 'a % cycle count cannot be cancelled',v_s.status using errcode='23514'; end if;
 select count(*)::int into v_applied from (
  select r.id from public.cycle_count_resolutions r
   where r.session_id=p_session_id and r.succeeded
    and r.action in ('item_moved_to_counted_location','item_loss_recorded','lot_quantity_adjusted')
  union all
  select a.id from public.cycle_count_resolution_attempts a
   where a.session_id=p_session_id and a.workspace_id=p_workspace_id and a.status='succeeded'
    and a.action in ('item_moved_to_counted_location','item_moved_to_reviewed_location',
      'item_loss_recorded','lot_quantity_adjusted')) applied;
 if v_applied>0 then raise exception
  'cannot cancel: % inventory changes have already been applied from this count',v_applied
  using errcode='23514'; end if;
 update public.cycle_count_sessions set status='cancelled',cancelled_at=now(),cancelled_by=v_uid,
  cancellation_reason=btrim(p_reason),updated_at=now() where id=p_session_id;
 return jsonb_build_object('outcome','cancelled','session_id',p_session_id);
end $$;

insert into public.schema_migrations_log(migration_name) values('20260730000500_cycle_count_resolution_governance');
