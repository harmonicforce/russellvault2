-- Media hardening — readiness and reconciliation.
--
-- Two questions with consequences: which photographs a record still needs, and
-- what to do when storage and the database disagree. The second one is where
-- evidence gets destroyed by software that guesses, so the central claim here
-- is that reconciliation REPORTS and never deletes.
begin;
create extension if not exists pgtap with schema public;
select no_plan();

create or replace function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.put(k text, v uuid) returns void language plpgsql as $$
begin perform set_config('pgtmp.' || k, coalesce(v::text, ''), true); end $$;
create or replace function pg_temp.get(k text) returns uuid language sql stable as $$
  select nullif(current_setting('pgtmp.' || k, true), '')::uuid
$$;
create or replace function pg_temp.media() returns setof public.inventory_media
  language sql security definer stable as $$ select * from public.inventory_media $$;
create or replace function pg_temp.issues() returns setof public.inventory_media_issues
  language sql security definer stable as $$ select * from public.inventory_media_issues $$;

insert into auth.users (id, email) values
  ('ca111111-1111-4111-8111-111111111111', 'readiness@test.local') on conflict do nothing;
insert into public.workspaces (id, name, created_by)
  values ('ca000000-0000-4000-8000-000000000001', 'Readiness WS', 'ca111111-1111-4111-8111-111111111111');

select pg_temp.login('ca111111-1111-4111-8111-111111111111');
select public.register_storage_location('ca000000-0000-4000-8000-000000000001', 'BIN-K', null, 'Bin');

select pg_temp.put('prod', (public.register_product('ca000000-0000-4000-8000-000000000001',
  'footwear', 'Runner', 'footwear|runner|1', '{}')->>'id')::uuid);
select pg_temp.put('sku', (public.register_sellable_sku('ca000000-0000-4000-8000-000000000001',
  pg_temp.get('prod'), '{"size":"10","size_system":"US"}')->>'id')::uuid);
