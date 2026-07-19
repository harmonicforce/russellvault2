-- Phase 2 shadow foundation — migration 5: private photo/evidence storage
-- policies.
--
-- Convention: one PRIVATE bucket, `intake-evidence`. Object paths must be
--   <workspace_id>/<item_id>/<filename>
-- and access is granted only through workspace membership on the first path
-- segment. There is no public bucket, no anon policy, and reads are expected
-- to happen through signed/authenticated requests — never public URLs.
--
-- This migration does NOT create or modify any bucket, and it never touches a
-- remote project: it only defines policies, and only when a storage schema is
-- present (local Supabase stack, or the local shim). Creating the bucket
-- itself is a later owner-gated activation step.

-- Safe path parser: first path segment as a workspace uuid, or NULL when the
-- path does not follow the convention (never raises inside a policy).
create function app.storage_path_workspace(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end
$$;

revoke all on function app.storage_path_workspace(text) from public;
grant execute on function app.storage_path_workspace(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects not present; skipping storage policies (local plain-postgres without shim?)';
    return;
  end if;

  -- Members may read objects in their own workspace's folder only.
  execute $pol$
    create policy intake_evidence_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'intake-evidence'
        and app.member_role(app.storage_path_workspace(name)) is not null
      )
  $pol$;

  -- Owner/operator may upload, and only into a well-formed path inside their
  -- own workspace's folder.
  execute $pol$
    create policy intake_evidence_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'intake-evidence'
        and app.member_role(app.storage_path_workspace(name)) in ('owner', 'operator')
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      )
  $pol$;

  -- UPDATE re-applies the complete path validation from INSERT: the new name
  -- must be a well-formed <workspace>/<item>/<filename> path inside a
  -- workspace where the caller is owner/operator, so an object can never be
  -- renamed into a malformed or foreign path.
  execute $pol$
    create policy intake_evidence_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'intake-evidence'
        and app.member_role(app.storage_path_workspace(name)) in ('owner', 'operator')
      )
      with check (
        bucket_id = 'intake-evidence'
        and app.member_role(app.storage_path_workspace(name)) in ('owner', 'operator')
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      )
  $pol$;

  -- Evidence deletion is owner-only, mirroring public.photos.
  execute $pol$
    create policy intake_evidence_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'intake-evidence'
        and app.member_role(app.storage_path_workspace(name)) = 'owner'
      )
  $pol$;
exception when insufficient_privilege then
  -- On platforms where storage.objects is owned by the storage admin role,
  -- these policies must be installed through the storage admin instead. That
  -- is an owner-gated activation step; the local shadow environment is not
  -- affected.
  raise notice 'insufficient privilege to create storage policies here; install them via the storage admin during activation';
end
$$;

insert into public.schema_migrations_log (migration_name)
values ('20260719000500_storage_policies');
