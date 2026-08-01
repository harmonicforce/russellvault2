-- Listing Prep Command Center — migration 3: the governed lifecycle.
--
-- Every change to a preparation record goes through one of these functions, so
-- the history in listing_prep_events is complete by construction rather than
-- by everyone remembering to write to it. The client is never granted INSERT
-- or UPDATE on the tables themselves.
--
-- Two authority rules are enforced here and nowhere else:
--   * an operator may do the preparation work;
--   * only an OWNER may declare a record ready to list, record that it was
--     listed, or reopen a listed record.
-- A viewer can do none of it.

-- ---------------------------------------------------------------------------
-- Internal
-- ---------------------------------------------------------------------------

-- Lock and fetch one preparation record. Every mutation starts here, so all of
-- them take the same single row lock in the same order and none can deadlock
-- against another.
create or replace function app.listing_prep_for_update(
  p_workspace_id uuid, p_prep_id uuid
)
returns public.listing_prep
language plpgsql
security definer
set search_path = ''
as $$
declare v_prep public.listing_prep%rowtype;
begin
  select * into v_prep from public.listing_prep
   where id = p_prep_id and workspace_id = p_workspace_id
   for update;
  if v_prep.id is null then
    raise exception 'listing preparation not found in this workspace' using errcode = '23514';
  end if;
  return v_prep;
end
$$;

revoke all on function app.listing_prep_for_update(uuid, uuid) from public, anon, authenticated;

