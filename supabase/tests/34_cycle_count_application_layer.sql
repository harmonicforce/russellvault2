-- Cycle count — the application-layer read models, loss auditability, and the
-- blind-count disclosure fix.
--
-- The claims under test:
--   * a blind count's expected quantity is not readable by the client at all
--     while the count is being counted — not hidden in the UI, refused by the
--     database — and becomes readable once the count reaches review;
--   * writing a unit off records a permanent event naming the actor, the
--     reason, and the count it came from, and that event reaches the unit's
--     own history;
--   * post-snapshot activity covers loss, corrections, and lot lineage, not
--     just movements and quantity adjustments;
--   * every read interface is workspace-scoped, bounded, and refuses a
--     non-member;
--   * completion readiness names its blockers instead of only saying no.
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

-- now() is constant for the whole transaction, so everything this test does
-- carries an identical timestamp and nothing is ever "after the snapshot".
-- Backdating the frozen snapshot is how an hour of shop-floor time is
-- simulated: it moves the fixture, not the rule under test.
create or replace function pg_temp.age_snapshot(p_session_id uuid, p_interval interval)
returns void language plpgsql as $$
begin
  perform pg_temp.logout();
  update public.cycle_count_sessions
  set snapshot_frozen_at = snapshot_frozen_at - p_interval,
      started_at = started_at - p_interval
  where id = p_session_id;
end $$;

insert into auth.users (id, email) values
  ('ca111111-1111-4111-8111-111111111111', 'owner-ca@test.local'),
  ('ca222222-2222-4222-8222-222222222222', 'owner-nb2@test.local'),
  ('ca333333-3333-4333-8333-333333333333', 'viewer-ca@test.local'),
  ('ca444444-4444-4444-8444-444444444444', 'stranger-ca@test.local')
on conflict do nothing;

insert into public.workspaces (id, name, created_by) values
  ('ca000000-0000-4000-8000-000000000001', 'CA WS', 'ca111111-1111-4111-8111-111111111111'),
  ('ca000000-0000-4000-8000-000000000002', 'CA Neighbour', 'ca222222-2222-4222-8222-222222222222');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('ca000000-0000-4000-8000-000000000001', 'ca333333-3333-4333-8333-333333333333', 'viewer')
on conflict do nothing;

-- Structure -------------------------------------------------------------------
select has_table('public', 'inventory_loss_events', 'inventory loss events have a home');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_name = 'inventory_loss_events'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'authenticated cannot write a loss event directly');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'PUBLIC') and table_name = 'inventory_loss_events'),
  0,
  'anon holds no privilege on loss events');

select is(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'inventory_loss_events'),
  true,
  'loss events are row-level secured');

-- The disclosure fix is a privilege, not a convention: the quantity columns are
-- simply not granted to the client role.
select is(
  (select count(*)::int from information_schema.column_privileges
    where grantee = 'authenticated'
      and table_name = 'cycle_count_expected_lots'
      and column_name = 'expected_quantity'
      and privilege_type = 'SELECT'),
  0,
  'authenticated holds no SELECT on the frozen expected lot quantity');

select is(
  (select count(*)::int from information_schema.column_privileges
    where grantee = 'authenticated'
      and table_name = 'cycle_count_lot_observations'
      and column_name in ('expected_quantity', 'variance')
      and privilege_type = 'SELECT'),
  0,
  'authenticated holds no SELECT on the copied expectation or the variance');

-- Reading the rest of those tables still works, or the overview would break.
select is(
  (select count(*)::int from information_schema.column_privileges
    where grantee = 'authenticated'
      and table_name = 'cycle_count_expected_lots'
      and column_name = 'lot_public_id'
      and privilege_type = 'SELECT'),
  1,
  'the identity columns of the frozen lot snapshot are still readable');

-- Views are covered by role_table_grants too, and a hosted Supabase project
-- grants ALL on new tables and views to authenticated by default. Asserting
-- only the base tables is what let that drift reach the live project unnoticed.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_name in ('cycle_count_session_overview', 'cycle_count_post_snapshot_activity')
      and privilege_type <> 'SELECT'),
  0,
  'authenticated holds nothing but SELECT on the cycle-count read models');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated'
      and (table_name like 'cycle_count%' or table_name = 'inventory_loss_events')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0,
  'and no write privilege of any kind on any cycle-count object, view included');

-- Fixtures --------------------------------------------------------------------
select pg_temp.login('ca111111-1111-4111-8111-111111111111');
select public.register_storage_location('ca000000-0000-4000-8000-000000000001', 'ROOM', null, 'Room');
select public.register_storage_location('ca000000-0000-4000-8000-000000000001', 'SHELF-1', 'ROOM', 'Shelf 1');
select public.register_storage_location('ca000000-0000-4000-8000-000000000001', 'SHELF-2', 'ROOM', 'Shelf 2');

