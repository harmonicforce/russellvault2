-- Phase 3 provenance — append-only enforcement, governed immutability,
-- idempotency, and crosswalk state governance.
--
-- These tests run as the OWNING (superuser) role on purpose. Grants and RLS do
-- not apply to this role, so anything that still fails here is failing because
-- of a database trigger or constraint — which is exactly the guarantee being
-- claimed: append-only is enforced by the database itself, not merely by
-- withheld privileges.
begin;
create extension if not exists pgtap;
select no_plan();

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test');

insert into public.workspaces (id, name, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Workspace A',
   '11111111-1111-1111-1111-111111111111');

insert into public.source_systems (id, workspace_id, public_id, kind, instance_label, created_by)
values ('55555555-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'REPO_FIXTURE',
        'repository_fixture', 'repository JSON seed fixtures',
        '11111111-1111-1111-1111-111111111111');

insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label,
  file_sha256, content_sha256, parser_version, mapping_version,
  idempotency_key, mode, actor_user_id, actor_process, source_row_count
) values (
  '66666666-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JOB-1',
  '55555555-0000-4000-8000-000000000001', 'whatnot_purchases.json',
  repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0',
  'idem-key-000000001', 'commit',
  '11111111-1111-1111-1111-111111111111', 'provenance.import', 10
);

insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, source_row_key,
  raw_payload, normalized_hash, parse_status, parser_output,
  parser_version, mapping_version, created_by_process
) values (
  '77777777-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-0000-4000-8000-000000000001',
  0, 'ROW-0', '{"seller":"Acme Cards","amount":"12.34"}'::jsonb,
  repeat('b', 64), 'parsed', '{"seller":"Acme Cards"}'::jsonb,
  '1.0.0', '1.0.0', 'provenance.import'
);

-- Raw source records are immutable -----------------------------------------------
select throws_ok(
  $$update public.source_records set source_row_key = 'tampered'
    where id = '77777777-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'source_records cannot be UPDATEd, even by the owning role'
);

select throws_ok(
  $$delete from public.source_records
    where id = '77777777-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'source_records cannot be DELETEd, even by the owning role'
);

select throws_ok(
  $$update public.source_records set raw_payload = '{}'::jsonb$$,
  '42501',
  null,
  'the raw payload of a source record cannot be rewritten'
);

-- TRUNCATE on source_records is refused by the referencing foreign-key graph
-- before the append-only trigger is even reached; the trigger (proven on
-- audit_events below) is the backstop if that graph ever changes.
select throws_ok(
  $$truncate public.source_records$$,
  '0A000',
  null,
  'source_records cannot be TRUNCATEd'
);

-- The raw payload survives all of that, byte for byte ------------------------------
select is(
  (select raw_payload from public.source_records
   where id = '77777777-0000-4000-8000-000000000001'),
  '{"seller":"Acme Cards","amount":"12.34"}'::jsonb,
  'the exact raw payload is still intact after every rejected mutation'
);

-- Audit events are immutable ---------------------------------------------------------
insert into public.audit_events (
  id, workspace_id, event_type, subject_table, subject_id,
  import_job_id, actor_user_id, actor_process
) values (
  '99999999-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'import_previewed', 'import_jobs',
  '66666666-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000001',
  '11111111-1111-1111-1111-111111111111', 'provenance.import'
);

select throws_ok(
  $$update public.audit_events set actor_process = 'forged'
    where id = '99999999-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'audit_events cannot be UPDATEd, even by the owning role'
);

select throws_ok(
  $$delete from public.audit_events
    where id = '99999999-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'audit_events cannot be DELETEd, even by the owning role'
);

select throws_ok(
  $$truncate public.audit_events$$,
  '42501',
  null,
  'audit_events cannot be TRUNCATEd'
);

-- Governed identity is immutable -------------------------------------------------------
select throws_ok(
  $$update public.import_jobs set content_sha256 = repeat('c', 64)
    where id = '66666666-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'an import job content hash cannot be changed after the fact'
);

select throws_ok(
  $$update public.import_jobs set public_id = 'JOB-RENAMED'
    where id = '66666666-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'a governed public import ID is immutable'
);

select throws_ok(
  $$update public.import_jobs set parser_version = '9.9.9'
    where id = '66666666-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'parser version cannot be rewritten on an existing job'
);

select throws_ok(
  $$update public.import_jobs set idempotency_key = 'another-key-00001'
    where id = '66666666-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'the idempotency key of a job is immutable'
);

-- A preview can never be promoted into a commit -------------------------------------------
insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label,
  file_sha256, content_sha256, parser_version, mapping_version,
  idempotency_key, mode, actor_user_id, actor_process, source_row_count
) values (
  '66666666-0000-4000-8000-0000000000f1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JOB-PREVIEW',
  '55555555-0000-4000-8000-000000000001', 'whatnot_purchases.json',
  repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0',
  'preview-key-00001', 'preview',
  '11111111-1111-1111-1111-111111111111', 'provenance.preview', 10
);

