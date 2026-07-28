-- Coverage for the correction and supersession workflow.
--
-- The claims under test:
--   * a correction request is a CLAIM, frozen once made, never applied
--     automatically to any record;
--   * approving is not fixing -- the two are separate acts on purpose;
--   * only an owner or operator decides, and rejection requires a reason;
--   * superseding retires a record without deleting it, links it to its
--     replacement, and preserves its history;
--   * a voided record stops being stock and cannot be moved;
--   * a superseded lot's quantity does NOT move to its replacement;
--   * every part of this is workspace-isolated against a neighbour with data.
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
  ('dd444444-4444-4444-8444-444444444444', 'viewer-a@test.local')
on conflict do nothing;

insert into public.workspaces (id, name, created_by) values
  ('a1111111-1111-4111-8111-111111111111', 'WS A', 'aa111111-1111-4111-8111-111111111111'),
  ('b2222222-2222-4222-8222-222222222222', 'WS B', 'bb222222-2222-4222-8222-222222222222');

-- A viewer: a real member who may read but must not decide corrections.
insert into public.workspace_members (workspace_id, user_id, role)
values ('a1111111-1111-4111-8111-111111111111',
        'dd444444-4444-4444-8444-444444444444', 'viewer')
on conflict do nothing;

select has_table('public', 'inventory_correction_requests',
  'correction requests have a permanent home');
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.inventory_correction_requests'::regclass),
  'correction requests enforce row-level security');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_name = 'inventory_correction_requests'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'the client cannot write correction requests directly');

-- Fixtures -----------------------------------------------------------------------
select pg_temp.login('aa111111-1111-4111-8111-111111111111');
select public.register_storage_location(
  'a1111111-1111-4111-8111-111111111111', 'SHELF-1', null, 'Shelf 1');
select public.register_storage_location(
  'a1111111-1111-4111-8111-111111111111', 'SHELF-2', null, 'Shelf 2');

