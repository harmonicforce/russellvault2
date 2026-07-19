-- Phase 3 provenance — governed review functions.
--
-- Covers commit idempotency-key enforcement, the crosswalk review lifecycle
-- (candidate -> confirmed/rejected -> superseded), supersession history, issue
-- resolution states, and the fact that none of it creates a canonical entity.
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

create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Fixtures -------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test');

insert into public.workspaces (id, name, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Workspace A',
   '11111111-1111-1111-1111-111111111111');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'operator');

insert into public.source_systems (id, workspace_id, public_id, kind, instance_label, created_by)
values ('a5000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'REPO_FIXTURE', 'repository_fixture', 'repo seed',
        '11111111-1111-1111-1111-111111111111');

insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label, file_sha256,
  content_sha256, parser_version, mapping_version, idempotency_key, mode,
  actor_user_id, actor_process, source_row_count
) values
  ('a6000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'JOB-1', 'a5000000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0', 'idem-key-00000001', 'commit',
   '11111111-1111-1111-1111-111111111111', 'provenance.import', 4),
  -- A preview job over the same artifact: must never be committable.
  ('a6000000-0000-4000-8000-0000000000f1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'JOB-PREVIEW', 'a5000000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0', 'preview-key-000001', 'preview',
   '11111111-1111-1111-1111-111111111111', 'provenance.preview', 4);

insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, raw_payload, normalized_hash,
  parse_status, parser_output, parser_version, mapping_version, created_by_process
) values
  ('a7000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a6000000-0000-4000-8000-000000000001', 0, '{"seller":"Acme Cards"}'::jsonb,
   repeat('1', 64), 'parsed', '{"seller":"Acme Cards"}'::jsonb, '1.0.0', '1.0.0',
   'provenance.import'),
  ('a7000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a6000000-0000-4000-8000-000000000001', 1, '{"seller":"ACME Cards LLC"}'::jsonb,
   repeat('2', 64), 'parsed', '{"seller":"ACME Cards LLC"}'::jsonb, '1.0.0', '1.0.0',
   'provenance.import');

insert into public.source_crosswalks (
  id, workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
  match_method, confidence, created_by_process
) values
  ('ac000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000001', 'acquisition_candidate', 'ACME',
   'similarity', 0.9200, 'provenance.import'),
  ('ac000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000002', 'acquisition_candidate', 'ACME',
   'similarity', 0.8800, 'provenance.import'),
  ('ac000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000001', 'party_candidate', 'ACME-PARTY',
   'normalized_text', 0.7500, 'provenance.import');

insert into public.data_quality_issues (
  id, workspace_id, import_job_id, source_record_id, issue_type, message,
  created_by_process
) values
  ('ad000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
   'duplicate_candidate', 'two similar sellers', 'provenance.import'),
  ('ad000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002',
   'total_discrepancy', 'declared total does not match summed rows', 'provenance.import');

select pg_temp.login('22222222-2222-2222-2222-222222222222');

-- Commit requires an idempotency key ------------------------------------------------------
select throws_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', null)$$,
  '22023', null,
  'commit is refused when no idempotency key is supplied');

select throws_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', '   ')$$,
  '22023', null,
  'commit is refused when the idempotency key is blank');

select throws_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', 'wrong-key-000001')$$,
  '22023', null,
  'commit is refused when the idempotency key does not match the job');

select is(
  (select status::text from public.import_jobs
   where id = 'a6000000-0000-4000-8000-000000000001'),
  'preview',
  'a refused commit left the job uncommitted');

-- A preview job can never be committed ------------------------------------------------------
select throws_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-0000000000f1', 'preview-key-000001')$$,
  '23514', null,
  'a preview job cannot be committed through the governed function');

-- A correct commit succeeds and is audited ---------------------------------------------------
select lives_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', 'idem-key-00000001')$$,
  'commit succeeds with the matching idempotency key');

