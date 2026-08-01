-- Media and Photography Hardening — migration 3: readiness and reconciliation.
--
-- Two questions the owner needs answered without opening every record:
--   "which photographs is this record still missing?"  → readiness
--   "where do storage and the database disagree?"      → the issues queue
--
-- Readiness is a workflow status, not a claim about the goods. It says which
-- guidance slots are uncovered; it never asserts condition, authenticity, or
-- completeness of the item itself.

-- ---------------------------------------------------------------------------
-- Readiness
-- ---------------------------------------------------------------------------

create or replace view public.inventory_media_readiness
with (security_invoker = true) as
with subjects as (
  select i.workspace_id, 'item'::text as subject_kind, i.id as subject_id,
         sk.inventory_subtype as subtype
    from public.inventory_items i
    join public.sellable_skus sk on sk.id = i.sku_id
  union all
  select l.workspace_id, 'lot'::text, l.id, sk.inventory_subtype
    from public.inventory_lots l
    join public.sellable_skus sk on sk.id = l.sku_id
),
counts as (
  select coalesce(m.item_id, m.lot_id) as subject_id,
         count(*) filter (where m.lifecycle = 'active') as active_count,
         count(*) filter (where m.lifecycle = 'reserved') as reserved_count,
         count(*) filter (where m.lifecycle = 'deleted' and m.purged_at is null) as recoverable_count
    from public.inventory_media m
   group by 1
),
covered as (
  select coalesce(m.item_id, m.lot_id) as subject_id, m.slot_key
    from public.inventory_media m
   where m.lifecycle = 'active' and m.slot_key is not null
   group by 1, 2
),
issues as (
  select coalesce(i.media_id, '00000000-0000-0000-0000-000000000000'::uuid) as media_id,
         m.item_id, m.lot_id, i.workspace_id
    from public.inventory_media_issues i
    left join public.inventory_media m on m.id = i.media_id
   where i.state = 'open'
),
issue_counts as (
  select coalesce(item_id, lot_id) as subject_id, count(*) as open_issue_count
    from issues where coalesce(item_id, lot_id) is not null group by 1
),
missing as (
  select s.subject_id,
         array_remove(array_agg(r.slot_label order by r.display_order)
           filter (where r.slot_kind <> 'defect'), null) as missing_angles,
         array_remove(array_agg(r.slot_label order by r.display_order)
           filter (where r.slot_kind = 'defect'), null) as missing_defects
    from subjects s
    join public.inventory_media_requirements r
      on r.subtype = s.subtype and r.is_required
    left join covered c on c.subject_id = s.subject_id and c.slot_key = r.slot_key
   where c.slot_key is null
   group by 1
)
select
  s.workspace_id,
  s.subject_kind,
  s.subject_id,
  s.subtype,
  coalesce(c.active_count, 0) as active_count,
  coalesce(c.reserved_count, 0) as reserved_count,
  coalesce(c.recoverable_count, 0) as recoverable_count,
  coalesce(ic.open_issue_count, 0) as open_issue_count,
  coalesce(m.missing_angles, '{}') as missing_required_angles,
  coalesce(m.missing_defects, '{}') as missing_required_defect_photos,
  case
    -- Bytes are still in flight, so nothing else can be judged yet.
    when coalesce(c.reserved_count, 0) > 0 then 'upload_incomplete'
    -- Storage and metadata disagree about this subject's photos.
    when coalesce(ic.open_issue_count, 0) > 0 then 'media_review_needed'
    -- A record with no photograph at all is never photo-complete, even where
    -- the category defines no required angle.
    when coalesce(c.active_count, 0) = 0 then 'missing_required_angle'
    when coalesce(array_length(m.missing_angles, 1), 0) > 0 then 'missing_required_angle'
    when coalesce(array_length(m.missing_defects, 1), 0) > 0 then 'missing_defect_photo'
    else 'complete'
  end as readiness_status
from subjects s
left join counts c on c.subject_id = s.subject_id
left join issue_counts ic on ic.subject_id = s.subject_id
left join missing m on m.subject_id = s.subject_id;

