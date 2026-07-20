-- Structural checks: every shadow table exists, RLS is enabled everywhere,
-- functions exist, and no policy grants anon or always-true access.
begin;
create extension if not exists pgtap;
select no_plan();

-- Tables exist ---------------------------------------------------------------
select has_table('public'::name, 'workspaces'::name, 'workspaces exists');
select has_table('public'::name, 'workspace_members'::name, 'workspace_members exists');
select has_table('public'::name, 'sessions'::name, 'sessions exists');
select has_table('public'::name, 'intake_groups'::name, 'intake_groups exists');
select has_table('public'::name, 'items'::name, 'items exists');
select has_table('public'::name, 'photos'::name, 'photos exists');
select has_table('public'::name, 'photo_requirements'::name, 'photo_requirements exists');
select has_table('public'::name, 'field_registry'::name, 'field_registry exists');
select has_table('public'::name, 'field_rules'::name, 'field_rules exists');
select has_table('public'::name, 'reference_lists'::name, 'reference_lists exists');
select has_table('public'::name, 'reference_options'::name, 'reference_options exists');
select has_table('public'::name, 'schema_migrations_log'::name, 'schema_migrations_log exists');

-- Internal UUID identity, public business identifiers ------------------------
select col_type_is('public'::name, 'workspaces'::name, 'id'::name, 'uuid', 'workspaces.id is uuid');
select col_type_is('public'::name, 'sessions'::name, 'id'::name, 'uuid', 'sessions.id is uuid');
select col_type_is('public'::name, 'items'::name, 'id'::name, 'uuid', 'items.id is uuid');
select col_type_is('public'::name, 'sessions'::name, 'public_id'::name, 'text', 'sessions.public_id is text');
select col_type_is('public'::name, 'items'::name, 'sku'::name, 'text', 'items.sku is text');

-- RLS enabled on every workspace-scoped table (and the migrations log) -------
select is(
  (select bool_and(c.relrowsecurity)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in (
       'workspaces', 'workspace_members', 'sessions', 'intake_groups', 'items',
       'photos', 'photo_requirements', 'field_registry', 'field_rules',
       'reference_lists', 'reference_options', 'schema_migrations_log')),
  true,
  'RLS is enabled on all shadow tables'
);

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity),
  0,
  'no table in public lacks RLS'
);

-- Functions exist -------------------------------------------------------------
select has_function('public'::name, 'mint_sku'::name, array['uuid'], 'mint_sku exists');
select has_function('public'::name, 'expand_intake_group'::name, array['uuid'], 'expand_intake_group exists');
select has_function('public'::name, 'delete_intake_group_safe'::name, array['uuid'], 'delete_intake_group_safe exists');
select has_function(
  'public'::name, 'create_custom_field'::name,
  array['uuid', 'text', 'text', 'text', 'uuid'], 'create_custom_field exists');

-- Functions use SECURITY DEFINER with a pinned search_path -------------------
select is(
  (select bool_and(p.prosecdef and p.proconfig::text like '%search_path=%')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('mint_sku', 'expand_intake_group', 'delete_intake_group_safe', 'create_custom_field')),
  true,
  'all four entry-point functions are SECURITY DEFINER with fixed search_path'
);

-- anon is fully locked out ----------------------------------------------------
select is(has_function_privilege('anon', 'public.mint_sku(uuid)', 'execute'), false, 'anon cannot execute mint_sku');
select is(has_function_privilege('anon', 'public.expand_intake_group(uuid)', 'execute'), false, 'anon cannot execute expand_intake_group');
select is(has_function_privilege('anon', 'public.delete_intake_group_safe(uuid)', 'execute'), false, 'anon cannot execute delete_intake_group_safe');
select is(has_function_privilege('anon', 'public.create_custom_field(uuid,text,text,text,uuid)', 'execute'), false, 'anon cannot execute create_custom_field');
select is(has_table_privilege('anon', 'public.workspaces', 'select'), false, 'anon has no select on workspaces');
select is(has_table_privilege('anon', 'public.items', 'select'), false, 'anon has no select on items');
select is(has_table_privilege('anon', 'public.photos', 'select'), false, 'anon has no select on photos');

-- authenticated is locked out of internal helpers and the migrations log ------
select is(has_function_privilege('authenticated', 'app.next_sku(uuid)', 'execute'), false, 'authenticated cannot call app.next_sku directly');
select is(has_table_privilege('authenticated', 'public.schema_migrations_log', 'select'), false, 'authenticated cannot read schema_migrations_log');
select is(has_table_privilege('anon', 'public.schema_migrations_log', 'select'), false, 'anon cannot read schema_migrations_log');

-- No policy grants anon anything; no always-true policies ---------------------
select is(
  (select count(*)::int from pg_policies where 'anon' = any(roles)),
  0,
  'no RLS policy anywhere applies to anon'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and (qual = 'true' or with_check = 'true')),
  0,
  'no always-true RLS policy exists in public'
);

-- Migration log recorded all five Phase 2 migrations ---------------------------
-- Scoped to the Phase 2 prefix range so later phases can append their own
-- migrations without weakening this check. The exact Phase 2 set, in order,
-- must remain present and unmodified. Phase 3's migrations are asserted
-- separately in 06_provenance_structure.sql.
select results_eq(
  $$ select migration_name from public.schema_migrations_log
     where migration_name < '20260719000600' order by migration_name $$,
  $$ values ('20260719000100_workspace_foundation'),
            ('20260719000200_intake_shadow_schema'),
            ('20260719000300_intake_rls_policies'),
            ('20260719000400_intake_functions'),
            ('20260719000500_storage_policies') $$,
  'all five Phase 2 migrations are logged and unmodified'
);

select * from finish();
rollback;