select is(
  (select status::text from public.import_jobs
   where id = 'a6000000-0000-4000-8000-000000000001'),
  'committed',
  'the job is committed');

select isnt(
  (select completed_at from public.import_jobs
   where id = 'a6000000-0000-4000-8000-000000000001'),
  null,
  'the commit recorded a completion timestamp');

select is(
  (select count(*)::int from public.audit_events
   where event_type = 'import_committed'
     and import_job_id = 'a6000000-0000-4000-8000-000000000001'),
  1,
  'the commit appended one audit event');

-- Re-running the identical committed import does not duplicate ----------------------------------
select throws_ok(
  $$select public.commit_import_job('a6000000-0000-4000-8000-000000000001', 'idem-key-00000001')$$,
  '23505', null,
  'committing the same job again is refused');

select is(
  (select count(*)::int from public.import_jobs where status = 'committed'),
  1,
  'exactly one committed import exists after the repeated attempt');

select is(
  (select count(*)::int from public.source_records),
  2,
  'the repeated commit attempt created no additional source records');

-- Crosswalk review lifecycle -------------------------------------------------------------------
select is(
  (select count(*)::int from public.source_crosswalks where review_state = 'candidate'),
  3,
  'every crosswalk starts as a candidate');

select lives_ok(
  $$select public.confirm_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'matches the invoice')$$,
  'a candidate can be confirmed');