revoke all on public.inventory_media_readiness from public, anon;
grant select on public.inventory_media_readiness to authenticated;

create or replace function public.get_inventory_media_readiness(
  p_workspace_id uuid, p_subject_kind text, p_subject_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.inventory_media_readiness%rowtype;
  v_slots jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select * into v_row from public.inventory_media_readiness
   where workspace_id = p_workspace_id
     and subject_kind = p_subject_kind
     and subject_id = p_subject_id;
  if v_row.subject_id is null then
    raise exception 'inventory subject not found in this workspace' using errcode = '23514';
  end if;

  -- The full guidance checklist, with what is already covered.
  select coalesce(jsonb_agg(jsonb_build_object(
           'slot_key', r.slot_key, 'slot_label', r.slot_label, 'slot_kind', r.slot_kind,
           'is_required', r.is_required,
           'covered', exists (select 1 from public.inventory_media m
                               where coalesce(m.item_id, m.lot_id) = p_subject_id
                                 and m.lifecycle = 'active' and m.slot_key = r.slot_key)
         ) order by r.display_order), '[]'::jsonb)
    into v_slots
    from public.inventory_media_requirements r
   where r.subtype = v_row.subtype;

  return jsonb_build_object(
    'subject_kind', v_row.subject_kind,
    'subject_id', v_row.subject_id,
    'subtype', v_row.subtype,
    'readiness_status', v_row.readiness_status,
    'active_count', v_row.active_count,
    'reserved_count', v_row.reserved_count,
    'recoverable_count', v_row.recoverable_count,
    'open_issue_count', v_row.open_issue_count,
    'missing_required_angles', to_jsonb(v_row.missing_required_angles),
    'missing_required_defect_photos', to_jsonb(v_row.missing_required_defect_photos),
    'slots', v_slots);
end
$$;

revoke all on function public.get_inventory_media_readiness(uuid, text, uuid) from public, anon;
grant execute on function public.get_inventory_media_readiness(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Listing
-- ---------------------------------------------------------------------------

create or replace function public.list_inventory_media(
  p_workspace_id uuid, p_subject_kind text, p_subject_id uuid,
  p_include_deleted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'lifecycle', m.lifecycle, 'storage_path', m.storage_path,
           'slot_key', m.slot_key, 'slot_label', m.slot_label,
           'sort_order', m.sort_order, 'is_primary', m.is_primary,
           'content_type', m.content_type, 'byte_size', m.byte_size,
           'rotation_degrees', m.rotation_degrees, 'exif_orientation', m.exif_orientation,
           'original_filename', m.original_filename, 'content_hash', m.content_hash,
           'created_at', m.created_at, 'deleted_at', m.deleted_at,
           'purge_after', m.purge_after, 'purged_at', m.purged_at
         ) order by m.lifecycle, m.sort_order, m.created_at), '[]'::jsonb)
    into v_rows
    from public.inventory_media m
   where m.workspace_id = p_workspace_id
     and coalesce(m.item_id, m.lot_id) = p_subject_id
     and m.subject_kind = p_subject_kind
     and (m.lifecycle = 'active'
          or (p_include_deleted and m.lifecycle = 'deleted' and m.purged_at is null)
          or m.lifecycle = 'reserved');

  return v_rows;
end
$$;

