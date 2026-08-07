-- S1.5 governed acquisition-line exclusion BEHAVIOR.
--
-- Every assertion below calls a public governed function against a real
-- committed acquisition fixture and inspects the resulting rows, audit trail,
-- read models, and list/facet output. Structural existence checks are kept at
-- the top, but they are not the acceptance: a routine that exists and is
-- granted correctly while behaving wrongly must fail this file.
--
-- The exclusion contract under test: an excluded acquisition line is never
-- deleted, hidden, or altered. Its quantity, classification, placement and
-- source evidence stay exactly as they were, it remains visible in unfiltered
-- reads, and the ONLY thing that changes is downstream eligibility plus an
-- append-only decision history.
--
-- The concurrency section below the commit uses overlapping dblink sessions.
-- Sequential statements are not concurrency evidence and none are represented
-- as such here.
begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(159);

create function pg_temp.h(p_seed text) returns text language sql immutable as $$
  select encode(sha256(p_seed::bytea), 'hex')
$$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- Current governed state of one line, straight from the decision ledger.
create function pg_temp.current_state(p_line uuid) returns text language sql as $$
  select coalesce((select e.decision_state::text from public.acquisition_line_exclusions e
    where e.workspace_id='63000000-1000-4000-8000-000000000001' and e.acquisition_line_item_id=p_line and e.superseded_at is null),'included')
$$;
create function pg_temp.overview_state(p_line text) returns text language sql as $$
  select v.exclusion_state from public.acquisition_line_overview v
   where v.workspace_id='63000000-1000-4000-8000-000000000001' and v.acquisition_line_public_id=p_line
$$;
create function pg_temp.detail(p_line text) returns jsonb language sql as $$
  select public.get_acquisition_line_detail_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A',p_line)
$$;
create function pg_temp.audit_count(p_type text, p_decision text) returns int language sql as $$
  select count(*)::int from public.audit_events where event_type=p_type and detail->>'decision_public_id'=p_decision
$$;
create function pg_temp.listed(p_exclusion text, p_limit int default 50, p_offset int default 0) returns jsonb language sql as $$
  select public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,null,null,null,null,null,'occurred_at','desc',p_limit,p_offset,p_exclusion)
$$;
create function pg_temp.line_ids(p_result jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(r->>'acquisition_line_public_id' order by r->>'acquisition_line_public_id'),'{}') from jsonb_array_elements(p_result->'rows') r
$$;
create function pg_temp.facet_count(p_value text) returns int language sql as $$
  select coalesce((select (x->>'count')::int from jsonb_array_elements(public.get_acquisition_facets('63000000-1000-4000-8000-000000000001')->'exclusionStates') x where x->>'value'=p_value),0)
$$;

-- ---------------------------------------------------------------- structure --
select has_table('public','acquisition_line_exclusions','exclusion decision table exists');
select has_column('public','acquisition_line_exclusions','public_id','governed public identity exists');
select has_column('public','acquisition_line_exclusions','decision_state','decision state exists');
select has_column('public','acquisition_line_exclusions','reason','reason exists');
select has_column('public','acquisition_line_exclusions','idempotency_key','durable operation key exists');
select col_not_null('public','acquisition_line_exclusions','workspace_id','workspace is required');
select col_not_null('public','acquisition_line_exclusions','reason','reason is required');
select has_function('public','exclude_acquisition_line_by_source',array['uuid','text','text','text','text'],'source-qualified exclude exists');
select has_function('public','restore_acquisition_line_by_source',array['uuid','text','text','text','text'],'source-qualified restore exists');
select has_function('app','assert_acquisition_line_eligible_for_downstream',array['uuid','uuid'],'downstream guard exists');
select ok((select relrowsecurity from pg_class where oid='public.acquisition_line_exclusions'::regclass),'RLS enabled');
select ok(has_table_privilege('authenticated','public.acquisition_line_exclusions','select'),'members can read decisions');
select ok(not has_table_privilege('authenticated','public.acquisition_line_exclusions','insert'),'authenticated cannot directly insert');
select ok(not has_table_privilege('authenticated','public.acquisition_line_exclusions','update'),'authenticated cannot directly update');
select ok(not has_table_privilege('authenticated','public.acquisition_line_exclusions','delete'),'authenticated cannot directly delete');
select ok(not has_table_privilege('authenticated','public.acquisition_line_exclusions','truncate'),'authenticated cannot truncate the decision ledger');
select is((select count(*)::int from public.schema_migrations_log where migration_name='20260806000700_acquisition_line_exclusions'),1,'migration ledger recorded once');

-- ---------------------------------------------------------------- fixture ---
insert into auth.users(id,email) values
 ('63000000-0000-4000-8000-000000000001','owner63@example.test'),
 ('63000000-0000-4000-8000-000000000002','operator63@example.test'),
 ('63000000-0000-4000-8000-000000000003','viewer63@example.test'),
 ('63000000-0000-4000-8000-000000000004','ownerf63@example.test');
