-- Coverage for the operational-completion migrations: the governed inventory
-- subtype, the expanded searchable read models, and the unified record stream
-- Current Inventory pages over.
--
-- The claims under test are the ones an operator's work depends on:
--   * a subtype is derived from stored facts, never guessed;
--   * apparel and electronics stay distinguishable after commit;
--   * a subtype is frozen once written;
--   * the union view never counts the same physical stock twice;
--   * every read model stays workspace-isolated for a real neighbour that
--     holds data, not for an empty database.
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
  ('bb222222-2222-4222-8222-222222222222', 'owner-b@test.local')
on conflict do nothing;

insert into public.workspaces (id, name, created_by) values
  ('a1111111-1111-4111-8111-111111111111', 'WS A', 'aa111111-1111-4111-8111-111111111111'),
  ('b2222222-2222-4222-8222-222222222222', 'WS B', 'bb222222-2222-4222-8222-222222222222');

-- The derivation, on its own ---------------------------------------------------
-- app.subtype_from_facts is the ONE place a subtype is decided. Both the
-- registrar and the backfill call it, so a record committed today and a record
-- committed last month cannot be classified by two different rules.

select is(app.subtype_from_facts('tcg', null, 'PSA', 'Graded slab'),
  'graded_card'::public.inventory_subtype,
  'a graded slab is a graded card');

select is(app.subtype_from_facts('tcg', null, 'PSA', 'Booster Box'),
  'graded_card'::public.inventory_subtype,
  'a grading company is decisive even when a packaging format is also recorded');

select is(app.subtype_from_facts('tcg', null, null, 'Raw card'),
  'raw_card'::public.inventory_subtype,
  'the raw-card form''s own product_format resolves to raw_card, not to sealed');

select is(app.subtype_from_facts('tcg', null, null, 'Elite Trainer Box'),
  'sealed_tcg'::public.inventory_subtype,
  'any other stated TCG format is sealed product');

select is(app.subtype_from_facts('tcg', null, null, null),
  'unclassified'::public.inventory_subtype,
  'a TCG record with neither grade nor format is UNCLASSIFIED, not guessed as raw');

select is(app.subtype_from_facts('footwear', null, null, null),
  'footwear'::public.inventory_subtype,
  'the footwear vertical is its own subtype');

select is(app.subtype_from_facts('other', 'Apparel', null, null),
  'apparel'::public.inventory_subtype,
  'apparel keeps its identity after commit');

select is(app.subtype_from_facts('other', 'Electronics', null, null),
  'electronics'::public.inventory_subtype,
  'electronics keeps its identity after commit');

select isnt(app.subtype_from_facts('other', 'Apparel', null, null),
  app.subtype_from_facts('other', 'Electronics', null, null),
  'apparel is never silently classified as electronics');

select is(app.subtype_from_facts('other', '  ELECTRONICS  ', null, null),
  'electronics'::public.inventory_subtype,
  'classification tolerates case and surrounding whitespace');

select is(app.subtype_from_facts('other', 'Comic', null, null),
  'other_collectible'::public.inventory_subtype,
  'an operator-named category that is not apparel or electronics is a collectible');

select is(app.subtype_from_facts('other', null, null, null),
  'unclassified'::public.inventory_subtype,
  'an `other` record with no stated category is UNCLASSIFIED, not guessed');

select is(app.subtype_from_facts('other', '   ', null, null),
  'unclassified'::public.inventory_subtype,
  'a blank category is not a category');

-- The enum is a closed set: adding a subtype requires a migration, which is
-- what keeps this from drifting into free text.
select set_eq(
  $$select unnest(enum_range(null::public.inventory_subtype))::text$$,
  $$values ('graded_card'),('raw_card'),('sealed_tcg'),('footwear'),('apparel'),
           ('electronics'),('other_collectible'),('unclassified')$$,
  'the subtype enum is exactly the bounded set the application knows');

-- Persisted at commit ----------------------------------------------------------
select pg_temp.login('aa111111-1111-4111-8111-111111111111');

select pg_temp.put('loc1', (public.register_storage_location(
  'a1111111-1111-4111-8111-111111111111', 'SHELF-1', null, 'Shelf 1')->>'id')::uuid);

-- Apparel and electronics: the two the old model collapsed together.
select pg_temp.put('p_app', (public.register_product(
  'a1111111-1111-4111-8111-111111111111', 'other', 'Vintage Tee', 'other|vintage tee',
  '{"brand":"Acme","item_category":"Apparel"}'::jsonb)->>'id')::uuid);
