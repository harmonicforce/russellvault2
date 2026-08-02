-- Operational media backlogs describe CURRENT stock, and historical records
-- keep their readiness.
--
-- Both halves matter. A voided or lost record must stop appearing as photo work
-- the operator can never clear; and its detail page must still be able to say
-- what photographs it has, because those photographs are evidence.
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

create or replace function pg_temp.in_current(p_id uuid) returns boolean
language sql stable as $$
  select exists (select 1 from public.inventory_media_readiness_current
                  where subject_id = p_id)
$$;
create or replace function pg_temp.in_base(p_id uuid) returns boolean
language sql stable as $$
  select exists (select 1 from public.inventory_media_readiness where subject_id = p_id)
$$;

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('fb011111-1111-4111-8111-111111111111', 'current-readiness@test.local'),
  ('fb022222-2222-4222-8222-222222222222', 'outsider@test.local');
insert into public.workspaces (id, name, created_by)
  values ('fb000000-0000-4000-8000-000000000001', 'Current readiness WS',
          'fb011111-1111-4111-8111-111111111111');

select pg_temp.login('fb011111-1111-4111-8111-111111111111');
select public.register_storage_location('fb000000-0000-4000-8000-000000000001', 'BIN-C', null, 'Bin');

select pg_temp.put('prod', (public.register_product('fb000000-0000-4000-8000-000000000001',
  'tcg', 'Scope card', 'tcg|scope|1', '{}')->>'id')::uuid);
select pg_temp.put('sku', (public.register_sellable_sku('fb000000-0000-4000-8000-000000000001',
  pg_temp.get('prod'), '{"product_format":"Raw card"}')->>'id')::uuid);

