begin;
create extension if not exists pgtap;
select plan(56);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
end$$;
create function pg_temp.as_anon() returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims','{}',true); execute 'set local role anon';
end$$;
create function pg_temp.as_admin() returns void language plpgsql as $$begin reset role; end$$;

insert into auth.users(id,email) values
 ('68000000-0000-4000-8000-000000000101','recon-owner@example.test'),
 ('68000000-0000-4000-8000-000000000102','recon-operator@example.test'),
 ('68000000-0000-4000-8000-000000000103','recon-viewer@example.test'),
 ('68000000-0000-4000-8000-000000000104','recon-foreign@example.test');
insert into public.workspaces(id,name,created_by) values
 ('68000000-1000-4000-8000-000000000101','Recon A','68000000-0000-4000-8000-000000000101'),
 ('68000000-1000-4000-8000-000000000102','Recon B','68000000-0000-4000-8000-000000000104');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('68000000-1000-4000-8000-000000000101','68000000-0000-4000-8000-000000000102','operator'),
 ('68000000-1000-4000-8000-000000000101','68000000-0000-4000-8000-000000000103','viewer');

select has_table('public','reconciliation_runs','run schema exists');
select has_table('public','reconciliation_findings','finding schema exists');
select has_table('public','reconciliation_finding_adjudications','adjudication schema exists');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.reconciliation_runs'::regclass,'public.reconciliation_findings'::regclass,'public.reconciliation_finding_adjudications'::regclass)),'RLS enabled on every ledger table');
select is((select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name like 'reconciliation%' and grantee='authenticated' and privilege_type<>'SELECT'),0,'authenticated direct DML denied');
select is((select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name like 'reconciliation%' and grantee in ('anon','PUBLIC')),0,'anon receives no ledger table privilege');
select ok(not has_function_privilege('anon','public.begin_reconciliation_run(uuid,text,text,text,text,text,text,text,text)','execute'),'anon cannot begin a run');

select pg_temp.as_user('68000000-0000-4000-8000-000000000101');
create temporary table recon_ids(k text primary key,v text);
insert into recon_ids values('run',(public.begin_reconciliation_run('68000000-1000-4000-8000-000000000101','inventory','fixed-export.json',repeat('a',64),'governed inventory','inventory_lot_id','1.0.0','reconciliation.test','recon-run-0001')->>'runPublicId'));
select ok((select v like 'RV-RECON-%' from recon_ids where k='run'),'run has governed public ID');
select is((public.begin_reconciliation_run('68000000-1000-4000-8000-000000000101',' inventory ',' fixed-export.json ',('  '||repeat('a',64)||'  '),' governed inventory ',' inventory_lot_id ',' 1.0.0 ',' reconciliation.test ',' recon-run-0001 ')->>'replayed'),'true','normalized begin replay is idempotent');
select throws_ok($$select public.begin_reconciliation_run('68000000-1000-4000-8000-000000000101','inventory','changed.json',repeat('a',64),'governed inventory','inventory_lot_id','1.0.0','reconciliation.test','recon-run-0001')$$,'23505','idempotency_conflict','changed begin replay conflicts');
select throws_ok($$select public.begin_reconciliation_run('68000000-1000-4000-8000-000000000101','inventory','bad','ABC','scope','key','1','reconciliation.test','recon-run-bad1')$$,'23514',null,'malformed SHA fails closed');
insert into recon_ids values('collision-run',(public.begin_reconciliation_run('68000000-1000-4000-8000-000000000101','collision','left|right',null,'scope','key','1','reconciliation.test','recon-collision-01')->>'runPublicId'));
select throws_ok($$select public.begin_reconciliation_run('68000000-1000-4000-8000-000000000101','collision','left',null,'right|scope','key','1','reconciliation.test','recon-collision-01')$$,'23505','idempotency_conflict','structured fingerprint distinguishes delimiter-collision payloads');

