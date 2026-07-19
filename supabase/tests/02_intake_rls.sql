-- Intake/configuration RLS: viewer read-only, operator intake work in her own
-- workspace only, owner-only configuration writes, cross-workspace isolation,
-- and the constraint layer (composite FKs, public-ID uniqueness, photo paths).
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
  ('44444444-4444-4444-4444-444444444444', 'zoe@example.test');

insert into public.workspaces (id, name, sku_prefix, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Workspace A', 'RV-N-', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Workspace B', 'BW-', '44444444-4444-4444-4444-444444444444');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'operator'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

insert into public.sessions (id, workspace_id, public_id, label, created_by) values
  ('a5e55a01-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SESS-A1', 'Session A1', '11111111-1111-1111-1111-111111111111'),
  ('b5e55b01-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SESS-B1', 'Session B1', '44444444-4444-4444-4444-444444444444');

insert into public.intake_groups (id, workspace_id, session_id, public_id, label, quantity_expected, created_by) values
  ('a6e00a01-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5e55a01-0000-4000-8000-000000000001', 'GRP-A1', 'Group A1', 5, '11111111-1111-1111-1111-111111111111');

insert into public.items (id, workspace_id, session_id, intake_group_id, sku, name, created_by) values
  ('a17e0a01-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5e55a01-0000-4000-8000-000000000001', null, 'RV-N-000001', 'Item A1', '11111111-1111-1111-1111-111111111111'),
  ('b17e0b01-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b5e55b01-0000-4000-8000-000000000001', null, 'BW-000001', 'Item B1', '44444444-4444-4444-4444-444444444444');

insert into public.photos (id, workspace_id, item_id, storage_path, created_by) values
  ('90070a01-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a17e0a01-0000-4000-8000-000000000001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a17e0a01-0000-4000-8000-000000000001/front.jpg', '11111111-1111-1111-1111-111111111111');

insert into public.reference_lists (id, workspace_id, list_key, label) values
  ('11570a01-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'conditions', 'Conditions');

insert into public.photo_requirements (workspace_id, code, label, min_count) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'front_photo', 'Front photo', 1);

-- Anonymous -------------------------------------------------------------------
select pg_temp.login_anon();
select throws_ok($$ select count(*) from public.sessions $$, '42501', null, 'anon cannot read sessions');
select throws_ok($$ select count(*) from public.items $$, '42501', null, 'anon cannot read items');
select throws_ok($$ select count(*) from public.photos $$, '42501', null, 'anon cannot read photos');
select throws_ok($$ select count(*) from public.reference_lists $$, '42501', null, 'anon cannot read reference_lists');
select pg_temp.logout();

-- Viewer: reads her workspace, writes nothing ---------------------------------
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.sessions), 1, 'viewer reads her sessions');
select is((select count(*)::int from public.items), 1, 'viewer reads her items');
select is((select count(*)::int from public.photos), 1, 'viewer reads her photos');
select is((select count(*)::int from public.photo_requirements), 1, 'viewer reads photo requirements');
select is((select count(*)::int from public.reference_lists), 1, 'viewer reads reference lists');
select throws_ok(
  $$ insert into public.sessions (workspace_id, public_id, created_by)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SESS-A9', '33333333-3333-3333-3333-333333333333') $$,
  '42501', null, 'viewer cannot create sessions');
select throws_ok(
  $$ insert into public.photos (workspace_id, item_id, storage_path, created_by)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a17e0a01-0000-4000-8000-000000000001',
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a17e0a01-0000-4000-8000-000000000001/viewer.jpg',
             '33333333-3333-3333-3333-333333333333') $$,
  '42501', null, 'viewer cannot add photos');
update public.items set name = 'Renamed by viewer' where id = 'a17e0a01-0000-4000-8000-000000000001';
delete from public.photos where id = '90070a01-0000-4000-8000-000000000001';
select pg_temp.logout();
select is(
  (select name from public.items where id = 'a17e0a01-0000-4000-8000-000000000001'),
  'Item A1', 'viewer update had no effect');
select is((select count(*)::int from public.photos), 1, 'viewer delete had no effect');

-- Operator: ordinary intake work in her workspace only ------------------------
select pg_temp.login('22222222-2222-2222-2222-222222222222');
insert into public.sessions (id, workspace_id, public_id, created_by)
values ('a5e55a02-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SESS-A2', '22222222-2222-2222-2222-222222222222');
insert into public.items (workspace_id, session_id, sku, name, created_by)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5e55a02-0000-4000-8000-000000000002', 'RV-N-000002', 'Item A2', '22222222-2222-2222-2222-222222222222');
update public.items set name = 'Item A1 (checked)' where id = 'a17e0a01-0000-4000-8000-000000000001';
select is(
  (select name from public.items where id = 'a17e0a01-0000-4000-8000-000000000001'),
  'Item A1 (checked)', 'operator can update items in her workspace');

select throws_ok(
  $$ insert into public.sessions (workspace_id, public_id, created_by)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SESS-B9', '22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'operator cannot create sessions in workspace B');
select throws_ok(
  $$ insert into public.sessions (workspace_id, public_id, created_by)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SESS-A8', '11111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'operator cannot forge created_by');
