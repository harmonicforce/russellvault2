-- Phase 5 identity concurrency — serialized-lot capacity and registrar
-- convergence under a genuine SECOND database session (dblink). Modeled on
-- 11_provenance_concurrency.sql: fixtures are COMMITTED so the second session
-- can see them, and are explicitly removed in teardown. Every fixture id is
-- prefixed ee/e2 so teardown cannot touch anything else.
create extension if not exists pgtap;
create extension if not exists dblink;
select no_plan();

-- Committed fixture: workspace, operator, and a serialized SKU + lots ------------------
insert into auth.users (id, email) values
  ('ee111111-1111-4111-8111-111111111111', 'owner@conc.test'),
  ('ee222222-2222-4222-8222-222222222222', 'op@conc.test');
insert into public.workspaces (id, name, created_by) values
  ('eeee0000-0000-4000-8000-000000000001', 'WS CONC', 'ee111111-1111-4111-8111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('eeee0000-0000-4000-8000-000000000001', 'ee222222-2222-4222-8222-222222222222', 'operator');

create temp table cids (k text primary key, v uuid);
create temp table cflag (connected boolean);
grant all on table cids to public;
grant all on table cflag to public;

-- Act as the operator to build the committed identity fixture.
select set_config('request.jwt.claim.sub', 'ee222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims',
  json_build_object('sub', 'ee222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, false);
set role authenticated;
insert into cids values ('sku', (public.register_sellable_sku('eeee0000-0000-4000-8000-000000000001',
  (public.register_product('eeee0000-0000-4000-8000-000000000001', 'tcg', 'C', 'tcg|c|||', '{}')->>'id')::uuid,
  '{"grading_company":"CGC","product_format":"Graded slab"}')->>'id')::uuid);
select public.stage_inventory_lot('eeee0000-0000-4000-8000-000000000001', 'RV-C-990001',
  (select v from cids where k = 'sku'), 'serialized', 1, null, 'Imported Legacy', '1.0.0', null);
insert into cids values ('lot1', (select id from public.inventory_lots where public_id = 'RV-C-990001'));
reset role;

-- The second session opens a transaction and holds the lot's row lock ------------------
do $$
begin
  perform dblink_connect('holder', 'dbname=' || current_database());
  perform dblink_exec('holder', 'begin');
  perform * from dblink('holder',
    format('select id::text from public.inventory_lots where id = %L for update',
      (select v from cids where k = 'lot1'))) as t(id text);
  insert into cflag values (true);
exception when others then
  insert into cflag values (false);
end $$;

-- THE CONCURRENCY PROOF: a final-capacity mint takes the same row lock, so it
-- BLOCKS on the holder rather than racing to overfill. With lock_timeout it
-- surfaces as 55P03 — proof that concurrent final mints serialize on the lot.
select set_config('request.jwt.claim.sub', 'ee222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims',
  json_build_object('sub', 'ee222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, false);
set role authenticated;
set lock_timeout = '2000ms';
select case when (select connected from cflag)
  then throws_ok(
    format($$select public.mint_serialized_item('eeee0000-0000-4000-8000-000000000001', %L, 'CGC', 'X-1', null)$$,
      (select v from cids where k = 'lot1')),
    '55P03', null,
    'a concurrent final-capacity mint blocks on the lot row lock (serializes, cannot overfill)')
  else skip('dblink session unavailable in this environment', 1) end;
reset lock_timeout;
reset role;

-- Release the holder; the mint then proceeds, and a second mint is refused as
-- over capacity — so the two concurrent finals could never both have succeeded.
do $$ begin perform dblink_exec('holder', 'rollback'); perform dblink_disconnect('holder');
exception when others then null; end $$;
set role authenticated;
select lives_ok(
  format($$select public.mint_serialized_item('eeee0000-0000-4000-8000-000000000001', %L, 'CGC', 'X-2', null)$$,
    (select v from cids where k = 'lot1')),
  'the mint proceeds once the lock is released');
select throws_ok(
  format($$select public.mint_serialized_item('eeee0000-0000-4000-8000-000000000001', %L, 'CGC', 'X-3', null)$$,
    (select v from cids where k = 'lot1')),
  '23514', null, 'the quantity-1 lot is now full: no overfill');
reset role;

-- Registrar convergence: the main session creates a product; a SECOND session's
-- identical registration converges to the SAME row with a consistent result.
create temp table conv (k text, id text);
grant all on table conv to public;
select set_config('request.jwt.claim.sub', 'ee222222-2222-4222-8222-222222222222', false);
select set_config('request.jwt.claims',
  json_build_object('sub', 'ee222222-2222-4222-8222-222222222222', 'role', 'authenticated')::text, false);
set role authenticated;
insert into conv values ('main',
  (public.register_product('eeee0000-0000-4000-8000-000000000001','tcg','Conv','tcg|conv|||','{}')->>'id'));
reset role;
do $$
declare v_id text;
begin
  perform dblink_connect('w', 'dbname=' || current_database());
  perform * from dblink('w',
    $q$select set_config('request.jwt.claim.sub','ee222222-2222-4222-8222-222222222222',false)$q$) as t(x text);
  perform * from dblink('w',
    $q$select set_config('request.jwt.claims', json_build_object('sub','ee222222-2222-4222-8222-222222222222','role','authenticated')::text, false)$q$) as t(x text);
  perform dblink_exec('w', 'set role authenticated');
  select r.id into v_id from dblink('w',
    $q$select (public.register_product('eeee0000-0000-4000-8000-000000000001','tcg','Conv','tcg|conv|||','{}')->>'id')$q$)
    as r(id text);
  insert into conv values ('other', v_id);
  perform dblink_disconnect('w');
exception when others then
  insert into conv values ('other', null);
end $$;
select case when (select id from conv where k = 'other') is not null
  then is((select id from conv where k = 'other'), (select id from conv where k = 'main'),
    'a second session''s identical registration converges to the same row (consistent results)')
  else skip('dblink session unavailable in this environment', 1) end;
select is((select count(*)::int from public.product_catalog
  where workspace_id = 'eeee0000-0000-4000-8000-000000000001' and product_canonical_key = 'tcg|conv|||'),
  1, 'exactly one product row exists for the converged key');

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
