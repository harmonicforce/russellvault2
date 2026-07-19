-- Workspace and membership RLS: anonymous denial, non-member denial, viewer
-- read-only, owner administration, cross-workspace isolation, last-owner
-- protection.
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

-- Fixtures (applied as the table owner, bypassing RLS) ------------------------
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

-- Workspace creation bootstrap ------------------------------------------------
select is(
  (select count(*)::int from public.workspace_members
   where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and user_id = '11111111-1111-1111-1111-111111111111' and role = 'owner'),
  1,
  'creating a workspace makes the creator its owner'
);

-- Anonymous: no access at all -------------------------------------------------
select pg_temp.login_anon();
select throws_ok(
  $$ select count(*) from public.workspaces $$,
  '42501', null, 'anon cannot select workspaces');
select throws_ok(
  $$ select count(*) from public.workspace_members $$,
  '42501', null, 'anon cannot select workspace_members');
select throws_ok(
  $$ insert into public.workspaces (name, created_by)
     values ('Anon WS', '55555555-5555-5555-5555-555555555555') $$,
  '42501', null, 'anon cannot insert workspaces');
select pg_temp.logout();

-- Authenticated non-member: sees nothing, cannot join himself -----------------
select pg_temp.login('55555555-5555-5555-5555-555555555555');
select is((select count(*)::int from public.workspaces), 0, 'non-member sees no workspaces');
select is((select count(*)::int from public.workspace_members), 0, 'non-member sees no memberships');
select throws_ok(
  $$ insert into public.workspace_members (workspace_id, user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'owner') $$,
  '42501', null, 'non-member cannot grant himself membership');
select throws_ok(
  $$ insert into public.workspaces (name, created_by)
     values ('Fake', '11111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'cannot create a workspace on behalf of another user');

-- ...but may create his own workspace and becomes its owner.
insert into public.workspaces (id, name, created_by)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Nate WS', '55555555-5555-5555-5555-555555555555');
select is((select count(*)::int from public.workspaces), 1, 'creator sees his new workspace');
select is(
  (select role::text from public.workspace_members
   where workspace_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     and user_id = '55555555-5555-5555-5555-555555555555'),
  'owner',
  'creator is owner of his new workspace'
);
select pg_temp.logout();

-- Viewer: read-only -----------------------------------------------------------
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.workspaces), 1, 'viewer sees exactly her workspace');
select is(
  (select count(*)::int from public.workspace_members
   where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  3,
  'viewer can read her workspace roster');
update public.workspaces set name = 'Hacked by viewer' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select throws_ok(
  $$ insert into public.workspace_members (workspace_id, user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'viewer') $$,
  '42501', null, 'viewer cannot add members');
delete from public.workspace_members
  where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id = '22222222-2222-2222-2222-222222222222';
select pg_temp.logout();
select is(
  (select name from public.workspaces where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Workspace A',
  'viewer update had no effect');
select is(
  (select count(*)::int from public.workspace_members
   where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  3,
  'viewer delete had no effect');

-- Operator: cannot administer membership --------------------------------------
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ insert into public.workspace_members (workspace_id, user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'operator') $$,
  '42501', null, 'operator cannot add members');
update public.workspace_members set role = 'owner'
  where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id = '22222222-2222-2222-2222-222222222222';
select pg_temp.logout();
select is(
  (select role::text from public.workspace_members
   where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     and user_id = '22222222-2222-2222-2222-222222222222'),
  'operator',
  'operator cannot escalate his own role');

-- Owner: administers workspace and membership ---------------------------------
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.workspaces set name = 'Workspace A (renamed)' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(
  (select name from public.workspaces where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Workspace A (renamed)',
  'owner can rename her workspace');
insert into public.workspace_members (workspace_id, user_id, role)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'viewer');
select is(
  (select count(*)::int from public.workspace_members
   where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  4,
  'owner can add a member');
delete from public.workspace_members
  where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id = '55555555-5555-5555-5555-555555555555';

-- Last-owner protection: the sole owner cannot demote or remove herself.
select throws_ok(
  $$ update public.workspace_members set role = 'viewer'
     where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and user_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514', null, 'sole owner cannot demote herself');
select throws_ok(
  $$ delete from public.workspace_members
     where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and user_id = '11111111-1111-1111-1111-111111111111' $$,
  '23514', null, 'sole owner cannot remove herself');
select pg_temp.logout();

-- Cross-workspace isolation: user A vs workspace B ----------------------------
select pg_temp.login('44444444-4444-4444-4444-444444444444');
select is(
  (select count(*)::int from public.workspaces), 1, 'zoe sees only workspace B');
select is(
  (select id from public.workspaces),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'the only workspace zoe sees is B');
select is(
  (select count(*)::int from public.workspace_members
   where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'zoe cannot read workspace A roster');
select throws_ok(
  $$ insert into public.workspace_members (workspace_id, user_id, role)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'owner') $$,
  '42501', null, 'zoe cannot grant herself membership in A');
update public.workspaces set name = 'Owned by Zoe' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select pg_temp.logout();
select is(
  (select name from public.workspaces where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Workspace A (renamed)',
  'zoe cannot mutate workspace A');

-- An owner can delete their own (empty) workspace: the membership cascade is
-- exempt from last-owner protection once the workspace row itself is gone.
select pg_temp.login('55555555-5555-5555-5555-555555555555');
select lives_ok(
  $$ delete from public.workspaces where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'owner deletes his own empty workspace');
select pg_temp.logout();
select is(
  (select count(*)::int from public.workspace_members
   where workspace_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0, 'memberships cascade away with the deleted workspace');

select * from finish();
rollback;
