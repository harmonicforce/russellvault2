-- Phase 6A intake kernel — RLS: workspace isolation, viewer read-only, operator
-- role rules, and unauthorized receipt lookup fails closed.
begin;
create extension if not exists pgtap;
select no_plan();

create function pg_temp.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@a.test'),
  ('a2222222-2222-2222-2222-222222222222', 'op@a.test'),
  ('a3333333-3333-3333-3333-333333333333', 'view@a.test'),
  ('b2222222-2222-2222-2222-222222222222', 'op@b.test');
insert into public.workspaces (id, name, created_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'WS A', 'a1111111-1111-1111-1111-111111111111'),
  ('bbbb0000-0000-4000-8000-000000000002', 'WS B', 'b2222222-2222-2222-2222-222222222222');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'operator'),
  ('aaaa0000-0000-4000-8000-000000000001', 'a3333333-3333-3333-3333-333333333333', 'viewer');

-- Operator in A builds and commits a group.
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
create temp table t (k text primary key, v text);
grant all on table t to public;
insert into t values ('ws', 'aaaa0000-0000-4000-8000-000000000001');
insert into t values ('sess', (public.create_intake_session((select v from t where k='ws')::uuid, 's')->>'id'));
select public.register_storage_location((select v from t where k='ws')::uuid, 'BIN-1', null, 'Bin 1');
insert into t values ('g', (public.upsert_intake_group((select v from t where k='ws')::uuid,
  (select v from t where k='sess')::uuid, null, null, 'raw_tcg', 'Eevee Jungle #51', 1, 'lot_managed', 0,
  '{"set_name":"Jungle","card_number":"51"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-1',
  false, false, false, false)->>'id'));
insert into t values ('rc', (public.commit_intake_group((select v from t where k='ws')::uuid,
  (select v from t where k='g')::uuid, 'rls-key-0001',
  (select version from public.intake_draft_groups where id=(select v from t where k='g')::uuid),
  (public.preview_intake_commit((select v from t where k='ws')::uuid, (select v from t where k='g')::uuid)->>'content_hash')))::text);

-- Operator role rules: an operator can create + commit (proven above).
select is((select v from t where k='rc')::jsonb->>'idempotent_replay', 'false',
  'an operator committed a group in their own workspace');

-- A VIEWER may READ but may NOT mutate.
select pg_temp.login('a3333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.intake_draft_groups
           where workspace_id = 'aaaa0000-0000-4000-8000-000000000001'), 1,
  'a viewer can READ intake drafts in their workspace');
select throws_ok(
  $$select public.upsert_intake_group('aaaa0000-0000-4000-8000-000000000001',
    (select v from t where k='sess')::uuid, null, null, 'raw_tcg', 'x', 1, 'lot_managed', 0,
    '{}', '{}', '{}', null, null, false, false, false, false)$$,
  '42501', null, 'a viewer cannot create a draft group');
select throws_ok(
  $$select public.create_intake_session('aaaa0000-0000-4000-8000-000000000001', 'nope')$$,
  '42501', null, 'a viewer cannot open a session');
select throws_ok(
  format($$select public.commit_intake_group('aaaa0000-0000-4000-8000-000000000001', %L, 'k-000000009', 1, 'x')$$,
    (select v from t where k='g')),
  '42501', null, 'a viewer cannot commit');
-- A viewer may still read the committed receipt (member read).
select ok((public.get_intake_commit_receipt('aaaa0000-0000-4000-8000-000000000001',
  (select v from t where k='g')::uuid)->>'lot_public_id') is not null,
  'a viewer may read the immutable receipt in their workspace');

-- WORKSPACE ISOLATION: an operator of workspace B sees NOTHING of workspace A
-- and cannot read A's receipt.
select pg_temp.login('b2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.intake_draft_groups
           where workspace_id = 'aaaa0000-0000-4000-8000-000000000001'), 0,
  'a member of workspace B sees no workspace A drafts (RLS isolation)');
select is((select count(*)::int from public.intake_sessions
           where workspace_id = 'aaaa0000-0000-4000-8000-000000000001'), 0,
  'a member of workspace B sees no workspace A sessions');
select is((select count(*)::int from public.intake_commit_attempts
           where workspace_id = 'aaaa0000-0000-4000-8000-000000000001'), 0,
  'a member of workspace B sees no workspace A receipts');
select is((select count(*)::int from public.intake_transition_events
           where workspace_id = 'aaaa0000-0000-4000-8000-000000000001'), 0,
  'a member of workspace B sees no workspace A audit events');
-- Unauthorized receipt lookup fails closed (not a silent empty).
select throws_ok(
  format($$select public.get_intake_commit_receipt('aaaa0000-0000-4000-8000-000000000001', %L)$$,
    (select v from t where k='g')),
  '42501', null, 'an unauthorized receipt lookup fails closed');
select throws_ok(
  format($$select public.evaluate_intake_field_rules('aaaa0000-0000-4000-8000-000000000001', %L)$$,
    (select v from t where k='g')),
  '42501', null, 'an unauthorized rule evaluation fails closed');

-- anon sees nothing at all: it lacks even the SELECT grant, so a read is denied
-- outright rather than silently filtered.
select pg_temp.logout();
set local role anon;
select throws_ok(
  $$select count(*) from public.intake_draft_groups$$,
  '42501', null, 'anon is denied any read of intake drafts');
reset role;

select * from finish();
rollback;
