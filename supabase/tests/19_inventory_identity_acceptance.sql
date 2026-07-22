-- Phase 5 identity acceptance patch — fingerprint parity, serialized-lot
-- capacity (sequential + concurrent), certificate scope, and content-idempotent
-- / concurrency-safe registrars.
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

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@a.test'),
  ('a2222222-2222-2222-2222-222222222222', 'op@a.test');
insert into public.workspaces (id, name, created_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'WS A', 'a1111111-1111-1111-1111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'operator');

-- ===== Fixed-vector fingerprint parity (the same hashes the Node suite locks) =====
select is(app.sku_fingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', '{"condition_or_quality":"NEAR MINT"}'),
  'e6a7ee60a454fbb0a00a6531957194920f2c5d0b7c66cd3ddbdbc448d756c60f', 'fixed vector: case');
select is(app.sku_fingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', '{"condition_or_quality":"near   mint"}'),
  'e6a7ee60a454fbb0a00a6531957194920f2c5d0b7c66cd3ddbdbc448d756c60f', 'fixed vector: whitespace == case');
select is(app.sku_fingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', '{"grading_company":""}'),
  '7e91346b87bdae1efdeb06a65f2ff69ee68a4ed8c7632910ad745e36d2599c8f', 'fixed vector: empty');
select is(app.sku_fingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', '{"grading_company":null}'),
  '7e91346b87bdae1efdeb06a65f2ff69ee68a4ed8c7632910ad745e36d2599c8f', 'fixed vector: null == empty');
select is(app.sku_fingerprint('IDSKU1', 'tcg', 'tcg|cafe' || U&'\0301' || '|||', '{"condition_or_quality":"x"}'),
  'f141f856f9e3100c1f7e0efe5187d9f51c05103189dccf4bf451a6ec358a5891', 'fixed vector: NFC combining');
select is(app.sku_fingerprint('IDSKU1', 'tcg', 'tcg|caf' || U&'\00E9' || '|||', '{"condition_or_quality":"x"}'),
  'f141f856f9e3100c1f7e0efe5187d9f51c05103189dccf4bf451a6ec358a5891', 'fixed vector: NFC precomposed == combining');
select is(app.sku_fingerprint('IDSKU1', 'tcg', 'tcg|' || U&'\30DD\30B1\30E2\30F3' || '|||', '{}'),
  'e52f12bb7d283ef5b5193a10fd56052efb21a95a220596d8486e7728a55126e2', 'fixed vector: non-ASCII');
select is(app.sku_fingerprint('IDSKU1', 'tcg', 'tcg|widget|set|1||', '{"numeric_grade":"9.5"}'),
  '69f64b87ac07cadd7ca5e33df52d9109382b598677a5af1c5bd410fbe585a426', 'fixed vector: differing fact');

-- ===== Fixture: a serialized SKU and lots =====
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select pg_temp.put('prod', (public.register_product('aaaa0000-0000-4000-8000-000000000001',
  'tcg', 'X', 'tcg|x|||', '{}')->>'id')::uuid);
select pg_temp.put('sku', (public.register_sellable_sku('aaaa0000-0000-4000-8000-000000000001',
  pg_temp.get('prod'), '{"grading_company":"CGC","product_format":"Graded slab"}')->>'id')::uuid);
select public.stage_inventory_lot('aaaa0000-0000-4000-8000-000000000001', 'RV-C-000001',
  pg_temp.get('sku'), 'serialized', 2, null, 'Imported Legacy', '1.0.0', null);
select pg_temp.put('lot2', (select id from public.inventory_lots where public_id = 'RV-C-000001'));

-- ===== Serialized capacity — sequential =====
select lives_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, 'CGC', 'S-1', null)$$,
    pg_temp.get('lot2')), 'capacity: first of two children mints');
select lives_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, 'CGC', 'S-2', null)$$,
    pg_temp.get('lot2')), 'capacity: second of two children mints');
select throws_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, 'CGC', 'S-3', null)$$,
    pg_temp.get('lot2')), '23514', null, 'capacity: a third child on a quantity-2 lot is refused');
select is((select count(*)::int from public.inventory_items where lot_id = pg_temp.get('lot2')), 2,
  'capacity: the lot holds exactly its quantity in children');

-- (True concurrent-capacity and registrar-convergence proofs need a second live
--  session and a committed fixture; they live in 20_inventory_concurrency.sql.)

-- ===== Certificate scope =====
-- duplicate (workspace, company, certificate) fails closed.
select throws_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, 'CGC', 'S-1', null)$$,
    pg_temp.get('lot2')), '23514', null,
  'cert: a duplicate certificate under the same grading company is refused (also at capacity)');
-- Prove cert-dup independently on a lot with spare capacity.
select public.stage_inventory_lot('aaaa0000-0000-4000-8000-000000000001', 'RV-C-000003',
  pg_temp.get('sku'), 'serialized', 5, null, 'Imported Legacy', '1.0.0', null);
select pg_temp.put('lot5', (select id from public.inventory_lots where public_id = 'RV-C-000003'));
select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', pg_temp.get('lot5'), 'CGC', 'DUP-1', null);
select throws_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, 'CGC', 'DUP-1', null)$$,
    pg_temp.get('lot5')), '23505', null, 'cert: a duplicate CGC certificate DUP-1 fails closed');
-- a certificate with no grading company is refused.
select throws_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, null, 'DUP-2', null)$$,
    pg_temp.get('lot5')), '23514', null, 'cert: a certificate without a grading company is refused');
select throws_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, '  ', 'DUP-3', null)$$,
    pg_temp.get('lot5')), '23514', null, 'cert: a blank grading company is refused');
-- the SAME certificate under a DIFFERENT grading company is a distinct identity
-- (approved scope: uniqueness is per (workspace, grading company, certificate)).
select lives_ok(
  format($$select public.mint_serialized_item('aaaa0000-0000-4000-8000-000000000001', %L, 'PSA', 'DUP-1', null)$$,
    pg_temp.get('lot5')), 'cert: the same number under a different grading company is allowed');

-- ===== stage_inventory_lot: fingerprint_inputs from the persisted SKU =====
select is((select fingerprint_inputs->>'fingerprint' from public.inventory_lots where public_id = 'RV-C-000001'),
  (select fingerprint from public.sellable_skus where id = pg_temp.get('sku')),
  'lot fingerprint_inputs are derived from the persisted SKU identity, not caller JSON');
-- an identical retry (same governed facts) resumes; a changed record_origin conflicts.
select is((public.stage_inventory_lot('aaaa0000-0000-4000-8000-000000000001', 'RV-C-000001',
  pg_temp.get('sku'), 'serialized', 2, null, 'Imported Legacy', '1.0.0', null)->>'created')::text,
  'false', 'lot: an identical retry resumes');
select throws_ok(
  format($$select public.stage_inventory_lot('aaaa0000-0000-4000-8000-000000000001', 'RV-C-000001',
    %L, 'serialized', 2, null, 'DIFFERENT ORIGIN', '1.0.0', null)$$, pg_temp.get('sku')),
  '23514', null, 'lot: a changed record_origin conflicts');
select throws_ok(
  format($$select public.stage_inventory_lot('aaaa0000-0000-4000-8000-000000000001', 'RV-C-000001',
    %L, 'serialized', 2, null, 'Imported Legacy', '2.0.0', null)$$, pg_temp.get('sku')),
  '23514', null, 'lot: a changed mapping_version conflicts');
select pg_temp.logout();

select * from finish();
rollback;
