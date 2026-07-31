begin;
create extension if not exists pgtap with schema public;
select plan(18);
select has_table('public','cycle_count_round_subjects','round scope is frozen explicitly');
select has_table('public','cycle_count_observation_attempts','observation outcomes have audit storage');
select has_table('public','cycle_count_observation_idempotency','canonical idempotency winners are separate from attempts');
select has_column('public','cycle_count_item_observations','idempotency_key','item mutations carry a client key');
select has_column('public','cycle_count_lot_observations','idempotency_key','lot mutations carry a client key');
select has_index('public','cycle_count_round_subjects','cycle_count_round_subject_item_once','item scope is unique per round');
select has_index('public','cycle_count_round_subjects','cycle_count_round_subject_lot_once','lot scope is unique per round');
select has_index('public','cycle_count_observation_attempts','cycle_count_observation_attempts_key_idx','all retry attempts remain queryable by key');
select has_index('public','cycle_count_observation_idempotency','cycle_count_observation_idempotency_pkey','canonical keys are workspace-unique');
select has_function('public','mark_cycle_count_discrepancies_for_recount',array['uuid','uuid','uuid[]','text'],'multi-selection RPC exists');
select has_function('public','begin_cycle_count_recount',array['uuid','uuid','text'],'atomic recount-start RPC exists');
select function_privs_are('public','mark_cycle_count_discrepancies_for_recount',array['uuid','uuid','uuid[]','text'],'authenticated',array['EXECUTE'],'only authenticated callers execute selection');
select function_privs_are('public','begin_cycle_count_recount',array['uuid','uuid','text'],'authenticated',array['EXECUTE'],'only authenticated callers execute recount start');
select is((select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='begin_cycle_count_recount'),true,'recount start is SECURITY DEFINER');
select is((select proconfig @> array['search_path=""'] from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='begin_cycle_count_recount'),true,'recount start pins an empty search path');
select is((select count(*)::int from information_schema.role_table_grants where table_schema='public'
  and table_name in ('cycle_count_round_subjects','cycle_count_observation_attempts')
  and grantee in ('authenticated','anon','PUBLIC')),0,'round scope and attempts have no direct API grants');
select trigger_is('public','cycle_count_sessions','cycle_count_sessions_initial_round','app.cycle_count_create_initial_round()','initial round is created atomically with start');
select trigger_is('public','cycle_count_round_subjects','cycle_count_round_subjects_append_only','app.forbid_update_delete()','frozen round scope is append-only');
select * from finish();
rollback;
