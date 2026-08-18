begin;
create extension if not exists pgtap;
select plan(76);

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
select is((select count(distinct adjudicated_at)::int from public.reconciliation_finding_adjudications where reconciliation_finding_id=(select id from public.reconciliation_findings where public_id=(select v from recon_ids where k='target'))),1,'same-transaction adjudications share the transaction-stable now timestamp');
select is((select array_agg(adjudication_ordinal order by adjudication_ordinal) from public.reconciliation_finding_adjudications where reconciliation_finding_id=(select id from public.reconciliation_findings where public_id=(select v from recon_ids where k='target'))),array[1::bigint,2::bigint],'same-transaction adjudications receive authoritative increasing ordinals');
select is((public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='target'),'accepted','owner accepted financial evidence','adj-target-0002')->>'ordinal'),'2','replay returns the original ordinal');
select is((select count(*)::int from public.reconciliation_finding_adjudications where reconciliation_finding_id=(select id from public.reconciliation_findings where public_id=(select v from recon_ids where k='target'))),2,'replay creates neither a second event nor ordinal');
select is((select materiality from public.reconciliation_findings where public_id=(select v from recon_ids where k='target')),'financial'::public.reconciliation_materiality,'new adjudication does not rewrite finding');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),true,'accepted blockers leave cosmetic and none nonblocking');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',null,'inventory')),true,'domain gate deterministically selects latest run');
select is((public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='source'),'deferred','owner reopened source review','adj-source-0002')->>'ordinal'),'2','accepted then deferred in the same transaction advances the ordinal');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),false,'later same-transaction deferred adjudication is deterministically current and blocking');
select is((public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='source'),'accepted','owner completed reopened source review','adj-source-0003')->>'ordinal'),'3','deferred then accepted in the same transaction advances the ordinal');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),true,'later same-transaction accepted adjudication is deterministically current and nonblocking');
select is((public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='target'),'corrected','owner corrected financial evidence','adj-target-0003')->>'state'),'corrected','corrected adjudication is accepted');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),true,'corrected material or financial findings are nonblocking');
select is((public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='target'),'rejected','owner rejected financial discrepancy','adj-target-0004')->>'state'),'rejected','rejected adjudication is accepted');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='run'),null)),true,'rejected material or financial findings are nonblocking');
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

-- A deliberately inverted UUID pair proves UUID order is not chronology.
select pg_temp.as_admin();
insert into public.reconciliation_finding_adjudications(id,workspace_id,public_id,reconciliation_finding_id,state,note,adjudicated_by,adjudicated_at,idempotency_key,request_fingerprint,actor_process,adjudication_ordinal)
select 'ffffffff-ffff-4fff-8fff-ffffffffffff','68000000-1000-4000-8000-000000000101','RV-RECONA-UUIDHIGH',id,'deferred','earlier high UUID','68000000-0000-4000-8000-000000000101',now(),'uuid-order-high',repeat('a',64),'reconciliation.test',1
from public.reconciliation_findings where public_id=(select v from recon_ids where k='difference');
insert into public.reconciliation_finding_adjudications(id,workspace_id,public_id,reconciliation_finding_id,state,note,adjudicated_by,adjudicated_at,idempotency_key,request_fingerprint,actor_process,adjudication_ordinal)
select '00000000-0000-4000-8000-000000000001','68000000-1000-4000-8000-000000000101','RV-RECONA-UUIDLOW1',id,'accepted','later low UUID','68000000-0000-4000-8000-000000000101',now(),'uuid-order-low1',repeat('b',64),'reconciliation.test',2
from public.reconciliation_findings where public_id=(select v from recon_ids where k='difference');
select is((select state from public.reconciliation_finding_adjudications where reconciliation_finding_id=(select id from public.reconciliation_findings where public_id=(select v from recon_ids where k='difference')) order by adjudication_ordinal desc limit 1),'accepted'::public.reconciliation_adjudication_state,'current adjudication follows ordinal despite inverse UUID order');
select is((select count(distinct adjudication_ordinal)::int from public.reconciliation_finding_adjudications where reconciliation_finding_id=(select id from public.reconciliation_findings where public_id=(select v from recon_ids where k='difference'))),2,'a finding cannot claim a duplicate authoritative ordinal');

