-- Phase 3 provenance — governed review functions and supersession coherence.
--
-- Covers the crosswalk review lifecycle (candidate -> confirmed/rejected ->
-- superseded), every supersession coherence rule, issue resolution, and the
-- fact that unknown and unauthorized ids are indistinguishable.
--
-- The import workflow is covered in 10_provenance_workflow.sql; concurrency and
-- authorize-before-lock in 11_provenance_concurrency.sql.
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

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'zoe@example.test');

insert into public.workspaces (id, name, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Workspace A',
   '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Workspace B',
   '44444444-4444-4444-4444-444444444444');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'operator');

insert into public.source_systems (id, workspace_id, public_id, kind, instance_label, created_by)
values
  ('a5000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'REPO', 'repository_fixture', 'repo seed', '11111111-1111-1111-1111-111111111111'),
  ('b5000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'REPO', 'repository_fixture', 'repo seed B', '44444444-4444-4444-4444-444444444444');

insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label, file_sha256,
  content_sha256, parser_version, mapping_version, idempotency_key, mode,
  actor_user_id, actor_process, source_row_count
) values
  ('a6000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'JOB-1', 'a5000000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0', 'idem-key-00000001', 'commit',
   '11111111-1111-1111-1111-111111111111', 'provenance.import', 2),
  ('b6000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'JOB-B', 'b5000000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('b', 64), repeat('b', 64), '1.0.0', '1.0.0', 'idem-key-B0000001', 'commit',
   '44444444-4444-4444-4444-444444444444', 'provenance.import', 1);

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
   'provenance.import'),
  ('b7000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b6000000-0000-4000-8000-000000000001', 0, '{"seller":"Foreign"}'::jsonb,
   repeat('3', 64), 'parsed', '{}'::jsonb, '1.0.0', '1.0.0', 'provenance.import');

-- Candidates on record 1 (same entity type) plus decoys.
insert into public.source_crosswalks (
  id, workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
  match_method, confidence, created_by_process
) values
  -- primary + three same-record/same-type alternatives
  ('ac000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000001', 'party_candidate', 'ACME',
   'similarity', 0.9200, 'provenance.import'),
  ('ac000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000001', 'party_candidate', 'ACME-CORRECTED',
   'manual', 0.9900, 'provenance.review'),
  ('ac000000-0000-4000-8000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000001', 'party_candidate', 'ACME-THIRD',
   'manual', 0.7000, 'provenance.review'),
  ('ac000000-0000-4000-8000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000001', 'party_candidate', 'ACME-FOURTH',
   'manual', 0.6000, 'provenance.review'),
  -- different SOURCE RECORD, same type
  ('ac000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000002', 'party_candidate', 'OTHER-RECORD',
   'similarity', 0.8800, 'provenance.import'),
  -- same record, different ENTITY TYPE
  ('ac000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a7000000-0000-4000-8000-000000000001', 'acquisition_candidate', 'ACME-ACQ',
   'normalized_text', 0.7500, 'provenance.import'),
  -- foreign workspace
  ('bc000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b7000000-0000-4000-8000-000000000001', 'party_candidate', 'FOREIGN',
   'similarity', 0.9000, 'provenance.import');

insert into public.data_quality_issues (
  id, workspace_id, import_job_id, source_record_id, issue_type, message,
  created_by_process
) values
  ('ad000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a6000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001',
   'duplicate_candidate', 'two similar sellers', 'provenance.import');

select pg_temp.login('22222222-2222-2222-2222-222222222222');

-- Everything starts as a candidate ------------------------------------------------
select is(
  (select count(*)::int from public.source_crosswalks where review_state <> 'candidate'),
  0, 'every crosswalk starts as a candidate');

-- Confirm / reject -----------------------------------------------------------------
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
  'matches the invoice', 'the reviewer note is retained');

select throws_ok(
  $$select public.confirm_source_crosswalk('ac000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an already-confirmed crosswalk cannot be confirmed again');

select throws_ok(
  $$select public.reject_source_crosswalk('ac000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a confirmed crosswalk cannot then be rejected');

select lives_ok(
  $$select public.reject_source_crosswalk(
      'ac000000-0000-4000-8000-000000000002', 'different legal entity')$$,
  'a similar candidate on another record can be rejected on its own merits');

select is(
  (select count(*)::int from public.source_records
   where id in ('a7000000-0000-4000-8000-000000000001',
                'a7000000-0000-4000-8000-000000000002')),
  2, 'both similarly-named raw records still exist independently');

-- SUPERSESSION COHERENCE -------------------------------------------------------------
-- Cross-RECORD supersession is refused.
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000002')$$,
  '23514', null,
  'a replacement must re-interpret the SAME source record');

-- Cross-ENTITY-TYPE supersession is refused.
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000003')$$,
  '23514', null,
  'a replacement must propose the SAME entity type');

-- A foreign-workspace replacement is refused, and reported as "not found".
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'a replacement in another workspace is refused as not found');

-- Self-supersession is refused.
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000001')$$,
  '22023', null, 'a crosswalk cannot supersede itself');

-- A non-candidate replacement is refused.
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-00000000000a', 'ac000000-0000-4000-8000-000000000002')$$,
  '23514', null,
  'a replacement that is already rejected cannot be used');

