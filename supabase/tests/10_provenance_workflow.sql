-- Phase 3 provenance — the governed staged import workflow, end to end.
--
-- Walks the complete path a real import takes: register a source system, open
-- a commit-mode job, stage raw rows in batches, stage scoped identifiers, stage
-- issues and candidate crosswalks, then finalize transactionally. Proves that
-- an incomplete or inconsistent job cannot reach committed, that retries are
-- idempotent, and that every direct-DML bypass is refused.
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

-- Scratch space for ids produced by the workflow. Readable/writable by the
-- impersonated roles below; it is test bookkeeping, not part of the schema.
create temp table ids (k text primary key, v uuid);
grant all on table ids to public;
create function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ids values (p_k, p_v)
  on conflict (k) do update set v = excluded.v
  returning v;
$$;
create function pg_temp.get(p_k text) returns uuid language sql stable as $$
  select v from ids where k = p_k;
$$;

-- Deterministic 64-hex helpers.
create function pg_temp.h(p_seed text) returns text language sql immutable as $$
  select encode(sha256(p_seed::bytea), 'hex');
$$;

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'operator@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'viewer@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'other@example.test');

insert into public.workspaces (id, name, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Workspace A',
   '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Workspace B',
   '44444444-4444-4444-4444-444444444444');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'operator'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

-- Registry is owner-only --------------------------------------------------------
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$select public.register_source_system(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'OPSYS', 'manual', 'operator try')$$,
  '42501', null,
  'an operator cannot register a source system');
select pg_temp.logout();

select pg_temp.login('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$select pg_temp.put('sys', public.register_source_system(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'REPO', 'repository_fixture',
      'repository JSON seed fixtures'))$$,
  'an owner can register a source system');

select is(
  (select count(*)::int from public.audit_events
   where event_type = 'source_system_registered'),
  1, 'registering a source system appended an audit event');

-- Secrets are refused, including NESTED ones -------------------------------------
select throws_ok(
  $$select public.register_source_system(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BADSYS', 'manual', 'x', null,
      '{"api_key":"placeholder"}'::jsonb)$$,
  '23514', null,
  'a top-level secret-like key is refused');

select throws_ok(
  $$select public.register_source_system(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BADSYS2', 'manual', 'x', null,
      '{"conn":{"nested":{"password":"placeholder"}}}'::jsonb)$$,
  '23514', null,
  'a DEEPLY NESTED secret-like key is refused');

select throws_ok(
  $$select public.register_source_system(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BADSYS3', 'manual', 'x', null,
      '{"servers":[{"label":"a"},{"access_key":"placeholder"}]}'::jsonb)$$,
  '23514', null,
  'a secret-like key inside an ARRAY is refused');

select lives_ok(
  $$select public.register_source_system(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'OKSYS', 'manual', 'x', null,
      '{"fixture_dir":"server/seed","nested":{"note":"fine"}}'::jsonb)$$,
  'secret-free nested configuration is accepted');

select pg_temp.logout();

-- Open a commit-mode job as the operator -------------------------------------------
select pg_temp.login('22222222-2222-2222-2222-222222222222');

select lives_ok(
  format($$select pg_temp.put('job', (public.begin_import_job(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %L, 'checks.json',
      %L, %L, '1.0.0', '1.0.0', 'idem-key-00000001', 3,
      '{"row_count":3}'::jsonb)->>'id')::uuid)$$,
    pg_temp.get('sys'), pg_temp.h('file'), pg_temp.h('content')),
  'an operator can open a commit-mode import job');

select is(
  (select status::text from public.import_jobs where id = pg_temp.get('job')),
  'preview',
  'a newly opened job is not committed');

select is(
  (select count(*)::int from public.audit_events where event_type = 'import_started'),
  1, 'opening the job appended an import_started audit event');

-- Reopening with the same key RESUMES rather than duplicating -------------------------
select is(
  (select (public.begin_import_job(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pg_temp.get('sys'), 'checks.json',
     pg_temp.h('file'), pg_temp.h('content'), '1.0.0', '1.0.0',
     'idem-key-00000001', 3, '{"row_count":3}'::jsonb)->>'resumed')::boolean),
  true,
  'reopening with the same idempotency key resumes the existing job');

