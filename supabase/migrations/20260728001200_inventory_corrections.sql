-- Operational completion — correcting a committed record without rewriting
-- history.
--
-- Committed identity is immutable, and that is the right rule: a certificate
-- number that can be edited is not evidence of anything. But "immutable" with
-- no correction path means the only way to fix a typo is to pretend the record
-- never existed, which is worse than the typo.
--
-- So corrections work the way every other governed change here works -- by a
-- new row that says what happened:
--
--   1. anyone who can write inventory RAISES a correction request naming the
--      record, the kind of error, and what they believe the value should be;
--   2. an owner or operator REVIEWS it -- approve or reject, with a note;
--   3. an approved identity error is RESOLVED by superseding: the operator
--      re-enters the record correctly through normal intake, and the original
--      is voided and linked to its replacement.
--
-- Nothing is deleted and nothing is edited in place. The original keeps its
-- movement history, its photos, its intake session and its identifiers; it
-- simply stops being active stock, and both records show the link.
--
-- A duplicate is the same machinery with no replacement to create: the
-- duplicate is voided and pointed at the record that survives.

create type public.correction_issue_type as enum (
  'wrong_category',
  'wrong_product_name',
  'wrong_set',
  'wrong_card_number',
  'wrong_grade',
  'wrong_grader',
  'wrong_certificate',
  'wrong_serial',
  'wrong_size',
  'wrong_style_code',
  'wrong_model',
  'wrong_condition',
  'wrong_product_format',
  'wrong_quantity',
  'duplicate_record',
  'other'
);

create type public.correction_state as enum (
  'open',
  'approved',
  'rejected',
  'resolved'
);

-- Serialized units need the same "no longer active stock" concept lots got in
-- 20260728001000. Same three states, same meaning, same refusal to delete.
create type public.inventory_item_state as enum (
  'active',
  'superseded',
  'void'
);

alter table public.inventory_items
  add column item_state public.inventory_item_state not null default 'active',
  -- The record that replaced this one, or the duplicate's survivor. Set once,
  -- when the correction resolves.
  add column superseded_by_item_id uuid,
  add column void_reason text check (void_reason is null or char_length(void_reason) <= 500);

alter table public.inventory_items
  add constraint inventory_items_superseded_by_fk
  foreign key (superseded_by_item_id, workspace_id)
    references public.inventory_items (id, workspace_id) on delete restrict;

alter table public.inventory_items
  add constraint inventory_items_not_own_successor
  check (superseded_by_item_id is null or superseded_by_item_id <> id);

create index inventory_items_state_idx
  on public.inventory_items (workspace_id, item_state);

-- Lots gain the same replacement link. `lot_state` already exists.
alter table public.inventory_lots
  add column superseded_by_lot_id uuid,
  add column void_reason text check (void_reason is null or char_length(void_reason) <= 500);

alter table public.inventory_lots
  add constraint inventory_lots_superseded_by_fk
  foreign key (superseded_by_lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict;

alter table public.inventory_lots
  add constraint inventory_lots_not_own_successor
  check (superseded_by_lot_id is null or superseded_by_lot_id <> id);

-- item_state, its link and its reason must be writable by the governed
-- functions below. Everything that IDENTIFIES the unit stays frozen, exactly
-- as before -- and `authenticated` still holds SELECT only on this table, so
-- this opens a SECURITY DEFINER path, not a client one.
drop trigger inventory_items_identity_immutable on public.inventory_items;
create trigger inventory_items_identity_immutable
  before update on public.inventory_items
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'lot_id', 'sku_id', 'scan_sku', 'grading_company',
    'certificate_number', 'serial_number', 'created_by_process', 'created_at'
  );

