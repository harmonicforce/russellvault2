-- Phase 3 provenance — structural checks.
--
-- Every provenance table exists with UUID internal identity and workspace
-- scoping, RLS is enabled everywhere, `authenticated` holds SELECT and nothing
-- else (so the governed RPC path is the only write path), anon has no
-- privilege anywhere, and the governed indexes/constraints/functions exist with
-- least-privilege grants and a pinned empty search_path.
begin;
create extension if not exists pgtap;
select no_plan();

-- Tables exist ----------------------------------------------------------------
select has_table('public'::name, 'source_systems'::name, 'source_systems exists');
select has_table('public'::name, 'import_jobs'::name, 'import_jobs exists');
select has_table('public'::name, 'source_records'::name, 'source_records exists');
select has_table('public'::name, 'external_identifiers'::name, 'external_identifiers exists');
select has_table('public'::name, 'source_crosswalks'::name, 'source_crosswalks exists');
select has_table('public'::name, 'audit_events'::name, 'audit_events exists');
select has_table('public'::name, 'data_quality_issues'::name, 'data_quality_issues exists');

-- Internal UUID identity ------------------------------------------------------
select col_type_is('public'::name, 'source_systems'::name, 'id'::name, 'uuid',
  'source_systems.id is uuid');
select col_type_is('public'::name, 'import_jobs'::name, 'id'::name, 'uuid',
  'import_jobs.id is uuid');
select col_type_is('public'::name, 'source_records'::name, 'id'::name, 'uuid',
  'source_records.id is uuid');
select col_type_is('public'::name, 'source_crosswalks'::name, 'id'::name, 'uuid',
  'source_crosswalks.id is uuid');
select col_type_is('public'::name, 'audit_events'::name, 'id'::name, 'uuid',
  'audit_events.id is uuid');
select col_type_is('public'::name, 'data_quality_issues'::name, 'id'::name, 'uuid',
  'data_quality_issues.id is uuid');
select col_type_is('public'::name, 'external_identifiers'::name, 'id'::name, 'uuid',
  'external_identifiers.id is uuid');

-- Governed public IDs ---------------------------------------------------------
select col_type_is('public'::name, 'source_systems'::name, 'public_id'::name, 'text',
  'source_systems.public_id is text');
select col_type_is('public'::name, 'import_jobs'::name, 'public_id'::name, 'text',
  'import_jobs.public_id is text');

-- Every provenance table is workspace-scoped ----------------------------------
select is(
  (select count(*)::int
   from unnest(array[
          'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
          'source_crosswalks', 'audit_events', 'data_quality_issues']) t(tbl)
   where not exists (
     select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t.tbl
       and c.column_name = 'workspace_id' and c.is_nullable = 'NO')),
  0,
  'every provenance table has a NOT NULL workspace_id'
);

-- Required import_jobs provenance columns --------------------------------------
select is(
  (select count(*)::int
   from unnest(array[
          'source_system_id', 'source_label', 'file_sha256', 'content_sha256',
          'parser_version', 'mapping_version', 'idempotency_key', 'status',
          'status_changed_at', 'source_row_count', 'accepted_row_count',
          'issue_row_count', 'source_totals', 'actor_user_id', 'actor_process',
          'failure_code', 'failure_detail']) t(col)
   where not exists (
     select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'import_jobs'
       and c.column_name = t.col)),
  0,
  'import_jobs records every required provenance field'
);

-- Required source_records columns -----------------------------------------------
select is(
  (select count(*)::int
   from unnest(array[
          'import_job_id', 'source_row_index', 'source_row_key', 'raw_payload',
          'raw_text', 'normalized_hash', 'parse_status', 'parser_output',
          'parser_version', 'mapping_version', 'errors', 'warnings']) t(col)
   where not exists (
     select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'source_records'
       and c.column_name = t.col)),
  0,
  'source_records records every required raw-payload field'
);