select is(
  (select count(*)::int from public.import_jobs
   where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'resuming created no second job');

-- Rebinding a key to different content is refused ---------------------------------------
select throws_ok(
  format($$select public.begin_import_job(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %L, 'checks.json',
      %L, %L, '1.0.0', '1.0.0', 'idem-key-00000001', 3, '{}'::jsonb)$$,
    pg_temp.get('sys'), pg_temp.h('other'), pg_temp.h('other')),
  '22023', null,
  'an idempotency key cannot be rebound to different content');

-- Derivatives BEFORE raw rows are refused -------------------------------------------------
select throws_ok(
  format($$select public.stage_external_identifiers(%L,
    '[{"source_row_index":0,"scope":"checks.op","identifier_type":"check_id","identifier_value":"OP-001"}]'::jsonb)$$,
    pg_temp.get('job')),
  '23514', null,
  'identifiers cannot be staged before the raw source rows they reference');

select throws_ok(
  format($$select public.stage_import_derivatives(%L, '[]'::jsonb,
    '[{"source_row_index":0,"proposed_entity_type":"party_candidate","proposed_entity_key":"K","match_method":"normalized_text","confidence":0.5}]'::jsonb)$$,
    pg_temp.get('job')),
  '23514', null,
  'crosswalk candidates cannot be staged before their raw source rows');

-- Stage the raw rows -----------------------------------------------------------------------
select is(
  (select (public.stage_source_records(pg_temp.get('job'), jsonb_build_array(
     jsonb_build_object(
       'source_row_index', 0, 'source_row_key', 'OP-001',
       'raw_payload', '{"check_id":"OP-001","actual":5}'::jsonb,
       'normalized_hash', pg_temp.h('r0'), 'parse_status', 'parsed',
       'parser_output', '{"check_id":"OP-001"}'::jsonb),
     jsonb_build_object(
       'source_row_index', 1, 'source_row_key', 'OP-002',
       'raw_payload', '{"check_id":"OP-002","actual":"not-a-number"}'::jsonb,
       'normalized_hash', pg_temp.h('r1'), 'parse_status', 'malformed',
       'errors', '[{"field":"actual","code":"not_numeric"}]'::jsonb),
     jsonb_build_object(
       'source_row_index', 2, 'source_row_key', 'OP-003',
       'raw_payload', '{"check_id":"OP-003","actual":7}'::jsonb,
       'normalized_hash', pg_temp.h('r2'), 'parse_status', 'parsed',
       'parser_output', '{"check_id":"OP-003"}'::jsonb)
   ))->>'staged_total')::int),
  3,
  'three raw source rows staged');

-- Restaging the same rows is idempotent -------------------------------------------------------
select is(
  (select (public.stage_source_records(pg_temp.get('job'), jsonb_build_array(
     jsonb_build_object(
       'source_row_index', 0, 'source_row_key', 'OP-001',
       'raw_payload', '{"check_id":"OP-001","actual":5}'::jsonb,
       'normalized_hash', pg_temp.h('r0'), 'parse_status', 'parsed',
       'parser_output', '{"check_id":"OP-001"}'::jsonb)
   ))->>'inserted')::int),
  0,
  'restaging an already-staged row inserts nothing');

select is(
  (select count(*)::int from public.source_records
   where import_job_id = pg_temp.get('job')),
  3,
  'the retry left exactly three raw rows');

-- The exact raw payload is retained ---------------------------------------------------------
select is(
  (select raw_payload from public.source_records
   where import_job_id = pg_temp.get('job') and source_row_index = 1),
  '{"check_id":"OP-002","actual":"not-a-number"}'::jsonb,
  'the malformed row retained its exact raw payload');

-- A retry is idempotent only when CONTENT-identical, not merely index-identical ---------------
-- A repeated row index whose immutable staged values differ from what is
-- already stored is a real conflict, not a retry: it is rejected
-- transactionally, identifying the offending source-row index, rather than
-- silently disappearing behind ON CONFLICT DO NOTHING.

-- Changed raw payload at the same row index -----------------------------------------------------
select throws_ok(
  format($$select public.stage_source_records(%L, jsonb_build_array(
     jsonb_build_object(
       'source_row_index', 0, 'source_row_key', 'OP-001',
       'raw_payload', '{"check_id":"OP-001","actual":999}'::jsonb,
       'normalized_hash', %L, 'parse_status', 'parsed',
       'parser_output', '{"check_id":"OP-001"}'::jsonb)))$$,
    pg_temp.get('job'), pg_temp.h('r0-changed')),
  '23514', null,
  'a retry with a changed raw payload at an already-staged row index is refused');

-- Changed normalized hash at the same row index (payload text unchanged) ------------------------
select throws_ok(
  format($$select public.stage_source_records(%L, jsonb_build_array(
     jsonb_build_object(
       'source_row_index', 0, 'source_row_key', 'OP-001',
       'raw_payload', '{"check_id":"OP-001","actual":5}'::jsonb,
       'normalized_hash', %L, 'parse_status', 'parsed',
       'parser_output', '{"check_id":"OP-001"}'::jsonb)))$$,
    pg_temp.get('job'), pg_temp.h('a-different-hash')),
  '23514', null,
  'a retry with a changed normalized hash at an already-staged row index is refused');

-- Changed parse result at the same row index -----------------------------------------------------
select throws_ok(
  format($$select public.stage_source_records(%L, jsonb_build_array(
     jsonb_build_object(
       'source_row_index', 1, 'source_row_key', 'OP-002',
       'raw_payload', '{"check_id":"OP-002","actual":"not-a-number"}'::jsonb,
       'normalized_hash', %L, 'parse_status', 'parsed',
       'parser_output', '{"check_id":"OP-002"}'::jsonb)))$$,
    pg_temp.get('job'), pg_temp.h('r1')),
  '23514', null,
  'a retry that reclassifies an already-staged row''s parse result is refused');

-- A mixed batch containing an identical row and a conflicting row rejects the WHOLE batch --------
-- (the batch also carries a genuinely new row index, proving no partial insert occurs)
select is(
  (select count(*)::int from public.source_records where import_job_id = pg_temp.get('job')),
  3,
  'before the mixed batch: exactly three rows staged');

select throws_ok(
  format($$select public.stage_source_records(%L, jsonb_build_array(
     jsonb_build_object(
       'source_row_index', 0, 'source_row_key', 'OP-001',
       'raw_payload', '{"check_id":"OP-001","actual":5}'::jsonb,
       'normalized_hash', %L, 'parse_status', 'parsed',
       'parser_output', '{"check_id":"OP-001"}'::jsonb),
     jsonb_build_object(
       'source_row_index', 1, 'source_row_key', 'OP-002',
       'raw_payload', '{"check_id":"OP-002","actual":"CHANGED"}'::jsonb,
       'normalized_hash', %L, 'parse_status', 'malformed',
       'errors', '[{"field":"actual","code":"not_numeric"}]'::jsonb),
     jsonb_build_object(
       'source_row_index', 97, 'raw_payload', '{"new":true}'::jsonb,
       'normalized_hash', %L, 'parse_status', 'parsed',
       'parser_output', '{}'::jsonb)))$$,
    pg_temp.get('job'), pg_temp.h('r0'), pg_temp.h('mixed-conflict'), pg_temp.h('r97')),
  '23514', null,
  'a mixed batch with one conflicting row rejects the entire batch');

select is(
  (select count(*)::int from public.source_records where import_job_id = pg_temp.get('job')),
  3,
  'the rejected mixed batch left the row count unchanged: no partial insert');

select is(
  (select count(*)::int from public.source_records
   where import_job_id = pg_temp.get('job') and source_row_index = 97),
  0,
  'the genuinely-new row in the rejected mixed batch was not inserted');

select is(
  (select raw_payload from public.source_records
   where import_job_id = pg_temp.get('job') and source_row_index = 1),
  '{"check_id":"OP-002","actual":"not-a-number"}'::jsonb,
  'the conflicting row''s stored content is unmodified after the rejected retry');

-- An identical retry alongside the same content-identical rows is STILL a safe no-op -------------
select is(
  (select (public.stage_source_records(pg_temp.get('job'), jsonb_build_array(
     jsonb_build_object(
       'source_row_index', 0, 'source_row_key', 'OP-001',
       'raw_payload', '{"check_id":"OP-001","actual":5}'::jsonb,
       'normalized_hash', pg_temp.h('r0'), 'parse_status', 'parsed',
       'parser_output', '{"check_id":"OP-001"}'::jsonb),
     jsonb_build_object(
       'source_row_index', 1, 'source_row_key', 'OP-002',
       'raw_payload', '{"check_id":"OP-002","actual":"not-a-number"}'::jsonb,
       'normalized_hash', pg_temp.h('r1'), 'parse_status', 'malformed',
       'errors', '[{"field":"actual","code":"not_numeric"}]'::jsonb),
     jsonb_build_object(
       'source_row_index', 2, 'source_row_key', 'OP-003',
       'raw_payload', '{"check_id":"OP-003","actual":7}'::jsonb,
       'normalized_hash', pg_temp.h('r2'), 'parse_status', 'parsed',
       'parser_output', '{"check_id":"OP-003"}'::jsonb)
   ))->>'inserted')::int),
  0,
  'a fully content-identical retry of the whole batch reports zero newly inserted rows');

select is(
  (select count(*)::int from public.source_records where import_job_id = pg_temp.get('job')),
  3,
  'a fully content-identical retry still leaves exactly three rows staged');

-- Staging more rows than declared is refused ---------------------------------------------------
select throws_ok(
  format($$select public.stage_source_records(%L, jsonb_build_array(
      jsonb_build_object('source_row_index', 9, 'raw_payload', '{}'::jsonb,
        'normalized_hash', %L, 'parse_status', 'parsed',
        'parser_output', '{}'::jsonb)))$$,
    pg_temp.get('job'), pg_temp.h('r9')),
  '23514', null,
  'staging beyond the declared source row count is refused');

-- Finalizing an INCOMPLETE job is refused ----------------------------------------------------
-- (Re-open a second job that declares more rows than will be staged.)
select lives_ok(
  format($$select pg_temp.put('partial', (public.begin_import_job(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %L, 'inventory.json',
      %L, %L, '1.0.0', '1.0.0', 'idem-partial-0001', 5, '{}'::jsonb)->>'id')::uuid)$$,
    pg_temp.get('sys'), pg_temp.h('pfile'), pg_temp.h('pcontent')),
  'a second job is opened declaring five rows');

select lives_ok(
  format($$select public.stage_source_records(%L, jsonb_build_array(
      jsonb_build_object('source_row_index', 0, 'raw_payload', '{"a":1}'::jsonb,
        'normalized_hash', %L, 'parse_status', 'parsed', 'parser_output', '{}'::jsonb)))$$,
    pg_temp.get('partial'), pg_temp.h('p0')),
  'only one of the five rows is staged');

select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-partial-0001', 1, 1, 0, 0, 0, 0)$$,
    pg_temp.get('partial')),
  '23514', null,
  'an incomplete job cannot be finalized');