select pg_temp.put('prod', (public.register_product(
  'ca000000-0000-4000-8000-000000000001', 'tcg', 'Charizard', 'tcg|charizard|base|4',
  '{"set_name":"Base Set","card_number":"4"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku_slab', (public.register_sellable_sku(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('prod'),
  '{"grading_company":"PSA","numeric_grade":"10","product_format":"Graded slab"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku_sealed', (public.register_sellable_sku(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('prod'),
  '{"product_format":"Booster Box","condition_or_quality":"Sealed"}'::jsonb)->>'id')::uuid);

select pg_temp.put('slot', (public.stage_inventory_lot(
  'ca000000-0000-4000-8000-000000000001', 'RV-C-0000006001', pg_temp.get('sku_slab'),
  'serialized', 2, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('unit1', (public.mint_serialized_item(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('slot'), 'PSA', 'CA-CERT-1', null)->>'id')::uuid);
select pg_temp.put('unit2', (public.mint_serialized_item(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('slot'), 'PSA', 'CA-CERT-2', null)->>'id')::uuid);

select pg_temp.put('qlot', (public.stage_inventory_lot(
  'ca000000-0000-4000-8000-000000000001', 'RV-C-0000006002', pg_temp.get('sku_sealed'),
  'lot_managed', 12, 'SHELF-1', 'test', '1.0.0', null)->>'id')::uuid);

-- ==========================================================================
-- Blind counts: the quantity is withheld by the database, not by the UI
-- ==========================================================================
select pg_temp.put('blind', (public.create_cycle_count(
  'ca000000-0000-4000-8000-000000000001', 'SHELF-1', false, null, null, true,
  'blind sweep')->>'id')::uuid);
select public.start_cycle_count('ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'));
select pg_temp.age_snapshot(pg_temp.get('blind'), interval '1 hour');
select pg_temp.login('ca111111-1111-4111-8111-111111111111');

select throws_ok(
  format($$select expected_quantity from public.cycle_count_expected_lots
           where session_id = %L$$, pg_temp.get('blind')),
  '42501', null,
  'the counter cannot read the frozen expected quantity out of the table');

select is(
  (select (r->'expected_quantity')
     from jsonb_array_elements(
       public.cycle_count_lot_queue(
         'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'all', 50, 0) -> 'rows') r
    where (r->>'lot_id')::uuid = pg_temp.get('qlot')),
  'null'::jsonb,
  'and the governed lot queue does not put it in the payload either');

select is(
  ((public.cycle_count_lot_queue(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'all', 50, 0)
   ->>'quantities_withheld')::boolean),
  true,
  'the queue says plainly that quantities are being withheld');

-- A saved blind observation reports "saved", never "short" or "over": the word
-- itself would hand back the variance.
select public.observe_cycle_count_lot(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'RV-C-0000006002', 9);

select is(
  (select (r->>'count_status')
     from jsonb_array_elements(
       public.cycle_count_lot_queue(
         'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'all', 50, 0) -> 'rows') r
    where (r->>'lot_id')::uuid = pg_temp.get('qlot')),
  'saved',
  'a counted lot in a blind count reads as saved, not as short');

select is(
  (select (r->'expected_quantity')
     from jsonb_array_elements(
       public.cycle_count_observation_feed(
         'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 25, true) -> 'rows') r
    where (r->>'subject_kind') = 'lot'),
  'null'::jsonb,
  'the observation feed withholds it too');

-- One unit is found; the other is deliberately left unscanned so submission
-- produces a genuine missing-unit discrepancy to write off later.
select public.observe_cycle_count_item(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'CA-CERT-1', 'SHELF-1');

select is(
  ((public.get_cycle_count(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')) -> 'progress'
   ->>'uncounted_item_count')::int),
  1,
  'progress reports the unscanned unit as uncounted, not as missing');

select is(
  ((public.get_cycle_count(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))
   -> 'review_totals')),
  'null'::jsonb,
  'review totals are absent while counting — nothing wrong is not the same as not yet known');

select public.submit_cycle_count_for_review(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), true);

select is(
  ((public.cycle_count_lot_queue(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'all', 50, 0)
   ->>'quantities_withheld')::boolean),
  false,
  'review reveals the expected quantity — blind mode delays disclosure, it does not erase it');

select is(
  (select (r->>'expected_quantity')::int
     from jsonb_array_elements(
       public.cycle_count_lot_queue(
         'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'all', 50, 0) -> 'rows') r
    where (r->>'lot_id')::uuid = pg_temp.get('qlot')),
  12,
  'and the revealed figure is the frozen one');

-- ==========================================================================
-- Review, readiness, and the named blockers
-- ==========================================================================
select pg_temp.put('ldisc', (
  select id from public.cycle_count_discrepancies
  where session_id = pg_temp.get('blind') and discrepancy_kind = 'lot_shortage'));
select pg_temp.put('idisc', (
  select id from public.cycle_count_discrepancies
  where session_id = pg_temp.get('blind') and discrepancy_kind = 'item_missing'));

select isnt(pg_temp.get('ldisc'), null, 'the shortage became a discrepancy');
select isnt(pg_temp.get('idisc'), null, 'and the unscanned unit became a missing-unit discrepancy');

select is(
  ((public.cycle_count_review(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), null, null, 50, 0)
   ->>'total')::int),
  2,
  'the review lists both');

select is(
  ((public.cycle_count_review(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'),
     array['lot_shortage']::public.cycle_count_discrepancy_kind[], null, 50, 0)
   ->>'total')::int),
  1,
  'and can be narrowed to one kind');

select is(
  ((public.cycle_count_completion_readiness(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))
   ->>'can_complete')::boolean),
  false,
  'a session with open discrepancies cannot be completed');

select isnt_empty(
  format($$select jsonb_array_elements_text(
    public.cycle_count_completion_readiness(%L, %L) -> 'blockers')$$,
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')),
  'readiness names its blockers rather than only refusing');

select is(
  ((public.cycle_count_completion_readiness(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))
   ->>'open_count')::int),
  2,
  'and it counts the open work');

-- ==========================================================================
-- Inventory loss is auditable
-- ==========================================================================
select public.resolve_cycle_count_discrepancy(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('idisc'), 'item_loss_recorded',
  'not on the shelf after two passes');

select is(
  (select item_state from public.inventory_items where id = pg_temp.get('unit2')),
  'lost'::public.inventory_item_state,
  'the unit is written off physical stock');

select is(
  (select count(*)::int from public.inventory_loss_events where item_id = pg_temp.get('unit2')),
  1,
  'and a permanent loss event exists');

select is(
  (select previous_item_state from public.inventory_loss_events
    where item_id = pg_temp.get('unit2')),
  'active'::public.inventory_item_state,
  'the event records what the unit was before the write-off');

select is(
  (select recorded_by from public.inventory_loss_events where item_id = pg_temp.get('unit2')),
  'ca111111-1111-4111-8111-111111111111'::uuid,
  'the event names who decided it');

select is(
  (select session_id from public.inventory_loss_events where item_id = pg_temp.get('unit2')),
  pg_temp.get('blind'),
  'and which cycle count it came from');

select is(
  (select discrepancy_id from public.inventory_loss_events where item_id = pg_temp.get('unit2')),
  pg_temp.get('idisc'),
  'and which discrepancy');

-- The unit's own history is where an operator will actually look.
select is(
  ((public.inventory_item_loss_history(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('unit2'))
   -> 'rows' -> 0 ->> 'recorded_by_email')),
  'owner-ca@test.local',
  'the item history names the actor by email, not by raw uuid');

select is(
  ((public.inventory_item_loss_history(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('unit2'))
   -> 'rows' -> 0 ->> 'reason')),
  'not on the shelf after two passes',
  'the item history carries the reason');

select is(
  ((public.inventory_item_loss_history(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('unit2'))
   -> 'rows' -> 0 ->> 'previous_item_state')),
  'active',
  'and states the transition rather than implying the unit never existed');

select isnt(
  ((public.inventory_item_loss_history(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('unit2'))
   -> 'rows' -> 0 ->> 'cycle_count_public_id')),
  null,
  'and links back to the count that found it missing');

select throws_ok(
  format($$select public.record_inventory_item_loss(%L, %L, 'again')$$,
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('unit2')),
  '23514', null,
  'a unit cannot be written off twice');

select throws_ok(
  format($$update public.inventory_loss_events set reason = 'rewritten' where item_id = %L$$,
    pg_temp.get('unit2')),
  null, null,
  'a loss event cannot be rewritten');

-- A discrepancy from somewhere else cannot be borrowed to dress up a write-off.
select throws_ok(
  format($$select public.record_inventory_item_loss(%L, %L, 'wrong chain', %L, %L)$$,
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('unit1'),
    pg_temp.get('blind'), '00000000-0000-4000-8000-0000000000ff'),
  '23514', null,
  'a loss cannot cite a discrepancy that does not belong to the count');

-- The write-off is itself post-snapshot activity against the discrepancy that
-- produced it.
select is(
  (select count(*)::int from public.cycle_count_post_snapshot_activity
    where discrepancy_id = pg_temp.get('idisc') and activity_kind = 'item_loss'),
  1,
  'the write-off appears as post-snapshot activity on the unit discrepancy');

-- ==========================================================================
-- Deferral: blocks the ordinary path, opens the elevated one
-- ==========================================================================
select public.resolve_cycle_count_discrepancy(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('ldisc'), 'deferred',
  'waiting on a second pair of eyes');

select is(
  ((public.cycle_count_completion_readiness(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))
   ->>'can_complete')::boolean),
  false,
  'a deferred discrepancy still blocks ordinary completion');

select is(
  ((public.cycle_count_completion_readiness(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))
   ->>'can_complete_with_deferrals')::boolean),
  true,
  'but the elevated path is offered to an owner');

select is(
  ((public.cycle_count_completion_readiness(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))
   ->>'deferred_count')::int),
  1,
  'and the deferred count is stated, not buried');

select is(
  ((public.cycle_count_completion_readiness(
     'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))
   ->>'inventory_changing_resolution_count')::int),
  1,
  'and the resolutions that actually changed inventory are counted');

-- ==========================================================================
-- Post-snapshot activity now covers more than movement
-- ==========================================================================
select pg_temp.put('cor', (public.request_inventory_correction(
  'ca000000-0000-4000-8000-000000000001', 'lot', pg_temp.get('qlot'),
  'wrong_quantity', 'the box count on the label disagrees with the shelf',
  '{"quantity":9}'::jsonb)->>'id')::uuid);

select is(
  (select count(*)::int from public.cycle_count_post_snapshot_activity
    where discrepancy_id = pg_temp.get('ldisc') and activity_kind = 'correction_requested'),
  1,
  'a correction raised after the snapshot appears as post-snapshot activity');

select is(
  (select to_value from public.cycle_count_post_snapshot_activity
    where discrepancy_id = pg_temp.get('ldisc') and activity_kind = 'correction_requested'),
  'open',
  'and carries the correction state');

-- Splitting the counted lot after the snapshot is exactly the kind of thing
-- that can explain a shortage.
select public.split_inventory_lot(
  'ca000000-0000-4000-8000-000000000001', pg_temp.get('qlot'), 3, 'SHELF-2', 'moved three boxes');

select is(
  (select count(*)::int from public.cycle_count_post_snapshot_activity
    where discrepancy_id = pg_temp.get('ldisc') and activity_kind = 'lot_split'),
  1,
  'a split after the snapshot appears as post-snapshot activity');

select is(
  (select count(*)::int from public.cycle_count_post_snapshot_activity
    where discrepancy_id = pg_temp.get('ldisc') and activity_kind = 'quantity_adjustment'),
  1,
  'and so does the quantity change the split produced');

select is(
  (select count(distinct activity_kind)::int from public.cycle_count_post_snapshot_activity
    where discrepancy_id = pg_temp.get('ldisc')),
  3,
  'the reviewer sees three distinct categories of later activity, not just movements');

-- Activity is evidence, never an automatic dismissal.
select is(
  (select status from public.cycle_count_discrepancies where id = pg_temp.get('ldisc')),
  'deferred'::public.cycle_count_discrepancy_status,
  'and none of that activity resolved the discrepancy by itself');

-- ==========================================================================
-- Read interfaces: bounded, scoped, and closed to non-members
-- ==========================================================================
select is(
  ((public.list_cycle_counts('ca000000-0000-4000-8000-000000000001')->>'total')::int),
  1,
  'the session list reports a total independent of the page');

select is(
  (jsonb_array_length(public.list_cycle_counts(
    'ca000000-0000-4000-8000-000000000001', null, null, null, 1, 0) -> 'rows')),
  1,
  'and honours the page size');

select is(
  (jsonb_array_length(public.list_cycle_counts(
    'ca000000-0000-4000-8000-000000000001', null, null, null, 25, 5) -> 'rows')),
  0,
  'and the offset');

select is(
  ((public.list_cycle_counts(
    'ca000000-0000-4000-8000-000000000001',
    array['draft']::public.cycle_count_status[])->>'total')::int),
  0,
  'the status filter excludes sessions that are not in that status');

select is(
  ((public.list_cycle_counts(
    'ca000000-0000-4000-8000-000000000001', null, 'SHELF-1')->>'total')::int),
  1,
  'the location filter matches the root location code');

select is(
  ((public.list_cycle_counts(
    'ca000000-0000-4000-8000-000000000001', null, null, true)->>'total')::int),
  1,
  'and blind counts can be listed on their own');

select is(
  ((public.list_cycle_counts('ca000000-0000-4000-8000-000000000001')
    -> 'rows' -> 0 ->> 'created_by_email')),
  'owner-ca@test.local',
  'the list names the creator by email rather than by raw uuid');

-- The page limit is clamped, so a caller cannot ask for the whole workspace.
select is(
  ((public.cycle_count_item_queue(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'all', 100000, 0)
   ->>'limit')::int),
  200,
  'an unbounded page request is clamped');

select is(
  ((public.cycle_count_item_queue(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'uncounted')->>'total')::int),
  1,
  'the uncounted filter still shows the unit that was never scanned');

select throws_ok(
  format($$select public.cycle_count_item_queue(%L, %L, 'nonsense')$$,
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')),
  '23514', null,
  'an unknown queue filter is refused rather than silently treated as all');

select is(
  ((public.get_cycle_count(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))->>'found')::boolean),
  true,
  'a session in the workspace of the caller is found');

select is(
  ((public.get_cycle_count(
    'ca000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000aa')->>'found')::boolean),
  false,
  'an unknown session id reports not-found rather than raising');

select is(
  ((public.get_cycle_count(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')) -> 'review_totals'
   ->>'deferred_count')::int),
  1,
  'review totals are reported once the session is in review');

-- The audit record carries the frozen snapshot and the loss chain.
select is(
  (jsonb_array_length(public.cycle_count_audit_record(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')) -> 'expected_items')),
  2,
  'the audit record carries the frozen serialized snapshot');

select is(
  (jsonb_array_length(public.cycle_count_audit_record(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')) -> 'loss_events')),
  1,
  'and the loss events recorded during the session');

select is(
  ((public.cycle_count_audit_record(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))
   -> 'expected_lots' -> 0 ->>'expected_quantity')::int),
  12,
  'and the frozen expected quantity, which review has disclosed');

select is(
  (jsonb_array_length(public.cycle_count_audit_record(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')) -> 'resolutions')),
  2,
  'and every resolution attempt');

-- Workbench summary is counts and a handful of examples, not the workspace.
select is(
  ((public.cycle_count_workbench_summary(
    'ca000000-0000-4000-8000-000000000001')->>'awaiting_review_count')::int),
  1,
  'the workbench summary counts sessions awaiting review');

select is(
  ((public.cycle_count_workbench_summary(
    'ca000000-0000-4000-8000-000000000001')->>'deferred_count')::int),
  1,
  'and deferred discrepancies');

select is(
  ((public.cycle_count_workbench_summary(
    'ca000000-0000-4000-8000-000000000001', 100000)->>'example_limit')::int),
  20,
  'and clamps how many examples it will return');

-- Isolation -------------------------------------------------------------------
select pg_temp.login('ca444444-4444-4444-8444-444444444444');

select throws_ok(
  $$select public.list_cycle_counts('ca000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'a stranger cannot list the counts of another workspace');

select throws_ok(
  format($$select public.get_cycle_count(%L, %L)$$,
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')),
  '42501', null,
  'a stranger cannot read a session');

select throws_ok(
  format($$select public.cycle_count_audit_record(%L, %L)$$,
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')),
  '42501', null,
  'a stranger cannot read the audit record');

select throws_ok(
  format($$select public.inventory_item_loss_history(%L, %L)$$,
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('unit2')),
  '42501', null,
  'a stranger cannot read a loss history');

select is(
  (select count(*)::int from public.inventory_loss_events),
  0,
  'and sees no loss events at all through RLS');

-- A neighbouring owner cannot reach in either, even holding a correct id.
select pg_temp.login('ca222222-2222-4222-8222-222222222222');
select throws_ok(
  format($$select public.cycle_count_review(%L, %L)$$,
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind')),
  '42501', null,
  'a neighbouring owner cannot review a count in another workspace');

select is(
  ((public.get_cycle_count(
    'ca000000-0000-4000-8000-000000000002', pg_temp.get('blind'))->>'found')::boolean),
  false,
  'and passing their own workspace id with a foreign session finds nothing');

-- A viewer may read but not count.
select pg_temp.login('ca333333-3333-4333-8333-333333333333');
select is(
  ((public.get_cycle_count(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))->>'can_count')::boolean),
  false,
  'a viewer is told plainly that they cannot count');

select is(
  ((public.get_cycle_count(
    'ca000000-0000-4000-8000-000000000001', pg_temp.get('blind'))->>'found')::boolean),
  true,
  'but can still read the session');

select finish();
rollback;