select throws_ok(
  $$update public.import_jobs set mode = 'commit'
    where id = '66666666-0000-4000-8000-0000000000f1'$$,
  '23514',
  null,
  'a preview job cannot be turned into a commit job'
);

select throws_ok(
  $$update public.import_jobs set status = 'committed'
    where id = '66666666-0000-4000-8000-0000000000f1'$$,
  '23514',
  null,
  'a preview-mode job cannot reach committed status'
);

-- Preview did not mutate any committed provenance ---------------------------------------------
select is(
  (select count(*)::int from public.import_jobs where status = 'committed'),
  0,
  'creating a preview job commits nothing'
);

-- Commit the real job, then prove the lifecycle is forward-only --------------------------------
update public.import_jobs
set status = 'committed', completed_at = now(), accepted_row_count = 9, issue_row_count = 1
where id = '66666666-0000-4000-8000-000000000001';

select is(
  (select status::text from public.import_jobs
   where id = '66666666-0000-4000-8000-000000000001'),
  'committed',
  'the commit-mode job reached committed status'
);

select throws_ok(
  $$update public.import_jobs set status = 'preview'
    where id = '66666666-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'a committed job cannot be walked back to preview'
);

select throws_ok(
  $$update public.import_jobs set status = 'failed'
    where id = '66666666-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'a committed job is terminal'
);

-- Re-running the identical file/parser/mapping cannot duplicate the import ------------------------
select throws_ok(
  $$insert into public.import_jobs (
      workspace_id, public_id, source_system_id, source_label,
      file_sha256, content_sha256, parser_version, mapping_version,
      idempotency_key, mode, status, actor_user_id, actor_process, source_row_count
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JOB-DUP',
      '55555555-0000-4000-8000-000000000001', 'whatnot_purchases.json',
      repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0',
      'idem-key-000000002', 'commit', 'committed',
      '11111111-1111-1111-1111-111111111111', 'provenance.import', 10
    )$$,
  '23505',
  null,
  'a second committed import of the same source/hash/parser/mapping is refused'
);

-- Reusing the same idempotency key is refused ------------------------------------------------------
select throws_ok(
  $$insert into public.import_jobs (
      workspace_id, public_id, source_system_id, source_label,
      file_sha256, content_sha256, parser_version, mapping_version,
      idempotency_key, mode, actor_user_id, actor_process, source_row_count
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JOB-SAMEKEY',
      '55555555-0000-4000-8000-000000000001', 'whatnot_purchases.json',
      repeat('d', 64), repeat('d', 64), '1.0.0', '1.0.0',
      'idem-key-000000001', 'commit',
      '11111111-1111-1111-1111-111111111111', 'provenance.import', 10
    )$$,
  '23505',
  null,
  'an idempotency key cannot be reused within a workspace'
);

-- A NEW parser version is a new governed import, not an overwrite ------------------------------------
insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label,
  file_sha256, content_sha256, parser_version, mapping_version,
  idempotency_key, mode, status, completed_at,
  actor_user_id, actor_process, source_row_count
) values (
  '66666666-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JOB-2',
  '55555555-0000-4000-8000-000000000001', 'whatnot_purchases.json',
  repeat('a', 64), repeat('a', 64), '1.1.0', '1.0.0',
  'idem-key-000000003', 'commit', 'committed', now(),
  '11111111-1111-1111-1111-111111111111', 'provenance.import', 10
);

-- ...and so is a new mapping version.
insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label,
  file_sha256, content_sha256, parser_version, mapping_version,
  idempotency_key, mode, status, completed_at,
  actor_user_id, actor_process, source_row_count
) values (
  '66666666-0000-4000-8000-000000000003',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JOB-3',
  '55555555-0000-4000-8000-000000000001', 'whatnot_purchases.json',
  repeat('a', 64), repeat('a', 64), '1.0.0', '2.0.0',
  'idem-key-000000004', 'commit', 'committed', now(),
  '11111111-1111-1111-1111-111111111111', 'provenance.import', 10
);

select is(
  (select count(*)::int from public.import_jobs
   where content_sha256 = repeat('a', 64) and status = 'committed'),
  3,
  'the same file under three parser/mapping versions yields three governed imports'
);

select is(
  (select count(distinct (parser_version, mapping_version))::int
   from public.import_jobs
   where content_sha256 = repeat('a', 64) and status = 'committed'),
  3,
  'each governed import retains its own parser/mapping version rather than overwriting'
);

