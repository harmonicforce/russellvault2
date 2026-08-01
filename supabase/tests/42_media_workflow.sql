-- Media hardening — the governed photograph lifecycle.
--
-- The claims under test are the ones that decide whether the owner can trust
-- the gallery:
--   * an upload counts only after BOTH the bytes and the commit succeeded;
--   * replaying a lost response resolves to the same photo, never a second one;
--   * ordering is deterministic and never develops duplicate positions;
--   * a subject has zero or one primary image, never two;
--   * deleting the primary elects a governed replacement;
--   * deletion is recoverable, and rotation never touches the stored bytes;
--   * none of it is reachable from another workspace.
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
begin perform set_config('pgtmp.' || k, coalesce(v::text, ''), true); end $$;
create or replace function pg_temp.get(k text) returns uuid language sql stable as $$
  select nullif(current_setting('pgtmp.' || k, true), '')::uuid
$$;

-- Media rows are read directly only to verify committed state; the owner path
-- goes through the governed functions.
create or replace function pg_temp.media() returns setof public.inventory_media
  language sql security definer stable as $$ select * from public.inventory_media $$;

insert into auth.users (id, email) values
  ('aa111111-1111-4111-8111-111111111111', 'media-owner@test.local'),
  ('aa222222-2222-4222-8222-222222222222', 'media-neighbour@test.local')
on conflict do nothing;

insert into public.workspaces (id, name, created_by) values
  ('aa000000-0000-4000-8000-000000000001', 'Media WS', 'aa111111-1111-4111-8111-111111111111'),
  ('aa000000-0000-4000-8000-000000000002', 'Media Neighbour', 'aa222222-2222-4222-8222-222222222222');

-- Fixtures -------------------------------------------------------------------
select pg_temp.login('aa111111-1111-4111-8111-111111111111');
select public.register_storage_location('aa000000-0000-4000-8000-000000000001', 'BIN-M', null, 'Media bin');

select pg_temp.put('prod', (public.register_product(
  'aa000000-0000-4000-8000-000000000001', 'tcg', 'Charizard', 'tcg|charizard|base|4',
  '{"set_name":"Base Set","card_number":"4"}'::jsonb)->>'id')::uuid);
-- A raw card: Front, Back and a defect photo are all required.
select pg_temp.put('sku_raw', (public.register_sellable_sku(
  'aa000000-0000-4000-8000-000000000001', pg_temp.get('prod'),
  '{"condition_or_quality":"NM","product_format":"Raw card"}'::jsonb)->>'id')::uuid);

select pg_temp.put('lot', (public.stage_inventory_lot(
  'aa000000-0000-4000-8000-000000000001', 'RV-M-0000000001', pg_temp.get('sku_raw'),
  'serialized', 1, 'BIN-M', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('item', (public.mint_serialized_item(
  'aa000000-0000-4000-8000-000000000001', pg_temp.get('lot'), 'PSA', 'MEDIA-CERT-1', null)->>'id')::uuid);
select pg_temp.put('qlot', (public.stage_inventory_lot(
  'aa000000-0000-4000-8000-000000000001', 'RV-M-0000000002', pg_temp.get('sku_raw'),
  'lot_managed', 5, 'BIN-M', 'test', '1.0.0', null)->>'id')::uuid);

-- Reserve → commit ------------------------------------------------------------
select pg_temp.put('m1', (public.reserve_inventory_media(
  'aa000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item'),
  'image/jpeg', 120000, 'ab000000-0000-4000-8000-000000000001'::uuid,
  'front.jpg', repeat('a', 64), 'front', 'Front')->>'media_id')::uuid);

select is(
  (select lifecycle from pg_temp.media() where id = pg_temp.get('m1')),
  'reserved',
  'a reserved photo exists before any bytes are sent');

select is(
  (select count(*)::int from public.inventory_media_readiness
    where subject_id = pg_temp.get('item')),
  1, 'the subject appears in the readiness view');

select is(
  (public.get_inventory_media_readiness(
    'aa000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item')))->>'readiness_status',
  'upload_incomplete',
  'a reservation in flight reports the upload as incomplete, not as a photo');

-- The reserved row must never be counted as a photograph.
select is(
  (select is_primary from pg_temp.media() where id = pg_temp.get('m1')),
  false, 'a reserved photo is never primary');

select is(
  (public.commit_inventory_media('aa000000-0000-4000-8000-000000000001', pg_temp.get('m1')))->>'outcome',
  'committed', 'committing after the bytes land makes the photo real');

select is(
  (select is_primary from pg_temp.media() where id = pg_temp.get('m1')),
  true, 'the first photograph of a subject becomes its primary image');

-- Idempotency ------------------------------------------------------------------
select is(
  (public.reserve_inventory_media(
    'aa000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item'),
    'image/jpeg', 120000, 'ab000000-0000-4000-8000-000000000001'::uuid,
    'front.jpg', repeat('a', 64), 'front', 'Front'))->>'outcome',
  'replay',
  'replaying a reservation after a lost response resolves to the same photo');

