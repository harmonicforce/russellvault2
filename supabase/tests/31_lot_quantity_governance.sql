-- Coverage for governed quantity: adjustments, recount, split, merge, and what
-- stops being stock.
--
-- The claims under test are the ones that decide whether inventory numbers can
-- be trusted:
--   * quantity never goes below zero, and never changes without a record;
--   * a stale expected quantity conflicts instead of overwriting newer work;
--   * a split conserves units exactly and keeps SKU identity;
--   * lots merge only when genuinely compatible, never on a matching name;
--   * absorbed lots stop counting as stock but stay readable;
--   * every new table is workspace-isolated against a neighbour with data.
begin;
create extension if not exists pgtap with schema public;
select no_plan();

create or replace function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.put(k text, v uuid) returns void language plpgsql as $$
begin
  perform set_config('pgtmp.' || k, coalesce(v::text, ''), true);
end $$;

create or replace function pg_temp.get(k text) returns uuid language sql stable as $$
  select nullif(current_setting('pgtmp.' || k, true), '')::uuid
$$;

insert into auth.users (id, email) values
  ('aa111111-1111-4111-8111-111111111111', 'owner-a@test.local'),
  ('bb222222-2222-4222-8222-222222222222', 'owner-b@test.local'),
  ('cc333333-3333-4333-8333-333333333333', 'viewer-a@test.local')
on conflict do nothing;

insert into public.workspaces (id, name, created_by) values
  ('a1111111-1111-4111-8111-111111111111', 'WS A', 'aa111111-1111-4111-8111-111111111111'),
  ('b2222222-2222-4222-8222-222222222222', 'WS B', 'bb222222-2222-4222-8222-222222222222');

-- Structure ---------------------------------------------------------------------
select has_table('public', 'inventory_quantity_adjustments',
  'quantity changes have a permanent home');
select has_table('public', 'inventory_lot_lineage',
  'splits and merges have a permanent home');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.inventory_quantity_adjustments'::regclass),
  'quantity adjustments enforce row-level security');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.inventory_lot_lineage'::regclass),
  'lot lineage enforces row-level security');

-- The client can never write these tables directly; the governed functions are
-- the only path in.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_name in ('inventory_quantity_adjustments', 'inventory_lot_lineage',
                         'inventory_lots')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'authenticated holds no direct write grant on lots, adjustments or lineage');

-- Fixtures ----------------------------------------------------------------------
select pg_temp.login('aa111111-1111-4111-8111-111111111111');
select public.register_storage_location(
  'a1111111-1111-4111-8111-111111111111', 'SHELF-1', null, 'Shelf 1');
select public.register_storage_location(
  'a1111111-1111-4111-8111-111111111111', 'SHELF-2', null, 'Shelf 2');

