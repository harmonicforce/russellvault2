-- Phase 6A intake kernel — GENUINE concurrent commits via overlapping database
-- sessions (dblink async). Proves, not simulates:
--   * two identical concurrent commits (same group, key, content) converge to one
--     committed result and one lot — the loser blocks on the group lock, then
--     replays the same receipt;
--   * two conflicting concurrent commits (same group, different keys) produce one
--     winner and one explicit structured conflict, never duplicate inventory;
--   * two concurrent commits of DIFFERENT groups that resolve to the same SKU
--     converge on ONE sellable SKU (two lots, one SKU).
--   * a fourth proof: two concurrent edits of the SAME draft group produce one
--     winner and one structured stale_version conflict, never a silent overwrite.
-- Fixtures are COMMITTED so the peer session can see them, and removed in
-- teardown. Every id is prefixed dddd/dd so teardown cannot touch anything else.
--
-- ===========================================================================
-- HOW THIS HARNESS BEHAVES (read before changing the blocks below)
--
-- The hang it used to have.
--   Each proof dispatches two overlapping queries with dblink_send_query, polls
--   with a bounded loop, then collects results. Collection used to name the
--   connection: "get c1, then c2". But in every one of these races exactly one
--   worker is EXPECTED to block on the other -- that blocking is the guarantee
--   under test -- so a fixed order is only correct when the named connection
--   happens to be the one that won. When the loser was named first,
--   dblink_get_result blocked on a worker that could not finish until the
--   winner committed, and the winner could not commit because the harness was
--   blocked on the loser. The poll was bounded; the call after it was not.
--   Observed live: harness on wait_event Extension, one worker
--   idle-in-transaction holding its uncommitted row, the other on
--   Lock/transactionid with pg_blocking_pids naming the idle one. Roughly a
--   coin flip per run, and CI hung instead of passing or failing.
--   PROOF 3 was worse: it waited for BOTH workers to go idle, which cannot
--   happen before the harness commits one of them, so it always burned its
--   full poll budget first.
--
-- The synchronisation model now.
--   Never name the connection to collect from; ask which one is READY.
--   pg_temp.await_ready polls dblink_is_busy across a set of connections and
--   returns the first that is not busy. Collection therefore only ever happens
--   on a worker that has already finished, in whatever order the race actually
--   resolved. The winner is committed immediately, which releases whatever the
--   other worker is waiting on, and only then is the second one awaited.
--   The race is unchanged: both queries are still dispatched before either
--   result is collected, and both run in genuinely overlapping transactions.
--
-- Timeout behaviour.
--   await_ready takes a wall-clock deadline (default 60s). On expiry it raises
--   55P03 lock_not_available with a live pg_stat_activity snapshot naming the
--   block, the connections, each backend's state, wait event and blocker pids.
--   It is deliberately NOT 57014/query_canceled: PL/pgSQL's WHEN OTHERS refuses
--   to catch that class, which would make the deadline untrappable by ordinary
--   handlers and by pgTAP's throws_ok. No path in this file can wait forever.
--
-- Cleanup behaviour.
--   Each block ends with an exception handler that runs pg_temp.abandon_workers
--   and then RE-RAISES the original error, so cleanup can never replace the
--   failure that caused it. Cleanup terminates workers BY PID, captured at
--   connect time by pg_temp.worker_connect: measured on this stack,
--   dblink_cancel_query returns 'OK' while the worker keeps running, and
--   dblink_disconnect closes the client side without ending a backend blocked
--   inside its query. Only pg_terminate_backend is deterministic.
--   Note that pg_stat_activity is snapshotted per transaction, so any polling
--   loop here calls pg_stat_clear_snapshot() or it re-reads stale rows forever.
--
-- Why the production guarantee is untouched.
--   Nothing in the commit path changed. The workers still call the real
--   commit_intake_group and upsert_intake_group, still overlap, still block on
--   each other through the same group lock and the same unique SKU fingerprint,
--   and every assertion below is byte-for-byte what it was. Only the order in
--   which this file COLLECTS already-produced results changed.
-- ===========================================================================
create extension if not exists pgtap;
create extension if not exists dblink;
select no_plan();