insert into recon_ids
select v,public.record_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),v,
 case v when 'identical' then 'matched_identical'::public.reconciliation_verdict when 'difference' then 'matched_with_differences' when 'source' then 'source_only' else 'target_only' end,
 case when v='difference' then '[{"field":"title","source":"A","target":"B"}]'::jsonb else '[]'::jsonb end,
 case v when 'identical' then 'none'::public.reconciliation_materiality when 'difference' then 'cosmetic' when 'source' then 'material' else 'financial' end,
 jsonb_build_object('unionMember',true),'reconciliation.test')->>'findingPublicId'
from unnest(array['identical','difference','source','target']) v;
select is((select count(*)::int from public.reconciliation_findings),4,'all four union-key verdict rows are represented');
select is((select count(distinct verdict)::int from public.reconciliation_findings),4,'all four verdicts accepted');
select is((select count(distinct materiality)::int from public.reconciliation_findings),4,'all four materialities accepted');
select is((select field_differences from public.reconciliation_findings where comparison_key_value='difference'),'[{"field":"title","source":"A","target":"B"}]'::jsonb,'field differences preserved exactly');
select is((public.record_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),'source','source_only','[]','material','{"unionMember":true}','reconciliation.test')->>'replayed'),'true','identical finding replay is idempotent');
select throws_ok(format($q$select public.record_reconciliation_finding('68000000-1000-4000-8000-000000000101',%L,'source','target_only','[]','material','{}','reconciliation.test')$q$,(select v from recon_ids where k='run')),'23505','finding_conflict','duplicate run and key verdict refused');
select throws_ok(format($q$select public.record_reconciliation_finding('68000000-1000-4000-8000-000000000101',%L,'bad-json','source_only','{}','material','{}','reconciliation.test')$q$,(select v from recon_ids where k='run')),'22023','invalid_json_shape','malformed differences JSON fails closed');
select throws_ok(format($q$select public.record_reconciliation_finding('68000000-1000-4000-8000-000000000101',%L,'bad-identical','matched_identical','[{"field":"title","source":"A","target":"B"}]','material','{}','reconciliation.test')$q$,(select v from recon_ids where k='run')),'23514',null,'matched identical rejects nonempty differences');
select throws_ok(format($q$select public.record_reconciliation_finding('68000000-1000-4000-8000-000000000101',%L,'bad-difference','matched_with_differences','[]','material','{}','reconciliation.test')$q$,(select v from recon_ids where k='run')),'23514',null,'matched with differences rejects empty differences');
select is((select count(distinct public_id)::int from public.reconciliation_findings),4,'finding public IDs are unique');