select is(
  (select status::text from public.import_jobs where id = pg_temp.get('partial')),
  'preview',
  'the incomplete job remains visibly uncommitted');

-- A failed attempt is visibly failed, never committed --------------------------------------------
select lives_ok(
  format($$select public.fail_import_job(%L, 'upload_interrupted', 'network dropped')$$,
    pg_temp.get('partial')),
  'an interrupted attempt can be marked failed');

select is(
  (select status::text from public.import_jobs where id = pg_temp.get('partial')),
  'failed',
  'the interrupted attempt is failed, not committed');

select is(
  (select count(*)::int from public.source_records
   where import_job_id = pg_temp.get('partial')),
  1,
  'the failed attempt keeps its staged raw rows as evidence');

select is(
  (select count(*)::int from public.audit_events where event_type = 'import_failed'),
  1, 'the failure appended an audit event');

-- Back to the good job: identifiers, then derivatives -----------------------------------------------
select is(
  (select (public.stage_external_identifiers(pg_temp.get('job'),
     '[{"source_row_index":0,"scope":"checks.op","identifier_type":"check_id","identifier_value":"OP-001"},
       {"source_row_index":1,"scope":"checks.op","identifier_type":"check_id","identifier_value":"OP-002"},
       {"source_row_index":2,"scope":"checks.op","identifier_type":"check_id","identifier_value":"OP-003"}]'::jsonb
   )->>'inserted')::int),
  3,
  'three scoped external identifiers staged');