select is(
  (select reviewed_by from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'the confirmation names the acting reviewer');

select is(
  (select review_note from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  'matches the invoice',
  'the reviewer note is retained');

-- Confirming twice is refused; review decisions are not re-writable ---------------------------------
select throws_ok(
  $$select public.confirm_source_crosswalk('ac000000-0000-4000-8000-000000000001')$$,
  '23514', null,
  'an already-confirmed crosswalk cannot be confirmed again');

select throws_ok(
  $$select public.reject_source_crosswalk('ac000000-0000-4000-8000-000000000001')$$,
  '23514', null,
  'a confirmed crosswalk cannot then be rejected');

-- A second similar candidate is rejected rather than merged into the first -----------------------------
select lives_ok(
  $$select public.reject_source_crosswalk(
      'ac000000-0000-4000-8000-000000000002', 'different legal entity')$$,
  'the similar second candidate can be rejected on its own merits');

select is(
  (select review_state::text from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000002'),
  'rejected',
  'the similar candidate was rejected, never merged into the first');

select is(
  (select count(*)::int from public.source_records
   where id in ('a7000000-0000-4000-8000-000000000001',
                'a7000000-0000-4000-8000-000000000002')),
  2,
  'both similarly-named raw records still exist independently');

-- At most one live confirmed mapping per record and entity type -----------------------------------------
select throws_ok(
  $$insert into public.source_crosswalks (
      workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
      match_method, created_by_process, review_state, reviewed_by, reviewed_at
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a7000000-0000-4000-8000-000000000001',
      'acquisition_candidate', 'OTHER', 'manual', 'provenance.import',
      'confirmed', '22222222-2222-2222-2222-222222222222', now())$$,
  '23514', null,
  'a competing confirmed mapping cannot be inserted directly');

-- Supersession preserves history ----------------------------------------------------------------------
insert into public.source_crosswalks (
  id, workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
  match_method, confidence, created_by_process
) values (
  'ac000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'a7000000-0000-4000-8000-000000000001', 'acquisition_candidate', 'ACME-CORRECTED',
  'manual', 0.9900, 'provenance.review');

select lives_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001',
      'ac000000-0000-4000-8000-00000000000a',
      'corrected after reviewing the packing slip')$$,
  'a confirmed crosswalk can be superseded by a newer candidate');

select is(
  (select review_state::text from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  'superseded',
  'the original mapping is now superseded');

select is(
  (select superseded_by_id from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  'ac000000-0000-4000-8000-00000000000a'::uuid,
  'the superseded row points at its replacement');

select is(
  (select supersedes_id from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-00000000000a'),
  'ac000000-0000-4000-8000-000000000001'::uuid,
  'the replacement points back at what it superseded');

select is(
  (select reviewed_by from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'supersession did not erase the original review attribution');

select is(
  (select count(*)::int from public.audit_events where event_type = 'crosswalk_superseded'),
  1,
  'the supersession was audited');

-- A superseded row is terminal ---------------------------------------------------------------------------
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000003')$$,
  '23514', null,
  'an already-superseded crosswalk cannot be superseded again');

select throws_ok(
  $$update public.source_crosswalks set review_state = 'candidate'
    where id = 'ac000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'a reviewed crosswalk can never return to candidate');

select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000003', 'ac000000-0000-4000-8000-000000000003')$$,
  '22023', null,
  'a crosswalk cannot supersede itself');

-- The full review history remains reconstructable ------------------------------------------------------------
select is(
  (select count(*)::int from public.source_crosswalks),
  4,
  'no crosswalk row was ever removed: candidate, rejected, superseded and replacement all remain');

select results_eq(
  $$select review_state::text, count(*)::int from public.source_crosswalks
    group by review_state order by review_state::text$$,
  $$values ('candidate', 2), ('rejected', 1), ('superseded', 1)$$,
  'the crosswalk table retains every review state');

-- Issue resolution -------------------------------------------------------------------------------------------
select lives_ok(
  $$select public.resolve_data_quality_issue(
      'ad000000-0000-4000-8000-000000000001',
      'acknowledged'::public.data_quality_status, 'seen')$$,
  'an issue can be acknowledged');

select is(
  (select resolved_by from public.data_quality_issues
   where id = 'ad000000-0000-4000-8000-000000000001'),
  null,
  'acknowledgement does not claim the issue was resolved');

select lives_ok(
  $$select public.resolve_data_quality_issue(
      'ad000000-0000-4000-8000-000000000001',
      'resolved'::public.data_quality_status, 'kept both, distinct sellers')$$,
  'an acknowledged issue can then be resolved');

select is(
  (select resolved_by from public.data_quality_issues
   where id = 'ad000000-0000-4000-8000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'resolution names the acting user');

select throws_ok(
  $$select public.resolve_data_quality_issue(
      'ad000000-0000-4000-8000-000000000001',
      'resolved'::public.data_quality_status)$$,
  '23514', null,
  'an already-resolved issue cannot be resolved twice');

select throws_ok(
  $$select public.resolve_data_quality_issue(
      'ad000000-0000-4000-8000-000000000002', 'open'::public.data_quality_status)$$,
  '22023', null,
  'an issue cannot be moved back to open');

-- Resolving an issue never touched the raw payload it preserves ------------------------------------------------
select is(
  (select raw_payload from public.source_records
   where id = 'a7000000-0000-4000-8000-000000000001'),
  '{"seller":"Acme Cards"}'::jsonb,
  'resolving an issue left the underlying raw payload byte-identical');

select is(
  (select count(*)::int from public.data_quality_issues),
  2,
  'no issue row was deleted by resolution');

-- Unknown ids are refused as unauthorized, never confirmed as missing --------------------------------------------
select throws_ok(
  $$select public.commit_import_job(
      '00000000-0000-4000-8000-0000000000ff', 'idem-key-00000001')$$,
  '42501', null,
  'an unknown import job id is refused as unauthorized, not reported as missing');

select throws_ok(
  $$select public.confirm_source_crosswalk('00000000-0000-4000-8000-0000000000ff')$$,
  '42501', null,
  'an unknown crosswalk id is refused as unauthorized');

-- Nothing here created a canonical business entity ----------------------------------------------------------------
select is((select count(*)::int from public.items), 0,
  'no canonical item was created by the review lifecycle');
select is((select count(*)::int from public.sessions), 0,
  'no intake session was created by the review lifecycle');

select pg_temp.logout();

select * from finish();
rollback;
