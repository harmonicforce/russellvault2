-- Every Listing Prep dashboard tile opens exactly the records it counted.
--
-- Three destinations were wrong, and each failure has the same shape: a number
-- computed one way, a page populated another way, and nothing forcing them to
-- agree. These assertions force it.
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

create or replace function pg_temp.summary(k text) returns int language sql stable as $$
  select ((public.get_listing_prep_summary('fc000000-0000-4000-8000-000000000001'))->>k)::int
$$;
create or replace function pg_temp.readiness_count(k text) returns int language sql stable as $$
  select coalesce(((((public.get_listing_prep_summary('fc000000-0000-4000-8000-000000000001'))
    ->'by_readiness')->>k)::int), 0)
$$;

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('fc011111-1111-4111-8111-111111111111', 'prep-dest@test.local');
insert into public.workspaces (id, name, created_by)
  values ('fc000000-0000-4000-8000-000000000001', 'Prep destinations WS',
          'fc011111-1111-4111-8111-111111111111');

select pg_temp.login('fc011111-1111-4111-8111-111111111111');
select public.register_storage_location('fc000000-0000-4000-8000-000000000001', 'BIN-D', null, 'Bin');

select pg_temp.put('prod', (public.register_product('fc000000-0000-4000-8000-000000000001',
  'tcg', 'Dest card', 'tcg|dest|1', '{}')->>'id')::uuid);
select pg_temp.put('sku', (public.register_sellable_sku('fc000000-0000-4000-8000-000000000001',
  pg_temp.get('prod'), '{"product_format":"Raw card"}')->>'id')::uuid);