select is(
  (select (public.stage_external_identifiers(pg_temp.get('job'),
     '[{"source_row_index":0,"scope":"checks.op","identifier_type":"check_id","identifier_value":"OP-001"}]'::jsonb
   )->>'inserted')::int),
  0,
  'restaging an identifier is idempotent');

-- A conflicting alias request — the SAME scoped identifier claimed for a
-- DIFFERENT source row — fails loudly instead of silently vanishing behind
-- ON CONFLICT DO NOTHING, and the original immutable source association is
-- never mutated.
select throws_ok(
  format($$select public.stage_external_identifiers(%L,
     '[{"source_row_index":1,"scope":"checks.op","identifier_type":"check_id","identifier_value":"OP-001"}]'::jsonb)$$,
    pg_temp.get('job')),
  '23514', null,
  'restaging the same scoped identifier bound to a DIFFERENT source row is refused');

select is(
  (select count(*)::int from public.external_identifiers
   where scope = 'checks.op' and identifier_type = 'check_id'
     and identifier_value = 'OP-001'),
  1,
  'the conflicting retry left exactly one OP-001 identifier recorded');

select is(
  (select sr.source_row_index from public.external_identifiers e
   join public.source_records sr on sr.id = e.source_record_id
   where e.scope = 'checks.op' and e.identifier_type = 'check_id'
     and e.identifier_value = 'OP-001'),
  0,
  'the original immutable source association (row 0) was not overwritten by the conflicting retry');

select is(
  (select count(*)::int from public.external_identifiers
   where source_system_id = pg_temp.get('sys')),
  3,
  'the conflicting retry inserted no new identifier rows');

select is(
  (select (public.stage_import_derivatives(pg_temp.get('job'),
     '[{"source_row_index":1,"issue_type":"malformed_row","severity":"error",
        "message":"actual is not numeric",
        "raw_payload_snapshot":{"check_id":"OP-002","actual":"not-a-number"}}]'::jsonb,
     '[{"source_row_index":0,"proposed_entity_type":"party_candidate",
        "proposed_entity_key":"OP-PARTY","match_method":"normalized_text","confidence":0.5}]'::jsonb
   )->>'issues')::int),
  1,
  'one data-quality issue staged');

select is(
  (select (public.stage_import_derivatives(pg_temp.get('job'), '[]'::jsonb, '[]'::jsonb)
   )->>'skipped')::boolean,
  true,
  'restaging derivatives is a no-op rather than a duplicate');

select is(
  (select count(*)::int from public.data_quality_issues
   where import_job_id = pg_temp.get('job')),
  1,
  'the derivative retry did not duplicate the issue');

-- Every staged crosswalk is a candidate -----------------------------------------------------------
select is(
  (select count(*)::int from public.source_crosswalks c
   join public.source_records sr on sr.id = c.source_record_id
   where sr.import_job_id = pg_temp.get('job') and c.review_state <> 'candidate'),
  0,
  'every staged crosswalk is a candidate');

-- Finalization: wrong expectations are refused -------------------------------------------------------
select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000001', 99, 2, 1, 1, 1, 3)$$,
    pg_temp.get('job')),
  '23514', null,
  'finalize refuses a mismatched source row expectation');

select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000001', 3, 3, 1, 1, 1, 3)$$,
    pg_temp.get('job')),
  '23514', null,
  'finalize refuses a mismatched accepted row expectation');

select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000001', 3, 2, 1, 99, 1, 3)$$,
    pg_temp.get('job')),
  '23514', null,
  'finalize refuses a mismatched total data-quality issue expectation');

select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000001', 3, 2, 1, 1, 99, 3)$$,
    pg_temp.get('job')),
  '23514', null,
  'finalize refuses a mismatched crosswalk candidate expectation');

select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000001', 3, 2, 1, 1, 1, 99)$$,
    pg_temp.get('job')),
  '23514', null,
  'finalize refuses a mismatched external identifier expectation');

select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000001', 3, 2, 1, 1, 1, null)$$,
    pg_temp.get('job')),
  '22023', null,
  'finalize refuses an omitted (null) external identifier expectation, even though the true count is nonzero');

select throws_ok(
  format($$select public.finalize_import_job(%L, 'wrong-key-000001', 3, 2, 1, 1, 1, 3)$$,
    pg_temp.get('job')),
  '22023', null,
  'finalize refuses a mismatched idempotency key');

select throws_ok(
  format($$select public.finalize_import_job(%L, null, 3, 2, 1, 1, 1, 3)$$, pg_temp.get('job')),
  '22023', null,
  'finalize refuses a missing idempotency key');

select is(
  (select status::text from public.import_jobs where id = pg_temp.get('job')),
  'preview',
  'every refused finalization left the job uncommitted');

select is(
  (select count(*)::int from public.audit_events
   where event_type = 'import_committed' and import_job_id = pg_temp.get('job')),
  0,
  'none of the refused finalizations wrote an import_committed event for this job');