-- A serialized parent lot: the lot itself is not sellable stock, its items are.
select pg_temp.put('slot', (public.stage_inventory_lot('fb000000-0000-4000-8000-000000000001',
  'RV-C-0000000001', pg_temp.get('sku'), 'serialized', 3, 'BIN-C', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('live',  (public.mint_serialized_item('fb000000-0000-4000-8000-000000000001', pg_temp.get('slot'), null, null, 'C-LIVE')->>'id')::uuid);
select pg_temp.put('lost',  (public.mint_serialized_item('fb000000-0000-4000-8000-000000000001', pg_temp.get('slot'), null, null, 'C-LOST')->>'id')::uuid);
-- NOTE: no governed function sets item_state = 'void' today; only loss and
-- supersession are reachable. The overview excludes every non-active state
-- with one predicate, so 'lost' exercises that path for the item grain.

-- A quantity-managed lot that is still stock, and one that has been emptied.
select pg_temp.put('qlot', (public.stage_inventory_lot('fb000000-0000-4000-8000-000000000001',
  'RV-C-0000000002', pg_temp.get('sku'), 'lot_managed', 4, 'BIN-C', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('empty', (public.stage_inventory_lot('fb000000-0000-4000-8000-000000000001',
  'RV-C-0000000003', pg_temp.get('sku'), 'lot_managed', 2, 'BIN-C', 'test', '1.0.0', null)->>'id')::uuid);

-- Baseline: the base view sees every subject, which is what its own job needs.
select ok(pg_temp.in_base(pg_temp.get('live')), 'the base readiness view sees the live item');
select ok(pg_temp.in_base(pg_temp.get('slot')), 'and it sees the serialized parent lot too');

-- Current stock ------------------------------------------------------------------
select ok(pg_temp.in_current(pg_temp.get('live')),
  'a live serialized item is current media work');
select ok(pg_temp.in_current(pg_temp.get('qlot')),
  'a quantity-managed lot with stock is current media work');
select ok(not pg_temp.in_current(pg_temp.get('slot')),
  'a serialized parent lot is not sellable stock and is not photo work');

-- Retire the records and confirm they leave the operational view ------------------
select public.record_inventory_item_loss_event('fb000000-0000-4000-8000-000000000001',
  pg_temp.get('lost'), 'not on the shelf', 'fb0aaaaa-0001-4000-8000-000000000001'::uuid);
select ok(not pg_temp.in_current(pg_temp.get('lost')),
  'a lost item stops being counted as photo work');

-- Deplete the lot to zero.
select public.adjust_lot_quantity('fb000000-0000-4000-8000-000000000001',
  pg_temp.get('empty'), -2, 'sold_elsewhere', 2, 'emptied for this test');
select ok(not pg_temp.in_current(pg_temp.get('empty')),
  'a depleted quantity lot stops being counted as photo work');

-- HISTORY IS NOT DESTROYED --------------------------------------------------------
-- The detail page for a retired record still has to resolve, because its
-- photographs remain evidence of what was received.
select ok(pg_temp.in_base(pg_temp.get('lost')),
  'the lost item is still present in the base readiness view');
select isnt(
  (public.get_inventory_media_readiness('fb000000-0000-4000-8000-000000000001',
    'item', pg_temp.get('lost')))->>'readiness_status',
  null,
  'a retired record''s detail page can still ask for its photo readiness');

-- The dashboard totals ------------------------------------------------------------
select is(
  ((public.get_operations_media_backlog('fb000000-0000-4000-8000-000000000001'))->>'no_active_photo')::int,
  (select count(*)::int from public.inventory_work_queue
    where workspace_id = 'fb000000-0000-4000-8000-000000000001' and needs_photos),
  'the no-active-photo total is the exact work-queue population');

-- Amendment: this total must be exact, never a page of candidates. Today's Work
-- is capped at twenty, so deriving it there would understate a real backlog.
select ok(
  ((public.get_operations_media_backlog('fb000000-0000-4000-8000-000000000001'))->>'no_active_photo')::int
    = (select count(*)::int from public.inventory_record_overview
        where workspace_id = 'fb000000-0000-4000-8000-000000000001' and needs_photos),
  'and it equals the drill-down destination it links to');

select is(
  (select count(*)::int from jsonb_object_keys(
    (public.get_operations_media_backlog('fb000000-0000-4000-8000-000000000001'))->'by_readiness') k
   where k = 'complete'),
  (select count(*)::int from (select 1 from public.inventory_media_readiness_current
     where workspace_id = 'fb000000-0000-4000-8000-000000000001'
       and readiness_status = 'complete' limit 1) x),
  'the readiness breakdown reports only statuses that current stock actually has');

-- The summary the Workbench reads is now current-stock too.
select is(
  (select sum(v::int)::int from jsonb_each_text(
    (public.get_media_readiness_summary('fb000000-0000-4000-8000-000000000001'))->'counts') as e(k, v)),
  (select count(*)::int from public.inventory_media_readiness_current
    where workspace_id = 'fb000000-0000-4000-8000-000000000001'),
  'the media readiness summary counts current stock and nothing else');

-- The drill-down returns exactly what was counted --------------------------------
select is(
  ((public.list_current_media_readiness('fb000000-0000-4000-8000-000000000001',
     array['missing_required_angle']))->>'total')::int,
  (select count(*)::int from public.inventory_media_readiness_current
    where workspace_id = 'fb000000-0000-4000-8000-000000000001'
      and readiness_status = 'missing_required_angle'),
  'the readiness drill-down total matches the counted population');

select ok(
  not exists (
    select 1 from jsonb_array_elements(
      (public.list_current_media_readiness('fb000000-0000-4000-8000-000000000001'))->'rows') r
     where (r->>'subject_id')::uuid in (pg_temp.get('lost'), pg_temp.get('slot'),
                                        pg_temp.get('empty'))),
  'and no retired, depleted or parent-lot record appears in it');

-- Authorization -------------------------------------------------------------------
select pg_temp.login('fb022222-2222-4222-8222-222222222222');
select throws_ok(
  $$select public.get_operations_media_backlog('fb000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'somebody outside the workspace cannot read its media backlog');
select throws_ok(
  $$select public.list_current_media_readiness('fb000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'nor its readiness drill-down');
select is(
  (select count(*)::int from public.inventory_media_readiness_current),
  0,
  'and the current readiness view is workspace-scoped by RLS');

select * from finish();
rollback;