-- The request ---------------------------------------------------------------
create table public.inventory_correction_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-COR-[A-Z0-9]{6,20}$'),
  subject_kind text not null check (subject_kind in ('item', 'lot')),
  item_id uuid,
  lot_id uuid,
  issue_type public.correction_issue_type not null,
  explanation text not null check (char_length(btrim(explanation)) between 1 and 2000),
  -- What the requester believes the value should be. Free-form on purpose:
  -- this is a claim awaiting review, not a fact, and it is never applied
  -- automatically to anything.
  proposed_values jsonb not null default '{}'::jsonb,
  supporting_media_id uuid references public.inventory_media (id) on delete restrict,
  requested_by uuid not null references auth.users (id) on delete restrict,
  requested_at timestamptz not null default now(),
  state public.correction_state not null default 'open',
  reviewed_by uuid references auth.users (id) on delete restrict,
  reviewed_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  -- Set when an identity error is resolved by superseding, or a duplicate is
  -- voided in favour of a survivor.
  replacement_item_id uuid,
  replacement_lot_id uuid,
  unique (workspace_id, public_id),
  -- Exactly one subject, matching subject_kind.
  check ((subject_kind = 'item' and item_id is not null and lot_id is null)
      or (subject_kind = 'lot' and lot_id is not null and item_id is null)),
  -- A decision always records who made it and when.
  check ((state = 'open' and reviewed_by is null and reviewed_at is null)
      or (state <> 'open' and reviewed_by is not null and reviewed_at is not null)),
  foreign key (item_id, workspace_id)
    references public.inventory_items (id, workspace_id) on delete restrict,
  foreign key (lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict,
  foreign key (replacement_item_id, workspace_id)
    references public.inventory_items (id, workspace_id) on delete restrict,
  foreign key (replacement_lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict
);
create index inventory_correction_requests_workspace_idx
  on public.inventory_correction_requests (workspace_id, state);
create index inventory_correction_requests_item_idx
  on public.inventory_correction_requests (item_id);
create index inventory_correction_requests_lot_idx
  on public.inventory_correction_requests (lot_id);

-- A request is a claim someone made at a point in time. What it says, who said
-- it and about what can never change; only the review outcome may be written,
-- and only once.
create trigger inventory_correction_requests_claim_frozen
  before update on public.inventory_correction_requests
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'subject_kind', 'item_id', 'lot_id',
    'issue_type', 'explanation', 'proposed_values', 'supporting_media_id',
    'requested_by', 'requested_at'
  );
create trigger inventory_correction_requests_no_delete
  before delete on public.inventory_correction_requests
  for each row execute function app.forbid_update_delete();
create trigger inventory_correction_requests_no_truncate
  before truncate on public.inventory_correction_requests
  for each statement execute function app.forbid_update_delete();

alter table public.inventory_correction_requests enable row level security;
revoke all on table public.inventory_correction_requests from public, anon, authenticated;
grant select on table public.inventory_correction_requests to authenticated;

-- Every member may READ correction history -- knowing a record was questioned
-- is part of reading the record honestly. Raising and deciding go through the
-- governed functions.
create policy inventory_correction_requests_select on public.inventory_correction_requests
  for select to authenticated using (app.member_role(workspace_id) is not null);

-- Raise ----------------------------------------------------------------------
create function public.request_inventory_correction(
  p_workspace_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_issue_type public.correction_issue_type,
  p_explanation text,
  p_proposed_values jsonb default '{}'::jsonb,
  p_supporting_media_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_public text;
  v_id uuid;
  v_exists boolean;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  if p_subject_kind not in ('item', 'lot') then
    raise exception 'a correction is raised against an item or a lot' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_explanation, '')), '') is null then
    raise exception 'say what is wrong with this record' using errcode = '23514';
  end if;

  if p_subject_kind = 'item' then
    select exists (select 1 from public.inventory_items
      where id = p_subject_id and workspace_id = p_workspace_id) into v_exists;
  else
    select exists (select 1 from public.inventory_lots
      where id = p_subject_id and workspace_id = p_workspace_id) into v_exists;
  end if;
  if not v_exists then
    raise exception 'that record is not in this workspace' using errcode = '23514';
  end if;

  -- Supporting evidence must belong to the workspace; a correction cannot
  -- point at a neighbour's photo.
  if p_supporting_media_id is not null
     and not exists (select 1 from public.inventory_media m
       where m.id = p_supporting_media_id and m.workspace_id = p_workspace_id) then
    raise exception 'that photo is not in this workspace' using errcode = '23514';
  end if;

  v_public := app.mint_governed_public_id('RV-COR');
  insert into public.inventory_correction_requests (
    workspace_id, public_id, subject_kind,
    item_id, lot_id, issue_type, explanation, proposed_values,
    supporting_media_id, requested_by)
  values (
    p_workspace_id, v_public, p_subject_kind,
    case when p_subject_kind = 'item' then p_subject_id end,
    case when p_subject_kind = 'lot' then p_subject_id end,
    p_issue_type, btrim(p_explanation), coalesce(p_proposed_values, '{}'::jsonb),
    p_supporting_media_id, v_uid)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'public_id', v_public, 'state', 'open');
end
$$;

