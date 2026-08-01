-- Genuinely overlapping media transactions.
--
-- The invariants that matter here cannot be proved by calling the functions in
-- sequence: two devices photographing the same shelf really do submit at the
-- same moment. Every wait is bounded and all worker sessions are disconnected
-- before teardown.
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(8);

create or replace function pg_temp.await_all(p_conns text[], p_seconds numeric default 20)
returns void language plpgsql as $$
declare v_started timestamptz := clock_timestamp(); v_conn text; v_busy boolean;
begin
  loop
    v_busy := false;
    foreach v_conn in array p_conns loop v_busy := v_busy or dblink_is_busy(v_conn) = 1; end loop;
    exit when not v_busy;
    if clock_timestamp() - v_started > make_interval(secs => p_seconds) then
      raise exception 'media concurrency deadline for %', p_conns using errcode = '55P03';
    end if;
    perform pg_sleep(.02);
  end loop;
end $$;

create temp table mm_worker_pids(conn text primary key, pid int);
create temp table mm_conn(dsn text);
insert into mm_conn values (case when current_setting('is_superuser') = 'on' then 'dbname=' || current_database()
  else format('host=%s port=%s dbname=%s user=postgres password=postgres',
    coalesce(host(inet_server_addr()), '127.0.0.1'),
    coalesce(inet_server_port()::text, current_setting('port')), current_database()) end);

create or replace function pg_temp.connect_worker(p_conn text) returns void language plpgsql as $$
declare p int;
begin
  perform dblink_connect(p_conn, (select dsn from mm_conn));
  select pid into p from dblink(p_conn, 'select pg_backend_pid()') t(pid int);
  insert into mm_worker_pids values (p_conn, p);
end $$;

create or replace function pg_temp.disconnect_workers(p_conns text[]) returns void language plpgsql as $$
declare c text; p int;
begin
  foreach c in array p_conns loop
    begin perform dblink_cancel_query(c); exception when others then null; end;
    select pid into p from mm_worker_pids where conn = c;
    if p is not null then perform pg_terminate_backend(p) from pg_stat_activity where pid = p and datname = current_database(); end if;
    begin perform dblink_disconnect(c); exception when others then null; end;
    delete from mm_worker_pids where conn = c;
  end loop;
end $$;

