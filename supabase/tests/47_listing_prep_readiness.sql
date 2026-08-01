-- Listing Prep — readiness, and the things that must never be called ready.
--
-- The central claim is that readiness is EARNED, not inferred. A record does
-- not become listable because its columns stopped being null; and it stops
-- being listable the moment the goods behind it stop being sellable, without
-- anybody having to remember to come back and change a flag.
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

/** The live readiness of one preparation, as the owner would see it. */
create or replace function pg_temp.readiness(p_prep uuid) returns text
language sql stable as $$
  select readiness_status from public.listing_prep_readiness where prep_id = p_prep
$$;
create or replace function pg_temp.has_blocker(p_prep uuid, p_code text) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.listing_prep_readiness r,
      lateral jsonb_array_elements(r.blockers) b
     where r.prep_id = p_prep and b->>'code' = p_code)
$$;

-- Fixtures ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('ea111111-1111-4111-8111-111111111111', 'ready-owner@test.local'),
  ('ea222222-2222-4222-8222-222222222222', 'ready-operator@test.local');
insert into public.workspaces (id, name, created_by)
  values ('ea000000-0000-4000-8000-000000000001', 'Readiness WS',
          'ea111111-1111-4111-8111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('ea000000-0000-4000-8000-000000000001', 'ea222222-2222-4222-8222-222222222222', 'operator');

select pg_temp.login('ea111111-1111-4111-8111-111111111111');
select public.register_storage_location('ea000000-0000-4000-8000-000000000001', 'BIN-R', null, 'Bin');

-- A raw card: the category that most depends on somebody assessing condition.
select pg_temp.put('prod', (public.register_product('ea000000-0000-4000-8000-000000000001',
  'tcg', 'Blastoise', 'tcg|blastoise|1', '{}')->>'id')::uuid);
select pg_temp.put('sku', (public.register_sellable_sku('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prod'), '{"product_format":"Raw card"}')->>'id')::uuid);
select pg_temp.put('lot', (public.stage_inventory_lot('ea000000-0000-4000-8000-000000000001',
  'RV-R-0000000001', pg_temp.get('sku'), 'serialized', 2, 'BIN-R', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('item', (public.mint_serialized_item('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('lot'), null, null, 'RAW-1')->>'id')::uuid);
select pg_temp.put('item2', (public.mint_serialized_item('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('lot'), null, null, 'RAW-2')->>'id')::uuid);

select is(
  (select inventory_subtype::text from public.sellable_skus where id = pg_temp.get('sku')),
  'raw_card',
  'the fixture really is the category whose rules are being tested');

select pg_temp.put('prep', (public.start_listing_prep(
  'ea000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item'))->>'id')::uuid);

-- Photographs come first in the blocker order, because nothing else can be
-- judged about goods nobody has photographed.
select is(pg_temp.readiness(pg_temp.get('prep')), 'needs_photos',
  'a record with no photographs is never ready');

-- Give it every photograph the category asks for.
create or replace function pg_temp.photograph(p_subject uuid, p_slot text, p_label text, p_key uuid)
returns void language plpgsql as $$
declare v_id uuid;
begin
  v_id := (public.reserve_inventory_media('ea000000-0000-4000-8000-000000000001', 'item',
    p_subject, 'image/jpeg', 5000, p_key, p_slot || '.jpg', null, p_slot, p_label)->>'media_id')::uuid;
  perform public.commit_inventory_media('ea000000-0000-4000-8000-000000000001', v_id);
end $$;

do $$
declare r record; i int := 0;
begin
  for r in select slot_key, slot_label from public.inventory_media_requirements
            where subtype = 'raw_card' and is_required loop
    i := i + 1;
    perform pg_temp.photograph(pg_temp.get('item'), r.slot_key, r.slot_label,
      ('eabbbbbb-000' || i || '-4000-8000-000000000001')::uuid);
  end loop;
end $$;

-- Required scenario: a raw card is blocked until somebody assesses condition.
select is(pg_temp.readiness(pg_temp.get('prep')), 'needs_identity_review',
  'with the photographs done, the unconfirmed identity checks come next');

select public.set_listing_prep_check('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), 'card_identity_reviewed', 'confirmed');
select public.set_listing_prep_check('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), 'card_number_confirmed', 'confirmed');

select is(pg_temp.readiness(pg_temp.get('prep')), 'needs_condition_review',
  'a raw card is not listable until its condition has been assessed');

select ok(pg_temp.has_blocker(pg_temp.get('prep'), 'check_condition_assessment'),
  'and the blocker names the assessment that is missing, not just "not ready"');

-- Filling the fields in is NOT the same as somebody confirming them. This is
-- the whole reason listing_prep_checks exists as its own table.
select public.update_listing_prep_content('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'),
  ('{"working_title":"Blastoise base set","condition_summary":"Sharp corners, light whitening",'
   || '"defects_disclosures":"Minor whitening on the back edge","currency":"USD",'
   || '"asking_price_minor":8500,"package_weight_grams":90,"package_length_mm":200,'
   || '"package_width_mm":150,"package_height_mm":20}')::jsonb);

select is(pg_temp.readiness(pg_temp.get('prep')), 'needs_condition_review',
  'writing a condition summary does not confirm the condition was assessed');

select public.set_listing_prep_check('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), 'condition_assessment', 'confirmed');
select public.set_listing_prep_check('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), 'defect_notes', 'confirmed');
select public.set_listing_prep_check('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), 'shipping_protection', 'confirmed');

select is(pg_temp.readiness(pg_temp.get('prep')), 'ready',
  'with photographs, confirmations and content all present, it is ready');

-- An optional requirement never blocks.
select is(
  (select state::text from public.listing_prep_checks
    where prep_id = pg_temp.get('prep') and requirement_key = 'language_confirmed'),
  null,
  'and the optional requirement was never even touched');

-- Required scenario: content that goes missing takes readiness with it. --------
select public.update_listing_prep_content('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), '{"asking_price_minor":null}'::jsonb);
select is(pg_temp.readiness(pg_temp.get('prep')), 'needs_price',
  'removing the price makes it not ready again, with no refresh step');
select public.update_listing_prep_content('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), '{"asking_price_minor":8500}'::jsonb);

-- Required scenario: a correction invalidates prior readiness. -----------------
select public.request_inventory_correction('ea000000-0000-4000-8000-000000000001',
  'item', pg_temp.get('item'), 'wrong_set',
  'This might be the shadowless print, not the base set one.');

select is(pg_temp.readiness(pg_temp.get('prep')), 'blocked',
  'an open correction request stops a ready record dead');
select ok(pg_temp.has_blocker(pg_temp.get('prep'), 'open_correction_request'),
  'and says so, rather than reporting a vague failure');

-- The owner cannot wave it through while the dispute is open.
select throws_ok(
  format($$select public.transition_listing_prep('ea000000-0000-4000-8000-000000000001',%L,'ready_to_list')$$,
    pg_temp.get('prep')),
  '23514', null,
  'not even an owner can mark a disputed record ready to list');

-- Required scenario: non-sellable stock is never ready. ------------------------
select pg_temp.put('prep2', (public.start_listing_prep(
  'ea000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item2'))->>'id')::uuid);

do $$
declare r record; i int := 100;
begin
  for r in select slot_key, slot_label from public.inventory_media_requirements
            where subtype = 'raw_card' and is_required loop
    i := i + 1;
    perform pg_temp.photograph(pg_temp.get('item2'), r.slot_key, r.slot_label,
      ('eacccccc-0' || i || '-4000-8000-000000000001')::uuid);
  end loop;
  for r in select requirement_key from public.listing_prep_requirements
            where subtype = 'raw_card' and is_required loop
    perform public.set_listing_prep_check('ea000000-0000-4000-8000-000000000001',
      pg_temp.get('prep2'), r.requirement_key, 'confirmed');
  end loop;
end $$;

select public.update_listing_prep_content('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('prep2'),
  ('{"working_title":"Blastoise base set","condition_summary":"Good","currency":"USD",'
   || '"asking_price_minor":8000,"package_weight_grams":90,"package_length_mm":200,'
   || '"package_width_mm":150,"package_height_mm":20}')::jsonb);

select is(pg_temp.readiness(pg_temp.get('prep2')), 'ready',
  'the second card is fully prepared');

select public.record_inventory_item_loss_event('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('item2'), 'not on the shelf at the last count',
  'eadddddd-0001-4000-8000-000000000001'::uuid);

select is(pg_temp.readiness(pg_temp.get('prep2')), 'blocked',
  'a lost item is never ready, however complete its paperwork was');
select ok(pg_temp.has_blocker(pg_temp.get('prep2'), 'subject_not_sellable'),
  'and the blocker says the goods are the problem');

select throws_ok(
  format($$select public.transition_listing_prep('ea000000-0000-4000-8000-000000000001',%L,'ready_to_list')$$,
    pg_temp.get('prep2')),
  '23514', null,
  'and it cannot be declared ready afterwards either');

-- Preparation cannot even be started on stock that is gone.
select throws_ok(
  format($$select public.start_listing_prep('ea000000-0000-4000-8000-000000000001','item',%L)$$,
    pg_temp.get('item2')),
  '23514', null,
  'nor can a fresh preparation be started for it');

-- An unclassified record cannot be prepared for sale at all. -------------------
select pg_temp.put('uprod', (public.register_product('ea000000-0000-4000-8000-000000000001',
  'other', 'Mystery box', 'other|mystery|1', '{}')->>'id')::uuid);
select pg_temp.put('usku', (public.register_sellable_sku('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('uprod'), '{}')->>'id')::uuid);
select pg_temp.put('ulot', (public.stage_inventory_lot('ea000000-0000-4000-8000-000000000001',
  'RV-R-0000000009', pg_temp.get('usku'), 'lot_managed', 1, 'BIN-R', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('uprep', (public.start_listing_prep(
  'ea000000-0000-4000-8000-000000000001', 'lot', pg_temp.get('ulot'))->>'id')::uuid);

select is(
  (select inventory_subtype::text from public.sellable_skus where id = pg_temp.get('usku')),
  'unclassified',
  'a record whose facts identify no category stays unclassified');
select ok(pg_temp.has_blocker(pg_temp.get('uprep'), 'unclassified_record'),
  'and it can never be ready, because nobody has said what it is');

-- Package presets ----------------------------------------------------------------
select pg_temp.put('preset', (public.create_listing_package_preset(
  'ea000000-0000-4000-8000-000000000001', 'Card mailer', 90, 200, 150, 20,
  'standard-ship', null)->>'id')::uuid);

select throws_ok(
  $$select public.create_listing_package_preset('ea000000-0000-4000-8000-000000000001','card mailer')$$,
  '23505', null,
  'two live presets cannot share a name, whatever the capitalisation');

select public.apply_listing_package_preset('ea000000-0000-4000-8000-000000000001',
  pg_temp.get('uprep'), pg_temp.get('preset'));

select is(
  (select package_weight_grams from public.listing_prep where id = pg_temp.get('uprep')),
  90,
  'applying a preset fills in the package it describes');

select is(
  (select return_policy_ref from public.listing_prep where id = pg_temp.get('uprep')),
  null,
  'and a preset that says nothing about a field does not blank out that field');

select ok(
  exists (select 1 from public.listing_prep_events
           where prep_id = pg_temp.get('uprep') and event_type = 'preset_applied'),
  'applying a preset is recorded in the history like any other change');

-- Bulk work ------------------------------------------------------------------------
select pg_temp.login('ea222222-2222-4222-8222-222222222222');

select is(
  (public.bulk_listing_prep_action('ea000000-0000-4000-8000-000000000001',
    array[pg_temp.get('prep'), pg_temp.get('uprep')], 'set_priority',
    '{"priority":"urgent"}'::jsonb))->>'applied',
  '2',
  'a bulk change applies to every record it was given');

select is(
  (select count(*)::int from public.listing_prep
    where workspace_id = 'ea000000-0000-4000-8000-000000000001' and priority = 'urgent'),
  2,
  'and the records really changed');

-- The bulk path is not a shortcut past the single-record rules.
select throws_ok(
  format($$select public.bulk_listing_prep_action('ea000000-0000-4000-8000-000000000001',array[%L]::uuid[],'mark_ready')$$,
    pg_temp.get('prep')),
  '42501', null,
  'an operator cannot use a bulk action to declare records ready');

select pg_temp.login('ea111111-1111-4111-8111-111111111111');
select is(
  (public.bulk_listing_prep_action('ea000000-0000-4000-8000-000000000001',
    array[pg_temp.get('prep'), pg_temp.get('uprep')], 'mark_ready'))->>'applied',
  '0',
  'and an owner''s bulk action still respects each record''s own blockers');

select is(
  (public.bulk_listing_prep_action('ea000000-0000-4000-8000-000000000001',
    array[pg_temp.get('prep'), pg_temp.get('uprep')], 'mark_ready'))->>'failed',
  '2',
  'the records that could not be changed are reported rather than silently skipped');

select throws_ok(
  $$select public.bulk_listing_prep_action('ea000000-0000-4000-8000-000000000001',
      (select array_agg(gen_random_uuid()) from generate_series(1,201)), 'cancel')$$,
  '23514', null,
  'a bulk action is bounded rather than accepting an unbounded batch');

-- The Workbench summary -------------------------------------------------------------
select ok(
  ((public.get_listing_prep_summary('ea000000-0000-4000-8000-000000000001'))->'by_readiness')
    ? 'blocked',
  'the workbench summary counts by readiness rather than listing every record');

select * from finish();
rollback;
