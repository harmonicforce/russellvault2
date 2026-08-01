-- Media hardening — structure, authorization and storage boundary.
--
-- The photographs are condition evidence for goods that are sold, so the
-- guarantees asserted here are the ones that stop them leaking or being
-- quietly rewritten: private bucket, workspace-scoped paths, no anon reach,
-- no direct client write into the audit trail, and governed functions that
-- run with a pinned empty search_path.
begin;
create extension if not exists pgtap with schema public;
select no_plan();

-- Tables ---------------------------------------------------------------------
select has_table('public'::name, 'inventory_media'::name, 'inventory media has a home');
select has_table('public'::name, 'inventory_media_events'::name, 'media history has a home');
select has_table('public'::name, 'inventory_media_requirements'::name, 'the photo matrix has a home');
select has_table('public'::name, 'inventory_media_issues'::name, 'the issue queue has a home');

-- Lifecycle and recovery columns ----------------------------------------------
select is(
  (select count(*)::int from unnest(array[
      'lifecycle', 'idempotency_key', 'content_hash', 'rotation_degrees',
      'exif_orientation', 'original_filename', 'slot_key',
      'deleted_at', 'deleted_by', 'delete_reason', 'purge_after', 'purged_at',
      'reserved_at', 'committed_at']) t(col)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'inventory_media'
        and c.column_name = t.col)),
  0,
  'inventory_media records the full photograph lifecycle');

-- RLS is on everywhere ---------------------------------------------------------
select is(
  (select bool_and(c.relrowsecurity) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('inventory_media', 'inventory_media_events',
                        'inventory_media_requirements', 'inventory_media_issues')),
  true,
  'row-level security is enabled on every media table');

-- anon can reach none of it ------------------------------------------------------
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
      and table_name in ('inventory_media', 'inventory_media_events',
                         'inventory_media_requirements', 'inventory_media_issues')),
  0,
  'anon and PUBLIC hold no privilege on any media table');

-- History and the issue queue are written only by governed functions ------------
select is(
  (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
     from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and table_name in ('inventory_media_events', 'inventory_media_issues',
                         'inventory_media_requirements')),
  'SELECT',
  'authenticated may read media history, issues and the matrix but never write them');

select has_trigger('public'::name, 'inventory_media_events'::name,
  'inventory_media_events_append_only'::name,
  'media history is append-only');

select trigger_is('public', 'inventory_media_events', 'inventory_media_events_append_only',
  'app', 'forbid_update_delete', 'and it is the shared append-only guard');

-- Invariants that ordering and primary selection depend on -----------------------
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
           and indexname = 'inventory_media_active_position_unique'),
  'live photos cannot share a position');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
           and indexname = 'inventory_media_one_primary_item'),
  'an item has at most one primary image');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
           and indexname = 'inventory_media_one_primary_lot'),
  'a lot has at most one primary image');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
           and indexname = 'inventory_media_idempotency_key_unique'),
  'a retry key resolves to exactly one photo per workspace');

-- The governed surface -----------------------------------------------------------
select is(
  (select count(*)::int from unnest(array[
      'reserve_inventory_media', 'commit_inventory_media', 'abandon_inventory_media',
      'reorder_inventory_media', 'set_primary_inventory_media', 'rotate_inventory_media',
      'soft_delete_inventory_media', 'restore_inventory_media', 'purge_inventory_media',
      'list_inventory_media', 'get_inventory_media_readiness', 'reconcile_inventory_media',
      'list_inventory_media_issues', 'resolve_inventory_media_issue',
      'get_media_readiness_summary']) t(fn)
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = t.fn)),
  0,
  'every governed media operation exists');

-- A definer function with a mutable search_path is a privilege-escalation route.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%inventory_media%'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg in ('search_path=', 'search_path=""'))),
  0,
  'every SECURITY DEFINER media function pins an empty search_path');

-- Anon must not be able to execute any of them.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%inventory_media%'
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon cannot execute any governed media function');

-- Storage boundary -----------------------------------------------------------------
select is(
  (select public from storage.buckets where id = 'inventory-media'),
  false,
  'the inventory media bucket is private');

select is(
  (select allowed_mime_types::text from storage.buckets where id = 'inventory-media'),
  '{image/jpeg,image/png,image/webp,image/heic,image/heif}',
  'only image types the model accepts may be stored');

select is(
  (select file_size_limit from storage.buckets where id = 'inventory-media'),
  20971520::bigint,
  'the bucket enforces the same size ceiling as the table');

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'inventory_media_objects_%'),
  4,
  'the media bucket carries its own workspace-scoped object policies');

-- Required-photo matrix -------------------------------------------------------------
select is(
  (select count(distinct subtype)::int from public.inventory_media_requirements),
  8,
  'every inventory subtype has a photo guidance row');

select ok(
  (select count(*) from public.inventory_media_requirements
    where subtype = 'footwear' and is_required) >= 4,
  'footwear asks for the several angles its condition depends on');

select is(
  (select count(*)::int from public.inventory_media_requirements
    where subtype = 'unclassified' and is_required),
  0,
  'an unclassified record is not asked for angles nobody can name yet');

select * from finish();
rollback;
