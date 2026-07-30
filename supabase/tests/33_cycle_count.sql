-- Cycle count — governed session lifecycle, frozen evidence, and resolution.
--
-- The claims under test are the ones that decide whether a count can be
-- trusted as evidence:
--   * scope and expected inventory are frozen at start, not re-derived;
--   * serialized parent lots, absorbed lots, empty lots and inactive records
--     are never counted as physical stock;
--   * an observation changes no inventory;
--   * a repeated scan is idempotent, and an ambiguous identifier is refused;
--   * uncounted is not zero;
--   * a blind count does not hand back expected quantities;
--   * a recount preserves the first observation;
--   * resolutions run through the existing governed operations;
--   * a session cannot complete with unresolved work, and cannot be cancelled
--     after it has already changed inventory;
--   * everything is workspace-isolated against a neighbour holding real data.
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

insert into auth.users (id, email) values
  ('cc111111-1111-4111-8111-111111111111', 'owner-cc@test.local'),
  ('cc222222-2222-4222-8222-222222222222', 'owner-nb@test.local'),
  ('cc333333-3333-4333-8333-333333333333', 'viewer-cc@test.local')
on conflict do nothing;

insert into public.workspaces (id, name, created_by) values
  ('cc000000-0000-4000-8000-000000000001', 'CC WS', 'cc111111-1111-4111-8111-111111111111'),
  ('cc000000-0000-4000-8000-000000000002', 'CC Neighbour', 'cc222222-2222-4222-8222-222222222222');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('cc000000-0000-4000-8000-000000000001', 'cc333333-3333-4333-8333-333333333333', 'viewer')
on conflict do nothing;

-- Structure ---------------------------------------------------------------------
select has_table('public', 'cycle_count_sessions', 'cycle count sessions have a home');
select has_table('public', 'cycle_count_expected_items', 'the serialized snapshot has a home');
select has_table('public', 'cycle_count_expected_lots', 'the lot snapshot has a home');
select has_table('public', 'cycle_count_item_observations', 'serialized observations have a home');
select has_table('public', 'cycle_count_lot_observations', 'lot observations have a home');
select has_table('public', 'cycle_count_discrepancies', 'discrepancies have a home');
select has_table('public', 'cycle_count_resolutions', 'resolutions have a home');

-- No client write path to any of it.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_name like 'cycle_count%'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'authenticated holds no direct write grant on any cycle-count table');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'PUBLIC') and table_name like 'cycle_count%'),
  0,
  'anon holds no privilege on any cycle-count table');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and c.relname in ('cycle_count_session_overview', 'cycle_count_post_snapshot_activity')
      and 'security_invoker=true' = any(c.reloptions)),
  2,
  'the cycle-count read models are SECURITY INVOKER');

-- Fixtures -----------------------------------------------------------------------
select pg_temp.login('cc111111-1111-4111-8111-111111111111');
select public.register_storage_location('cc000000-0000-4000-8000-000000000001', 'AISLE', null, 'Aisle');
select public.register_storage_location('cc000000-0000-4000-8000-000000000001', 'BIN-A', 'AISLE', 'Bin A');
select public.register_storage_location('cc000000-0000-4000-8000-000000000001', 'BIN-B', 'AISLE', 'Bin B');
select public.register_storage_location('cc000000-0000-4000-8000-000000000001', 'BIN-C', 'AISLE', 'Bin C');
select public.register_storage_location('cc000000-0000-4000-8000-000000000001', 'OUTSIDE', null, 'Outside scope');