revoke all on function public.list_inventory_media(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.list_inventory_media(uuid, text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Orphan and mismatch reconciliation
-- ---------------------------------------------------------------------------

-- SQL cannot enumerate a storage bucket, so the caller supplies the object
-- listing it observed and this function diffs it against the metadata. Nothing
-- is ever deleted here: disagreements become queue entries for a human.
-- A null listing means storage could not be enumerated, in which case the
-- storage-dependent checks are skipped rather than guessed at.
create or replace function public.reconcile_inventory_media(
  p_workspace_id uuid,
  p_storage_paths text[] default null,
  p_stale_upload_minutes integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_opened integer := 0;
  v_resolved integer := 0;
  v_listing_available boolean := p_storage_paths is not null;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  if v_listing_available then
    -- Bytes nobody points at.
    with observed as (select unnest(p_storage_paths) as path),
    orphans as (
      select o.path from observed o
       where not exists (select 1 from public.inventory_media m
                          where m.storage_path = o.path)
    )
    insert into public.inventory_media_issues
      (workspace_id, issue_kind, storage_path, detail)
    select p_workspace_id, 'storage_object_without_row', path,
           jsonb_build_object('detected_by', 'reconcile')
      from orphans
    on conflict do nothing;
    get diagnostics v_opened = row_count;

    -- Rows pointing at bytes that are not there.
    with observed as (select unnest(p_storage_paths) as path)
    insert into public.inventory_media_issues
      (workspace_id, issue_kind, media_id, storage_path, detail)
    select p_workspace_id, 'row_without_storage_object', m.id, m.storage_path,
           jsonb_build_object('lifecycle', m.lifecycle)
      from public.inventory_media m
     where m.workspace_id = p_workspace_id
       and m.lifecycle = 'active'
       and not exists (select 1 from observed o where o.path = m.storage_path)
    on conflict do nothing;

    -- Purged, yet the object is still present.
    with observed as (select unnest(p_storage_paths) as path)
    insert into public.inventory_media_issues
      (workspace_id, issue_kind, media_id, storage_path, detail)
    select p_workspace_id, 'failed_deletion', m.id, m.storage_path,
           jsonb_build_object('purged_at', m.purged_at)
      from public.inventory_media m
     where m.workspace_id = p_workspace_id
       and m.purged_at is not null
       and exists (select 1 from observed o where o.path = m.storage_path)
    on conflict do nothing;

    -- Conditions that demonstrably no longer hold are closed, so the queue
    -- reflects reality instead of accumulating history.
    with observed as (select unnest(p_storage_paths) as path)
    update public.inventory_media_issues i
       set state = 'resolved', resolved_at = now(), resolved_by = v_uid,
           resolution_note = 'no longer detected'
     where i.workspace_id = p_workspace_id and i.state = 'open'
       and (
         (i.issue_kind = 'storage_object_without_row'
           and exists (select 1 from public.inventory_media m where m.storage_path = i.storage_path))
      or (i.issue_kind = 'row_without_storage_object'
           and exists (select 1 from observed o where o.path = i.storage_path))
      or (i.issue_kind = 'failed_deletion'
           and not exists (select 1 from observed o where o.path = i.storage_path))
       );
    get diagnostics v_resolved = row_count;
  end if;

  -- Reservations that never completed.
  insert into public.inventory_media_issues
    (workspace_id, issue_kind, media_id, storage_path, detail)
  select p_workspace_id, 'interrupted_upload', m.id, m.storage_path,
         jsonb_build_object('reserved_at', m.reserved_at)
    from public.inventory_media m
   where m.workspace_id = p_workspace_id
     and m.lifecycle = 'reserved'
     and m.reserved_at < now() - make_interval(mins => greatest(coalesce(p_stale_upload_minutes, 60), 1))
  on conflict do nothing;

  -- The same bytes held more than once in the workspace.
  insert into public.inventory_media_issues
    (workspace_id, issue_kind, media_id, storage_path, detail)
  select p_workspace_id, 'duplicate_content', m.id, m.storage_path,
         jsonb_build_object('content_hash', m.content_hash)
    from public.inventory_media m
   where m.workspace_id = p_workspace_id and m.lifecycle = 'active'
     and m.content_hash is not null
     and exists (
       select 1 from public.inventory_media d
        where d.workspace_id = m.workspace_id and d.lifecycle = 'active'
          and d.content_hash = m.content_hash and d.id <> m.id
          and d.created_at < m.created_at)
  on conflict do nothing;

  -- Paths outside the governed convention for this workspace.
  insert into public.inventory_media_issues
    (workspace_id, issue_kind, media_id, storage_path, detail)
  select p_workspace_id, 'invalid_path', m.id, m.storage_path, '{}'::jsonb
    from public.inventory_media m
   where m.workspace_id = p_workspace_id
     and not app.media_path_matches_workspace(m.workspace_id, m.storage_path)
  on conflict do nothing;

  -- Photographs still attached to inventory that has been retired.
  insert into public.inventory_media_issues
    (workspace_id, issue_kind, media_id, storage_path, detail)
  select p_workspace_id, 'retired_subject', m.id, m.storage_path,
         jsonb_build_object('subject_state',
           app.media_subject_state(m.workspace_id, m.subject_kind, m.item_id, m.lot_id))
    from public.inventory_media m
   where m.workspace_id = p_workspace_id and m.lifecycle = 'active'
     and app.media_subject_state(m.workspace_id, m.subject_kind, m.item_id, m.lot_id)
         not in ('active')
  on conflict do nothing;

  return jsonb_build_object(
    'outcome', 'reconciled',
    'storage_listing_available', v_listing_available,
    'open_issue_count', (select count(*) from public.inventory_media_issues
                          where workspace_id = p_workspace_id and state = 'open'));
end
$$;

revoke all on function public.reconcile_inventory_media(uuid, text[], integer) from public, anon;
grant execute on function public.reconcile_inventory_media(uuid, text[], integer) to authenticated;

create or replace function public.list_inventory_media_issues(
  p_workspace_id uuid, p_state text default 'open'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'issue_kind', i.issue_kind, 'state', i.state,
           'media_id', i.media_id, 'storage_path', i.storage_path,
           'detail', i.detail, 'detected_at', i.detected_at,
           'resolved_at', i.resolved_at, 'resolution_note', i.resolution_note,
           'subject_kind', m.subject_kind,
           'subject_id', coalesce(m.item_id, m.lot_id),
           'media_lifecycle', m.lifecycle
         ) order by i.detected_at desc), '[]'::jsonb)
    into v_rows
    from public.inventory_media_issues i
    left join public.inventory_media m on m.id = i.media_id
   where i.workspace_id = p_workspace_id
     and (p_state is null or i.state = p_state);

  return v_rows;
end
$$;

revoke all on function public.list_inventory_media_issues(uuid, text) from public, anon;
grant execute on function public.list_inventory_media_issues(uuid, text) to authenticated;

create or replace function public.resolve_inventory_media_issue(
  p_workspace_id uuid, p_issue_id uuid, p_state text, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_issue public.inventory_media_issues%rowtype;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  if p_state not in ('resolved', 'dismissed') then
    raise exception 'an issue can only be resolved or dismissed' using errcode = '23514';
  end if;

  select * into v_issue from public.inventory_media_issues
   where id = p_issue_id and workspace_id = p_workspace_id for update;
  if v_issue.id is null then
    raise exception 'media issue not found in this workspace' using errcode = '23514';
  end if;
  if v_issue.state <> 'open' then
    return jsonb_build_object('outcome', 'already_closed', 'issue_id', v_issue.id);
  end if;

  update public.inventory_media_issues
     set state = p_state, resolved_at = now(), resolved_by = v_uid,
         resolution_note = left(p_note, 300)
   where id = v_issue.id
  returning * into v_issue;

  insert into public.inventory_media_events
    (workspace_id, media_id, subject_kind, item_id, lot_id, event_type, actor_id, detail)
  select p_workspace_id, v_issue.media_id,
         coalesce(m.subject_kind, 'item'), m.item_id, m.lot_id,
         'issue_resolved', v_uid,
         jsonb_build_object('issue_id', v_issue.id, 'issue_kind', v_issue.issue_kind,
                            'state', p_state, 'note', v_issue.resolution_note)
    from (select 1) t
    left join public.inventory_media m on m.id = v_issue.media_id;

  return jsonb_build_object('outcome', p_state, 'issue_id', v_issue.id);
end
$$;

revoke all on function public.resolve_inventory_media_issue(uuid, uuid, text, text) from public, anon;
grant execute on function public.resolve_inventory_media_issue(uuid, uuid, text, text) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260801000300_media_readiness_and_issues');
