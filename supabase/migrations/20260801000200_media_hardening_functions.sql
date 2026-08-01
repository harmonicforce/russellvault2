-- Media and Photography Hardening — migration 2: governed operations.
--
-- Every mutation that used to be a bare table UPDATE from the browser becomes
-- a SECURITY DEFINER function here. The reason is not ceremony: ordering and
-- primary selection are multi-row invariants, and a browser issuing two
-- separate statements cannot hold them. Doing the work inside one function
-- means one transaction, one lock order, and no window where the subject has
-- two primary images or none.
--
-- Uploads are two-phase. `reserve` allocates the governed path and records the
-- intent; the bytes are then sent directly to private storage; `commit` makes
-- the photograph real. A photo counts only when BOTH halves succeeded, and the
-- caller's idempotency key makes a replayed commit resolve to the same row
-- instead of a duplicate.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Resolve the subject's own lifecycle so media attached to inventory that was
-- voided or superseded can be surfaced for review.
create or replace function app.media_subject_state(
  p_workspace_id uuid, p_subject_kind text, p_item_id uuid, p_lot_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_subject_kind
    when 'item' then (select i.item_state::text from public.inventory_items i
                       where i.id = p_item_id and i.workspace_id = p_workspace_id)
    when 'lot'  then (select l.lot_state::text from public.inventory_lots l
                       where l.id = p_lot_id and l.workspace_id = p_workspace_id)
  end
$$;

revoke all on function app.media_subject_state(uuid, text, uuid, uuid) from public, anon;
grant execute on function app.media_subject_state(uuid, text, uuid, uuid) to authenticated;

-- The category whose photo requirements apply to a subject.
create or replace function app.media_subject_subtype(
  p_workspace_id uuid, p_subject_kind text, p_item_id uuid, p_lot_id uuid
)
returns public.inventory_subtype
language sql
stable
security definer
set search_path = ''
as $$
  select case p_subject_kind
    when 'item' then (select sk.inventory_subtype from public.inventory_items i
                        join public.sellable_skus sk on sk.id = i.sku_id
                       where i.id = p_item_id and i.workspace_id = p_workspace_id)
    when 'lot'  then (select sk.inventory_subtype from public.inventory_lots l
                        join public.sellable_skus sk on sk.id = l.sku_id
                       where l.id = p_lot_id and l.workspace_id = p_workspace_id)
  end
$$;

revoke all on function app.media_subject_subtype(uuid, text, uuid, uuid) from public, anon;
grant execute on function app.media_subject_subtype(uuid, text, uuid, uuid) to authenticated;

create or replace function app.media_log(
  p_workspace_id uuid, p_media public.inventory_media, p_event text,
  p_actor uuid, p_detail jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.inventory_media_events
    (workspace_id, media_id, subject_kind, item_id, lot_id, event_type, actor_id, detail)
  values (p_workspace_id, p_media.id, p_media.subject_kind, p_media.item_id, p_media.lot_id,
          p_event, p_actor, coalesce(p_detail, '{}'::jsonb))
$$;

revoke all on function app.media_log(uuid, public.inventory_media, text, uuid, jsonb) from public, anon, authenticated;

-- Storage filenames are generated, never taken from the operator's device: an
-- uploaded name can carry personal information and can collide. The original
-- is kept separately, sanitized, purely so the operator recognizes the file.
create or replace function app.media_safe_original_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9._ -]', '_', 'g'), 160), '')
$$;

revoke all on function app.media_safe_original_name(text) from public, anon;
grant execute on function app.media_safe_original_name(text) to authenticated;

create or replace function app.media_extension_for(p_content_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_content_type
    when 'image/jpeg' then 'jpg'
    when 'image/png'  then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
    when 'image/heif' then 'heif'
  end
$$;

revoke all on function app.media_extension_for(text) from public, anon;
grant execute on function app.media_extension_for(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Upload: reserve → (bytes) → commit
-- ---------------------------------------------------------------------------

create or replace function public.reserve_inventory_media(
  p_workspace_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_content_type text,
  p_byte_size bigint,
  p_idempotency_key uuid,
  p_original_filename text default null,
  p_content_hash text default null,
  p_slot_key text default null,
  p_slot_label text default null,
  p_exif_orientation smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_existing public.inventory_media%rowtype;
  v_item uuid; v_lot uuid;
  v_ext text; v_path text; v_id uuid;
  v_dupe uuid;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  if p_subject_kind not in ('item', 'lot') then
    raise exception 'invalid media subject' using errcode = '23514';
  end if;
  if p_idempotency_key is null then
    raise exception 'an idempotency key is required' using errcode = '23514';
  end if;

  -- Replaying a lost response must resolve to the original reservation.
  select * into v_existing from public.inventory_media
   where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'outcome', 'replay', 'media_id', v_existing.id,
      'storage_path', v_existing.storage_path, 'lifecycle', v_existing.lifecycle);
  end if;

  v_item := case when p_subject_kind = 'item' then p_subject_id end;
  v_lot  := case when p_subject_kind = 'lot'  then p_subject_id end;

  if not app.media_subject_in_workspace(p_workspace_id, p_subject_kind, v_item, v_lot) then
    raise exception 'inventory subject not found in this workspace' using errcode = '23514';
  end if;

  v_ext := app.media_extension_for(p_content_type);
  if v_ext is null then
    raise exception 'unsupported image type' using errcode = '23514';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 20971520 then
    raise exception 'image size is outside the accepted range' using errcode = '23514';
  end if;

  -- Generated name; the path convention stays <workspace>/<subject>/<file>.
  v_path := p_workspace_id::text || '/' || p_subject_id::text || '/'
            || replace(gen_random_uuid()::text, '-', '') || '.' || v_ext;

  -- Same bytes already held live in this workspace: reported, never rejected.
  if p_content_hash is not null then
    select id into v_dupe from public.inventory_media
     where workspace_id = p_workspace_id and content_hash = p_content_hash
       and lifecycle = 'active'
     order by created_at limit 1;
  end if;

  insert into public.inventory_media
    (workspace_id, subject_kind, item_id, lot_id, storage_path, slot_label, slot_key,
     sort_order, is_primary, content_type, byte_size, uploaded_by, lifecycle,
     idempotency_key, content_hash, original_filename, exif_orientation, reserved_at)
  values
    (p_workspace_id, p_subject_kind, v_item, v_lot, v_path, p_slot_label, p_slot_key,
     0, false, p_content_type, p_byte_size, v_uid, 'reserved',
     p_idempotency_key, p_content_hash, app.media_safe_original_name(p_original_filename),
     p_exif_orientation, now())
  returning id into v_id;

  select * into v_existing from public.inventory_media where id = v_id;
  perform app.media_log(p_workspace_id, v_existing, 'reserved', v_uid,
    jsonb_build_object('storage_path', v_path));

  return jsonb_build_object(
    'outcome', 'reserved', 'media_id', v_id, 'storage_path', v_path,
    'lifecycle', 'reserved', 'duplicate_of', v_dupe);
end
$$;

revoke all on function public.reserve_inventory_media(uuid, text, uuid, text, bigint, uuid, text, text, text, text, smallint) from public, anon;
grant execute on function public.reserve_inventory_media(uuid, text, uuid, text, bigint, uuid, text, text, text, text, smallint) to authenticated;

-- The photograph becomes real only here, after the bytes are known to exist.
create or replace function public.commit_inventory_media(
  p_workspace_id uuid, p_media_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_m public.inventory_media%rowtype;
  v_next integer;
  v_has_primary boolean;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_m from public.inventory_media
   where id = p_media_id and workspace_id = p_workspace_id for update;
  if v_m.id is null then
    raise exception 'media not found in this workspace' using errcode = '23514';
  end if;
  if v_m.lifecycle = 'active' then
    return jsonb_build_object('outcome', 'replay', 'media_id', v_m.id,
      'sort_order', v_m.sort_order, 'is_primary', v_m.is_primary);
  end if;
  if v_m.lifecycle <> 'reserved' then
    raise exception 'this media is no longer awaiting upload' using errcode = '23514';
  end if;

  -- Serialize position assignment against concurrent commits for the subject.
  perform 1 from public.inventory_media
   where workspace_id = p_workspace_id
     and coalesce(item_id, lot_id) = coalesce(v_m.item_id, v_m.lot_id)
     and lifecycle = 'active'
   for update;

  select coalesce(max(sort_order) + 1, 0) into v_next
    from public.inventory_media
   where coalesce(item_id, lot_id) = coalesce(v_m.item_id, v_m.lot_id)
     and lifecycle = 'active';

  select exists (
    select 1 from public.inventory_media
     where coalesce(item_id, lot_id) = coalesce(v_m.item_id, v_m.lot_id)
       and lifecycle = 'active' and is_primary
  ) into v_has_primary;

  update public.inventory_media
     set lifecycle = 'active',
         committed_at = now(),
         sort_order = v_next,
         -- The first photograph of a subject becomes its primary image.
         is_primary = not v_has_primary
   where id = v_m.id
  returning * into v_m;

  perform app.media_log(p_workspace_id, v_m, 'committed', v_uid,
    jsonb_build_object('sort_order', v_m.sort_order, 'is_primary', v_m.is_primary));

  return jsonb_build_object('outcome', 'committed', 'media_id', v_m.id,
    'sort_order', v_m.sort_order, 'is_primary', v_m.is_primary);
end
$$;

revoke all on function public.commit_inventory_media(uuid, uuid) from public, anon;
grant execute on function public.commit_inventory_media(uuid, uuid) to authenticated;

-- The upload failed or was cancelled. The reservation is retired and, because
-- bytes may or may not have landed, the object is queued for reconciliation
-- rather than assumed absent.
create or replace function public.abandon_inventory_media(
  p_workspace_id uuid, p_media_id uuid, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_m public.inventory_media%rowtype;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_m from public.inventory_media
   where id = p_media_id and workspace_id = p_workspace_id for update;
  if v_m.id is null then
    raise exception 'media not found in this workspace' using errcode = '23514';
  end if;
  if v_m.lifecycle <> 'reserved' then
    return jsonb_build_object('outcome', 'not_reserved', 'media_id', v_m.id);
  end if;

  update public.inventory_media
     set lifecycle = 'deleted', deleted_at = now(), deleted_by = v_uid,
         delete_reason = coalesce(left(p_reason, 300), 'upload did not complete'),
         purge_after = now()
   where id = v_m.id
  returning * into v_m;

  insert into public.inventory_media_issues
    (workspace_id, issue_kind, media_id, storage_path, detail)
  values (p_workspace_id, 'interrupted_upload', v_m.id, v_m.storage_path,
          jsonb_build_object('reason', v_m.delete_reason))
  on conflict do nothing;

  perform app.media_log(p_workspace_id, v_m, 'abandoned', v_uid,
    jsonb_build_object('reason', v_m.delete_reason));

  return jsonb_build_object('outcome', 'abandoned', 'media_id', v_m.id);
end
$$;

revoke all on function public.abandon_inventory_media(uuid, uuid, text) from public, anon;
grant execute on function public.abandon_inventory_media(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Ordering
-- ---------------------------------------------------------------------------

-- The full live set is submitted, so the result is a deterministic sequence
-- rather than a series of swaps that can interleave. Positions are written in
-- two passes because the uniqueness that guarantees no duplicate position also
-- forbids the transient collisions a single pass would create.
create or replace function public.reorder_inventory_media(
  p_workspace_id uuid, p_subject_kind text, p_subject_id uuid, p_media_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_item uuid; v_lot uuid;
  v_live uuid[];
  v_before jsonb;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  if p_subject_kind not in ('item', 'lot') then
    raise exception 'invalid media subject' using errcode = '23514';
  end if;
  v_item := case when p_subject_kind = 'item' then p_subject_id end;
  v_lot  := case when p_subject_kind = 'lot'  then p_subject_id end;

  -- Deterministic lock order prevents deadlock between two reordering clients.
  perform 1 from public.inventory_media
   where workspace_id = p_workspace_id
     and coalesce(item_id, lot_id) = p_subject_id
     and lifecycle = 'active'
   order by id
   for update;

  select coalesce(array_agg(id order by id), '{}') into v_live
    from public.inventory_media
   where workspace_id = p_workspace_id
     and coalesce(item_id, lot_id) = p_subject_id
     and lifecycle = 'active';

  -- The submitted order must be exactly the live set: no additions, no
  -- omissions, no duplicates. A client working from a stale gallery is
  -- rejected instead of silently dropping somebody else's photo.
  if v_live is distinct from (select coalesce(array_agg(x order by x), '{}')
                                from unnest(p_media_ids) x)
     or array_length(p_media_ids, 1) is distinct from array_length(v_live, 1) then
    return jsonb_build_object('outcome', 'conflict', 'code', 'MEDIA_SET_CHANGED');
  end if;

  select jsonb_agg(jsonb_build_object('media_id', id, 'sort_order', sort_order) order by sort_order)
    into v_before
    from public.inventory_media
   where coalesce(item_id, lot_id) = p_subject_id and lifecycle = 'active';

  -- Pass 1: move out of the way. Pass 2: settle on the requested sequence.
  update public.inventory_media m
     set sort_order = 1000000 + p.ord
    from (select x.id, x.ord from unnest(p_media_ids) with ordinality as x(id, ord)) p
   where m.id = p.id;

  update public.inventory_media m
     set sort_order = p.ord - 1
    from (select x.id, x.ord from unnest(p_media_ids) with ordinality as x(id, ord)) p
   where m.id = p.id;

  insert into public.inventory_media_events
    (workspace_id, media_id, subject_kind, item_id, lot_id, event_type, actor_id, detail)
  values (p_workspace_id, null, p_subject_kind, v_item, v_lot, 'reordered', v_uid,
          jsonb_build_object('before', v_before, 'after', to_jsonb(p_media_ids)));

  return jsonb_build_object('outcome', 'reordered', 'count', array_length(p_media_ids, 1));
end
$$;

revoke all on function public.reorder_inventory_media(uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.reorder_inventory_media(uuid, text, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Primary image
-- ---------------------------------------------------------------------------

-- One transaction: lock the subject's photos, clear the old primary, set the
-- new one. There is no instant at which a reader sees two primaries, and a
-- failure rolls back to the previous primary rather than to none.
create or replace function public.set_primary_inventory_media(
  p_workspace_id uuid, p_media_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_m public.inventory_media%rowtype;
  v_previous uuid;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_m from public.inventory_media
   where id = p_media_id and workspace_id = p_workspace_id for update;
  if v_m.id is null then
    raise exception 'media not found in this workspace' using errcode = '23514';
  end if;
  if v_m.lifecycle <> 'active' then
    raise exception 'only a live photo can be the primary image' using errcode = '23514';
  end if;

  perform 1 from public.inventory_media
   where workspace_id = p_workspace_id
     and coalesce(item_id, lot_id) = coalesce(v_m.item_id, v_m.lot_id)
     and lifecycle = 'active'
   order by id
   for update;

  select id into v_previous from public.inventory_media
   where coalesce(item_id, lot_id) = coalesce(v_m.item_id, v_m.lot_id)
     and lifecycle = 'active' and is_primary;

  if v_previous is not distinct from v_m.id then
    return jsonb_build_object('outcome', 'unchanged', 'media_id', v_m.id);
  end if;

  update public.inventory_media set is_primary = false
   where coalesce(item_id, lot_id) = coalesce(v_m.item_id, v_m.lot_id)
     and lifecycle = 'active' and is_primary;

  update public.inventory_media set is_primary = true where id = v_m.id
  returning * into v_m;

  perform app.media_log(p_workspace_id, v_m, 'primary_changed', v_uid,
    jsonb_build_object('previous_media_id', v_previous));

  return jsonb_build_object('outcome', 'primary_set', 'media_id', v_m.id,
    'previous_media_id', v_previous);
end
$$;

revoke all on function public.set_primary_inventory_media(uuid, uuid) from public, anon;
grant execute on function public.set_primary_inventory_media(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rotation
-- ---------------------------------------------------------------------------

-- Rotation is metadata. The stored bytes are the condition evidence and are
-- never re-encoded, so repeated rotation cannot degrade the image.
create or replace function public.rotate_inventory_media(
  p_workspace_id uuid, p_media_id uuid, p_delta_degrees integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_m public.inventory_media%rowtype;
  v_next smallint;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  if p_delta_degrees is null or p_delta_degrees % 90 <> 0 then
    raise exception 'rotation must be a multiple of 90 degrees' using errcode = '23514';
  end if;

  select * into v_m from public.inventory_media
   where id = p_media_id and workspace_id = p_workspace_id for update;
  if v_m.id is null then
    raise exception 'media not found in this workspace' using errcode = '23514';
  end if;
  if v_m.lifecycle <> 'active' then
    raise exception 'only a live photo can be rotated' using errcode = '23514';
  end if;

  v_next := (((v_m.rotation_degrees + p_delta_degrees) % 360) + 360) % 360;

  update public.inventory_media set rotation_degrees = v_next where id = v_m.id
  returning * into v_m;

  perform app.media_log(p_workspace_id, v_m, 'rotated', v_uid,
    jsonb_build_object('from', v_m.rotation_degrees - p_delta_degrees, 'to', v_next));

  return jsonb_build_object('outcome', 'rotated', 'media_id', v_m.id,
    'rotation_degrees', v_next, 'storage_path_unchanged', true);
end
$$;

revoke all on function public.rotate_inventory_media(uuid, uuid, integer) from public, anon;
grant execute on function public.rotate_inventory_media(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Deletion and recovery
-- ---------------------------------------------------------------------------

-- Deleting a photo in a warehouse aisle is easy to do by accident, so deletion
-- is recoverable for a defined window and the bytes stay until purge. If the
-- deleted photo was the primary, a governed replacement is elected; when there
-- is nothing to elect the subject is left explicitly without one.
create or replace function public.soft_delete_inventory_media(
  p_workspace_id uuid, p_media_id uuid, p_reason text default null,
  p_recovery_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_m public.inventory_media%rowtype;
  v_subject uuid;
  v_replacement uuid;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_m from public.inventory_media
   where id = p_media_id and workspace_id = p_workspace_id for update;
  if v_m.id is null then
    raise exception 'media not found in this workspace' using errcode = '23514';
  end if;
  if v_m.lifecycle = 'deleted' then
    return jsonb_build_object('outcome', 'already_deleted', 'media_id', v_m.id);
  end if;

  v_subject := coalesce(v_m.item_id, v_m.lot_id);

  perform 1 from public.inventory_media
   where workspace_id = p_workspace_id and coalesce(item_id, lot_id) = v_subject
     and lifecycle = 'active'
   order by id
   for update;

  update public.inventory_media
     set lifecycle = 'deleted', is_primary = false, deleted_at = now(), deleted_by = v_uid,
         delete_reason = left(p_reason, 300),
         purge_after = now() + make_interval(days => greatest(coalesce(p_recovery_days, 30), 1))
   where id = v_m.id
  returning * into v_m;

  -- Close the gap so positions stay dense and deterministic.
  with ordered as (
    select id, row_number() over (order by sort_order, created_at, id) - 1 as position
      from public.inventory_media
     where coalesce(item_id, lot_id) = v_subject and lifecycle = 'active'
  )
  update public.inventory_media m
     set sort_order = 1000000 + ordered.position
    from ordered where m.id = ordered.id;
  with ordered as (
    select id, row_number() over (order by sort_order, created_at, id) - 1 as position
      from public.inventory_media
     where coalesce(item_id, lot_id) = v_subject and lifecycle = 'active'
  )
  update public.inventory_media m
     set sort_order = ordered.position
    from ordered where m.id = ordered.id;

  -- Elect a replacement primary only when the deleted photo held that role.
  if not exists (select 1 from public.inventory_media
                  where coalesce(item_id, lot_id) = v_subject
                    and lifecycle = 'active' and is_primary) then
    select id into v_replacement from public.inventory_media
     where coalesce(item_id, lot_id) = v_subject and lifecycle = 'active'
     order by sort_order, created_at, id limit 1;
    if v_replacement is not null then
      update public.inventory_media set is_primary = true where id = v_replacement;
    end if;
  end if;

  perform app.media_log(p_workspace_id, v_m, 'deleted', v_uid,
    jsonb_build_object('reason', v_m.delete_reason, 'purge_after', v_m.purge_after,
                       'replacement_primary_media_id', v_replacement));

  return jsonb_build_object('outcome', 'deleted', 'media_id', v_m.id,
    'purge_after', v_m.purge_after,
    'replacement_primary_media_id', v_replacement,
    'primary_state', case when v_replacement is not null then 'replaced'
                          when exists (select 1 from public.inventory_media
                                        where coalesce(item_id, lot_id) = v_subject
                                          and lifecycle = 'active' and is_primary)
                            then 'unchanged' else 'none' end);
end
$$;

revoke all on function public.soft_delete_inventory_media(uuid, uuid, text, integer) from public, anon;
grant execute on function public.soft_delete_inventory_media(uuid, uuid, text, integer) to authenticated;

create or replace function public.restore_inventory_media(
  p_workspace_id uuid, p_media_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_m public.inventory_media%rowtype;
  v_next integer;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_m from public.inventory_media
   where id = p_media_id and workspace_id = p_workspace_id for update;
  if v_m.id is null then
    raise exception 'media not found in this workspace' using errcode = '23514';
  end if;
  if v_m.lifecycle <> 'deleted' then
    return jsonb_build_object('outcome', 'not_deleted', 'media_id', v_m.id);
  end if;
  if v_m.purged_at is not null then
    return jsonb_build_object('outcome', 'conflict', 'code', 'MEDIA_ALREADY_PURGED');
  end if;
  if v_m.purge_after is not null and now() > v_m.purge_after then
    return jsonb_build_object('outcome', 'conflict', 'code', 'RECOVERY_WINDOW_EXPIRED');
  end if;

  perform 1 from public.inventory_media
   where workspace_id = p_workspace_id
     and coalesce(item_id, lot_id) = coalesce(v_m.item_id, v_m.lot_id)
     and lifecycle = 'active'
   order by id
   for update;

  select coalesce(max(sort_order) + 1, 0) into v_next
    from public.inventory_media
   where coalesce(item_id, lot_id) = coalesce(v_m.item_id, v_m.lot_id)
     and lifecycle = 'active';

  -- Restored to the end of the sequence, and never silently reclaiming the
  -- primary slot from whatever was elected while it was gone.
  update public.inventory_media
     set lifecycle = 'active', sort_order = v_next, is_primary = false,
         deleted_at = null, deleted_by = null, delete_reason = null, purge_after = null
   where id = v_m.id
  returning * into v_m;

  update public.inventory_media_issues
     set state = 'resolved', resolved_at = now(), resolved_by = v_uid,
         resolution_note = 'media restored'
   where workspace_id = p_workspace_id and media_id = v_m.id and state = 'open'
     and issue_kind = 'interrupted_upload';

  perform app.media_log(p_workspace_id, v_m, 'restored', v_uid,
    jsonb_build_object('sort_order', v_m.sort_order));

  return jsonb_build_object('outcome', 'restored', 'media_id', v_m.id,
    'sort_order', v_m.sort_order);
end
$$;

revoke all on function public.restore_inventory_media(uuid, uuid) from public, anon;
grant execute on function public.restore_inventory_media(uuid, uuid) to authenticated;

-- Purge records that the bytes are gone. The metadata row is deliberately
-- retained so the audit trail never develops a hole where a photograph was.
-- Storage objects are removed through the Storage API by the caller before
-- this is recorded; SQL never deletes storage objects directly.
create or replace function public.purge_inventory_media(
  p_workspace_id uuid, p_media_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role public.workspace_role;
  v_m public.inventory_media%rowtype;
begin
  v_uid := app.require_uid();
  v_role := app.member_role(p_workspace_id);
  if v_role is distinct from 'owner' then
    raise exception 'owner authority required to purge media' using errcode = '42501';
  end if;

  select * into v_m from public.inventory_media
   where id = p_media_id and workspace_id = p_workspace_id for update;
  if v_m.id is null then
    raise exception 'media not found in this workspace' using errcode = '23514';
  end if;
  if v_m.lifecycle <> 'deleted' then
    return jsonb_build_object('outcome', 'conflict', 'code', 'MEDIA_NOT_DELETED');
  end if;
  if v_m.purged_at is not null then
    return jsonb_build_object('outcome', 'already_purged', 'media_id', v_m.id);
  end if;
  if v_m.purge_after is null or now() < v_m.purge_after then
    return jsonb_build_object('outcome', 'conflict', 'code', 'RECOVERY_WINDOW_ACTIVE',
      'purge_after', v_m.purge_after);
  end if;

  update public.inventory_media set purged_at = now() where id = v_m.id
  returning * into v_m;

  perform app.media_log(p_workspace_id, v_m, 'purged', v_uid,
    jsonb_build_object('storage_path', v_m.storage_path));

  return jsonb_build_object('outcome', 'purged', 'media_id', v_m.id);
end
$$;

revoke all on function public.purge_inventory_media(uuid, uuid) from public, anon;
grant execute on function public.purge_inventory_media(uuid, uuid) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260801000200_media_hardening_functions');