select is((select count(*)::int from public.sessions where workspace_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0,
  'operator cannot read workspace B sessions');

-- Configuration stays owner-only.
select throws_ok(
  $$ insert into public.reference_lists (workspace_id, list_key, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'grades', 'Grades') $$,
  '42501', null, 'operator cannot create reference lists');
select throws_ok(
  $$ insert into public.photo_requirements (workspace_id, code, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'back_photo', 'Back photo') $$,
  '42501', null, 'operator cannot create photo requirements');
select throws_ok(
  $$ insert into public.field_registry (workspace_id, field_key, label, data_type)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'op_field', 'Operator field', 'text') $$,
  '42501', null, 'operator cannot register fields');
select pg_temp.logout();

-- Owner: configuration administration ------------------------------------------
select pg_temp.login('11111111-1111-1111-1111-111111111111');
insert into public.photo_requirements (workspace_id, code, label, min_count)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'back_photo', 'Back photo', 1);
insert into public.reference_options (workspace_id, list_id, value, label)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11570a01-0000-4000-8000-000000000001', 'mint', 'Mint');
insert into public.field_registry (workspace_id, field_key, label, data_type)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'grade_notes', 'Grade notes', 'text');
select is((select count(*)::int from public.photo_requirements), 2, 'owner manages photo requirements');
select is((select count(*)::int from public.reference_options), 1, 'owner manages reference options');
select pg_temp.logout();

-- Cross-workspace isolation ----------------------------------------------------
select pg_temp.login('44444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.sessions where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0,
  'zoe reads no workspace A sessions');
select is((select count(*)::int from public.items where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0,
  'zoe reads no workspace A items');
select is((select count(*)::int from public.photos), 0, 'zoe reads no workspace A photos');
select is((select count(*)::int from public.reference_lists), 0, 'zoe reads no workspace A reference lists');
update public.items set name = 'Taken by Zoe' where id = 'a17e0a01-0000-4000-8000-000000000001';
select pg_temp.logout();
select is(
  (select name from public.items where id = 'a17e0a01-0000-4000-8000-000000000001'),
  'Item A1 (checked)', 'zoe cannot mutate workspace A items');

-- Constraint layer (checked as owner role; RLS is not the only defense) --------

-- Cross-workspace relationships are impossible even when RLS is bypassed.
select throws_ok(
  $$ insert into public.intake_groups (workspace_id, session_id, public_id, label, quantity_expected, created_by)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a5e55a01-0000-4000-8000-000000000001', 'GRP-X', 'Cross', 1,
             '44444444-4444-4444-4444-444444444444') $$,
  '23503', null, 'group cannot reference a session in another workspace');
select throws_ok(
  $$ insert into public.items (workspace_id, session_id, intake_group_id, sku, created_by)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b5e55b01-0000-4000-8000-000000000001',
             'a6e00a01-0000-4000-8000-000000000001', 'BW-000009', '44444444-4444-4444-4444-444444444444') $$,
  '23503', null, 'item cannot reference a group in another workspace');
select throws_ok(
  $$ insert into public.photos (workspace_id, item_id, storage_path, created_by)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a17e0a01-0000-4000-8000-000000000001',
             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/a17e0a01-0000-4000-8000-000000000001/x.jpg',
             '44444444-4444-4444-4444-444444444444') $$,
  '23503', null, 'photo cannot reference an item in another workspace');

-- Photo storage paths must live in the owning workspace and item folder.
select throws_ok(
  $$ insert into public.photos (workspace_id, item_id, storage_path, created_by)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a17e0a01-0000-4000-8000-000000000001',
             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/a17e0a01-0000-4000-8000-000000000001/x.jpg',
             '11111111-1111-1111-1111-111111111111') $$,
  '23514', null, 'photo path must start with its own workspace id');
select throws_ok(
  $$ insert into public.photos (workspace_id, item_id, storage_path, created_by)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a17e0a01-0000-4000-8000-000000000001',
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/b17e0b01-0000-4000-8000-000000000001/x.jpg',
             '11111111-1111-1111-1111-111111111111') $$,
  '23514', null, 'photo path must use its own item folder');

-- Public business identifiers: unique per workspace, reusable across workspaces.
select throws_ok(
  $$ insert into public.sessions (workspace_id, public_id, created_by)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SESS-A1', '11111111-1111-1111-1111-111111111111') $$,
  '23505', null, 'session public_id is unique per workspace');
select lives_ok(
  $$ insert into public.sessions (workspace_id, public_id, created_by)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SESS-A1', '44444444-4444-4444-4444-444444444444') $$,
  'the same public_id may exist in a different workspace');
select throws_ok(
  $$ insert into public.items (workspace_id, session_id, sku, created_by)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a5e55a01-0000-4000-8000-000000000001', 'RV-N-000001',
             '11111111-1111-1111-1111-111111111111') $$,
  '23505', null, 'item sku is unique per workspace');
select lives_ok(
  $$ insert into public.items (workspace_id, session_id, sku, created_by)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b5e55b01-0000-4000-8000-000000000001', 'RV-N-000001',
             '44444444-4444-4444-4444-444444444444') $$,
  'the same sku may exist in a different workspace');

select * from finish();
rollback;
