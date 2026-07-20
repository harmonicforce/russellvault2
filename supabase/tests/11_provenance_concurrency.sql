-- Phase 3 provenance — authorize-before-lock, proved with a REAL second session.
--
-- The claim under test: supersede_source_crosswalk never reads or locks the
-- replacement row until the join has proved it belongs to a workspace the
-- caller may write to. An in-transaction assertion cannot prove that, because a
-- row lock a session already holds is invisible to itself. So this file opens a
-- genuine second database session through dblink, has that session hold a lock
-- on a FOREIGN workspace's crosswalk, and then observes what the function does.
--
-- The proof rests on two observations together:
--   POSITIVE CONTROL — a deliberate `SELECT ... FOR UPDATE` on that foreign row
--     from this session DOES block and hit lock_timeout (55P03). This shows the
--     other session's lock is real and that lock_timeout is armed.
--   THE ACTUAL TEST  — supersede_source_crosswalk() naming that same foreign row
--     returns the authorization error (42501) essentially instantly, well inside
--     lock_timeout. It could not have done that had it attempted the lock.
--
-- Unlike the other test files this one does NOT run inside a single rolled-back
-- transaction: dblink opens a separate session, which can only see COMMITTED
-- rows. Fixtures are therefore committed and explicitly removed in teardown.
-- Every fixture id is prefixed cc/cd/ce so teardown cannot touch anything else.

create extension if not exists pgtap;
create extension if not exists dblink;

select no_plan();

-- Fixtures (committed, so the second session can see them) ----------------------
insert into auth.users (id, email) values
  ('cc111111-1111-4111-8111-111111111111', 'conc-owner-a@example.test'),
  ('cc222222-2222-4222-8222-222222222222', 'conc-operator-a@example.test'),
  ('cc444444-4444-4444-8444-444444444444', 'conc-owner-b@example.test');

insert into public.workspaces (id, name, created_by) values
  ('cca00000-0000-4000-8000-000000000001', 'Concurrency A',
   'cc111111-1111-4111-8111-111111111111'),
  ('ccb00000-0000-4000-8000-000000000001', 'Concurrency B',
   'cc444444-4444-4444-8444-444444444444');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('cca00000-0000-4000-8000-000000000001', 'cc222222-2222-4222-8222-222222222222', 'operator');

insert into public.source_systems (id, workspace_id, public_id, kind, instance_label, created_by)
values
  ('ccc50000-0000-4000-8000-00000000000a'::uuid, 'cca00000-0000-4000-8000-000000000001',
   'CONCA', 'repository_fixture', 'conc A', 'cc111111-1111-4111-8111-111111111111'),
  ('ccc50000-0000-4000-8000-00000000000b'::uuid, 'ccb00000-0000-4000-8000-000000000001',
   'CONCB', 'repository_fixture', 'conc B', 'cc444444-4444-4444-8444-444444444444');

insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label, file_sha256,
  content_sha256, parser_version, mapping_version, idempotency_key, mode,
  actor_user_id, actor_process, source_row_count
) values
  ('ccc60000-0000-4000-8000-00000000000a'::uuid, 'cca00000-0000-4000-8000-000000000001',
   'CONC-JOB-A', 'ccc50000-0000-4000-8000-00000000000a'::uuid, 'checks.json',
   repeat('c', 64), repeat('c', 64), '1.0.0', '1.0.0', 'conc-idem-a-0001', 'commit',
   'cc111111-1111-4111-8111-111111111111', 'provenance.import', 1),
  ('ccc60000-0000-4000-8000-00000000000b'::uuid, 'ccb00000-0000-4000-8000-000000000001',
   'CONC-JOB-B', 'ccc50000-0000-4000-8000-00000000000b'::uuid, 'checks.json',
   repeat('d', 64), repeat('d', 64), '1.0.0', '1.0.0', 'conc-idem-b-0001', 'commit',
   'cc444444-4444-4444-8444-444444444444', 'provenance.import', 1);

insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, raw_payload, normalized_hash,
  parse_status, parser_output, parser_version, mapping_version, created_by_process
) values
  ('ccc70000-0000-4000-8000-00000000000a'::uuid, 'cca00000-0000-4000-8000-000000000001',
   'ccc60000-0000-4000-8000-00000000000a'::uuid, 0, '{"a":1}'::jsonb, repeat('1', 64),
   'parsed', '{"a":1}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  ('ccc70000-0000-4000-8000-00000000000b'::uuid, 'ccb00000-0000-4000-8000-000000000001',
   'ccc60000-0000-4000-8000-00000000000b'::uuid, 0, '{"b":1}'::jsonb, repeat('2', 64),
   'parsed', '{"b":1}'::jsonb, '1.0.0', '1.0.0', 'provenance.import');

insert into public.source_crosswalks (
  id, workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
  match_method, created_by_process
) values
  -- The caller's own row (workspace A).
  ('ccc80000-0000-4000-8000-00000000000a'::uuid, 'cca00000-0000-4000-8000-000000000001',
   'ccc70000-0000-4000-8000-00000000000a'::uuid, 'party_candidate', 'A-KEY',
   'similarity', 'provenance.import'),
  -- The FOREIGN row the other session will lock (workspace B).
  ('ccc80000-0000-4000-8000-00000000000b'::uuid, 'ccb00000-0000-4000-8000-000000000001',
   'ccc70000-0000-4000-8000-00000000000b'::uuid, 'party_candidate', 'B-KEY',
   'similarity', 'provenance.import');

-- Open the second session and have it hold a lock on the FOREIGN row -------------
-- If dblink cannot open a session in this environment the concurrency
-- assertions are skipped explicitly rather than silently passing.
create temp table conc_state (connected boolean not null);
grant all on table conc_state to public;