select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),false,'running run fails closed');
select ok((select not eligible and reason='run_not_found' and run_public_id='RV-RECON-NOTFOUND' from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101','RV-RECON-NOTFOUND',null)),'nonexistent run returns explicit fail-closed row');
select ok((select not eligible and reason='run_not_found' and domain='missing-domain' from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',null,'missing-domain')),'nonexistent domain returns explicit fail-closed row');
select is((public.complete_reconciliation_run('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),'{"source":{"rows":4},"target":{"rows":4}}')->>'state'),'completed','run completes with L1 object');
select ok((select completed_at is not null from public.reconciliation_runs where public_id=(select v from recon_ids where k='run')),'completed run has completion timestamp');
select throws_ok(format($q$select public.record_reconciliation_finding('68000000-1000-4000-8000-000000000101',%L,'late','source_only','[]','material','{}','reconciliation.test')$q$,(select v from recon_ids where k='run')),'23514','reconciliation_run_not_running','completed run rejects findings');
select throws_ok(format($q$select public.fail_reconciliation_run('68000000-1000-4000-8000-000000000101',%L,'{}','late failure')$q$,(select v from recon_ids where k='run')),'23514','invalid_reconciliation_run_transition','terminal transition fails closed');
select throws_ok($$update public.reconciliation_runs set source_label='rewritten'$$,'42501',null,'run evidence cannot be directly rewritten');
select throws_ok($$delete from public.reconciliation_findings$$,'42501',null,'finding evidence cannot be silently deleted');

select is((select blocking_finding_count from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),2::bigint,'open material and financial findings block');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),false,'material open finding blocks eligibility');
select is((public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='source'),'accepted','owner accepted source evidence','adj-source-0001')->>'state'),'accepted','material finding can be accepted');
select is((public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='source'),'accepted','  owner accepted source evidence  ',' adj-source-0001 ',' reconciliation.review ')->>'replayed'),'true','normalized adjudication replay is idempotent');
select is((select blocking_finding_count from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),1::bigint,'accepted material no longer blocks while financial remains');
select is((public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='target'),'deferred','owner deferred financial review','adj-target-0001')->>'state'),'deferred','financial finding can be deferred with note');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),false,'deferred financial remains blocking');
select is((public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='target'),'accepted','owner accepted financial evidence','adj-target-0002')->>'state'),'accepted','later adjudication supersedes by history');
select is((select count(*)::int from public.reconciliation_finding_adjudications where reconciliation_finding_id=(select id from public.reconciliation_findings where public_id=(select v from recon_ids where k='target'))),2,'adjudication is append-only');
select is((select materiality from public.reconciliation_findings where public_id=(select v from recon_ids where k='target')),'financial'::public.reconciliation_materiality,'new adjudication does not rewrite finding');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),true,'accepted blockers leave cosmetic and none nonblocking');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',null,'inventory')),true,'domain gate deterministically selects latest run');
select throws_ok(format($q$select public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',%L,'rejected',null,'adj-note-bad1')$q$,(select v from recon_ids where k='difference')),'22023','invalid_request','non-open adjudication requires note');
select throws_ok($$update public.reconciliation_finding_adjudications set note='rewrite'$$,'42501',null,'adjudication cannot be rewritten');

select pg_temp.as_user('68000000-0000-4000-8000-000000000104');
select is((select count(*)::int from public.reconciliation_runs),0,'foreign workspace cannot read runs');
select is((select count(*)::int from public.reconciliation_findings),0,'foreign workspace cannot read findings');
select throws_ok(format($q$select public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',%L,'accepted','foreign attempt','adj-foreign-01')$q$,(select v from recon_ids where k='source')),'42501',null,'foreign workspace cannot adjudicate');
select pg_temp.as_anon();
select throws_ok($$select * from public.reconciliation_runs$$,'42501',null,'anon read denied');
select pg_temp.as_admin();
select throws_ok($$insert into public.reconciliation_findings(workspace_id,public_id,reconciliation_run_id,comparison_key_value,verdict,field_differences,materiality,recorded_by,actor_process) select '68000000-1000-4000-8000-000000000102','RV-RECONF-CROSS01',id,'cross','source_only','[]','material','68000000-0000-4000-8000-000000000104','test.cross' from public.reconciliation_runs limit 1$$,'23503',null,'same-workspace relationships fail closed');
select throws_ok($$truncate table public.reconciliation_runs cascade$$,'42501',null,'privileged truncate of runs is forbidden');
select throws_ok($$truncate table public.reconciliation_findings cascade$$,'42501',null,'privileged truncate of findings is forbidden');
select throws_ok($$truncate table public.reconciliation_finding_adjudications$$,'42501',null,'privileged truncate of adjudications is forbidden');

-- Separate failed lifecycle proof.
select pg_temp.as_user('68000000-0000-4000-8000-000000000101');
insert into recon_ids values('failed-run',public.begin_reconciliation_run('68000000-1000-4000-8000-000000000101','cost','cost-export',null,'governed cost','allocation_id','1.0.0','reconciliation.test','recon-run-fail1')->>'runPublicId');
select is((public.fail_reconciliation_run('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='failed-run'),'{"partial":true}','tool stopped')->>'state'),'failed','run can fail with completion evidence');
select ok((select completed_at is not null and failure_note='tool stopped' from public.reconciliation_runs where public_id=(select v from recon_ids where k='failed-run')),'failed run has timestamp and note');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='failed-run'),null)),false,'failed run is never eligible');

select * from finish();
rollback;
