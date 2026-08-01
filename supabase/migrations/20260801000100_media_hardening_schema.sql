-- Media and Photography Hardening — migration 1: schema.
--
-- The existing media foundation (20260728000400) binds bytes in a private
-- bucket to a metadata row and is correct as far as it goes. What it cannot
-- express is the *lifecycle* of a photograph taken on a phone in a warehouse:
-- the upload that half-finished, the retry after the response was lost, the
-- photo deleted by accident, the object left in storage when a row insert
-- failed. Those are the states this migration makes representable, so the
-- application can reason about them instead of silently leaking or duplicating.
--
-- Everything here is additive. No existing column is dropped or retyped, and
-- the bucket, path convention, and workspace boundary are untouched.

-- ---------------------------------------------------------------------------
-- 1. Media lifecycle, identity, and non-destructive transforms
-- ---------------------------------------------------------------------------

-- A media row is now reserved BEFORE the bytes are sent, so an interrupted
-- upload leaves evidence that something was attempted rather than nothing.
-- 'active' is the default so every pre-existing row keeps its current meaning.
alter table public.inventory_media
  add column if not exists lifecycle text not null default 'active'
    check (lifecycle in ('reserved', 'active', 'deleted'));

-- The caller's retry token. Replaying a lost response resolves to the SAME
-- media row instead of creating a second one.
alter table public.inventory_media
  add column if not exists idempotency_key uuid;

-- SHA-256 of the file bytes, used to warn about duplicate content. It is a
-- hint for the operator, never an automatic rejection: the same card photo
-- legitimately appears on more than one subject.
alter table public.inventory_media
  add column if not exists content_hash text
    check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

-- Rotation is stored, never baked in. The original bytes are the condition
-- evidence and are never recompressed or overwritten.
alter table public.inventory_media
  add column if not exists rotation_degrees smallint not null default 0
    check (rotation_degrees in (0, 90, 180, 270));

-- The EXIF orientation observed once at reserve time. Recorded so display can
-- normalize exactly once and a later rotation can never double-apply it.
alter table public.inventory_media
  add column if not exists exif_orientation smallint
    check (exif_orientation is null or exif_orientation between 1 and 8);

-- The operator's original filename, kept only for recognition in the UI. It is
-- sanitized and length-capped by the reserving function; it is never used to
-- build the storage path.
alter table public.inventory_media
  add column if not exists original_filename text
    check (original_filename is null or char_length(original_filename) <= 160);

-- Governed slot identity. `slot_label` stays as the free-text display string
-- already in use; `slot_key` is what the required-photo matrix matches on, so
-- readiness never depends on operator spelling.
alter table public.inventory_media
  add column if not exists slot_key text
    check (slot_key is null or slot_key ~ '^[a-z][a-z0-9_]{0,39}$');

-- Recoverable deletion. A deleted photo is retained until `purge_after`, so an
-- accidental delete in a warehouse aisle is not a permanent loss of evidence.
alter table public.inventory_media
  add column if not exists deleted_at timestamptz;
alter table public.inventory_media
  add column if not exists deleted_by uuid references auth.users (id);
alter table public.inventory_media
  add column if not exists delete_reason text
    check (delete_reason is null or char_length(delete_reason) <= 300);
alter table public.inventory_media
  add column if not exists purge_after timestamptz;

-- Set when the bytes have actually been removed from storage. The row itself
-- is retained so the audit trail never develops a hole where a photograph was.
alter table public.inventory_media
  add column if not exists purged_at timestamptz;

alter table public.inventory_media
  add column if not exists reserved_at timestamptz;
alter table public.inventory_media
  add column if not exists committed_at timestamptz;

-- Lifecycle coherence: a deleted row carries its deletion facts, and a live
-- row never carries them.
do $$
begin
  alter table public.inventory_media
    add constraint inventory_media_delete_coherence check (
      (lifecycle = 'deleted' and deleted_at is not null and purge_after is not null)
      or (lifecycle <> 'deleted' and deleted_at is null and deleted_by is null
          and delete_reason is null and purge_after is null and purged_at is null)
    );
exception when duplicate_object then null;
end $$;

-- A reserved row has no bytes proven yet, so it must never be primary and
-- never be counted as a photograph of the subject.
do $$
begin
  alter table public.inventory_media
    add constraint inventory_media_reserved_not_primary
      check (lifecycle <> 'reserved' or is_primary = false);
exception when duplicate_object then null;
end $$;