-- Finalization: correct -- a corrected retry finishes the SAME open job ------------------------------
select is(
  (select (public.finalize_import_job(pg_temp.get('job'), 'idem-key-00000001', 3, 2, 1, 1, 1, 3)
   )->>'status'),
  'committed',
  'a corrected retry with all six matching expectations finalizes the same open job');

select results_eq(
  $$select source_row_count, accepted_row_count, issue_row_count
    from public.import_jobs where id = (select v from ids where k = 'job')$$,
  $$values (3, 2, 1)$$,
  'the committed job carries reconciled counts');

select is(
  (select count(*)::int from public.audit_events where event_type = 'import_committed'),
  1, 'committing appended exactly one import_committed audit event');

-- Re-finalizing is refused ----------------------------------------------------------------------------
select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000001', 3, 2, 1, 1, 1, 3)$$,
    pg_temp.get('job')),
  '23514', null,
  'an already-committed job cannot be finalized again');

select is(
  (select count(*)::int from public.audit_events where event_type = 'import_committed'),
  1, 'the refused re-finalization appended no second commit event');

-- A committed job accepts no further staging -----------------------------------------------------------
select throws_ok(
  format($$select public.stage_source_records(%L, jsonb_build_array(
      jsonb_build_object('source_row_index', 5, 'raw_payload', '{}'::jsonb,
        'normalized_hash', %L, 'parse_status', 'parsed', 'parser_output', '{}'::jsonb)))$$,
    pg_temp.get('job'), pg_temp.h('late')),
  '23514', null,
  'a committed job accepts no further raw rows');

-- Re-running the identical identity cannot duplicate ------------------------------------------------------
select throws_ok(
  format($$select public.begin_import_job(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %L, 'checks.json',
      %L, %L, '1.0.0', '1.0.0', 'a-different-key-1', 3, '{}'::jsonb)$$,
    pg_temp.get('sys'), pg_temp.h('file'), pg_temp.h('content')),
  '23505', null,
  'a new job cannot be opened for an already-committed identity');

select is(
  (select count(*)::int from public.import_jobs where status = 'committed'),
  1,
  'exactly one committed import exists');

select is(
  (select count(*)::int from public.source_records
   where import_job_id = pg_temp.get('job')),
  3,
  'the committed import still has exactly three raw rows');

-- A NEW parser version is a new governed import, not an overwrite ---------------------------------------------
select lives_ok(
  format($$select pg_temp.put('job2', (public.begin_import_job(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %L, 'checks.json',
      %L, %L, '1.1.0', '1.0.0', 'idem-key-00000002', 1, '{}'::jsonb)->>'id')::uuid)$$,
    pg_temp.get('sys'), pg_temp.h('file'), pg_temp.h('content')),
  'the same content under a NEW parser version opens a new governed import');

select lives_ok(
  format($$select public.stage_source_records(%L, jsonb_build_array(
      jsonb_build_object('source_row_index', 0, 'raw_payload', '{"check_id":"OP-001","actual":5}'::jsonb,
        'normalized_hash', %L, 'parse_status', 'parsed', 'parser_output', '{"v":2}'::jsonb)))$$,
    pg_temp.get('job2'), pg_temp.h('r0')),
  'the new version stages its own raw rows');

select lives_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000002', 1, 1, 0, 0, 0, 0)$$,
    pg_temp.get('job2')),
  'the new parser version commits independently');

select is(
  (select count(*)::int from public.import_jobs where status = 'committed'),
  2,
  'two governed imports now exist, one per parser version');

select is(
  (select raw_payload from public.source_records
   where import_job_id = pg_temp.get('job') and source_row_index = 1),
  '{"check_id":"OP-002","actual":"not-a-number"}'::jsonb,
  'the earlier version''s raw rows are untouched by the new version');

-- DIRECT-DML BYPASS DENIAL ----------------------------------------------------------------------------------
-- authenticated holds SELECT only, so every PostgREST-shaped write is refused
-- before RLS is even consulted.
select throws_ok(
  $$update public.import_jobs set status = 'committed'$$,
  '42501', null,
  'direct DML cannot commit an import job');

select throws_ok(
  $$insert into public.import_jobs (
      workspace_id, public_id, source_system_id, source_label, file_sha256,
      content_sha256, parser_version, mapping_version, idempotency_key, mode,
      actor_user_id, actor_process, source_row_count)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FORGED',
      (select v from ids where k = 'sys'), 'x.json',
      repeat('a',64), repeat('a',64), '1.0.0', '1.0.0', 'forged-key-00001',
      'commit', '22222222-2222-2222-2222-222222222222', 'forged', 1)$$,
  '42501', null,
  'direct DML cannot insert an import job and bypass idempotency');

select throws_ok(
  $$update public.source_crosswalks set review_state = 'confirmed'$$,
  '42501', null,
  'direct DML cannot confirm a crosswalk');

select throws_ok(
  $$update public.source_crosswalks set review_state = 'rejected'$$,
  '42501', null,
  'direct DML cannot reject a crosswalk');

select throws_ok(
  $$update public.source_crosswalks set review_state = 'superseded'$$,
  '42501', null,
  'direct DML cannot supersede a crosswalk');

select throws_ok(
  $$update public.data_quality_issues set status = 'resolved'$$,
  '42501', null,
  'direct DML cannot resolve an issue');