insert into public.workspaces(id,name,created_by) values
 ('63000000-1000-4000-8000-000000000001','S1.5 exclusions','63000000-0000-4000-8000-000000000001'),
 ('63000000-1000-4000-8000-000000000002','S1.5 foreign','63000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('63000000-1000-4000-8000-000000000001','63000000-0000-4000-8000-000000000002','operator'),
 ('63000000-1000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','viewer');
insert into public.source_systems(id,workspace_id,public_id,kind,instance_label,created_by) values
 ('63000000-2000-4000-8000-000000000001','63000000-1000-4000-8000-000000000001','SRC-63-A','manual','A source','63000000-0000-4000-8000-000000000001'),
 ('63000000-2000-4000-8000-000000000002','63000000-1000-4000-8000-000000000002','SRC-63-F','manual','foreign source','63000000-0000-4000-8000-000000000004');
insert into public.import_jobs(id,workspace_id,public_id,source_system_id,source_label,file_sha256,content_sha256,parser_version,mapping_version,idempotency_key,mode,status,source_row_count,accepted_row_count,issue_row_count,source_totals,actor_user_id,actor_process) values
 ('63000000-3000-4000-8000-000000000001','63000000-1000-4000-8000-000000000001','IMP-63-A','63000000-2000-4000-8000-000000000001','fixture',repeat('a',64),repeat('b',64),'1.0.0','1.0.0','s15-excl-a','commit','preview',5,0,0,'{}','63000000-0000-4000-8000-000000000001','test.import'),
 ('63000000-3000-4000-8000-000000000002','63000000-1000-4000-8000-000000000002','IMP-63-F','63000000-2000-4000-8000-000000000002','fixture',repeat('c',64),repeat('d',64),'1.0.0','1.0.0','s15-excl-f','commit','preview',1,0,0,'{}','63000000-0000-4000-8000-000000000004','test.import');
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process)
select ('63000000-5100-4000-8000-00000000000'||n)::uuid,'63000000-1000-4000-8000-000000000001','63000000-3000-4000-8000-000000000001',n-1,'a-row-'||n,
 jsonb_build_object('product_name','stream - booster box '||n,'business_vertical','Pokémon / TCG'),pg_temp.h('a-row-'||n),'parsed','{}','1.0.0','1.0.0','test.import'
from generate_series(1,5) n;
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process) values
 ('63000000-5100-4000-8000-000000000009','63000000-1000-4000-8000-000000000002','63000000-3000-4000-8000-000000000002',0,'f-row-1','{"product_name":"foreign line"}',pg_temp.h('f-row-1'),'parsed','{}','1.0.0','1.0.0','test.import');
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=5 where id='63000000-3000-4000-8000-000000000001';
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=1 where id='63000000-3000-4000-8000-000000000002';
insert into public.channels(id,workspace_id,public_id,name,kind,created_by) values
 ('63000000-6000-4000-8000-000000000001','63000000-1000-4000-8000-000000000001','RV-CH-63A001','A channel','manual','63000000-0000-4000-8000-000000000001'),
 ('63000000-6000-4000-8000-000000000002','63000000-1000-4000-8000-000000000002','RV-CH-63F001','F channel','manual','63000000-0000-4000-8000-000000000004');
insert into public.suppliers(id,workspace_id,public_id,display_name,created_by_process) values
 ('63000000-7000-4000-8000-000000000001','63000000-1000-4000-8000-000000000001','RV-SUP-63A001','A seller','test.import'),
 ('63000000-7000-4000-8000-000000000002','63000000-1000-4000-8000-000000000002','RV-SUP-63F001','Foreign seller','test.import');
insert into public.acquisition_import_jobs(id,workspace_id,channel_id,source_import_job_id,idempotency_key,mode,status,expected_line_count,mapping_version,plan_sha256,actor_user_id,actor_process) values
 ('63000000-4000-4000-8000-000000000001','63000000-1000-4000-8000-000000000001','63000000-6000-4000-8000-000000000001','63000000-3000-4000-8000-000000000001','s15-acq-a','commit','preview',5,'1.0.0',repeat('1',64),'63000000-0000-4000-8000-000000000001','test.import'),
 ('63000000-4000-4000-8000-000000000002','63000000-1000-4000-8000-000000000002','63000000-6000-4000-8000-000000000002','63000000-3000-4000-8000-000000000002','s15-acq-f','commit','preview',1,'1.0.0',repeat('2',64),'63000000-0000-4000-8000-000000000004','test.import');
-- Five lines with distinct quantities so sort order is observable, and one
-- foreign-workspace line that must stay invisible throughout.
insert into public.acquisition_line_items(id,workspace_id,public_id,source_system_id,source_record_id,acquisition_import_job_id,quantity,description,source_detail,created_by_process)
select ('63000000-5000-4000-8000-00000000000'||n)::uuid,'63000000-1000-4000-8000-000000000001','LINE-63-A'||n,'63000000-2000-4000-8000-000000000001',
 ('63000000-5100-4000-8000-00000000000'||n)::uuid,'63000000-4000-4000-8000-000000000001',n,'line '||n,
 jsonb_build_object('product_name','stream - booster box '||n,'business_vertical','Pokémon / TCG'),'test.import'