-- ---------------------------------------------------------------------------
-- Bounded, readiness-ordered result collection.
--
-- THE ORIGINAL HANG. Each proof below fires two overlapping queries with
-- dblink_send_query, polled with a bounded loop, and then collected the
-- results in a FIXED order. In every one of these races exactly one worker is
-- expected to block on the other -- that blocking IS the guarantee under test
-- -- so "collect c1, then c2" is only correct when c1 happens to be the worker
-- that won. When the loser was named first, dblink_get_result was called on a
-- connection that could not finish until the winner committed, and the winner
-- could not commit because the harness was blocked collecting from the loser.
-- The polling loop was bounded; the call after it was not. Observed live:
-- harness waiting on wait_event Extension, one worker idle-in-transaction
-- holding its uncommitted row, the other active on Lock/transactionid with
-- pg_blocking_pids pointing at the idle one. CI hung instead of passing or
-- failing.
--
-- THE FIX. Never name the connection to collect from; ask which one is READY.
-- pg_temp.await_ready polls until some connection reports not-busy and returns
-- it, so collection only ever happens on a worker that has already finished,
-- in whichever order the race actually resolved. If nothing becomes ready
-- before the deadline it raises with live pg_stat_activity diagnostics, so the
-- suite fails loudly and finitely instead of hanging.
--
-- The race itself is unchanged: both queries are still dispatched before
-- either result is collected, both workers still run in genuinely overlapping
-- transactions, and every assertion below is untouched.
create or replace function pg_temp.await_ready(
  p_block text, p_conns text[], p_seconds numeric default 60)
returns text
language plpgsql
as $awaitfn$
declare
  v_started timestamptz := clock_timestamp();
  v_conn text;
  v_diag text;
begin
  loop
    foreach v_conn in array p_conns loop
      if dblink_is_busy(v_conn) = 0 then
        return v_conn;
      end if;
    end loop;

    if clock_timestamp() - v_started > make_interval(secs => p_seconds) then
      perform pg_stat_clear_snapshot();
      select coalesce(string_agg(
               format('pid=%s state=%s wait=%s/%s blocked_by=%s q=%s',
                      pid, state, coalesce(wait_event_type, '-'),
                      coalesce(wait_event, '-'), pg_blocking_pids(pid),
                      left(regexp_replace(coalesce(query, ''), '\s+', ' ', 'g'), 110)),
               chr(10) || '  '), '(no other backends)')
        into v_diag
        from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid();

      raise exception
        'concurrency harness deadline in %: no connection of % became ready within % seconds%  %',
        p_block, p_conns, p_seconds, chr(10), v_diag
        -- NOT 57014/query_canceled: PL/pgSQL's WHEN OTHERS refuses to catch that
        -- class, which would make this deadline untrappable by ordinary
        -- handlers and by pgTAP's throws_ok. This is a worker that never became
        -- available, which is exactly what lock_not_available means.
        using errcode = '55P03';
    end if;

    perform pg_sleep(0.02);
  end loop;
end
$awaitfn$;

-- Worker identity, captured at connect time.
--
-- Cleanup cannot rely on dblink alone. Measured on this stack:
-- dblink_cancel_query returns 'OK' while the worker carries on running, and
-- dblink_disconnect closes the client side without ending a backend that is
-- blocked inside its query -- so "cancel then disconnect" can leave a live
-- session holding locks into the next block. The only deterministic lever is
-- the worker's own backend pid, so it is recorded the moment the connection is
-- opened, while the connection is still idle enough to answer.
create temp table worker_pids (conn text primary key, pid int not null);
grant all on table worker_pids to public;

create or replace function pg_temp.worker_connect(p_conn text, p_dsn text)
returns int
language plpgsql
as $connfn$
declare
  v_pid int;
begin
  perform dblink_connect(p_conn, p_dsn);
  select t.pid into v_pid from dblink(p_conn, 'select pg_backend_pid()') as t(pid int);
  insert into worker_pids (conn, pid) values (p_conn, v_pid)
    on conflict (conn) do update set pid = excluded.pid;
  return v_pid;
end
$connfn$;