-- The valid supersession succeeds.
select lives_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001',
      'ac000000-0000-4000-8000-00000000000a',
      'corrected after reviewing the packing slip')$$,
  'a confirmed crosswalk can be superseded by a same-record, same-type candidate');

select is(
  (select review_state::text from public.source_crosswalks
   where id = 'ac000000-0000-4000-8000-000000000001'),
  'superseded', 'the original mapping is now superseded');

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

-- ONE replacement cannot succeed TWO different rows -------------------------------------
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-00000000000b', 'ac000000-0000-4000-8000-00000000000a')$$,
  '23505', null,
  'one replacement row cannot serve as the successor to a second, unrelated row');

-- A superseded row is terminal -------------------------------------------------------------
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-00000000000b')$$,
  '23514', null, 'an already-superseded crosswalk cannot be superseded again');

-- A linear chain is allowed: A -> B -> C ------------------------------------------------------
select lives_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-00000000000a', 'ac000000-0000-4000-8000-00000000000b')$$,
  'the replacement may itself later be superseded, forming a linear chain');

select results_eq(
  $$select id::text, review_state::text from public.source_crosswalks
    where id in ('ac000000-0000-4000-8000-000000000001',
                 'ac000000-0000-4000-8000-00000000000a',
                 'ac000000-0000-4000-8000-00000000000b')
    order by id::text$$,
  $$values ('ac000000-0000-4000-8000-000000000001', 'superseded'),
           ('ac000000-0000-4000-8000-00000000000a', 'superseded'),
           ('ac000000-0000-4000-8000-00000000000b', 'candidate')$$,
  'the chain records each link without erasing any of them');

-- A CYCLE is refused ---------------------------------------------------------------------------
-- Superseding the chain head with a row already earlier in the chain would
-- close a loop; the coherence trigger walks the chain and refuses.
select throws_ok(
  $$select public.supersede_source_crosswalk(
      'ac000000-0000-4000-8000-00000000000b', 'ac000000-0000-4000-8000-000000000001')$$,
  '23514', null,
  'supersession cannot close a cycle');

-- No crosswalk row was ever removed --------------------------------------------------------------
-- Six in this workspace; the seventh belongs to workspace B and is correctly
-- invisible to this caller.
select is(
  (select count(*)::int from public.source_crosswalks), 6,
  'every workspace-A crosswalk row still exists across all review states');

-- Issue resolution ---------------------------------------------------------------------------------
select lives_ok(
  $$select public.resolve_data_quality_issue('ad000000-0000-4000-8000-000000000001',
      'acknowledged'::public.data_quality_status, 'seen')$$,
  'an issue can be acknowledged');

select is(
  (select resolved_by from public.data_quality_issues
   where id = 'ad000000-0000-4000-8000-000000000001'),
  null, 'acknowledgement does not claim the issue was resolved');

select lives_ok(
  $$select public.resolve_data_quality_issue('ad000000-0000-4000-8000-000000000001',
      'resolved'::public.data_quality_status, 'kept both, distinct sellers')$$,
  'an acknowledged issue can then be resolved');

select is(
  (select resolved_by from public.data_quality_issues
   where id = 'ad000000-0000-4000-8000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'resolution names the acting user');

select throws_ok(
  $$select public.resolve_data_quality_issue('ad000000-0000-4000-8000-000000000001',
      'resolved'::public.data_quality_status)$$,
  '23514', null, 'an already-resolved issue cannot be resolved twice');

select throws_ok(
  $$select public.resolve_data_quality_issue('ad000000-0000-4000-8000-000000000001',
      'open'::public.data_quality_status)$$,
  '22023', null, 'an issue cannot be moved back to open');

-- Resolving never touched the raw payload it preserves -----------------------------------------------
select is(
  (select raw_payload from public.source_records
   where id = 'a7000000-0000-4000-8000-000000000001'),
  '{"seller":"Acme Cards"}'::jsonb,
  'resolving an issue left the underlying raw payload byte-identical');

-- Unknown ids are indistinguishable from unauthorized ones -------------------------------------------
select throws_ok(
  $$select public.confirm_source_crosswalk('00000000-0000-4000-8000-0000000000ff')$$,
  '42501', null, 'an unknown crosswalk id is refused as unauthorized');
select throws_ok(
  $$select public.resolve_data_quality_issue('00000000-0000-4000-8000-0000000000ff',
      'resolved'::public.data_quality_status)$$,
  '42501', null, 'an unknown issue id is refused as unauthorized');
select throws_ok(
  $$select public.finalize_import_job('00000000-0000-4000-8000-0000000000ff',
      'idem-key-00000001', 1, 1, 0)$$,
  '42501', null, 'an unknown import job id is refused as unauthorized');

-- The audit log recorded every governed action ---------------------------------------------------------
select results_eq(
  $$select event_type, count(*)::int from public.audit_events
    group by event_type order by event_type$$,
  $$values ('crosswalk_confirmed', 1), ('crosswalk_rejected', 1),
           ('crosswalk_superseded', 2), ('issue_acknowledged', 1),
           ('issue_resolved', 1)$$,
  'exactly the governed review actions were audited');

-- Nothing here created a canonical business entity ---------------------------------------------------------
select is((select count(*)::int from public.items), 0,
  'no canonical item was created by the review lifecycle');
select is((select count(*)::int from public.sessions), 0,
  'no intake session was created by the review lifecycle');

select pg_temp.logout();

select * from finish();
rollback;
