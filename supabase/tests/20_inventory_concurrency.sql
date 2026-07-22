-- Phase 5 identity concurrency — GENUINE overlapping database sessions (dblink
-- async). Two independent sessions begin transactions and issue the SAME
-- governed call before EITHER commits, then we let exactly one win. This proves,
-- not simulates, that:
--   * two concurrent final-capacity mint_serialized_item calls cannot overfill a
--     lot — one succeeds, the other blocks on the lot row lock until the winner
--     commits and then fails check_violation, final child count staying at 2; and
--   * two concurrent register_product / register_sellable_sku calls converge —
--     one creates the row, the other blocks on the unique constraint and resumes
--     to the SAME id with created=false.
-- Modeled on 11_provenance_concurrency.sql: fixtures are COMMITTED so the second
-- session can see them, and are removed in teardown. Every fixture id is
-- prefixed ee/e2 so teardown cannot touch anything else. dblink is expected in
-- both the PostgreSQL-shim and Docker-local Supabase CI tiers; this proof does
-- not skip there.
create extension if not exists pgtap;
create extension if not exists dblink;
select no_plan();

-- Committed fixture: workspace, operator, and a serialized qty-2 SKU + lot ------------
insert into auth.users (id, email) values
  ('ee111111-1111-4111-8111-111111111111', 'owner@conc.test'),
  ('ee222222-2222-4222-8222-222222222222', 'op@conc.test');