create or replace function pg_temp.auth_sql(p_call text) returns text language sql as $$
  select format($q$with auth as materialized (select set_config('request.jwt.claims',%L,false)) select (%s)::text from auth$q$,
    json_build_object('sub', 'ba111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, p_call)
$$;

create or replace function pg_temp.race(p_name text, p_left text, p_right text)
returns text[] language plpgsql as $$
declare cs text[] := array[p_name || '_1', p_name || '_2']; a text; b text;
begin
  perform pg_temp.connect_worker(cs[1]); perform pg_temp.connect_worker(cs[2]);
  perform dblink_send_query(cs[1], pg_temp.auth_sql(p_left));
  perform dblink_send_query(cs[2], pg_temp.auth_sql(p_right));
  perform pg_temp.await_all(cs, 20);
  select result into a from dblink_get_result(cs[1]) t(result text);
  select result into b from dblink_get_result(cs[2]) t(result text);
  perform pg_temp.disconnect_workers(cs);
  return array[a, b];
exception when others then perform pg_temp.disconnect_workers(cs); raise;
end $$;

create temp table mm_ids(k text primary key, v uuid);
grant all on mm_ids to public;

insert into auth.users(id, email) values
  ('ba111111-1111-4111-8111-111111111111', 'media-race@test.local');
insert into public.workspaces(id, name, created_by)
  values ('baaa0000-0000-4000-8000-000000000001', 'Media race', 'ba111111-1111-4111-8111-111111111111');

select set_config('request.jwt.claims',
  json_build_object('sub', 'ba111111-1111-4111-8111-111111111111', 'role', 'authenticated')::text, false);
set role authenticated;

select public.register_storage_location('baaa0000-0000-4000-8000-000000000001', 'BIN-R', null, 'Race bin');
insert into mm_ids values ('product', (public.register_product('baaa0000-0000-4000-8000-000000000001',
  'tcg', 'Race card', 'tcg|race|set|1', '{}')->>'id')::uuid);
insert into mm_ids values ('sku', (public.register_sellable_sku('baaa0000-0000-4000-8000-000000000001',
  (select v from mm_ids where k = 'product'), '{"product_format":"Raw card"}')->>'id')::uuid);
insert into mm_ids values ('lot', (public.stage_inventory_lot('baaa0000-0000-4000-8000-000000000001',
  'RV-R-0000000001', (select v from mm_ids where k = 'sku'), 'serialized', 1, 'BIN-R', 'test', '1.0.0', null)->>'id')::uuid);
insert into mm_ids values ('item', (public.mint_serialized_item('baaa0000-0000-4000-8000-000000000001',
  (select v from mm_ids where k = 'lot'), 'PSA', 'RACE-CERT', null)->>'id')::uuid);

-- Four committed photographs to fight over.
do $$
declare i int; v_id uuid;
begin
  for i in 1..4 loop
    v_id := (public.reserve_inventory_media('baaa0000-0000-4000-8000-000000000001', 'item',
      (select v from mm_ids where k = 'item'), 'image/jpeg', 1000 + i,
      ('bacccccc-000' || i || '-4000-8000-000000000001')::uuid,
      'p' || i || '.jpg', null, null, 'Photo ' || i)->>'media_id')::uuid;
    perform public.commit_inventory_media('baaa0000-0000-4000-8000-000000000001', v_id);
    insert into mm_ids values ('m' || i, v_id);
  end loop;
end $$;

reset role;
commit;

-- Two devices choose a different primary image at the same moment ------------
select pg_temp.race('primary',
  format($$public.set_primary_inventory_media('baaa0000-0000-4000-8000-000000000001',%L)$$,
    (select v from mm_ids where k = 'm2')),
  format($$public.set_primary_inventory_media('baaa0000-0000-4000-8000-000000000001',%L)$$,
    (select v from mm_ids where k = 'm3')));

select is(
  (select count(*)::int from public.inventory_media
    where coalesce(item_id, lot_id) = (select v from mm_ids where k = 'item')
      and lifecycle = 'active' and is_primary),
  1,
  'two simultaneous primary selections still leave exactly one primary image');

select ok(
  (select id from public.inventory_media
    where coalesce(item_id, lot_id) = (select v from mm_ids where k = 'item')
      and lifecycle = 'active' and is_primary)
  in ((select v from mm_ids where k = 'm2'), (select v from mm_ids where k = 'm3')),
  'and the winner is one of the two that were actually chosen');

-- Two devices reorder the same gallery at the same moment ---------------------
select pg_temp.race('reorder',
  format($$public.reorder_inventory_media('baaa0000-0000-4000-8000-000000000001','item',%L,array[%L,%L,%L,%L]::uuid[])$$,
    (select v from mm_ids where k = 'item'), (select v from mm_ids where k = 'm4'),
    (select v from mm_ids where k = 'm3'), (select v from mm_ids where k = 'm2'),
    (select v from mm_ids where k = 'm1')),
  format($$public.reorder_inventory_media('baaa0000-0000-4000-8000-000000000001','item',%L,array[%L,%L,%L,%L]::uuid[])$$,
    (select v from mm_ids where k = 'item'), (select v from mm_ids where k = 'm1'),
    (select v from mm_ids where k = 'm2'), (select v from mm_ids where k = 'm3'),
    (select v from mm_ids where k = 'm4')));

select is(
  (select count(distinct sort_order)::int from public.inventory_media
    where coalesce(item_id, lot_id) = (select v from mm_ids where k = 'item') and lifecycle = 'active'),
  4,
  'two simultaneous reorders never leave two photos sharing a position');

select is(
  (select count(*)::int from public.inventory_media
    where coalesce(item_id, lot_id) = (select v from mm_ids where k = 'item') and lifecycle = 'active'),
  4,
  'and no photo is lost or duplicated by the race');

select results_eq(
  $$ select sort_order from public.inventory_media
      where coalesce(item_id, lot_id) = (select v from mm_ids where k = 'item')
        and lifecycle = 'active' order by sort_order $$,
  $$ values (0), (1), (2), (3) $$,
  'the surviving order is a dense sequence, not a partial application of both');

-- Two devices delete the same photo at the same moment ------------------------
select pg_temp.race('delete',
  format($$public.soft_delete_inventory_media('baaa0000-0000-4000-8000-000000000001',%L,'race')$$,
    (select v from mm_ids where k = 'm1')),
  format($$public.soft_delete_inventory_media('baaa0000-0000-4000-8000-000000000001',%L,'race')$$,
    (select v from mm_ids where k = 'm1')));

select is(
  (select lifecycle from public.inventory_media where id = (select v from mm_ids where k = 'm1')),
  'deleted',
  'a doubly-deleted photo is deleted once, not corrupted');

select is(
  (select count(*)::int from public.inventory_media
    where coalesce(item_id, lot_id) = (select v from mm_ids where k = 'item')
      and lifecycle = 'active' and is_primary),
  1,
  'and the subject still has exactly one primary image afterwards');

select is(
  (select count(*)::int from pg_stat_activity where pid in (select pid from mm_worker_pids)),
  0,
  'all concurrency workers are cleaned up');

select * from finish();