-- Bounded teardown for a failed block. Every step is individually swallowed on
-- purpose: cleanup must never replace the failure that caused it, and the
-- caller re-raises the original error immediately after. Termination by pid is
-- what actually guarantees no worker survives the block.
create or replace function pg_temp.abandon_workers(p_conns text[])
returns void
language plpgsql
as $abandonfn$
declare
  v_conn text;
  v_pid int;
begin
  foreach v_conn in array p_conns loop
    begin perform dblink_cancel_query(v_conn); exception when others then null; end;
    select pid into v_pid from worker_pids where conn = v_conn;
    if v_pid is not null then
      begin
        perform pg_terminate_backend(v_pid)
          from pg_stat_activity
         where pid = v_pid and datname = current_database();
      exception when others then null; end;
    end if;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
    delete from worker_pids where conn = v_conn;
  end loop;
end
$abandonfn$;

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
  v_first text; v_second text;
  v_o text; v_l text;
begin
  perform pg_temp.worker_connect('a1', v_conn); perform pg_temp.worker_connect('a2', v_conn);
  perform dblink_exec('a1','begin'); perform dblink_exec('a2','begin');
  perform * from dblink('a1', v_sub) t(x text); perform * from dblink('a1', v_claim) t(x text);
  perform dblink_exec('a1','set role authenticated');
  perform * from dblink('a2', v_sub) t(x text); perform * from dblink('a2', v_claim) t(x text);
  perform dblink_exec('a2','set role authenticated');
  perform dblink_send_query('a1', v_call); perform dblink_send_query('a2', v_call);
  -- Collect in the order the race actually resolved. The loser is expected to
  -- be blocked on the winner, so naming a connection here instead of asking
  -- which is ready is what deadlocked the old harness.
  v_first := pg_temp.await_ready('proof 1 identical-converge', array['a1','a2']);
  v_second := case when v_first = 'a1' then 'a2' else 'a1' end;

  select o, l into v_o, v_l from dblink_get_result(v_first) as g(o text, l text);
  perform * from dblink_get_result(v_first) as g(o text, l text);
  insert into r1 values (v_first, v_o, v_l);
  -- Committing the finished worker releases whatever the other is waiting on.
  perform dblink_exec(v_first, 'commit');

  perform pg_temp.await_ready('proof 1 identical-converge (second)', array[v_second]);
  select o, l into v_o, v_l from dblink_get_result(v_second) as g(o text, l text);
  perform * from dblink_get_result(v_second) as g(o text, l text);
  insert into r1 values (v_second, v_o, v_l);
  perform dblink_exec(v_second, 'commit');

  perform dblink_disconnect('a1'); perform dblink_disconnect('a2');
  delete from worker_pids where conn in ('a1','a2');
exception when others then
  -- Bounded cleanup, then re-raise the ORIGINAL failure unchanged.
  perform pg_temp.abandon_workers(array['a1','a2']);
  raise;
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
  v_first text; v_second text; v_o text; v_l text;
begin
  perform pg_temp.worker_connect('b1', v_conn); perform pg_temp.worker_connect('b2', v_conn);
  perform dblink_exec('b1','begin'); perform dblink_exec('b2','begin');
  perform * from dblink('b1', v_sub) t(x text); perform * from dblink('b1', v_claim) t(x text);
  perform dblink_exec('b1','set role authenticated');
  perform * from dblink('b2', v_sub) t(x text); perform * from dblink('b2', v_claim) t(x text);
  perform dblink_exec('b2','set role authenticated');
  perform dblink_send_query('b1', v_c1); perform dblink_send_query('b2', v_c2);
  -- Collect in the order the race actually resolved. The loser is expected to
  -- be blocked on the winner, so naming a connection here instead of asking
  -- which is ready is what deadlocked the old harness.
  v_first := pg_temp.await_ready('proof 2 conflicting-keys', array['b1','b2']);
  v_second := case when v_first = 'b1' then 'b2' else 'b1' end;

  select o, l into v_o, v_l from dblink_get_result(v_first) as g(o text, l text);
  perform * from dblink_get_result(v_first) as g(o text, l text);
  insert into r2 values (v_first, v_o, v_l);
  -- Committing the finished worker releases whatever the other is waiting on.
  perform dblink_exec(v_first, 'commit');

  perform pg_temp.await_ready('proof 2 conflicting-keys (second)', array[v_second]);
  select o, l into v_o, v_l from dblink_get_result(v_second) as g(o text, l text);
  perform * from dblink_get_result(v_second) as g(o text, l text);
  insert into r2 values (v_second, v_o, v_l);
  perform dblink_exec(v_second, 'commit');

  perform dblink_disconnect('b1'); perform dblink_disconnect('b2');
  delete from worker_pids where conn in ('b1','b2');
