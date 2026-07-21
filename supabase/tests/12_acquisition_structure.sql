-- Phase 4 acquisition hierarchy — structure, RLS, and grant-layer proofs.
-- Mirrors the style of 06_provenance_structure.sql / 08_provenance_rls.sql.
begin;
create extension if not exists pgtap;
select no_plan();

-- Tables exist, one per required entity ------------------------------------------------
select has_table('public'::name, 'acquisition_import_jobs'::name, 'acquisition_import_jobs exists');
select has_table('public'::name, 'channels'::name, 'channels exists');
select has_table('public'::name, 'suppliers'::name, 'suppliers exists');
select has_table('public'::name, 'supplier_aliases'::name, 'supplier_aliases exists');
select has_table('public'::name, 'acquisition_orders'::name, 'acquisition_orders exists');
select has_table('public'::name, 'acquisition_lots'::name, 'acquisition_lots exists');
select has_table('public'::name, 'acquisition_lot_lines'::name, 'acquisition_lot_lines exists');
select has_table('public'::name, 'acquisition_line_items'::name, 'acquisition_line_items exists');
select has_table('public'::name, 'acquisition_cost_components'::name, 'acquisition_cost_components exists');
select has_table('public'::name, 'acquisition_cost_allocations'::name, 'acquisition_cost_allocations exists');

-- Governed public-id minting produces the expected prefix ------------------------------
select is(app.mint_governed_public_id('RV-CH') ~ '^RV-CH-[A-Z0-9]{6,20}$', true,
  'app.mint_governed_public_id mints a channel-shaped id');
select is(app.mint_governed_public_id('RV-SUP') ~ '^RV-SUP-[A-Z0-9]{6,20}$', true,
  'app.mint_governed_public_id mints a supplier-shaped id');

-- Governed functions exist with the expected signatures ---------------------------------
select has_function('public'::name, 'register_channel'::name,
  array['uuid', 'text', 'text', 'text', 'text'], 'register_channel exists');
select has_function('public'::name, 'begin_acquisition_import_job'::name,
  array['uuid', 'uuid', 'uuid', 'text', 'integer', 'text', 'text'],
  'begin_acquisition_import_job exists');
select has_function('public'::name, 'stage_acquisition_orders'::name,
  array['uuid', 'jsonb'], 'stage_acquisition_orders exists');
select has_function('public'::name, 'stage_acquisition_lots'::name,
  array['uuid', 'jsonb'], 'stage_acquisition_lots exists');
select has_function('public'::name, 'stage_acquisition_line_items'::name,
  array['uuid', 'jsonb'], 'stage_acquisition_line_items exists');
select has_function('public'::name, 'stage_acquisition_cost_components'::name,
  array['uuid', 'jsonb'], 'stage_acquisition_cost_components exists');
