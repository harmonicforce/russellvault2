-- Phase 3 provenance — read authorization and role permissions.
--
-- Under the SELECT-only grant model, this file's job is to prove READ
-- authorization and the denial of every direct write, per role:
--   anon        — sees nothing, can do nothing;
--   non-member  — sees nothing, can do nothing;
--   viewer      — reads the full review surface, writes nothing and can invoke
--                 no governed review action;
--   operator    — reads the same, and may invoke the review RPCs;
--   owner       — as operator, plus the owner-only registry RPC.
-- Cross-workspace isolation is asserted for reads and for every RPC.
--
-- The staged import workflow itself is covered in 10_provenance_workflow.sql.
begin;
create extension if not exists pgtap;
select no_plan();

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Fixtures (written as the owning role, before any impersonation) --------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'vera@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'zoe@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'mallory@example.test');

insert into public.workspaces (id, name, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Workspace A',
   '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Workspace B',
   '44444444-4444-4444-4444-444444444444');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'operator'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

insert into public.source_systems (id, workspace_id, public_id, kind, instance_label, created_by)
values
  ('a5000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'REPO_FIXTURE', 'repository_fixture', 'repo seed A',
   '11111111-1111-1111-1111-111111111111'),
  ('b5000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'REPO_FIXTURE', 'repository_fixture', 'repo seed B',
   '44444444-4444-4444-4444-444444444444');

insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label,
  file_sha256, content_sha256, parser_version, mapping_version,
  idempotency_key, mode, actor_user_id, actor_process, source_row_count
) values
  ('a6000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'JOB-A1', 'a5000000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0', 'idem-a-000000001', 'commit',
   '11111111-1111-1111-1111-111111111111', 'provenance.import', 1),
  ('b6000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'JOB-B1', 'b5000000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('b', 64), repeat('b', 64), '1.0.0', '1.0.0', 'idem-b-000000001', 'commit',
   '44444444-4444-4444-4444-444444444444', 'provenance.import', 1);

insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, raw_payload,
  normalized_hash, parse_status, parser_output, parser_version, mapping_version,
  created_by_process
) values
  ('a7000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a6000000-0000-4000-8000-000000000001', 0, '{"a":1}'::jsonb, repeat('1', 64),
   'parsed', '{"a":1}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  ('b7000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b6000000-0000-4000-8000-000000000001', 0, '{"b":1}'::jsonb, repeat('2', 64),
   'parsed', '{"b":1}'::jsonb, '1.0.0', '1.0.0', 'provenance.import');

insert into public.source_crosswalks (
  id, workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
  match_method, created_by_process
) values
  ('ac000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000001', 'acquisition_candidate', 'KEY-A',
   'similarity', 'provenance.import'),
  ('bc000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b7000000-0000-4000-8000-000000000001', 'acquisition_candidate', 'KEY-B',
   'similarity', 'provenance.import');

insert into public.data_quality_issues (
  id, workspace_id, import_job_id, source_record_id, issue_type, message,
  created_by_process
) values
  ('ad000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
   'conflict', 'conflicting totals', 'provenance.import'),
  ('bd000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b6000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
   'conflict', 'workspace B issue', 'provenance.import');

insert into public.external_identifiers (
  workspace_id, source_system_id, scope, identifier_type, identifier_value,
  source_record_id, created_by_process
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5000000-0000-4000-8000-000000000001',
   'whatnot.order', 'order_id', 'A-1', 'a7000000-0000-4000-8000-000000000001',
   'provenance.import');

