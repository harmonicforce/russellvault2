-- Phase 6A intake kernel — GENUINE concurrent commits via overlapping database
-- sessions (dblink async). Proves, not simulates:
--   * two identical concurrent commits (same group, key, content) converge to one
--     committed result and one lot — the loser blocks on the group lock, then
--     replays the same receipt;
--   * two conflicting concurrent commits (same group, different keys) produce one
--     winner and one explicit structured conflict, never duplicate inventory;
--   * two concurrent commits of DIFFERENT groups that resolve to the same SKU
--     converge on ONE sellable SKU (two lots, one SKU).
-- Fixtures are COMMITTED so the peer session can see them, and removed in
-- teardown. Every id is prefixed dddd/dd so teardown cannot touch anything else.
create extension if not exists pgtap;
create extension if not exists dblink;
select no_plan();

insert into auth.users (id, email) values
  ('dd111111-1111-4111-8111-111111111111', 'owner@d.test'),
  ('dd222222-2222-4222-8222-222222222222', 'op@d.test');
insert into public.workspaces (id, name, created_by) values
  ('dddd0000-0000-4000-8000-000000000001', 'WS D', 'dd111111-1111-4111-8111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('dddd0000-0000-4000-8000-000000000001', 'dd222222-2222-4222-8222-222222222222', 'operator');

create temp table cids (k text primary key, v text);
grant all on table cids to public;
insert into cids values ('ws', 'dddd0000-0000-4000-8000-000000000001');

-- JWT GUCs for the peer sessions.
create temp table sess_sql (k text primary key, sql text);
grant all on table sess_sql to public;
insert into sess_sql values
  ('sub',    $q$select set_config('request.jwt.claim.sub','dd222222-2222-4222-8222-222222222222',false)$q$),
  ('claims', $q$select set_config('request.jwt.claims', json_build_object('sub','dd222222-2222-4222-8222-222222222222','role','authenticated')::text, false)$q$);
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

-- Build committed session + three draft groups as the operator.
select set_config('request.jwt.claim.sub', 'dd222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims',
  json_build_object('sub','dd222222-2222-4222-8222-222222222222','role','authenticated')::text, false);
set role authenticated;
insert into cids values ('sess', (public.create_intake_session('dddd0000-0000-4000-8000-000000000001','conc')->>'id'));
select public.register_storage_location('dddd0000-0000-4000-8000-000000000001', 'BIN-1', null, 'Bin 1');
-- G1 (identical-converge) and G2 (conflict) — distinct products.
insert into cids values ('g1', (public.upsert_intake_group('dddd0000-0000-4000-8000-000000000001',
  (select v from cids where k='sess')::uuid, null, null, 'raw_tcg', 'Conc One #1', 1, 'lot_managed', 0,
  '{"set_name":"ConcSet","card_number":"1"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-1',
  false, false, false, false)->>'id'));
insert into cids values ('g2', (public.upsert_intake_group('dddd0000-0000-4000-8000-000000000001',
  (select v from cids where k='sess')::uuid, null, null, 'raw_tcg', 'Conc Two #2', 1, 'lot_managed', 0,
  '{"set_name":"ConcSet","card_number":"2"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-1',
  false, false, false, false)->>'id'));
-- G3a / G3b — IDENTICAL product+SKU identity, so a concurrent commit must
-- converge on one SKU.
insert into cids values ('g3a', (public.upsert_intake_group('dddd0000-0000-4000-8000-000000000001',
  (select v from cids where k='sess')::uuid, null, null, 'raw_tcg', 'Same Identity #9', 1, 'lot_managed', 0,
  '{"set_name":"SameSet","card_number":"9"}'::jsonb, '{"condition_or_quality":"Near Mint"}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-1', false, false, false, false)->>'id'));
insert into cids values ('g3b', (public.upsert_intake_group('dddd0000-0000-4000-8000-000000000001',
  (select v from cids where k='sess')::uuid, null, null, 'raw_tcg', 'Same Identity #9', 1, 'lot_managed', 0,
  '{"set_name":"SameSet","card_number":"9"}'::jsonb, '{"condition_or_quality":"Near Mint"}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-1', false, false, false, false)->>'id'));
-- G4 — a draft for the concurrent-EDIT race (one winner, one stale conflict).
insert into cids values ('g4', (public.upsert_intake_group('dddd0000-0000-4000-8000-000000000001',
  (select v from cids where k='sess')::uuid, null, null, 'raw_tcg', 'Edit Race #4', 1, 'lot_managed', 0,
  '{"set_name":"EditSet","card_number":"4"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-1', false, false, false, false)->>'id'));
-- Precompute each group's content hash (version is 1 for all).
insert into cids values ('h1', public.preview_intake_commit('dddd0000-0000-4000-8000-000000000001',(select v from cids where k='g1')::uuid)->>'content_hash');
insert into cids values ('h2', public.preview_intake_commit('dddd0000-0000-4000-8000-000000000001',(select v from cids where k='g2')::uuid)->>'content_hash');
insert into cids values ('h3a', public.preview_intake_commit('dddd0000-0000-4000-8000-000000000001',(select v from cids where k='g3a')::uuid)->>'content_hash');
insert into cids values ('h3b', public.preview_intake_commit('dddd0000-0000-4000-8000-000000000001',(select v from cids where k='g3b')::uuid)->>'content_hash');
reset role;

-- ================= PROOF 1 — identical concurrent commit converges =================
create temp table r1 (who text primary key, outcome text, lot text);
grant all on table r1 to public;
do $$
declare
  v_sub text := (select sql from sess_sql where k='sub');
  v_claim text := (select sql from sess_sql where k='claims');
  v_conn text := (select conn from dbconn);
  v_call text := format($q$select j->>'outcome', j->>'lot_id' from public.commit_intake_group(
    'dddd0000-0000-4000-8000-000000000001', %L::uuid, 'conc-key-0001', 1, %L) as j$q$,
    (select v from cids where k='g1'), (select v from cids where k='h1'));
  v_b1 int; v_b2 int; v_guard int := 0; v_winner text; v_loser text;
  v_o text; v_l text;
begin
  perform dblink_connect('a1', v_conn); perform dblink_connect('a2', v_conn);
  perform dblink_exec('a1','begin'); perform dblink_exec('a2','begin');
  perform * from dblink('a1', v_sub) t(x text); perform * from dblink('a1', v_claim) t(x text);
  perform dblink_exec('a1','set role authenticated');
  perform * from dblink('a2', v_sub) t(x text); perform * from dblink('a2', v_claim) t(x text);
  perform dblink_exec('a2','set role authenticated');
  perform dblink_send_query('a1', v_call); perform dblink_send_query('a2', v_call);
  loop
    v_guard := v_guard + 1; v_b1 := dblink_is_busy('a1'); v_b2 := dblink_is_busy('a2');
    exit when v_b1 = 0 or v_b2 = 0 or v_guard > 400; perform pg_sleep(0.05);
  end loop;
  if v_b1 = 0 then v_winner := 'a1'; v_loser := 'a2'; else v_winner := 'a2'; v_loser := 'a1'; end if;
  select o, l into v_o, v_l from dblink_get_result(v_winner) as g(o text, l text);
  perform * from dblink_get_result(v_winner) as g(o text, l text);
  insert into r1 values (v_winner, v_o, v_l);
  perform dblink_exec(v_winner, 'commit');
  select o, l into v_o, v_l from dblink_get_result(v_loser) as g(o text, l text);
  perform * from dblink_get_result(v_loser) as g(o text, l text);
  insert into r1 values (v_loser, v_o, v_l);
  perform dblink_exec(v_loser, 'commit');
  perform dblink_disconnect('a1'); perform dblink_disconnect('a2');
end $$;

select is((select count(distinct lot)::int from r1), 1,
  'identical concurrent commits converged on ONE lot');
select is((select count(*)::int from r1 where outcome = 'committed'), 2,
  'both identical concurrent commits returned a committed receipt (winner + replay)');
select is((select count(*)::int from public.inventory_lots
           where workspace_id = 'dddd0000-0000-4000-8000-000000000001'
             and id = (select lot from r1 limit 1)::uuid), 1,
  'exactly one lot row exists for the identically-raced commit');

-- ================= PROOF 2 — conflicting concurrent commit: one winner ============
create temp table r2 (who text primary key, outcome text, lot text);
grant all on table r2 to public;
do $$
declare
  v_sub text := (select sql from sess_sql where k='sub');
  v_claim text := (select sql from sess_sql where k='claims');
  v_conn text := (select conn from dbconn);
  v_c1 text := format($q$select j->>'outcome', j->>'lot_id' from public.commit_intake_group(
    'dddd0000-0000-4000-8000-000000000001', %L::uuid, 'conc-key-A', 1, %L) as j$q$,
    (select v from cids where k='g2'), (select v from cids where k='h2'));
  v_c2 text := format($q$select j->>'outcome', j->>'lot_id' from public.commit_intake_group(
    'dddd0000-0000-4000-8000-000000000001', %L::uuid, 'conc-key-B', 1, %L) as j$q$,
    (select v from cids where k='g2'), (select v from cids where k='h2'));
  v_b1 int; v_b2 int; v_guard int := 0; v_winner text; v_loser text; v_o text; v_l text;
begin
  perform dblink_connect('b1', v_conn); perform dblink_connect('b2', v_conn);
  perform dblink_exec('b1','begin'); perform dblink_exec('b2','begin');
  perform * from dblink('b1', v_sub) t(x text); perform * from dblink('b1', v_claim) t(x text);
  perform dblink_exec('b1','set role authenticated');
  perform * from dblink('b2', v_sub) t(x text); perform * from dblink('b2', v_claim) t(x text);
  perform dblink_exec('b2','set role authenticated');
  perform dblink_send_query('b1', v_c1); perform dblink_send_query('b2', v_c2);
  loop
    v_guard := v_guard + 1; v_b1 := dblink_is_busy('b1'); v_b2 := dblink_is_busy('b2');
    exit when v_b1 = 0 or v_b2 = 0 or v_guard > 400; perform pg_sleep(0.05);
  end loop;
  if v_b1 = 0 then v_winner := 'b1'; v_loser := 'b2'; else v_winner := 'b2'; v_loser := 'b1'; end if;
  select o, l into v_o, v_l from dblink_get_result(v_winner) as g(o text, l text);
  perform * from dblink_get_result(v_winner) as g(o text, l text);
  insert into r2 values (v_winner, v_o, v_l);
  perform dblink_exec(v_winner, 'commit');
  select o, l into v_o, v_l from dblink_get_result(v_loser) as g(o text, l text);
  perform * from dblink_get_result(v_loser) as g(o text, l text);
  insert into r2 values (v_loser, v_o, v_l);
  perform dblink_exec(v_loser, 'commit');
  perform dblink_disconnect('b1'); perform dblink_disconnect('b2');
end $$;

select is((select count(*)::int from r2 where outcome = 'committed'), 1,
  'exactly one conflicting concurrent commit won');
select is((select count(*)::int from r2 where outcome = 'conflict'), 1,
  'the other conflicting concurrent commit returned an explicit structured conflict');
select is((select count(*)::int from public.inventory_lots l
           join public.intake_draft_groups g on g.committed_lot_id = l.id
           where g.id = (select v from cids where k='g2')::uuid), 1,
  'the conflicting race created exactly one lot — never duplicate inventory');

-- ================= PROOF 3 — concurrent SKU creation converges =====================
create temp table r3 (who text primary key, outcome text, sku text);
grant all on table r3 to public;
do $$
declare
  v_sub text := (select sql from sess_sql where k='sub');
  v_claim text := (select sql from sess_sql where k='claims');
  v_conn text := (select conn from dbconn);
  v_ca text := format($q$select j->>'outcome', j->>'sku_id' from public.commit_intake_group(
    'dddd0000-0000-4000-8000-000000000001', %L::uuid, 'sku-key-A', 1, %L) as j$q$,
    (select v from cids where k='g3a'), (select v from cids where k='h3a'));
  v_cb text := format($q$select j->>'outcome', j->>'sku_id' from public.commit_intake_group(
    'dddd0000-0000-4000-8000-000000000001', %L::uuid, 'sku-key-B', 1, %L) as j$q$,
    (select v from cids where k='g3b'), (select v from cids where k='h3b'));
  v_b1 int; v_b2 int; v_guard int := 0; v_o text; v_s text;
begin
  perform dblink_connect('c1', v_conn); perform dblink_connect('c2', v_conn);
  perform dblink_exec('c1','begin'); perform dblink_exec('c2','begin');
  perform * from dblink('c1', v_sub) t(x text); perform * from dblink('c1', v_claim) t(x text);
  perform dblink_exec('c1','set role authenticated');
  perform * from dblink('c2', v_sub) t(x text); perform * from dblink('c2', v_claim) t(x text);
  perform dblink_exec('c2','set role authenticated');
  perform dblink_send_query('c1', v_ca); perform dblink_send_query('c2', v_cb);
  loop
    v_guard := v_guard + 1; v_b1 := dblink_is_busy('c1'); v_b2 := dblink_is_busy('c2');
    exit when (v_b1 = 0 and v_b2 = 0) or v_guard > 400; perform pg_sleep(0.05);
  end loop;
  -- Different groups: neither blocks the other; drain both.
  begin
    select o, s into v_o, v_s from dblink_get_result('c1') as g(o text, s text);
    perform * from dblink_get_result('c1') as g(o text, s text);
    insert into r3 values ('c1', v_o, v_s);
  exception when others then insert into r3 values ('c1', 'error', null); end;
  perform dblink_exec('c1','commit');
  begin
    select o, s into v_o, v_s from dblink_get_result('c2') as g(o text, s text);
    perform * from dblink_get_result('c2') as g(o text, s text);
    insert into r3 values ('c2', v_o, v_s);
  exception when others then insert into r3 values ('c2', 'error', null); end;
  perform dblink_exec('c2','commit');
  perform dblink_disconnect('c1'); perform dblink_disconnect('c2');
end $$;

select is((select count(*)::int from r3 where outcome = 'committed'), 2,
  'both concurrent commits of the same identity succeeded');
select is((select count(distinct sku)::int from r3 where outcome = 'committed'), 1,
  'both concurrent commits converged on the SAME sellable SKU');
select is((select count(*)::int from public.sellable_skus s
           where s.workspace_id = 'dddd0000-0000-4000-8000-000000000001' and s.is_active
             and s.id = (select sku from r3 limit 1)::uuid), 1,
  'exactly one active SKU row exists for the concurrently-raced identity');

-- ================= PROOF 4 — concurrent draft EDIT: one winner, one conflict ======
-- Two devices edit the SAME draft group with the SAME expected_version. The
-- group FOR UPDATE lock serializes them: one edit wins (version bumps), the
-- other blocks then returns a structured stale_version conflict — never a silent
-- overwrite.
create temp table r4 (who text primary key, outcome text, version text);
grant all on table r4 to public;
do $$
declare
  v_sub text := (select sql from sess_sql where k='sub');
  v_claim text := (select sql from sess_sql where k='claims');
  v_conn text := (select conn from dbconn);
  v_call text := format($q$select coalesce(j->>'outcome','ok'), j->>'version' from public.upsert_intake_group(
    'dddd0000-0000-4000-8000-000000000001', %L::uuid, %L::uuid, 1, 'raw_tcg', 'Edit Race #4', 1,
    'lot_managed', 0, '{"set_name":"EditSet","card_number":"4"}'::jsonb, '{}'::jsonb,
    '{"source_kind":"personal_collection"}'::jsonb, 'Lightly Played', 'BIN-1',
    false, false, false, false) as j$q$,
    (select v from cids where k='sess'), (select v from cids where k='g4'));
  v_b1 int; v_b2 int; v_guard int := 0; v_winner text; v_loser text; v_o text; v_v text;
begin
  perform dblink_connect('d1', v_conn); perform dblink_connect('d2', v_conn);
  perform dblink_exec('d1','begin'); perform dblink_exec('d2','begin');
  perform * from dblink('d1', v_sub) t(x text); perform * from dblink('d1', v_claim) t(x text);
  perform dblink_exec('d1','set role authenticated');
  perform * from dblink('d2', v_sub) t(x text); perform * from dblink('d2', v_claim) t(x text);
  perform dblink_exec('d2','set role authenticated');
  perform dblink_send_query('d1', v_call); perform dblink_send_query('d2', v_call);
  loop
    v_guard := v_guard + 1; v_b1 := dblink_is_busy('d1'); v_b2 := dblink_is_busy('d2');
    exit when v_b1 = 0 or v_b2 = 0 or v_guard > 400; perform pg_sleep(0.05);
  end loop;
  if v_b1 = 0 then v_winner := 'd1'; v_loser := 'd2'; else v_winner := 'd2'; v_loser := 'd1'; end if;
  select o, vv into v_o, v_v from dblink_get_result(v_winner) as g(o text, vv text);
  perform * from dblink_get_result(v_winner) as g(o text, vv text);
  insert into r4 values (v_winner, v_o, v_v);
  perform dblink_exec(v_winner, 'commit');
  select o, vv into v_o, v_v from dblink_get_result(v_loser) as g(o text, vv text);
  perform * from dblink_get_result(v_loser) as g(o text, vv text);
  insert into r4 values (v_loser, v_o, v_v);
  perform dblink_exec(v_loser, 'commit');
  perform dblink_disconnect('d1'); perform dblink_disconnect('d2');
end $$;

select is((select count(*)::int from r4 where outcome = 'ok'), 1,
  'exactly one concurrent edit won');
select is((select count(*)::int from r4 where outcome = 'conflict'), 1,
  'the other concurrent edit returned a structured stale_version conflict');
select is((select version from public.intake_draft_groups where id = (select v from cids where k='g4')::uuid), 2,
  'the winning edit bumped the version exactly once (no double increment, no overwrite)');

-- Teardown (bypass append-only + FK restrictions).
set session_replication_role = replica;
delete from public.intake_transition_events where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.intake_commit_attempts where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.intake_candidate_links where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.intake_entries where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.intake_draft_groups where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.intake_sessions where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.inventory_items where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.inventory_lots where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.tcg_sku_attributes where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.sellable_skus where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.tcg_product_attributes where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.product_catalog where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.storage_locations where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.workspace_members where workspace_id = 'dddd0000-0000-4000-8000-000000000001';
delete from public.workspaces where id = 'dddd0000-0000-4000-8000-000000000001';
delete from auth.users where id in ('dd111111-1111-4111-8111-111111111111','dd222222-2222-4222-8222-222222222222');
set session_replication_role = origin;

select * from finish();