-- RLS enabled on every provenance table -----------------------------------------
select is(
  (select bool_and(c.relrowsecurity)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')),
  true,
  'RLS is enabled on all provenance tables'
);

-- anon has no privilege on any provenance table ---------------------------------
select is(
  (select count(*)::int
   from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'PUBLIC')
     and table_name in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')),
  0,
  'anon and PUBLIC hold no privilege on any provenance table'
);

-- THE CENTRAL GRANT GUARANTEE ------------------------------------------------
-- `authenticated` holds SELECT and nothing else on every provenance table, so
-- every direct INSERT/UPDATE/DELETE is refused at the grant layer before RLS is
-- even consulted. This is what makes the governed RPC path exclusive.
select is(
  (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
   from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee = 'authenticated'
     and table_name in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')),
  'SELECT',
  'authenticated holds SELECT and only SELECT on every provenance table'
);

-- Every provenance table is covered by that read grant (none accidentally open
-- via a different route and none accidentally unreadable).
select is(
  (select count(distinct table_name)::int
   from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and table_name in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')),
  7,
  'all seven provenance tables grant SELECT to authenticated'
);

-- No write privilege exists for ANY client-reachable role -----------------------
-- Scoped to the roles a client can actually authenticate as: anon and
-- authenticated (via the anon key / a user JWT), service_role (via the
-- service-role key), and PUBLIC. Table-owner and platform-superuser grants are
-- deliberately out of scope — they are the roles that run migrations, and no
-- grant can constrain them anyway (see migration 7 on the threat boundary).
--
-- Reported as a sorted grantee:privilege list rather than a bare count, so a
-- failure names exactly which role gained what instead of just showing a
-- number. This assertion previously used "any role except current_user", which
-- silently passed on plain PostgreSQL (where the test user owns the tables) but
-- caught real service_role default privileges on a hosted Supabase stack.
select is(
  (select coalesce(
     string_agg(distinct grantee || ':' || privilege_type, ', ' order by grantee || ':' || privilege_type),
     '')
   from information_schema.role_table_grants
   where table_schema = 'public'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
     and table_name in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')
     and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  '',
  'no client-reachable role holds INSERT, UPDATE, DELETE, or TRUNCATE on any provenance table'
);

-- service_role specifically holds no write privilege -----------------------------
-- service_role carries BYPASSRLS, so any write grant it held would be a total
-- bypass of the governed path. A hosted Supabase project grants it write access
-- to new public tables by default, which migration 8 explicitly revokes.
select is(
  (select coalesce(
     string_agg(distinct privilege_type, ',' order by privilege_type), '')
   from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee = 'service_role'
     and table_name in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')),
  '',
  'service_role holds no privilege at all on any provenance table, not even SELECT'
);

-- ...and cannot execute any governed entry point either ---------------------------
select is(
  (select coalesce(string_agg(distinct p.proname, ', ' order by p.proname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'register_source_system', 'begin_import_job', 'stage_source_records',
       'stage_external_identifiers', 'stage_import_derivatives',
       'finalize_import_job', 'fail_import_job',
       'confirm_source_crosswalk', 'reject_source_crosswalk',
       'supersede_source_crosswalk', 'resolve_data_quality_issue')
     and has_function_privilege('service_role', p.oid, 'execute')),
  '',
  'service_role cannot execute any governed provenance entry point'
);

-- service_role has no route into the internal helper schema -------------------------
select ok(
  not has_schema_privilege('service_role', 'app', 'usage'),
  'service_role has no USAGE on the app schema, so the internal helpers are unreachable'
);

-- Only SELECT policies exist anywhere in this schema ----------------------------
select is(
  (select coalesce(string_agg(distinct cmd, ',' order by cmd), '')
   from pg_policies
   where schemaname = 'public'
     and tablename in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')),
  'SELECT',
  'every provenance policy is SELECT-only; no INSERT, UPDATE, or DELETE policy exists'
);

-- No provenance policy is unconditionally true ---------------------------------------
select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and tablename in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')
     and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')),
  0,
  'no provenance policy is unconditionally permissive'
);

-- Every provenance policy targets the authenticated role only -------------------------
select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and tablename in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')
     and not (roles::text[] = array['authenticated'])),
  0,
  'every provenance policy applies to authenticated only'
);

-- Append-only triggers exist -----------------------------------------------------------
select is(
  (select count(*)::int
   from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('source_records', 'audit_events')
     and not t.tgisinternal
     and t.tgname like '%append_only%'),
  4,
  'source_records and audit_events each carry row and truncate append-only triggers'
);

-- The idempotency guarantee index exists -------------------------------------------------
select is(
  (select count(*)::int from pg_indexes
   where schemaname = 'public' and indexname = 'import_jobs_committed_identity_uidx'),
  1,
  'partial unique index enforces one committed import per source/hash/parser/mapping'
);

select is(
  (select count(*)::int from pg_indexes
   where schemaname = 'public' and indexname = 'source_crosswalks_one_confirmed_uidx'),
  1,
  'partial unique index enforces at most one live confirmed crosswalk per record/type'
);

select is(
  (select count(*)::int from pg_indexes
   where schemaname = 'public'
     and indexname in ('source_crosswalks_one_successor_uidx',
                       'source_crosswalks_one_predecessor_uidx')),
  2,
  'partial unique indexes force supersession into linear chains'
);

-- Operational review indexes ---------------------------------------------------------------
select is(
  (select count(*)::int
   from unnest(array[
          'import_jobs_workspace_started_idx', 'import_jobs_status_idx',
          'source_records_job_idx', 'source_records_hash_idx',
          'source_crosswalks_state_idx', 'audit_events_workspace_idx',
          'data_quality_issues_open_idx']) t(ix)
   where not exists (
     select 1 from pg_indexes i
     where i.schemaname = 'public' and i.indexname = t.ix)),
  0,
  'operational and review-access indexes are present'
);

-- Governed functions exist with fixed safe search_path --------------------------------------
select has_function('public'::name, 'begin_import_job'::name,
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'integer', 'jsonb', 'text'],
  'begin_import_job exists');
select has_function('public'::name, 'stage_source_records'::name,
  array['uuid', 'jsonb'], 'stage_source_records exists');
select has_function('public'::name, 'stage_external_identifiers'::name,
  array['uuid', 'jsonb'], 'stage_external_identifiers exists');
select has_function('public'::name, 'stage_import_derivatives'::name,
  array['uuid', 'jsonb', 'jsonb'], 'stage_import_derivatives exists');
select has_function('public'::name, 'finalize_import_job'::name,
  array['uuid', 'text', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer'],
  'finalize_import_job exists');
select has_function('public'::name, 'fail_import_job'::name,
  array['uuid', 'text', 'text'], 'fail_import_job exists');
select has_function('public'::name, 'register_source_system'::name,
  array['uuid', 'text', 'text', 'text', 'text', 'jsonb'], 'register_source_system exists');
select has_function('public'::name, 'confirm_source_crosswalk'::name,
  array['uuid', 'text'], 'confirm_source_crosswalk exists');
select has_function('public'::name, 'reject_source_crosswalk'::name,
  array['uuid', 'text'], 'reject_source_crosswalk exists');
select has_function('public'::name, 'supersede_source_crosswalk'::name,
  array['uuid', 'uuid', 'text'], 'supersede_source_crosswalk exists');
select has_function('public'::name, 'resolve_data_quality_issue'::name,
  array['uuid', 'public.data_quality_status', 'text'], 'resolve_data_quality_issue exists');

select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and p.proname in (
       'begin_import_job', 'stage_source_records', 'stage_external_identifiers',
       'stage_import_derivatives', 'finalize_import_job', 'fail_import_job',
       'register_source_system', 'open_job_for_caller', 'assert_batch_size',
       'require_uid', 'confirm_source_crosswalk', 'reject_source_crosswalk',
       'supersede_source_crosswalk', 'resolve_data_quality_issue',
       'review_source_crosswalk', 'log_audit_event', 'forbid_update_delete',
       'forbid_column_change', 'enforce_crosswalk_initial_state',
       'enforce_crosswalk_transition', 'enforce_import_job_status_flow',
       'enforce_child_job_open', 'enforce_supersession_coherence',
       'has_secret_like_key')
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
       where cfg in ('search_path=', 'search_path=""'))),
  0,
  'every Phase 3 function pins an empty search_path'
);

-- Least privilege on the governed entry points ------------------------------------------------
select ok(
  not has_function_privilege('anon',
    'public.finalize_import_job(uuid, text, integer, integer, integer, integer, integer, integer)',
    'execute'),
  'anon cannot execute finalize_import_job'
);
select ok(
  not has_function_privilege('anon', 'public.confirm_source_crosswalk(uuid, text)', 'execute'),
  'anon cannot execute confirm_source_crosswalk'
);
select ok(
  has_function_privilege('authenticated',
    'public.finalize_import_job(uuid, text, integer, integer, integer, integer, integer, integer)',
    'execute'),
  'authenticated may execute finalize_import_job'
);
select ok(
  not has_function_privilege('authenticated', 'app.open_job_for_caller(uuid, uuid)', 'execute'),
  'the internal job resolver is not granted to authenticated'
);
select ok(
  not has_function_privilege('authenticated', 'app.log_audit_event(uuid, text, text, uuid, uuid, text, uuid, uuid, uuid, jsonb)', 'execute'),
  'the audit writer is not granted to authenticated'
);

-- The shared review implementation is not directly callable by any app role ---------------------
select ok(
  not has_function_privilege('authenticated',
    'app.review_source_crosswalk(uuid, public.crosswalk_state, text)', 'execute'),
  'the shared crosswalk review implementation is not granted to authenticated'
);

-- Phase 5 delivers the product / SKU / lot / item / location identity core
-- (asserted in 16_inventory_structure.sql). The tripwire now guards the Phase 6+
-- commerce boundary: no listing / sale / marketplace / COGS / cost-basis /
-- purchase table has leaked in yet. (product_* and inventory_* are legitimate
-- Phase 5 tables and are deliberately excluded from this pattern.)
select is(
  (select count(*)::int
   from information_schema.tables
   where table_schema = 'public'
     and table_name ~ '(cost_basis|costbasis|cogs|listing|sale|marketplace|purchase)'),
  0,
  'no COGS, cost-basis, listing, sale, marketplace, or purchase table exists yet (Phase 6+)'
);

-- Phase 2 (5) + Phase 3 (5) + Phase 4 (5) + Phase 5 (4) + Phase 6A (5) recorded ------------------
select is(
  (select count(*)::int from public.schema_migrations_log),
  24,
  'twenty-four migrations are recorded: Phases 2/3/4 (5 each), Phase 5 (4), Phase 6A (5)'
);

select results_eq(
  $$select migration_name from public.schema_migrations_log order by migration_name$$,
  $$values
    ('20260719000100_workspace_foundation'),
    ('20260719000200_intake_shadow_schema'),
    ('20260719000300_intake_rls_policies'),
    ('20260719000400_intake_functions'),
    ('20260719000500_storage_policies'),
    ('20260719000600_provenance_schema'),
    ('20260719000700_provenance_append_only'),
    ('20260719000800_provenance_rls'),
    ('20260719000900_provenance_functions'),
    ('20260719001000_provenance_import_workflow'),
    ('20260720000100_acquisition_schema'),
    ('20260720000200_acquisition_append_only'),
    ('20260720000300_acquisition_rls'),
    ('20260720000400_acquisition_functions'),
    ('20260720000500_acquisition_import_workflow'),
    ('20260721000100_inventory_identity_schema'),
    ('20260721000200_inventory_identity_append_only'),
    ('20260721000300_inventory_identity_rls'),
    ('20260721000400_inventory_identity_functions'),
    ('20260722000100_intake_kernel_schema'),
    ('20260722000200_intake_kernel_append_only'),
    ('20260722000300_intake_kernel_rls'),
    ('20260722000400_intake_kernel_seed'),
    ('20260722000500_intake_kernel_functions')$$,
  'the earlier-phase migrations are unmodified and the five Phase 6A migrations follow them'
);

select * from finish();
rollback;
