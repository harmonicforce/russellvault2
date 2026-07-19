-- Phase 3 provenance — structural checks.
--
-- Every provenance table exists with UUID internal identity and workspace
-- scoping, RLS is enabled everywhere, no provenance table grants DELETE to any
-- application role, append-only tables grant no UPDATE either, anon has no
-- privilege anywhere, and the governed indexes/constraints are present.
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

-- No DELETE is granted anywhere: provenance is retained, never removed ----------
select is(
  (select count(*)::int
   from information_schema.role_table_grants
   where table_schema = 'public'
     and privilege_type = 'DELETE'
     and table_name in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')
     and grantee <> current_user),
  0,
  'no application role is granted DELETE on any provenance table'
);

-- Append-only tables grant no UPDATE either --------------------------------------
select is(
  (select count(*)::int
   from information_schema.role_table_grants
   where table_schema = 'public'
     and privilege_type = 'UPDATE'
     and table_name in ('source_records', 'audit_events')
     and grantee <> current_user),
  0,
  'append-only tables grant UPDATE to no application role'
);

-- ...and carry no UPDATE or DELETE policy at all -----------------------------------
select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and tablename in ('source_records', 'audit_events')
     and cmd in ('UPDATE', 'DELETE')),
  0,
  'append-only tables have no UPDATE or DELETE policy'
);

-- No provenance table has a DELETE policy -------------------------------------------
select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and tablename in (
       'source_systems', 'import_jobs', 'source_records', 'external_identifiers',
       'source_crosswalks', 'audit_events', 'data_quality_issues')
     and cmd = 'DELETE'),
  0,
  'no provenance table has a DELETE policy'
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
select has_function('public'::name, 'commit_import_job'::name,
  array['uuid', 'text'], 'commit_import_job exists');
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
       'commit_import_job', 'confirm_source_crosswalk', 'reject_source_crosswalk',
       'supersede_source_crosswalk', 'resolve_data_quality_issue',
       'review_source_crosswalk', 'log_audit_event', 'forbid_update_delete',
       'forbid_column_change', 'enforce_crosswalk_initial_state',
       'enforce_crosswalk_transition', 'enforce_import_job_status_flow',
       'enforce_child_job_open', 'has_secret_like_key')
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
       where cfg in ('search_path=', 'search_path=""'))),
  0,
  'every Phase 3 function pins an empty search_path'
);

-- Least privilege on the governed entry points ------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.commit_import_job(uuid, text)', 'execute'),
  'anon cannot execute commit_import_job'
);
select ok(
  not has_function_privilege('anon', 'public.confirm_source_crosswalk(uuid, text)', 'execute'),
  'anon cannot execute confirm_source_crosswalk'
);
select ok(
  has_function_privilege('authenticated', 'public.commit_import_job(uuid, text)', 'execute'),
  'authenticated may execute commit_import_job'
);

-- The shared review implementation is not directly callable by any app role ---------------------
select ok(
  not has_function_privilege('authenticated',
    'app.review_source_crosswalk(uuid, public.crosswalk_state, text)', 'execute'),
  'the shared crosswalk review implementation is not granted to authenticated'
);

-- Phase 3 creates NO canonical commerce-domain schema --------------------------------------------
select is(
  (select count(*)::int
   from information_schema.tables
   where table_schema = 'public'
     and table_name ~ '(acquisition|cost_basis|costbasis|cogs|product|inventory|listing|sale|marketplace|purchase)'),
  0,
  'no acquisition, cost-basis, COGS, product, inventory, listing, sale, or marketplace table exists'
);

-- All four Phase 3 migrations recorded, and the five Phase 2 migrations intact -------------------
select is(
  (select count(*)::int from public.schema_migrations_log),
  9,
  'nine migrations are recorded: five from Phase 2 plus four from Phase 3'
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
    ('20260719000900_provenance_functions')$$,
  'the five Phase 2 migrations are unmodified and four Phase 3 migrations follow them'
);

select * from finish();
rollback;