select has_function('public'::name, 'finalize_acquisition_import_job'::name,
  array['uuid', 'text', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer'],
  'finalize_acquisition_import_job exists');
select has_function('public'::name, 'fail_acquisition_import_job'::name,
  array['uuid', 'text', 'text'], 'fail_acquisition_import_job exists');
select has_function('public'::name, 'get_committed_acquisition_summary'::name,
  array['uuid', 'text', 'uuid', 'uuid', 'integer', 'text', 'text'],
  'get_committed_acquisition_summary exists');
select has_function('public'::name, 'propose_cost_allocation'::name,
  array['uuid', 'text', 'jsonb'], 'propose_cost_allocation exists');
select has_function('public'::name, 'confirm_cost_allocation'::name,
  array['uuid', 'bigint'], 'confirm_cost_allocation exists');
select has_function('public'::name, 'reverse_cost_allocation'::name,
  array['uuid', 'text'], 'reverse_cost_allocation exists');
select has_function('public'::name, 'reverse_cost_component'::name,
  array['uuid', 'jsonb', 'text'], 'reverse_cost_component exists');
select has_function('public'::name, 'supersede_lot_line'::name,
  array['uuid', 'uuid', 'text'], 'supersede_lot_line exists');

-- Every SECURITY DEFINER function in this phase pins an empty search_path -----------------
select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and p.proname in (
       'register_channel', 'ensure_supplier_alias', 'normalize_supplier_handle',
       'propose_cost_allocation', 'confirm_cost_allocation', 'reverse_cost_allocation',
       'reverse_cost_component', 'supersede_lot_line',
       'open_acquisition_job_for_caller', 'begin_acquisition_import_job',
       'stage_acquisition_orders', 'stage_acquisition_lots',
       'stage_acquisition_line_items', 'stage_acquisition_cost_components',
       'finalize_acquisition_import_job', 'get_committed_acquisition_summary',
       'fail_acquisition_import_job',
       'mint_governed_public_id', 'enforce_acquisition_job_status_flow',
       'enforce_acquisition_job_open', 'enforce_lot_line_initial_state',
       'enforce_lot_line_transition', 'enforce_lot_line_supersession_coherence',
       'enforce_cost_component_transition', 'enforce_cost_component_reversal_coherence',
       'enforce_cost_allocation_initial_state', 'enforce_cost_allocation_transition',
       'enforce_acquisition_committed_summary_frozen',
       'dg_f', 'dg_sd', 'compute_acquisition_plan_digest',
       'require_committed_acquisition_job'
     )
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
       where cfg in ('search_path=', 'search_path=""'))),
  0,
  'every Phase 4 function pins an empty search_path'
);

-- Least privilege on the governed entry points --------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.register_channel(uuid, text, text, text, text)', 'execute'),
  'anon cannot execute register_channel'
);
select ok(
  has_function_privilege('authenticated', 'public.register_channel(uuid, text, text, text, text)', 'execute'),
  'authenticated may execute register_channel'
);
select ok(
  not has_function_privilege('anon',
    'public.finalize_acquisition_import_job(uuid, text, integer, integer, integer, integer, integer, integer)',
    'execute'),
  'anon cannot execute finalize_acquisition_import_job'
);
select ok(
  not has_function_privilege('authenticated', 'app.ensure_supplier_alias(uuid, uuid, text, uuid, uuid, text)',
    'execute'),
  'authenticated cannot execute the internal supplier-alias helper directly'
);
select ok(
  not has_function_privilege('authenticated', 'app.open_acquisition_job_for_caller(uuid, uuid)', 'execute'),
  'authenticated cannot execute the internal job-open helper directly'
);

-- Direct table grants: authenticated holds SELECT only, nothing else --------------------
select ok(
  not has_table_privilege('authenticated', 'public.acquisition_orders', 'insert'),
  'authenticated cannot directly INSERT acquisition_orders'
);
select ok(
  not has_table_privilege('authenticated', 'public.acquisition_line_items', 'insert'),
  'authenticated cannot directly INSERT acquisition_line_items'
);
select ok(
  not has_table_privilege('authenticated', 'public.acquisition_cost_components', 'update'),
  'authenticated cannot directly UPDATE acquisition_cost_components'
);
select ok(
  not has_table_privilege('authenticated', 'public.suppliers', 'insert'),
  'authenticated cannot directly INSERT suppliers'
);
select ok(
  not has_table_privilege('authenticated', 'public.channels', 'insert'),
  'authenticated cannot directly INSERT channels'
);
select ok(
  has_table_privilege('authenticated', 'public.acquisition_orders', 'select'),
  'authenticated may SELECT acquisition_orders'
);

-- RLS is enabled on every Phase 4 table ----------------------------------------------------
select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public'
     and tablename in (
       'acquisition_import_jobs', 'channels', 'suppliers', 'supplier_aliases',
       'acquisition_orders', 'acquisition_lots', 'acquisition_lot_lines',
       'acquisition_line_items', 'acquisition_cost_components',
       'acquisition_cost_allocations'
     )
     and rowsecurity),
  10,
  'row level security is enabled on all ten Phase 4 tables'
);

select * from finish();
rollback;
