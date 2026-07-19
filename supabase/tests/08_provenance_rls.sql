-- Phase 3 provenance — row-level security and role permissions.
--
-- Proves: anonymous users get nothing; an authenticated non-member gets
-- nothing; viewers read but cannot commit, review, or resolve; operators do
-- ordinary preview/commit and candidate-review work in their own workspace
-- only; owners additionally administer the source-system registry; and user A
-- can neither read nor mutate workspace B.
begin;
create extension if not exists pgtap;
select no_plan();

-- Impersonation helpers ---------------------------------------------------------
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

-- Fixtures ------------------------------------------------------------------------
-- alice: owner of A. bob: operator in A. vera: viewer in A.
-- zoe: owner of B. mallory: authenticated but a member of nothing.
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
   '11111111-1111-1111-1111-111111111111', 'provenance.import', 5),
  ('b6000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'JOB-B1', 'b5000000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('b', 64), repeat('b', 64), '1.0.0', '1.0.0', 'idem-b-000000001', 'commit',
   '44444444-4444-4444-4444-444444444444', 'provenance.import', 5);

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
   'conflict', 'conflicting totals', 'provenance.import');

insert into public.audit_events (
  workspace_id, event_type, subject_table, subject_id, import_job_id,
  actor_user_id, actor_process
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'import_previewed', 'import_jobs',
   'a6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'provenance.import');

-- Anonymous users get nothing -------------------------------------------------------
select pg_temp.login_anon();

select throws_ok(
  $$select count(*) from public.import_jobs$$, '42501', null,
  'anon cannot read import_jobs');
select throws_ok(
  $$select count(*) from public.source_records$$, '42501', null,
  'anon cannot read source_records');
select throws_ok(
  $$select count(*) from public.source_crosswalks$$, '42501', null,
  'anon cannot read source_crosswalks');
select throws_ok(
  $$select count(*) from public.audit_events$$, '42501', null,
  'anon cannot read audit_events');
select throws_ok(
  $$select count(*) from public.data_quality_issues$$, '42501', null,
  'anon cannot read data_quality_issues');
select throws_ok(
  $$select count(*) from public.source_systems$$, '42501', null,
  'anon cannot read source_systems');
select throws_ok(
  $$select count(*) from public.external_identifiers$$, '42501', null,
  'anon cannot read external_identifiers');
select throws_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', 'idem-a-000000001')$$,
  '42501', null, 'anon cannot execute commit_import_job');

select pg_temp.logout();

-- An authenticated non-member gets nothing -------------------------------------------
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

select throws_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', 'idem-a-000000001')$$,
  '42501', null, 'a non-member cannot commit another workspace''s import');
select throws_ok(
  $$select public.confirm_source_crosswalk('ac000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a non-member cannot confirm another workspace''s crosswalk');

select pg_temp.logout();

-- Viewer: reads the review surface, changes nothing --------------------------------------
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

select throws_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', 'idem-a-000000001')$$,
  '42501', null, 'a viewer cannot commit an import');
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
  $$select public.resolve_data_quality_issue(
      'ad000000-0000-4000-8000-000000000001', 'resolved'::public.data_quality_status)$$,
  '42501', null, 'a viewer cannot resolve a data-quality issue');

-- A viewer's direct writes are refused by RLS as well.
select throws_ok(
  $$insert into public.import_jobs (
      workspace_id, public_id, source_system_id, source_label, file_sha256,
      content_sha256, parser_version, mapping_version, idempotency_key, mode,
      actor_user_id, actor_process, source_row_count
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JOB-V', 'a5000000-0000-4000-8000-000000000001',
      'x.json', repeat('c', 64), repeat('c', 64), '1.0.0', '1.0.0', 'idem-v-000000001',
      'preview', '33333333-3333-3333-3333-333333333333', 'provenance.preview', 1)$$,
  '42501', null, 'a viewer cannot create an import job directly');

select throws_ok(
  $$insert into public.source_records (
      workspace_id, import_job_id, source_row_index, raw_payload, normalized_hash,
      parse_status, parser_output, parser_version, mapping_version, created_by_process
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a6000000-0000-4000-8000-000000000001',
      50, '{}'::jsonb, repeat('3', 64), 'parsed', '{}'::jsonb, '1.0.0', '1.0.0',
      'provenance.import')$$,
  '42501', null, 'a viewer cannot write a source record');

select throws_ok(
  $$insert into public.source_crosswalks (
      workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
      match_method, created_by_process
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a7000000-0000-4000-8000-000000000001',
      'acquisition_candidate', 'KEY-V', 'manual', 'provenance.import')$$,
  '42501', null, 'a viewer cannot create a crosswalk candidate');

select pg_temp.logout();

-- Operator: ordinary preview/commit and candidate-review work in her workspace ------------
select pg_temp.login('22222222-2222-2222-2222-222222222222');

select lives_ok(
  $$insert into public.import_jobs (
      id, workspace_id, public_id, source_system_id, source_label, file_sha256,
      content_sha256, parser_version, mapping_version, idempotency_key, mode,
      actor_user_id, actor_process, source_row_count
    ) values (
      'a6000000-0000-4000-8000-0000000000e1',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JOB-OP', 'a5000000-0000-4000-8000-000000000001',
      'checks.json', repeat('e', 64), repeat('e', 64), '1.0.0', '1.0.0',
      'idem-op-00000001', 'preview', '22222222-2222-2222-2222-222222222222',
      'provenance.preview', 3)$$,
  'an operator can create a preview import job in her workspace');