select throws_ok(
  $$insert into public.audit_events (
      workspace_id, event_type, subject_table, actor_user_id, actor_process)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'import_committed',
      'import_jobs', '22222222-2222-2222-2222-222222222222', 'forged')$$,
  '42501', null,
  'direct DML cannot fabricate an audit event');

select throws_ok(
  $$insert into public.source_records (
      workspace_id, import_job_id, source_row_index, raw_payload, normalized_hash,
      parse_status, parser_output, parser_version, mapping_version, created_by_process)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      (select v from ids where k = 'job'), 42, '{"forged":true}'::jsonb,
      repeat('a',64), 'parsed', '{}'::jsonb, '1.0.0', '1.0.0', 'forged')$$,
  '42501', null,
  'direct DML cannot fabricate evidence');

select throws_ok(
  $$insert into public.source_crosswalks (
      workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
      match_method, created_by_process)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      (select id from public.source_records
       where import_job_id = (select v from ids where k = 'job') limit 1),
      'party_candidate', 'FORGED', 'manual', 'forged')$$,
  '42501', null,
  'direct DML cannot insert a crosswalk');

select throws_ok(
  $$insert into public.data_quality_issues (
      workspace_id, import_job_id, issue_type, message, raw_payload_snapshot,
      created_by_process)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      (select v from ids where k = 'job'), 'conflict', 'forged', '{}'::jsonb, 'forged')$$,
  '42501', null,
  'direct DML cannot insert a data-quality issue');

select throws_ok(
  $$insert into public.source_systems (
      workspace_id, public_id, kind, instance_label, created_by)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FORGEDSYS', 'manual', 'x',
      '22222222-2222-2222-2222-222222222222')$$,
  '42501', null,
  'direct DML cannot register a source system');

select throws_ok(
  $$delete from public.source_records$$,
  '42501', null,
  'direct DML cannot delete evidence');

-- The governed path still works, and appends exactly the expected events -------------------------------------
select is(
  (select count(*)::int from public.audit_events
   where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  8,
  'exactly eight audit events: 2 registrations, 3 import starts, 1 failure, 2 commits'
);

select results_eq(
  $$select event_type, count(*)::int from public.audit_events
    group by event_type order by event_type$$,
  $$values ('import_committed', 2), ('import_failed', 1),
           ('import_started', 3), ('source_system_registered', 2)$$,
  'the audit log records exactly the governed actions that occurred');

-- Viewers cannot drive the workflow at all --------------------------------------------------------------------
select pg_temp.logout();
select pg_temp.login('33333333-3333-3333-3333-333333333333');

select throws_ok(
  format($$select public.begin_import_job(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %L, 'checks.json', %L, %L,
      '2.0.0', '1.0.0', 'viewer-key-00001', 1, '{}'::jsonb)$$,
    pg_temp.get('sys'), pg_temp.h('vf'), pg_temp.h('vc')),
  '42501', null,
  'a viewer cannot open an import job');

select throws_ok(
  format($$select public.stage_source_records(%L, '[]'::jsonb)$$, pg_temp.get('job2')),
  '42501', null,
  'a viewer cannot stage raw rows');

select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000002', 1, 1, 0, 0, 0, 0)$$,
    pg_temp.get('job2')),
  '42501', null,
  'a viewer cannot finalize an import');

select throws_ok(
  format($$select public.fail_import_job(%L, 'nope')$$, pg_temp.get('job2')),
  '42501', null,
  'a viewer cannot fail an import');

-- ...but can read the review surface.
select is(
  (select count(*)::int from public.import_jobs), 3,
  'a viewer reads all three import jobs in her workspace');
select is(
  (select count(*)::int from public.source_records), 5,
  'a viewer reads the staged raw records');

select pg_temp.logout();

-- Cross-workspace isolation --------------------------------------------------------------------------------------
select pg_temp.login('44444444-4444-4444-4444-444444444444');

select is((select count(*)::int from public.import_jobs), 0,
  'workspace B sees none of workspace A''s import jobs');
select is((select count(*)::int from public.source_records), 0,
  'workspace B sees none of workspace A''s raw records');

select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-key-00000001', 3, 2, 1, 1, 1, 3)$$,
    pg_temp.get('job')),
  '42501', null,
  'workspace B cannot finalize a workspace A import');

select throws_ok(
  format($$select public.stage_source_records(%L, '[]'::jsonb)$$, pg_temp.get('job')),
  '42501', null,
  'workspace B cannot stage rows into a workspace A import');

select throws_ok(
  format($$select public.begin_import_job(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %L, 'x.json', %L, %L,
      '1.0.0', '1.0.0', 'foreign-key-00001', 1, '{}'::jsonb)$$,
    pg_temp.get('sys'), pg_temp.h('ff'), pg_temp.h('fc')),
  '42501', null,
  'workspace B cannot open a job against a workspace A source system');

select pg_temp.logout();