select pg_temp.put('lot', (public.stage_inventory_lot('fc000000-0000-4000-8000-000000000001',
  'RV-D-0000000001', pg_temp.get('sku'), 'serialized', 3, 'BIN-D', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('a', (public.mint_serialized_item('fc000000-0000-4000-8000-000000000001', pg_temp.get('lot'), null, null, 'D-A')->>'id')::uuid);
select pg_temp.put('b', (public.mint_serialized_item('fc000000-0000-4000-8000-000000000001', pg_temp.get('lot'), null, null, 'D-B')->>'id')::uuid);
select pg_temp.put('c', (public.mint_serialized_item('fc000000-0000-4000-8000-000000000001', pg_temp.get('lot'), null, null, 'D-C')->>'id')::uuid);

-- NO ACTIVE PREPARATION -------------------------------------------------------------
-- The tile counted `not exists against listing_prep`; the destination read
-- listing_prep rows. One view now feeds both.
--
-- The population is named for what it actually is. It admits records whose
-- earlier preparation was listed or cancelled, so calling it "never started"
-- was false about their history -- see the repeat-preparation assertions below.
select is(pg_temp.summary('no_active_preparation'), 3,
  'all three items start with no active preparation');
select is(
  ((public.list_listing_prep_candidates('fc000000-0000-4000-8000-000000000001'))->>'total')::int,
  pg_temp.summary('no_active_preparation'),
  'the tile and its destination report the same total');

select pg_temp.put('prep_a', (public.start_listing_prep(
  'fc000000-0000-4000-8000-000000000001', 'item', pg_temp.get('a'))->>'id')::uuid);

select is(pg_temp.summary('no_active_preparation'), 2,
  'starting a preparation removes that record from the candidate count');
select is(
  ((public.list_listing_prep_candidates('fc000000-0000-4000-8000-000000000001'))->>'total')::int,
  2,
  'and from the destination, in the same read');

select ok(
  not exists (
    select 1 from jsonb_array_elements(
      (public.list_listing_prep_candidates('fc000000-0000-4000-8000-000000000001'))->'rows') r
     where (r->>'subject_id')::uuid = pg_temp.get('a')),
  'the record now being prepared is not offered as a candidate again');

-- The serialized parent lot is not a candidate: its items are the sellable units.
select ok(
  not exists (
    select 1 from jsonb_array_elements(
      (public.list_listing_prep_candidates('fc000000-0000-4000-8000-000000000001'))->'rows') r
     where (r->>'subject_id')::uuid = pg_temp.get('lot')),
  'a serialized parent lot is never offered as a listing candidate');

-- REPEAT PREPARATION ----------------------------------------------------------------
-- Why the population is NOT called "never started". A cancelled preparation
-- frees the record to be prepared again, and so does a completed listing: stock
-- comes back, a listing ends, and the record genuinely needs preparing afresh.
-- Both records below have a listing_prep history, and both belong here.
select public.transition_listing_prep('fc000000-0000-4000-8000-000000000001',
  pg_temp.get('prep_a'), 'cancelled', 'starting over');
select is(pg_temp.summary('no_active_preparation'), 3,
  'a cancelled preparation returns the record to the candidate population');

select ok(
  exists (
    select 1 from public.listing_prep lp
     where lp.workspace_id = 'fc000000-0000-4000-8000-000000000001'
       and lp.item_id = pg_temp.get('a')),
  'that record demonstrably has a preparation history, so "never started" would be false of it');

-- REGRESSED READY --------------------------------------------------------------------
-- Take a record all the way to ready, then break it, and prove the tile and the
-- drill-down still agree.
select pg_temp.put('prep_b', (public.start_listing_prep(
  'fc000000-0000-4000-8000-000000000001', 'item', pg_temp.get('b'))->>'id')::uuid);

create or replace function pg_temp.photograph(p_slot text, p_label text, p_key uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  v_id := (public.reserve_inventory_media('fc000000-0000-4000-8000-000000000001', 'item',
    pg_temp.get('b'), 'image/jpeg', 5000, p_key, p_slot || '.jpg', null, p_slot, p_label)->>'media_id')::uuid;
  perform public.commit_inventory_media('fc000000-0000-4000-8000-000000000001', v_id);
  return v_id;
end $$;

do $$
declare r record; i int := 0;
begin
  for r in select slot_key, slot_label from public.inventory_media_requirements
            where subtype = 'raw_card' and is_required loop
    i := i + 1;
    perform pg_temp.photograph(r.slot_key, r.slot_label,
      ('fc0aaaaa-000' || i || '-4000-8000-000000000001')::uuid);
  end loop;
  for r in select requirement_key from public.listing_prep_requirements
            where subtype = 'raw_card' and is_required loop
    perform public.set_listing_prep_check('fc000000-0000-4000-8000-000000000001',
      pg_temp.get('prep_b'), r.requirement_key, 'confirmed');
  end loop;
end $$;

select public.update_listing_prep_content('fc000000-0000-4000-8000-000000000001',
  pg_temp.get('prep_b'),
  ('{"working_title":"Dest card","condition_summary":"Good","currency":"USD",'
   || '"asking_price_minor":5000,"package_weight_grams":90,"package_length_mm":200,'
   || '"package_width_mm":150,"package_height_mm":20}')::jsonb);
select public.transition_listing_prep('fc000000-0000-4000-8000-000000000001',
  pg_temp.get('prep_b'), 'ready_to_list');

select is(pg_temp.summary('ready_now'), 1,
  'a genuinely ready record is counted as ready');
select is(pg_temp.summary('regressed_ready'), 0, 'and nothing has regressed yet');

-- Now break it: delete a required photograph. Readiness is recomputed on read,
-- so no job has to run for this to become true.
select public.soft_delete_inventory_media('fc000000-0000-4000-8000-000000000001',
  (select id from public.inventory_media
    where item_id = pg_temp.get('b') and lifecycle = 'active'
    order by created_at limit 1),
  'lost the original', 30);

select is(
  (select status::text from public.listing_prep where id = pg_temp.get('prep_b')),
  'ready_to_list',
  'the record KEEPS its ready status -- nothing is silently mutated');
select is(pg_temp.summary('ready_now'), 0,
  'but it is no longer counted as genuinely ready');
select is(pg_temp.summary('regressed_ready'), 1,
  'it is counted as regressed instead');
select is(
  ((public.get_listing_prep_summary('fc000000-0000-4000-8000-000000000001'))
    ->'by_status'->>'ready_to_list')::int,
  1,
  'and the raw status tally is unchanged, because other readers depend on it');

-- THE DRILL-DOWN MUST CONTAIN IT ------------------------------------------------------
-- This is the defect: the tile counted the regressed record under its blocker,
-- but the link forced the queue tab, whose statuses exclude ready_to_list.
select is(pg_temp.readiness_count('needs_photos'), 1,
  'the regressed record is counted under its actual blocker');

-- The old destination: queue-tab statuses only.
select is(
  ((public.list_listing_prep_queue('fc000000-0000-4000-8000-000000000001',
     array['not_started', 'in_preparation', 'blocked', 'needs_review'],
     array['needs_photos']))->>'total')::int,
  0,
  'the old queue-tab-only destination could not contain it');

-- The repaired destination: every live status.
select is(
  ((public.list_listing_prep_queue('fc000000-0000-4000-8000-000000000001',
     array['not_started', 'in_preparation', 'blocked', 'needs_review', 'ready_to_list'],
     array['needs_photos']))->>'total')::int,
  pg_temp.readiness_count('needs_photos'),
  'the readiness drill-down across live statuses contains exactly what was counted');

-- READY TO LIST ------------------------------------------------------------------------
-- The Ready tab must show only records whose live readiness still agrees.
select is(
  ((public.list_listing_prep_queue('fc000000-0000-4000-8000-000000000001',
     array['ready_to_list'], array['ready']))->>'total')::int,
  pg_temp.summary('ready_now'),
  'the ready tab shows exactly the genuinely-ready count');

-- And the regressed destination is the complement over the same status.
select is(
  ((public.list_listing_prep_queue('fc000000-0000-4000-8000-000000000001',
     array['ready_to_list'],
     array['blocked', 'needs_photos', 'needs_identity_review', 'needs_condition_review',
           'needs_measurements', 'needs_quantity', 'needs_package_details',
           'needs_price', 'needs_content', 'needs_owner_review']))->>'total')::int,
  pg_temp.summary('regressed_ready'),
  'the regressed destination contains exactly the regressed count');

-- A LISTED record returns to the population ------------------------------------------
-- The decisive case for the naming. Item B has been prepared all the way and
-- listed; when that listing ends the record is sellable again and needs
-- preparing afresh, so it belongs in this population -- and it has plainly not
-- "never started".
-- Re-photograph what was deleted above, so the record is genuinely ready again
-- rather than being listed while regressed.
do $$
declare r record; i int := 0;
begin
  for r in select slot_key, slot_label from public.inventory_media_requirements
            where subtype = 'raw_card' and is_required loop
    i := i + 1;
    perform pg_temp.photograph(r.slot_key, r.slot_label,
      ('fc0bbbbb-000' || i || '-4000-8000-000000000001')::uuid);
  end loop;
end $$;

select is(pg_temp.summary('regressed_ready'), 0,
  'restoring the photograph clears the regression, with no status change');

-- Through the governed listing path, not a raw status transition: the
-- lifecycle deliberately refuses `transition_listing_prep(..., 'listed', ...)`.
select public.mark_listing_prep_listed('fc000000-0000-4000-8000-000000000001',
  pg_temp.get('prep_b'), 'EXT-LISTING-1');

select is(
  (select status::text from public.listing_prep where id = pg_temp.get('prep_b')),
  'listed',
  'the preparation reached listed');

select ok(
  exists (
    select 1 from jsonb_array_elements(
      (public.list_listing_prep_candidates('fc000000-0000-4000-8000-000000000001'))->'rows') r
     where (r->>'subject_id')::uuid = pg_temp.get('b')),
  'a record whose preparation was listed is offered for preparation again');

select is(
  ((public.list_listing_prep_candidates('fc000000-0000-4000-8000-000000000001'))->>'total')::int,
  pg_temp.summary('no_active_preparation'),
  'and the tile still matches its destination after that repeat becomes possible');

-- No overload was added to the queue function ---------------------------------------
-- Amendment: broadening the status list is a caller decision. A second
-- signature would be a new PostgreSQL overload and an ambiguity risk.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_listing_prep_queue'),
  1,
  'list_listing_prep_queue still has exactly one signature');

-- Authorization -------------------------------------------------------------------
select ok(
  not has_function_privilege('anon',
    'public.list_listing_prep_candidates(uuid, text, text, integer, integer)', 'execute'),
  'anon cannot list listing candidates');

select * from finish();
rollback;