insert into public.workspaces (id, name, created_by) values
  ('eeee0000-0000-4000-8000-000000000001', 'WS CONC', 'ee111111-1111-4111-8111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('eeee0000-0000-4000-8000-000000000001', 'ee222222-2222-4222-8222-222222222222', 'operator');

create temp table cids (k text primary key, v uuid);
grant all on table cids to public;

-- The two independent sessions authenticate as this operator. Emitting the JWT
-- GUCs and the role switch is identical for every session, so factor them out.
create temp table sess_sql (k text primary key, sql text);
grant all on table sess_sql to public;
insert into sess_sql values
  ('sub',    $q$select set_config('request.jwt.claim.sub','ee222222-2222-4222-8222-222222222222',false)$q$),
  ('claims', $q$select set_config('request.jwt.claims', json_build_object('sub','ee222222-2222-4222-8222-222222222222','role','authenticated')::text, false)$q$);

-- dblink connection string for the concurrent sessions. dblink refuses a
-- connection for a NON-superuser role unless the server actually challenged for
-- a password (dblink_security_check), so the two tiers differ:
--   * PostgreSQL shim: the suite runs as a superuser, so the bare dbname form is
--     accepted (no password needed).
--   * Docker-local Supabase stack: the suite runs as the non-superuser
--     "postgres" role, and its loopback pg_hba path is trust (no challenge), so
--     a 127.0.0.1 connection is rejected even WITH a password. We instead
--     reconnect to the very endpoint this backend is already served on
--     (inet_server_addr()/inet_server_port() — the scram-guarded container
--     network address), supplying the fixed, well-known Supabase-local dev
--     credential (postgres/postgres; not a secret — the stack prints this URL).
-- Either way the peer session adopts the operator via the JWT GUCs + set role.
create temp table dbconn (conn text);
grant all on table dbconn to public;
insert into dbconn values (
  case when current_setting('is_superuser') = 'on'
    then 'dbname=' || current_database()
    else format('host=%s port=%s dbname=%s user=postgres password=postgres',
                coalesce(host(inet_server_addr()), '127.0.0.1'),
                coalesce(inet_server_port()::text, current_setting('port')),
                current_database())
  end);

-- Act as the operator to build the committed identity fixture.
select set_config('request.jwt.claim.sub', 'ee222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims',
  json_build_object('sub', 'ee222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, false);
set role authenticated;
insert into cids values ('sku', (public.register_sellable_sku('eeee0000-0000-4000-8000-000000000001',
  (public.register_product('eeee0000-0000-4000-8000-000000000001', 'tcg', 'C', 'tcg|c|||', '{}')->>'id')::uuid,
  '{"grading_company":"CGC","product_format":"Graded slab"}')->>'id')::uuid);
-- A quantity-2 serialized lot with ONE child already minted: exactly one unit of
-- capacity remains, so two concurrent finals contend for the very last slot.
select public.stage_inventory_lot('eeee0000-0000-4000-8000-000000000001', 'RV-C-990002',
  (select v from cids where k = 'sku'), 'serialized', 2, null, 'Imported Legacy', '1.0.0', null);
insert into cids values ('lot1', (select id from public.inventory_lots where public_id = 'RV-C-990002'));
select public.mint_serialized_item('eeee0000-0000-4000-8000-000000000001',
  (select v from cids where k = 'lot1'), 'CGC', 'SEED-1', null);
-- A committed product to parent the concurrent-SKU race.
insert into cids values ('rprod', (public.register_product('eeee0000-0000-4000-8000-000000000001',
  'tcg', 'RaceSku', 'tcg|racesku|||', '{}')->>'id')::uuid);
reset role;

-- ====================================================================================
-- PROOF 1 — two genuinely concurrent mint_serialized_item calls on the last slot
-- ====================================================================================
create temp table mres (who text primary key, ok boolean, sqlstate text, id text);
grant all on table mres to public;

do $$
declare
  v_lot   text := (select v::text from cids where k = 'lot1');
  v_sub   text := (select sql from sess_sql where k = 'sub');
  v_claim text := (select sql from sess_sql where k = 'claims');
  v_conn  text := (select conn from dbconn);
  v_b1 int; v_b2 int; v_guard int := 0;
  v_winner text; v_loser text; v_res text;
begin
  perform dblink_connect('m1', v_conn);
  perform dblink_connect('m2', v_conn);
  perform dblink_exec('m1', 'begin');
  perform dblink_exec('m2', 'begin');
  perform * from dblink('m1', v_sub) as t(x text);
  perform * from dblink('m1', v_claim) as t(x text);
  perform dblink_exec('m1', 'set role authenticated');
  perform * from dblink('m2', v_sub) as t(x text);
  perform * from dblink('m2', v_claim) as t(x text);
  perform dblink_exec('m2', 'set role authenticated');

  -- Fire BOTH mints before either transaction commits.
  perform dblink_send_query('m1',
    format($q$select (public.mint_serialized_item('eeee0000-0000-4000-8000-000000000001', %L, 'CGC', 'RACE-A', null)->>'id')$q$, v_lot));
  perform dblink_send_query('m2',
    format($q$select (public.mint_serialized_item('eeee0000-0000-4000-8000-000000000001', %L, 'CGC', 'RACE-B', null)->>'id')$q$, v_lot));

  -- Exactly one acquires the lot's FOR UPDATE lock and finishes; the other blocks.
  loop
    v_guard := v_guard + 1;
    v_b1 := dblink_is_busy('m1');
    v_b2 := dblink_is_busy('m2');
    exit when v_b1 = 0 or v_b2 = 0 or v_guard > 400;
    perform pg_sleep(0.05);
  end loop;
  if v_b1 <> 0 and v_b2 <> 0 then
    raise exception 'neither concurrent mint completed — no winner acquired the lock';
  end if;
  if v_b1 = 0 then v_winner := 'm1'; v_loser := 'm2';
  else v_winner := 'm2'; v_loser := 'm1'; end if;

  -- Winner: capture the success, drain, then COMMIT so the loser can proceed.
  select gr.id into v_res from dblink_get_result(v_winner) as gr(id text);
  perform * from dblink_get_result(v_winner) as gr(id text);
  insert into mres values (v_winner, true, null, v_res);
  perform dblink_exec(v_winner, 'commit');

  -- Loser: now unblocks and must FAIL CLOSED with check_violation (lot full).
  begin
    perform * from dblink_get_result(v_loser) as gr(id text);
    insert into mres values (v_loser, true, null, null);   -- unexpected: it overfilled
  exception when others then
    insert into mres values (v_loser, false, sqlstate, null);
  end;
  -- Drain the loser's async pipeline (its first result raised) so the
  -- connection can close cleanly; its transaction rolls back on disconnect.
  begin perform * from dblink_get_result(v_loser) as gr(id text); exception when others then null; end;
  perform dblink_disconnect('m1');
  perform dblink_disconnect('m2');
end $$;

select is((select count(*)::int from mres where ok), 1,
  'exactly one of two concurrent final-capacity mints succeeded');
select is((select count(*)::int from mres where not ok), 1,
  'the competing concurrent mint was refused');
select is((select sqlstate from mres where not ok), '23514',
  'the refused concurrent mint blocked then failed with check_violation (lot full)');
select is((select id from mres where ok) is not null, true,
  'the winning concurrent mint returned a minted item id');
select is(
  (select count(*)::int from public.inventory_items where lot_id = (select v from cids where k = 'lot1')),
  2, 'the quantity-2 lot committed exactly two children — never three');

-- ====================================================================================
-- PROOF 2 — two genuinely concurrent register_product calls for one new key
-- ====================================================================================
create temp table pres (who text primary key, ok boolean, id text, created boolean);
grant all on table pres to public;

do $$
declare
  v_sub   text := (select sql from sess_sql where k = 'sub');
  v_claim text := (select sql from sess_sql where k = 'claims');
  v_b1 int; v_b2 int; v_guard int := 0;
  v_winner text; v_loser text;
  v_id text; v_created boolean;
  v_conn  text := (select conn from dbconn);
  v_call text := $q$select (j->>'id')::text as id, (j->>'created')::boolean as created
                 from public.register_product('eeee0000-0000-4000-8000-000000000001','tcg','Race','tcg|race|||','{}') as j$q$;
begin
  perform dblink_connect('p1', v_conn);
  perform dblink_connect('p2', v_conn);
  perform dblink_exec('p1', 'begin');
  perform dblink_exec('p2', 'begin');
  perform * from dblink('p1', v_sub) as t(x text);
  perform * from dblink('p1', v_claim) as t(x text);
  perform dblink_exec('p1', 'set role authenticated');
  perform * from dblink('p2', v_sub) as t(x text);
  perform * from dblink('p2', v_claim) as t(x text);
  perform dblink_exec('p2', 'set role authenticated');

  perform dblink_send_query('p1', v_call);
  perform dblink_send_query('p2', v_call);

  loop
    v_guard := v_guard + 1;
    v_b1 := dblink_is_busy('p1');
    v_b2 := dblink_is_busy('p2');
    exit when v_b1 = 0 or v_b2 = 0 or v_guard > 400;
    perform pg_sleep(0.05);
  end loop;
  if v_b1 <> 0 and v_b2 <> 0 then
    raise exception 'neither concurrent register_product completed';
  end if;
  if v_b1 = 0 then v_winner := 'p1'; v_loser := 'p2';
  else v_winner := 'p2'; v_loser := 'p1'; end if;

  -- Winner creates the row; commit so the blocked loser resumes.
  select gr.id, gr.created into v_id, v_created
  from dblink_get_result(v_winner) as gr(id text, created boolean);
  perform * from dblink_get_result(v_winner) as gr(id text, created boolean);
  insert into pres values (v_winner, true, v_id, v_created);
  perform dblink_exec(v_winner, 'commit');

  -- Loser: unique-constraint arbiter forces it to re-read and resume, not error.
  begin
    select gr.id, gr.created into v_id, v_created
    from dblink_get_result(v_loser) as gr(id text, created boolean);
    perform * from dblink_get_result(v_loser) as gr(id text, created boolean);
    insert into pres values (v_loser, true, v_id, v_created);
  exception when others then
    insert into pres values (v_loser, false, null, null);
  end;
  begin perform * from dblink_get_result(v_loser) as gr(id text, created boolean); exception when others then null; end;
  perform dblink_disconnect('p1');
  perform dblink_disconnect('p2');
end $$;

select is((select count(*)::int from pres where ok), 2,
  'both concurrent register_product calls finished successfully');
select is((select count(distinct id)::int from pres where ok), 1,
  'both concurrent register_product calls returned the SAME product id');
select is((select count(*)::int from pres where ok and created), 1,
  'exactly one concurrent register_product reported created=true');
select is((select count(*)::int from pres where ok and not created), 1,
  'the overlapping register_product resumed with created=false');
select is(
  (select count(*)::int from public.product_catalog
   where workspace_id = 'eeee0000-0000-4000-8000-000000000001' and product_canonical_key = 'tcg|race|||'),
  1, 'exactly one product row exists for the concurrently-raced key');

-- ====================================================================================
-- PROOF 3 — two genuinely concurrent register_sellable_sku calls for one fingerprint
-- ====================================================================================
create temp table sres (who text primary key, ok boolean, id text, fp text, created boolean);
grant all on table sres to public;

do $$
declare
  v_sub   text := (select sql from sess_sql where k = 'sub');
  v_claim text := (select sql from sess_sql where k = 'claims');
  v_prod  text := (select v::text from cids where k = 'rprod');
  v_b1 int; v_b2 int; v_guard int := 0;
  v_winner text; v_loser text;
  v_id text; v_fp text; v_created boolean;
  v_call text := format($q$select (j->>'id')::text as id, (j->>'fingerprint')::text as fp, (j->>'created')::boolean as created
                 from public.register_sellable_sku('eeee0000-0000-4000-8000-000000000001', %L::uuid,
                   '{"condition_or_quality":"Near Mint"}') as j$q$,
    (select v::text from cids where k = 'rprod'));
  v_conn  text := (select conn from dbconn);
begin
  perform dblink_connect('s1', v_conn);
  perform dblink_connect('s2', v_conn);
  perform dblink_exec('s1', 'begin');
  perform dblink_exec('s2', 'begin');
  perform * from dblink('s1', v_sub) as t(x text);
  perform * from dblink('s1', v_claim) as t(x text);
  perform dblink_exec('s1', 'set role authenticated');
  perform * from dblink('s2', v_sub) as t(x text);
  perform * from dblink('s2', v_claim) as t(x text);
  perform dblink_exec('s2', 'set role authenticated');

  perform dblink_send_query('s1', v_call);
  perform dblink_send_query('s2', v_call);

  loop
    v_guard := v_guard + 1;
    v_b1 := dblink_is_busy('s1');
    v_b2 := dblink_is_busy('s2');
    exit when v_b1 = 0 or v_b2 = 0 or v_guard > 400;
    perform pg_sleep(0.05);
  end loop;
  if v_b1 <> 0 and v_b2 <> 0 then
    raise exception 'neither concurrent register_sellable_sku completed';
  end if;
  if v_b1 = 0 then v_winner := 's1'; v_loser := 's2';
  else v_winner := 's2'; v_loser := 's1'; end if;

  select gr.id, gr.fp, gr.created into v_id, v_fp, v_created
  from dblink_get_result(v_winner) as gr(id text, fp text, created boolean);
  perform * from dblink_get_result(v_winner) as gr(id text, fp text, created boolean);
  insert into sres values (v_winner, true, v_id, v_fp, v_created);
  perform dblink_exec(v_winner, 'commit');

  begin
    select gr.id, gr.fp, gr.created into v_id, v_fp, v_created
    from dblink_get_result(v_loser) as gr(id text, fp text, created boolean);
    perform * from dblink_get_result(v_loser) as gr(id text, fp text, created boolean);
    insert into sres values (v_loser, true, v_id, v_fp, v_created);
  exception when others then
    insert into sres values (v_loser, false, null, null, null);
  end;
  begin perform * from dblink_get_result(v_loser) as gr(id text, fp text, created boolean); exception when others then null; end;
  perform dblink_disconnect('s1');
  perform dblink_disconnect('s2');
end $$;

select is((select count(*)::int from sres where ok), 2,
  'both concurrent register_sellable_sku calls finished successfully');
select is((select count(distinct id)::int from sres where ok), 1,
  'both concurrent register_sellable_sku calls returned the SAME sku id');
select is((select count(distinct fp)::int from sres where ok), 1,
  'both concurrent register_sellable_sku calls returned the SAME fingerprint');
select is((select count(*)::int from sres where ok and created), 1,
  'exactly one concurrent register_sellable_sku reported created=true');
select is((select count(*)::int from sres where ok and not created), 1,
  'the overlapping register_sellable_sku resumed with created=false');
select is(
  (select count(*)::int from public.sellable_skus
   where product_id = (select v from cids where k = 'rprod') and is_active
     and fingerprint = (select fp from sres where ok limit 1)),
  1, 'exactly one active sku row exists for the concurrently-raced fingerprint');

-- Teardown: remove the committed fixture (bypass append-only + FK restrictions).
set session_replication_role = replica;
delete from public.inventory_items where workspace_id = 'eeee0000-0000-4000-8000-000000000001';
delete from public.inventory_lots where workspace_id = 'eeee0000-0000-4000-8000-000000000001';
delete from public.tcg_sku_attributes where workspace_id = 'eeee0000-0000-4000-8000-000000000001';
delete from public.tcg_product_attributes where workspace_id = 'eeee0000-0000-4000-8000-000000000001';
delete from public.sellable_skus where workspace_id = 'eeee0000-0000-4000-8000-000000000001';
delete from public.product_catalog where workspace_id = 'eeee0000-0000-4000-8000-000000000001';
delete from public.storage_locations where workspace_id = 'eeee0000-0000-4000-8000-000000000001';
delete from public.workspace_members where workspace_id = 'eeee0000-0000-4000-8000-000000000001';
delete from public.workspaces where id = 'eeee0000-0000-4000-8000-000000000001';
delete from auth.users where id in ('ee111111-1111-4111-8111-111111111111', 'ee222222-2222-4222-8222-222222222222');
set session_replication_role = origin;

select * from finish();