select pg_temp.put('lot', (public.stage_inventory_lot('ca000000-0000-4000-8000-000000000001',
  'RV-K-0000000001', pg_temp.get('sku'), 'serialized', 1, 'BIN-K', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('item', (public.mint_serialized_item('ca000000-0000-4000-8000-000000000001',
  pg_temp.get('lot'), null, null, 'KICK-1')->>'id')::uuid);

-- Readiness ------------------------------------------------------------------
select is(
  (public.get_inventory_media_readiness('ca000000-0000-4000-8000-000000000001',
    'item', pg_temp.get('item')))->>'subtype',
  'footwear',
  'the photo requirements follow the record''s own category');

select is(
  (public.get_inventory_media_readiness('ca000000-0000-4000-8000-000000000001',
    'item', pg_temp.get('item')))->>'readiness_status',
  'missing_required_angle',
  'a record with no photographs at all is never photo-complete');

-- Footwear requires pair, both sides, soles, size tag and a flaw photo.
create or replace function pg_temp.add(p_slot text, p_label text, p_key uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  v_id := (public.reserve_inventory_media('ca000000-0000-4000-8000-000000000001', 'item',
    pg_temp.get('item'), 'image/jpeg', 5000, p_key, p_slot || '.jpg', null, p_slot, p_label)->>'media_id')::uuid;
  perform public.commit_inventory_media('ca000000-0000-4000-8000-000000000001', v_id);
  return v_id;
end $$;

select pg_temp.put('pair', pg_temp.add('pair', 'Pair', 'cb000000-0000-4000-8000-000000000001'));
select pg_temp.put('left', pg_temp.add('left_side', 'Left side', 'cb000000-0000-4000-8000-000000000002'));
select pg_temp.put('right', pg_temp.add('right_side', 'Right side', 'cb000000-0000-4000-8000-000000000003'));
select pg_temp.put('soles', pg_temp.add('soles', 'Soles', 'cb000000-0000-4000-8000-000000000004'));

select is(
  (public.get_inventory_media_readiness('ca000000-0000-4000-8000-000000000001',
    'item', pg_temp.get('item')))->>'readiness_status',
  'missing_required_angle',
  'the size tag is still outstanding');

select pg_temp.put('tag', pg_temp.add('size_tag', 'Size tag', 'cb000000-0000-4000-8000-000000000005'));

-- Every required angle is covered; only the condition photo is missing, and
-- that is reported as its own state rather than lumped in with the angles.
select is(
  (public.get_inventory_media_readiness('ca000000-0000-4000-8000-000000000001',
    'item', pg_temp.get('item')))->>'readiness_status',
  'missing_defect_photo',
  'a missing condition photo is distinguished from a missing angle');

select pg_temp.put('flaw', pg_temp.add('defects', 'Flaws or wear', 'cb000000-0000-4000-8000-000000000006'));

select is(
  (public.get_inventory_media_readiness('ca000000-0000-4000-8000-000000000001',
    'item', pg_temp.get('item')))->>'readiness_status',
  'complete',
  'the record is photo-complete once the category''s set is covered');

-- Readiness reacts immediately to the next upload, with no refresh step.
select pg_temp.put('pending', (public.reserve_inventory_media(
  'ca000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item'),
  'image/jpeg', 4000, 'cb000000-0000-4000-8000-000000000007'::uuid,
  'extra.jpg', null, null, 'Extra')->>'media_id')::uuid);

select is(
  (public.get_inventory_media_readiness('ca000000-0000-4000-8000-000000000001',
    'item', pg_temp.get('item')))->>'readiness_status',
  'upload_incomplete',
  'an upload still in flight is reported rather than counted as a photograph');

select public.commit_inventory_media('ca000000-0000-4000-8000-000000000001', pg_temp.get('pending'));

select is(
  (public.get_inventory_media_readiness('ca000000-0000-4000-8000-000000000001',
    'item', pg_temp.get('item')))->>'readiness_status',
  'complete',
  'and extra photographs beyond the required set are always allowed');

select is(
  ((public.get_media_readiness_summary('ca000000-0000-4000-8000-000000000001'))->'counts')->>'complete',
  '1',
  'the workbench summary counts by status rather than listing every record');

-- Reconciliation ---------------------------------------------------------------
-- The caller supplies what it observed in storage. Here one object exists that
-- nothing points at, and one committed photo's bytes are absent.
select pg_temp.put('recon', null);
select is(
  (public.reconcile_inventory_media(
    'ca000000-0000-4000-8000-000000000001',
    array[
      (select storage_path from pg_temp.media() where id = pg_temp.get('pair')),
      (select storage_path from pg_temp.media() where id = pg_temp.get('left')),
      (select storage_path from pg_temp.media() where id = pg_temp.get('right')),
      (select storage_path from pg_temp.media() where id = pg_temp.get('soles')),
      (select storage_path from pg_temp.media() where id = pg_temp.get('tag')),
      (select storage_path from pg_temp.media() where id = pg_temp.get('flaw')),
      (select storage_path from pg_temp.media() where id = pg_temp.get('pending')),
      'ca000000-0000-4000-8000-000000000001/' || pg_temp.get('item')::text || '/stray.jpg'
    ]))->>'outcome',
  'reconciled',
  'reconciliation runs against the observed storage listing');

-- Required scenario: the orphan is surfaced, and it is still there afterwards.
select is(
  (select count(*)::int from pg_temp.issues()
    where issue_kind = 'storage_object_without_row' and state = 'open'),
  1,
  'an image nobody points at is surfaced for a person to judge');

-- Six required photos plus the extra one, all still present: the orphan was
-- reported, and nothing that existed before the scan was removed by it.
select is(
  (select count(*)::int from pg_temp.media()
    where workspace_id = 'ca000000-0000-4000-8000-000000000001'),
  7,
  'and reconciliation deleted nothing while doing so');

-- A committed photo whose bytes are gone is the mirror-image problem.
select is(
  (select count(*)::int from pg_temp.issues()
    where issue_kind = 'row_without_storage_object' and state = 'open'),
  0,
  'every committed photo still has its bytes in this listing');

select public.reconcile_inventory_media('ca000000-0000-4000-8000-000000000001', array[]::text[]);

select ok(
  (select count(*) from pg_temp.issues()
    where issue_kind = 'row_without_storage_object' and state = 'open') > 0,
  'a record whose image has vanished from storage is reported');

-- When the listing cannot be read the storage checks are skipped, so an
-- unreadable bucket never manufactures a queue full of false orphans.
select public.resolve_inventory_media_issue('ca000000-0000-4000-8000-000000000001',
  (select id from pg_temp.issues() where issue_kind = 'storage_object_without_row' limit 1),
  'dismissed', 'left over from a cancelled upload');

select is(
  (select state from pg_temp.issues() where issue_kind = 'storage_object_without_row' limit 1),
  'dismissed',
  'an operator can dismiss a disagreement with a reason');

select is(
  (public.reconcile_inventory_media('ca000000-0000-4000-8000-000000000001', null))->>'storage_listing_available',
  'false',
  'an unreadable storage listing is reported rather than treated as an empty bucket');

select * from finish();
rollback;