revoke all on function public.request_inventory_correction(
  uuid, text, uuid, public.correction_issue_type, text, jsonb, uuid) from public, anon;
grant execute on function public.request_inventory_correction(
  uuid, text, uuid, public.correction_issue_type, text, jsonb, uuid) to authenticated;

-- Decide ----------------------------------------------------------------------
-- Approving does NOT change the record. It records that an owner or operator
-- agrees there is an error; fixing it is the separate, explicit act below.
-- Keeping those apart is what stops "approve" from quietly rewriting identity.
create function public.review_inventory_correction(
  p_workspace_id uuid,
  p_correction_id uuid,
  p_decision text,
  p_resolution_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role public.workspace_role;
  v_row public.inventory_correction_requests%rowtype;
  v_next public.correction_state;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  v_role := app.member_role(p_workspace_id);
  if v_role not in ('owner', 'operator') then
    raise exception 'only an owner or operator can decide a correction'
      using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'a correction is approved or rejected' using errcode = '23514';
  end if;
  v_next := case when p_decision = 'approve' then 'approved' else 'rejected' end;

  select * into v_row from public.inventory_correction_requests
  where id = p_correction_id and workspace_id = p_workspace_id
  for update;
  if v_row.id is null then
    raise exception 'correction not found in this workspace' using errcode = '23514';
  end if;
  if v_row.state <> 'open' then
    raise exception 'this correction was already decided' using errcode = '23514';
  end if;
  if v_next = 'rejected' and nullif(btrim(coalesce(p_resolution_note, '')), '') is null then
    -- Rejecting someone's report without saying why is how reports stop being
    -- raised at all.
    raise exception 'say why this correction is being rejected' using errcode = '23514';
  end if;

  update public.inventory_correction_requests
  set state = v_next,
      reviewed_by = v_uid,
      reviewed_at = now(),
      resolution_note = nullif(btrim(coalesce(p_resolution_note, '')), '')
  where id = p_correction_id;

  return jsonb_build_object('id', p_correction_id, 'state', v_next);
end
$$;

revoke all on function public.review_inventory_correction(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.review_inventory_correction(uuid, uuid, text, text)
  to authenticated;

-- Supersede --------------------------------------------------------------------
-- The act that actually retires a wrong record. The replacement is a real
-- record the operator already committed through normal intake -- this function
-- never invents one, because inventing identity is the thing the whole model
-- exists to prevent.
--
-- Also serves duplicates: the "replacement" is simply the record that survives.
create function public.supersede_inventory_record(
  p_workspace_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_replacement_id uuid,
  p_reason text,
  p_correction_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role public.workspace_role;
  v_item public.inventory_items%rowtype;
  v_lot public.inventory_lots%rowtype;
  v_replacement_item public.inventory_items%rowtype;
  v_replacement_lot public.inventory_lots%rowtype;
  v_correction public.inventory_correction_requests%rowtype;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  v_role := app.member_role(p_workspace_id);
  if v_role not in ('owner', 'operator') then
    raise exception 'only an owner or operator can void a record' using errcode = '42501';
  end if;
  if p_subject_kind not in ('item', 'lot') then
    raise exception 'an item or a lot is superseded' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why this record is being retired' using errcode = '23514';
  end if;
  if p_subject_id = p_replacement_id then
    raise exception 'a record cannot replace itself' using errcode = '23514';
  end if;

  if p_correction_id is not null then
    select * into v_correction from public.inventory_correction_requests
    where id = p_correction_id and workspace_id = p_workspace_id
    for update;
    if v_correction.id is null then
      raise exception 'correction not found in this workspace' using errcode = '23514';
    end if;
    if v_correction.state <> 'approved' then
      -- Resolving an undecided or rejected report would make the review step
      -- decorative.
      raise exception 'a correction must be approved before it is resolved'
        using errcode = '23514';
    end if;
  end if;

  if p_subject_kind = 'item' then
    select * into v_item from public.inventory_items
    where id = p_subject_id and workspace_id = p_workspace_id
    for update;
    if v_item.id is null then
      raise exception 'that unit is not in this workspace' using errcode = '23514';
    end if;
    if v_item.item_state <> 'active' then
      raise exception 'that unit is already retired' using errcode = '23514';
    end if;

    select * into v_replacement_item from public.inventory_items
    where id = p_replacement_id and workspace_id = p_workspace_id;
    if v_replacement_item.id is null then
      raise exception 'the replacement unit is not in this workspace' using errcode = '23514';
    end if;
    if v_replacement_item.item_state <> 'active' then
      raise exception 'the replacement unit is not active inventory' using errcode = '23514';
    end if;

    update public.inventory_items
    -- A correction-driven retirement is a SUPERSESSION (this record was wrong
    -- and has a corrected successor); a bare one is a VOID (this record should
    -- not exist, e.g. a duplicate). Both keep the link and the reason.
    set item_state = (case when p_correction_id is null then 'void' else 'superseded' end)
                     ::public.inventory_item_state,
        superseded_by_item_id = p_replacement_id,
        void_reason = btrim(p_reason),
        updated_at = now()
    where id = p_subject_id;
  else
    select * into v_lot from public.inventory_lots
    where id = p_subject_id and workspace_id = p_workspace_id
    for update;
    if v_lot.id is null then
      raise exception 'that lot is not in this workspace' using errcode = '23514';
    end if;
    if v_lot.lot_state <> 'active' then
      raise exception 'that lot is already retired' using errcode = '23514';
    end if;

    select * into v_replacement_lot from public.inventory_lots
    where id = p_replacement_id and workspace_id = p_workspace_id;
    if v_replacement_lot.id is null then
      raise exception 'the replacement lot is not in this workspace' using errcode = '23514';
    end if;
    if v_replacement_lot.lot_state <> 'active' then
      raise exception 'the replacement lot is not active inventory' using errcode = '23514';
    end if;

    -- The quantity does not move. A superseded lot was a wrong RECORD of stock,
    -- not stock that went somewhere, and silently adding its count to the
    -- replacement would double the inventory the operator actually has.
    update public.inventory_lots
    set lot_state = 'void',
        superseded_by_lot_id = p_replacement_id,
        void_reason = btrim(p_reason),
        updated_at = now()
    where id = p_subject_id;
  end if;

  if p_correction_id is not null then
    update public.inventory_correction_requests
    set state = 'resolved',
        replacement_item_id = case when p_subject_kind = 'item' then p_replacement_id end,
        replacement_lot_id = case when p_subject_kind = 'lot' then p_replacement_id end,
        resolution_note = coalesce(resolution_note, btrim(p_reason))
    where id = p_correction_id;
  end if;

  return jsonb_build_object(
    'subject_kind', p_subject_kind,
    'subject_id', p_subject_id,
    'replacement_id', p_replacement_id,
    'correction_id', p_correction_id);
end
$$;

revoke all on function public.supersede_inventory_record(uuid, text, uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.supersede_inventory_record(uuid, text, uuid, uuid, text, uuid)
  to authenticated;

-- Retired units are not movable stock ------------------------------------------
create or replace function public.move_inventory_item(
  p_workspace_id uuid,
  p_item_id uuid,
  p_to_location_code text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_item public.inventory_items%rowtype;
  v_to uuid;
  v_from uuid;
  v_public text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_item from public.inventory_items
  where id = p_item_id and workspace_id = p_workspace_id
  for update;
  if v_item.id is null then
    raise exception 'item not found in this workspace' using errcode = '23514';
  end if;
  if v_item.item_state <> 'active' then
    raise exception 'this unit is no longer active inventory' using errcode = '23514';
  end if;

  v_to := app.intake_resolve_location(p_workspace_id, p_to_location_code);
  if v_to is null then
    raise exception 'destination location % is not an active location in this workspace',
      p_to_location_code using errcode = '23514';
  end if;

  v_from := v_item.location_id;
  if v_from is not distinct from v_to then
    raise exception 'this item is already in %', p_to_location_code using errcode = '23514';
  end if;

  v_public := app.mint_governed_public_id('RV-MOVE');
  insert into public.inventory_movements (
    workspace_id, public_id, subject_kind, item_id, from_location_id, to_location_id, note, moved_by)
  values (p_workspace_id, v_public, 'item', p_item_id, v_from, v_to,
    nullif(btrim(coalesce(p_note, '')), ''), v_uid);

  update public.inventory_items
  set location_id = v_to, updated_at = now()
  where id = p_item_id;

  return jsonb_build_object('item_id', p_item_id, 'movement_public_id', v_public,
    'from_location_id', v_from, 'to_location_id', v_to);
end
$$;

revoke all on function public.move_inventory_item(uuid, uuid, text, text) from public, anon;
grant execute on function public.move_inventory_item(uuid, uuid, text, text) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260728001200_inventory_corrections');
