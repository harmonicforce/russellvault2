-- Listing Prep — the lifecycle, its authority, and its history.
--
-- The claims that matter: preparation attaches to the sellable unit and not to
-- a serialized parent lot; only an owner declares something ready or records
-- that it was listed; a viewer can do none of it; recording a listing moves no
-- stock; and every change leaves a history entry nobody can edit afterwards.
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
create or replace function pg_temp.prep() returns setof public.listing_prep
  language sql security definer stable as $$ select * from public.listing_prep $$;
create or replace function pg_temp.events() returns setof public.listing_prep_events
  language sql security definer stable as $$ select * from public.listing_prep_events $$;

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email) values
  ('da111111-1111-4111-8111-111111111111', 'lp-owner@test.local'),
  ('da222222-2222-4222-8222-222222222222', 'lp-operator@test.local'),
  ('da333333-3333-4333-8333-333333333333', 'lp-viewer@test.local'),
  ('da444444-4444-4444-8444-444444444444', 'lp-stranger@test.local');

insert into public.workspaces (id, name, created_by)
  values ('da000000-0000-4000-8000-000000000001', 'Listing WS',
          'da111111-1111-4111-8111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('da000000-0000-4000-8000-000000000001', 'da222222-2222-4222-8222-222222222222', 'operator'),
  ('da000000-0000-4000-8000-000000000001', 'da333333-3333-4333-8333-333333333333', 'viewer');

select pg_temp.login('da111111-1111-4111-8111-111111111111');
select public.register_storage_location('da000000-0000-4000-8000-000000000001', 'BIN-P', null, 'Bin');

-- A serialized card (item is the sellable unit) and a quantity-managed box.
select pg_temp.put('prod', (public.register_product('da000000-0000-4000-8000-000000000001',
  'tcg', 'Prep card', 'tcg|prep|1', '{}')->>'id')::uuid);
select pg_temp.put('sku', (public.register_sellable_sku('da000000-0000-4000-8000-000000000001',
  pg_temp.get('prod'), '{"product_format":"Raw card"}')->>'id')::uuid);
select pg_temp.put('lot', (public.stage_inventory_lot('da000000-0000-4000-8000-000000000001',
  'RV-P-0000000001', pg_temp.get('sku'), 'serialized', 1, 'BIN-P', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('item', (public.mint_serialized_item('da000000-0000-4000-8000-000000000001',
  pg_temp.get('lot'), null, null, 'PREP-1')->>'id')::uuid);

select pg_temp.put('bulkprod', (public.register_product('da000000-0000-4000-8000-000000000001',
  'tcg', 'Prep box', 'tcg|prepbox|1', '{}')->>'id')::uuid);
select pg_temp.put('bulksku', (public.register_sellable_sku('da000000-0000-4000-8000-000000000001',
  pg_temp.get('bulkprod'), '{"product_format":"Booster box"}')->>'id')::uuid);
select pg_temp.put('bulklot', (public.stage_inventory_lot('da000000-0000-4000-8000-000000000001',
  'RV-P-0000000002', pg_temp.get('bulksku'), 'lot_managed', 6, 'BIN-P', 'test', '1.0.0', null)->>'id')::uuid);

-- The grain rule ----------------------------------------------------------------
-- A serialized parent lot is not a sellable unit; its items are. Letting it
-- carry its own preparation would put two records in charge of the same goods.
select throws_ok(
  format($$select public.start_listing_prep('da000000-0000-4000-8000-000000000001','lot',%L)$$,
    pg_temp.get('lot')),
  '23514', null,
  'a serialized lot is prepared through its items, never as a lot');

select pg_temp.put('prep', (public.start_listing_prep(
  'da000000-0000-4000-8000-000000000001', 'item', pg_temp.get('item'))->>'id')::uuid);

select is(
  (select status::text from pg_temp.prep() where id = pg_temp.get('prep')),
  'not_started',
  'a new preparation starts as not started, claiming nothing');

select matches(
  (select public_id from pg_temp.prep() where id = pg_temp.get('prep')),
  '^RV-LP-[A-Z0-9]{6,20}$',
  'and it is identified by a governed public id, not a raw UUID');

-- A quantity-managed lot IS the sellable unit and gets its own preparation.
select pg_temp.put('lotprep', (public.start_listing_prep(
  'da000000-0000-4000-8000-000000000001', 'lot', pg_temp.get('bulklot'))->>'id')::uuid);
select isnt(pg_temp.get('lotprep'), null,
  'a quantity-managed lot is prepared as a lot');

-- One live preparation per record ------------------------------------------------
select throws_ok(
  format($$select public.start_listing_prep('da000000-0000-4000-8000-000000000001','item',%L)$$,
    pg_temp.get('item')),
  '23505', null,
  'a second live preparation for the same record is refused');

-- Authority ------------------------------------------------------------------------
select pg_temp.login('da333333-3333-4333-8333-333333333333');

select throws_ok(
  format($$select public.update_listing_prep_content('da000000-0000-4000-8000-000000000001',%L,'{"working_title":"x"}'::jsonb)$$,
    pg_temp.get('prep')),
  '42501', null,
  'a viewer cannot edit listing content');
select throws_ok(
  format($$select public.set_listing_prep_check('da000000-0000-4000-8000-000000000001',%L,'card_identity_reviewed','confirmed')$$,
    pg_temp.get('prep')),
  '42501', null,
  'a viewer cannot confirm a preparation fact');
select throws_ok(
  format($$select public.transition_listing_prep('da000000-0000-4000-8000-000000000001',%L,'needs_review')$$,
    pg_temp.get('prep')),
  '42501', null,
  'a viewer cannot move a preparation through its lifecycle');

select ok(
  (select count(*) from public.listing_prep
    where workspace_id = 'da000000-0000-4000-8000-000000000001') > 0,
  'but a viewer can read every preparation in their workspace');

-- A stranger sees nothing at all.
select pg_temp.login('da444444-4444-4444-8444-444444444444');
select is(
  (select count(*)::int from public.listing_prep),
  0,
  'somebody outside the workspace sees no preparation records');
select throws_ok(
  format($$select public.get_listing_prep('da000000-0000-4000-8000-000000000001',%L)$$,
    pg_temp.get('prep')),
  '42501', null,
  'and cannot read one by naming it');

-- Content editing ---------------------------------------------------------------------
select pg_temp.login('da222222-2222-4222-8222-222222222222');

select is(
  (public.update_listing_prep_content('da000000-0000-4000-8000-000000000001',
    pg_temp.get('prep'),
    '{"working_title":"Charizard holo","condition_summary":"Light edge wear"}'::jsonb))->>'status',
  'in_preparation',
  'writing something down moves the record into preparation');

select throws_ok(
  format($$select public.update_listing_prep_content('da000000-0000-4000-8000-000000000001',%L,'{"listing_price":100}'::jsonb)$$,
    pg_temp.get('prep')),
  '23514', null,
  'a field nobody recognizes is refused rather than silently dropped');

select throws_ok(
  format($$select public.update_listing_prep_content('da000000-0000-4000-8000-000000000001',%L,'{"asking_price_minor":12.5}'::jsonb)$$,
    pg_temp.get('prep')),
  '23514', null,
  'a fractional price is refused rather than rounded');

-- Quantity is meaningless for a single serialized unit.
select throws_ok(
  format($$select public.update_listing_prep_content('da000000-0000-4000-8000-000000000001',%L,'{"quantity_to_list":3}'::jsonb)$$,
    pg_temp.get('prep')),
  '23514', null,
  'a serialized item carries no listing quantity');

-- A key present with null clears the value; a key absent leaves it alone.
select public.update_listing_prep_content('da000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), '{"condition_summary":null}'::jsonb);
select is(
  (select condition_summary from pg_temp.prep() where id = pg_temp.get('prep')),
  null,
  'a field is cleared by naming it explicitly');
select is(
  (select working_title from pg_temp.prep() where id = pg_temp.get('prep')),
  'Charizard holo',
  'and a field nobody mentioned is left exactly as it was');

-- Confirmations ------------------------------------------------------------------------
select throws_ok(
  format($$select public.set_listing_prep_check('da000000-0000-4000-8000-000000000001',%L,'invented_requirement','confirmed')$$,
    pg_temp.get('prep')),
  '23514', null,
  'a confirmation can only name a requirement this category actually has');

select public.set_listing_prep_check('da000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), 'card_identity_reviewed', 'confirmed', 'checked against the set list');

select is(
  (select confirmed_by from public.listing_prep_checks
    where prep_id = pg_temp.get('prep') and requirement_key = 'card_identity_reviewed'),
  'da222222-2222-4222-8222-222222222222'::uuid,
  'a confirmation records who made it');

select public.set_listing_prep_check('da000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), 'card_identity_reviewed', 'unknown');
select is(
  (select confirmed_by from public.listing_prep_checks
    where prep_id = pg_temp.get('prep') and requirement_key = 'card_identity_reviewed'),
  null,
  'and withdrawing it removes the person''s name with it');

-- The lifecycle gate ------------------------------------------------------------------
select throws_ok(
  format($$select public.transition_listing_prep('da000000-0000-4000-8000-000000000001',%L,'blocked')$$,
    pg_temp.get('prep')),
  '23514', null,
  'blocking a preparation requires a reason');

select public.transition_listing_prep('da000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), 'blocked', 'waiting on the grading return');
select is(
  (select blocked_reason from pg_temp.prep() where id = pg_temp.get('prep')),
  'waiting on the grading return',
  'and the reason is kept where the next person will see it');

select public.transition_listing_prep('da000000-0000-4000-8000-000000000001',
  pg_temp.get('prep'), 'in_preparation');
select is(
  (select blocked_reason from pg_temp.prep() where id = pg_temp.get('prep')),
  null,
  'unblocking clears the reason rather than leaving a stale one on screen');

-- An operator cannot declare goods fit to sell.
select throws_ok(
  format($$select public.transition_listing_prep('da000000-0000-4000-8000-000000000001',%L,'ready_to_list')$$,
    pg_temp.get('prep')),
  '42501', null,
  'an operator cannot declare a record ready to list');

-- Recording a listing has its own function and its own evidence.
select throws_ok(
  format($$select public.transition_listing_prep('da000000-0000-4000-8000-000000000001',%L,'listed')$$,
    pg_temp.get('prep')),
  '23514', null,
  'the general transition cannot be used to record a listing');

select pg_temp.login('da111111-1111-4111-8111-111111111111');
select throws_ok(
  format($$select public.mark_listing_prep_listed('da000000-0000-4000-8000-000000000001',%L,'ebay/1')$$,
    pg_temp.get('prep')),
  '23514', null,
  'only a ready-to-list preparation can be recorded as listed');

-- Clear every blocker on the lot preparation and take it all the way through ------
select pg_temp.login('da222222-2222-4222-8222-222222222222');
select public.update_listing_prep_content('da000000-0000-4000-8000-000000000001',
  pg_temp.get('lotprep'),
  ('{"working_title":"Sealed booster box","condition_summary":"Factory sealed",'
   || '"quantity_to_list":6,"currency":"USD","asking_price_minor":12999,'
   || '"package_weight_grams":1200,"package_length_mm":300,'
   || '"package_width_mm":200,"package_height_mm":150}')::jsonb);

do $$
declare r record;
begin
  for r in select requirement_key from public.listing_prep_requirements
            where subtype = 'sealed_tcg' and is_required loop
    perform public.set_listing_prep_check('da000000-0000-4000-8000-000000000001',
      pg_temp.get('lotprep'), r.requirement_key, 'confirmed');
  end loop;
end $$;

-- Photographs are the remaining blocker, and they come from the media matrix.
select is(
  (select readiness_status from public.listing_prep_readiness
    where prep_id = pg_temp.get('lotprep')),
  'needs_photos',
  'with the paperwork done, the photographs are what is left');

do $$
declare r record; v_id uuid; i int := 0;
begin
  for r in select slot_key, slot_label from public.inventory_media_requirements
            where subtype = 'sealed_tcg' and is_required loop
    i := i + 1;
    v_id := (public.reserve_inventory_media('da000000-0000-4000-8000-000000000001', 'lot',
      pg_temp.get('bulklot'), 'image/jpeg', 4000 + i,
      ('dabbbbbb-000' || i || '-4000-8000-000000000001')::uuid,
      r.slot_key || '.jpg', null, r.slot_key, r.slot_label)->>'media_id')::uuid;
    perform public.commit_inventory_media('da000000-0000-4000-8000-000000000001', v_id);
  end loop;
end $$;

select is(
  (select readiness_status from public.listing_prep_readiness
    where prep_id = pg_temp.get('lotprep')),
  'ready',
  'and once they are there the record is ready');

select pg_temp.login('da111111-1111-4111-8111-111111111111');
select public.transition_listing_prep('da000000-0000-4000-8000-000000000001',
  pg_temp.get('lotprep'), 'ready_to_list');

select throws_ok(
  format($$select public.mark_listing_prep_listed('da000000-0000-4000-8000-000000000001',%L,'   ')$$,
    pg_temp.get('lotprep')),
  '23514', null,
  'recording a listing requires saying where it was listed');

select is(
  (public.mark_listing_prep_listed('da000000-0000-4000-8000-000000000001',
    pg_temp.get('lotprep'), 'ebay/998877'))->>'status',
  'listed',
  'the owner records where it was listed');

-- The whole point of the non-goal: listing changes no inventory. ------------------
select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('bulklot')),
  6,
  'recording a listing decrements no stock');
select is(
  (select lot_state::text from public.inventory_lots where id = pg_temp.get('bulklot')),
  'active',
  'and does not move the lot out of active inventory');

-- History ---------------------------------------------------------------------------
select ok(
  (select count(*) from pg_temp.events() where prep_id = pg_temp.get('lotprep')
    and event_type = 'listed') = 1,
  'the listing is in the record''s history');

select pg_temp.login('da222222-2222-4222-8222-222222222222');
select throws_ok(
  format($$update public.listing_prep_events set reason = 'rewritten' where prep_id = %L$$,
    pg_temp.get('lotprep')),
  '42501', null,
  'history cannot be rewritten by an application role');

-- A listed record is closed to edits until somebody reopens it.
select throws_ok(
  format($$select public.update_listing_prep_content('da000000-0000-4000-8000-000000000001',%L,'{"working_title":"changed"}'::jsonb)$$,
    pg_temp.get('lotprep')),
  '23514', null,
  'a listed preparation is not quietly editable');

-- Reopening is the owner''s call, and the listing stays in the history.
select pg_temp.login('da111111-1111-4111-8111-111111111111');
select public.transition_listing_prep('da000000-0000-4000-8000-000000000001',
  pg_temp.get('lotprep'), 'in_preparation', 'buyer fell through');

select is(
  (select listed_at from pg_temp.prep() where id = pg_temp.get('lotprep')),
  null,
  'a reopened record is no longer marked listed');
select ok(
  (select count(*) from pg_temp.events() where prep_id = pg_temp.get('lotprep')
    and event_type = 'listed') = 1,
  'but the fact that it was listed survives in the history');
select ok(
  (select detail->>'was_listed_at' is not null from pg_temp.events()
    where prep_id = pg_temp.get('lotprep') and event_type = 'reopened'),
  'and the reopening records when it had been listed');

-- The record is free to be prepared again, and a cancelled or listed record
-- never blocks a fresh preparation of the same goods.
select public.transition_listing_prep('da000000-0000-4000-8000-000000000001',
  pg_temp.get('lotprep'), 'cancelled', 'starting over');
select isnt(
  (public.start_listing_prep('da000000-0000-4000-8000-000000000001', 'lot',
    pg_temp.get('bulklot')))->>'id',
  null,
  'a cancelled preparation frees the record for a new one');

select * from finish();
rollback;
