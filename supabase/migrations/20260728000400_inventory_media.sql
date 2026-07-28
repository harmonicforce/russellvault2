-- Multi-category intake — migration 3: private inventory media.
--
-- The Phase 2 `intake-evidence` bucket and public.photos were both written
-- against the earlier shadow `items` table, which is NOT the inventory model
-- the application now commits into. Attaching new photos there would bind
-- them to the wrong item identity, so this adds a separate, correctly-linked
-- media model against the CURRENT hierarchy: a media row belongs to exactly
-- one serialized inventory_item or one inventory_lot.
--
-- Storage is a private bucket. There is no public URL: display goes through
-- short-lived signed URLs created under the caller's own session, so a media
-- object is only ever reachable by someone RLS already lets read it.
--
-- Object path convention (three segments, matching the existing parser):
--   <workspace_id>/<subject_id>/<filename>
-- Membership is evaluated on the first segment, so an object can never be
-- written into or read out of another workspace's folder.

create table public.inventory_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  subject_kind text not null check (subject_kind in ('item', 'lot')),
  item_id uuid references public.inventory_items (id) on delete restrict,
  lot_id uuid references public.inventory_lots (id) on delete restrict,
  storage_path text not null unique check (char_length(storage_path) between 3 and 400),
  -- Workflow guidance ("Front", "Back", "Size tag"). Never evidence of a fact.
  slot_label text check (slot_label is null or char_length(slot_label) <= 60),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_primary boolean not null default false,
  content_type text not null check (content_type in
    ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_media_one_subject check (
    (subject_kind = 'item' and item_id is not null and lot_id is null)
    or (subject_kind = 'lot' and lot_id is not null and item_id is null)
  )
);

create index inventory_media_item_idx on public.inventory_media (workspace_id, item_id, sort_order);
create index inventory_media_lot_idx on public.inventory_media (workspace_id, lot_id, sort_order);

-- At most one primary image per subject.
create unique index inventory_media_one_primary_item
  on public.inventory_media (item_id) where is_primary and subject_kind = 'item';
create unique index inventory_media_one_primary_lot
  on public.inventory_media (lot_id) where is_primary and subject_kind = 'lot';

create trigger inventory_media_touch_updated_at
  before update on public.inventory_media
  for each row execute function app.touch_updated_at();

-- The subject must live in the SAME workspace as the media row. SECURITY
-- DEFINER so the check reads the inventory tables directly instead of
-- recursing through their own RLS.
create function app.media_subject_in_workspace(
  p_workspace_id uuid, p_subject_kind text, p_item_id uuid, p_lot_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_subject_kind
    when 'item' then exists (
      select 1 from public.inventory_items
      where id = p_item_id and workspace_id = p_workspace_id)
    when 'lot' then exists (
      select 1 from public.inventory_lots
      where id = p_lot_id and workspace_id = p_workspace_id)
    else false
  end
$$;

revoke all on function app.media_subject_in_workspace(uuid, text, uuid, uuid) from public, anon;
grant execute on function app.media_subject_in_workspace(uuid, text, uuid, uuid) to authenticated;

-- The storage object path must sit under this workspace's folder, so a media
-- row can never point at another workspace's bytes.
create function app.media_path_matches_workspace(p_workspace_id uuid, p_storage_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select app.storage_path_workspace(p_storage_path) = p_workspace_id
$$;

revoke all on function app.media_path_matches_workspace(uuid, text) from public, anon;
grant execute on function app.media_path_matches_workspace(uuid, text) to authenticated;

alter table public.inventory_media enable row level security;
revoke all on table public.inventory_media from public, anon, authenticated;
grant select, insert, update, delete on table public.inventory_media to authenticated;

-- Any member may see their workspace's media.
create policy inventory_media_select on public.inventory_media
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

-- Owner/operator may attach media, only to a subject in the same workspace,
-- only with a storage path under that workspace's folder, and only as
-- themselves.
create policy inventory_media_insert on public.inventory_media
  for insert to authenticated
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and uploaded_by = (select auth.uid())
    and app.media_subject_in_workspace(workspace_id, subject_kind, item_id, lot_id)
    and app.media_path_matches_workspace(workspace_id, storage_path)
  );

-- Reordering and primary-image selection are ordinary edits; the subject and
-- path are re-validated so a row can never be repointed across workspaces.
create policy inventory_media_update on public.inventory_media
  for update to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'))
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and app.media_subject_in_workspace(workspace_id, subject_kind, item_id, lot_id)
    and app.media_path_matches_workspace(workspace_id, storage_path)
  );

create policy inventory_media_delete on public.inventory_media
  for delete to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'));

-- Private bucket + object policies -----------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping bucket creation';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('inventory-media', 'inventory-media', false, 20971520,
          array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
exception when insufficient_privilege then
  raise notice 'insufficient privilege to create the inventory-media bucket here';
end
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects not present; skipping storage policies';
    return;
  end if;

  execute $pol$
    create policy inventory_media_objects_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'inventory-media'
        and app.member_role(app.storage_path_workspace(name)) is not null
      )
  $pol$;

  execute $pol$
    create policy inventory_media_objects_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'inventory-media'
        and app.member_role(app.storage_path_workspace(name)) in ('owner', 'operator')
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      )
  $pol$;

  execute $pol$
    create policy inventory_media_objects_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'inventory-media'
        and app.member_role(app.storage_path_workspace(name)) in ('owner', 'operator')
      )
      with check (
        bucket_id = 'inventory-media'
        and app.member_role(app.storage_path_workspace(name)) in ('owner', 'operator')
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      )
  $pol$;

  execute $pol$
    create policy inventory_media_objects_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'inventory-media'
        and app.member_role(app.storage_path_workspace(name)) in ('owner', 'operator')
      )
  $pol$;
exception
  when insufficient_privilege then
    raise notice 'insufficient privilege to create storage policies here';
  when duplicate_object then
    raise notice 'inventory-media storage policies already present';
end
$$;

insert into public.schema_migrations_log (migration_name)
values ('20260728000400_inventory_media');