from generate_series(1,5) n;
insert into public.acquisition_line_items(id,workspace_id,public_id,source_system_id,source_record_id,acquisition_import_job_id,quantity,description,source_detail,created_by_process) values
 ('63000000-5000-4000-8000-000000000009','63000000-1000-4000-8000-000000000002','LINE-63-F1','63000000-2000-4000-8000-000000000002','63000000-5100-4000-8000-000000000009','63000000-4000-4000-8000-000000000002',1,'foreign line','{"product_name":"foreign line"}','test.import');
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=5,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='63000000-4000-4000-8000-000000000001';
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=1,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='63000000-4000-4000-8000-000000000002';
set local session_replication_role=replica;
insert into public.acquisition_orders(id,workspace_id,public_id,channel_id,supplier_id,source_system_id,acquisition_import_job_id,source_order_reference,first_source_record_id,order_status,occurred_at,created_by_process) values
 ('63000000-7200-4000-8000-000000000001','63000000-1000-4000-8000-000000000001','RV-ACQ-63A001','63000000-6000-4000-8000-000000000001','63000000-7000-4000-8000-000000000001','63000000-2000-4000-8000-000000000001','63000000-4000-4000-8000-000000000001','ORDER-63-A','63000000-5100-4000-8000-000000000001','unknown','2026-08-01T10:00:00Z','test.import'),
 ('63000000-7200-4000-8000-000000000002','63000000-1000-4000-8000-000000000002','RV-ACQ-63F001','63000000-6000-4000-8000-000000000002','63000000-7000-4000-8000-000000000002','63000000-2000-4000-8000-000000000002','63000000-4000-4000-8000-000000000002','ORDER-63-F','63000000-5100-4000-8000-000000000009','unknown',null,'test.import');
insert into public.acquisition_lots(id,workspace_id,public_id,order_id,created_by_process) values
 ('63000000-7300-4000-8000-000000000001','63000000-1000-4000-8000-000000000001','RV-ALOT-63A001','63000000-7200-4000-8000-000000000001','test.import'),
 ('63000000-7300-4000-8000-000000000002','63000000-1000-4000-8000-000000000002','RV-ALOT-63F001','63000000-7200-4000-8000-000000000002','test.import');
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,sequence_no,created_by_process)
select ('63000000-7400-4000-8000-00000000000'||n)::uuid,'63000000-1000-4000-8000-000000000001','63000000-7300-4000-8000-000000000001',('63000000-5000-4000-8000-00000000000'||n)::uuid,n,'test.import'
from generate_series(1,5) n;
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,created_by_process) values
 ('63000000-7400-4000-8000-000000000009','63000000-1000-4000-8000-000000000002','63000000-7300-4000-8000-000000000002','63000000-5000-4000-8000-000000000009','test.import');
set local session_replication_role=origin;