select lives_ok(
  $$insert into public.source_records (
      workspace_id, import_job_id, source_row_index, raw_payload, normalized_hash,
      parse_status, parser_output, parser_version, mapping_version, created_by_process
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a6000000-0000-4000-8000-0000000000e1',
      0, '{"c":1}'::jsonb, repeat('4', 64), 'parsed', '{"c":1}'::jsonb, '1.0.0', '1.0.0',
      'provenance.import')$$,
  'an operator can write raw source records for her own job');

select lives_ok(
  $$select public.confirm_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'reviewed by operator')$$,
  'an operator can confirm a candidate in her own workspace');

select is(
  (select review_state::text from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  'confirmed',
  'the confirmed state was recorded');

select is(
  (select reviewed_by from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'confirmation is attributed to the acting reviewer, not the importer');

select lives_ok(
  $$select public.resolve_data_quality_issue(
      'ad000000-0000-4000-8000-000000000001', 'resolved'::public.data_quality_status, 'ok')$$,
  'an operator can resolve an issue in her own workspace');

-- Operator cannot administer the source-system registry: that is owner-only.
select throws_ok(
  $$insert into public.source_systems (
      workspace_id, public_id, kind, instance_label, created_by
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'OPSYS', 'manual', 'operator try',
      '22222222-2222-2222-2222-222222222222')$$,
  '42501', null, 'an operator cannot register a source system (owner-only)');

-- An operator's UPDATE is filtered out by the owner-only USING clause, so it
-- matches zero rows rather than raising. The guarantee is that the registry is
-- unchanged, which is what this asserts.
select lives_ok(
  $$update public.source_systems set instance_label = 'renamed'
    where id = 'a5000000-0000-4000-8000-000000000001'$$,
  'an operator''s registry update matches no rows instead of erroring');

select is(
  (select instance_label from public.source_systems
   where id = 'a5000000-0000-4000-8000-000000000001'),
  'repo seed A',
  'an operator cannot amend the source-system registry (owner-only)');

-- Workspace isolation: operator in A sees and touches nothing in B -----------------------------
select is(
  (select count(*)::int from public.import_jobs
   where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'user A cannot read workspace B import jobs');
select is(
  (select count(*)::int from public.source_records
   where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'user A cannot read workspace B source records');
select is(
  (select count(*)::int from public.source_crosswalks
   where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'user A cannot read workspace B crosswalks');

select throws_ok(
  $$select public.confirm_source_crosswalk('bc000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'user A cannot confirm a workspace B crosswalk');
select throws_ok(
  $$select public.commit_import_job('b6000000-0000-4000-8000-000000000001', 'idem-b-000000001')$$,
  '42501', null, 'user A cannot commit a workspace B import');

select is(
  (select count(*)::int from public.import_jobs
   where id = 'b6000000-0000-4000-8000-000000000001'),
  0,
  'a workspace B import job is invisible to a workspace A operator');

-- Writing into workspace B is refused outright.
select throws_ok(
  $$insert into public.source_records (
      workspace_id, import_job_id, source_row_index, raw_payload, normalized_hash,
      parse_status, parser_output, parser_version, mapping_version, created_by_process
    ) values (
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b6000000-0000-4000-8000-000000000001',
      9, '{}'::jsonb, repeat('5', 64), 'parsed', '{}'::jsonb, '1.0.0', '1.0.0',
      'provenance.import')$$,
  '42501', null, 'user A cannot insert a source record into workspace B');

-- Append-only still binds an ordinary operator ------------------------------------------------
select throws_ok(
  $$update public.source_records set source_row_key = 'x'
    where id = 'a7000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'an operator cannot update a source record');
select throws_ok(
  $$delete from public.source_records
    where id = 'a7000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'an operator cannot delete a source record');
select throws_ok(
  $$delete from public.audit_events$$,
  '42501', null, 'an operator cannot delete audit events');
select throws_ok(
  $$delete from public.import_jobs
    where id = 'a6000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'an operator cannot delete an import job');

select pg_temp.logout();

-- Owner: everything the operator can do, plus registry administration ---------------------------
select pg_temp.login('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into public.source_systems (
      workspace_id, public_id, kind, instance_label, created_by
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EXCELCTL', 'excel_export',
      'future control workbook export', '11111111-1111-1111-1111-111111111111')$$,
  'an owner can register a source system');

select lives_ok(
  $$update public.source_systems set active = false
    where public_id = 'EXCELCTL' and workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'an owner can deactivate a source system');

select throws_ok(
  $$delete from public.source_systems where public_id = 'EXCELCTL'$$,
  '42501', null, 'even an owner cannot delete a source system: registry rows are retained');

select lives_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', 'idem-a-000000001')$$,
  'an owner can commit an import in her workspace');

select is(
  (select status::text from public.import_jobs
   where id = 'a6000000-0000-4000-8000-000000000001'),
  'committed',
  'the import reached committed status');

-- Committing wrote an append-only audit event.
select is(
  (select count(*)::int from public.audit_events
   where event_type = 'import_committed'
     and import_job_id = 'a6000000-0000-4000-8000-000000000001'),
  1,
  'committing appended exactly one import_committed audit event');

-- Re-committing the same job is refused.
select throws_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', 'idem-a-000000001')$$,
  '23505', null, 'the same job cannot be committed twice');

select pg_temp.logout();

-- Workspace B is entirely untouched by everything above --------------------------------------------
select is(
  (select count(*)::int from public.import_jobs
   where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and status = 'committed'),
  0,
  'no workspace B import was committed by workspace A activity');

select is(
  (select review_state::text from public.source_crosswalks
   where id = 'bc000000-0000-4000-8000-000000000001'),
  'candidate',
  'the workspace B crosswalk is still an unreviewed candidate');

select * from finish();
rollback;