select pg_temp.put('prod', (public.register_product(
  'a1111111-1111-4111-8111-111111111111', 'tcg', 'Jungle Booster Box', 'tcg|jungle|box',
  '{"set_name":"Jungle"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku', (public.register_sellable_sku(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('prod'),
  '{"product_format":"Booster Box","condition_or_quality":"Sealed"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku2', (public.register_sellable_sku(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('prod'),
  '{"product_format":"Elite Trainer Box","condition_or_quality":"Sealed"}'::jsonb)->>'id')::uuid);

select pg_temp.put('lot', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000001001', pg_temp.get('sku'),
  'lot_managed', 12, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('slot', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000001002', pg_temp.get('sku'),
  'serialized', 1, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);

-- Adjusting ---------------------------------------------------------------------
select lives_ok(
  format($$select public.adjust_lot_quantity(%L, %L, 3, 'received', 12, 'second shipment')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  'receiving more stock raises the quantity');

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('lot')),
  15,
  'the lot now holds fifteen');

select is(
  (select resulting_quantity from public.inventory_quantity_adjustments
     where lot_id = pg_temp.get('lot') and reason = 'received'),
  15,
  'the adjustment records where the quantity landed');

select is(
  (select previous_quantity from public.inventory_quantity_adjustments
     where lot_id = pg_temp.get('lot') and reason = 'received'),
  12,
  'and where it started');

select throws_ok(
  format($$select public.adjust_lot_quantity(%L, %L, -100, 'damaged', null, 'crushed')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  '23514', null,
  'quantity can never be driven below zero');

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('lot')),
  15,
  'and the refused adjustment changed nothing');

select throws_ok(
  format($$select public.adjust_lot_quantity(%L, %L, 1, 'received', 99)$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  '40001', null,
  'a stale expected quantity CONFLICTS rather than overwriting newer work');

select throws_ok(
  format($$select public.adjust_lot_quantity(%L, %L, 0, 'recount')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  '23514', null,
  'an adjustment of zero is refused rather than written as a no-op event');

select throws_ok(
  format($$select public.adjust_lot_quantity(%L, %L, -1, 'other')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  '23514', null,
  'a reason of "other" without a note is refused — "other" is not an explanation');

select throws_ok(
  format($$select public.adjust_lot_quantity(%L, %L, 1, 'received')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('slot')),
  '23514', null,
  'a serialized lot''s quantity is its unit count and cannot be adjusted directly');

-- The history is evidence.
select throws_ok(
  format($$update public.inventory_quantity_adjustments set change_amount = 999
           where lot_id = %L$$, pg_temp.get('lot')),
  null, null,
  'a written adjustment cannot be edited');

-- Recount -----------------------------------------------------------------------
select lives_ok(
  format($$select public.recount_lot_quantity(%L, %L, 11, 15, 'shelf count')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  'a recount states the number found, not the difference');

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('lot')),
  11,
  'the lot holds what was counted');

-- Selected by reason rather than by "the latest": every write inside one
-- transaction shares its now(), so adjusted_at cannot order them here.
select is(
  (select change_amount from public.inventory_quantity_adjustments
     where lot_id = pg_temp.get('lot') and reason = 'recount'),
  -4,
  'and the difference is computed and recorded, not typed by the operator');

select is(
  ((public.recount_lot_quantity('a1111111-1111-4111-8111-111111111111',
      pg_temp.get('lot'), 11))->>'unchanged')::boolean,
  true,
  'counting the same number again writes no adjustment');

-- Splitting -----------------------------------------------------------------------
select throws_ok(
  format($$select public.split_inventory_lot(%L, %L, 0, 'SHELF-2')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  '23514', null,
  'a split of zero is refused');

select throws_ok(
  format($$select public.split_inventory_lot(%L, %L, 999, 'SHELF-2')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  '23514', null,
  'a split larger than the lot is refused');

select throws_ok(
  format($$select public.split_inventory_lot(%L, %L, 11, 'SHELF-2')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  '23514', null,
  'splitting the WHOLE lot is refused and points at Move Entire Lot');

select throws_ok(
  format($$select public.split_inventory_lot(%L, %L, 4, 'NOWHERE')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  '23514', null,
  'a split into a location that does not exist is refused');

select pg_temp.put('child', (public.split_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot'), 4, 'SHELF-2',
  'half to the other shelf')->>'child_lot_id')::uuid);

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('lot')),
  7,
  'the source lot shrank by exactly the split quantity');

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('child')),
  4,
  'the child lot holds exactly the split quantity');

select is(
  (select l.quantity + c.quantity
     from public.inventory_lots l, public.inventory_lots c
    where l.id = pg_temp.get('lot') and c.id = pg_temp.get('child')),
  11,
  'a split conserves units exactly — nothing is created or destroyed');

select is(
  (select sku_id from public.inventory_lots where id = pg_temp.get('child')),
  (select sku_id from public.inventory_lots where id = pg_temp.get('lot')),
  'the child carries the SAME SKU — a location split does not invent a product');

select is(
  (select loc.location_code from public.inventory_lots l
     join public.storage_locations loc on loc.id = l.location_id
    where l.id = pg_temp.get('child')),
  'SHELF-2',
  'the child lot is in the chosen destination');

select is(
  (select count(*)::int from public.inventory_lot_lineage
    where parent_lot_id = pg_temp.get('lot')
      and child_lot_id = pg_temp.get('child') and event_kind = 'split'),
  1,
  'the split is recorded as lineage linking parent and child');

select ok(
  (select public_id ~ '^RV-[A-Z]{1,6}-[0-9]{4,10}$' from public.inventory_lots
    where id = pg_temp.get('child')),
  'the child lot gets a governed public id in the lot format');

-- Merging -------------------------------------------------------------------------
-- A second lot of the SAME sku on the SAME shelf: genuinely compatible.
select pg_temp.put('mergeable', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000001003', pg_temp.get('sku'),
  'lot_managed', 5, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
-- Same shelf, DIFFERENT sku: not compatible, however similar the name.
select pg_temp.put('other_sku_lot', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000001004', pg_temp.get('sku2'),
  'lot_managed', 2, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);

select is(
  ((public.lot_merge_compatibility('a1111111-1111-4111-8111-111111111111',
      pg_temp.get('lot'), pg_temp.get('mergeable')))->>'compatible')::boolean,
  true,
  'same sku, same location, both active: compatible');

select is(
  ((public.lot_merge_compatibility('a1111111-1111-4111-8111-111111111111',
      pg_temp.get('lot'), pg_temp.get('other_sku_lot')))->>'compatible')::boolean,
  false,
  'a different SKU is not mergeable, however similar the display name');

select is(
  ((public.lot_merge_compatibility('a1111111-1111-4111-8111-111111111111',
      pg_temp.get('lot'), pg_temp.get('child')))->>'compatible')::boolean,
  false,
  'the same SKU in a DIFFERENT location is not mergeable');

select is(
  ((public.lot_merge_compatibility('a1111111-1111-4111-8111-111111111111',
      pg_temp.get('lot'), pg_temp.get('slot')))->>'compatible')::boolean,
  false,
  'individually tracked units are never merged');

select is(
  ((public.lot_merge_compatibility('a1111111-1111-4111-8111-111111111111',
      pg_temp.get('lot'), pg_temp.get('lot')))->>'compatible')::boolean,
  false,
  'a lot cannot merge with itself');

select throws_ok(
  format($$select public.merge_inventory_lots(%L, %L, array[%L]::uuid[])$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot'), pg_temp.get('other_sku_lot')),
  '23514', null,
  'the merge function refuses an incompatible pair, not just the checker');

select lives_ok(
  format($$select public.merge_inventory_lots(%L, %L, array[%L]::uuid[], 'consolidating')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot'), pg_temp.get('mergeable')),
  'compatible lots merge');

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('lot')),
  12,
  'the survivor holds the combined quantity (7 + 5)');

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('mergeable')),
  0,
  'the absorbed lot holds nothing');

select is(
  (select lot_state from public.inventory_lots where id = pg_temp.get('mergeable')),
  'absorbed'::public.inventory_lot_state,
  'the absorbed lot is marked absorbed, NOT deleted');

select is(
  (select count(*)::int from public.inventory_lot_lineage
    where parent_lot_id = pg_temp.get('mergeable')
      and child_lot_id = pg_temp.get('lot') and event_kind = 'merge'),
  1,
  'the merge is recorded as lineage');

select ok(
  (select count(*) from public.inventory_quantity_adjustments
    where lot_id = pg_temp.get('mergeable') and reason = 'lot_merge') > 0,
  'the absorbed lot''s own quantity history explains where its stock went');

-- What stops being stock ------------------------------------------------------------
select is(
  (select count(*)::int from public.inventory_record_overview
    where record_id = pg_temp.get('mergeable')),
  0,
  'an absorbed lot leaves the record stream — its stock is counted in the survivor');

select is(
  (select count(*)::int from public.inventory_lot_overview
    where lot_id = pg_temp.get('mergeable')),
  1,
  'but it is still readable for its own detail page and history');

select throws_ok(
  format($$select public.move_inventory_lot(%L, %L, 'SHELF-2')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('mergeable')),
  '23514', null,
  'an absorbed lot cannot be moved as available inventory');

select throws_ok(
  format($$select public.adjust_lot_quantity(%L, %L, 1, 'received')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('mergeable')),
  '23514', null,
  'and its quantity cannot be adjusted back into existence');

-- A zero-quantity ACTIVE lot is different: still stock the operator must see.
select public.adjust_lot_quantity('a1111111-1111-4111-8111-111111111111',
  pg_temp.get('other_sku_lot'), -2, 'damaged', 2, 'water damage');

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('other_sku_lot')),
  0,
  'a lot can legitimately reach zero');

select is(
  (select count(*)::int from public.inventory_record_overview
    where record_id = pg_temp.get('other_sku_lot')),
  1,
  'an emptied but active lot stays visible — the operator has to see it');

select is(
  (select is_available from public.inventory_record_overview
    where record_id = pg_temp.get('other_sku_lot')),
  false,
  'but it is flagged as unavailable, not counted as stock on hand');

select throws_ok(
  format($$select public.move_inventory_lot(%L, %L, 'SHELF-2')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('other_sku_lot')),
  '23514', null,
  'an empty lot cannot be moved as available inventory');

-- Permissions -------------------------------------------------------------------------
select pg_temp.login('cc333333-3333-4333-8333-333333333333');
select throws_ok(
  format($$select public.adjust_lot_quantity(%L, %L, 1, 'received')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  null, null,
  'a non-member cannot adjust a quantity');

select throws_ok(
  format($$select public.split_inventory_lot(%L, %L, 1, 'SHELF-2')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  null, null,
  'a non-member cannot split a lot');

select throws_ok(
  format($$select public.merge_inventory_lots(%L, %L, array[%L]::uuid[])$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot'), pg_temp.get('child')),
  null, null,
  'a non-member cannot merge lots');

-- Workspace isolation -------------------------------------------------------------------
select pg_temp.login('bb222222-2222-4222-8222-222222222222');
select public.register_storage_location(
  'b2222222-2222-4222-8222-222222222222', 'B-SHELF', null, 'B Shelf');
select pg_temp.put('prod_b', (public.register_product(
  'b2222222-2222-4222-8222-222222222222', 'tcg', 'B Box', 'tcg|b|box',
  '{"set_name":"B"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku_b', (public.register_sellable_sku(
  'b2222222-2222-4222-8222-222222222222', pg_temp.get('prod_b'),
  '{"product_format":"Booster Box"}'::jsonb)->>'id')::uuid);
select pg_temp.put('lot_b', (public.stage_inventory_lot(
  'b2222222-2222-4222-8222-222222222222', 'RV-T-0000002001', pg_temp.get('sku_b'),
  'lot_managed', 6, 'B-SHELF', 'test', '1.0.0', null)->>'id')::uuid);

select is(
  (select count(*)::int from public.inventory_quantity_adjustments
    where workspace_id = 'a1111111-1111-4111-8111-111111111111'),
  0,
  'workspace B cannot read workspace A''s quantity history');

select is(
  (select count(*)::int from public.inventory_lot_lineage
    where workspace_id = 'a1111111-1111-4111-8111-111111111111'),
  0,
  'workspace B cannot read workspace A''s lot lineage');

select throws_ok(
  format($$select public.adjust_lot_quantity(%L, %L, 1, 'received')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  null, null,
  'workspace B cannot adjust a quantity in workspace A');

select throws_ok(
  format($$select public.adjust_lot_quantity(%L, %L, 1, 'received')$$,
    'b2222222-2222-4222-8222-222222222222', pg_temp.get('lot')),
  '23514', null,
  'and cannot reach A''s lot by passing its OWN workspace id');

select throws_ok(
  format($$select public.merge_inventory_lots(%L, %L, array[%L]::uuid[])$$,
    'b2222222-2222-4222-8222-222222222222', pg_temp.get('lot_b'), pg_temp.get('lot')),
  '23514', null,
  'a lot cannot be merged across a workspace boundary');

select throws_ok(
  format($$select public.split_inventory_lot(%L, %L, 1, 'B-SHELF')$$,
    'b2222222-2222-4222-8222-222222222222', pg_temp.get('lot')),
  '23514', null,
  'a neighbour''s lot cannot be split into this workspace');

select pg_temp.logout();
select * from finish();
rollback;
