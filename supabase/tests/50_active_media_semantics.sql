-- One authoritative "no active photograph" fact.
--
-- The defect this pins down: `inventory_work_queue.needs_photos` counted only
-- LIVE photographs, while Current Inventory's filter asked
-- `inventory_record_overview.media_count = 0`, and media_count counted every
-- lifecycle. A record whose only photograph was reserved-and-abandoned, or was
-- deleted, appeared in the dashboard's work queue and then vanished from the
-- filtered page that queue linked to.
--
-- These assertions are BEHAVIOURAL. `49_operations_dashboard.sql` asserts the
-- view's definition text matches a pattern, which cannot catch a second
-- consumer reading a different column; the guarantee that matters is that the
-- queue and the drill-down return the same records.
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

/** What Current Inventory's needsPhotos filter now selects. */
create or replace function pg_temp.drilldown_has(p_id uuid) returns boolean
language sql stable as $$
  select exists (select 1 from public.inventory_record_overview o
                  where o.record_id = p_id and o.needs_photos)
$$;
/** What the dashboard work queue counts. */
create or replace function pg_temp.queue_has(p_id uuid) returns boolean
language sql stable as $$
  select exists (select 1 from public.inventory_work_queue q
                  where q.subject_id = p_id and q.needs_photos)
$$;
create or replace function pg_temp.active_count(p_id uuid) returns int
language sql stable as $$
  select o.active_media_count::int from public.inventory_record_overview o
   where o.record_id = p_id
$$;
create or replace function pg_temp.total_count(p_id uuid) returns int
language sql stable as $$
  select o.media_count::int from public.inventory_record_overview o
   where o.record_id = p_id
$$;

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('fa011111-1111-4111-8111-111111111111', 'active-media@test.local');
insert into public.workspaces (id, name, created_by)
  values ('fa000000-0000-4000-8000-000000000001', 'Active media WS',
          'fa011111-1111-4111-8111-111111111111');

select pg_temp.login('fa011111-1111-4111-8111-111111111111');
select public.register_storage_location('fa000000-0000-4000-8000-000000000001', 'BIN-A', null, 'Bin');

select pg_temp.put('prod', (public.register_product('fa000000-0000-4000-8000-000000000001',
  'tcg', 'Media card', 'tcg|media|1', '{}')->>'id')::uuid);
select pg_temp.put('sku', (public.register_sellable_sku('fa000000-0000-4000-8000-000000000001',
  pg_temp.get('prod'), '{"product_format":"Raw card"}')->>'id')::uuid);
select pg_temp.put('lot', (public.stage_inventory_lot('fa000000-0000-4000-8000-000000000001',
  'RV-A-0000000001', pg_temp.get('sku'), 'serialized', 5, 'BIN-A', 'test', '1.0.0', null)->>'id')::uuid);

-- Five items, one per media state.
select pg_temp.put('none',     (public.mint_serialized_item('fa000000-0000-4000-8000-000000000001', pg_temp.get('lot'), null, null, 'M-NONE')->>'id')::uuid);
select pg_temp.put('reserved', (public.mint_serialized_item('fa000000-0000-4000-8000-000000000001', pg_temp.get('lot'), null, null, 'M-RESV')->>'id')::uuid);
select pg_temp.put('deleted',  (public.mint_serialized_item('fa000000-0000-4000-8000-000000000001', pg_temp.get('lot'), null, null, 'M-DEL')->>'id')::uuid);
select pg_temp.put('active',   (public.mint_serialized_item('fa000000-0000-4000-8000-000000000001', pg_temp.get('lot'), null, null, 'M-ACT')->>'id')::uuid);
select pg_temp.put('both',     (public.mint_serialized_item('fa000000-0000-4000-8000-000000000001', pg_temp.get('lot'), null, null, 'M-BOTH')->>'id')::uuid);

create or replace function pg_temp.reserve(p_item uuid, p_key uuid) returns uuid
language sql as $$
  select (public.reserve_inventory_media('fa000000-0000-4000-8000-000000000001', 'item',
    p_item, 'image/jpeg', 4000, p_key, 'p.jpg', null, null, 'Photo')->>'media_id')::uuid
$$;

-- reserved only: an upload that was started and never finished
select pg_temp.reserve(pg_temp.get('reserved'), 'fa0aaaaa-0001-4000-8000-000000000001');

-- deleted only: committed, then soft-deleted
select pg_temp.put('delmedia', pg_temp.reserve(pg_temp.get('deleted'), 'fa0aaaaa-0002-4000-8000-000000000001'));
select public.commit_inventory_media('fa000000-0000-4000-8000-000000000001', pg_temp.get('delmedia'));
select public.soft_delete_inventory_media('fa000000-0000-4000-8000-000000000001', pg_temp.get('delmedia'), 'blurry', 30);

-- active
select pg_temp.put('actmedia', pg_temp.reserve(pg_temp.get('active'), 'fa0aaaaa-0003-4000-8000-000000000001'));
select public.commit_inventory_media('fa000000-0000-4000-8000-000000000001', pg_temp.get('actmedia'));

