begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(60);

create function pg_temp.h(p_seed text) returns text language sql immutable as $$
  select encode(sha256(p_seed::bytea), 'hex')
$$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into auth.users(id,email) values
 ('57000000-0000-4000-8000-000000000001','owner57@example.test'),
 ('57000000-0000-4000-8000-000000000002','operator57@example.test'),
 ('57000000-0000-4000-8000-000000000003','viewer57@example.test'),
 ('57000000-0000-4000-8000-000000000004','outsider57@example.test');
insert into public.workspaces(id,name,created_by) values
 ('57000000-1000-4000-8000-000000000001','S1.2 execution','57000000-0000-4000-8000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('57000000-1000-4000-8000-000000000001','57000000-0000-4000-8000-000000000002','operator'),
 ('57000000-1000-4000-8000-000000000001','57000000-0000-4000-8000-000000000003','viewer');
insert into public.source_systems(id,workspace_id,public_id,kind,instance_label,created_by) values
 ('57000000-2000-4000-8000-000000000001','57000000-1000-4000-8000-000000000001','SRC-57','manual','S1.2 source','57000000-0000-4000-8000-000000000001');
insert into public.import_jobs(id,workspace_id,public_id,source_system_id,source_label,file_sha256,content_sha256,parser_version,mapping_version,idempotency_key,mode,status,source_row_count,accepted_row_count,issue_row_count,source_totals,actor_user_id,actor_process)
values('57000000-3000-4000-8000-000000000001','57000000-1000-4000-8000-000000000001','IMP-57','57000000-2000-4000-8000-000000000001','fixture',repeat('a',64),repeat('b',64),'1.0.0','1.0.0','s12-execution-source','commit','preview',13,0,0,'{}','57000000-0000-4000-8000-000000000001','test.import');

create temporary table s12_lines(id uuid primary key, n int, title text, vertical text);
insert into s12_lines values
 ('57000000-5000-4000-8000-000000000001',1,'ordinary shirt','Apparel'),
 ('57000000-5000-4000-8000-000000000002',2,'PSA 10 booster box','Unknown vertical'),
 ('57000000-5000-4000-8000-000000000003',3,'stream - PSA 10 Charizard','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000004',4,'stream - booster box','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000005',5,'stream - NM single','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000006',6,'MYSTERY WHEEL - booster pack','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000007',7,'MYSTERY WHEEL - #499','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000008',8,'PSA 10 Charizard - Charizard','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000009',9,'booster bundle - product 123','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000010',10,'NM Pikachu - Pikachu','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000011',11,'ordinary card name','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000012',12,'operator classification','Pokémon / TCG'),
 ('57000000-5000-4000-8000-000000000013',13,'preview classification','Pokémon / TCG');
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process)
select gen_random_uuid(),'57000000-1000-4000-8000-000000000001','57000000-3000-4000-8000-000000000001',n-1,'line-'||n,jsonb_build_object('product_name',title,'business_vertical',vertical),pg_temp.h('line-'||n),'parsed','{}','1.0.0','1.0.0','test.import' from s12_lines;
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=13 where id='57000000-3000-4000-8000-000000000001';
insert into public.channels(id,workspace_id,public_id,name,kind,created_by) values
 ('57000000-6000-4000-8000-000000000001','57000000-1000-4000-8000-000000000001','RV-CH-S12001','S1.2','manual','57000000-0000-4000-8000-000000000001');
insert into public.acquisition_import_jobs(id,workspace_id,channel_id,source_import_job_id,idempotency_key,mode,status,expected_line_count,mapping_version,plan_sha256,committed_orders,committed_lots,committed_line_items,committed_cost_components,committed_unresolved_supplier_candidates,committed_unresolved_cost_components,actor_user_id,actor_process,completed_at)
values('57000000-4000-4000-8000-000000000001','57000000-1000-4000-8000-000000000001','57000000-6000-4000-8000-000000000001','57000000-3000-4000-8000-000000000001','s12-execution-acq','commit','preview',12,'1.0.0',repeat('c',64),null,null,null,null,null,null,'57000000-0000-4000-8000-000000000001','test.import',null),
 ('57000000-4000-4000-8000-000000000002','57000000-1000-4000-8000-000000000001','57000000-6000-4000-8000-000000000001','57000000-3000-4000-8000-000000000001','s12-preview-acq','commit','preview',1,'1.0.0',repeat('d',64),null,null,null,null,null,null,'57000000-0000-4000-8000-000000000001','test.import',null);