-- The complete 2,149-row Whatnot import: the full finalization-count contract ------------------------
-- A synthetic but full-scale stand-in for the real whatnot_purchases.json fixture
-- (2,149 rows), staged in batches under the 500-row ceiling, proving every leg
-- of the finalize_import_job count contract: a job-level (source_row_index
-- NULL) duplicate-candidate issue exactly like the real adapter raises for
-- colliding seller spellings, row-level malformed-row issues, crosswalk
-- candidates, and scoped external identifiers.
create function pg_temp.stage_whatnot_batch(p_job uuid, p_start integer, p_end integer)
returns jsonb language sql as $$
  select public.stage_source_records(
    p_job,
    (select jsonb_agg(
       case when i in (2000, 2001, 2002) then
         jsonb_build_object(
           'source_row_index', i,
           'source_row_key', 'WN-' || lpad(i::text, 6, '0'),
           'raw_payload', jsonb_build_object(
             'seller', 'Synthetic Seller', 'row', i, 'amount', 'not-a-number'),
           'normalized_hash', encode(sha256(('whatnot-row-' || i)::bytea), 'hex'),
           'parse_status', 'malformed',
           'errors', jsonb_build_array(
             jsonb_build_object('field', 'amount', 'code', 'not_numeric'))
         )
       else
         jsonb_build_object(
           'source_row_index', i,
           'source_row_key', 'WN-' || lpad(i::text, 6, '0'),
           'raw_payload', jsonb_build_object(
             'seller', 'Synthetic Seller', 'row', i, 'amount', 12.34),
           'normalized_hash', encode(sha256(('whatnot-row-' || i)::bytea), 'hex'),
           'parse_status', 'parsed',
           'parser_output', jsonb_build_object('seller', 'Synthetic Seller', 'row', i)
         )
       end)
     from generate_series(p_start, p_end - 1) as i)
  );
$$;

create function pg_temp.stage_whatnot_ids_batch(p_job uuid, p_start integer, p_end integer)
returns jsonb language sql as $$
  select public.stage_external_identifiers(
    p_job,
    (select jsonb_agg(
       jsonb_build_object(
         'source_row_index', i,
         'scope', 'fixture.whatnot_purchases',
         'identifier_type', 'source_row_key',
         'identifier_value', 'WN-' || lpad(i::text, 6, '0'))
     )
     from generate_series(p_start, p_end - 1) as i)
  );
$$;

select pg_temp.login('22222222-2222-2222-2222-222222222222');

select lives_ok(
  format($$select pg_temp.put('whatnot', (public.begin_import_job(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %L, 'whatnot_purchases.json',
      %L, %L, '1.0.0', '1.0.0', 'idem-whatnot-2149-001', 2149,
      '{"row_count":2149}'::jsonb)->>'id')::uuid)$$,
    pg_temp.get('sys'), pg_temp.h('whatnot-file'), pg_temp.h('whatnot-content')),
  'a 2,149-row Whatnot-shaped import job is opened');

select lives_ok($$select pg_temp.stage_whatnot_batch(pg_temp.get('whatnot'), 0, 500)$$,
  'Whatnot batch 1/5 (rows 0-499) staged');
select lives_ok($$select pg_temp.stage_whatnot_batch(pg_temp.get('whatnot'), 500, 1000)$$,
  'Whatnot batch 2/5 (rows 500-999) staged');
select lives_ok($$select pg_temp.stage_whatnot_batch(pg_temp.get('whatnot'), 1000, 1500)$$,
  'Whatnot batch 3/5 (rows 1000-1499) staged');
select lives_ok($$select pg_temp.stage_whatnot_batch(pg_temp.get('whatnot'), 1500, 2000)$$,
  'Whatnot batch 4/5 (rows 1500-1999) staged');
select lives_ok($$select pg_temp.stage_whatnot_batch(pg_temp.get('whatnot'), 2000, 2149)$$,
  'Whatnot batch 5/5 (rows 2000-2148, including 3 malformed) staged');

select is(
  (select count(*)::int from public.source_records
   where import_job_id = pg_temp.get('whatnot')),
  2149,
  'all 2,149 Whatnot-shaped source rows are staged');
select is(
  (select count(*)::int from public.source_records
   where import_job_id = pg_temp.get('whatnot') and parse_status = 'parsed'),
  2146,
  '2,146 rows parsed');
select is(
  (select count(*)::int from public.source_records
   where import_job_id = pg_temp.get('whatnot') and parse_status = 'malformed'),
  3,
  '3 rows malformed');

-- A retry of an already-staged batch is a content-identical, safe no-op at scale.
select is(
  (select (pg_temp.stage_whatnot_batch(pg_temp.get('whatnot'), 0, 500))->>'inserted')::int,
  0,
  'retrying an already-staged Whatnot batch inserts nothing new');

select lives_ok($$select pg_temp.stage_whatnot_ids_batch(pg_temp.get('whatnot'), 0, 500)$$,
  'Whatnot identifiers batch 1/5 staged');
select lives_ok($$select pg_temp.stage_whatnot_ids_batch(pg_temp.get('whatnot'), 500, 1000)$$,
  'Whatnot identifiers batch 2/5 staged');
select lives_ok($$select pg_temp.stage_whatnot_ids_batch(pg_temp.get('whatnot'), 1000, 1500)$$,
  'Whatnot identifiers batch 3/5 staged');
select lives_ok($$select pg_temp.stage_whatnot_ids_batch(pg_temp.get('whatnot'), 1500, 2000)$$,
  'Whatnot identifiers batch 4/5 staged');
select lives_ok($$select pg_temp.stage_whatnot_ids_batch(pg_temp.get('whatnot'), 2000, 2149)$$,
  'Whatnot identifiers batch 5/5 staged');

select is(
  (select count(*)::int from public.external_identifiers e
   join public.source_records sr on sr.id = e.source_record_id
   where sr.import_job_id = pg_temp.get('whatnot')),
  2149,
  'exactly 2,149 scoped external identifiers staged, one per Whatnot row');