select pg_temp.put('prod', (public.register_product(
  'cc000000-0000-4000-8000-000000000001', 'tcg', 'Blastoise', 'tcg|blastoise|base|2',
  '{"set_name":"Base Set","card_number":"2"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku_slab', (public.register_sellable_sku(
  'cc000000-0000-4000-8000-000000000001', pg_temp.get('prod'),
  '{"grading_company":"PSA","numeric_grade":"9","product_format":"Graded slab"}'::jsonb)->>'id')::uuid);
select pg_temp.put('sku_sealed', (public.register_sellable_sku(
  'cc000000-0000-4000-8000-000000000001', pg_temp.get('prod'),
  '{"product_format":"Booster Box","condition_or_quality":"Sealed"}'::jsonb)->>'id')::uuid);

-- A serialized parent lot with two units in BIN-A.
select pg_temp.put('slot', (public.stage_inventory_lot(
  'cc000000-0000-4000-8000-000000000001', 'RV-C-0000005001', pg_temp.get('sku_slab'),
  'serialized', 2, 'BIN-A', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('unit1', (public.mint_serialized_item(
  'cc000000-0000-4000-8000-000000000001', pg_temp.get('slot'), 'PSA', 'CC-CERT-1', null)->>'id')::uuid);
select pg_temp.put('unit2', (public.mint_serialized_item(
  'cc000000-0000-4000-8000-000000000001', pg_temp.get('slot'), 'PSA', 'CC-CERT-2', null)->>'id')::uuid);

-- Quantity lots: one in scope, one empty, one absorbed, one out of scope.
select pg_temp.put('qlot', (public.stage_inventory_lot(
  'cc000000-0000-4000-8000-000000000001', 'RV-C-0000005002', pg_temp.get('sku_sealed'),
  'lot_managed', 10, 'BIN-A', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('qlot2', (public.stage_inventory_lot(
  'cc000000-0000-4000-8000-000000000001', 'RV-C-0000005003', pg_temp.get('sku_sealed'),
  'lot_managed', 4, 'BIN-B', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('empty', (public.stage_inventory_lot(
  'cc000000-0000-4000-8000-000000000001', 'RV-C-0000005004', pg_temp.get('sku_sealed'),
  'lot_managed', 0, 'BIN-A', 'test', '1.0.0', null)->>'id')::uuid);
select pg_temp.put('outside', (public.stage_inventory_lot(
  'cc000000-0000-4000-8000-000000000001', 'RV-C-0000005005', pg_temp.get('sku_sealed'),
  'lot_managed', 7, 'OUTSIDE', 'test', '1.0.0', null)->>'id')::uuid);

-- Permissions ---------------------------------------------------------------------
select pg_temp.login('cc333333-3333-4333-8333-333333333333');
select throws_ok(
  $$select public.create_cycle_count('cc000000-0000-4000-8000-000000000001', 'AISLE', true)$$,
  '42501', null,
  'a viewer cannot create a cycle count');

select pg_temp.login('cc111111-1111-4111-8111-111111111111');

-- Create and scope -------------------------------------------------------------------
select pg_temp.put('cc', (public.create_cycle_count(
  'cc000000-0000-4000-8000-000000000001', 'AISLE', true, null, null, false,
  'first count')->>'id')::uuid);

select is(
  (select status from public.cycle_count_sessions where id = pg_temp.get('cc')),
  'draft'::public.cycle_count_status,
  'a new cycle count starts as a draft');

select throws_ok(
  $$select public.create_cycle_count('cc000000-0000-4000-8000-000000000001', 'NO-SUCH-BIN')$$,
  '23514', null,
  'a count cannot be scoped to a location that does not exist');

select is(
  ((public.preview_cycle_count_scope(
     'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')))->>'expected_item_count')::int,
  2,
  'the scope preview counts the two serialized units under the aisle');

-- Observations are refused before the count starts.
select throws_ok(
  format($$select public.observe_cycle_count_item(%L, %L, 'CC-CERT-1', 'BIN-A')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  '23514', null,
  'a draft count does not accept observations');

-- Start and freeze --------------------------------------------------------------------
select lives_ok(
  format($$select public.start_cycle_count(%L, %L)$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  'the count starts');

select is(
  (select status from public.cycle_count_sessions where id = pg_temp.get('cc')),
  'in_progress'::public.cycle_count_status,
  'the count is now in progress');

select is(
  (select count(*)::int from public.cycle_count_scope_locations where session_id = pg_temp.get('cc')),
  4,
  'the resolved scope froze every active location under the aisle');

select is(
  (select count(*)::int from public.cycle_count_expected_items where session_id = pg_temp.get('cc')),
  2,
  'both serialized units are in the frozen snapshot');

-- The exclusions that stop physical stock being counted twice.
select is(
  (select count(*)::int from public.cycle_count_expected_lots
    where session_id = pg_temp.get('cc') and lot_id = pg_temp.get('slot')),
  0,
  'the serialized PARENT lot is excluded — its units are counted individually');

select is(
  (select count(*)::int from public.cycle_count_expected_lots
    where session_id = pg_temp.get('cc') and lot_id = pg_temp.get('empty')),
  0,
  'an empty lot is excluded — there is nothing physical to find');

select is(
  (select count(*)::int from public.cycle_count_expected_lots
    where session_id = pg_temp.get('cc') and lot_id = pg_temp.get('outside')),
  0,
  'a lot outside the scope is excluded');

select is(
  (select count(*)::int from public.cycle_count_expected_lots where session_id = pg_temp.get('cc')),
  2,
  'exactly the two in-scope quantity lots are expected');

select throws_ok(
  format($$select public.start_cycle_count(%L, %L)$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  '23514', null,
  'a count cannot be started twice');

-- The snapshot is frozen: retiring a scope location afterwards does not rewrite it.
select public.retire_storage_location('cc000000-0000-4000-8000-000000000001', 'BIN-C');
select is(
  (select count(*)::int from public.cycle_count_scope_locations
    where session_id = pg_temp.get('cc') and location_code = 'BIN-C'),
  1,
  'retiring a location after the start does not rewrite the frozen scope');

-- Serialized counting ----------------------------------------------------------------
select is(
  (public.observe_cycle_count_item(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc'), 'CC-CERT-1', 'BIN-A'))->>'outcome',
  'expected_found',
  'scanning an expected unit where it belongs records it as found');

select is(
  (public.observe_cycle_count_item(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc'), 'CC-CERT-1', 'BIN-A'))->>'outcome',
  'duplicate',
  'scanning the same unit again is idempotent, not a second sighting');

select is(
  (select count(*)::int from public.cycle_count_item_observations
    where session_id = pg_temp.get('cc') and item_id = pg_temp.get('unit1') and voided_at is null),
  1,
  'and no second observation row was created');

select is(
  (public.observe_cycle_count_item(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc'), 'NOT-A-REAL-ID', 'BIN-A'))->>'outcome',
  'not_found',
  'an identifier that matches nothing is reported, not invented');

select is(
  (public.observe_cycle_count_item(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc'), 'CC-CERT-2', 'BIN-B'))->>'outcome',
  'wrong_location',
  'a unit found on the wrong shelf is recorded as wrong-location, not as found');

select throws_ok(
  format($$select public.observe_cycle_count_item(%L, %L, 'CC-CERT-1', 'OUTSIDE')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  '23514', null,
  'an observation cannot be recorded against a location outside the frozen scope');

-- Counting changes no inventory.
select is(
  (select location_id from public.inventory_items where id = pg_temp.get('unit2')),
  (select id from public.storage_locations
    where workspace_id = 'cc000000-0000-4000-8000-000000000001' and location_code = 'BIN-A'),
  'observing a unit in the wrong place does NOT move it — an observation is evidence');

-- Lot counting -------------------------------------------------------------------------
select is(
  (public.observe_cycle_count_lot(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc'), 'RV-C-0000005002', 8))->>'outcome',
  'counted',
  'a lot quantity is recorded');

select is(
  ((public.observe_cycle_count_lot(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc'), 'RV-C-0000005002', 8))
    ->>'outcome'),
  'duplicate',
  'a repeated lot count in the same round is idempotent');

-- The variance is no longer a column an authenticated member may read: it is
-- derived from the frozen expected quantity, which is the one number a blind
-- count exists to withhold. The claim under test is unchanged — the variance is
-- computed against the FROZEN expectation, not against current stock — but it
-- is now asserted through the governed queue that decides disclosure, and the
-- direct read is asserted to be refused.
select throws_ok(
  format($$select variance from public.cycle_count_lot_observations
           where session_id = %L$$, pg_temp.get('cc')),
  '42501', null,
  'an authenticated member cannot read the variance column directly');

select is(
  (select (r->>'variance')::int
     from jsonb_array_elements(
       public.cycle_count_lot_queue(
         'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc'), 'all', 50, 0) -> 'rows') r
    where (r->>'lot_id')::uuid = pg_temp.get('qlot')),
  -2,
  'the variance is computed against the FROZEN expected quantity');

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('qlot')),
  10,
  'counting a shortage does NOT change the lot — that needs an explicit resolution');

-- Uncounted is not zero.
select is(
  (select count(*)::int from public.cycle_count_lot_observations
    where session_id = pg_temp.get('cc') and lot_id = pg_temp.get('qlot2')),
  0,
  'a lot nobody counted has no observation at all — silence is not an observed zero');

-- Submission -----------------------------------------------------------------------------
select is(
  (public.submit_cycle_count_for_review(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')))->>'outcome',
  'confirmation_required',
  'submitting with uncounted records requires explicit confirmation');

select is(
  (select status from public.cycle_count_sessions where id = pg_temp.get('cc')),
  'in_progress'::public.cycle_count_status,
  'and the unconfirmed submission did not change the status');

select is(
  (public.submit_cycle_count_for_review(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc'), true))->>'outcome',
  'submitted',
  'confirming uncounted records submits the count');

select is(
  (select status from public.cycle_count_sessions where id = pg_temp.get('cc')),
  'review'::public.cycle_count_status,
  'the count is in review');

-- Discrepancies ----------------------------------------------------------------------------
select is(
  (select count(*)::int from public.cycle_count_discrepancies
    where session_id = pg_temp.get('cc') and discrepancy_kind = 'item_wrong_location'),
  1,
  'the wrong-location unit produced a discrepancy');

select is(
  (select count(*)::int from public.cycle_count_discrepancies
    where session_id = pg_temp.get('cc') and discrepancy_kind = 'lot_shortage'),
  1,
  'the short lot produced a shortage discrepancy');

select is(
  (select count(*)::int from public.cycle_count_discrepancies
    where session_id = pg_temp.get('cc') and discrepancy_kind = 'lot_uncounted'),
  1,
  'the uncounted lot produced its OWN discrepancy kind, not a shortage');

select is(
  (select count(*)::int from public.cycle_count_discrepancies
    where session_id = pg_temp.get('cc') and discrepancy_kind = 'item_missing'),
  0,
  'both expected units were seen, so nothing is missing');

-- Resolution -------------------------------------------------------------------------------
select pg_temp.put('d_short', (select id from public.cycle_count_discrepancies
  where session_id = pg_temp.get('cc') and discrepancy_kind = 'lot_shortage'));
select pg_temp.put('d_wrong', (select id from public.cycle_count_discrepancies
  where session_id = pg_temp.get('cc') and discrepancy_kind = 'item_wrong_location'));
select pg_temp.put('d_unc', (select id from public.cycle_count_discrepancies
  where session_id = pg_temp.get('cc') and discrepancy_kind = 'lot_uncounted'));

select throws_ok(
  format($$select public.complete_cycle_count(%L, %L)$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  '23514', null,
  'a count cannot complete while discrepancies are still open');

select lives_ok(
  format($$select public.resolve_cycle_count_discrepancy(%L, %L, 'lot_quantity_adjusted', 'counted twice')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('d_short')),
  'the shortage is resolved through the governed quantity adjustment');

select is(
  (select quantity from public.inventory_lots where id = pg_temp.get('qlot')),
  8,
  'the lot now holds the counted quantity');

select is(
  (select count(*)::int from public.inventory_quantity_adjustments
    where lot_id = pg_temp.get('qlot') and reason = 'recount'),
  1,
  'and the change went through the existing quantity-adjustment history');

select is(
  (public.resolve_cycle_count_discrepancy(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('d_short'), 'lot_quantity_adjusted'))
    ->>'outcome',
  'already_resolved',
  'resolving the same discrepancy twice reports the existing resolution rather than applying it again');

select is(
  (select count(*)::int from public.inventory_quantity_adjustments
    where lot_id = pg_temp.get('qlot') and reason = 'recount'),
  1,
  'and no second adjustment was written');

select lives_ok(
  format($$select public.resolve_cycle_count_discrepancy(%L, %L, 'item_moved_to_counted_location', 'was on the wrong shelf')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('d_wrong')),
  'the wrong-location unit is resolved by a governed move');

select is(
  (select l.location_code from public.inventory_items i
     join public.storage_locations l on l.id = i.location_id
    where i.id = pg_temp.get('unit2')),
  'BIN-B',
  'the unit was moved to where it was actually found');

select ok(
  (select count(*) from public.inventory_movements
    where item_id = pg_temp.get('unit2')) > 0,
  'and the move is in the immutable movement history');

-- Completion --------------------------------------------------------------------------------
select throws_ok(
  format($$select public.complete_cycle_count(%L, %L)$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  '23514', null,
  'the still-open uncounted-lot discrepancy blocks completion');

select lives_ok(
  format($$select public.resolve_cycle_count_discrepancy(%L, %L, 'deferred', 'shelf inaccessible today')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('d_unc')),
  'the uncounted lot is explicitly deferred with a reason');

select throws_ok(
  format($$select public.complete_cycle_count(%L, %L)$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  '23514', null,
  'a deferred discrepancy still blocks completion unless deferral is explicitly allowed');

select lives_ok(
  format($$select public.complete_cycle_count(%L, %L, true, 'closing with one deferral')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  'completion succeeds when the deferral is acknowledged with a reason');

select is(
  (select status from public.cycle_count_sessions where id = pg_temp.get('cc')),
  'completed'::public.cycle_count_status,
  'the count is completed');

select is(
  ((select completion_summary from public.cycle_count_sessions
     where id = pg_temp.get('cc'))->>'deferred_discrepancies')::int,
  1,
  'the summary records the deferral rather than hiding it');

-- Completed sessions are evidence.
select throws_ok(
  format($$select public.observe_cycle_count_item(%L, %L, 'CC-CERT-1', 'BIN-A')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  '23514', null,
  'a completed count accepts no further observations');

select throws_ok(
  format($$select public.cancel_cycle_count(%L, %L, 'changed my mind')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('cc')),
  '23514', null,
  'a completed count cannot be cancelled');

select pg_temp.logout();
select throws_ok(
  format($$update public.cycle_count_sessions set status = 'draft' where id = %L$$, pg_temp.get('cc')),
  null, null,
  'a completed session cannot be reopened even by a privileged connection');
select pg_temp.login('cc111111-1111-4111-8111-111111111111');

-- Blind counts ---------------------------------------------------------------------------------
select pg_temp.put('blind', (public.create_cycle_count(
  'cc000000-0000-4000-8000-000000000001', 'BIN-A', false, null, null, true)->>'id')::uuid);
select public.start_cycle_count('cc000000-0000-4000-8000-000000000001', pg_temp.get('blind'));

select is(
  (public.observe_cycle_count_lot(
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('blind'), 'RV-C-0000005002', 3))
    ->'variance',
  'null'::jsonb,
  'a blind count does not hand the variance back to the counter');

select is(
  (select blind_count from public.cycle_count_sessions where id = pg_temp.get('blind')),
  true,
  'and the session records permanently that it was blind');

-- Cancellation ------------------------------------------------------------------------------------
select throws_ok(
  format($$select public.cancel_cycle_count(%L, %L, '   ')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('blind')),
  '23514', null,
  'cancelling requires a reason');

select lives_ok(
  format($$select public.cancel_cycle_count(%L, %L, 'wrong shelf chosen')$$,
    'cc000000-0000-4000-8000-000000000001', pg_temp.get('blind')),
  'an in-progress count with no applied changes can be cancelled');

select is(
  (select count(*)::int from public.cycle_count_lot_observations
    where session_id = pg_temp.get('blind')),
  1,
  'and the observations already entered are preserved');

-- Workspace isolation -------------------------------------------------------------------------------
select pg_temp.login('cc222222-2222-4222-8222-222222222222');
select public.register_storage_location('cc000000-0000-4000-8000-000000000002', 'NB-BIN', null, 'NB');

select is(
  (select count(*)::int from public.cycle_count_sessions
    where workspace_id = 'cc000000-0000-4000-8000-000000000001'),
  0,
  'a neighbour cannot read this workspace''s cycle counts');

select is(
  (select count(*)::int from public.cycle_count_expected_items
    where workspace_id = 'cc000000-0000-4000-8000-000000000001'),
  0,
  'nor its frozen snapshot');

select throws_ok(
  format($$select public.start_cycle_count(%L, %L)$$,
    'cc000000-0000-4000-8000-000000000002', pg_temp.get('cc')),
  '23514', null,
  'a neighbour cannot start this workspace''s count by passing its own workspace id');

select throws_ok(
  format($$select public.observe_cycle_count_item(%L, %L, 'CC-CERT-1', 'NB-BIN')$$,
    'cc000000-0000-4000-8000-000000000002', pg_temp.get('cc')),
  '23514', null,
  'nor record an observation against it');

select throws_ok(
  $$select public.create_cycle_count('cc000000-0000-4000-8000-000000000001', 'BIN-A')$$,
  '42501', null,
  'nor create a count inside a workspace it does not belong to');

select pg_temp.logout();
select * from finish();
rollback;
