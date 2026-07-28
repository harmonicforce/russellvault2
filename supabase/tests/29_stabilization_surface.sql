-- Regression coverage for the additive 20260728 migrations: media storage and
-- RLS, item-level location, governed movement, retired-location refusal,
-- read-model workspace isolation, multi-category identity, and the per-unit
-- identifier rule.
begin;
create extension if not exists pgtap with schema public;
select no_plan();

-- Fixtures --------------------------------------------------------------------
-- Two workspaces so every isolation claim is tested against a real neighbour
-- that holds data, not against an empty database.
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
  ('bb222222-2222-4222-8222-222222222222', 'owner-b@test.local')
on conflict do nothing;

insert into public.workspaces (id, name, created_by) values
  ('a1111111-1111-4111-8111-111111111111', 'WS A', 'aa111111-1111-4111-8111-111111111111'),
  ('b2222222-2222-4222-8222-222222222222', 'WS B', 'bb222222-2222-4222-8222-222222222222');

-- Storage bucket configuration ------------------------------------------------
select has_column('storage', 'buckets', 'file_size_limit',
  'the storage surface exposes file_size_limit (the shim must match the platform)');
select has_column('storage', 'buckets', 'allowed_mime_types',
  'the storage surface exposes allowed_mime_types');

select is(
  (select public from storage.buckets where id = 'inventory-media'),
  false,
  'the inventory-media bucket is PRIVATE — inventory photos are never world-readable');

select is(
  (select file_size_limit from storage.buckets where id = 'inventory-media'),
  20971520::bigint,
  'the inventory-media bucket caps uploads at 20 MB');

select ok(
  (select allowed_mime_types from storage.buckets where id = 'inventory-media')
    @> array['image/jpeg', 'image/png'],
  'the inventory-media bucket accepts ordinary photo types');

select ok(
  not ((select allowed_mime_types from storage.buckets where id = 'inventory-media')
    && array['application/x-msdownload', 'text/html', 'application/javascript']),
  'the inventory-media bucket refuses executable and markup content types');

-- Media table shape and RLS ---------------------------------------------------
select has_table('public', 'inventory_media', 'inventory media are recorded');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.inventory_media'::regclass),
  'inventory_media enforces row-level security');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_name = 'inventory_media' and grantee = 'anon'),
  0,
  'anon holds no grant on inventory media');

-- A media row must belong to a subject in the SAME workspace.
select ok(
  not app.media_subject_in_workspace(
    'b2222222-2222-4222-8222-222222222222', 'item',
    '00000000-0000-4000-8000-000000000000', null),
  'a media subject in another workspace is refused');

select ok(
  app.media_path_matches_workspace(
    'a1111111-1111-4111-8111-111111111111',
    'a1111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/x.jpg'),
  'a storage path under the workspace folder is accepted');

select ok(
  not app.media_path_matches_workspace(
    'a1111111-1111-4111-8111-111111111111',
    'b2222222-2222-4222-8222-222222222222/22222222-2222-4222-8222-222222222222/x.jpg'),
  'a storage path under ANOTHER workspace folder is refused');

-- Item-level location ---------------------------------------------------------
select has_column('public', 'inventory_items', 'location_id',
  'a serialized item carries its own location, independent of its lot');

-- Movement --------------------------------------------------------------------
select has_table('public', 'inventory_movements', 'movement history is recorded');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.inventory_movements'::regclass),
  'inventory_movements enforces row-level security');

-- Build real inventory in workspace A to move.
select pg_temp.login('aa111111-1111-4111-8111-111111111111');
select pg_temp.put('loc1', (public.register_storage_location(
  'a1111111-1111-4111-8111-111111111111', 'SHELF-1', null, 'Shelf 1')->>'id')::uuid);
select pg_temp.put('loc2', (public.register_storage_location(
  'a1111111-1111-4111-8111-111111111111', 'SHELF-2', null, 'Shelf 2')->>'id')::uuid);