-- Retry replay resolves to one row per token per workspace.
create unique index if not exists inventory_media_idempotency_key_unique
  on public.inventory_media (workspace_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists inventory_media_lifecycle_idx
  on public.inventory_media (workspace_id, lifecycle);
create index if not exists inventory_media_content_hash_idx
  on public.inventory_media (workspace_id, content_hash)
  where content_hash is not null;
create index if not exists inventory_media_purge_idx
  on public.inventory_media (purge_after)
  where lifecycle = 'deleted';

-- ---------------------------------------------------------------------------
-- 2. Deterministic ordering
-- ---------------------------------------------------------------------------

-- Existing rows were written with `sort_order = <count at the time>`, a
-- read-then-write that can already have produced duplicates. Normalize the
-- current data to a deterministic sequence BEFORE adding the uniqueness that
-- ordering now depends on, otherwise this migration would fail on real data.
with ranked as (
  select id,
         row_number() over (
           partition by coalesce(item_id, lot_id)
           order by is_primary desc, sort_order, created_at, id
         ) - 1 as position
  from public.inventory_media
  where lifecycle = 'active'
)
update public.inventory_media m
   set sort_order = ranked.position
  from ranked
 where m.id = ranked.id
   and m.sort_order is distinct from ranked.position;

-- One photo per position per subject, among live photos only. Reserved and
-- deleted rows are excluded so they neither consume nor block a position.
create unique index if not exists inventory_media_active_position_unique
  on public.inventory_media (coalesce(item_id, lot_id), sort_order)
  where lifecycle = 'active';

-- ---------------------------------------------------------------------------
-- 3. Primary-image invariant, scoped to live photos
-- ---------------------------------------------------------------------------

-- The original indexes counted deleted rows, so a soft-deleted primary would
-- permanently block electing a replacement. Re-scope them to live photos.
-- The invariant itself is unchanged: at most one primary per subject.
drop index if exists public.inventory_media_one_primary_item;
drop index if exists public.inventory_media_one_primary_lot;

create unique index if not exists inventory_media_one_primary_item
  on public.inventory_media (item_id)
  where is_primary and subject_kind = 'item' and lifecycle = 'active';
create unique index if not exists inventory_media_one_primary_lot
  on public.inventory_media (lot_id)
  where is_primary and subject_kind = 'lot' and lifecycle = 'active';

-- ---------------------------------------------------------------------------
-- 4. Append-only media audit
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_media_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  media_id uuid references public.inventory_media (id) on delete restrict,
  subject_kind text not null check (subject_kind in ('item', 'lot')),
  item_id uuid references public.inventory_items (id) on delete restrict,
  lot_id uuid references public.inventory_lots (id) on delete restrict,
  event_type text not null check (event_type in
    ('reserved', 'committed', 'abandoned', 'reordered', 'primary_changed',
     'rotated', 'deleted', 'restored', 'purged', 'issue_opened', 'issue_resolved')),
  actor_id uuid not null references auth.users (id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_media_events_subject_idx
  on public.inventory_media_events (workspace_id, coalesce(item_id, lot_id), created_at desc);
create index if not exists inventory_media_events_media_idx
  on public.inventory_media_events (media_id, created_at desc);

do $$
begin
  create trigger inventory_media_events_append_only
    before update or delete on public.inventory_media_events
    for each row execute function app.forbid_update_delete();
exception when duplicate_object then null;
end $$;

alter table public.inventory_media_events enable row level security;
revoke all on table public.inventory_media_events from public, anon, authenticated;
grant select on table public.inventory_media_events to authenticated;

-- History is readable by members; it is only ever written by the governed
-- SECURITY DEFINER functions, so there is deliberately no insert policy.
create policy inventory_media_events_select on public.inventory_media_events
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

-- ---------------------------------------------------------------------------
-- 5. Category-aware required-photo matrix
-- ---------------------------------------------------------------------------

-- Reference data, not workspace data: the practical set of angles that make a
-- category listable. These are workflow guidance (ENGINEERING_RULES §6), never
-- evidence of a fact about the goods, and extra photos are always allowed.
create table if not exists public.inventory_media_requirements (
  subtype public.inventory_subtype not null,
  slot_key text not null check (slot_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  slot_label text not null check (char_length(slot_label) between 1 and 60),
  slot_kind text not null check (slot_kind in
    ('angle', 'label', 'defect', 'accessory', 'seal', 'measurement')),
  is_required boolean not null default false,
  display_order integer not null default 0,
  primary key (subtype, slot_key)
);

alter table public.inventory_media_requirements enable row level security;
revoke all on table public.inventory_media_requirements from public, anon, authenticated;
grant select on table public.inventory_media_requirements to authenticated;

-- The matrix is reference data rather than workspace data, but it is still not
-- public: only somebody who actually belongs to a workspace may read it.
-- SECURITY DEFINER so the check does not recurse through workspace_members RLS.
create or replace function app.belongs_to_any_workspace()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm where wm.user_id = (select auth.uid())
  )
$$;

revoke all on function app.belongs_to_any_workspace() from public, anon;
grant execute on function app.belongs_to_any_workspace() to authenticated;

create policy inventory_media_requirements_select on public.inventory_media_requirements
  for select to authenticated using (app.belongs_to_any_workspace());

-- Seeded to match the photo slots the intake forms already show, so the
-- operator sees the same vocabulary at intake and at photography time.
-- Defect photos are required only where condition is the value driver; a
-- graded slab's condition is the grade, and a sealed box is sealed.
insert into public.inventory_media_requirements
  (subtype, slot_key, slot_label, slot_kind, is_required, display_order)
values
  ('graded_card', 'front', 'Front', 'angle', true, 1),
  ('graded_card', 'back', 'Back', 'angle', true, 2),
  ('graded_card', 'label', 'Label close-up', 'label', true, 3),
  ('graded_card', 'defects', 'Defects', 'defect', false, 4),

  ('raw_card', 'front', 'Front', 'angle', true, 1),
  ('raw_card', 'back', 'Back', 'angle', true, 2),
  ('raw_card', 'defects', 'Defects or flaws', 'defect', true, 3),

  ('sealed_tcg', 'front', 'Front', 'angle', true, 1),
  ('sealed_tcg', 'back', 'Back', 'angle', true, 2),
  ('sealed_tcg', 'seal', 'Packaging condition', 'seal', true, 3),
  ('sealed_tcg', 'defects', 'Damage or wear', 'defect', false, 4),

  ('footwear', 'pair', 'Pair', 'angle', true, 1),
  ('footwear', 'left_side', 'Left side', 'angle', true, 2),
  ('footwear', 'right_side', 'Right side', 'angle', true, 3),
  ('footwear', 'soles', 'Soles', 'angle', true, 4),
  ('footwear', 'size_tag', 'Size tag', 'label', true, 5),
  ('footwear', 'box_label', 'Box label', 'label', false, 6),
  ('footwear', 'defects', 'Flaws or wear', 'defect', true, 7),

  ('apparel', 'front', 'Front', 'angle', true, 1),
  ('apparel', 'back', 'Back', 'angle', true, 2),
  ('apparel', 'brand_tag', 'Brand or size tag', 'label', true, 3),
  ('apparel', 'defects', 'Condition detail', 'defect', true, 4),

  ('electronics', 'front', 'Front', 'angle', true, 1),
  ('electronics', 'back', 'Back', 'angle', true, 2),
  ('electronics', 'serial_label', 'Model or serial label', 'label', true, 3),
  ('electronics', 'accessories', 'Included accessories', 'accessory', false, 4),
  ('electronics', 'defects', 'Condition detail', 'defect', true, 5),

  ('other_collectible', 'front', 'Front', 'angle', true, 1),
  ('other_collectible', 'back', 'Back', 'angle', true, 2),
  ('other_collectible', 'detail', 'Identifier or condition detail', 'label', false, 3),
  ('other_collectible', 'defects', 'Defects', 'defect', false, 4),

  -- An unclassified record has no category to require angles for. It needs
  -- classification first; requiring guessed angles would be fabricated policy.
  ('unclassified', 'front', 'Front', 'angle', false, 1)
on conflict (subtype, slot_key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Orphan and mismatch queue
-- ---------------------------------------------------------------------------

-- Storage and the metadata table can disagree, and the safe response is never
-- to delete something automatically. Disagreements are recorded here for an
-- operator to resolve deliberately.
create table if not exists public.inventory_media_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  issue_kind text not null check (issue_kind in
    ('storage_object_without_row',   -- bytes exist, nothing points at them
     'row_without_storage_object',   -- row points at bytes that are not there
     'duplicate_content',            -- same content hash within the workspace
     'interrupted_upload',           -- reserved and never committed
     'invalid_path',                 -- path outside the governed convention
     'retired_subject',              -- attached to voided/superseded inventory
     'failed_deletion')),            -- purge attempted and storage refused
  media_id uuid references public.inventory_media (id) on delete restrict,
  storage_path text,
  detail jsonb not null default '{}'::jsonb,
  state text not null default 'open' check (state in ('open', 'resolved', 'dismissed')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 300),
  constraint inventory_media_issues_resolution_coherence check (
    (state = 'open' and resolved_at is null and resolved_by is null)
    or (state <> 'open' and resolved_at is not null and resolved_by is not null)
  ),
  -- An issue must name something to act on.
  constraint inventory_media_issues_subject check (media_id is not null or storage_path is not null)
);

-- One open issue per kind per object, so repeated reconciliation runs update
-- rather than pile up duplicates in the operator's queue.
create unique index if not exists inventory_media_issues_open_unique
  on public.inventory_media_issues
     (workspace_id, issue_kind, coalesce(storage_path, media_id::text))
  where state = 'open';

create index if not exists inventory_media_issues_state_idx
  on public.inventory_media_issues (workspace_id, state, detected_at desc);

alter table public.inventory_media_issues enable row level security;
revoke all on table public.inventory_media_issues from public, anon, authenticated;
grant select on table public.inventory_media_issues to authenticated;

-- Written only by the governed reconciliation functions.
create policy inventory_media_issues_select on public.inventory_media_issues
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

insert into public.schema_migrations_log (migration_name)
values ('20260801000100_media_hardening_schema');
