-- Listing Prep — structure, authorization and the shape of the model.
--
-- The guarantees asserted here are the ones that stop a preparation record
-- becoming a second inventory truth: nobody writes these tables directly, the
-- history cannot be edited, the category matrix is bounded reference data
-- rather than a free-form key/value store, and no definer function leaves its
-- search_path open.
begin;
create extension if not exists pgtap with schema public;
select no_plan();

-- Tables ---------------------------------------------------------------------
select has_table('public'::name, 'listing_prep'::name, 'the preparation record has a home');
select has_table('public'::name, 'listing_prep_requirements'::name, 'the category matrix has a home');
select has_table('public'::name, 'listing_prep_checks'::name, 'confirmations have a home');
select has_table('public'::name, 'listing_prep_events'::name, 'preparation history has a home');
select has_table('public'::name, 'listing_package_presets'::name, 'package presets have a home');

select has_view('public'::name, 'listing_prep_readiness'::name,
  'readiness is a view, so it cannot be stored stale');

-- Row-level security ----------------------------------------------------------
select is(
  (select bool_and(c.relrowsecurity) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('listing_prep', 'listing_prep_requirements',
                        'listing_prep_checks', 'listing_prep_events',
                        'listing_package_presets')),
  true,
  'row-level security is enabled on every listing prep table');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
      and table_name in ('listing_prep', 'listing_prep_requirements',
                         'listing_prep_checks', 'listing_prep_events',
                         'listing_package_presets')),
  0,
  'anon and PUBLIC hold no privilege on any listing prep table');

-- Nobody writes these tables directly. Every mutation is a governed function,
-- so the lifecycle and its history cannot be bypassed by a client that happens
-- to hold a table grant.
select is(
  (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and table_name in ('listing_prep', 'listing_prep_requirements',
                         'listing_prep_checks', 'listing_prep_events',
                         'listing_package_presets')),
  'SELECT',
  'authenticated may read listing preparation but never write it');

select has_trigger('public'::name, 'listing_prep_events'::name,
  'listing_prep_events_append_only'::name,
  'preparation history is append-only');

select trigger_is('public', 'listing_prep_events', 'listing_prep_events_append_only',
  'app', 'forbid_update_delete', 'and it is the shared append-only guard');

-- The invariants the model depends on -------------------------------------------
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
           and indexname = 'listing_prep_one_active_per_subject'),
  'an inventory record can carry at most one live preparation');

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
           and indexname = 'listing_package_presets_name_unique'),
  'two live package presets cannot share a name');

-- Exactly one subject, matching subject_kind: the governed hierarchy is not
-- flattened, and a preparation never points at both an item and a lot.
select ok(
  exists (select 1 from pg_constraint
           where conname = 'listing_prep_one_subject'
             and conrelid = 'public.listing_prep'::regclass),
  'a preparation names exactly one inventory record, item or lot');

select ok(
  exists (select 1 from pg_constraint
           where conname = 'listing_prep_listed_coherence'
             and conrelid = 'public.listing_prep'::regclass),
  'a listed preparation always carries when it was listed, and only then');

select ok(
  exists (select 1 from pg_constraint
           where conname = 'listing_prep_blocked_coherence'
             and conrelid = 'public.listing_prep'::regclass),
  'a blocked preparation always says why');

select ok(
  exists (select 1 from pg_constraint
           where conname = 'listing_prep_price_floor'
             and conrelid = 'public.listing_prep'::regclass),
  'a price floor above the asking price is refused by the database itself');

-- Money -------------------------------------------------------------------------
-- The repository convention is integer minor units plus an explicit currency.
-- A floating-point price column would silently lose cents.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'listing_prep'
      and column_name in ('asking_price_minor', 'minimum_price_minor')
      and data_type <> 'bigint'),
  0,
  'money is stored as integer minor units, never as a float');

select is(
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'listing_prep'
      and column_name = 'currency'),
  'text',
  'and every amount is qualified by an explicit currency');

-- The governed surface -----------------------------------------------------------
select is(
  (select count(*)::int from unnest(array[
      'start_listing_prep', 'update_listing_prep_content', 'set_listing_prep_check',
      'assign_listing_prep', 'set_listing_prep_priority', 'transition_listing_prep',
      'mark_listing_prep_listed', 'evaluate_listing_prep_readiness',
      'list_listing_prep_queue', 'get_listing_prep', 'get_listing_prep_for_subject',
      'bulk_listing_prep_action', 'get_listing_prep_summary',
      'create_listing_package_preset', 'retire_listing_package_preset',
      'list_listing_package_presets', 'apply_listing_package_preset']) t(fn)
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = t.fn)),
  0,
  'every governed listing prep operation exists');

-- A definer function with a mutable search_path is a privilege-escalation route.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and (p.proname like '%listing_prep%' or p.proname like '%listing_package%')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg in ('search_path=', 'search_path=""'))),
  0,
  'every SECURITY DEFINER listing prep function pins an empty search_path');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and (p.proname like '%listing_prep%' or p.proname like '%listing_package%')
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon cannot execute any governed listing prep function');

-- The internal helpers are internal. A caller that could log its own history
-- entry, or read another member''s role, would be outside the governed path.
select ok(
  not has_function_privilege('authenticated',
    'app.listing_prep_log(uuid, uuid, text, uuid, public.listing_prep_status, public.listing_prep_status, text, jsonb)',
    'execute'),
  'the history writer is not callable by an application role');
select ok(
  not has_function_privilege('authenticated', 'app.member_role_of(uuid, uuid)', 'execute'),
  'looking up another member''s role is not callable by an application role');
select ok(
  not has_function_privilege('authenticated', 'app.listing_prep_blockers(uuid)', 'execute'),
  'the readiness gate used by transitions is internal to the governed path');

-- The category matrix -------------------------------------------------------------
select is(
  (select count(distinct subtype)::int from public.listing_prep_requirements),
  8,
  'every inventory subtype has preparation guidance');

-- Photograph requirements live in the media matrix. Restating them here would
-- let the two disagree about what a category needs.
select is(
  (select count(*)::int from public.listing_prep_requirements
    where requirement_key like '%photo%' or requirement_key like '%angle%'),
  0,
  'photo requirements are delegated to the media matrix, not restated here');

select is(
  (select count(*)::int from public.listing_prep_requirements
    where subtype = 'unclassified'),
  1,
  'an unclassified record is asked to be classified, and nothing else');

select ok(
  (select count(*) from public.listing_prep_requirements
    where subtype = 'electronics' and is_required) >= 5,
  'electronics carry the obligations a buyer actually depends on');

select ok(
  (select bool_and(requirement_key ~ '^[a-z][a-z0-9_]{0,39}$')
     from public.listing_prep_requirements),
  'requirement keys are a bounded identifier shape, not free text');

select * from finish();
rollback;