select pg_temp.put('retired', (public.register_storage_location(
  'a1111111-1111-4111-8111-111111111111', 'OLD-BIN', null, 'Old bin')->>'id')::uuid);
select public.retire_storage_location('a1111111-1111-4111-8111-111111111111', 'OLD-BIN');

select pg_temp.put('prod', (public.register_product(
  'a1111111-1111-4111-8111-111111111111', 'other', 'Test Widget', 'other|test widget',
  '{"brand":"Acme"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku', (public.register_sellable_sku(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('prod'),
  '{"condition_or_quality":"New"}'::jsonb)->>'id')::uuid);
select pg_temp.put('lot', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000000001', pg_temp.get('sku'),
  'lot_managed', 5, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('slot', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000000002', pg_temp.get('sku'),
  'serialized', 2, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('item', (public.mint_serialized_item(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('slot'), null, null, 'SER-A')->>'id')::uuid);
select pg_temp.put('item2', (public.mint_serialized_item(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('slot'), null, null, 'SER-B')->>'id')::uuid);

-- A newly minted serialized item inherits its lot's location.
select is(
  (select location_id from public.inventory_items where id = pg_temp.get('item')),
  pg_temp.get('loc1'),
  'a newly minted serialized item starts in its lot''s location');

-- Item movement moves ONLY that item.
select lives_ok(
  format($$select public.move_inventory_item(%L, %L, 'SHELF-2', 'moved for test')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('item')),
  'a serialized item moves to an active location');

select is(
  (select location_id from public.inventory_items where id = pg_temp.get('item')),
  pg_temp.get('loc2'),
  'the moved item reports its new location');

select is(
  (select location_id from public.inventory_items where id = pg_temp.get('item2')),
  pg_temp.get('loc1'),
  'a sibling unit in the same lot did NOT move');

select is(
  (select count(*)::int from public.inventory_movements
   where item_id = pg_temp.get('item')),
  1,
  'the item move is recorded exactly once in history');

select is(
  (select to_location_id from public.inventory_movements where item_id = pg_temp.get('item')),
  pg_temp.get('loc2'),
  'the movement records where the item went');

-- Append-only, asserted against a row that actually exists: a statement
-- matching nothing fires no row trigger and would prove nothing.
select pg_temp.logout();
select throws_ok($$
  update public.inventory_movements set note = 'rewritten'
$$, '42501', null, 'movement history cannot be rewritten');

select throws_ok($$
  delete from public.inventory_movements
$$, '42501', null, 'movement history cannot be deleted');
select pg_temp.login('aa111111-1111-4111-8111-111111111111');

-- Refusals.
select throws_ok(
  format($$select public.move_inventory_item(%L, %L, 'OLD-BIN')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('item')),
  '23514', null, 'an item cannot be moved into a RETIRED location');

select throws_ok(
  format($$select public.move_inventory_item(%L, %L, 'NOWHERE')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('item')),
  '23514', null, 'an item cannot be moved to a location that does not exist');

select throws_ok(
  format($$select public.move_inventory_item(%L, %L, 'SHELF-2')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('item')),
  '23514', null, 'moving an item to the location it is already in is refused');

-- Whole-lot movement, and its deliberate refusal for serialized lots.
select lives_ok(
  format($$select public.move_inventory_lot(%L, %L, 'SHELF-2')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot')),
  'a quantity-tracked lot moves as a whole');

select is(
  (select location_id from public.inventory_lots where id = pg_temp.get('lot')),
  pg_temp.get('loc2'),
  'the moved lot reports its new location');

select throws_ok(
  format($$select public.move_inventory_lot(%L, %L, 'SHELF-1')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('slot')),
  '23514', null,
  'a serialized lot refuses a whole-lot move rather than silently relocating every unit');

-- Per-unit identifiers ---------------------------------------------------------
select pg_temp.put('sess', (public.create_intake_session(
  'a1111111-1111-4111-8111-111111111111', 'identifier test')->>'id')::uuid);
select pg_temp.put('grp', (public.upsert_intake_group(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('sess'), null, null,
  'other', 'Serial Widget', 2, 'serialized', 2,
  '{"brand":"Acme"}'::jsonb, '{"condition_or_quality":"New"}'::jsonb,
  '{}'::jsonb, null, 'SHELF-1', false, true, false, false)->>'id')::uuid);

select lives_ok(
  format($$select public.upsert_intake_entry(%L, %L, 1, 1, null, null, null, null, 'UNIT-1', '{}'::jsonb)$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('grp')),
  'the first unit accepts its own serial');

select throws_ok(
  format($$select public.upsert_intake_entry(%L, %L, 2, 2, null, null, null, null, 'UNIT-1', '{}'::jsonb)$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('grp')),
  '23505', null,
  'a second unit CANNOT reuse the first unit''s serial — one identifier never covers two objects');

select lives_ok(
  format($$select public.upsert_intake_entry(%L, %L, 3, 2, null, null, null, null, 'UNIT-2', '{}'::jsonb)$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('grp')),
  'a second unit with its OWN serial is accepted');

select pg_temp.logout();

-- Read-model workspace isolation ----------------------------------------------
-- Workspace B holds no inventory of its own; the views must show it nothing of
-- workspace A's, which is where the data actually is.
select pg_temp.login('bb222222-2222-4222-8222-222222222222');

select is((select count(*)::int from public.inventory_item_overview), 0,
  'the item read model shows a foreign workspace nothing');
select is((select count(*)::int from public.inventory_lot_overview), 0,
  'the lot read model shows a foreign workspace nothing');
select is((select count(*)::int from public.inventory_work_queue), 0,
  'the workbench read model shows a foreign workspace nothing');
select is((select count(*)::int from public.inventory_movements), 0,
  'movement history is invisible to a foreign workspace');

select pg_temp.logout();

select pg_temp.login('aa111111-1111-4111-8111-111111111111');
select ok((select count(*)::int from public.inventory_item_overview) > 0,
  'the item read model shows a member their own inventory');
select ok((select count(*)::int from public.inventory_lot_overview) > 0,
  'the lot read model shows a member their own inventory');

-- A serialized lot is excluded from the lot read model, so its units are not
-- counted twice — once as items and again as their parent lot.
select is(
  (select count(*)::int from public.inventory_lot_overview where lot_id = pg_temp.get('slot')),
  0,
  'a serialized lot is not listed as quantity inventory (no double counting)');
select pg_temp.logout();

-- Multi-category identity ------------------------------------------------------
select has_table('public', 'other_product_attributes',
  'the `other` vertical has typed product identity');
select has_table('public', 'other_sku_attributes',
  'the `other` vertical has typed SKU identity');
select has_column('public', 'tcg_sku_attributes', 'variant_or_printing',
  'a TCG printing/variant participates in SKU identity');
select has_column('public', 'footwear_sku_attributes', 'size_system',
  'a footwear size system participates in SKU identity');

-- The `other` canonical key must distinguish real product facts, not collapse
-- every same-named item into one product.
select isnt(
  app.intake_product_canonical_key('other', 'Hoodie', '{"brand":"Supreme"}'::jsonb),
  app.intake_product_canonical_key('other', 'Hoodie', '{"brand":"Nike"}'::jsonb),
  'two brands of the same-named item are different products');

-- A stored `other` SKU must recompute to the fingerprint it was created with,
-- or register_sellable_sku would reject its own row on a concurrent retry.
-- Checked as the owner: compute_sku_fingerprint is an internal helper that is
-- deliberately NOT granted to `authenticated`, and this is an invariant of the
-- stored data rather than something an end user can call.
select is(
  app.compute_sku_fingerprint(pg_temp.get('sku')),
  (select fingerprint from public.sellable_skus where id = pg_temp.get('sku')),
  'a stored `other` SKU recomputes to its own fingerprint');

select * from finish();
rollback;
