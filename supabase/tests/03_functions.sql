-- SECURITY DEFINER functions: denial paths (anon, non-member, insufficient
-- role, cross-workspace) and success paths (mint, expand, safe delete, custom
-- fields), including proof that the definer functions cannot be used to reach
-- another workspace.
begin;
create extension if not exists pgtap;
select no_plan();

-- Impersonation helpers -------------------------------------------------------
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

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'vera@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'zoe@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'nate@example.test');

insert into public.workspaces (id, name, sku_prefix, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Workspace A', 'RV-N-', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Workspace B', 'BW-', '44444444-4444-4444-4444-444444444444');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'operator'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

insert into public.sessions (id, workspace_id, public_id, label, created_by) values
  ('a5e55a01-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SESS-A1', 'Open session', '11111111-1111-1111-1111-111111111111'),
  ('a5e55a02-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SESS-A2', 'Closed session', '11111111-1111-1111-1111-111111111111');
update public.sessions set status = 'closed', closed_at = now()
  where id = 'a5e55a02-0000-4000-8000-000000000002';

insert into public.intake_groups (id, workspace_id, session_id, public_id, label, quantity_expected, created_by) values
  ('a6e00a01-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5e55a01-0000-4000-8000-000000000001', 'GRP-A1', 'Slab box', 3, '11111111-1111-1111-1111-111111111111'),
  ('a6e00a02-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5e55a01-0000-4000-8000-000000000001', 'GRP-A2', 'Empty group', 1, '11111111-1111-1111-1111-111111111111'),
  ('a6e00a03-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5e55a02-0000-4000-8000-000000000002', 'GRP-A3', 'Closed-session group', 1, '11111111-1111-1111-1111-111111111111'),
  ('a6e00a04-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5e55a01-0000-4000-8000-000000000001', 'GRP-A4', 'Cancelled group', 1, '11111111-1111-1111-1111-111111111111');
update public.intake_groups set status = 'cancelled'
  where id = 'a6e00a04-0000-4000-8000-000000000004';