-- ================================================== GATE 1 — DEFAULT ========
select pg_temp.as_user('63000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.acquisition_line_items where id='63000000-5000-4000-8000-000000000001'),1,'the acquisition line exists');
select is(pg_temp.current_state('63000000-5000-4000-8000-000000000001'),'included','a line with no decision history is included by default');
select is(pg_temp.overview_state('LINE-63-A1'),'included','the read model reports the default included state');
select ok(pg_temp.line_ids(pg_temp.listed(null)) @> array['LINE-63-A1'],'the line is visible in unfiltered acquisition reads');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000001'),0,'no decision row exists by default');
reset role;
select lives_ok($$select app.assert_acquisition_line_eligible_for_downstream('63000000-1000-4000-8000-000000000001','63000000-5000-4000-8000-000000000001')$$,'the downstream eligibility helper succeeds by default');
select pg_temp.as_user('63000000-0000-4000-8000-000000000001');

-- ================================================== GATE 1 — EXCLUDE ========
create temporary table s15_ops(k text primary key, decision text);
insert into s15_ops select 'excl1',public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','  food and candy, not resale inventory  ','s15-exclude-key-a')->>'decisionPublicId';
select matches((select decision from s15_ops where k='excl1'),'^RV-AEXCL-[A-Z0-9]{12}$','exclusion returns a governed RV-AEXCL public ID');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000001' and superseded_at is null),1,'exactly one current decision exists');
select is((select decision_state::text from public.acquisition_line_exclusions where public_id=(select decision from s15_ops where k='excl1')),'excluded','the current decision is excluded');
select is((select reason from public.acquisition_line_exclusions where public_id=(select decision from s15_ops where k='excl1')),'food and candy, not resale inventory','the reason is normalized and stored exactly');
select is((select created_by from public.acquisition_line_exclusions where public_id=(select decision from s15_ops where k='excl1')),'63000000-0000-4000-8000-000000000001'::uuid,'the deciding actor is the owner');
-- The acquisition itself is untouched: exclusion is a decision, not a deletion.
select is((select count(*)::int from public.acquisition_line_items where id='63000000-5000-4000-8000-000000000001'),1,'the original acquisition line still exists');
select is((select quantity from public.acquisition_line_items where id='63000000-5000-4000-8000-000000000001'),1,'the acquisition quantity is unchanged');
select is((select count(*)::int from public.acquisition_line_classifications where acquisition_line_item_id='63000000-5000-4000-8000-000000000001'),0,'the classification is unchanged');
select is((select source_record_id from public.acquisition_line_items where id='63000000-5000-4000-8000-000000000001'),'63000000-5100-4000-8000-000000000001'::uuid,'the source evidence is unchanged');
select is(pg_temp.audit_count('acquisition_line_excluded',(select decision from s15_ops where k='excl1')),1,'exactly one acquisition_line_excluded audit event exists');
select is((select detail->>'prior_state' from public.audit_events where detail->>'decision_public_id'=(select decision from s15_ops where k='excl1')),'included','the audit event records the prior state');
-- Visibility and read models.
select is((select count(*)::int from public.acquisition_line_overview where acquisition_line_public_id='LINE-63-A1'),1,'the overview still contains the acquisition line');
select is(pg_temp.overview_state('LINE-63-A1'),'excluded','the overview reports exclusion_state excluded');
select is(pg_temp.detail('LINE-63-A1')->'exclusion'->>'state','excluded','detail reports the excluded state');
select is(pg_temp.detail('LINE-63-A1')->'exclusion'->'current'->>'publicId',(select decision from s15_ops where k='excl1'),'detail names the exact current decision');
select is(pg_temp.detail('LINE-63-A1')->'exclusion'->'current'->>'reason','food and candy, not resale inventory','detail carries the current decision reason');
select is(jsonb_array_length(pg_temp.detail('LINE-63-A1')->'exclusion'->'history'),1,'detail history contains the exclusion decision');
select is(pg_temp.facet_count('excluded'),1,'the excluded facet count rose to one');
select is(pg_temp.facet_count('included'),4,'the included facet count fell to four');
select is(pg_temp.line_ids(pg_temp.listed('excluded')),array['LINE-63-A1'],'the excluded filter returns the excluded line');
select ok(pg_temp.line_ids(pg_temp.listed(null)) @> array['LINE-63-A1'],'the unfiltered list still returns the excluded line');
select ok(not (pg_temp.line_ids(pg_temp.listed('included')) @> array['LINE-63-A1']),'the included filter no longer returns the excluded line');
reset role;
select throws_ok($$select app.assert_acquisition_line_eligible_for_downstream('63000000-1000-4000-8000-000000000001','63000000-5000-4000-8000-000000000001')$$,'23514','acquisition_line_excluded','the downstream eligibility helper now refuses the excluded line');
select pg_temp.as_user('63000000-0000-4000-8000-000000000001');

-- ================================================== GATE 1 — RESTORE ========
insert into s15_ops select 'rest1',public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','owner reviewed: genuinely resale inventory','s15-restore-key-b')->>'decisionPublicId';
select matches((select decision from s15_ops where k='rest1'),'^RV-AEXCL-[A-Z0-9]{12}$','restoration receives its own governed public ID');
select isnt((select decision from s15_ops where k='rest1'),(select decision from s15_ops where k='excl1'),'the restoring decision is a distinct record');
select ok((select superseded_at is not null from public.acquisition_line_exclusions where public_id=(select decision from s15_ops where k='excl1')),'the original exclusion remains as superseded history');
select is(pg_temp.current_state('63000000-5000-4000-8000-000000000001'),'included','the current decision is included again');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000001' and superseded_at is null),1,'there is exactly one current decision');
select is((select e.superseded_by_exclusion_id from public.acquisition_line_exclusions e where e.public_id=(select decision from s15_ops where k='excl1')),(select r.id from public.acquisition_line_exclusions r where r.public_id=(select decision from s15_ops where k='rest1')),'the superseded decision points at its successor');
select is((select r.supersedes_exclusion_id from public.acquisition_line_exclusions r where r.public_id=(select decision from s15_ops where k='rest1')),(select e.id from public.acquisition_line_exclusions e where e.public_id=(select decision from s15_ops where k='excl1')),'the successor points back at its predecessor');
select is((select reason from public.acquisition_line_exclusions where public_id=(select decision from s15_ops where k='rest1')),'owner reviewed: genuinely resale inventory','the restoration reason is preserved');
select is(pg_temp.audit_count('acquisition_line_restored',(select decision from s15_ops where k='rest1')),1,'exactly one acquisition_line_restored audit event exists');
select is((select detail->>'prior_state' from public.audit_events where detail->>'decision_public_id'=(select decision from s15_ops where k='rest1')),'excluded','the restoration audit records the prior excluded state');
select is(jsonb_array_length(pg_temp.detail('LINE-63-A1')->'exclusion'->'history'),2,'detail history contains both decisions');
select is(pg_temp.detail('LINE-63-A1')->'exclusion'->'history'->0->>'publicId',(select decision from s15_ops where k='excl1'),'history is ordered oldest first, deterministically');
select is(pg_temp.detail('LINE-63-A1')->'exclusion'->'history'->1->>'publicId',(select decision from s15_ops where k='rest1'),'the restoration is the newest history entry');
select is(pg_temp.detail('LINE-63-A1')->'exclusion'->>'state','included','detail reports the restored included state');
select is(pg_temp.overview_state('LINE-63-A1'),'included','the overview now reports included');
select ok(pg_temp.line_ids(pg_temp.listed('included')) @> array['LINE-63-A1'],'the included filter returns the restored line');
select ok(not (pg_temp.line_ids(pg_temp.listed('excluded')) @> array['LINE-63-A1']),'the excluded filter no longer returns the restored line');
select is(pg_temp.facet_count('included'),5,'every line counts as included again');
reset role;
select lives_ok($$select app.assert_acquisition_line_eligible_for_downstream('63000000-1000-4000-8000-000000000001','63000000-5000-4000-8000-000000000001')$$,'the downstream eligibility helper succeeds again');
select pg_temp.as_user('63000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.acquisition_line_overview where acquisition_line_public_id='LINE-63-A1'),1,'the line remained visible throughout the entire lifecycle');

-- ============================================== GATE 2 — IDEMPOTENCY ========
-- Replay of the ORIGINAL exclusion key, long after a restore superseded it.
-- It must return the historical operation outcome and must NOT re-apply it.
select is(public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','  food and candy, not resale inventory  ','s15-exclude-key-a')->>'replayed','true','replaying the original exclusion key reports a replay');
select is(public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','food and candy, not resale inventory','s15-exclude-key-a')->>'decisionPublicId',(select decision from s15_ops where k='excl1'),'the obsolete replay returns the ORIGINAL exclusion receipt');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000001'),2,'the obsolete replay created no new decision row');
select is(pg_temp.audit_count('acquisition_line_excluded',(select decision from s15_ops where k='excl1')),1,'the obsolete replay created no new audit event');
select is(pg_temp.current_state('63000000-5000-4000-8000-000000000001'),'included','the obsolete replay did NOT re-exclude the line');
-- Restoration replay is symmetrical.
select is(public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','owner reviewed: genuinely resale inventory','s15-restore-key-b')->>'replayed','true','replaying the restoration key reports a replay');
select is(public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','owner reviewed: genuinely resale inventory','s15-restore-key-b')->>'decisionPublicId',(select decision from s15_ops where k='rest1'),'the restoration replay returns the original restoration receipt');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000001'),2,'the restoration replay created no new row');
-- One key, one meaning.
select throws_ok($$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','a different reason entirely','s15-exclude-key-a')$$,'23505','idempotency_conflict','a changed reason under the same key is refused');
select throws_ok($$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A2','food and candy, not resale inventory','s15-exclude-key-a')$$,'23505','idempotency_conflict','one key cannot target two different lines');
select throws_ok($$select public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','food and candy, not resale inventory','s15-exclude-key-a')$$,'23505','idempotency_conflict','an exclusion key cannot be reused for a restoration');
select throws_ok($$select public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','a different restoration reason','s15-restore-key-b')$$,'23505','idempotency_conflict','a changed restoration reason under the same key is refused');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000001'),2,'the refused conflicts created no history');
select is((select count(*)::int from public.audit_events where event_type in ('acquisition_line_excluded','acquisition_line_restored') and detail->>'acquisition_line_public_id'='LINE-63-A1'),2,'the refused conflicts created no audit events');
select is(pg_temp.current_state('63000000-5000-4000-8000-000000000001'),'included','the refused conflicts changed no state');
-- After a NEW independent exclusion, the old restore key still replays as history.
insert into s15_ops select 'excl2',public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','excluded again under a fresh key','s15-exclude-key-c')->>'decisionPublicId';
select is(pg_temp.current_state('63000000-5000-4000-8000-000000000001'),'excluded','the fresh exclusion key applies a new decision');
select is(public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','owner reviewed: genuinely resale inventory','s15-restore-key-b')->>'decisionPublicId',(select decision from s15_ops where k='rest1'),'the obsolete restore key still returns its original receipt');
select is(pg_temp.current_state('63000000-5000-4000-8000-000000000001'),'excluded','the obsolete restore replay did NOT restore the newly excluded line');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000001'),3,'the obsolete restore replay created no new row');
-- Redundant transitions are refused by state, not silently accepted.
select throws_ok($$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','already gone','s15-exclude-key-d')$$,'23505','already_excluded','excluding an already-excluded line is refused');
select throws_ok($$select public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A2','never excluded','s15-restore-key-d')$$,'23505','not_excluded','restoring a line that is not excluded is refused');
-- Return LINE-63-A1 to included so later gates start from a known state.
select public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','reset for later gates','s15-restore-key-e');
select is(pg_temp.current_state('63000000-5000-4000-8000-000000000001'),'included','the line is included again for the remaining gates');

-- =============================== GATE 3 — AUTHORIZATION AND ISOLATION ======
select throws_ok($$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','NO-SUCH-LINE','x','s15-missing-key-1')$$,'P0002','acquisition_not_found','a missing line is refused');
reset role; select pg_temp.as_user('63000000-0000-4000-8000-000000000002');
select is(pg_temp.overview_state('LINE-63-A1'),'included','operator may read the current eligibility state');
select is(jsonb_array_length(pg_temp.detail('LINE-63-A1')->'exclusion'->'history'),4,'operator may read the decision history');
select throws_ok($$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A2','operator attempt','s15-operator-key-1')$$,'42501',null,'operator may not exclude');
select throws_ok($$select public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','operator attempt','s15-operator-key-2')$$,'42501',null,'operator may not restore');
reset role; select pg_temp.as_user('63000000-0000-4000-8000-000000000003');
select is(pg_temp.overview_state('LINE-63-A1'),'included','viewer may read the current eligibility state');
select is(jsonb_array_length(pg_temp.detail('LINE-63-A1')->'exclusion'->'history'),4,'viewer may read the decision history');
select throws_ok($$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A2','viewer attempt','s15-viewer-key-1')$$,'42501',null,'viewer may not exclude');
select throws_ok($$select public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A1','viewer attempt','s15-viewer-key-2')$$,'42501',null,'viewer may not restore');
-- Members cannot write the ledger directly under any verb.
select throws_ok($$insert into public.acquisition_line_exclusions(workspace_id,acquisition_line_item_id,decision_state,reason,idempotency_key,payload_fingerprint,created_by) values('63000000-1000-4000-8000-000000000001','63000000-5000-4000-8000-000000000002','excluded','direct','direct-key-1',repeat('a',64),'63000000-0000-4000-8000-000000000003')$$,'42501',null,'authenticated cannot INSERT a decision directly');
select throws_ok($$update public.acquisition_line_exclusions set reason='rewritten' where workspace_id='63000000-1000-4000-8000-000000000001'$$,'42501',null,'authenticated cannot UPDATE a decision directly');
select throws_ok($$delete from public.acquisition_line_exclusions where workspace_id='63000000-1000-4000-8000-000000000001'$$,'42501',null,'authenticated cannot DELETE a decision directly');
select throws_ok($$truncate public.acquisition_line_exclusions$$,'42501',null,'authenticated cannot TRUNCATE the decision ledger');
-- The internal downstream guard is not client-reachable.
select throws_ok($$select app.assert_acquisition_line_eligible_for_downstream('63000000-1000-4000-8000-000000000001','63000000-5000-4000-8000-000000000001')$$,'42501',null,'authenticated cannot execute the internal downstream guard');
select ok(not has_function_privilege('authenticated','app.assert_acquisition_line_eligible_for_downstream(uuid,uuid)','EXECUTE'),'the downstream guard is revoked from authenticated');
select ok(not has_function_privilege('anon','public.exclude_acquisition_line_by_source(uuid,text,text,text,text)','EXECUTE'),'anon cannot execute the governed exclusion');
select ok(not has_function_privilege('anon','public.restore_acquisition_line_by_source(uuid,text,text,text,text)','EXECUTE'),'anon cannot execute the governed restoration');
reset role; set local role anon;
select throws_ok($$select count(*) from public.acquisition_line_exclusions$$,'42501',null,'anonymous direct table access is denied');
select throws_ok($$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A2','anon','s15-anon-key-1')$$,'42501',null,'anonymous mutation is denied');
reset role;
-- Workspace isolation.
select pg_temp.as_user('63000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.acquisition_line_exclusions where workspace_id='63000000-1000-4000-8000-000000000002'),0,'foreign-workspace decision rows are invisible');
reset role; select pg_temp.as_user('63000000-0000-4000-8000-000000000001');
select throws_ok($$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000002','SRC-63-F','LINE-63-F1','cross workspace','s15-cross-key-1')$$,'42501',null,'a foreign workspace refuses the owner of another workspace');
select throws_ok($$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-F','LINE-63-F1','cross target','s15-cross-key-2')$$,'P0002','acquisition_not_found','a cross-workspace target is indistinguishable from a missing one');
reset role; select pg_temp.as_user('63000000-0000-4000-8000-000000000004');
select is(public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000002','SRC-63-F','LINE-63-F1','foreign workspace decision','s15-exclude-key-a')->>'state','excluded','the same idempotency key is independently usable in another workspace');
select is((select count(*)::int from public.acquisition_line_exclusions where idempotency_key='s15-exclude-key-a' and workspace_id='63000000-1000-4000-8000-000000000002'),1,'the foreign workspace holds its own decision under that key');
-- Counted outside RLS: the two rows coexist, but neither member can see both.
reset role;
select is((select count(*)::int from public.acquisition_line_exclusions where idempotency_key='s15-exclude-key-a'),2,'one key means one thing per workspace, not globally');
select pg_temp.as_user('63000000-0000-4000-8000-000000000001');
select is(pg_temp.current_state('63000000-5000-4000-8000-000000000001'),'included','the foreign decision did not touch this workspace');

-- ====================================== GATE 5 — LIST, FACET, PAGINATION ====
-- Exclude two lines so the filters have real history to work against.
select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A4','excluded for facets','s15-exclude-key-f4');
select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A5','excluded for facets','s15-exclude-key-f5');
select is((select count(*)::int from public.acquisition_line_overview where workspace_id='63000000-1000-4000-8000-000000000001'),5,'historical decisions never duplicate acquisition list rows');
select is(pg_temp.facet_count('included')+pg_temp.facet_count('excluded'),5,'every acquisition line contributes exactly once to the exclusion facets');
select is(pg_temp.facet_count('excluded'),2,'currently excluded lines are counted as excluded');
select is(pg_temp.facet_count('included'),3,'default and restored lines are counted as included');
select is(pg_temp.line_ids(pg_temp.listed('excluded')),array['LINE-63-A4','LINE-63-A5'],'the excluded filter returns only current exclusions');
select is(pg_temp.line_ids(pg_temp.listed('included')),array['LINE-63-A1','LINE-63-A2','LINE-63-A3'],'the included filter returns default and restored lines');
select is(array_length(pg_temp.line_ids(pg_temp.listed(null)),1),5,'the unfiltered view keeps all evidence visible');
select is((pg_temp.listed(null)->>'total')::int,5,'the unfiltered total counts every matching line');
-- Pagination: total must mean total matching rows across ALL pages.
select is((pg_temp.listed(null,2,0)->>'total')::int,5,'page 1 reports the total across all pages, not the page size');
select is(jsonb_array_length(pg_temp.listed(null,2,0)->'rows'),2,'page 1 returns exactly one page of rows');
select is((pg_temp.listed(null,2,2)->>'total')::int,5,'page 2 reports the same full total');
select is(jsonb_array_length(pg_temp.listed(null,2,2)->'rows'),2,'page 2 remains reachable');
select is((pg_temp.listed(null,2,4)->>'total')::int,5,'the final partial page still reports the full total');
select is(jsonb_array_length(pg_temp.listed(null,2,4)->'rows'),1,'the final page returns the remainder');
-- Pages must partition the result set: no overlap, nothing lost.
select is((select count(distinct x)::int from unnest(pg_temp.line_ids(pg_temp.listed(null,2,0))||pg_temp.line_ids(pg_temp.listed(null,2,2))||pg_temp.line_ids(pg_temp.listed(null,2,4))) x),5,'the three pages together cover every line exactly once');
select is(pg_temp.line_ids(pg_temp.listed(null,2,0)) && pg_temp.line_ids(pg_temp.listed(null,2,2)),false,'page 1 and page 2 do not overlap');
select is((pg_temp.listed('excluded',1,0)->>'total')::int,2,'a filtered total counts every matching row, not the page');
select is(jsonb_array_length(pg_temp.listed('excluded',1,0)->'rows'),1,'a filtered page still honours the page size');
select is((pg_temp.listed('excluded',1,1)->>'total')::int,2,'the second filtered page reports the same filtered total');
-- The requested sort must actually be applied.
select is((select r->>'acquisition_line_public_id' from jsonb_array_elements(public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,null,null,null,null,null,'quantity','asc',1,0,null)->'rows') r),'LINE-63-A1','sorting by quantity ascending returns the smallest quantity first');
select is((select r->>'acquisition_line_public_id' from jsonb_array_elements(public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,null,null,null,null,null,'quantity','desc',1,0,null)->'rows') r),'LINE-63-A5','sorting by quantity descending returns the largest quantity first');
-- Closed filter vocabularies must still fail closed rather than silently
-- returning an empty page, which is what an operator would read as "none".
select throws_ok($$select public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,null,null,null,'not_a_method',null,'occurred_at','desc',50,0,null)$$,'22023','invalid_filter','an unsupported classification method is rejected');
select throws_ok($$select public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,null,null,null,null,'banana','occurred_at','desc',50,0,null)$$,'22023','invalid_filter','an unsupported classification state is rejected');
select throws_ok($$select public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,'no_such_option',null,null,null,null,'occurred_at','desc',50,0,null)$$,'22023','invalid_filter','an unknown classification key is rejected');
select throws_ok($$select public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',repeat('x',250),null,null,null,null,null,'occurred_at','desc',50,0,null)$$,'22023','invalid_query','an overlong search query is rejected');
select throws_ok($$select public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,null,null,null,null,null,'occurred_at','desc',50,0,'banana')$$,'22023','invalid_filter','an unsupported exclusion state is rejected');
select throws_ok($$select public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,null,null,null,null,null,'not_a_sort','desc',50,0,null)$$,'22023','invalid_query','an unsupported sort is rejected');
select throws_ok($$select public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,null,null,null,null,null,'occurred_at','desc',0,0,null)$$,'22023','invalid_query','a zero page size is rejected');
-- The eleven-argument compatibility wrapper keeps its own contract.
select is((public.list_acquisition_lines('63000000-1000-4000-8000-000000000001',null,null,null,null,null,null,'occurred_at','desc',2,0)->>'total')::int,5,'the legacy wrapper reports the full total too');

reset role;
commit;

-- ================================== GATE 4 — GENUINE CONCURRENCY ===========
-- Overlapping sessions only: both calls are dispatched with dblink_send_query
-- before either result is collected, so the two backends are in flight
-- together and must be serialized by the governed advisory and row locks.
create function pg_temp.await_all(p_conns text[], p_seconds numeric default 30)
returns void language plpgsql as $$
declare started timestamptz:=clock_timestamp(); c text; busy boolean;
begin loop busy:=false; foreach c in array p_conns loop busy:=busy or dblink_is_busy(c)=1; end loop;
 exit when not busy; if clock_timestamp()-started>make_interval(secs=>p_seconds) then raise exception 'S1.5 exclusion concurrency deadline' using errcode='55P03'; end if;
 perform pg_sleep(.02); end loop; end $$;
create temporary table s15_conn(dsn text);
insert into s15_conn values(case when current_setting('is_superuser')='on' then 'dbname='||current_database()
 else format('host=%s port=%s dbname=%s user=postgres password=postgres',coalesce(host(inet_server_addr()),'127.0.0.1'),coalesce(inet_server_port()::text,current_setting('port')),current_database()) end);
create function pg_temp.auth_sql(p_call text) returns text language sql as $$
 select format($q$with auth as materialized (select set_config('request.jwt.claims',%L,false)) select (%s)::text from auth$q$,
 json_build_object('sub','63000000-0000-4000-8000-000000000001','role','authenticated')::text,p_call)
$$;
create function pg_temp.race(p_name text,p_left text,p_right text) returns text[] language plpgsql as $$
declare cs text[]:=array[p_name||'_1',p_name||'_2']; a text; b text;
begin
 perform dblink_connect(cs[1],(select dsn from s15_conn)); perform dblink_connect(cs[2],(select dsn from s15_conn));
 perform dblink_send_query(cs[1],pg_temp.auth_sql(p_left)); perform dblink_send_query(cs[2],pg_temp.auth_sql(p_right)); perform pg_temp.await_all(cs);
 select result into a from dblink_get_result(cs[1]) t(result text); select result into b from dblink_get_result(cs[2]) t(result text);
 perform dblink_disconnect(cs[1]); perform dblink_disconnect(cs[2]); return array[a,b];
exception when others then begin perform dblink_disconnect(cs[1]); exception when others then null; end; begin perform dblink_disconnect(cs[2]); exception when others then null; end; raise;
end $$;
-- Catches the loser's error so the race itself does not abort; the SQLSTATE is
-- returned as evidence that the refusal was bounded and named.
create function public.s15_try(p_sql text) returns text language plpgsql as $$
declare r text; begin execute p_sql into r; return coalesce(r,'null');
exception when others then return 'ERR:'||sqlstate; end $$;
create temporary table s15_race(name text primary key, result text[]);
select set_config('request.jwt.claims',json_build_object('sub','63000000-0000-4000-8000-000000000001','role','authenticated')::text,false);

-- SCENARIO A — two exclusions of one included line under DIFFERENT keys.
insert into s15_race select 'exclude_diff_keys', pg_temp.race('s15_excl_a',
 $$public.s15_try($x$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A2','concurrent exclusion A','s15-conc-excl-a')$x$)$$,
 $$public.s15_try($x$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A2','concurrent exclusion B','s15-conc-excl-b')$x$)$$);
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000002'),1,'two concurrent exclusions under different keys apply exactly one decision');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000002' and superseded_at is null),1,'exactly one current decision survives');
select is((select count(*)::int from unnest((select result from s15_race where name='exclude_diff_keys')) r where r='ERR:23505'),1,'the losing exclusion is refused with a bounded already_excluded conflict');
select is((select count(*)::int from public.audit_events where event_type='acquisition_line_excluded' and detail->>'acquisition_line_public_id'='LINE-63-A2'),1,'exactly one applied exclusion audit event exists');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000002' and superseded_at is not null and superseded_by_exclusion_id is null),0,'no partially superseded row was left behind');

-- SCENARIO B — two IDENTICAL exclusions under the SAME key.
insert into s15_race select 'exclude_same_key', pg_temp.race('s15_excl_b',
 $$public.s15_try($x$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A3','identical concurrent exclusion','s15-conc-excl-same')$x$)$$,
 $$public.s15_try($x$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A3','identical concurrent exclusion','s15-conc-excl-same')$x$)$$);
select is((select count(*)::int from public.acquisition_line_exclusions where idempotency_key='s15-conc-excl-same'),1,'two identical concurrent exclusions record one semantic decision');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000003' and superseded_at is null),1,'the identical race leaves exactly one current decision');
select is((select count(*)::int from public.audit_events where event_type='acquisition_line_excluded' and detail->>'acquisition_line_public_id'='LINE-63-A3'),1,'the identical race emits exactly one audit event');
select is((select count(*)::int from unnest((select result from s15_race where name='exclude_same_key')) r where r like 'ERR:%'),0,'an identical concurrent replay is not an error for either caller');

-- SCENARIO C — competing exclude/restore decisions on one line.
insert into s15_race select 'exclude_vs_restore', pg_temp.race('s15_excl_c',
 $$public.s15_try($x$select public.exclude_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A4','restore race: exclude','s15-conc-mix-excl')$x$)$$,
 $$public.s15_try($x$select public.restore_acquisition_line_by_source('63000000-1000-4000-8000-000000000001','SRC-63-A','LINE-63-A4','restore race: restore','s15-conc-mix-rest')$x$)$$);
-- The winner is genuinely order-dependent, so the INVARIANTS are asserted
-- rather than a predetermined outcome.
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000004' and superseded_at is null),1,'the mixed race leaves exactly one current decision');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000004' and superseded_at is not null and superseded_by_exclusion_id is null),0,'the mixed race left no partial superseded row');
select is((select count(*)::int from public.acquisition_line_exclusions e where e.acquisition_line_item_id='63000000-5000-4000-8000-000000000004' and e.superseded_by_exclusion_id is not null and not exists(select 1 from public.acquisition_line_exclusions s where s.id=e.superseded_by_exclusion_id)),0,'every successor link resolves to a real decision');
select is((select count(*)::int from public.acquisition_line_exclusions e where e.acquisition_line_item_id='63000000-5000-4000-8000-000000000004' and e.supersedes_exclusion_id is not null and not exists(select 1 from public.acquisition_line_exclusions p where p.id=e.supersedes_exclusion_id)),0,'every predecessor link resolves to a real decision');
select is((select count(*)::int from public.audit_events a where a.detail->>'acquisition_line_public_id'='LINE-63-A4' and a.event_type in ('acquisition_line_excluded','acquisition_line_restored')),(select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000004'),'each applied decision emitted exactly one audit event, with no duplicates');
select ok((select count(*) from unnest((select result from s15_race where name='exclude_vs_restore')) r where r like 'ERR:%')<=1,'at most one side of the mixed race was refused');
select is((select count(*)::int from public.acquisition_line_exclusions where acquisition_line_item_id='63000000-5000-4000-8000-000000000004' and superseded_by_exclusion_id=id),0,'no decision supersedes itself');

drop function public.s15_try(text);
select * from finish();
