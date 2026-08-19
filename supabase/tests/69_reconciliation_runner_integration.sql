begin;
create extension if not exists pgtap;
select plan(8);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
end$$;

insert into auth.users(id,email) values ('69000000-0000-4000-8000-000000000101','runner-owner@example.test');
insert into public.workspaces(id,name,created_by) values ('69000000-1000-4000-8000-000000000101','Runner integration','69000000-0000-4000-8000-000000000101');
select pg_temp.as_user('69000000-0000-4000-8000-000000000101');

create temporary table runner_result(payload jsonb);
insert into runner_result values ($json${
  "tool":"russell-vault-reconciliation/1.0.0",
  "domain":"synthetic_inventory",
  "comparisonKey":"id",
  "sourceArtifact":{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
  "targetArtifact":{"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
  "l1":{"source":{"rowCount":2},"target":{"rowCount":2},"agreementIsReconciliationPass":false},
  "findings":[
    {"comparisonKeyValue":"a","verdict":"matched_identical","fieldDifferences":[],"materiality":"none"},
    {"comparisonKeyValue":"b","verdict":"matched_with_differences","fieldDifferences":[{"field":"amount","source":10,"target":11}],"materiality":"financial"},
    {"comparisonKeyValue":"c","verdict":"source_only","fieldDifferences":[],"materiality":"material"}
  ]
}$json$::jsonb);

create temporary table runner_ids(run_public_id text);
insert into runner_ids
select public.begin_reconciliation_run(
  '69000000-1000-4000-8000-000000000101', payload->>'domain', 'synthetic-source.json',
  payload#>>'{sourceArtifact,sha256}', 'synthetic-target.json', payload->>'comparisonKey', payload->>'tool',
  'reconciliation.runner.integration', 'synthetic-run-0001'
)->>'runPublicId' from runner_result;

select ok((select run_public_id like 'RV-RECON-%' from runner_ids),'synthetic runner output begins through governed function');

select public.record_reconciliation_finding(
  '69000000-1000-4000-8000-000000000101', (select run_public_id from runner_ids), finding->>'comparisonKeyValue',
  (finding->>'verdict')::public.reconciliation_verdict, finding->'fieldDifferences',
  (finding->>'materiality')::public.reconciliation_materiality,
  jsonb_build_object('sourceSha256',payload#>>'{sourceArtifact,sha256}','targetSha256',payload#>>'{targetArtifact,sha256}'),
  'reconciliation.runner.integration'
)
from runner_result cross join lateral jsonb_array_elements(payload->'findings') finding;

select is((select count(*)::int from public.reconciliation_findings),3,'one persisted finding exists per synthetic union key');
select is((select count(distinct comparison_key_value)::int from public.reconciliation_findings),3,'each union key is persisted exactly once');
select is((select verdict from public.reconciliation_findings where comparison_key_value='b'),'matched_with_differences'::public.reconciliation_verdict,'changed row verdict survives governed persistence');
select is((select field_differences from public.reconciliation_findings where comparison_key_value='b'),'[{"field":"amount","source":10,"target":11}]'::jsonb,'field-level evidence survives governed persistence');
select is((select evidence->>'targetSha256' from public.reconciliation_findings limit 1),repeat('b',64),'target artifact SHA survives governed persistence');
select is((public.complete_reconciliation_run('69000000-1000-4000-8000-000000000101',(select run_public_id from runner_ids),(select payload->'l1' from runner_result))->>'state'),'completed','synthetic run completes through governed function');
select ok((select l1_result->>'agreementIsReconciliationPass'='false' from public.reconciliation_runs),'L1 explicitly does not assert reconciliation pass');

select * from finish();
rollback;
