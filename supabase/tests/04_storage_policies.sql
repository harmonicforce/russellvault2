-- Storage policy isolation: the intake-evidence bucket is private, uploads are
-- forced into the caller's own workspace folder, and no path crosses
-- workspaces. Runs against the storage schema provided by the local Supabase
-- stack or by the plain-postgres shim (scripts/db/shim).
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

-- Tolerant anon probe: "no access" may surface as zero visible rows (real
-- Supabase grants + no policy) or as a permission error (shim grants nothing).
create function pg_temp.anon_visible_objects() returns bigint language plpgsql as $$
declare c bigint;
begin
  select count(*) into c from storage.objects;
  return c;
exception when insufficient_privilege then
  return 0;
end $$;

-- Fixtures --------------------------------------------------------------------
select is((to_regclass('storage.objects') is not null), true, 'storage schema is present for this test run');

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

insert into storage.buckets (id, name, public)
values ('intake-evidence', 'intake-evidence', false);

insert into storage.objects (bucket_id, name) values
  ('intake-evidence', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a17e0a01-0000-4000-8000-000000000001/front.jpg'),
  ('intake-evidence', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/b17e0b01-0000-4000-8000-000000000001/front.jpg');

-- The bucket convention is private --------------------------------------------
select is(
  (select public from storage.buckets where id = 'intake-evidence'),
  false, 'the intake-evidence bucket convention is private');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and 'anon' = any(roles)),
  0, 'no storage policy applies to anon');

-- Anonymous -------------------------------------------------------------------
select pg_temp.login_anon();
select is(pg_temp.anon_visible_objects(), 0::bigint, 'anon sees no storage objects');
select pg_temp.logout();

-- Members read only their own workspace folder --------------------------------
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from storage.objects), 1,
  'viewer sees only her workspace objects');
select is(
  (select count(*)::int from storage.objects
   where name like 'bbbbbbbb%'), 0,
  'viewer sees nothing from workspace B');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('intake-evidence',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a17e0a01-0000-4000-8000-000000000001/viewer.jpg') $$,
  '42501', null, 'viewer cannot upload');
select pg_temp.logout();

-- Operator uploads into her own workspace folder only -------------------------
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('intake-evidence',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a17e0a01-0000-4000-8000-000000000001/back.jpg') $$,
  'operator uploads into her workspace folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('intake-evidence',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/b17e0b01-0000-4000-8000-000000000001/hack.jpg') $$,
  '42501', null, 'operator cannot upload into workspace B''s folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('intake-evidence', 'not-a-workspace/whatever.jpg') $$,
  '42501', null, 'malformed paths are rejected');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('intake-evidence',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/loose-file.jpg') $$,
  '42501', null, 'paths must include an item folder');

-- Operator cannot delete evidence (owner-only).
delete from storage.objects
  where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a17e0a01-0000-4000-8000-000000000001/front.jpg';
select pg_temp.logout();
select is(
  (select count(*)::int from storage.objects
   where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a17e0a01-0000-4000-8000-000000000001/front.jpg'),
  1, 'operator delete had no effect (evidence deletion is owner-only)');

-- Cross-workspace reads and writes are impossible ------------------------------
select pg_temp.login('44444444-4444-4444-4444-444444444444');
select is(
  (select count(*)::int from storage.objects where name like 'aaaaaaaa%'), 0,
  'workspace B owner sees nothing from workspace A');
update storage.objects set name = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/steal/front.jpg'
  where name like 'aaaaaaaa%';
select pg_temp.logout();
select is(
  (select count(*)::int from storage.objects where name like 'aaaaaaaa%'), 2,
  'workspace A objects were untouched by workspace B owner');

-- Owner may delete evidence in her own workspace -------------------------------
select pg_temp.login('11111111-1111-1111-1111-111111111111');
delete from storage.objects
  where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a17e0a01-0000-4000-8000-000000000001/back.jpg';
select is(
  (select count(*)::int from storage.objects where name like 'aaaaaaaa%'), 1,
  'owner deleted her own evidence object');
delete from storage.objects where name like 'bbbbbbbb%';
select pg_temp.logout();
select is(
  (select count(*)::int from storage.objects where name like 'bbbbbbbb%'), 1,
  'owner of A cannot delete workspace B evidence');

select * from finish();
rollback;
