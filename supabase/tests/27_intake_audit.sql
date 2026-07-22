-- Phase 6A intake kernel — the append-only audit trail records every governed
-- event: draft creation, transition, candidate evidence, commit, abandon,
-- failure/conflict.
begin;
create extension if not exists pgtap;
select no_plan();

create function pg_temp.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; end $$;

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@a.test'),
  ('a2222222-2222-2222-2222-222222222222', 'op@a.test');
insert into public.workspaces (id, name, created_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'WS A', 'a1111111-1111-1111-1111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'operator');
set session_replication_role = replica;
insert into public.acquisition_line_items
  (id, workspace_id, public_id, source_system_id, source_record_id,
   acquisition_import_job_id, quantity, created_by_process)
values ('acacacac-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
   'WN-A-000001', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'test.fixture');
set session_replication_role = origin;

select pg_temp.login('a2222222-2222-2222-2222-222222222222');
create temp table t (k text primary key, v text);
insert into t values ('ws', 'aaaa0000-0000-4000-8000-000000000001');
insert into t values ('sess', (public.create_intake_session((select v from t where k='ws')::uuid, 's')->>'id'));

create function pg_temp.evt(g uuid, etype text) returns int language sql as $$
  select count(*)::int from public.intake_transition_events where group_id = g and event_type = etype; $$;

-- session_created
select is((select count(*)::int from public.intake_transition_events
           where session_id = (select v from t where k='sess')::uuid and event_type='session_created'),
  1, 'session creation is audited');

-- group_created + entry_updated + candidate_attached
insert into t values ('g', (public.upsert_intake_group((select v from t where k='ws')::uuid,
  (select v from t where k='sess')::uuid, null, 'graded_tcg', 'Charizard Base #4', 1, 'serialized', 1,
  '{"set_name":"Base Set","card_number":"4"}'::jsonb,
  '{"grading_company":"PSA","numeric_grade":"10","product_format":"Graded slab"}'::jsonb,
  'stated', null, 'BIN-1', false, false, false)->>'id'));
select is(pg_temp.evt((select v from t where k='g')::uuid, 'group_created'), 1, 'group creation is audited');
select public.upsert_intake_entry((select v from t where k='ws')::uuid,
  (select v from t where k='g')::uuid, 1, 'PSA', '10', null, 'PSA-90001', null, '{}');
select is(pg_temp.evt((select v from t where k='g')::uuid, 'entry_updated'), 1, 'entry edits are audited');
select public.attach_intake_candidate((select v from t where k='ws')::uuid,
  (select v from t where k='g')::uuid, 'acacacac-0000-4000-8000-000000000001'::uuid, null, 'low', '{}');
select is(pg_temp.evt((select v from t where k='g')::uuid, 'candidate_attached'), 1,
  'candidate attachment is audited');

-- readiness -> state_transition
select public.validate_intake_readiness((select v from t where k='ws')::uuid, (select v from t where k='g')::uuid);
select ok(pg_temp.evt((select v from t where k='g')::uuid, 'state_transition') >= 1,
  'a draft->ready state transition is audited');

-- commit
select public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='g')::uuid,
  'audit-key-0001', (select version from public.intake_draft_groups where id=(select v from t where k='g')::uuid),
  (public.preview_intake_commit((select v from t where k='ws')::uuid, (select v from t where k='g')::uuid)->>'content_hash'));
select is(pg_temp.evt((select v from t where k='g')::uuid, 'commit'), 1, 'the commit is audited');

-- commit_conflict: a second commit under a different key on the committed group
-- returns a structured conflict AND leaves a durable audit event.
select is(
  (public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='g')::uuid,
    'audit-key-0002', 1, 'x'))->>'outcome', 'conflict',
  'a conflicting second commit returns a structured conflict');
select is(pg_temp.evt((select v from t where k='g')::uuid, 'commit_conflict'), 1,
  'the commit conflict is audited');

-- abandon (a separate draft)
insert into t values ('g2', (public.upsert_intake_group((select v from t where k='ws')::uuid,
  (select v from t where k='sess')::uuid, null, 'raw_tcg', 'To Abandon', 1, 'lot_managed', 0,
  '{}'::jsonb, '{}'::jsonb, 'stated', 'Near Mint', 'BIN-1', false, false, false)->>'id'));
select public.transition_intake_group((select v from t where k='ws')::uuid,
  (select v from t where k='g2')::uuid, 'abandoned', '{"reason":"duplicate scan"}'::jsonb);
select is(pg_temp.evt((select v from t where k='g2')::uuid, 'abandon'), 1, 'abandonment is audited');

-- Every event carries workspace, actor, and a monotonic sequence.
select is((select count(*)::int from public.intake_transition_events
           where workspace_id=(select v from t where k='ws')::uuid and event_seq is not null
             and actor_user_id = 'a2222222-2222-2222-2222-222222222222'),
          (select count(*)::int from public.intake_transition_events
           where workspace_id=(select v from t where k='ws')::uuid),
  'every audit event carries the workspace, actor, and a sequence');

select * from finish();
rollback;
