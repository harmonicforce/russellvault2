-- Concurrency/locking proof for the authorize-in-the-lookup construction in
-- expand_intake_group (finding: never lock a foreign row before authorizing).
--
-- Uses a REAL second database session (dblink) while this session holds a
-- FOR UPDATE lock on the intake group:
--   * an AUTHORIZED operator blocks on that lock (hits lock_timeout 55P03),
--     proving the authorized path serializes on the group row;
--   * an UNAUTHORIZED foreign owner returns 42501 immediately despite the
--     held lock, proving unauthorized callers never attempt to read or lock
--     the row.
-- Skips cleanly (2 skips) when dblink cannot connect in the environment.
--
-- This file runs OUTSIDE a wrapping transaction because the second session
-- must see committed fixtures; it cleans its fixtures up at the end.

create extension if not exists pgtap;

do $$
begin
  begin
    create extension if not exists dblink;
  exception when others then
    null; -- unavailable: the proof below will skip
  end;
end
$$;

select no_plan();

-- Committed fixtures (distinct ids from the transactional test files) --------
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'lock-alice@example.test'),
  ('77777777-7777-7777-7777-777777777777', 'lock-bob@example.test'),
  ('88888888-8888-8888-8888-888888888888', 'lock-zoe@example.test');

insert into public.workspaces (id, name, sku_prefix, created_by) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Lock WS A', 'RV-N-', '66666666-6666-6666-6666-666666666666'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Lock WS B', 'BW-', '88888888-8888-8888-8888-888888888888');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '77777777-7777-7777-7777-777777777777', 'operator');

insert into public.sessions (id, workspace_id, public_id, created_by) values
  ('d5e55d01-0000-4000-8000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'LOCK-S1', '66666666-6666-6666-6666-666666666666');

insert into public.intake_groups (id, workspace_id, session_id, public_id, label, quantity_expected, created_by) values
  ('d6e00d01-0000-4000-8000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'd5e55d01-0000-4000-8000-000000000001', 'LOCK-G1', 'Locked group', 1, '66666666-6666-6666-6666-666666666666');

-- Helpers ---------------------------------------------------------------------
create function pg_temp.lk_connect() returns boolean language plpgsql as $$
begin
  -- (to_regproc cannot be used here: dblink_connect is overloaded, which
  -- makes to_regproc return null even when the extension is installed.)
  if not exists (select 1 from pg_proc where proname = 'dblink_connect') then
    return false;
  end if;
  begin
    perform dblink_connect('lkconn', 'dbname=' || current_database());
    return true;
  exception when others then
    begin
      perform dblink_connect('lkconn',
        'dbname=' || current_database() || ' host=127.0.0.1 user=postgres password=postgres');
      return true;
    exception when others then
      return false;
    end;
  end;
end
$$;

-- Runs expand_intake_group in the second session as the given user with the
-- given lock_timeout; returns 'no-error' or the SQLSTATE it failed with.
create function pg_temp.lk_try_expand(p_sub text, p_group uuid, p_lock_timeout text) returns text
language plpgsql as $$
declare
  v_state text;
begin
  begin
    perform dblink_exec('lkconn', format(
      'begin; set local lock_timeout = %L; set local role authenticated; '
      || 'do $r$ begin perform set_config(''request.jwt.claim.sub'', %L, true); '
      || 'perform public.expand_intake_group(%L); end $r$; rollback;',
      p_lock_timeout, p_sub, p_group));
    return 'no-error';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    begin
      perform dblink_exec('lkconn', 'rollback;');
    exception when others then
      null;
    end;
    return v_state;
  end;
end
$$;

create function pg_temp.lk_proof() returns setof text language plpgsql as $$
declare
  v_bob text;
  v_zoe text;
begin
  if not pg_temp.lk_connect() then
    return next skip('dblink session unavailable in this environment; locking proof skipped', 2);
    return;
  end if;

  -- Hold the group lock in THIS session while the second session works.
  perform 1 from public.intake_groups g
  where g.id = 'd6e00d01-0000-4000-8000-000000000001'
  for update;

  v_bob := pg_temp.lk_try_expand('77777777-7777-7777-7777-777777777777',
    'd6e00d01-0000-4000-8000-000000000001', '300ms');
  return next is(v_bob, '55P03',
    'authorized operator blocks on the held group lock (authorized path serializes)');

  v_zoe := pg_temp.lk_try_expand('88888888-8888-8888-8888-888888888888',
    'd6e00d01-0000-4000-8000-000000000001', '5000ms');
  return next is(v_zoe, '42501',
    'unauthorized caller returns immediately without touching the held lock');

  perform dblink_disconnect('lkconn');
end
$$;

-- The lock must be held across the dblink calls, so run the proof inside a
-- transaction and COMMIT it (nothing is modified; the second session rolls
-- its own work back).
begin;
select * from pg_temp.lk_proof();
commit;

-- Cleanup (fixtures were committed; deleting the workspaces cascades the
-- memberships) ----------------------------------------------------------------
delete from public.intake_groups where workspace_id in
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
delete from public.sessions where workspace_id in
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
delete from public.workspaces where id in
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
delete from auth.users where id in
  ('66666666-6666-6666-6666-666666666666', '77777777-7777-7777-7777-777777777777',
   '88888888-8888-8888-8888-888888888888');

select * from finish();
