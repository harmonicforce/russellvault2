-- Genuine overlapping Cycle Count transactions. Every wait is bounded and all
-- worker sessions are disconnected/terminated before teardown.
create extension if not exists pgtap;create extension if not exists dblink;select plan(22);

create or replace function pg_temp.await_all(p_conns text[],p_seconds numeric default 20)
returns void language plpgsql as $$
declare v_started timestamptz:=clock_timestamp();v_conn text;v_busy boolean;
begin loop v_busy:=false;foreach v_conn in array p_conns loop v_busy:=v_busy or dblink_is_busy(v_conn)=1;end loop;
 exit when not v_busy;if clock_timestamp()-v_started>make_interval(secs=>p_seconds) then
  raise exception 'cycle-count concurrency deadline for %',p_conns using errcode='55P03';end if;perform pg_sleep(.02);end loop;end $$;
create temp table cc_worker_pids(conn text primary key,pid int);create temp table cc_conn(dsn text);
insert into cc_conn values(case when current_setting('is_superuser')='on' then 'dbname='||current_database()
 else format('host=%s port=%s dbname=%s user=postgres password=postgres',coalesce(host(inet_server_addr()),'127.0.0.1'),coalesce(inet_server_port()::text,current_setting('port')),current_database()) end);
create or replace function pg_temp.connect_worker(p_conn text) returns void language plpgsql as $$declare p int;begin
 perform dblink_connect(p_conn,(select dsn from cc_conn));select pid into p from dblink(p_conn,'select pg_backend_pid()') t(pid int);insert into cc_worker_pids values(p_conn,p);end $$;
create or replace function pg_temp.disconnect_workers(p_conns text[]) returns void language plpgsql as $$declare c text;p int;begin
 foreach c in array p_conns loop begin perform dblink_cancel_query(c);exception when others then null;end;
  select pid into p from cc_worker_pids where conn=c;if p is not null then perform pg_terminate_backend(p) from pg_stat_activity where pid=p and datname=current_database();end if;
  begin perform dblink_disconnect(c);exception when others then null;end;delete from cc_worker_pids where conn=c;end loop;end $$;
create or replace function pg_temp.auth_sql(p_call text) returns text language sql as $$
 select format($q$with auth as materialized (select set_config('request.jwt.claims',%L,false)) select (%s)::text from auth$q$,
  json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,p_call)$$;
create or replace function pg_temp.race(p_name text,p_left text,p_right text)
returns text[] language plpgsql as $$declare cs text[]:=array[p_name||'_1',p_name||'_2'];a text;b text;begin
 perform pg_temp.connect_worker(cs[1]);perform pg_temp.connect_worker(cs[2]);
 perform dblink_send_query(cs[1],pg_temp.auth_sql(p_left));perform dblink_send_query(cs[2],pg_temp.auth_sql(p_right));
 perform pg_temp.await_all(cs,20);select result into a from dblink_get_result(cs[1]) t(result text);select result into b from dblink_get_result(cs[2]) t(result text);
 perform pg_temp.disconnect_workers(cs);return array[a,b];exception when others then perform pg_temp.disconnect_workers(cs);raise;end $$;

insert into auth.users(id,email) values
 ('ee111111-1111-4111-8111-111111111111','cc-concurrency@test.local'),
 ('ee222222-2222-4222-8222-222222222222','cc-approver@test.local');
insert into public.workspaces(id,name,created_by) values('eeee0000-0000-4000-8000-000000000001','CC concurrency','ee111111-1111-4111-8111-111111111111');
-- Second owner so governed resolutions can get their required distinct-actor approval.
insert into public.workspace_members(workspace_id,user_id,role)
 values('eeee0000-0000-4000-8000-000000000001','ee222222-2222-4222-8222-222222222222','owner') on conflict do nothing;