exception when others then
  -- Bounded cleanup, then re-raise the ORIGINAL failure unchanged.
  perform pg_temp.abandon_workers(array['b1','b2']);
  raise;
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
  v_first text; v_second text; v_o text; v_s text;
begin
  perform pg_temp.worker_connect('c1', v_conn); perform pg_temp.worker_connect('c2', v_conn);
  perform dblink_exec('c1','begin'); perform dblink_exec('c2','begin');
  perform * from dblink('c1', v_sub) t(x text); perform * from dblink('c1', v_claim) t(x text);
  perform dblink_exec('c1','set role authenticated');
  perform * from dblink('c2', v_sub) t(x text); perform * from dblink('c2', v_claim) t(x text);
  perform dblink_exec('c2','set role authenticated');
  perform dblink_send_query('c1', v_ca); perform dblink_send_query('c2', v_cb);
  -- Collect in the order the race actually resolved. The loser is expected to
  -- be blocked on the winner, so naming a connection here instead of asking
  -- which is ready is what deadlocked the old harness.
  v_first := pg_temp.await_ready('proof 3 sku-converge', array['c1','c2']);
  v_second := case when v_first = 'c1' then 'c2' else 'c1' end;

  select o, s into v_o, v_s from dblink_get_result(v_first) as g(o text, s text);
  perform * from dblink_get_result(v_first) as g(o text, s text);
  insert into r3 values (v_first, v_o, v_s);
  -- Committing the finished worker releases whatever the other is waiting on.
  perform dblink_exec(v_first, 'commit');

  perform pg_temp.await_ready('proof 3 sku-converge (second)', array[v_second]);
  select o, s into v_o, v_s from dblink_get_result(v_second) as g(o text, s text);
  perform * from dblink_get_result(v_second) as g(o text, s text);
  insert into r3 values (v_second, v_o, v_s);
  perform dblink_exec(v_second, 'commit');

  perform dblink_disconnect('c1'); perform dblink_disconnect('c2');
  delete from worker_pids where conn in ('c1','c2');
exception when others then
  -- Bounded cleanup, then re-raise the ORIGINAL failure unchanged.
  perform pg_temp.abandon_workers(array['c1','c2']);
  raise;
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
  v_first text; v_second text; v_o text; v_v text;
begin
  perform pg_temp.worker_connect('d1', v_conn); perform pg_temp.worker_connect('d2', v_conn);
  perform dblink_exec('d1','begin'); perform dblink_exec('d2','begin');
  perform * from dblink('d1', v_sub) t(x text); perform * from dblink('d1', v_claim) t(x text);
  perform dblink_exec('d1','set role authenticated');
  perform * from dblink('d2', v_sub) t(x text); perform * from dblink('d2', v_claim) t(x text);
  perform dblink_exec('d2','set role authenticated');
  perform dblink_send_query('d1', v_call); perform dblink_send_query('d2', v_call);
  -- Collect in the order the race actually resolved. The loser is expected to
  -- be blocked on the winner, so naming a connection here instead of asking
  -- which is ready is what deadlocked the old harness.
  v_first := pg_temp.await_ready('proof 4 draft-edit-race', array['d1','d2']);
  v_second := case when v_first = 'd1' then 'd2' else 'd1' end;

  select o, vv into v_o, v_v from dblink_get_result(v_first) as g(o text, vv text);
  perform * from dblink_get_result(v_first) as g(o text, vv text);
  insert into r4 values (v_first, v_o, v_v);
  -- Committing the finished worker releases whatever the other is waiting on.
  perform dblink_exec(v_first, 'commit');

  perform pg_temp.await_ready('proof 4 draft-edit-race (second)', array[v_second]);
  select o, vv into v_o, v_v from dblink_get_result(v_second) as g(o text, vv text);
  perform * from dblink_get_result(v_second) as g(o text, vv text);
  insert into r4 values (v_second, v_o, v_v);
  perform dblink_exec(v_second, 'commit');

  perform dblink_disconnect('d1'); perform dblink_disconnect('d2');
  delete from worker_pids where conn in ('d1','d2');