-- The original version-1.0.0 history is untouched by the newer versions -------------------------------
select is(
  (select raw_payload from public.source_records
   where id = '77777777-0000-4000-8000-000000000001'),
  '{"seller":"Acme Cards","amount":"12.34"}'::jsonb,
  'a new parser version leaves the earlier version''s raw records intact'
);

-- A committed job accepts no further raw records ---------------------------------------------------------
select throws_ok(
  $$insert into public.source_records (
      workspace_id, import_job_id, source_row_index, raw_payload,
      normalized_hash, parse_status, parser_output,
      parser_version, mapping_version, created_by_process
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-0000-4000-8000-000000000001',
      99, '{"late":true}'::jsonb, repeat('e', 64), 'parsed', '{}'::jsonb,
      '1.0.0', '1.0.0', 'provenance.import'
    )$$,
  '23514',
  null,
  'a committed import can no longer accept new raw records'
);

-- Malformed rows keep their exact raw payload ---------------------------------------------------------------
insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label,
  file_sha256, content_sha256, parser_version, mapping_version,
  idempotency_key, mode, actor_user_id, actor_process, source_row_count
) values (
  '66666666-0000-4000-8000-000000000004',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JOB-4',
  '55555555-0000-4000-8000-000000000001', 'checks.json',
  repeat('f', 64), repeat('f', 64), '1.0.0', '1.0.0',
  'idem-key-000000005', 'commit',
  '11111111-1111-1111-1111-111111111111', 'provenance.import', 2
);

insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, raw_payload,
  normalized_hash, parse_status, parser_version, mapping_version,
  errors, created_by_process
) values (
  '77777777-0000-4000-8000-000000000009',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-0000-4000-8000-000000000004',
  1, '{"amount":"not-a-number","id":"X-9"}'::jsonb,
  repeat('9', 64), 'malformed', '1.0.0', '1.0.0',
  '[{"field":"amount","code":"not_numeric"}]'::jsonb, 'provenance.import'
);

insert into public.data_quality_issues (
  workspace_id, import_job_id, source_record_id, issue_type, severity,
  message, created_by_process
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-0000-4000-8000-000000000004',
  '77777777-0000-4000-8000-000000000009', 'malformed_row', 'error',
  'amount is not numeric', 'provenance.import'
);

select is(
  (select raw_payload from public.source_records
   where id = '77777777-0000-4000-8000-000000000009'),
  '{"amount":"not-a-number","id":"X-9"}'::jsonb,
  'a malformed row retains its exact raw payload'
);

select is(
  (select count(*)::int from public.data_quality_issues
   where source_record_id = '77777777-0000-4000-8000-000000000009'),
  1,
  'a malformed row produced a data-quality issue'
);

-- A malformed record must carry its errors -------------------------------------------------------------------
select throws_ok(
  $$insert into public.source_records (
      workspace_id, import_job_id, source_row_index, raw_payload,
      normalized_hash, parse_status, parser_version, mapping_version,
      created_by_process
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-0000-4000-8000-000000000004',
      2, '{}'::jsonb, repeat('8', 64), 'malformed', '1.0.0', '1.0.0', 'provenance.import'
    )$$,
  '23514',
  null,
  'a malformed source record must record why it was malformed'
);

-- An issue can never exist without a retained raw payload -------------------------------------------------------
select throws_ok(
  $$insert into public.data_quality_issues (
      workspace_id, import_job_id, issue_type, message, created_by_process
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-0000-4000-8000-000000000004',
      'malformed_row', 'lost the payload', 'provenance.import'
    )$$,
  '23514',
  null,
  'an issue must reference a source record or retain an inline raw payload snapshot'
);

-- Crosswalks: candidate is the only permitted initial state ------------------------------------------------------
select throws_ok(
  $$insert into public.source_crosswalks (
      workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
      match_method, created_by_process, review_state
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-0000-4000-8000-000000000001',
      'acquisition_candidate', 'ACME-CARDS', 'similarity', 'provenance.import', 'confirmed'
    )$$,
  '23514',
  null,
  'a crosswalk cannot be INSERTed already confirmed'
);

select throws_ok(
  $$insert into public.source_crosswalks (
      workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
      match_method, created_by_process, review_state
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-0000-4000-8000-000000000001',
      'acquisition_candidate', 'ACME-CARDS', 'manual', 'provenance.import', 'rejected'
    )$$,
  '23514',
  null,
  'a crosswalk cannot be INSERTed already rejected, even by a manual method'
);

select throws_ok(
  $$insert into public.source_crosswalks (
      workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
      match_method, created_by_process, reviewed_by, reviewed_at
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-0000-4000-8000-000000000001',
      'acquisition_candidate', 'ACME-CARDS', 'similarity', 'provenance.import',
      '11111111-1111-1111-1111-111111111111', now()
    )$$,
  '23514',
  null,
  'a new crosswalk candidate cannot arrive pre-attributed to a reviewer'
);

