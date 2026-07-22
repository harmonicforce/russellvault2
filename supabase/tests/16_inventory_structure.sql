-- Phase 5 identity core — structure, RLS, and grant-layer proofs.
begin;
create extension if not exists pgtap;
select no_plan();

-- Tables and the projection view exist ------------------------------------------------
select has_table('public'::name, 'product_catalog'::name, 'product_catalog exists');
select has_table('public'::name, 'sellable_skus'::name, 'sellable_skus exists');
select has_table('public'::name, 'tcg_product_attributes'::name, 'tcg_product_attributes exists');
select has_table('public'::name, 'tcg_sku_attributes'::name, 'tcg_sku_attributes exists');
select has_table('public'::name, 'footwear_product_attributes'::name, 'footwear_product_attributes exists');
select has_table('public'::name, 'footwear_sku_attributes'::name, 'footwear_sku_attributes exists');
select has_table('public'::name, 'storage_locations'::name, 'storage_locations exists');
select has_table('public'::name, 'inventory_lots'::name, 'inventory_lots exists');
select has_table('public'::name, 'inventory_items'::name, 'inventory_items exists');
select has_view('public'::name, 'inventory_location_balances'::name, 'balances projection view exists');

-- Governed public-id minting produces the expected prefixes ----------------------------
select is(app.mint_governed_public_id('RV-PROD') ~ '^RV-PROD-[A-Z0-9]{6,20}$', true, 'RV-PROD id');
select is(app.mint_governed_public_id('RV-SKU') ~ '^RV-SKU-[A-Z0-9]{6,20}$', true, 'RV-SKU id');
select is(app.mint_governed_public_id('RV-ITEM') ~ '^RV-ITEM-[A-Z0-9]{6,20}$', true, 'RV-ITEM id');
select is(app.mint_governed_public_id('RV-LOC') ~ '^RV-LOC-[A-Z0-9]{6,20}$', true, 'RV-LOC id');
select is(app.gen_scan_sku() ~ '^RV-[0-9A-HJKMNP-TV-Z]{7,12}$', true,
  'gen_scan_sku mints an opaque Crockford scan code');

-- Governed functions exist with the expected signatures -------------------------------
select has_function('public'::name, 'register_product'::name,
  array['uuid', 'text', 'text', 'text', 'jsonb'], 'register_product exists');
select has_function('public'::name, 'register_sellable_sku'::name,
  array['uuid', 'uuid', 'jsonb'], 'register_sellable_sku exists');
select has_function('public'::name, 'register_storage_location'::name,
  array['uuid', 'text', 'text', 'text'], 'register_storage_location exists');
select has_function('public'::name, 'retire_storage_location'::name,
  array['uuid', 'text'], 'retire_storage_location exists');
select has_function('public'::name, 'stage_inventory_lot'::name,
  array['uuid', 'text', 'uuid', 'text', 'integer', 'text', 'text', 'text', 'jsonb'],
  'stage_inventory_lot exists');
select has_function('public'::name, 'mint_serialized_item'::name,
  array['uuid', 'uuid', 'text', 'text', 'text'], 'mint_serialized_item exists');

-- Every SECURITY DEFINER function in this phase pins an empty search_path --------------
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and p.proname in (
       'register_product', 'register_sellable_sku', 'register_storage_location',
       'retire_storage_location', 'stage_inventory_lot', 'mint_serialized_item',
       'require_inventory_writer', 'sku_fingerprint', 'compute_sku_fingerprint',
       'gen_scan_sku', 'enforce_location_acyclic', 'dg_fld', 'norm_identity', 'dg_norm',
       'sku_identity_jsonb')
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
       where cfg in ('search_path=', 'search_path=""'))),
  0, 'every Phase 5 function pins an empty search_path');

-- Least privilege on the governed entry points ----------------------------------------
select ok(not has_function_privilege('anon',
  'public.register_product(uuid, text, text, text, jsonb)', 'execute'),
  'anon cannot register a product');
select ok(has_function_privilege('authenticated',
  'public.register_product(uuid, text, text, text, jsonb)', 'execute'),
  'authenticated may call register_product (membership is checked inside)');
select ok(not has_function_privilege('authenticated', 'app.gen_scan_sku()', 'execute'),
  'authenticated cannot call the internal scan-code generator directly');
select ok(not has_function_privilege('authenticated', 'app.compute_sku_fingerprint(uuid)', 'execute'),
  'authenticated cannot call the internal fingerprint recompute directly');

-- Direct table grants: authenticated holds SELECT only --------------------------------
select ok(not has_table_privilege('authenticated', 'public.inventory_lots', 'insert'),
  'authenticated cannot directly INSERT inventory_lots');
select ok(not has_table_privilege('authenticated', 'public.inventory_items', 'insert'),
  'authenticated cannot directly INSERT inventory_items');
select ok(not has_table_privilege('authenticated', 'public.sellable_skus', 'update'),
  'authenticated cannot directly UPDATE sellable_skus');
select ok(not has_table_privilege('authenticated', 'public.storage_locations', 'insert'),
  'authenticated cannot directly INSERT storage_locations');
select ok(has_table_privilege('authenticated', 'public.inventory_lots', 'select'),
  'authenticated may SELECT inventory_lots');
select ok(has_table_privilege('authenticated', 'public.inventory_location_balances', 'select'),
  'authenticated may SELECT the balances projection');

-- RLS is enabled on every Phase 5 base table ------------------------------------------
select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public'
     and tablename in (
       'product_catalog', 'sellable_skus', 'tcg_product_attributes', 'tcg_sku_attributes',
       'footwear_product_attributes', 'footwear_sku_attributes', 'storage_locations',
       'inventory_lots', 'inventory_items')
     and rowsecurity),
  9, 'row level security is enabled on all nine Phase 5 tables');

select * from finish();
rollback;
