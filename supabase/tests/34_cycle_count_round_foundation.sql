begin;
create extension if not exists pgtap with schema public;
select plan(18);

select has_table('public', 'cycle_count_rounds', 'rounds are explicit records');
select has_table('public', 'cycle_count_round_lifecycle_events', 'round lifecycle has append-only evidence');
select has_table('public', 'cycle_count_recount_selections', 'recount selection is separate from a round');
select has_table('public', 'cycle_count_round_results', 'submitted rounds have immutable results');
select has_column('public', 'cycle_count_sessions', 'current_round_id', 'session points at its authoritative round');
select has_column('public', 'cycle_count_item_observations', 'round_id', 'item evidence belongs to an explicit round');
select has_column('public', 'cycle_count_lot_observations', 'round_id', 'lot evidence belongs to an explicit round');
select has_column('public', 'cycle_count_discrepancies', 'round_result_id', 'discrepancies identify their source result');
select col_is_fk('public', 'cycle_count_sessions', ARRAY['current_round_id','workspace_id'], 'active round is referentially governed');
select col_is_fk('public', 'cycle_count_item_observations', ARRAY['round_id','workspace_id'], 'item round is referentially governed');
select col_is_fk('public', 'cycle_count_lot_observations', ARRAY['round_id','workspace_id'], 'lot round is referentially governed');
select col_is_fk('public', 'cycle_count_discrepancies', ARRAY['round_result_id','workspace_id'], 'discrepancy result is referentially governed');
select has_index('public', 'cycle_count_rounds', 'cycle_count_rounds_session_id_round_number_key',
  'a session cannot reuse a round number');
select has_index('public', 'cycle_count_item_observations', 'cycle_count_item_obs_once_per_explicit_round',
  'item uniqueness is per explicit round');
select has_index('public', 'cycle_count_lot_observations', 'cycle_count_lot_obs_once_per_explicit_round',
  'lot uniqueness is per explicit round');
select is((select count(*)::int from information_schema.role_table_grants
  where table_schema='public' and table_name in ('cycle_count_expected_items','cycle_count_expected_lots')
    and grantee='authenticated' and privilege_type='SELECT'), 0,
  'authenticated cannot directly read expected answers');
select is((select count(*)::int from pg_policies where schemaname='public'
  and tablename in ('cycle_count_expected_items','cycle_count_expected_lots')
  and roles @> array['authenticated']::name[]), 0,
  'expected-answer tables have no authenticated RLS policy');
select is((select count(*)::int from information_schema.role_table_grants
  where table_schema='public' and table_name in ('cycle_count_round_results','cycle_count_recount_selections')
    and grantee='authenticated'), 0,
  'result and selection internals have no direct client grant');

select * from finish();
rollback;