select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);set role authenticated;
select public.register_storage_location('eeee0000-0000-4000-8000-000000000001','ROOT',null,'Root');
select public.register_storage_location('eeee0000-0000-4000-8000-000000000001','I','ROOT','Item bin');
select public.register_storage_location('eeee0000-0000-4000-8000-000000000001','J','ROOT','Other bin');
select public.register_storage_location('eeee0000-0000-4000-8000-000000000001','L',null,'Lot bin');
create temp table cc_ids(k text primary key,v uuid);grant all on cc_ids to public;
insert into cc_ids values('product',(public.register_product('eeee0000-0000-4000-8000-000000000001','tcg','Concurrency card','cc|card','{}')->>'id')::uuid);
insert into cc_ids values('sku_item',(public.register_sellable_sku('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='product'),'{}')->>'id')::uuid);
insert into cc_ids values('sku_lot',(public.register_sellable_sku('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='product'),'{"product_format":"Box"}')->>'id')::uuid);
insert into cc_ids values('parent',(public.stage_inventory_lot('eeee0000-0000-4000-8000-000000000001','RV-C-9000000001',(select v from cc_ids where k='sku_item'),'serialized',1,'I','test','1.0.0',null)->>'id')::uuid);
insert into cc_ids values('item',(public.mint_serialized_item('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='parent'),'PSA','EE-CERT',null)->>'id')::uuid);
insert into cc_ids values('lot',(public.stage_inventory_lot('eeee0000-0000-4000-8000-000000000001','RV-C-9000000002',(select v from cc_ids where k='sku_lot'),'lot_managed',10,'L','test','1.0.0',null)->>'id')::uuid);
create or replace function pg_temp.new_count(p_code text,p_desc boolean default false) returns uuid language plpgsql as $$declare x uuid;begin
 x:=(public.create_cycle_count('eeee0000-0000-4000-8000-000000000001',p_code,p_desc,null,null,true)->>'id')::uuid;
 perform public.start_cycle_count('eeee0000-0000-4000-8000-000000000001',x);return x;end $$;
reset role;commit;

-- Observation versus submit: either evidence is evaluated or receives a closed-round outcome.
set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);
insert into cc_ids values('item_submit',pg_temp.new_count('ROOT',true));reset role;commit;
select pg_temp.race('item_submit',format($$public.observe_cycle_count_item('eeee0000-0000-4000-8000-000000000001',%L,'EE-CERT','I','eeaaaaaa-0001-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='item_submit')),
 format($$public.submit_cycle_count_round('eeee0000-0000-4000-8000-000000000001',%L,true)$$,(select v from cc_ids where k='item_submit')));
select is((select status::text from public.cycle_count_sessions where id=(select v from cc_ids where k='item_submit')),'review','item submit race closes the session deterministically');
select ok(not exists(select 1 from public.cycle_count_item_observations o join public.cycle_count_rounds r on r.id=o.round_id where o.session_id=(select v from cc_ids where k='item_submit') and o.observed_at>r.submitted_at),'no item evidence lands after evaluation');

set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);insert into cc_ids values('lot_submit',pg_temp.new_count('L'));reset role;commit;
select pg_temp.race('lot_submit',format($$public.observe_cycle_count_lot('eeee0000-0000-4000-8000-000000000001',%L,'RV-C-9000000002',8,'eebbbbbb-0001-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='lot_submit')),
 format($$public.submit_cycle_count_round('eeee0000-0000-4000-8000-000000000001',%L,true)$$,(select v from cc_ids where k='lot_submit')));
select is((select status::text from public.cycle_count_sessions where id=(select v from cc_ids where k='lot_submit')),'review','lot submit race closes the session deterministically');
select ok(not exists(select 1 from public.cycle_count_lot_observations o join public.cycle_count_rounds r on r.id=o.round_id where o.session_id=(select v from cc_ids where k='lot_submit') and o.observed_at>r.submitted_at),'no lot evidence lands after evaluation');

-- Observation versus cancellation.
set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);insert into cc_ids values('item_cancel',pg_temp.new_count('ROOT',true));reset role;commit;
select pg_temp.race('item_cancel',format($$public.observe_cycle_count_item('eeee0000-0000-4000-8000-000000000001',%L,'EE-CERT','I','eeaaaaaa-0002-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='item_cancel')),
 format($$public.cancel_cycle_count('eeee0000-0000-4000-8000-000000000001',%L,'cancel race')$$,(select v from cc_ids where k='item_cancel')));
select is((select status::text from public.cycle_count_sessions where id=(select v from cc_ids where k='item_cancel')),'cancelled','item observation serializes with cancel');
select ok(not exists(select 1 from public.cycle_count_item_observations o join public.cycle_count_sessions s on s.id=o.session_id where o.session_id=(select v from cc_ids where k='item_cancel') and o.observed_at>s.cancelled_at),'no item evidence lands after cancel');

set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);insert into cc_ids values('lot_cancel',pg_temp.new_count('L'));reset role;commit;
select pg_temp.race('lot_cancel',format($$public.observe_cycle_count_lot('eeee0000-0000-4000-8000-000000000001',%L,'RV-C-9000000002',8,'eebbbbbb-0002-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='lot_cancel')),
 format($$public.cancel_cycle_count('eeee0000-0000-4000-8000-000000000001',%L,'cancel race')$$,(select v from cc_ids where k='lot_cancel')));
select is((select status::text from public.cycle_count_sessions where id=(select v from cc_ids where k='lot_cancel')),'cancelled','lot observation serializes with cancel');
select ok(not exists(select 1 from public.cycle_count_lot_observations o join public.cycle_count_sessions s on s.id=o.session_id where o.session_id=(select v from cc_ids where k='lot_cancel') and o.observed_at>s.cancelled_at),'no lot evidence lands after cancel');

-- Concurrent subjects and key semantics.
set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);insert into cc_ids values('item_dupe',pg_temp.new_count('ROOT',true));reset role;commit;
select pg_temp.race('item_dupe',format($$public.observe_cycle_count_item('eeee0000-0000-4000-8000-000000000001',%L,'EE-CERT','I','eeaaaaaa-0003-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='item_dupe')),
 format($$public.observe_cycle_count_item('eeee0000-0000-4000-8000-000000000001',%L,'EE-CERT','I','eeaaaaaa-0004-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='item_dupe')));
select is((select count(*)::int from public.cycle_count_item_observations where session_id=(select v from cc_ids where k='item_dupe') and voided_at is null),1,'two item scans create one live observation');
select is((select count(*)::int from public.cycle_count_observation_idempotency where session_id=(select v from cc_ids where k='item_dupe')),2,'both item keys receive canonical structured outcomes');

set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);insert into cc_ids values('lot_dupe',pg_temp.new_count('L'));reset role;commit;
select pg_temp.race('lot_dupe',format($$public.observe_cycle_count_lot('eeee0000-0000-4000-8000-000000000001',%L,'RV-C-9000000002',8,'eebbbbbb-0003-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='lot_dupe')),
 format($$public.observe_cycle_count_lot('eeee0000-0000-4000-8000-000000000001',%L,'RV-C-9000000002',9,'eebbbbbb-0004-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='lot_dupe')));
select is((select count(*)::int from public.cycle_count_lot_observations where session_id=(select v from cc_ids where k='lot_dupe') and voided_at is null),1,'two lot submissions create one live observation');
select is((select count(*)::int from public.cycle_count_observation_idempotency where session_id=(select v from cc_ids where k='lot_dupe')),2,'both lot keys receive canonical structured outcomes');

set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);insert into cc_ids values('key_replay',pg_temp.new_count('ROOT',true));reset role;commit;
select pg_temp.race('key_replay',format($$public.observe_cycle_count_item('eeee0000-0000-4000-8000-000000000001',%L,'EE-CERT','I','eeaaaaaa-0005-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='key_replay')),
 format($$public.observe_cycle_count_item('eeee0000-0000-4000-8000-000000000001',%L,'EE-CERT','I','eeaaaaaa-0005-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='key_replay')));
select is((select count(*)::int from public.cycle_count_observation_idempotency where session_id=(select v from cc_ids where k='key_replay')),1,'concurrent exact replay has one canonical key');
select is((select count(*)::int from public.cycle_count_observation_attempts where session_id=(select v from cc_ids where k='key_replay')),2,'both exact replay attempts remain append-only');

set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);insert into cc_ids values('key_conflict',pg_temp.new_count('ROOT',true));reset role;commit;
select pg_temp.race('key_conflict',format($$public.observe_cycle_count_item('eeee0000-0000-4000-8000-000000000001',%L,'EE-CERT','I','eeaaaaaa-0006-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='key_conflict')),
 format($$public.observe_cycle_count_item('eeee0000-0000-4000-8000-000000000001',%L,'EE-CERT','J','eeaaaaaa-0006-4000-8000-000000000001'::uuid)$$,(select v from cc_ids where k='key_conflict')));
select is((select count(*)::int from public.cycle_count_observation_idempotency where session_id=(select v from cc_ids where k='key_conflict')),1,'conflicting key reuse keeps one canonical payload');
select is((select count(*)::int from public.cycle_count_observation_attempts where session_id=(select v from cc_ids where k='key_conflict') and outcome='idempotency_conflict'),1,'conflicting reuse is a structured append-only attempt');

-- Resolution attempt race and completion versus resolution.
set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);insert into cc_ids values('resolve_race',pg_temp.new_count('ROOT',true));
select public.observe_cycle_count_item('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='resolve_race'),'EE-CERT','J','eeaaaaaa-0007-4000-8000-000000000001'::uuid);
select public.submit_cycle_count_round('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='resolve_race'),true);
reset role;insert into cc_ids values('resolve_d',(select id from public.cycle_count_discrepancies where session_id=(select v from cc_ids where k='resolve_race') and status='open'));set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);
insert into cc_ids values('resolve_a',(public.create_cycle_count_resolution_attempt('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='resolve_d'),'item_moved_to_counted_location','race',null,'eecccccc-0001-4000-8000-000000000001'::uuid)->>'attempt_id')::uuid);reset role;commit;
select pg_temp.race('resolve_attempt',format($$public.execute_cycle_count_resolution_attempt('eeee0000-0000-4000-8000-000000000001',%L)$$,(select v from cc_ids where k='resolve_a')),
 format($$public.execute_cycle_count_resolution_attempt('eeee0000-0000-4000-8000-000000000001',%L)$$,(select v from cc_ids where k='resolve_a')));
select is((select status from public.cycle_count_resolution_attempts where id=(select v from cc_ids where k='resolve_a')),'succeeded','concurrent attempt execution succeeds once');
select is((select count(*)::int from public.inventory_movements where item_id=(select v from cc_ids where k='item') and note='race'),1,'successful resolution mutation is not repeated');

-- Return item to I so the final fixture starts from a stable snapshot.
set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);select public.move_inventory_item('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='item'),'I','reset');
insert into cc_ids values('complete_race',pg_temp.new_count('L'));select public.observe_cycle_count_lot('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='complete_race'),'RV-C-9000000002',8,'eebbbbbb-0005-4000-8000-000000000001'::uuid);select public.submit_cycle_count_round('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='complete_race'),false);
reset role;insert into cc_ids values('complete_d',(select id from public.cycle_count_discrepancies where session_id=(select v from cc_ids where k='complete_race') and status='open'));set role authenticated;select set_config('request.jwt.claims',json_build_object('sub','ee111111-1111-4111-8111-111111111111','role','authenticated')::text,false);
insert into cc_ids values('complete_a',(public.create_cycle_count_resolution_attempt('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='complete_d'),'lot_quantity_adjusted','race',null,'eecccccc-0002-4000-8000-000000000001'::uuid)->>'attempt_id')::uuid);
-- lot_quantity_adjusted requires a distinct-actor approval; the second owner approves before the race.
select set_config('request.jwt.claims',json_build_object('sub','ee222222-2222-4222-8222-222222222222','role','authenticated')::text,false);select public.approve_cycle_count_resolution_attempt('eeee0000-0000-4000-8000-000000000001',(select v from cc_ids where k='complete_a'));reset role;commit;
select pg_temp.race('complete_resolution',format($$public.execute_cycle_count_resolution_attempt('eeee0000-0000-4000-8000-000000000001',%L)$$,(select v from cc_ids where k='complete_a')),
 format($$public.complete_cycle_count_latest('eeee0000-0000-4000-8000-000000000001',%L,false,'race')$$,(select v from cc_ids where k='complete_race')));
select is((select status from public.cycle_count_resolution_attempts where id=(select v from cc_ids where k='complete_a')),'succeeded','resolution wins or follows completion check exactly once');
select ok((select status in ('review','completed') from public.cycle_count_sessions where id=(select v from cc_ids where k='complete_race')),'completion race leaves a coherent review or completed lifecycle');

select is((select count(*)::int from pg_stat_activity where pid in(select pid from cc_worker_pids)),0,'all concurrency workers are cleaned up');
select is((select count(*)::int from public.cycle_count_round_results r join public.cycle_count_rounds cr on cr.id=r.round_id where cr.status='counting'),0,'no result was evaluated for an open counting round');

reset role;
-- Teardown bypasses append-only triggers and composite FK ordering, matching
-- the existing bounded concurrency harness.
set session_replication_role=replica;
delete from public.cycle_count_resolution_attempt_events where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.inventory_loss_events where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_resolution_attempts where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_resolutions where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_discrepancies where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_round_results where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_round_item_attestations where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_observation_attempts where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_observation_idempotency where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_item_observations where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_lot_observations where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_recount_selections where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_round_subjects where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_round_lifecycle_events where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_rounds where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_expected_items where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_expected_lots where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_scope_locations where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.cycle_count_sessions where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.inventory_movements where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.inventory_quantity_adjustments where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.inventory_items where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.inventory_lots where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.tcg_sku_attributes where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.sellable_skus where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.tcg_product_attributes where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.product_catalog where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.storage_locations where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.workspace_members where workspace_id='eeee0000-0000-4000-8000-000000000001';
delete from public.workspaces where id='eeee0000-0000-4000-8000-000000000001';
delete from auth.users where id='ee111111-1111-4111-8111-111111111111';
set session_replication_role=origin;
select * from finish();