-- Row-level issues for the 3 malformed rows, PLUS one job-level (source_row_index
-- NULL) duplicate-candidate issue -- exactly the shape the real adapter produces
-- when two seller spellings normalize to the same form.
select lives_ok(
  format($$select public.stage_import_derivatives(%L,
    '[{"source_row_index":2000,"issue_type":"malformed_row","severity":"error",
       "message":"amount is not numeric"},
      {"source_row_index":2001,"issue_type":"malformed_row","severity":"error",
       "message":"amount is not numeric"},
      {"source_row_index":2002,"issue_type":"malformed_row","severity":"error",
       "message":"amount is not numeric"},
      {"source_row_index":null,"issue_type":"duplicate_candidate","severity":"warning",
       "message":"2 spellings normalize to the same form and were NOT merged",
       "raw_payload_snapshot":{"spellings":["Synthetic Seller","synthetic  seller"]}}]'::jsonb,
    '[{"source_row_index":10,"proposed_entity_type":"party_candidate",
       "proposed_entity_key":"SYNTHETIC-SELLER","match_method":"normalized_text","confidence":0.5},
      {"source_row_index":11,"proposed_entity_type":"party_candidate",
       "proposed_entity_key":"SYNTHETIC-SELLER","match_method":"normalized_text","confidence":0.5}]'::jsonb)$$,
    pg_temp.get('whatnot')),
  'Whatnot issues and crosswalk candidates staged');

select is(
  (select count(*)::int from public.data_quality_issues
   where import_job_id = pg_temp.get('whatnot')),
  4,
  'four total data-quality issues: 3 malformed-row issues + 1 job-level duplicate-candidate issue');
select is(
  (select count(*)::int from public.data_quality_issues
   where import_job_id = pg_temp.get('whatnot') and source_record_id is null),
  1,
  'exactly one job-level issue carries no source_record_id');
select is(
  (select count(*)::int from public.source_crosswalks c
   join public.source_records sr on sr.id = c.source_record_id
   where sr.import_job_id = pg_temp.get('whatnot')),
  2,
  'two crosswalk candidates staged for the colliding seller spellings');

-- Omitting the job-level duplicate-candidate issue from the total blocks finalization ------------
select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-whatnot-2149-001',
      2149, 2146, 3, 3, 2, 2149)$$,
    pg_temp.get('whatnot')),
  '23514', null,
  'expecting only the 3 row-level issues (omitting the job-level duplicate-candidate issue) blocks finalization');

-- Omitting external identifiers blocks finalization -----------------------------------------------
select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-whatnot-2149-001',
      2149, 2146, 3, 4, 2, 0)$$,
    pg_temp.get('whatnot')),
  '23514', null,
  'expecting zero external identifiers when 2,149 are actually staged blocks finalization');

-- Omitting crosswalk candidates blocks finalization -----------------------------------------------
select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-whatnot-2149-001',
      2149, 2146, 3, 4, 0, 2149)$$,
    pg_temp.get('whatnot')),
  '23514', null,
  'expecting zero crosswalk candidates when 2 are actually staged blocks finalization');

-- Over-staging relative to expectation blocks finalization (expects fewer crosswalks than staged) --
select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-whatnot-2149-001',
      2149, 2146, 3, 4, 1, 2149)$$,
    pg_temp.get('whatnot')),
  '23514', null,
  'expecting one crosswalk candidate when two are staged (over-staged relative to expectation) blocks finalization');

-- Under-staging relative to expectation blocks finalization (expects more identifiers than staged) --
select throws_ok(
  format($$select public.finalize_import_job(%L, 'idem-whatnot-2149-001',
      2149, 2146, 3, 4, 2, 2150)$$,
    pg_temp.get('whatnot')),
  '23514', null,
  'expecting 2,150 external identifiers when only 2,149 are staged (under-staged relative to expectation) blocks finalization');

select is(
  (select status::text from public.import_jobs where id = pg_temp.get('whatnot')),
  'preview',
  'every rejected Whatnot finalization left the job uncommitted, status=preview');

select is(
  (select count(*)::int from public.audit_events
   where event_type = 'import_committed' and import_job_id = pg_temp.get('whatnot')),
  0,
  'no rejected Whatnot finalization wrote an import_committed event');

-- A corrected retry, with all six expected counts matching exactly, finishes the same open job -----
select is(
  (select (public.finalize_import_job(pg_temp.get('whatnot'), 'idem-whatnot-2149-001',
     2149, 2146, 3, 4, 2, 2149))->>'status'),
  'committed',
  'the complete 2,149-row Whatnot import commits once every expected count is correct');

select results_eq(
  $$select source_row_count, accepted_row_count, issue_row_count
    from public.import_jobs where id = (select v from ids where k = 'whatnot')$$,
  $$values (2149, 2146, 3)$$,
  'the committed Whatnot job carries the reconciled 2,149/2,146/3 counts');

select is(
  (select count(*)::int from public.audit_events
   where import_job_id = pg_temp.get('whatnot') and event_type = 'import_started'),
  1, 'exactly one import_started audit event for the Whatnot job');
select is(
  (select count(*)::int from public.audit_events
   where import_job_id = pg_temp.get('whatnot') and event_type = 'import_committed'),
  1, 'exactly one import_committed audit event for the Whatnot job');

select pg_temp.logout();

-- No canonical commerce entity was created anywhere -----------------------------------------------------------------
select is((select count(*)::int from public.items), 0,
  'the whole workflow created no canonical item or inventory record');
select is((select count(*)::int from public.sessions), 0,
  'the whole workflow created no intake session');

select * from finish();
rollback;