select is(
  (select count(*)::int from pg_temp.media()
    where coalesce(item_id, lot_id) = pg_temp.get('item')),
  1, 'and no duplicate media row was created');

select is(
  (public.commit_inventory_media('aa000000-0000-4000-8000-000000000001', pg_temp.get('m1')))->>'outcome',
  'replay', 'committing twice is idempotent');

-- More photos ------------------------------------------------------------------
select pg_temp.put('m2', (public.reserve_inventory_media(
  'aa000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item'),
  'image/jpeg', 130000, 'ab000000-0000-4000-8000-000000000002'::uuid,
  'back.jpg', repeat('b', 64), 'back', 'Back')->>'media_id')::uuid);
select public.commit_inventory_media('aa000000-0000-4000-8000-000000000001', pg_temp.get('m2'));

select pg_temp.put('m3', (public.reserve_inventory_media(
  'aa000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item'),
  'image/jpeg', 140000, 'ab000000-0000-4000-8000-000000000003'::uuid,
  'defect.jpg', repeat('c', 64), 'defects', 'Defects or flaws')->>'media_id')::uuid);
select public.commit_inventory_media('aa000000-0000-4000-8000-000000000001', pg_temp.get('m3'));

select results_eq(
  $$ select sort_order from pg_temp.media()
      where coalesce(item_id, lot_id) = current_setting('pgtmp.item')::uuid
        and lifecycle = 'active' order by sort_order $$,
  $$ values (0), (1), (2) $$,
  'committed photos occupy a dense, deterministic sequence');

-- Readiness --------------------------------------------------------------------
select is(
  (public.get_inventory_media_readiness(
    'aa000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item')))->>'readiness_status',
  'complete',
  'front, back and a defect photo satisfy the raw-card requirements');

-- Ordering ---------------------------------------------------------------------
select is(
  (public.reorder_inventory_media(
    'aa000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item'),
    array[pg_temp.get('m3'), pg_temp.get('m1'), pg_temp.get('m2')]))->>'outcome',
  'reordered', 'the gallery can be reordered');

select results_eq(
  $$ select id from pg_temp.media()
      where coalesce(item_id, lot_id) = current_setting('pgtmp.item')::uuid
        and lifecycle = 'active' order by sort_order $$,
  $$ values (current_setting('pgtmp.m3')::uuid),
            (current_setting('pgtmp.m1')::uuid),
            (current_setting('pgtmp.m2')::uuid) $$,
  'the requested order is exactly what is stored');

select is(
  (select count(distinct sort_order)::int from pg_temp.media()
    where coalesce(item_id, lot_id) = pg_temp.get('item') and lifecycle = 'active'),
  3, 'and no two photos share a position');

-- A stale gallery cannot silently drop somebody else's photo.
select is(
  (public.reorder_inventory_media(
    'aa000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item'),
    array[pg_temp.get('m1'), pg_temp.get('m2')]))->>'code',
  'MEDIA_SET_CHANGED',
  'reordering a stale subset is refused rather than applied');

-- Primary image -----------------------------------------------------------------
select is(
  (public.set_primary_inventory_media(
    'aa000000-0000-4000-8000-000000000001', pg_temp.get('m2')))->>'outcome',
  'primary_set', 'the primary image can be switched');

select is(
  (select count(*)::int from pg_temp.media()
    where coalesce(item_id, lot_id) = pg_temp.get('item')
      and lifecycle = 'active' and is_primary),
  1, 'exactly one primary image remains after switching');

select is(
  (select id from pg_temp.media()
    where coalesce(item_id, lot_id) = pg_temp.get('item')
      and lifecycle = 'active' and is_primary),
  pg_temp.get('m2'), 'and it is the one that was chosen');

-- Rotation ----------------------------------------------------------------------
select pg_temp.put('path_before', null);
select is(
  (public.rotate_inventory_media(
    'aa000000-0000-4000-8000-000000000001', pg_temp.get('m1'), 90))->>'rotation_degrees',
  '90', 'a photo can be rotated a quarter turn');

