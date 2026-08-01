-- Genuinely overlapping listing preparation transactions.
--
-- Two operators really do open the same item at the same moment, and a bulk
-- action really does overlap with somebody working one record by hand. The
-- claims here cannot be proved by calling the functions in sequence: that a
-- record never ends up with two live preparations, that racing lifecycle
-- changes serialize instead of overwriting each other, and that overlapping
-- batches queue rather than deadlock. Every wait is bounded and all workers
-- are disconnected.
--
-- The assertions are written to be independent of WHICH racer wins and of how
-- the two transactions interleave. A concurrency test that encodes one
-- scheduling outcome passes on one machine and fails on another, which teaches
-- everybody to ignore it.
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(10);

create or replace function pg_temp.await_all(p_conns text[], p_seconds numeric default 20)
returns void language plpgsql as $$
declare v_started timestamptz := clock_timestamp(); v_conn text; v_busy boolean;
begin
  loop
    v_busy := false;
    foreach v_conn in array p_conns loop v_busy := v_busy or dblink_is_busy(v_conn) = 1; end loop;
    exit when not v_busy;
    if clock_timestamp() - v_started > make_interval(secs => p_seconds) then
      raise exception 'listing prep concurrency deadline for %', p_conns using errcode = '55P03';
    end if;
    perform pg_sleep(.02);
  end loop;
end $$;

create temp table lp_worker_pids(conn text primary key, pid int);
create temp table lp_conn(dsn text);
insert into lp_conn values (case when current_setting('is_superuser') = 'on' then 'dbname=' || current_database()
  else format('host=%s port=%s dbname=%s user=postgres password=postgres',
    coalesce(host(inet_server_addr()), '127.0.0.1'),
    coalesce(inet_server_port()::text, current_setting('port')), current_database()) end);

create or replace function pg_temp.connect_worker(p_conn text) returns void language plpgsql as $$
declare p int;
begin
  perform dblink_connect(p_conn, (select dsn from lp_conn));
  select pid into p from dblink(p_conn, 'select pg_backend_pid()') t(pid int);
  insert into lp_worker_pids values (p_conn, p);
end $$;

create or replace function pg_temp.disconnect_workers(p_conns text[]) returns void language plpgsql as $$
declare c text; p int;
begin
  foreach c in array p_conns loop
    begin perform dblink_cancel_query(c); exception when others then null; end;
    select pid into p from lp_worker_pids where conn = c;
    if p is not null then perform pg_terminate_backend(p) from pg_stat_activity where pid = p and datname = current_database(); end if;
    begin perform dblink_disconnect(c); exception when others then null; end;
    delete from lp_worker_pids where conn = c;
  end loop;
end $$;