insert into public.audit_events (
  workspace_id, event_type, subject_table, subject_id, import_job_id,
  actor_user_id, actor_process
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'import_started', 'import_jobs',
   'a6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'provenance.import');

-- ANONYMOUS: nothing at all ------------------------------------------------------
select pg_temp.login_anon();

select throws_ok($$select count(*) from public.import_jobs$$, '42501', null,
  'anon cannot read import_jobs');
select throws_ok($$select count(*) from public.source_records$$, '42501', null,
  'anon cannot read source_records');
select throws_ok($$select count(*) from public.source_crosswalks$$, '42501', null,
  'anon cannot read source_crosswalks');
select throws_ok($$select count(*) from public.audit_events$$, '42501', null,
  'anon cannot read audit_events');
select throws_ok($$select count(*) from public.data_quality_issues$$, '42501', null,
  'anon cannot read data_quality_issues');
select throws_ok($$select count(*) from public.source_systems$$, '42501', null,
  'anon cannot read source_systems');
select throws_ok($$select count(*) from public.external_identifiers$$, '42501', null,
  'anon cannot read external_identifiers');
select throws_ok(
  $$select public.confirm_source_crosswalk('ac000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anon cannot execute confirm_source_crosswalk');
select throws_ok(
  $$select public.finalize_import_job('a6000000-0000-4000-8000-000000000001',
      'idem-a-000000001', 1, 1, 0)$$,
  '42501', null, 'anon cannot execute finalize_import_job');
select throws_ok(
  $$select public.register_source_system('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'X', 'manual', 'x')$$,
  '42501', null, 'anon cannot execute register_source_system');

select pg_temp.logout();

-- AUTHENTICATED NON-MEMBER: nothing at all ----------------------------------------
select pg_temp.login('55555555-5555-5555-5555-555555555555');

select is((select count(*)::int from public.import_jobs), 0,
  'a non-member sees no import jobs');
select is((select count(*)::int from public.source_records), 0,
  'a non-member sees no source records');
select is((select count(*)::int from public.source_crosswalks), 0,
  'a non-member sees no crosswalks');
select is((select count(*)::int from public.audit_events), 0,
  'a non-member sees no audit events');
select is((select count(*)::int from public.data_quality_issues), 0,
  'a non-member sees no data-quality issues');
select is((select count(*)::int from public.source_systems), 0,
  'a non-member sees no source systems');
select is((select count(*)::int from public.external_identifiers), 0,
  'a non-member sees no external identifiers');

select throws_ok(
  $$select public.confirm_source_crosswalk('ac000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a non-member cannot confirm a crosswalk');
select throws_ok(
  $$select public.resolve_data_quality_issue('ad000000-0000-4000-8000-000000000001',
      'resolved'::public.data_quality_status)$$,
  '42501', null, 'a non-member cannot resolve an issue');
select throws_ok(
  $$select public.finalize_import_job('a6000000-0000-4000-8000-000000000001',
      'idem-a-000000001', 1, 1, 0)$$,
  '42501', null, 'a non-member cannot finalize an import');

select pg_temp.logout();

-- VIEWER: reads everything, changes nothing ------------------------------------------
select pg_temp.login('33333333-3333-3333-3333-333333333333');

select is((select count(*)::int from public.import_jobs), 1,
  'a viewer reads import jobs in her workspace');
select is((select count(*)::int from public.source_records), 1,
  'a viewer reads source records in her workspace');
select is((select count(*)::int from public.source_crosswalks), 1,
  'a viewer reads crosswalks in her workspace');
select is((select count(*)::int from public.data_quality_issues), 1,
  'a viewer reads data-quality issues in her workspace');
select is((select count(*)::int from public.audit_events), 1,
  'a viewer reads audit history in her workspace');
select is((select count(*)::int from public.source_systems), 1,
  'a viewer reads the source-system registry in her workspace');
select is((select count(*)::int from public.external_identifiers), 1,
  'a viewer reads external identifiers in her workspace');

-- ...and can do nothing else.
select throws_ok(
  $$select public.confirm_source_crosswalk('ac000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a viewer cannot confirm a crosswalk');
select throws_ok(
  $$select public.reject_source_crosswalk('ac000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a viewer cannot reject a crosswalk');
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a viewer cannot supersede a crosswalk');
select throws_ok(
  $$select public.resolve_data_quality_issue('ad000000-0000-4000-8000-000000000001',
      'resolved'::public.data_quality_status)$$,
  '42501', null, 'a viewer cannot resolve an issue');
select throws_ok(
  $$select public.register_source_system('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'VSYS', 'manual', 'viewer try')$$,
  '42501', null, 'a viewer cannot register a source system');
select throws_ok(
  $$select public.finalize_import_job('a6000000-0000-4000-8000-000000000001',
      'idem-a-000000001', 1, 1, 0)$$,
  '42501', null, 'a viewer cannot finalize an import');

-- Direct writes are refused at the grant layer for a viewer too.
select throws_ok(
  $$update public.import_jobs set status = 'committed'$$,
  '42501', null, 'a viewer cannot update an import job directly');
select throws_ok(
  $$insert into public.source_records (
      workspace_id, import_job_id, source_row_index, raw_payload, normalized_hash,
      parse_status, parser_output, parser_version, mapping_version, created_by_process)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a6000000-0000-4000-8000-000000000001',
      50, '{}'::jsonb, repeat('3', 64), 'parsed', '{}'::jsonb, '1.0.0', '1.0.0', 'x')$$,
  '42501', null, 'a viewer cannot write a source record directly');

select pg_temp.logout();

-- OPERATOR: reads, plus the governed review actions -------------------------------------
select pg_temp.login('22222222-2222-2222-2222-222222222222');

select lives_ok(
  $$select public.confirm_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'reviewed by operator')$$,
  'an operator can confirm a candidate in her own workspace');

select is(
  (select review_state::text from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  'confirmed', 'the confirmed state was recorded');

select is(
  (select reviewed_by from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'confirmation is attributed to the acting reviewer');

select lives_ok(
  $$select public.resolve_data_quality_issue('ad000000-0000-4000-8000-000000000001',
      'resolved'::public.data_quality_status, 'ok')$$,
  'an operator can resolve an issue in her own workspace');

-- Registry administration remains owner-only.
select throws_ok(
  $$select public.register_source_system('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'OPSYS', 'manual', 'operator try')$$,
  '42501', null, 'an operator cannot register a source system (owner-only)');

-- Direct writes are refused for an operator too: the RPCs are the only path.
select throws_ok(
  $$update public.source_crosswalks set review_state = 'confirmed'$$,
  '42501', null, 'an operator cannot confirm a crosswalk by direct update');
select throws_ok(
  $$update public.data_quality_issues set status = 'resolved'$$,
  '42501', null, 'an operator cannot resolve an issue by direct update');
select throws_ok(
  $$insert into public.audit_events (
      workspace_id, event_type, subject_table, actor_user_id, actor_process)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'import_committed', 'import_jobs',
      '22222222-2222-2222-2222-222222222222', 'forged')$$,
  '42501', null, 'an operator cannot fabricate an audit event');
select throws_ok(
  $$delete from public.source_records$$,
  '42501', null, 'an operator cannot delete evidence');

-- CROSS-WORKSPACE ISOLATION -----------------------------------------------------------
select is(
  (select count(*)::int from public.import_jobs
   where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0, 'user A cannot read workspace B import jobs');
select is(
  (select count(*)::int from public.source_records
   where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0, 'user A cannot read workspace B source records');
select is(
  (select count(*)::int from public.source_crosswalks
   where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0, 'user A cannot read workspace B crosswalks');

select throws_ok(
  $$select public.confirm_source_crosswalk('bc000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'user A cannot confirm a workspace B crosswalk');
select throws_ok(
  $$select public.reject_source_crosswalk('bc000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'user A cannot reject a workspace B crosswalk');
select throws_ok(
  $$select public.resolve_data_quality_issue('bd000000-0000-4000-8000-000000000001',
      'resolved'::public.data_quality_status)$$,
  '42501', null, 'user A cannot resolve a workspace B issue');
select throws_ok(
  $$select public.finalize_import_job('b6000000-0000-4000-8000-000000000001',
      'idem-b-000000001', 1, 1, 0)$$,
  '42501', null, 'user A cannot finalize a workspace B import');

select pg_temp.logout();

-- OWNER: everything an operator can do, plus the registry ---------------------------------
select pg_temp.login('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$select public.register_source_system('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'EXCELCTL', 'excel_export', 'future control workbook export')$$,
  'an owner can register a source system');

select throws_ok(
  $$delete from public.source_systems where public_id = 'EXCELCTL'$$,
  '42501', null,
  'even an owner cannot delete a source system: registry rows are retained');

select pg_temp.logout();

-- Workspace B is untouched by everything above ----------------------------------------------
select is(
  (select review_state::text from public.source_crosswalks
   where id = 'bc000000-0000-4000-8000-000000000001'),
  'candidate', 'the workspace B crosswalk is still an unreviewed candidate');
select is(
  (select status::text from public.data_quality_issues
   where id = 'bd000000-0000-4000-8000-000000000001'),
  'open', 'the workspace B issue is still open');
select is(
  (select count(*)::int from public.import_jobs
   where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and status = 'committed'),
  0, 'no workspace B import was committed by workspace A activity');

select * from finish();
rollback;