do $$
begin
  perform dblink_connect('holder', 'dbname=' || current_database());
  perform dblink_exec('holder', 'begin');
  -- Take and hold a row lock on the workspace-B crosswalk.
  perform * from dblink('holder',
    'select id::text from public.source_crosswalks
     where id = ''ccc80000-0000-4000-8000-00000000000b'' for update') as t(id text);
  insert into conc_state values (true);
exception when others then
  insert into conc_state values (false);
end $$;

-- POSITIVE CONTROL: the foreign row really is locked by the other session ---------
set lock_timeout = '1500ms';

select case when (select connected from conc_state)
  then throws_ok(
    $$select id from public.source_crosswalks
      where id = 'ccc80000-0000-4000-8000-00000000000b' for update$$,
    '55P03', null,
    'positive control: the second session genuinely holds a lock on the foreign row')
  else skip('dblink session unavailable in this environment', 1)
end;

-- THE ACTUAL TEST -----------------------------------------------------------------
-- As a workspace-A operator, ask to supersede using the LOCKED FOREIGN row as
-- the replacement. Authorization is part of the lookup, so the row is filtered
-- out before any FOR UPDATE applies: the call must fail fast with 42501 rather
-- than block on the lock and time out with 55P03.
select set_config('request.jwt.claim.sub', 'cc222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims',
  json_build_object('sub', 'cc222222-2222-4222-8222-222222222222',
                    'role', 'authenticated')::text, false);
create temp table conc_result (errcode text, elapsed_ms numeric);
grant all on table conc_result to public;

set role authenticated;

do $$
declare
  v_started timestamptz := clock_timestamp();
  v_code text := 'NO_ERROR';
begin
  begin
    perform public.supersede_source_crosswalk(
      'ccc80000-0000-4000-8000-00000000000a'::uuid,
      'ccc80000-0000-4000-8000-00000000000b'::uuid);
  exception when others then
    v_code := sqlstate;
  end;
  insert into conc_result
  values (v_code, extract(epoch from (clock_timestamp() - v_started)) * 1000);
end $$;

reset role;

select case when (select connected from conc_state)
  then is((select errcode from conc_result), '42501',
    'a foreign replacement row is refused as unauthorized, not blocked on its lock')
  else skip('dblink session unavailable in this environment', 1)
end;

select case when (select connected from conc_state)
  then ok((select elapsed_ms from conc_result) < 1000,
    'the refusal returned well inside lock_timeout, so the foreign row was never locked')
  else skip('dblink session unavailable in this environment', 1)
end;

-- The foreign row is untouched -------------------------------------------------------
reset lock_timeout;

select case when (select connected from conc_state)
  then is(
    (select review_state::text from public.source_crosswalks
     where id = 'ccc80000-0000-4000-8000-00000000000b'),
    'candidate',
    'the foreign crosswalk was neither read into a decision nor modified')
  else skip('dblink session unavailable in this environment', 1)
end;

select is(
  (select review_state::text from public.source_crosswalks
   where id = 'ccc80000-0000-4000-8000-00000000000a'),
  'candidate',
  'the caller''s own row was left untouched by the refused supersession');

-- Release the second session ------------------------------------------------------------
do $$
begin
  if (select connected from conc_state) then
    perform dblink_exec('holder', 'rollback');
    perform dblink_disconnect('holder');
  end if;
exception when others then
  null;
end $$;

-- Teardown ---------------------------------------------------------------------------------
-- Append-only triggers refuse DELETE by design, so removing this file's own
-- committed fixtures requires disabling them for the duration. That is exactly
-- the schema-level superuser action documented in migration 7 as outside the
-- application threat boundary; it is available here only because this test runs
-- as the owning role.
alter table public.source_records disable trigger source_records_append_only;
alter table public.audit_events disable trigger audit_events_append_only;

update public.source_crosswalks
set superseded_by_id = null, supersedes_id = null
where workspace_id in ('cca00000-0000-4000-8000-000000000001',
                       'ccb00000-0000-4000-8000-000000000001');

delete from public.audit_events
where workspace_id in ('cca00000-0000-4000-8000-000000000001',
                       'ccb00000-0000-4000-8000-000000000001');
delete from public.source_crosswalks
where workspace_id in ('cca00000-0000-4000-8000-000000000001',
                       'ccb00000-0000-4000-8000-000000000001');
delete from public.data_quality_issues
where workspace_id in ('cca00000-0000-4000-8000-000000000001',
                       'ccb00000-0000-4000-8000-000000000001');
delete from public.external_identifiers
where workspace_id in ('cca00000-0000-4000-8000-000000000001',
                       'ccb00000-0000-4000-8000-000000000001');
delete from public.source_records
where workspace_id in ('cca00000-0000-4000-8000-000000000001',
                       'ccb00000-0000-4000-8000-000000000001');
delete from public.import_jobs
where workspace_id in ('cca00000-0000-4000-8000-000000000001',
                       'ccb00000-0000-4000-8000-000000000001');
delete from public.source_systems
where workspace_id in ('cca00000-0000-4000-8000-000000000001',
                       'ccb00000-0000-4000-8000-000000000001');
-- Membership rows are removed by the workspace delete cascading, not directly:
-- deleting the last owner outright trips the Phase 2 last-owner guard.
delete from public.workspaces
where id in ('cca00000-0000-4000-8000-000000000001',
             'ccb00000-0000-4000-8000-000000000001');
delete from auth.users
where id in ('cc111111-1111-4111-8111-111111111111',
             'cc222222-2222-4222-8222-222222222222',
             'cc444444-4444-4444-8444-444444444444');

alter table public.source_records enable trigger source_records_append_only;
alter table public.audit_events enable trigger audit_events_append_only;

-- Teardown left nothing behind ------------------------------------------------------------------
select is(
  (select count(*)::int from public.import_jobs
   where workspace_id in ('cca00000-0000-4000-8000-000000000001',
                          'ccb00000-0000-4000-8000-000000000001')),
  0,
  'the concurrency fixtures were fully removed');

select is(
  (select count(*)::int from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   where c.relname in ('source_records', 'audit_events')
     and t.tgname like '%append_only%'
     and t.tgenabled = 'D'),
  0,
  'the append-only triggers are re-enabled after teardown');

select * from finish();
