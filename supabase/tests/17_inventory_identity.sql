-- Phase 5 identity core — identity invariants, serialization, locations, RLS.
begin;
create extension if not exists pgtap;
select no_plan();

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create temp table ids (k text primary key, v uuid);
grant all on table ids to public;
create function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ids values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v; $$;
create function pg_temp.get(p_k text) returns uuid language sql stable as $$
  select v from ids where k = p_k; $$;

-- Fixture: workspace A (owner a1, operator a2, viewer a3) and workspace B (operator b2).
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@a.test'),
  ('a2222222-2222-2222-2222-222222222222', 'op@a.test'),
  ('a3333333-3333-3333-3333-333333333333', 'view@a.test'),
  ('b2222222-2222-2222-2222-222222222222', 'op@b.test');
insert into public.workspaces (id, name, created_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'WS A', 'a1111111-1111-1111-1111-111111111111'),
  ('bbbb0000-0000-4000-8000-000000000002', 'WS B', 'b2222222-2222-2222-2222-222222222222');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'operator'),
  ('aaaa0000-0000-4000-8000-000000000001', 'a3333333-3333-3333-3333-333333333333', 'viewer');

-- ===== Deterministic, versioned fingerprint (app.sku_fingerprint, as superuser) =====
select is(
  app.sku_fingerprint('IDSKU1', 'tcg', 'k', '{"condition_or_quality":"NM","product_format":"Raw card"}'::jsonb),
  app.sku_fingerprint('IDSKU1', 'tcg', 'k', '{"condition_or_quality":"NM","product_format":"Raw card"}'::jsonb),
  'the fingerprint is deterministic for identical inputs');
select isnt(
  app.sku_fingerprint('IDSKU1', 'tcg', 'k', '{"condition_or_quality":"NM"}'::jsonb),
  app.sku_fingerprint('IDSKU2', 'tcg', 'k', '{"condition_or_quality":"NM"}'::jsonb),
  'the fingerprint is versioned: a new identity-schema version changes it');
select isnt(
  app.sku_fingerprint('IDSKU1', 'tcg', 'k', '{"condition_or_quality":"NM"}'::jsonb),
  app.sku_fingerprint('IDSKU1', 'tcg', 'k', '{"condition_or_quality":"LP"}'::jsonb),
  'a changed identity-driving attribute changes the fingerprint');

-- ===== Operator registers products / skus / lots =====
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select pg_temp.put('prod', (public.register_product('aaaa0000-0000-4000-8000-000000000001',
  'tcg', 'Galarian Mr. Mime #30', 'tcg|galarian mr. mime|crown zenith|30||',
  '{"set_name":"Crown Zenith","card_number":"30"}'::jsonb)->>'id')::uuid);
select is((public.register_sellable_sku('aaaa0000-0000-4000-8000-000000000001', pg_temp.get('prod'),
  '{"condition_or_quality":"Normal wear","product_format":"Raw card"}'::jsonb)->>'created')::text,
  'true', 'the first sellable SKU is created');
select is((public.register_sellable_sku('aaaa0000-0000-4000-8000-000000000001', pg_temp.get('prod'),
  '{"condition_or_quality":"Normal wear","product_format":"Raw card"}'::jsonb)->>'created')::text,
  'false', 'an identical SKU find-or-creates (active fingerprint dedup)');
select pg_temp.put('sku', (select id from public.sellable_skus limit 1));
select pg_temp.put('gradedsku', (public.register_sellable_sku('aaaa0000-0000-4000-8000-000000000001',
  pg_temp.get('prod'),
  '{"condition_or_quality":"Graded","grading_company":"CGC","numeric_grade":"9.5","product_format":"Graded slab"}'::jsonb
  )->>'id')::uuid);

-- Two distinct configs are two SKUs; the fixture proves stored parity elsewhere.
select is((select count(*)::int from public.sellable_skus), 2, 'two distinct configurations = two SKUs');

-- ===== Active fingerprint uniqueness is enforced at the DB (direct duplicate) =====
select pg_temp.logout();
select throws_ok($$
  insert into public.sellable_skus (workspace_id, public_id, product_id, business_vertical,
    identity_schema_version, fingerprint, created_by_process)
  select workspace_id, 'RV-SKU-DUP001', product_id, business_vertical, identity_schema_version,
    fingerprint, 'inventory.identity'
  from public.sellable_skus order by created_at limit 1
$$, '23505', null, 'a second ACTIVE SKU with the same fingerprint is rejected');

-- ===== Subtype vertical agreement (a TCG subtype cannot attach to a footwear SKU) =====
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select pg_temp.put('fprod', (public.register_product('aaaa0000-0000-4000-8000-000000000001',
  'footwear', 'Air Zoom', 'footwear|air zoom|||', '{"silhouette":"Air Zoom"}'::jsonb)->>'id')::uuid);
select pg_temp.put('fsku', (public.register_sellable_sku('aaaa0000-0000-4000-8000-000000000001',
  pg_temp.get('fprod'), '{"shoe_size":"10","color":"Black"}'::jsonb)->>'id')::uuid);
select pg_temp.logout();
select throws_ok(
  format($$insert into public.tcg_sku_attributes (sku_id, workspace_id, condition_or_quality)
           values (%L, 'aaaa0000-0000-4000-8000-000000000001', 'NM')$$, pg_temp.get('fsku')),
  '23503', null, 'a TCG SKU-subtype row cannot attach to a footwear SKU');