-- How many blockers stand between this record and being listable, computed
-- live. Used to gate the owner's final review so "ready" can never be asserted
-- over an unresolved blocker.
create or replace function app.listing_prep_blockers(p_prep_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(r.blockers, '[]'::jsonb)
    from public.listing_prep_readiness r where r.prep_id = p_prep_id
$$;

revoke all on function app.listing_prep_blockers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Starting a preparation
-- ---------------------------------------------------------------------------

-- The grain rule lives here. Serialized stock is prepared per Item; only a
-- quantity-managed Lot is prepared as a lot. A serialized parent lot is not a
-- sellable unit, and letting it carry its own preparation would put two
-- records in charge of the same physical goods.
create or replace function public.start_listing_prep(
  p_workspace_id uuid,
  p_subject_kind text,
  p_subject_id uuid,
  p_priority public.listing_prep_priority default 'normal',
  p_assigned_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_kind text := lower(btrim(coalesce(p_subject_kind, '')));
  v_state text;
  v_tracking public.inventory_tracking_mode;
  v_existing uuid;
  v_id uuid;
begin
  v_uid := app.require_listing_prep_writer(p_workspace_id);

  if v_kind not in ('item', 'lot') then
    raise exception 'a listing preparation belongs to an item or a lot' using errcode = '23514';
  end if;
  if p_subject_id is null then
    raise exception 'an inventory record is required' using errcode = '23514';
  end if;

  if v_kind = 'item' then
    select i.item_state::text into v_state
      from public.inventory_items i
     where i.id = p_subject_id and i.workspace_id = p_workspace_id;
  else
    select l.lot_state::text, l.tracking_mode into v_state, v_tracking
      from public.inventory_lots l
     where l.id = p_subject_id and l.workspace_id = p_workspace_id;
  end if;

  if v_state is null then
    raise exception 'inventory record not found in this workspace' using errcode = '23514';
  end if;

  if v_kind = 'lot' and v_tracking = 'serialized' then
    raise exception
      'a serialized lot is prepared through its items, not as a lot'
      using errcode = '23514';
  end if;

  -- Preparing goods that are gone wastes the operator's morning; say so now
  -- rather than letting readiness explain it later.
  if v_state in ('void', 'lost', 'superseded', 'absorbed') then
    raise exception 'a % record cannot be prepared for listing', v_state using errcode = '23514';
  end if;

  select p.id into v_existing from public.listing_prep p
   where p.workspace_id = p_workspace_id
     and coalesce(p.item_id, p.lot_id) = p_subject_id
     and p.status not in ('listed', 'cancelled');
  if v_existing is not null then
    raise exception 'a listing preparation is already open for this record'
      using errcode = '23505';
  end if;

  if p_assigned_to is not null and app.member_role_of(p_workspace_id, p_assigned_to) is null then
    raise exception 'the assignee is not a member of this workspace' using errcode = '23514';
  end if;

  begin
    insert into public.listing_prep
      (workspace_id, public_id, subject_kind, item_id, lot_id,
       status, priority, assigned_to, created_by)
    values
      (p_workspace_id, app.mint_governed_public_id('RV-LP'), v_kind,
       case when v_kind = 'item' then p_subject_id end,
       case when v_kind = 'lot' then p_subject_id end,
       'not_started', coalesce(p_priority, 'normal'), p_assigned_to, v_uid)
    returning id into v_id;
  exception when unique_violation then
    -- Two operators pressed "prepare" at the same moment. The partial unique
    -- index settles it; the loser is told plainly instead of getting a second
    -- record for the same goods.
    raise exception 'a listing preparation is already open for this record'
      using errcode = '23505';
  end;

  perform app.listing_prep_log(p_workspace_id, v_id, 'started', v_uid, null, 'not_started',
    null, jsonb_build_object('subject_kind', v_kind, 'subject_id', p_subject_id));

  return public.get_listing_prep(p_workspace_id, v_id);
end
$$;

revoke all on function public.start_listing_prep(
  uuid, text, uuid, public.listing_prep_priority, uuid) from public, anon;
grant execute on function public.start_listing_prep(
  uuid, text, uuid, public.listing_prep_priority, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Listing content
-- ---------------------------------------------------------------------------

-- The patch is an explicit allow-list, not a pass-through. A key that is
-- present sets the field (including to null, which is how a value is cleared);
-- a key that is absent leaves it alone; a key nobody recognizes is an error
-- rather than a silent no-op.
create or replace function public.update_listing_prep_content(
  p_workspace_id uuid, p_prep_id uuid, p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_prep public.listing_prep%rowtype;
  v_allowed text[] := array[
    'working_title', 'condition_summary', 'description_notes', 'defects_disclosures',
    'included_items', 'research_notes', 'listing_format', 'quantity_to_list',
    'currency', 'asking_price_minor', 'minimum_price_minor',
    'shipping_policy_ref', 'return_policy_ref',
    'package_weight_grams', 'package_length_mm', 'package_width_mm',
    'package_height_mm', 'owner_notes'];
  v_unknown text;
  v_key text;
  v_next public.listing_prep%rowtype;
begin
  v_uid := app.require_listing_prep_writer(p_workspace_id);
  v_prep := app.listing_prep_for_update(p_workspace_id, p_prep_id);

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'a content patch object is required' using errcode = '23514';
  end if;

  if v_prep.status in ('listed', 'cancelled') then
    raise exception 'reopen this preparation before editing its content' using errcode = '23514';
  end if;

  select string_agg(k, ', ' order by k) into v_unknown
    from jsonb_object_keys(p_patch) k
   where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'unrecognized listing content field: %', v_unknown using errcode = '23514';
  end if;

  -- Money arrives as minor units. A fractional value means the caller is
  -- sending currency as a float somewhere, and rounding it silently is how
  -- prices drift.
  foreach v_key in array array['asking_price_minor', 'minimum_price_minor'] loop
    if p_patch ? v_key and jsonb_typeof(p_patch -> v_key) = 'number'
       and (p_patch ->> v_key) <> trunc((p_patch ->> v_key)::numeric)::text then
      raise exception '% must be whole minor units, not a fractional amount', v_key
        using errcode = '23514';
    end if;
  end loop;

  if v_prep.subject_kind = 'item' and p_patch ? 'quantity_to_list'
     and nullif(p_patch ->> 'quantity_to_list', '') is not null then
    raise exception 'a serialized item is a single unit and carries no listing quantity'
      using errcode = '23514';
  end if;

  update public.listing_prep p set
    working_title        = case when p_patch ? 'working_title' then nullif(btrim(p_patch ->> 'working_title'), '') else p.working_title end,
    condition_summary    = case when p_patch ? 'condition_summary' then nullif(btrim(p_patch ->> 'condition_summary'), '') else p.condition_summary end,
    description_notes    = case when p_patch ? 'description_notes' then nullif(btrim(p_patch ->> 'description_notes'), '') else p.description_notes end,
    defects_disclosures  = case when p_patch ? 'defects_disclosures' then nullif(btrim(p_patch ->> 'defects_disclosures'), '') else p.defects_disclosures end,
    included_items       = case when p_patch ? 'included_items' then nullif(btrim(p_patch ->> 'included_items'), '') else p.included_items end,
    research_notes       = case when p_patch ? 'research_notes' then nullif(btrim(p_patch ->> 'research_notes'), '') else p.research_notes end,
    owner_notes          = case when p_patch ? 'owner_notes' then nullif(btrim(p_patch ->> 'owner_notes'), '') else p.owner_notes end,
    listing_format       = case when p_patch ? 'listing_format' then nullif(btrim(p_patch ->> 'listing_format'), '') else p.listing_format end,
    shipping_policy_ref  = case when p_patch ? 'shipping_policy_ref' then nullif(btrim(p_patch ->> 'shipping_policy_ref'), '') else p.shipping_policy_ref end,
    return_policy_ref    = case when p_patch ? 'return_policy_ref' then nullif(btrim(p_patch ->> 'return_policy_ref'), '') else p.return_policy_ref end,
    currency             = case when p_patch ? 'currency' then upper(nullif(btrim(p_patch ->> 'currency'), '')) else p.currency end,
    quantity_to_list     = case when p_patch ? 'quantity_to_list' then nullif(p_patch ->> 'quantity_to_list', '')::integer else p.quantity_to_list end,
    asking_price_minor   = case when p_patch ? 'asking_price_minor' then nullif(p_patch ->> 'asking_price_minor', '')::bigint else p.asking_price_minor end,
    minimum_price_minor  = case when p_patch ? 'minimum_price_minor' then nullif(p_patch ->> 'minimum_price_minor', '')::bigint else p.minimum_price_minor end,
    package_weight_grams = case when p_patch ? 'package_weight_grams' then nullif(p_patch ->> 'package_weight_grams', '')::integer else p.package_weight_grams end,
    package_length_mm    = case when p_patch ? 'package_length_mm' then nullif(p_patch ->> 'package_length_mm', '')::integer else p.package_length_mm end,
    package_width_mm     = case when p_patch ? 'package_width_mm' then nullif(p_patch ->> 'package_width_mm', '')::integer else p.package_width_mm end,
    package_height_mm    = case when p_patch ? 'package_height_mm' then nullif(p_patch ->> 'package_height_mm', '')::integer else p.package_height_mm end,
    -- Work has begun the moment somebody writes something down.
    status               = case when p.status = 'not_started' then 'in_preparation' else p.status end
   where p.id = p_prep_id
  returning * into v_next;

  perform app.listing_prep_log(p_workspace_id, p_prep_id, 'content_changed', v_uid,
    null, null, null,
    jsonb_build_object('fields', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                                    from jsonb_object_keys(p_patch) k)));

  if v_next.status is distinct from v_prep.status then
    perform app.listing_prep_log(p_workspace_id, p_prep_id, 'status_changed', v_uid,
      v_prep.status, v_next.status, 'work started');
  end if;

  return public.get_listing_prep(p_workspace_id, p_prep_id);
end
$$;

revoke all on function public.update_listing_prep_content(uuid, uuid, jsonb) from public, anon;
grant execute on function public.update_listing_prep_content(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Preparation confirmations
-- ---------------------------------------------------------------------------

-- A confirmation is a person saying something is true. It records who, so a
-- later dispute has an answer, and it can only name a requirement that this
-- record's category actually has.
create or replace function public.set_listing_prep_check(
  p_workspace_id uuid,
  p_prep_id uuid,
  p_requirement_key text,
  p_state public.listing_prep_check_state,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_prep public.listing_prep%rowtype;
  v_subtype public.inventory_subtype;
  v_prior text;
begin
  v_uid := app.require_listing_prep_writer(p_workspace_id);
  v_prep := app.listing_prep_for_update(p_workspace_id, p_prep_id);

  if v_prep.status in ('listed', 'cancelled') then
    raise exception 'reopen this preparation before changing its confirmations'
      using errcode = '23514';
  end if;

  v_subtype := app.listing_prep_subtype(p_prep_id);
  if not exists (select 1 from public.listing_prep_requirements r
                  where r.subtype = v_subtype and r.requirement_key = p_requirement_key) then
    raise exception 'no such preparation requirement for this category' using errcode = '23514';
  end if;

  select ck.state::text into v_prior from public.listing_prep_checks ck
   where ck.prep_id = p_prep_id and ck.requirement_key = p_requirement_key;

  insert into public.listing_prep_checks
    (workspace_id, prep_id, requirement_key, state, note, confirmed_by, updated_at)
  values (p_workspace_id, p_prep_id, p_requirement_key, p_state,
          nullif(btrim(coalesce(p_note, '')), ''),
          case when p_state = 'unknown' then null else v_uid end, now())
  on conflict (prep_id, requirement_key) do update set
    state = excluded.state,
    note = excluded.note,
    confirmed_by = excluded.confirmed_by,
    updated_at = now();

  perform app.listing_prep_log(p_workspace_id, p_prep_id, 'check_changed', v_uid,
    null, null, nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object('requirement_key', p_requirement_key,
                       'from', coalesce(v_prior, 'unknown'), 'to', p_state));

  if v_prep.status = 'not_started' then
    update public.listing_prep set status = 'in_preparation' where id = p_prep_id;
    perform app.listing_prep_log(p_workspace_id, p_prep_id, 'status_changed', v_uid,
      'not_started', 'in_preparation', 'work started');
  end if;

  return public.get_listing_prep(p_workspace_id, p_prep_id);
end
$$;

revoke all on function public.set_listing_prep_check(
  uuid, uuid, text, public.listing_prep_check_state, text) from public, anon;
grant execute on function public.set_listing_prep_check(
  uuid, uuid, text, public.listing_prep_check_state, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Assignment and priority
-- ---------------------------------------------------------------------------

create or replace function public.assign_listing_prep(
  p_workspace_id uuid, p_prep_id uuid, p_assignee uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_prep public.listing_prep%rowtype;
begin
  v_uid := app.require_listing_prep_writer(p_workspace_id);
  v_prep := app.listing_prep_for_update(p_workspace_id, p_prep_id);

  if p_assignee is not null and app.member_role_of(p_workspace_id, p_assignee) is null then
    raise exception 'the assignee is not a member of this workspace' using errcode = '23514';
  end if;

  update public.listing_prep set assigned_to = p_assignee where id = p_prep_id;

  perform app.listing_prep_log(p_workspace_id, p_prep_id, 'assigned', v_uid, null, null, null,
    jsonb_build_object('from', v_prep.assigned_to, 'to', p_assignee));

  return public.get_listing_prep(p_workspace_id, p_prep_id);
end
$$;

revoke all on function public.assign_listing_prep(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_listing_prep(uuid, uuid, uuid) to authenticated;

create or replace function public.set_listing_prep_priority(
  p_workspace_id uuid, p_prep_id uuid, p_priority public.listing_prep_priority
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_prep public.listing_prep%rowtype;
begin
  v_uid := app.require_listing_prep_writer(p_workspace_id);
  v_prep := app.listing_prep_for_update(p_workspace_id, p_prep_id);

  if p_priority is null then
    raise exception 'a priority is required' using errcode = '23514';
  end if;

  update public.listing_prep set priority = p_priority where id = p_prep_id;

  perform app.listing_prep_log(p_workspace_id, p_prep_id, 'priority_changed', v_uid,
    null, null, null, jsonb_build_object('from', v_prep.priority, 'to', p_priority));

  return public.get_listing_prep(p_workspace_id, p_prep_id);
end
$$;

revoke all on function public.set_listing_prep_priority(
  uuid, uuid, public.listing_prep_priority) from public, anon;
grant execute on function public.set_listing_prep_priority(
  uuid, uuid, public.listing_prep_priority) to authenticated;

-- ---------------------------------------------------------------------------
-- The lifecycle gate
-- ---------------------------------------------------------------------------

-- One function for every status change, so the legal moves are stated once and
-- the history cannot be sidestepped. `listed` is deliberately NOT reachable
-- here: recording that goods were listed needs its own evidence, so it has its
-- own function.
create or replace function public.transition_listing_prep(
  p_workspace_id uuid,
  p_prep_id uuid,
  p_to_status public.listing_prep_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_prep public.listing_prep%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_blockers jsonb;
  v_allowed public.listing_prep_status[];
begin
  -- Authorization depends on where the record is going, so read the target
  -- first and pick the gate accordingly.
  if p_to_status is null then
    raise exception 'a target status is required' using errcode = '23514';
  end if;
  if p_to_status = 'listed' then
    raise exception 'use mark_listing_prep_listed to record a listing' using errcode = '23514';
  end if;

  if p_to_status = 'ready_to_list' then
    v_uid := app.require_listing_prep_owner(p_workspace_id);
  else
    v_uid := app.require_listing_prep_writer(p_workspace_id);
  end if;

  v_prep := app.listing_prep_for_update(p_workspace_id, p_prep_id);

  if v_prep.status = 'listed' and p_to_status <> 'cancelled' then
    -- Undoing a listing is its own decision with its own authority.
    v_uid := app.require_listing_prep_owner(p_workspace_id);
  end if;

  v_allowed := case v_prep.status
    when 'not_started'    then array['in_preparation', 'blocked', 'cancelled']::public.listing_prep_status[]
    when 'in_preparation' then array['needs_review', 'blocked', 'ready_to_list', 'cancelled']::public.listing_prep_status[]
    when 'blocked'        then array['in_preparation', 'needs_review', 'cancelled']::public.listing_prep_status[]
    when 'needs_review'   then array['in_preparation', 'blocked', 'ready_to_list', 'cancelled']::public.listing_prep_status[]
    when 'ready_to_list'  then array['in_preparation', 'needs_review', 'blocked', 'cancelled']::public.listing_prep_status[]
    when 'listed'         then array['in_preparation']::public.listing_prep_status[]
    else array[]::public.listing_prep_status[]
  end;

  if v_prep.status = p_to_status then
    raise exception 'this preparation is already %', p_to_status using errcode = '23514';
  end if;
  if not (p_to_status = any (v_allowed)) then
    raise exception 'a % preparation cannot move to %', v_prep.status, p_to_status
      using errcode = '23514';
  end if;

  if p_to_status = 'blocked' and v_reason is null then
    raise exception 'say why this preparation is blocked' using errcode = '23514';
  end if;

  -- The claim that matters. Readiness is recomputed at the moment of the
  -- decision, not read from anything the client sent or a cache wrote earlier.
  if p_to_status = 'ready_to_list' then
    v_blockers := app.listing_prep_blockers(p_prep_id);
    if jsonb_array_length(v_blockers) > 0 then
      raise exception 'this preparation still has % outstanding blocker(s)',
        jsonb_array_length(v_blockers) using errcode = '23514';
    end if;
  end if;

  update public.listing_prep set
    status = p_to_status,
    blocked_reason = case when p_to_status = 'blocked' then v_reason else null end,
    -- Reopening a listed record clears the listed timestamp; the listing
    -- itself stays in the event history, which is append-only.
    listed_at = case when p_to_status = 'listed' then listed_at else null end
   where id = p_prep_id;

  perform app.listing_prep_log(p_workspace_id, p_prep_id,
    case
      when p_to_status = 'blocked' then 'blocked'
      when v_prep.status = 'blocked' then 'unblocked'
      when v_prep.status = 'listed' then 'reopened'
      else 'status_changed'
    end,
    v_uid, v_prep.status, p_to_status, v_reason,
    case when v_prep.status = 'listed'
      then jsonb_build_object('was_listed_at', v_prep.listed_at,
                              'external_listing_ref', v_prep.external_listing_ref)
      else '{}'::jsonb end);

  return public.get_listing_prep(p_workspace_id, p_prep_id);
end
$$;

revoke all on function public.transition_listing_prep(
  uuid, uuid, public.listing_prep_status, text) from public, anon;
grant execute on function public.transition_listing_prep(
  uuid, uuid, public.listing_prep_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording that it was listed
-- ---------------------------------------------------------------------------

-- This records a fact about the owner's workflow. It publishes nothing, and it
-- deliberately does NOT move, reserve, or decrement stock: inventory leaves on
-- sale, through governed inventory exit, not when a listing is created.
create or replace function public.mark_listing_prep_listed(
  p_workspace_id uuid,
  p_prep_id uuid,
  p_external_listing_ref text,
  p_listed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_prep public.listing_prep%rowtype;
  v_ref text := nullif(btrim(coalesce(p_external_listing_ref, '')), '');
  v_when timestamptz := coalesce(p_listed_at, now());
  v_blockers jsonb;
begin
  v_uid := app.require_listing_prep_owner(p_workspace_id);
  v_prep := app.listing_prep_for_update(p_workspace_id, p_prep_id);

  if v_prep.status <> 'ready_to_list' then
    raise exception 'only a ready-to-list preparation can be recorded as listed'
      using errcode = '23514';
  end if;
  if v_ref is null then
    raise exception 'record where this was listed' using errcode = '23514';
  end if;
  if v_when > now() + interval '1 minute' then
    raise exception 'a listing cannot be recorded in the future' using errcode = '23514';
  end if;

  -- Re-checked here as well: time passes between review and listing, and an
  -- item can be voided or lose a photograph in between.
  v_blockers := app.listing_prep_blockers(p_prep_id);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception 'this preparation is no longer ready: % outstanding blocker(s)',
      jsonb_array_length(v_blockers) using errcode = '23514';
  end if;

  update public.listing_prep set
    status = 'listed', listed_at = v_when, external_listing_ref = v_ref,
    blocked_reason = null
   where id = p_prep_id;

  perform app.listing_prep_log(p_workspace_id, p_prep_id, 'listed', v_uid,
    v_prep.status, 'listed', null,
    jsonb_build_object('external_listing_ref', v_ref, 'listed_at', v_when));

  return public.get_listing_prep(p_workspace_id, p_prep_id);
end
$$;

revoke all on function public.mark_listing_prep_listed(uuid, uuid, text, timestamptz)
  from public, anon;
grant execute on function public.mark_listing_prep_listed(uuid, uuid, text, timestamptz)
  to authenticated;

-- An explicit recompute for the detail workspace's "re-check" action. It
-- returns the same live readiness the view exposes; it exists so the UI has a
-- named operation rather than a bare table read.
create or replace function public.evaluate_listing_prep_readiness(
  p_workspace_id uuid, p_prep_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_row public.listing_prep_readiness%rowtype;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  if not exists (select 1 from public.listing_prep
                  where id = p_prep_id and workspace_id = p_workspace_id) then
    raise exception 'listing preparation not found in this workspace' using errcode = '23514';
  end if;

  select * into v_row from public.listing_prep_readiness where prep_id = p_prep_id;

  return jsonb_build_object(
    'prep_id', v_row.prep_id,
    'readiness_status', v_row.readiness_status,
    'blockers', coalesce(v_row.blockers, '[]'::jsonb),
    'blocker_count', coalesce(v_row.blocker_count, 0),
    'subject_state', v_row.subject_state,
    'subtype', v_row.subtype);
end
$$;

revoke all on function public.evaluate_listing_prep_readiness(uuid, uuid) from public, anon;
grant execute on function public.evaluate_listing_prep_readiness(uuid, uuid) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260801000700_listing_prep_lifecycle');