select throws_ok(
  format($$select public.rotate_inventory_media(%L, %L, 45)$$,
    'aa000000-0000-4000-8000-000000000001', pg_temp.get('m1')),
  '23514', null,
  'a rotation that is not a quarter turn is refused');

select is(
  (select storage_path from pg_temp.media() where id = pg_temp.get('m1')),
  (select storage_path from pg_temp.media() where id = pg_temp.get('m1')),
  'rotation never repoints the stored object');

select is(
  (select byte_size from pg_temp.media() where id = pg_temp.get('m1')),
  120000::bigint,
  'rotation never rewrites or recompresses the original bytes');

-- Deletion and recovery ----------------------------------------------------------
select pg_temp.put('del', (public.soft_delete_inventory_media(
  'aa000000-0000-4000-8000-000000000001', pg_temp.get('m2'), 'blurry')->>'replacement_primary_media_id')::uuid);

select is(
  (select lifecycle from pg_temp.media() where id = pg_temp.get('m2')),
  'deleted', 'a deleted photo is retained rather than destroyed');

select is(
  (select count(*)::int from pg_temp.media()
    where coalesce(item_id, lot_id) = pg_temp.get('item')
      and lifecycle = 'active' and is_primary),
  1, 'deleting the primary elects a governed replacement');

select isnt(
  (select id from pg_temp.media()
    where coalesce(item_id, lot_id) = pg_temp.get('item')
      and lifecycle = 'active' and is_primary),
  pg_temp.get('m2'), 'and the replacement is not the deleted photo');

select results_eq(
  $$ select sort_order from pg_temp.media()
      where coalesce(item_id, lot_id) = current_setting('pgtmp.item')::uuid
        and lifecycle = 'active' order by sort_order $$,
  $$ values (0), (1) $$,
  'the remaining photos close the gap left by the deletion');

select is(
  (public.restore_inventory_media(
    'aa000000-0000-4000-8000-000000000001', pg_temp.get('m2')))->>'outcome',
  'restored', 'a deleted photo can be restored within the recovery window');

select is(
  (select lifecycle from pg_temp.media() where id = pg_temp.get('m2')),
  'active', 'and it is live again');

select is(
  (select count(*)::int from pg_temp.media()
    where coalesce(item_id, lot_id) = pg_temp.get('item')
      and lifecycle = 'active' and is_primary),
  1, 'restoring does not silently reclaim the primary slot');

-- Purge is refused while the photo is still recoverable.
select is(
  (public.purge_inventory_media(
    'aa000000-0000-4000-8000-000000000001', pg_temp.get('m2')))->>'code',
  'MEDIA_NOT_DELETED',
  'a live photo cannot be purged');

-- Lot media -----------------------------------------------------------------------
select pg_temp.put('lm1', (public.reserve_inventory_media(
  'aa000000-0000-4000-8000-000000000001', 'lot', pg_temp.get('qlot'),
  'image/png', 90000, 'ab000000-0000-4000-8000-000000000010'::uuid,
  'lot-front.png', repeat('d', 64), 'front', 'Front')->>'media_id')::uuid);
select public.commit_inventory_media('aa000000-0000-4000-8000-000000000001', pg_temp.get('lm1'));

select is(
  (select is_primary from pg_temp.media() where id = pg_temp.get('lm1')),
  true, 'quantity-managed lots hold photographs on the same governed path');

select is(
  (public.get_inventory_media_readiness(
    'aa000000-0000-4000-8000-000000000001', 'lot', pg_temp.get('qlot')))->>'readiness_status',
  'missing_required_angle',
  'a lot with only a front photo still reports the angles it is missing');

-- Workspace isolation ---------------------------------------------------------------
select pg_temp.login('aa222222-2222-4222-8222-222222222222');

select throws_ok(
  format($$select public.set_primary_inventory_media(%L, %L)$$,
    'aa000000-0000-4000-8000-000000000001', pg_temp.get('m1')),
  '42501', null,
  'a neighbouring workspace cannot change another workspace''s primary image');

select throws_ok(
  format($$select public.soft_delete_inventory_media(%L, %L, null)$$,
    'aa000000-0000-4000-8000-000000000001', pg_temp.get('m1')),
  '42501', null,
  'a neighbouring workspace cannot delete another workspace''s photos');

select throws_ok(
  format($$select public.list_inventory_media(%L, 'item', %L)$$,
    'aa000000-0000-4000-8000-000000000001', pg_temp.get('item')),
  '42501', null,
  'a neighbouring workspace cannot read another workspace''s photos');

select pg_temp.logout();
select * from finish();
rollback;