-- Simulate the explicit representation produced when legacy timestamps tie.
select pg_temp.as_user('68000000-0000-4000-8000-000000000101');
insert into recon_ids values('ambiguous-run',public.begin_reconciliation_run('68000000-1000-4000-8000-000000000101','ambiguous','legacy-export',null,'governed inventory','legacy_id','1.0.0','reconciliation.test','recon-run-amb01')->>'runPublicId');
insert into recon_ids values('ambiguous-finding',public.record_reconciliation_finding('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='ambiguous-run'),'legacy-1','source_only','[]','material','{}','reconciliation.test')->>'findingPublicId');
select public.complete_reconciliation_run('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='ambiguous-run'),'{}');
select pg_temp.as_admin();
insert into public.reconciliation_finding_adjudications(workspace_id,public_id,reconciliation_finding_id,state,note,adjudicated_by,adjudicated_at,idempotency_key,request_fingerprint,actor_process,ordering_ambiguity)
select '68000000-1000-4000-8000-000000000101','RV-RECONA-LEGACY01',id,'deferred','legacy first','68000000-0000-4000-8000-000000000101','2026-08-15 00:00:00+00','legacy-tie-0001',repeat('c',64),'reconciliation.test','legacy_timestamp_tie'
from public.reconciliation_findings where public_id=(select v from recon_ids where k='ambiguous-finding');
insert into public.reconciliation_finding_adjudications(workspace_id,public_id,reconciliation_finding_id,state,note,adjudicated_by,adjudicated_at,idempotency_key,request_fingerprint,actor_process,ordering_ambiguity)
select '68000000-1000-4000-8000-000000000101','RV-RECONA-LEGACY02',id,'accepted','legacy second','68000000-0000-4000-8000-000000000101','2026-08-15 00:00:00+00','legacy-tie-0002',repeat('d',64),'reconciliation.test','legacy_timestamp_tie'
from public.reconciliation_findings where public_id=(select v from recon_ids where k='ambiguous-finding');
select pg_temp.as_user('68000000-0000-4000-8000-000000000101');
select is((select eligible from public.reconciliation_cutover_eligibility('68000000-1000-4000-8000-000000000101',(select v from recon_ids where k='ambiguous-run'),null)),false,'indistinguishable legacy history fails closed instead of choosing by UUID');
select is((select count(*)::int from public.reconciliation_finding_adjudications where ordering_ambiguity='legacy_timestamp_tie' and reconciliation_finding_id=(select id from public.reconciliation_findings where public_id=(select v from recon_ids where k='ambiguous-finding'))),2,'legacy timestamp ties are represented explicitly');
select throws_ok(format($q$select public.adjudicate_reconciliation_finding('68000000-1000-4000-8000-000000000101',%L,'accepted','cannot extend ambiguous chronology','legacy-tie-0003')$q$,(select v from recon_ids where k='ambiguous-finding')),'23514','reconciliation_adjudication_history_ambiguous','ambiguous legacy history refuses invented continuation');

-- Genuine overlapping sessions: the first event retains the finding lock until
-- commit, so the second event cannot obtain an ordinal prematurely.
select pg_temp.as_admin();
create extension if not exists dblink;
create temporary table recon_concurrency(k text primary key,v text);
insert into recon_concurrency values
 ('user_id',gen_random_uuid()::text),('workspace_id',gen_random_uuid()::text),
 ('run_id',gen_random_uuid()::text),('finding_id',gen_random_uuid()::text);
insert into recon_concurrency values
 ('run_public_id','RV-RECON-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 ('finding_public_id','RV-RECONF-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)));
select dblink_connect('recon_ord_1','dbname='||current_database());
select dblink_connect('recon_ord_2','dbname='||current_database());
select dblink_exec('recon_ord_1',format($q$
 insert into auth.users(id,email) values(%L,%L);
 insert into public.workspaces(id,name,created_by) values(%L,%L,%L);
 insert into public.reconciliation_runs(id,workspace_id,public_id,domain,source_label,target_scope,comparison_key,state,completed_at,l1_result,tool_version,run_by,actor_process,idempotency_key,request_fingerprint)
 values(%L,%L,%L,'concurrency','source','target','key','completed',now(),'{}','1',%L,'reconciliation.test','concurrency-run-key',repeat('e',64));
 insert into public.reconciliation_findings(id,workspace_id,public_id,reconciliation_run_id,comparison_key_value,verdict,materiality,evidence,recorded_by,actor_process)
 values(%L,%L,%L,%L,'subject','source_only','material','{}',%L,'reconciliation.test')
 $q$,(select v from recon_concurrency where k='user_id'),
 'recon-concurrency-'||substr((select v from recon_concurrency where k='user_id'),1,8)||'@example.test',
 (select v from recon_concurrency where k='workspace_id'),'Recon ordinal concurrency',(select v from recon_concurrency where k='user_id'),
 (select v from recon_concurrency where k='run_id'),(select v from recon_concurrency where k='workspace_id'),(select v from recon_concurrency where k='run_public_id'),(select v from recon_concurrency where k='user_id'),
 (select v from recon_concurrency where k='finding_id'),(select v from recon_concurrency where k='workspace_id'),(select v from recon_concurrency where k='finding_public_id'),(select v from recon_concurrency where k='run_id'),(select v from recon_concurrency where k='user_id')));
select dblink_exec(c,'begin') from unnest(array['recon_ord_1','recon_ord_2']) c;
select dblink_exec(v_conn,format('set request.jwt.claims = %L',json_build_object('sub',(select v from recon_concurrency where k='user_id'),'role','authenticated')::text)) from unnest(array['recon_ord_1','recon_ord_2']) v_conn;
select dblink_exec(c,'set role authenticated') from unnest(array['recon_ord_1','recon_ord_2']) c;
select dblink_send_query('recon_ord_1',format($q$select (public.adjudicate_reconciliation_finding(%L,%L,'deferred','concurrent first','concurrent-adj-0001')->>'ordinal')::bigint$q$,(select v from recon_concurrency where k='workspace_id'),(select v from recon_concurrency where k='finding_public_id')));
select pg_sleep(0.1);
insert into recon_concurrency values('ordinal_1',(select ordinal::text from dblink_get_result('recon_ord_1') t(ordinal bigint)));
select ordinal from dblink_get_result('recon_ord_1') t(ordinal bigint);
select dblink_send_query('recon_ord_2',format($q$select (public.adjudicate_reconciliation_finding(%L,%L,'accepted','concurrent second','concurrent-adj-0002')->>'ordinal')::bigint$q$,(select v from recon_concurrency where k='workspace_id'),(select v from recon_concurrency where k='finding_public_id')));
select pg_sleep(0.1);
select is(dblink_is_busy('recon_ord_2'),1,'concurrent second adjudication waits on the canonical finding lock');
select dblink_exec('recon_ord_1','commit');
insert into recon_concurrency values('ordinal_2',(select ordinal::text from dblink_get_result('recon_ord_2') t(ordinal bigint)));
select ordinal from dblink_get_result('recon_ord_2') t(ordinal bigint);
select dblink_exec('recon_ord_2','commit');
select is((select array_agg(v::bigint order by v::bigint) from recon_concurrency where k in ('ordinal_1','ordinal_2')),array[1::bigint,2::bigint],'concurrent adjudications obtain distinct serial ordinals');
select is((select count(distinct adjudication_ordinal)::int from public.reconciliation_finding_adjudications where reconciliation_finding_id=(select v::uuid from recon_concurrency where k='finding_id')),2,'the authoritative uniqueness constraint preserves one coherent concurrent order');
select dblink_disconnect('recon_ord_1');
select dblink_disconnect('recon_ord_2');

select * from finish();
rollback;