select pg_temp.put('prod', (public.register_product(
  'a1111111-1111-4111-8111-111111111111', 'tcg', 'Charizard', 'tcg|charizard|base|4',
  '{"set_name":"Base Set","card_number":"4"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku_wrong', (public.register_sellable_sku(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('prod'),
  '{"grading_company":"PSA","numeric_grade":"9","product_format":"Graded slab"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku_right', (public.register_sellable_sku(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('prod'),
  '{"grading_company":"PSA","numeric_grade":"10","product_format":"Graded slab"}'::jsonb)->>'id')::uuid);

select pg_temp.put('lot_wrong', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000003001', pg_temp.get('sku_wrong'),
  'serialized', 1, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('lot_right', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000003002', pg_temp.get('sku_right'),
  'serialized', 1, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('unit_wrong', (public.mint_serialized_item(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot_wrong'), 'PSA', 'CERT-900', null)->>'id')::uuid);
select pg_temp.put('unit_right', (public.mint_serialized_item(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('lot_right'), 'PSA', 'CERT-901', null)->>'id')::uuid);

-- Quantity lots for the lot-side tests.
select pg_temp.put('qlot', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000003003', pg_temp.get('sku_wrong'),
  'lot_managed', 6, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('qlot_dupe', (public.stage_inventory_lot(
  'a1111111-1111-4111-8111-111111111111', 'RV-T-0000003004', pg_temp.get('sku_wrong'),
  'lot_managed', 6, 'SHELF-2', 'test', '1.0.0', null)->>'id')::uuid);

-- Raising -------------------------------------------------------------------------
select pg_temp.put('cor', (public.request_inventory_correction(
  'a1111111-1111-4111-8111-111111111111', 'item', pg_temp.get('unit_wrong'),
  'wrong_grade', 'The slab reads PSA 10, this was entered as a 9.',
  '{"numeric_grade":"10"}'::jsonb)->>'id')::uuid);

select is(
  (select state from public.inventory_correction_requests where id = pg_temp.get('cor')),
  'open'::public.correction_state,
  'a new correction starts open');

select throws_ok(
  format($$select public.request_inventory_correction(%L, 'item', %L, 'wrong_grade', '   ')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('unit_wrong')),
  '23514', null,
  'a correction must say what is wrong');

select throws_ok(
  format($$select public.request_inventory_correction(%L, 'sku', %L, 'wrong_grade', 'x')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('unit_wrong')),
  '23514', null,
  'corrections are raised against items and lots only');

-- Raising a correction changes NOTHING about the record it names.
select is(
  (select item_state from public.inventory_items where id = pg_temp.get('unit_wrong')),
  'active'::public.inventory_item_state,
  'raising a correction does not retire the record it names');

select is(
  (select count(*)::int from public.inventory_record_overview
    where record_id = pg_temp.get('unit_wrong')),
  1,
  'and the record is still listed as stock while the claim is open');

select is(
  (select open_correction_count from public.inventory_item_overview
    where item_id = pg_temp.get('unit_wrong')),
  1::bigint,
  'but the record shows it has been questioned');

-- The claim is frozen.
select pg_temp.logout();
select throws_ok(
  format($$update public.inventory_correction_requests
           set explanation = 'something else' where id = %L$$, pg_temp.get('cor')),
  null, null,
  'what a correction claims cannot be rewritten after the fact');
select throws_ok(
  format($$delete from public.inventory_correction_requests where id = %L$$, pg_temp.get('cor')),
  null, null,
  'and a correction cannot be deleted');

-- Deciding --------------------------------------------------------------------------
select pg_temp.login('dd444444-4444-4444-8444-444444444444');
select throws_ok(
  format($$select public.review_inventory_correction(%L, %L, 'approve')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('cor')),
  null, null,
  'a viewer cannot decide a correction');

select is(
  (select count(*)::int from public.inventory_correction_requests
    where id = pg_temp.get('cor')),
  1,
  'though a viewer CAN read correction history');

select pg_temp.login('aa111111-1111-4111-8111-111111111111');
select throws_ok(
  format($$select public.review_inventory_correction(%L, %L, 'reject')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('cor')),
  '23514', null,
  'rejecting a report without a reason is refused');

select lives_ok(
  format($$select public.review_inventory_correction(%L, %L, 'approve', 'Confirmed against the slab.')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('cor')),
  'an owner approves the correction');

select is(
  (select state from public.inventory_correction_requests where id = pg_temp.get('cor')),
  'approved'::public.correction_state,
  'the correction is approved');

-- Approving is NOT fixing. This is the distinction the whole design rests on.
select is(
  (select item_state from public.inventory_items where id = pg_temp.get('unit_wrong')),
  'active'::public.inventory_item_state,
  'approving a correction does NOT itself change the record');

select is(
  (select numeric_grade from public.inventory_item_overview where item_id = pg_temp.get('unit_wrong')),
  '9'::text,
  'and the wrong value is still the wrong value — nothing was applied automatically');

select throws_ok(
  format($$select public.review_inventory_correction(%L, %L, 'approve')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('cor')),
  '23514', null,
  'a decided correction cannot be decided again');

-- Superseding ---------------------------------------------------------------------
select lives_ok(
  format($$select public.supersede_inventory_record(%L, 'item', %L, %L, 'Re-entered as PSA 10.', %L)$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('unit_wrong'),
    pg_temp.get('unit_right'), pg_temp.get('cor')),
  'the wrong unit is superseded by the correctly entered one');

select is(
  (select item_state from public.inventory_items where id = pg_temp.get('unit_wrong')),
  'superseded'::public.inventory_item_state,
  'the original is marked superseded');

select is(
  (select superseded_by_item_id from public.inventory_items where id = pg_temp.get('unit_wrong')),
  pg_temp.get('unit_right'),
  'and linked to its replacement');

select is(
  (select state from public.inventory_correction_requests where id = pg_temp.get('cor')),
  'resolved'::public.correction_state,
  'the correction is resolved');

-- Nothing was deleted.
select is(
  (select count(*)::int from public.inventory_items where id = pg_temp.get('unit_wrong')),
  1,
  'the superseded unit still EXISTS — nothing was hard-deleted');

select is(
  (select certificate_number from public.inventory_items where id = pg_temp.get('unit_wrong')),
  'CERT-900'::text,
  'and it keeps its original identifiers');

select is(
  (select count(*)::int from public.inventory_item_overview where item_id = pg_temp.get('unit_wrong')),
  1,
  'it is still readable, so its detail page and history still resolve');

select is(
  (select superseded_by_public_id from public.inventory_item_overview
    where item_id = pg_temp.get('unit_wrong')),
  (select public_id from public.inventory_items where id = pg_temp.get('unit_right')),
  'the read model shows the chain in operator-facing ids, not raw uuids');

-- But it is no longer stock.
select is(
  (select count(*)::int from public.inventory_record_overview
    where record_id = pg_temp.get('unit_wrong')),
  0,
  'a superseded unit is NOT listed as stock — it is not on the shelf');

select is(
  (select count(*)::int from public.inventory_record_overview
    where record_id = pg_temp.get('unit_right')),
  1,
  'and its replacement is');

select throws_ok(
  format($$select public.move_inventory_item(%L, %L, 'SHELF-2')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('unit_wrong')),
  '23514', null,
  'a superseded unit cannot be moved as available inventory');

select throws_ok(
  format($$select public.supersede_inventory_record(%L, 'item', %L, %L, 'again')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('unit_wrong'),
    pg_temp.get('unit_right')),
  '23514', null,
  'an already retired unit cannot be retired twice');

select throws_ok(
  format($$select public.supersede_inventory_record(%L, 'item', %L, %L, 'self')$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('unit_right'),
    pg_temp.get('unit_right')),
  '23514', null,
  'a record cannot replace itself');

-- Voiding a duplicate --------------------------------------------------------------
select pg_temp.put('dupe_cor', (public.request_inventory_correction(
  'a1111111-1111-4111-8111-111111111111', 'lot', pg_temp.get('qlot_dupe'),
  'duplicate_record', 'This box was entered twice.')->>'id')::uuid);

select throws_ok(
  format($$select public.supersede_inventory_record(%L, 'lot', %L, %L, 'dupe', %L)$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('qlot_dupe'),
    pg_temp.get('qlot'), pg_temp.get('dupe_cor')),
  '23514', null,
  'an undecided correction cannot be resolved — review is not optional');

select public.review_inventory_correction(
  'a1111111-1111-4111-8111-111111111111', pg_temp.get('dupe_cor'), 'approve', 'Confirmed duplicate.');

select lives_ok(
  format($$select public.supersede_inventory_record(%L, 'lot', %L, %L, 'Duplicate of the SHELF-1 lot.', %L)$$,
    'a1111111-1111-4111-8111-111111111111', pg_temp.get('qlot_dupe'),
    pg_temp.get('qlot'), pg_temp.get('dupe_cor')),
  'the duplicate lot is voided in favour of the survivor');

select is(
  (select lot_state from public.inventory_lots where id = pg_temp.get('qlot_dupe')),
  'void'::public.inventory_lot_state,
  'the duplicate is void, not deleted');

select is(
  (select void_reason from public.inventory_lots where id = pg_temp.get('qlot_dupe')),
  'Duplicate of the SHELF-1 lot.'::text,
  'and it records WHY it was voided');

select is(
  (select superseded_by_lot_id from public.inventory_lots where id = pg_temp.get('qlot_dupe')),
  pg_temp.get('qlot'),
  'linked to the record that survives');

-- The critical arithmetic: a duplicate RECORD was never extra stock, so voiding
-- it must not add its count to the survivor.
select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('qlot')),
  6,
  'the surviving lot keeps its own quantity — a duplicate record is not extra stock');

select is(
  (select count(*)::int from public.inventory_record_overview
    where record_id = pg_temp.get('qlot_dupe')),
  0,
  'the voided duplicate is no longer counted as inventory');

select is(
  (select count(*)::int from public.inventory_lot_overview
    where lot_id = pg_temp.get('qlot_dupe')),
  1,
  'but remains readable for its history');

-- The correction overview -----------------------------------------------------------
select is(
  (select subject_public_id from public.inventory_correction_overview
    where id = pg_temp.get('dupe_cor')),
  (select public_id from public.inventory_lots where id = pg_temp.get('qlot_dupe')),
  'the correction queue names its subject by governed public id');

select is(
  (select replacement_public_id from public.inventory_correction_overview
    where id = pg_temp.get('dupe_cor')),
  (select public_id from public.inventory_lots where id = pg_temp.get('qlot')),
  'and names the surviving record too');

-- Workspace isolation -----------------------------------------------------------------
select pg_temp.login('bb222222-2222-4222-8222-222222222222');
select public.register_storage_location(
  'b2222222-2222-4222-8222-222222222222', 'B-SHELF', null, 'B Shelf');
select pg_temp.put('prod_b', (public.register_product(
  'b2222222-2222-4222-8222-222222222222', 'tcg', 'B Card', 'tcg|b|card',
  '{"set_name":"B"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku_b', (public.register_sellable_sku(
  'b2222222-2222-4222-8222-222222222222', pg_temp.get('prod_b'),
  '{"product_format":"Raw card"}'::jsonb)->>'id')::uuid);
select pg_temp.put('lot_b', (public.stage_inventory_lot(
  'b2222222-2222-4222-8222-222222222222', 'RV-T-0000004001', pg_temp.get('sku_b'),
  'lot_managed', 2, 'B-SHELF', 'test', '1.0.0', null)->>'id')::uuid);

select is(
  (select count(*)::int from public.inventory_correction_requests
    where workspace_id = 'a1111111-1111-4111-8111-111111111111'),
  0,
  'workspace B cannot read workspace A''s corrections');

select ok(
  (select count(*) from public.inventory_correction_overview
    where workspace_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'nor through the correction overview');

select throws_ok(
  format($$select public.request_inventory_correction(%L, 'lot', %L, 'wrong_grade', 'x')$$,
    'b2222222-2222-4222-8222-222222222222', pg_temp.get('qlot')),
  '23514', null,
  'a correction cannot be raised against a neighbour''s record');

select throws_ok(
  format($$select public.review_inventory_correction(%L, %L, 'approve', 'x')$$,
    'b2222222-2222-4222-8222-222222222222', pg_temp.get('cor')),
  '23514', null,
  'and a neighbour''s correction cannot be decided');

select throws_ok(
  format($$select public.supersede_inventory_record(%L, 'lot', %L, %L, 'x')$$,
    'b2222222-2222-4222-8222-222222222222', pg_temp.get('lot_b'), pg_temp.get('qlot')),
  '23514', null,
  'a record cannot be superseded by one from another workspace');

select pg_temp.logout();
select * from finish();
rollback;