insert into public.acquisition_line_items(id,workspace_id,public_id,source_system_id,source_record_id,acquisition_import_job_id,quantity,source_detail,created_by_process)
select l.id,'57000000-1000-4000-8000-000000000001','LINE-57-'||l.n,'57000000-2000-4000-8000-000000000001',sr.id,
 case when l.n=13 then '57000000-4000-4000-8000-000000000002'::uuid else '57000000-4000-4000-8000-000000000001'::uuid end,
 1,jsonb_build_object('product_name',l.title,'business_vertical',l.vertical)
   || case when l.n=12 then '{"seller_raw_handle":"loosepacks"}'::jsonb else '{}'::jsonb end,
 'test.import'
from s12_lines l join public.source_records sr on sr.source_row_key='line-'||l.n and sr.workspace_id='57000000-1000-4000-8000-000000000001';
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=0,
 committed_lots=0,committed_line_items=12,committed_cost_components=0,
 committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0
where id='57000000-4000-4000-8000-000000000001';

select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000001')->>'option_key','apparel','known non-card mapping wins');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000002')->>'option_key','other','unknown non-card becomes Other');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000002')->>'method','system_fallback','unknown non-card records system fallback');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000003')->>'option_key','slab','delivered grader classifies slab');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000004')->>'option_key','sealed','delivered sealed signal classifies sealed');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000005')->>'option_key','single','delivered single signal classifies single');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000006')->>'option_key','sealed','delivered signal defeats mystery prefix');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000007')->>'option_key','unreviewed','mystery without delivered signal is Unreviewed');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000008')->>'option_key','slab','full-title grader fallback executes');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000009')->>'option_key','sealed','full-title sealed fallback executes');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000010')->>'option_key','single','full-title single fallback executes');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000011')->>'option_key','unreviewed','unknown card line becomes Unreviewed');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000011')->>'method','system_fallback','unknown card line uses explicit fallback method');
select ok((app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000011')->'evidence') ? 'fallback','fallback carries explicit evidence');
select ok((app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000011')->>'rule_id') is null,'fallback stores no fake rule');
select ok(not exists(select 1 from public.classification_rules where matcher_kind='evidence_set' and app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000011')->>'rule_id'=id::text),'explicit-evidence placeholder remains nonmatching');

insert into public.classification_rules(workspace_id,logical_key,rule_family,matcher_kind,match_field,pattern,pattern_flags,target_classification_option_id,precedence,version,status,rationale,source)
select '57000000-1000-4000-8000-000000000001','retired:must-not-match','full_title_pattern','regex','full_title','ordinary card','i',id,1,1,'retired','history only','owner_rule'
from public.acquisition_classification_options where workspace_id='57000000-1000-4000-8000-000000000001' and key='slab';
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000011')->>'option_key','unreviewed','retired rule is ignored');
insert into public.classification_rules(workspace_id,logical_key,rule_family,matcher_kind,match_field,pattern,pattern_flags,target_classification_option_id,precedence,version,status,rationale,source)
select '57000000-1000-4000-8000-000000000001','ambiguity:'||key,'full_title_pattern','regex','full_title','ordinary card','i',id,5,1,'active','ambiguity proof','owner_rule'
from public.acquisition_classification_options where workspace_id='57000000-1000-4000-8000-000000000001' and key in ('single','sealed');
select throws_ok($$select app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000011')$$,'23514',null,'multiple lowest-precedence winners fail closed');
update public.classification_rules set status='retired' where logical_key like 'ambiguity:%';

insert into public.suppliers(id,workspace_id,public_id,display_name,created_by_process) values
 ('57000000-7000-4000-8000-000000000001','57000000-1000-4000-8000-000000000001','RV-SUP-S12001','Misleading display topshelfcollects','test.import');
insert into public.supplier_aliases(id,workspace_id,supplier_id,source_system_id,raw_handle,normalized_handle,created_by_process) values
 ('57000000-7100-4000-8000-000000000001','57000000-1000-4000-8000-000000000001','57000000-7000-4000-8000-000000000001','57000000-2000-4000-8000-000000000001','loosepacks','loosepacks','test.import');
set local session_replication_role=replica;
insert into public.acquisition_orders(id,workspace_id,public_id,channel_id,supplier_id,source_system_id,acquisition_import_job_id,source_order_reference,first_source_record_id,order_status,created_by_process)
select '57000000-7200-4000-8000-000000000001','57000000-1000-4000-8000-000000000001','RV-ACQ-S12001','57000000-6000-4000-8000-000000000001','57000000-7000-4000-8000-000000000001','57000000-2000-4000-8000-000000000001','57000000-4000-4000-8000-000000000001','ORDER-57',source_record_id,'unknown','test.import'
from public.acquisition_line_items where id='57000000-5000-4000-8000-000000000012';
insert into public.acquisition_lots(id,workspace_id,public_id,order_id,created_by_process) values
 ('57000000-7300-4000-8000-000000000001','57000000-1000-4000-8000-000000000001','RV-ALOT-S12001','57000000-7200-4000-8000-000000000001','test.import');
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,created_by_process) values
 ('57000000-7400-4000-8000-000000000001','57000000-1000-4000-8000-000000000001','57000000-7300-4000-8000-000000000001','57000000-5000-4000-8000-000000000012','test.import');
set local session_replication_role=origin;
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000012')->>'option_key','sealed','governed supplier alias is seller fallback');
select is(app.evaluate_acquisition_classification('57000000-5000-4000-8000-000000000012')->>'method','seller_specialization','display-name similarity is not seller evidence');

select pg_temp.as_user('57000000-0000-4000-8000-000000000001');
select is(public.classify_acquisition_line('57000000-5000-4000-8000-000000000011')->>'status','classified','owner first classification succeeds');
select is(public.classify_acquisition_line('57000000-5000-4000-8000-000000000011')->>'status','idempotent','repeat classification is idempotent');
select is((select count(*)::int from public.audit_events where event_type='acquisition_line_classified'),1,'idempotent repeat emits no audit event');
select is(public.override_acquisition_line_classification('57000000-5000-4000-8000-000000000011','sealed','owner observed sealed product')->>'status','overridden','owner override succeeds');
select is(public.classify_acquisition_line('57000000-5000-4000-8000-000000000011')->>'status','owner_override_preserved','automatic classifier preserves override');
select is(public.override_acquisition_line_classification('57000000-5000-4000-8000-000000000011','sealed','repeat')->>'status','idempotent','same owner override is idempotent');
select is((select count(*)::int from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000011'),2,'automatic predecessor remains in history');
select is((select count(*)::int from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000011' and superseded_at is null),1,'override leaves exactly one current row');
select throws_ok($$select public.override_acquisition_line_classification('57000000-5000-4000-8000-000000000012','sealed','')$$,'22023',null,'override reason is validated');

reset role; select pg_temp.as_user('57000000-0000-4000-8000-000000000002');
select is(public.classify_acquisition_line('57000000-5000-4000-8000-000000000012')->>'status','classified','operator may classify');
select throws_ok($$select public.override_acquisition_line_classification('57000000-5000-4000-8000-000000000012','sealed','operator attempt')$$,'42501',null,'operator may not override');
reset role; select pg_temp.as_user('57000000-0000-4000-8000-000000000003');
select throws_ok($$select public.classify_acquisition_line('57000000-5000-4000-8000-000000000012')$$,'42501',null,'viewer may not classify');
reset role; select pg_temp.as_user('57000000-0000-4000-8000-000000000004');
select throws_ok($$select public.classify_acquisition_line('57000000-5000-4000-8000-000000000012')$$,'42501',null,'nonmember may not classify');
reset role; set local role anon;
select throws_ok($$select public.classify_acquisition_line('57000000-5000-4000-8000-000000000012')$$,'42501',null,'anonymous cannot execute classifier');
reset role; select pg_temp.as_user('57000000-0000-4000-8000-000000000001');
select throws_ok($$select public.classify_acquisition_line('57000000-5000-4000-8000-000000000013')$$,'23514',null,'preview acquisition job is rejected');

select is(public.create_classification_rule('57000000-1000-4000-8000-000000000001','owner:test-rule','full_title_pattern','regex','full_title','owner rule', 'i',null,'single',50,'owner-authored test')->>'version','1','owner creates governed rule');
select throws_ok($$select public.create_classification_rule('57000000-1000-4000-8000-000000000001','owner:bad-rule','full_title_pattern','regex','full_title','x','g',null,'single',51,'bad flags')$$,'22023',null,'invalid rule payload is rejected');
select is((select count(*)::int from public.audit_events where event_type='classification_rule_created'),1,'rule creation audit recorded');
select is(public.supersede_classification_rule((select id from public.classification_rules where logical_key='owner:test-rule' and status='active'),1,'regex','full_title','owner rule v2','i',null,'sealed',50,'version two')->>'version','2','owner supersedes rule version');
select is((select count(*)::int from public.classification_rules where logical_key='owner:test-rule'),2,'old rule remains as history');
select is((select count(*)::int from public.classification_rules where logical_key='owner:test-rule' and status='active'),1,'one active rule version remains');
select throws_ok($$select public.supersede_classification_rule((select id from public.classification_rules where logical_key='owner:test-rule' and status='active'),1,'regex','full_title','x','i',null,'single',50,'stale')$$,'40001',null,'stale rule version is rejected');
reset role; select pg_temp.as_user('57000000-0000-4000-8000-000000000002');
select throws_ok($$select public.create_classification_rule('57000000-1000-4000-8000-000000000001','operator:no','full_title_pattern','regex','full_title','x','i',null,'single',60,'no')$$,'42501',null,'operator cannot author rules');
reset role;

select is((select count(*)::int from public.audit_events where event_type='acquisition_line_classification_overridden'),1,'override audit emitted only for real change');
select is((select count(*)::int from public.audit_events where event_type='classification_rule_superseded'),1,'rule supersession audit recorded');
select ok(not has_table_privilege('authenticated','public.acquisition_line_classifications','insert'),'direct classification writes remain denied');
select ok(not has_table_privilege('authenticated','public.classification_rules','insert'),'direct rule writes remain denied');

reset role;
commit;

-- Genuine overlapping sessions; sequential calls cannot prove these locks.
create function pg_temp.await_all(p_conns text[], p_seconds numeric default 20)
returns void language plpgsql as $$
declare started timestamptz:=clock_timestamp(); c text; busy boolean;
begin loop busy:=false; foreach c in array p_conns loop busy:=busy or dblink_is_busy(c)=1; end loop;
 exit when not busy; if clock_timestamp()-started>make_interval(secs=>p_seconds) then raise exception 'classification concurrency deadline' using errcode='55P03'; end if;
 perform pg_sleep(.02); end loop; end $$;
create temporary table s12_conn(dsn text);
insert into s12_conn values(case when current_setting('is_superuser')='on' then 'dbname='||current_database()
 else format('host=%s port=%s dbname=%s user=postgres password=postgres',coalesce(host(inet_server_addr()),'127.0.0.1'),coalesce(inet_server_port()::text,current_setting('port')),current_database()) end);
create function pg_temp.auth_sql(p_call text) returns text language sql as $$
 select format($q$with auth as materialized (select set_config('request.jwt.claims',%L,false)) select (%s)::text from auth$q$,
 json_build_object('sub','57000000-0000-4000-8000-000000000001','role','authenticated')::text,p_call)
$$;
create function pg_temp.race(p_name text,p_left text,p_right text) returns text[] language plpgsql as $$
declare cs text[]:=array[p_name||'_1',p_name||'_2']; a text; b text;
begin
 perform dblink_connect(cs[1],(select dsn from s12_conn)); perform dblink_connect(cs[2],(select dsn from s12_conn));
 perform dblink_send_query(cs[1],pg_temp.auth_sql(p_left)); perform dblink_send_query(cs[2],pg_temp.auth_sql(p_right)); perform pg_temp.await_all(cs);
 select result into a from dblink_get_result(cs[1]) t(result text); select result into b from dblink_get_result(cs[2]) t(result text);
 perform dblink_disconnect(cs[1]); perform dblink_disconnect(cs[2]); return array[a,b];
exception when others then begin perform dblink_disconnect(cs[1]); exception when others then null; end; begin perform dblink_disconnect(cs[2]); exception when others then null; end; raise;
end $$;

select pg_temp.race('s12_classifiers',
 $$public.classify_acquisition_line('57000000-5000-4000-8000-000000000001')$$,
 $$public.classify_acquisition_line('57000000-5000-4000-8000-000000000001')$$);
select is((select count(*)::int from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000001' and superseded_at is null),1,'two concurrent classifiers produce one current row');
select is((select count(*)::int from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000001'),1,'concurrent classifier replay is idempotent');

select pg_temp.race('s12_classifier_override',
 $$public.classify_acquisition_line('57000000-5000-4000-8000-000000000002')$$,
 $$public.override_acquisition_line_classification('57000000-5000-4000-8000-000000000002','sealed','concurrent owner evidence')$$);
select is((select method from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000002' and superseded_at is null),'owner_override','classifier versus override preserves owner result');
select ok((select count(*) between 1 and 2 from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000002'),'classifier versus override preserves a valid serialized history');
select is((select count(*)::int from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000002' and superseded_at is null),1,'classifier versus override leaves one current row');

select pg_temp.race('s12_overrides',
 $$public.override_acquisition_line_classification('57000000-5000-4000-8000-000000000003','single','concurrent evidence A')$$,
 $$public.override_acquisition_line_classification('57000000-5000-4000-8000-000000000003','sealed','concurrent evidence B')$$);
select is((select count(*)::int from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000003' and superseded_at is null),1,'two concurrent overrides produce one current row');
select is((select count(*)::int from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000003'),2,'two concurrent overrides preserve both history rows');

create function public.s12_test_supersede_catcher() returns text language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 perform set_config('request.jwt.claims',json_build_object('sub','57000000-0000-4000-8000-000000000001','role','authenticated')::text,true);
 select id into rid from public.classification_rules where workspace_id='57000000-1000-4000-8000-000000000001' and logical_key='owner:test-rule' and status='active';
 perform public.supersede_classification_rule(rid,2,'regex','full_title','concurrent v3','i',null,'single',50,'concurrent version');
 return 'won';
exception when others then return sqlstate; end $$;
create temporary table s12_rule_race(result text[]);
insert into s12_rule_race select pg_temp.race('s12_rule_supersessions','public.s12_test_supersede_catcher()','public.s12_test_supersede_catcher()');
select is((select count(*)::int from unnest((select result from s12_rule_race)) r where r='won'),1,'two concurrent rule supersessions produce one winner');
select is((select count(*)::int from public.classification_rules where logical_key='owner:test-rule' and status='active'),1,'concurrent rule supersession leaves one active winner');
select is((select count(*)::int from public.classification_rules where logical_key='owner:test-rule'),3,'concurrent rule supersession preserves version history');
drop function public.s12_test_supersede_catcher();

select set_config('request.jwt.claims',json_build_object('sub','57000000-0000-4000-8000-000000000001','role','authenticated')::text,false);
select public.classify_acquisition_line('57000000-5000-4000-8000-000000000004');
select public.supersede_classification_rule(
 (select id from public.classification_rules where workspace_id='57000000-1000-4000-8000-000000000001' and logical_key='delivered_item:sealed' and status='active'),
 5,'regex','delivered_item_title','booster box','i',null,'slab',220,'force changed result for rollback proof');
create function public.s12_test_fail_successor() returns trigger language plpgsql as $$
begin if new.acquisition_line_item_id='57000000-5000-4000-8000-000000000004' then raise exception 'test successor failure' using errcode='23514'; end if; return new; end $$;
create trigger s12_test_fail_successor before insert on public.acquisition_line_classifications for each row execute function public.s12_test_fail_successor();
select throws_ok($$select public.classify_acquisition_line('57000000-5000-4000-8000-000000000004')$$,'23514',null,'failed successor insertion surfaces atomically');
select is((select count(*)::int from public.acquisition_line_classifications where acquisition_line_item_id='57000000-5000-4000-8000-000000000004' and superseded_at is null),1,'failed successor restores exactly one current predecessor');
select is((select o.key from public.acquisition_line_classifications c join public.acquisition_classification_options o on o.id=c.classification_option_id where c.acquisition_line_item_id='57000000-5000-4000-8000-000000000004' and c.superseded_at is null),'sealed','failed successor rolls back predecessor retirement');
drop trigger s12_test_fail_successor on public.acquisition_line_classifications;
drop function public.s12_test_fail_successor();

select * from finish();
