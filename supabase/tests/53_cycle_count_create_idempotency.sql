-- Creating a cycle count is idempotent, and the non-idempotent path is closed.
--
-- The button an operator presses to start a count is exactly the case that
-- produces a retry after a lost response. Without a key held by the DATABASE,
-- that retry opens a second draft session over the same shelf, and the operator
-- discovers it only when two counts disagree.
begin;
create extension if not exists pgtap with schema public;
select no_plan();

create or replace function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.put(k text, v uuid) returns void language plpgsql as $$
begin perform set_config('pgtmp.' || k, coalesce(v::text, ''), true); end $$;
create or replace function pg_temp.get(k text) returns uuid language sql stable as $$
  select nullif(current_setting('pgtmp.' || k, true), '')::uuid
$$;

insert into auth.users (id, email) values
  ('fd011111-1111-4111-8111-111111111111', 'cc-owner@test.local'),
  ('fd022222-2222-4222-8222-222222222222', 'cc-operator@test.local'),
  ('fd033333-3333-4333-8333-333333333333', 'cc-viewer@test.local'),
  ('fd044444-4444-4444-8444-444444444444', 'cc-outsider@test.local');
insert into public.workspaces (id, name, created_by)
  values ('fd000000-0000-4000-8000-000000000001', 'Cycle count WS',
          'fd011111-1111-4111-8111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('fd000000-0000-4000-8000-000000000001', 'fd022222-2222-4222-8222-222222222222', 'operator'),
  ('fd000000-0000-4000-8000-000000000001', 'fd033333-3333-4333-8333-333333333333', 'viewer');

select pg_temp.login('fd011111-1111-4111-8111-111111111111');
select public.register_storage_location('fd000000-0000-4000-8000-000000000001', 'BIN-I', null, 'Bin');

-- The key is required -------------------------------------------------------------
select throws_ok(
  $$select public.create_cycle_count_session(
      'fd000000-0000-4000-8000-000000000001', 'BIN-I', null)$$,
  '23514', null,
  'a cycle count cannot be created without an idempotency key');

-- The first attempt creates -------------------------------------------------------
select pg_temp.put('first', (public.create_cycle_count_session(
  'fd000000-0000-4000-8000-000000000001', 'BIN-I',
  'fd0aaaaa-0001-4000-8000-000000000001'::uuid, false, null, null, true,
  'first attempt')->>'id')::uuid);

select is(
  (public.create_cycle_count_session(
    'fd000000-0000-4000-8000-000000000001', 'BIN-I',
    'fd0aaaaa-0002-4000-8000-000000000001'::uuid))->>'outcome',
  'created',
  'a fresh key creates a new session');

-- THE REGRESSION ------------------------------------------------------------------
-- The same key twice is the lost-response retry, and it must not open a second
-- count over the same shelf.
select is(
  (public.create_cycle_count_session(
    'fd000000-0000-4000-8000-000000000001', 'BIN-I',
    'fd0aaaaa-0001-4000-8000-000000000001'::uuid, false, null, null, true,
    'first attempt'))->>'outcome',
  'idempotent_replay',
  'replaying the same key reports a replay rather than creating again');

select is(
  (public.create_cycle_count_session(
    'fd000000-0000-4000-8000-000000000001', 'BIN-I',
    'fd0aaaaa-0001-4000-8000-000000000001'::uuid, false, null, null, true,
    'first attempt'))->>'id',
  pg_temp.get('first')::text,
  'and returns the session the first attempt created');

select is(
  (select count(*)::int from public.cycle_count_sessions
    where workspace_id = 'fd000000-0000-4000-8000-000000000001'
      and idempotency_key = 'fd0aaaaa-0001-4000-8000-000000000001'::uuid),
  1,
  'exactly one session exists for that key, however many times it was sent');

-- A replay must not be confused with a different scope. The key identifies the
-- request; the first request's scope is what was actually recorded.
select is(
  (select notes from public.cycle_count_sessions where id = pg_temp.get('first')),
  'first attempt',
  'a replay does not overwrite the session it returns');

-- The non-idempotent path is closed ------------------------------------------------
select ok(
  not has_function_privilege('authenticated',
    'public.create_cycle_count(uuid, text, boolean, public.inventory_subtype, public.inventory_vertical, boolean, text)',
    'execute'),
  'the non-idempotent create is not executable by an application role');
select ok(
  not has_function_privilege('anon',
    'public.create_cycle_count(uuid, text, boolean, public.inventory_subtype, public.inventory_vertical, boolean, text)',
    'execute'),
  'nor by anon');

-- It is revoked, not dropped: a hosted database that already has it is left
-- alone, and nothing that referenced it breaks at migration time.
select has_function('public'::name, 'create_cycle_count'::name,
  'the deprecated function still exists, revoked rather than dropped');

-- Authority ------------------------------------------------------------------------
select pg_temp.login('fd022222-2222-4222-8222-222222222222');
select isnt(
  (public.create_cycle_count_session(
    'fd000000-0000-4000-8000-000000000001', 'BIN-I',
    'fd0aaaaa-0003-4000-8000-000000000001'::uuid))->>'id',
  null,
  'an operator may create a cycle count');

select pg_temp.login('fd033333-3333-4333-8333-333333333333');
select throws_ok(
  $$select public.create_cycle_count_session(
      'fd000000-0000-4000-8000-000000000001', 'BIN-I',
      'fd0aaaaa-0004-4000-8000-000000000001'::uuid)$$,
  '42501', null,
  'a viewer cannot create a cycle count');

-- Workspace isolation: a key is scoped to its workspace, so an outsider cannot
-- probe for one, and the same key in another workspace is a different request.
select pg_temp.login('fd044444-4444-4444-8444-444444444444');
select throws_ok(
  $$select public.create_cycle_count_session(
      'fd000000-0000-4000-8000-000000000001', 'BIN-I',
      'fd0aaaaa-0001-4000-8000-000000000001'::uuid)$$,
  '42501', null,
  'somebody outside the workspace cannot replay its key');

-- Blind counting defaults on -------------------------------------------------------
-- The old function defaulted blind_count to false. A count that shows expected
-- quantities is not a count, so the governed default is now true.
select pg_temp.login('fd011111-1111-4111-8111-111111111111');
select pg_temp.put('default_blind', (public.create_cycle_count_session(
  'fd000000-0000-4000-8000-000000000001', 'BIN-I',
  'fd0aaaaa-0005-4000-8000-000000000001'::uuid)->>'id')::uuid);
select is(
  (select blind_count from public.cycle_count_sessions where id = pg_temp.get('default_blind')),
  true,
  'a cycle count is blind unless the operator deliberately says otherwise');

-- THE BLIND-COUNT BOUNDARY --------------------------------------------------------
-- start_cycle_count returned expected item/lot/unit counts to every caller.
-- The Express route deleted those fields, but the browser transport calls this
-- function directly, so a boundary enforced in one transport was not one.
select pg_temp.put('blind_session', (public.create_cycle_count_session(
  'fd000000-0000-4000-8000-000000000001', 'BIN-I',
  'fd0aaaaa-0006-4000-8000-000000000001'::uuid, false, null, null, true,
  'blind')->>'id')::uuid);

select is(
  (select count(*)::int from jsonb_object_keys(
     public.start_cycle_count('fd000000-0000-4000-8000-000000000001',
       pg_temp.get('blind_session'))) k
    where k in ('expected_item_count', 'expected_lot_count', 'expected_unit_count')),
  0,
  'starting a blind count reveals no expected item, lot or unit total');

-- An openly-declared non-blind count still reports its scope, because that is
-- what the operator asked for.
select pg_temp.put('open_session', (public.create_cycle_count_session(
  'fd000000-0000-4000-8000-000000000001', 'BIN-I',
  'fd0aaaaa-0007-4000-8000-000000000001'::uuid, false, null, null, false,
  'not blind')->>'id')::uuid);

select is(
  (select count(*)::int from jsonb_object_keys(
     public.start_cycle_count('fd000000-0000-4000-8000-000000000001',
       pg_temp.get('open_session'))) k
    where k in ('expected_item_count', 'expected_lot_count', 'expected_unit_count')),
  3,
  'a deliberately non-blind count still reports the scope it was asked for');

select * from finish();
rollback;