-- Two similar names produce two separate candidates, never an auto-merge -----------------------------------------
insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, source_row_key,
  raw_payload, normalized_hash, parse_status, parser_output,
  parser_version, mapping_version, created_by_process
) values (
  '77777777-0000-4000-8000-00000000000a',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-0000-4000-8000-000000000004',
  10, 'ROW-A', '{"seller":"Acme Cards"}'::jsonb,
  repeat('1', 64), 'parsed', '{"seller":"Acme Cards"}'::jsonb,
  '1.0.0', '1.0.0', 'provenance.import'
), (
  '77777777-0000-4000-8000-00000000000b',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-0000-4000-8000-000000000004',
  11, 'ROW-B', '{"seller":"ACME  cards"}'::jsonb,
  repeat('2', 64), 'parsed', '{"seller":"ACME  cards"}'::jsonb,
  '1.0.0', '1.0.0', 'provenance.import'
);

insert into public.source_crosswalks (
  workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
  match_method, confidence, created_by_process
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-0000-4000-8000-00000000000a',
  'acquisition_candidate', 'ACME-CARDS', 'similarity', 0.9100, 'provenance.import'
), (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-0000-4000-8000-00000000000b',
  'acquisition_candidate', 'ACME-CARDS', 'similarity', 0.9100, 'provenance.import'
);

select is(
  (select count(*)::int from public.source_records
   where id in ('77777777-0000-4000-8000-00000000000a',
                '77777777-0000-4000-8000-00000000000b')),
  2,
  'two similarly-named source rows remain two distinct raw records'
);

select is(
  (select count(*)::int from public.source_crosswalks
   where proposed_entity_key = 'ACME-CARDS' and review_state = 'candidate'),
  2,
  'two similar names produce two separate candidates and are never auto-merged'
);

select is(
  (select count(*)::int from public.source_crosswalks
   where review_state = 'confirmed'),
  0,
  'no confirmed mapping exists anywhere without an explicit human review'
);

select is(
  (select count(*)::int from public.source_crosswalks
   where review_state <> 'candidate'),
  0,
  'every automatically created crosswalk is still a candidate'
);

-- External identifiers stay scoped and never become canonical keys -----------------------------------
insert into public.external_identifiers (
  workspace_id, source_system_id, scope, identifier_type, identifier_value,
  source_record_id, created_by_process
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-0000-4000-8000-000000000001',
  'whatnot.order', 'order_id', 'SHARED-1',
  '77777777-0000-4000-8000-00000000000a', 'provenance.import'
), (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-0000-4000-8000-000000000001',
  'ebay.transaction', 'order_id', 'SHARED-1',
  '77777777-0000-4000-8000-00000000000b', 'provenance.import'
);

select is(
  (select count(*)::int from public.external_identifiers
   where identifier_value = 'SHARED-1'),
  2,
  'an identical-looking identifier in two scopes stays two separate aliases'
);

select throws_ok(
  $$insert into public.external_identifiers (
      workspace_id, source_system_id, scope, identifier_type, identifier_value,
      created_by_process
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-0000-4000-8000-000000000001',
      'whatnot.order', 'order_id', 'SHARED-1', 'provenance.import'
    )$$,
  '23505',
  null,
  'the same alias within one scope is recorded once, not duplicated'
);

-- source_systems never store credentials ----------------------------------------------------------------
select throws_ok(
  $$insert into public.source_systems (
      workspace_id, public_id, kind, instance_label, created_by, config
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BADSYS', 'manual', 'x',
      -- Obviously-fake placeholder: this asserts the CHECK rejects the KEY
      -- NAME, so the value is irrelevant and is deliberately not secret-shaped.
      '11111111-1111-1111-1111-111111111111', '{"api_key":"placeholder-value"}'::jsonb
    )$$,
  '23514',
  null,
  'a source system cannot store an API key'
);

select throws_ok(
  $$insert into public.source_systems (
      workspace_id, public_id, kind, instance_label, created_by, config
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BADSYS2', 'manual', 'x',
      '11111111-1111-1111-1111-111111111111', '{"connection_string":"postgres://u:p@h/db"}'::jsonb
    )$$,
  '23514',
  null,
  'a source system cannot store a connection string'
);

-- Reconciliation counts must stay internally consistent -----------------------------------------------------
select throws_ok(
  $$update public.import_jobs
    set accepted_row_count = 100, issue_row_count = 100
    where id = '66666666-0000-4000-8000-000000000004'$$,
  '23514',
  null,
  'accepted plus issue rows can never exceed the source row count'
);

-- No canonical commerce entity was created by any of this ------------------------------------------------------
select is(
  (select count(*)::int from public.items),
  0,
  'no canonical item/inventory record was created by provenance work'
);

select * from finish();
rollback;