insert into public.reference_lists (id, workspace_id, list_key, label) values
  ('11570a01-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'conditions', 'Conditions'),
  ('11570b01-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b_conditions', 'B Conditions');

-- Anonymous execution is impossible -------------------------------------------
select pg_temp.login_anon();
select throws_ok(
  $$ select public.mint_sku('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null, 'anon cannot execute mint_sku');
select throws_ok(
  $$ select public.expand_intake_group('a6e00a01-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot execute expand_intake_group');
select throws_ok(
  $$ select public.delete_intake_group_safe('a6e00a02-0000-4000-8000-000000000002') $$,
  '42501', null, 'anon cannot execute delete_intake_group_safe');
select throws_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x_field', 'X', 'text') $$,
  '42501', null, 'anon cannot execute create_custom_field');
select pg_temp.logout();

-- mint_sku ---------------------------------------------------------------------
select pg_temp.login('55555555-5555-5555-5555-555555555555');
select throws_ok(
  $$ select public.mint_sku('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null, 'authenticated non-member cannot mint in workspace A');
select throws_ok(
  $$ select public.mint_sku('99999999-9999-4999-8999-999999999999') $$,
  '42501', null, 'nonexistent workspace looks identical to unauthorized');
select pg_temp.logout();

select pg_temp.login('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ select public.mint_sku('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null, 'viewer cannot mint SKUs');
select pg_temp.logout();

select pg_temp.login('22222222-2222-2222-2222-222222222222');
select is(public.mint_sku('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'RV-N-000001', 'operator mints first SKU');
select is(public.mint_sku('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 'RV-N-000002', 'SKU counter increments');
select throws_ok(
  $$ select public.mint_sku('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  '42501', null, 'operator of A cannot mint in workspace B');
select throws_ok(
  $$ select public.mint_sku(null) $$,
  '22023', null, 'mint_sku rejects null workspace id');
select pg_temp.logout();

select pg_temp.login('44444444-4444-4444-4444-444444444444');
select is(public.mint_sku('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 'BW-000001', 'workspace B has its own counter and prefix');
select pg_temp.logout();

-- expand_intake_group ----------------------------------------------------------
select pg_temp.login('44444444-4444-4444-4444-444444444444');
select throws_ok(
  $$ select public.expand_intake_group('a6e00a01-0000-4000-8000-000000000001') $$,
  '42501', null, 'owner of B cannot expand a group in A (definer cannot bypass membership)');
select pg_temp.logout();

select pg_temp.login('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ select public.expand_intake_group('a6e00a01-0000-4000-8000-000000000001') $$,
  '42501', null, 'viewer cannot expand groups');
select pg_temp.logout();

select pg_temp.login('22222222-2222-2222-2222-222222222222');
select is(
  array_length(public.expand_intake_group('a6e00a01-0000-4000-8000-000000000001'), 1),
  3, 'operator expands a pending group into 3 items');
select is(
  (select count(*)::int from public.items where intake_group_id = 'a6e00a01-0000-4000-8000-000000000001'),
  3, 'expansion created exactly 3 items');
select ok(
  (select bool_and(sku ~ '^RV-N-[0-9]{6}$')
   from public.items where intake_group_id = 'a6e00a01-0000-4000-8000-000000000001'),
  'expanded items carry workspace-minted SKUs');
select is(
  (select count(distinct sku)::int from public.items where intake_group_id = 'a6e00a01-0000-4000-8000-000000000001'),
  3, 'expanded SKUs are unique');
select is(
  (select status from public.intake_groups where id = 'a6e00a01-0000-4000-8000-000000000001'),
  'expanded', 'group status moves to expanded');
select throws_ok(
  $$ select public.expand_intake_group('a6e00a01-0000-4000-8000-000000000001') $$,
  '55000', null, 'a group cannot be expanded twice');
select throws_ok(
  $$ select public.expand_intake_group('a6e00a03-0000-4000-8000-000000000003') $$,
  '55000', null, 'a group in a closed session cannot be expanded');
select throws_ok(
  $$ select public.expand_intake_group('a6e00a04-0000-4000-8000-000000000004') $$,
  '55000', null, 'a cancelled group cannot be expanded');
select throws_ok(
  $$ select public.expand_intake_group('99999999-9999-4999-8999-999999999999') $$,
  '42501', null, 'a nonexistent group reads as not authorized');
select throws_ok(
  $$ select public.expand_intake_group(null) $$,
  '22023', null, 'expand rejects null input');
select pg_temp.logout();

-- delete_intake_group_safe -----------------------------------------------------
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ select public.delete_intake_group_safe('a6e00a02-0000-4000-8000-000000000002') $$,
  '42501', null, 'viewer cannot delete groups');
select pg_temp.logout();

select pg_temp.login('44444444-4444-4444-4444-444444444444');
select throws_ok(
  $$ select public.delete_intake_group_safe('a6e00a02-0000-4000-8000-000000000002') $$,
  '42501', null, 'owner of B cannot delete a group in A');
select pg_temp.logout();

select pg_temp.login('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select public.delete_intake_group_safe('a6e00a01-0000-4000-8000-000000000001') $$,
  '55000', null, 'a group with items refuses deletion');
select lives_ok(
  $$ select public.delete_intake_group_safe('a6e00a02-0000-4000-8000-000000000002') $$,
  'an empty pending group deletes cleanly');
select is(
  (select count(*)::int from public.intake_groups where id = 'a6e00a02-0000-4000-8000-000000000002'),
  0, 'the empty group is gone');
select is(
  (select count(*)::int from public.items where intake_group_id = 'a6e00a01-0000-4000-8000-000000000001'),
  3, 'items survived the refused deletion');
select pg_temp.logout();

-- create_custom_field ----------------------------------------------------------
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'op_field', 'Operator field', 'text') $$,
  '42501', null, 'operator cannot create custom fields (owner-only configuration)');
select pg_temp.logout();

select pg_temp.login('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'grade_notes', 'Grade notes', 'text') $$,
  'owner creates a text custom field');
select is(
  (select is_custom from public.field_registry
   where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and field_key = 'grade_notes'),
  true, 'the created field is marked custom');
select lives_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'condition_pick', 'Condition', 'reference',
       '11570a01-0000-4000-8000-000000000001') $$,
  'owner creates a reference field backed by a same-workspace list');
select throws_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'grade_notes', 'Duplicate', 'text') $$,
  '23505', null, 'duplicate field keys are rejected');
select throws_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bad Key!', 'Bad', 'text') $$,
  '22023', null, 'invalid field keys are rejected');
select throws_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'weird_type', 'Weird', 'jsonb') $$,
  '22023', null, 'unknown data types are rejected');
select throws_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ref_missing', 'Ref', 'reference') $$,
  '22023', null, 'reference fields require a list');
select throws_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ref_foreign', 'Ref', 'reference',
       '11570b01-0000-4000-8000-000000000001') $$,
  '22023', null, 'a reference list from another workspace is treated as nonexistent');
select throws_ok(
  $$ select public.create_custom_field('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text_with_list', 'T', 'text',
       '11570a01-0000-4000-8000-000000000001') $$,
  '22023', null, 'non-reference fields may not attach a list');
select throws_ok(
  $$ select public.create_custom_field('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a_field', 'A', 'text') $$,
  '42501', null, 'owner of A cannot configure workspace B');
select pg_temp.logout();

-- Anti-enumeration: a foreign group and a nonexistent group produce
-- byte-identical errors from both group functions, so a caller cannot use
-- them to probe whether an id exists in another workspace.
select pg_temp.login('44444444-4444-4444-4444-444444444444');
select throws_ok(
  $$ select public.expand_intake_group('a6e00a01-0000-4000-8000-000000000001') $$,
  '42501', 'intake group not found or not authorized',
  'expand: foreign existing group message');
select throws_ok(
  $$ select public.expand_intake_group('99999999-9999-4999-8999-999999999999') $$,
  '42501', 'intake group not found or not authorized',
  'expand: nonexistent group message is identical');
select throws_ok(
  $$ select public.delete_intake_group_safe('a6e00a01-0000-4000-8000-000000000001') $$,
  '42501', 'intake group not found or not authorized',
  'delete: foreign existing group message');
select throws_ok(
  $$ select public.delete_intake_group_safe('99999999-9999-4999-8999-999999999999') $$,
  '42501', 'intake group not found or not authorized',
  'delete: nonexistent group message is identical');
select pg_temp.logout();

select * from finish();
rollback;