select pg_temp.put('s_app', (public.register_sellable_sku(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('p_app'),
  '{"condition_or_quality":"Used","size_label":"L"}'::jsonb)->>'id')::uuid);

select pg_temp.put('p_elec', (public.register_product(
  'a1111111-1111-4111-8111-111111111111', 'other', 'Game Boy', 'other|game boy',
  '{"brand":"Nintendo","item_category":"Electronics"}'::jsonb)->>'id')::uuid);
select pg_temp.put('s_elec', (public.register_sellable_sku(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('p_elec'),
  '{"condition_or_quality":"Used"}'::jsonb)->>'id')::uuid);

select is(
  (select inventory_subtype from public.sellable_skus where id = pg_temp.get('s_app')),
  'apparel'::public.inventory_subtype,
  'the registrar persists the apparel subtype at commit');

select is(
  (select inventory_subtype from public.sellable_skus where id = pg_temp.get('s_elec')),
  'electronics'::public.inventory_subtype,
  'the registrar persists the electronics subtype at commit');

-- A graded card, through the real registrar.
select pg_temp.put('p_tcg', (public.register_product(
  'a1111111-1111-4111-8111-111111111111', 'tcg', 'Charizard', 'tcg|charizard|base|4',
  '{"set_name":"Base Set","card_number":"4","featured_subject":"Charizard"}'::jsonb)->>'id')::uuid);
select pg_temp.put('s_graded', (public.register_sellable_sku(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('p_tcg'),
  '{"grading_company":"PSA","numeric_grade":"10","product_format":"Graded slab"}'::jsonb)->>'id')::uuid);
select pg_temp.put('s_raw', (public.register_sellable_sku(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('p_tcg'),
  '{"condition_or_quality":"Near Mint","product_format":"Raw card"}'::jsonb)->>'id')::uuid);

select is(
  (select inventory_subtype from public.sellable_skus where id = pg_temp.get('s_graded')),
  'graded_card'::public.inventory_subtype,
  'a graded slab registers as graded_card');

select is(
  (select inventory_subtype from public.sellable_skus where id = pg_temp.get('s_raw')),
  'raw_card'::public.inventory_subtype,
  'a raw single of the SAME product registers as raw_card, not sealed');

-- Frozen ------------------------------------------------------------------------
-- A subtype classifies immutable identity facts, so it is immutable too. A
-- misclassified record is corrected the way every identity error is: by a new,
-- superseding record.
select pg_temp.logout();
select throws_ok(
  format($$update public.sellable_skus set inventory_subtype = 'electronics' where id = %L$$,
    pg_temp.get('s_app')),
  null, null,
  'a committed subtype cannot be edited in place, even by a privileged connection');

-- Exposed to the application ----------------------------------------------------
select pg_temp.login('aa111111-1111-4111-8111-111111111111');