exception when others then
  -- Bounded cleanup, then re-raise the ORIGINAL failure unchanged.
  perform pg_temp.abandon_workers(array['d1','d2']);
  raise;
end $$;

select is((select count(*)::int from r4 where outcome = 'ok'), 1,
  'exactly one concurrent edit won');
select is((select count(*)::int from r4 where outcome = 'conflict'), 1,
  'the other concurrent edit returned a structured stale_version conflict');
select is((select version from public.intake_draft_groups where id = (select v from cids where k='g4')::uuid), 2,
  'the winning edit bumped the version exactly once (no double increment, no overwrite)');


-- ============ PROOF 5 — the harness itself fails finitely and cleans up ============
-- Regression cover for the defect this file used to have. A worker that never
-- becomes ready must produce an explicit, bounded failure and leave no session
-- behind -- never an unbounded wait. Asserted here as the EXPECTED failure, so
-- the normal suite stays green while still proving the deadline fires.
create temp table selftest (k text primary key, v text);
grant all on table selftest to public;

-- A worker that will not finish inside any deadline we set.
do $$
begin
  perform pg_temp.worker_connect('z1', (select conn from dbconn));
  perform dblink_send_query('z1', 'select pg_sleep(30)');
end $$;

select throws_ok(
  $q$select pg_temp.await_ready('selftest', array['z1'], 1)$q$,
  '55P03',
  null,
  'a worker that never becomes ready raises an explicit deadline error rather than blocking');

do $$
declare
  v_started timestamptz;
  v_raised boolean := false;
  v_elapsed interval;
  v_left int;
  v_waited int := 0;
begin
  -- The deadline must be honoured in bounded time, not merely eventually.
  v_started := clock_timestamp();
  begin
    perform pg_temp.await_ready('selftest-timing', array['z1'], 1);
  exception when lock_not_available then
    v_raised := true;
  end;
  v_elapsed := clock_timestamp() - v_started;
  insert into selftest values ('raised', case when v_raised then 'yes' else 'no' end);
  insert into selftest values ('bounded',
    case when v_elapsed < interval '10 seconds' then 'yes' else 'no' end);

  -- Cleanup must actually stop the abandoned worker. Checked on STATE, not on
  -- query text: pg_stat_activity keeps the last statement visible on a backend
  -- that has already gone idle, so matching the text alone would report a
  -- worker still running long after it stopped.
  perform pg_temp.abandon_workers(array['z1']);
  loop
    -- pg_stat_activity is cached for the life of the transaction; without
    -- clearing it this loop would re-read the pre-cleanup snapshot forever.
    perform pg_stat_clear_snapshot();
    select count(*) into v_left from pg_stat_activity
     where datname = current_database() and pid <> pg_backend_pid()
       and state = 'active' and query like '%pg_sleep(30)%';
    exit when v_left = 0 or v_waited > 200;
    v_waited := v_waited + 1;
    perform pg_sleep(0.05);
  end loop;
  insert into selftest values ('worker_gone', case when v_left = 0 then 'yes' else 'no' end);
  -- And the connection itself must be released, not merely idled.
  insert into selftest values ('conn_released',
    case when 'z1' = any(coalesce(dblink_get_connections(), '{}'::text[]))
         then 'no' else 'yes' end);
end $$;

select is((select v from selftest where k = 'raised'), 'yes',
  'the deadline path raises rather than returning or blocking');
select is((select v from selftest where k = 'bounded'), 'yes',
  'the deadline is honoured in bounded time');
select is((select v from selftest where k = 'worker_gone'), 'yes',
  'cleanup cancelled the abandoned worker; no session is left running its query');
select is((select v from selftest where k = 'conn_released'), 'yes',
  'cleanup released the dblink connection');

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