-- Both racers run as the workspace OWNER, so an authority failure can never be
-- mistaken for the concurrency control doing its job.
create or replace function pg_temp.auth_sql(p_call text) returns text language sql as $$
  select format($q$with auth as materialized (select set_config('request.jwt.claims',%L,false)) select (%s)::text from auth$q$,
    json_build_object('sub', 'fa111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, p_call)
$$;

/** Runs two calls at once and returns both outcomes, errors included. */
create or replace function pg_temp.race(p_name text, p_left text, p_right text)
returns text[] language plpgsql as $$
declare cs text[] := array[p_name || '_1', p_name || '_2']; a text; b text;
begin
  perform pg_temp.connect_worker(cs[1]); perform pg_temp.connect_worker(cs[2]);
  perform dblink_send_query(cs[1], pg_temp.auth_sql(p_left));
  perform dblink_send_query(cs[2], pg_temp.auth_sql(p_right));
  perform pg_temp.await_all(cs, 20);
  begin select result into a from dblink_get_result(cs[1]) t(result text);
  exception when others then a := 'ERROR: ' || sqlerrm; end;
  begin select result into b from dblink_get_result(cs[2]) t(result text);
  exception when others then b := 'ERROR: ' || sqlerrm; end;
  perform pg_temp.disconnect_workers(cs);
  return array[a, b];
exception when others then perform pg_temp.disconnect_workers(cs); raise;
end $$;

create temp table lp_ids(k text primary key, v uuid);
grant all on lp_ids to public;

insert into auth.users(id, email) values
  ('fa111111-1111-4111-8111-111111111111', 'prep-race@test.local');
insert into public.workspaces(id, name, created_by)
  values ('faaa0000-0000-4000-8000-000000000001', 'Prep race',
          'fa111111-1111-4111-8111-111111111111');

select set_config('request.jwt.claims',
  json_build_object('sub', 'fa111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, false);
set role authenticated;

select public.register_storage_location('faaa0000-0000-4000-8000-000000000001', 'BIN-Q', null, 'Race bin');
insert into lp_ids values ('product', (public.register_product('faaa0000-0000-4000-8000-000000000001',
  'tcg', 'Race card', 'tcg|prep-race|1', '{}')->>'id')::uuid);
insert into lp_ids values ('sku', (public.register_sellable_sku('faaa0000-0000-4000-8000-000000000001',
  (select v from lp_ids where k = 'product'), '{"product_format":"Raw card"}')->>'id')::uuid);
insert into lp_ids values ('lot', (public.stage_inventory_lot('faaa0000-0000-4000-8000-000000000001',
  'RV-Q-0000000001', (select v from lp_ids where k = 'sku'), 'serialized', 3, 'BIN-Q', 'test', '1.0.0', null)->>'id')::uuid);
insert into lp_ids values ('item', (public.mint_serialized_item('faaa0000-0000-4000-8000-000000000001',
  (select v from lp_ids where k = 'lot'), null, null, 'RACE-1')->>'id')::uuid);
insert into lp_ids values ('item2', (public.mint_serialized_item('faaa0000-0000-4000-8000-000000000001',
  (select v from lp_ids where k = 'lot'), null, null, 'RACE-2')->>'id')::uuid);
insert into lp_ids values ('item3', (public.mint_serialized_item('faaa0000-0000-4000-8000-000000000001',
  (select v from lp_ids where k = 'lot'), null, null, 'RACE-3')->>'id')::uuid);

reset role;
commit;

-- Two operators press "prepare for listing" on the same item ------------------
select pg_temp.race('start',
  format($$public.start_listing_prep('faaa0000-0000-4000-8000-000000000001','item',%L)$$,
    (select v from lp_ids where k = 'item')),
  format($$public.start_listing_prep('faaa0000-0000-4000-8000-000000000001','item',%L)$$,
    (select v from lp_ids where k = 'item')));

select is(
  (select count(*)::int from public.listing_prep
    where coalesce(item_id, lot_id) = (select v from lp_ids where k = 'item')),
  1,
  'two simultaneous starts leave exactly one preparation, not two for the same goods');

select is(
  (select count(*)::int from public.listing_prep_events e
     join public.listing_prep p on p.id = e.prep_id
    where coalesce(p.item_id, p.lot_id) = (select v from lp_ids where k = 'item')
      and e.event_type = 'started'),
  1,
  'and exactly one start is recorded in the history');

insert into lp_ids values ('prep', (select id from public.listing_prep
  where coalesce(item_id, lot_id) = (select v from lp_ids where k = 'item')));

-- Two people move the same preparation at the same moment ---------------------
select pg_temp.race('transition',
  format($$public.transition_listing_prep('faaa0000-0000-4000-8000-000000000001',%L,'blocked','waiting on grading')$$,
    (select v from lp_ids where k = 'prep')),
  format($$public.transition_listing_prep('faaa0000-0000-4000-8000-000000000001',%L,'needs_review')$$,
    (select v from lp_ids where k = 'prep')));

select ok(
  (select status from public.listing_prep where id = (select v from lp_ids where k = 'prep'))
    in ('blocked', 'needs_review'),
  'a racing pair of transitions lands on one of the two, never on something else');

-- Both attempts may legally land. If the loser reads the row before the winner
-- commits, the state machine rejects it and one transition is recorded; if the
-- winner has already committed and released the lock, `blocked -> needs_review`
-- is a legal move and two are recorded as a chain. Both are the lock working.
--
-- What must NEVER happen is two transitions recorded from the SAME starting
-- status. That is the signature of a lost update: each racer read the row
-- before the other wrote, and both applied over the top of it.
select is(
  (select count(*)::int from (
     select e.from_status from public.listing_prep_events e
      where e.prep_id = (select v from lp_ids where k = 'prep')
        and e.from_status is not null
      group by e.from_status having count(*) > 1) d),
  0,
  'no two transitions were applied from the same starting status');

-- And the recorded transitions form one gapless chain rather than two
-- competing branches: exactly one to_status is never consumed as another
-- event's from_status, and that head is the status the record actually holds.
select is(
  (select e.to_status::text from public.listing_prep_events e
    where e.prep_id = (select v from lp_ids where k = 'prep')
      and e.to_status is not null
      and not exists (
        select 1 from public.listing_prep_events e2
         where e2.prep_id = e.prep_id and e2.from_status = e.to_status)),
  (select status::text from public.listing_prep
    where id = (select v from lp_ids where k = 'prep')),
  'and the record holds exactly the status its last recorded transition set');

select ok(
  (select status <> 'blocked' or blocked_reason is not null
     from public.listing_prep where id = (select v from lp_ids where k = 'prep')),
  'a blocked record still carries its reason after the race');

-- Two overlapping bulk actions over the same records --------------------------
-- Bulk work locks each record in id order, so two batches that share records
-- queue behind each other rather than each holding what the other needs.
select public.start_listing_prep('faaa0000-0000-4000-8000-000000000001', 'item',
  (select v from lp_ids where k = 'item2'));
select public.start_listing_prep('faaa0000-0000-4000-8000-000000000001', 'item',
  (select v from lp_ids where k = 'item3'));

insert into lp_ids values ('prep2', (select id from public.listing_prep
  where coalesce(item_id, lot_id) = (select v from lp_ids where k = 'item2')));
insert into lp_ids values ('prep3', (select id from public.listing_prep
  where coalesce(item_id, lot_id) = (select v from lp_ids where k = 'item3')));

select pg_temp.race('bulk',
  format($$public.bulk_listing_prep_action('faaa0000-0000-4000-8000-000000000001',array[%L,%L]::uuid[],'set_priority','{"priority":"urgent"}'::jsonb)$$,
    (select v from lp_ids where k = 'prep2'), (select v from lp_ids where k = 'prep3')),
  format($$public.bulk_listing_prep_action('faaa0000-0000-4000-8000-000000000001',array[%L,%L]::uuid[],'set_priority','{"priority":"low"}'::jsonb)$$,
    (select v from lp_ids where k = 'prep3'), (select v from lp_ids where k = 'prep2')));

select is(
  (select count(distinct priority)::int from public.listing_prep
    where id in ((select v from lp_ids where k = 'prep2'), (select v from lp_ids where k = 'prep3'))),
  1,
  'two overlapping batches do not interleave: both records end on the same priority');

select ok(
  (select bool_and(priority in ('urgent', 'low')) from public.listing_prep
    where id in ((select v from lp_ids where k = 'prep2'), (select v from lp_ids where k = 'prep3'))),
  'and that priority is one of the two that were actually requested');

-- Neither batch was lost to a deadlock: both records were touched.
select is(
  (select count(*)::int from public.listing_prep_events
    where prep_id in ((select v from lp_ids where k = 'prep2'), (select v from lp_ids where k = 'prep3'))
      and event_type = 'priority_changed'),
  4,
  'both batches completed rather than one dying in a deadlock');

select is(
  (select count(*)::int from pg_stat_activity where pid in (select pid from lp_worker_pids)),
  0,
  'all concurrency workers are cleaned up');

select * from finish();