select pg_temp.put('lot_app', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000000101', pg_temp.get('s_app'),
  'lot_managed', 3, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('lot_graded', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000000102', pg_temp.get('s_graded'),
  'serialized', 2, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('unit1', (public.mint_serialized_item(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot_graded'), 'PSA', 'CERT-111', null)->>'id')::uuid);
select pg_temp.put('unit2', (public.mint_serialized_item(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot_graded'), 'PSA', 'CERT-222', null)->>'id')::uuid);

select has_column('public', 'inventory_item_overview', 'inventory_subtype',
  'the item read model exposes the exact subtype');
select has_column('public', 'inventory_lot_overview', 'inventory_subtype',
  'the lot read model exposes the exact subtype');
select has_column('public', 'inventory_item_overview', 'search_text',
  'the item read model exposes a searchable haystack');
select has_column('public', 'inventory_item_overview', 'last_moved_at',
  'the item read model exposes when the record last moved');
select has_column('public', 'inventory_item_overview', 'needs_condition_details',
  'the item read model flags records with no condition or grade');

select is(
  (select inventory_subtype from public.inventory_lot_overview
     where lot_id = pg_temp.get('lot_app'))::text,
  'apparel',
  'an apparel lot reads as apparel in the lot read model, not as `other`');

select is(
  (select inventory_subtype from public.inventory_item_overview
     where item_id = pg_temp.get('unit1'))::text,
  'graded_card',
  'a graded unit reads as graded_card in the item read model');

-- Search reaches the facts intake collects ---------------------------------------
select ok(
  (select search_text like '%base set%' from public.inventory_item_overview
     where item_id = pg_temp.get('unit1')),
  'set name is searchable, not just the display name');

select ok(
  (select search_text like '%cert-111%' from public.inventory_item_overview
     where item_id = pg_temp.get('unit1')),
  'certificate number is searchable');

select ok(
  (select search_text like '%shelf-1%' from public.inventory_item_overview
     where item_id = pg_temp.get('unit1')),
  'location code is searchable');

select ok(
  (select search_text = lower(search_text) from public.inventory_item_overview
     where item_id = pg_temp.get('unit1')),
  'the haystack is lowercased, so matching is case-insensitive by construction');

-- The unified stream --------------------------------------------------------------
select has_column('public', 'inventory_record_overview', 'record_kind',
  'the record stream distinguishes the two grains');

select is(
  (select count(*)::int from public.inventory_record_overview
     where record_kind = 'lot' and tracking_mode = 'serialized'),
  0,
  'a serialized parent lot never appears in the record stream — its units represent it');

select is(
  (select count(*)::int from public.inventory_record_overview
     where record_id = pg_temp.get('lot_graded')),
  0,
  'the serialized lot backing two units is absent, so the stock is not counted twice');

select is(
  (select count(*)::int from public.inventory_record_overview
     where record_kind = 'item' and parent_lot_id = pg_temp.get('lot_graded')),
  2,
  'both units of that lot ARE listed, once each');

select is(
  (select count(*)::int from public.inventory_record_overview
     where record_id = pg_temp.get('lot_app')),
  1,
  'a quantity-managed lot is listed exactly once');

select is(
  (select quantity from public.inventory_record_overview
     where record_id = pg_temp.get('lot_app')),
  3::bigint,
  'a quantity lot reports its real quantity');

select is(
  (select quantity from public.inventory_record_overview
     where record_id = pg_temp.get('unit1')),
  1::bigint,
  'an individually tracked unit counts as one');

-- The lot is still resolvable by id for its own detail page.
select is(
  (select count(*)::int from public.inventory_lot_overview
     where lot_id = pg_temp.get('lot_graded')),
  1,
  'the serialized lot is still readable in the lot read model, for its detail page');

select is(
  (select condition_or_grade from public.inventory_record_overview
     where record_id = pg_temp.get('unit1')),
  '10'::text,
  'a graded unit surfaces its grade, not a blank condition, in the condition column');

-- Workspace isolation --------------------------------------------------------------
-- Workspace B holds real data of its own, so this tests a boundary rather than
-- an empty database.
select pg_temp.login('bb222222-2222-4222-8222-222222222222');
select public.register_storage_location(
  'b2222222-2222-4222-8222-222222222222', 'B-SHELF', null, 'B Shelf');
select pg_temp.put('p_b', (public.register_product(
  'b2222222-2222-4222-8222-222222222222', 'other', 'B Widget', 'other|b widget',
  '{"brand":"Beta","item_category":"Electronics"}'::jsonb)->>'id')::uuid);
select pg_temp.put('s_b', (public.register_sellable_sku(
  'b2222222-2222-4222-8222-222222222222', pg_temp.get('p_b'),
  '{"condition_or_quality":"New"}'::jsonb)->>'id')::uuid);
select pg_temp.put('lot_b', (public.stage_inventory_lot(
  'b2222222-2222-4222-8222-222222222222', 'RV-T-0000000201', pg_temp.get('s_b'),
  'lot_managed', 4, 'B-SHELF', 'test', '1.0.0', null)->>'id')::uuid);

select is(
  (select count(*)::int from public.inventory_record_overview
     where workspace_id = 'a1111111-1111-4111-8111-111111111111'),
  0,
  'workspace B cannot see workspace A''s records in the unified stream');

select ok(
  (select count(*) from public.inventory_record_overview
     where workspace_id = 'b2222222-2222-4222-8222-222222222222') > 0,
  'workspace B can see its own records (the isolation above is not just an empty view)');

select is(
  (select count(*)::int from public.inventory_record_overview
     where record_id = pg_temp.get('lot_app')),
  0,
  'a neighbour''s apparel lot is not reachable by id either');

select pg_temp.login('aa111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::int from public.inventory_record_overview
     where record_id = pg_temp.get('lot_b')),
  0,
  'and the isolation holds in the other direction');

-- The record stream cannot widen visibility: it is SECURITY INVOKER, so every
-- underlying table's RLS is re-checked for the querying role.
select is(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('inventory_item_overview', 'inventory_lot_overview',
                        'inventory_record_overview', 'inventory_work_queue')
      and 'security_invoker=true' = any(c.reloptions)),
  4,
  'every inventory read model is SECURITY INVOKER');

select pg_temp.logout();
select * from finish();
rollback;