-- ===== Locations: register, cycle rejection, retired-code reuse =====
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select public.register_storage_location('aaaa0000-0000-4000-8000-000000000001', 'A', null, 'Room A');
select public.register_storage_location('aaaa0000-0000-4000-8000-000000000001', 'B', 'A', 'Shelf B');
select public.register_storage_location('aaaa0000-0000-4000-8000-000000000001', 'C', 'B', 'Bin C');
select pg_temp.put('locA', (select id from public.storage_locations where location_code='A'));
select pg_temp.put('locC', (select id from public.storage_locations where location_code='C'));
select is((public.register_storage_location('aaaa0000-0000-4000-8000-000000000001', 'A', null, null)->>'created')::text,
  'false', 'registering an existing location code find-or-creates (no reuse)');
select pg_temp.logout();

-- self-parenting rejected (table check)
select throws_ok(
  format($$update public.storage_locations set parent_id = %L where id = %L$$,
    pg_temp.get('locA'), pg_temp.get('locA')),
  '23514', null, 'a location cannot be its own parent');
-- indirect cycle rejected (A -> B -> C, then A.parent := C)
select throws_ok(
  format($$update public.storage_locations set parent_id = %L where id = %L$$,
    pg_temp.get('locC'), pg_temp.get('locA')),
  '23514', null, 'an indirect location cycle is rejected');
-- retired code can never be reused (row persists; the unique code blocks a new insert)
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select public.retire_storage_location('aaaa0000-0000-4000-8000-000000000001', 'C');
select is((select retired_at is not null from public.storage_locations where location_code='C'), true,
  'a retired location keeps its code');
select pg_temp.logout();
select throws_ok($$
  insert into public.storage_locations (workspace_id, public_id, location_code, created_by_process)
  values ('aaaa0000-0000-4000-8000-000000000001', 'RV-LOC-REUSE1', 'C', 'inventory.identity')
$$, '23505', null, 'a retired location code cannot be reused');

-- ===== Serialized items: scan identity, cert/serial fail-closed, double-count guard =====
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select public.stage_inventory_lot('aaaa0000-0000-4000-8000-000000000001', 'RV-C-900001',
  pg_temp.get('gradedsku'), 'serialized', 1, 'A', 'Imported Legacy', '1.0.0', null);
select public.stage_inventory_lot('aaaa0000-0000-4000-8000-000000000001', 'RV-C-900002',
  pg_temp.get('sku'), 'lot_managed', 5, 'A', 'Imported Legacy', '1.0.0', null);
select pg_temp.put('slot', (select id from public.inventory_lots where public_id='RV-C-900001'));
select pg_temp.put('llot', (select id from public.inventory_lots where public_id='RV-C-900002'));
select pg_temp.put('item1', (public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001',
  pg_temp.get('slot'), 'CGC', 'CERT-1', null)->>'id')::uuid);
-- a serialized item cannot attach to a lot-managed lot (no double counting path)
select throws_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, 'CGC', 'CERT-2', null)$$,
    pg_temp.get('llot')),
  '23514', null, 'a serialized item cannot be minted onto a lot-managed lot');
select pg_temp.logout();

-- duplicate certificate fails closed
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select throws_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, 'CGC', 'CERT-1', null)$$,
    pg_temp.get('slot')),
  '23505', null, 'a duplicate certificate identity is rejected');
select pg_temp.logout();

-- opaque scan SKU is immutable (append-only) and exact-searchable
select pg_temp.put('scanval', (select null::uuid));
select is((select count(*)::int from public.inventory_items
  where scan_sku = (select scan_sku from public.inventory_items where id = pg_temp.get('item1'))), 1,
  'the opaque scan SKU is exact-searchable to one item');
select throws_ok(
  format($$update public.inventory_items set scan_sku = 'RV-ZZZZZZZ' where id = %L$$, pg_temp.get('item1')),
  '42501', null, 'the opaque scan SKU is immutable (append-only)');
-- a direct duplicate scan code is rejected (concurrency fail-closed)
select throws_ok($$
  insert into public.inventory_items (workspace_id, public_id, lot_id, sku_id, scan_sku, created_by_process)
  select workspace_id, 'RV-ITEM-DUP0001', lot_id, sku_id, scan_sku, 'inventory.identity'
  from public.inventory_items limit 1
$$, '23505', null, 'a duplicate opaque scan SKU is rejected');

-- ===== RLS + role enforcement =====
-- workspace B operator sees none of workspace A's identity rows
select pg_temp.login('b2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.inventory_lots), 0,
  'a member of workspace B sees no workspace A lots (RLS)');
select is((select count(*)::int from public.product_catalog), 0,
  'a member of workspace B sees no workspace A products (RLS)');
select pg_temp.logout();
-- a viewer cannot register identity
select pg_temp.login('a3333333-3333-3333-3333-333333333333');
select throws_ok(
  $$select public.register_product('aaaa0000-0000-4000-8000-000000000001', 'tcg', 'X', 'kx', '{}'::jsonb)$$,
  '42501', null, 'a viewer cannot register a product');
select is((select count(*)::int from public.inventory_lots), 2,
  'the viewer still reads the workspace inventory (2 lots)');
select pg_temp.logout();
-- direct DML by an authenticated client is denied
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select throws_ok($$
  insert into public.inventory_lots (workspace_id, public_id, sku_id, quantity, created_by_process)
  values ('aaaa0000-0000-4000-8000-000000000001', 'RV-C-000099',
          '00000000-0000-0000-0000-000000000000', 1, 'inventory.identity')$$,
  '42501', null, 'authenticated cannot directly INSERT inventory_lots');
select pg_temp.logout();

select * from finish();
rollback;