-- active plus deleted
select pg_temp.put('bothgone', pg_temp.reserve(pg_temp.get('both'), 'fa0aaaaa-0004-4000-8000-000000000001'));
select public.commit_inventory_media('fa000000-0000-4000-8000-000000000001', pg_temp.get('bothgone'));
select public.soft_delete_inventory_media('fa000000-0000-4000-8000-000000000001', pg_temp.get('bothgone'), 'duplicate', 30);
select pg_temp.put('bothlive', pg_temp.reserve(pg_temp.get('both'), 'fa0aaaaa-0005-4000-8000-000000000001'));
select public.commit_inventory_media('fa000000-0000-4000-8000-000000000001', pg_temp.get('bothlive'));

-- The five states -----------------------------------------------------------------
select ok(pg_temp.queue_has(pg_temp.get('none')), 'no media at all needs photos');
select ok(pg_temp.queue_has(pg_temp.get('reserved')), 'an unfinished upload is not a photograph');
select ok(pg_temp.queue_has(pg_temp.get('deleted')), 'a deleted photograph is not a photograph');
select ok(not pg_temp.queue_has(pg_temp.get('active')), 'a live photograph satisfies the requirement');
select ok(not pg_temp.queue_has(pg_temp.get('both')), 'one live photograph is enough even beside a deleted one');

-- THE CENTRAL GUARANTEE ------------------------------------------------------------
-- The count and its destination must contain exactly the same records. Asserted
-- as set equality, so a future consumer that reads a different column fails
-- here rather than in production.
select is(
  (select count(*)::int from public.inventory_work_queue q
    where q.workspace_id = 'fa000000-0000-4000-8000-000000000001' and q.needs_photos),
  (select count(*)::int from public.inventory_record_overview o
    where o.workspace_id = 'fa000000-0000-4000-8000-000000000001' and o.needs_photos),
  'the dashboard count and the drill-down filter select the same number of records');

select is_empty(
  $$ select q.subject_id from public.inventory_work_queue q
      where q.workspace_id = 'fa000000-0000-4000-8000-000000000001' and q.needs_photos
     except
     select o.record_id from public.inventory_record_overview o
      where o.workspace_id = 'fa000000-0000-4000-8000-000000000001' and o.needs_photos $$,
  'every record the work queue counts is reachable in the destination it links to');

select is_empty(
  $$ select o.record_id from public.inventory_record_overview o
      where o.workspace_id = 'fa000000-0000-4000-8000-000000000001' and o.needs_photos
     except
     select q.subject_id from public.inventory_work_queue q
      where q.workspace_id = 'fa000000-0000-4000-8000-000000000001' and q.needs_photos $$,
  'and the destination never shows work the dashboard did not count');

-- The regression that started this: reserved-only and deleted-only were the
-- two records the old media_count filter silently dropped.
select ok(pg_temp.drilldown_has(pg_temp.get('reserved')),
  'the reserved-only record really is reachable through the filter');
select ok(pg_temp.drilldown_has(pg_temp.get('deleted')),
  'the deleted-only record really is reachable through the filter');

-- media_count is preserved, not redefined ------------------------------------------
-- Other consumers display it. Changing what an existing column means is how the
-- next divergence starts, so the new fact got a new name.
select is(pg_temp.total_count(pg_temp.get('deleted')), 1,
  'media_count still counts every lifecycle, including the deleted photograph');
select is(pg_temp.active_count(pg_temp.get('deleted')), 0,
  'while active_media_count reports the live truth');
select is(pg_temp.total_count(pg_temp.get('both')), 2,
  'media_count counts both photographs on the mixed record');
select is(pg_temp.active_count(pg_temp.get('both')), 1,
  'and active_media_count counts only the live one');

-- A deleted photograph must never be a record's thumbnail --------------------------
select is(
  (select o.primary_media_path from public.inventory_record_overview o
    where o.record_id = pg_temp.get('deleted')),
  null,
  'a record whose only photograph was deleted shows no thumbnail');

select isnt(
  (select o.primary_media_path from public.inventory_record_overview o
    where o.record_id = pg_temp.get('both')),
  (select m.storage_path from public.inventory_media m where m.id = pg_temp.get('bothgone')),
  'and the mixed record never displays its deleted photograph');

-- Committing a photograph clears the work from every surface at once ---------------
select pg_temp.put('fix', pg_temp.reserve(pg_temp.get('none'), 'fa0aaaaa-0006-4000-8000-000000000001'));
select public.commit_inventory_media('fa000000-0000-4000-8000-000000000001', pg_temp.get('fix'));

select ok(not pg_temp.queue_has(pg_temp.get('none')),
  'committing an active photograph removes the record from the work queue');
select ok(not pg_temp.drilldown_has(pg_temp.get('none')),
  'and from the filtered destination, with no refresh step in between');

select * from finish();
rollback;
