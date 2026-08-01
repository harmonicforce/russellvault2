-- Listing Prep Command Center — migration 2: readiness and reads.
--
-- Readiness is expressed as a VIEW rather than a column the application keeps
-- up to date. That is a deliberate correctness choice: a stored readiness flag
-- goes stale the moment somebody voids the item, deletes a photograph, or
-- opens a correction request, and every one of those happens through a
-- different feature that has no reason to know Listing Prep exists. Computing
-- it live means a record can never advertise itself as listable after the fact
-- that made it listable stopped being true.
--
-- The output is a blocker LIST, not a badge. "Not ready" is useless to the
-- owner; "the size tag photo is missing and nobody has confirmed the
-- measurements" is a morning's work described.

-- ---------------------------------------------------------------------------
-- Readiness
-- ---------------------------------------------------------------------------

create or replace view public.listing_prep_readiness
with (security_invoker = true) as
-- The inventory facts come from the existing unified record read model rather
-- than being re-derived here. Listing Prep must not become a second opinion
-- about what an item is or whether it still exists.
with prep as (
  select
    p.id,
    p.workspace_id,
    p.status,
    p.subject_kind,
    coalesce(p.item_id, p.lot_id) as subject_id,
    p.working_title,
    p.condition_summary,
    p.asking_price_minor,
    p.currency,
    p.quantity_to_list,
    p.package_weight_grams,
    p.package_length_mm,
    p.package_width_mm,
    p.package_height_mm,
    o.inventory_subtype as subtype,
    o.record_state as subject_state,
    o.open_correction_count
  from public.listing_prep p
  left join public.inventory_record_overview o
    on o.workspace_id = p.workspace_id
   and o.record_kind = p.subject_kind
   and o.record_id = coalesce(p.item_id, p.lot_id)
),
-- Whether this category expects package details or a stated quantity at all.
-- Asking for a box size on a category whose matrix never mentions one would be
-- inventing policy, so the content requirements follow the same matrix as the
-- confirmations.
expectations as (
  select
    p.id,
    exists (select 1 from public.listing_prep_requirements r
             where r.subtype = p.subtype and r.is_required
               and r.requirement_kind = 'package') as expects_package,
    exists (select 1 from public.listing_prep_requirements r
             where r.subtype = p.subtype and r.is_required
               and r.requirement_kind = 'price') as expects_price
  from prep p
),
blockers as (
  select p.id as prep_id, b.rank, b.code, b.kind, b.label
  from prep p
  join expectations e on e.id = p.id
  cross join lateral (
    -- 1. Stock that cannot be sold ------------------------------------------
    -- Nothing below matters if the goods are gone. A voided, lost, superseded
    -- or absorbed record can never be ready however complete its paperwork is.
    select 1 as rank, 'subject_not_sellable' as code, 'lifecycle' as kind,
           'This record is ' || p.subject_state || ' and cannot be listed' as label
     where p.subject_state in ('void', 'lost', 'superseded', 'absorbed')

    union all
    -- The inventory record behind this preparation is no longer visible. Never
    -- silently treated as "nothing left to do".
    select 1, 'subject_unavailable', 'lifecycle',
           'The inventory record for this preparation could not be read'
     where p.subject_state is null

    union all
    -- An open correction means somebody has said the record is wrong. Listing
    -- it while that is unresolved is how a disputed claim reaches a buyer.
    select 1, 'open_correction_request', 'lifecycle',
           'An open correction request must be resolved before listing'
     where coalesce(p.open_correction_count, 0) > 0

    union all
    -- 2. Photographs — delegated entirely to the media matrix ---------------
    select 2, 'photos_' || mr.readiness_status, 'photos',
           case mr.readiness_status
             when 'missing_required_angle'  then 'Required photographs are missing'
             when 'missing_defect_photo'    then 'A condition photograph is still required'
             when 'upload_incomplete'       then 'A photo upload has not finished'
             when 'media_review_needed'     then 'A photo issue is waiting for review'
             else 'Photographs are incomplete'
           end
      from public.inventory_media_readiness mr
     where mr.workspace_id = p.workspace_id
       and mr.subject_kind = p.subject_kind
       and mr.subject_id = p.subject_id
       and mr.readiness_status <> 'complete'

    union all
    -- 3. A record nobody has classified cannot be prepared -------------------
    -- The matrix for `unclassified` says only "classify this first", and no
    -- confirmation can substitute for actually knowing what the thing is.
    select 3, 'unclassified_record', 'identity',
           'This record has not been classified yet'
     where p.subtype = 'unclassified'

    union all
    -- 4. Category preparation facts a person has to confirm ------------------
    -- This is the clause that stops readiness meaning "the columns are not
    -- null". Absence of an answer is `unknown`, and `unknown` blocks.
    select
      case r.requirement_kind
        when 'identity' then 3
        when 'condition' then 4
        when 'disclosure' then 4
        when 'functionality' then 4
        when 'accessories' then 4
        when 'measurements' then 5
        when 'quantity' then 6
        when 'package' then 7
        when 'price' then 8
      end,
      'check_' || r.requirement_key, r.requirement_kind::text, r.label
      from public.listing_prep_requirements r
      left join public.listing_prep_checks ck
        on ck.prep_id = p.id and ck.requirement_key = r.requirement_key
     where r.subtype = p.subtype
       and r.is_required
       and coalesce(ck.state, 'unknown') = 'unknown'

    union all
    -- 5. Quantity, for quantity-managed stock only ---------------------------
    select 6, 'missing_quantity_to_list', 'quantity',
           'Say how many units this listing covers'
     where p.subject_kind = 'lot'
       and (p.quantity_to_list is null or p.quantity_to_list < 1)

    union all
    -- 6. Package details -----------------------------------------------------
    select 7, 'missing_package_details', 'package',
           'Package weight and dimensions are required'
     where e.expects_package
       and (p.package_weight_grams is null or p.package_length_mm is null
            or p.package_width_mm is null or p.package_height_mm is null)

    union all
    -- 7. Price ---------------------------------------------------------------
    select 8, 'missing_asking_price', 'price', 'An asking price is required'
     where e.expects_price
       and (p.asking_price_minor is null or p.currency is null)

    union all
    -- 8. The words that will appear in the listing ---------------------------
    -- Never generated from inventory facts. A marketplace claim is written by
    -- a person or it is not written.
    select 9, 'missing_working_title', 'content', 'A working title is required'
     where p.working_title is null or btrim(p.working_title) = ''

    union all
    select 9, 'missing_condition_summary', 'content',
           'A condition summary is required'
     where p.condition_summary is null or btrim(p.condition_summary) = ''
  ) b
)
select
  p.workspace_id,
  p.id as prep_id,
  p.subject_kind,
  p.subject_id,
  p.subtype,
  p.subject_state,
  p.status,
  coalesce(
    jsonb_agg(jsonb_build_object('code', b.code, 'kind', b.kind, 'label', b.label)
              order by b.rank, b.code)
      filter (where b.code is not null),
    '[]'::jsonb) as blockers,
  count(b.code)::int as blocker_count,
  case
    when min(b.rank) is null then
      -- Nothing outstanding. A record parked in `needs_review` is still
      -- waiting on the owner's decision rather than on more work.
      case when p.status = 'needs_review' then 'needs_owner_review' else 'ready' end
    when min(b.rank) = 1 then 'blocked'
    when min(b.rank) = 2 then 'needs_photos'
    when min(b.rank) = 3 then 'needs_identity_review'
    when min(b.rank) = 4 then 'needs_condition_review'
    when min(b.rank) = 5 then 'needs_measurements'
    when min(b.rank) = 6 then 'needs_quantity'
    when min(b.rank) = 7 then 'needs_package_details'
    when min(b.rank) = 8 then 'needs_price'
    else 'needs_content'
  end as readiness_status
from prep p
left join blockers b on b.prep_id = p.id
group by p.workspace_id, p.id, p.subject_kind, p.subject_id, p.subtype,
         p.subject_state, p.status;

revoke all on public.listing_prep_readiness from public, anon;
grant select on public.listing_prep_readiness to authenticated;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function app.require_listing_prep_writer(p_workspace_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role public.workspace_role;
begin
  v_uid := app.require_uid();
  v_role := app.member_role(p_workspace_id);
  if v_role is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  if v_role not in ('operator', 'owner') then
    raise exception 'a viewer cannot change listing preparation' using errcode = '42501';
  end if;
  return v_uid;
end
$$;

revoke all on function app.require_listing_prep_writer(uuid) from public, anon;
grant execute on function app.require_listing_prep_writer(uuid) to authenticated;

-- The final review gate. Deciding that goods are fit to sell, and recording
-- that they were listed, is the owner's call and nobody else's.
create or replace function app.require_listing_prep_owner(p_workspace_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := app.require_uid();
  if app.member_role(p_workspace_id) is distinct from 'owner' then
    raise exception 'owner authority required for listing review' using errcode = '42501';
  end if;
  return v_uid;
end
$$;

revoke all on function app.require_listing_prep_owner(uuid) from public, anon;
grant execute on function app.require_listing_prep_owner(uuid) to authenticated;

-- The role of somebody OTHER than the caller, used to reject an assignment to
-- a person who is not in the workspace. Definer because a caller cannot read
-- another member's row directly under RLS.
create or replace function app.member_role_of(p_workspace_id uuid, p_user_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = p_workspace_id
    and m.user_id = p_user_id
$$;

revoke all on function app.member_role_of(uuid, uuid) from public, anon, authenticated;

create or replace function app.listing_prep_log(
  p_workspace_id uuid, p_prep_id uuid, p_event text, p_actor uuid,
  p_from public.listing_prep_status default null,
  p_to public.listing_prep_status default null,
  p_reason text default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.listing_prep_events
    (workspace_id, prep_id, event_type, from_status, to_status, actor_id, reason, detail)
  values (p_workspace_id, p_prep_id, p_event, p_from, p_to, p_actor, p_reason,
          coalesce(p_detail, '{}'::jsonb))
$$;

revoke all on function app.listing_prep_log(
  uuid, uuid, text, uuid, public.listing_prep_status, public.listing_prep_status, text, jsonb)
  from public, anon, authenticated;

-- The category that governs a preparation record's checklist.
create or replace function app.listing_prep_subtype(p_prep_id uuid)
returns public.inventory_subtype
language sql
stable
security definer
set search_path = ''
as $$
  select case p.subject_kind
    when 'item' then (select sk.inventory_subtype from public.inventory_items i
                        join public.sellable_skus sk on sk.id = i.sku_id
                       where i.id = p.item_id)
    else (select sk.inventory_subtype from public.inventory_lots l
            join public.sellable_skus sk on sk.id = l.sku_id
           where l.id = p.lot_id)
  end
  from public.listing_prep p
  where p.id = p_prep_id
$$;

revoke all on function app.listing_prep_subtype(uuid) from public, anon;
grant execute on function app.listing_prep_subtype(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- One preparation record with everything the detail workspace needs: the
-- inventory identity it hangs off, the live blocker list, the checklist with
-- its confirmations, and the history.
create or replace function public.get_listing_prep(
  p_workspace_id uuid, p_prep_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prep public.listing_prep%rowtype;
  v_readiness public.listing_prep_readiness%rowtype;
  v_subtype public.inventory_subtype;
  v_checks jsonb;
  v_events jsonb;
  v_identity jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select * into v_prep from public.listing_prep
   where id = p_prep_id and workspace_id = p_workspace_id;
  if v_prep.id is null then
    raise exception 'listing preparation not found in this workspace' using errcode = '23514';
  end if;

  select * into v_readiness from public.listing_prep_readiness
   where prep_id = p_prep_id;
  v_subtype := v_readiness.subtype;

  -- The checklist is the matrix, left-joined onto what has been confirmed, so
  -- a requirement nobody has touched still appears rather than going missing.
  select coalesce(jsonb_agg(jsonb_build_object(
           'requirement_key', r.requirement_key,
           'label', r.label,
           'requirement_kind', r.requirement_kind,
           'is_required', r.is_required,
           'display_order', r.display_order,
           'state', coalesce(ck.state::text, 'unknown'),
           'note', ck.note,
           'confirmed_by', ck.confirmed_by,
           'updated_at', ck.updated_at
         ) order by r.display_order, r.requirement_key), '[]'::jsonb)
    into v_checks
    from public.listing_prep_requirements r
    left join public.listing_prep_checks ck
      on ck.prep_id = p_prep_id and ck.requirement_key = r.requirement_key
   where r.subtype = v_subtype;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'event_type', e.event_type,
           'from_status', e.from_status, 'to_status', e.to_status,
           'actor_id', e.actor_id, 'reason', e.reason,
           'detail', e.detail, 'created_at', e.created_at
         ) order by e.created_at desc), '[]'::jsonb)
    into v_events
    from public.listing_prep_events e
   where e.prep_id = p_prep_id;

  -- Owner-facing identity, taken from the shared inventory read model. Public
  -- ids and human labels only: no raw UUID ever has to be read or typed by the
  -- person doing the work.
  select jsonb_build_object(
           'public_id', o.record_public_id,
           'display_name', o.product_display_name,
           'detail_line', o.detail_line,
           'subtype', o.inventory_subtype,
           'record_state', o.record_state,
           'is_available', o.is_available,
           'quantity', o.quantity,
           'tracking_mode', o.tracking_mode,
           'condition_or_grade', o.condition_or_grade,
           'grading_company', o.grading_company,
           'scan_identifier', o.scan_identifier,
           'location_code', o.location_code,
           'location_display_name', o.location_display_name,
           'open_correction_count', o.open_correction_count,
           'media_count', o.media_count)
    into v_identity
    from public.inventory_record_overview o
   where o.workspace_id = p_workspace_id
     and o.record_kind = v_prep.subject_kind
     and o.record_id = coalesce(v_prep.item_id, v_prep.lot_id);

  return jsonb_build_object(
    'id', v_prep.id,
    'public_id', v_prep.public_id,
    'workspace_id', v_prep.workspace_id,
    'subject_kind', v_prep.subject_kind,
    'subject_id', coalesce(v_prep.item_id, v_prep.lot_id),
    'subtype', v_subtype,
    'status', v_prep.status,
    'priority', v_prep.priority,
    'assigned_to', v_prep.assigned_to,
    'owner_notes', v_prep.owner_notes,
    'blocked_reason', v_prep.blocked_reason,
    'content', jsonb_build_object(
      'working_title', v_prep.working_title,
      'condition_summary', v_prep.condition_summary,
      'description_notes', v_prep.description_notes,
      'defects_disclosures', v_prep.defects_disclosures,
      'included_items', v_prep.included_items,
      'research_notes', v_prep.research_notes,
      'listing_format', v_prep.listing_format,
      'quantity_to_list', v_prep.quantity_to_list,
      'currency', v_prep.currency,
      'asking_price_minor', v_prep.asking_price_minor,
      'minimum_price_minor', v_prep.minimum_price_minor,
      'shipping_policy_ref', v_prep.shipping_policy_ref,
      'return_policy_ref', v_prep.return_policy_ref,
      'package_weight_grams', v_prep.package_weight_grams,
      'package_length_mm', v_prep.package_length_mm,
      'package_width_mm', v_prep.package_width_mm,
      'package_height_mm', v_prep.package_height_mm),
    'listed_at', v_prep.listed_at,
    'external_listing_ref', v_prep.external_listing_ref,
    'readiness_status', v_readiness.readiness_status,
    'blockers', coalesce(v_readiness.blockers, '[]'::jsonb),
    'subject_state', v_readiness.subject_state,
    'identity', coalesce(v_identity, '{}'::jsonb),
    'checks', v_checks,
    'events', v_events,
    'created_at', v_prep.created_at,
    'updated_at', v_prep.updated_at);
end
$$;

revoke all on function public.get_listing_prep(uuid, uuid) from public, anon;
grant execute on function public.get_listing_prep(uuid, uuid) to authenticated;

-- Find the preparation record for an inventory subject, if there is a live
-- one. This is how Item and Lot detail pages offer "prepare for listing"
-- versus "open the preparation" without the client guessing.
create or replace function public.get_listing_prep_for_subject(
  p_workspace_id uuid, p_subject_kind text, p_subject_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select p.id into v_id
    from public.listing_prep p
   where p.workspace_id = p_workspace_id
     and p.subject_kind = p_subject_kind
     and coalesce(p.item_id, p.lot_id) = p_subject_id
     and p.status not in ('listed', 'cancelled')
   limit 1;

  if v_id is null then
    return jsonb_build_object('exists', false);
  end if;
  return jsonb_build_object('exists', true, 'prep', public.get_listing_prep(p_workspace_id, v_id));
end
$$;

revoke all on function public.get_listing_prep_for_subject(uuid, text, uuid) from public, anon;
grant execute on function public.get_listing_prep_for_subject(uuid, text, uuid) to authenticated;

-- The queue. Filtered on authoritative columns and on live readiness, then
-- paginated — never filtered after pagination, which would silently drop rows
-- the owner asked to see.
create or replace function public.list_listing_prep_queue(
  p_workspace_id uuid,
  p_statuses text[] default null,
  p_readiness text[] default null,
  p_subtypes text[] default null,
  p_priorities text[] default null,
  p_assigned_to uuid default null,
  p_unassigned_only boolean default false,
  p_subject_kind text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_total integer;
  v_rows jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  with matched as (
    select p.id, p.public_id, p.status, p.priority, p.assigned_to, p.subject_kind,
           p.working_title, p.created_at, p.updated_at, p.listed_at,
           p.external_listing_ref, p.blocked_reason,
           p.asking_price_minor, p.currency,
           r.readiness_status, r.blockers, r.blocker_count, r.subtype, r.subject_state,
           coalesce(p.item_id, p.lot_id) as subject_id,
           o.record_public_id as subject_public_id,
           o.product_display_name as display_name,
           o.detail_line,
           o.search_text
      from public.listing_prep p
      join public.listing_prep_readiness r on r.prep_id = p.id
      left join public.inventory_record_overview o
        on o.workspace_id = p.workspace_id
       and o.record_kind = p.subject_kind
       and o.record_id = coalesce(p.item_id, p.lot_id)
     where p.workspace_id = p_workspace_id
       and (p_statuses is null or p.status::text = any (p_statuses))
       and (p_readiness is null or r.readiness_status = any (p_readiness))
       and (p_subtypes is null or r.subtype::text = any (p_subtypes))
       and (p_priorities is null or p.priority::text = any (p_priorities))
       and (p_assigned_to is null or p.assigned_to = p_assigned_to)
       and (not coalesce(p_unassigned_only, false) or p.assigned_to is null)
       and (p_subject_kind is null or p.subject_kind = p_subject_kind)
  ),
  searched as (
    select * from matched m
     where v_search is null
        or m.public_id ilike '%' || v_search || '%'
        or coalesce(m.working_title, '') ilike '%' || v_search || '%'
        or coalesce(m.search_text, '') ilike '%' || v_search || '%'
  ),
  counted as (select count(*)::int as n from searched),
  page as (
    select * from searched
     order by case priority when 'urgent' then 0 when 'high' then 1
                            when 'normal' then 2 else 3 end,
              created_at
     limit v_limit offset v_offset
  )
  select (select n from counted),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', page.id, 'public_id', page.public_id,
           'status', page.status, 'priority', page.priority,
           'assigned_to', page.assigned_to,
           'subject_kind', page.subject_kind, 'subject_id', page.subject_id,
           'subject_public_id', page.subject_public_id,
           'display_name', page.display_name,
           'detail_line', page.detail_line,
           'subtype', page.subtype, 'subject_state', page.subject_state,
           'working_title', page.working_title,
           'readiness_status', page.readiness_status,
           'blockers', page.blockers, 'blocker_count', page.blocker_count,
           'asking_price_minor', page.asking_price_minor, 'currency', page.currency,
           'blocked_reason', page.blocked_reason,
           'listed_at', page.listed_at, 'external_listing_ref', page.external_listing_ref,
           'created_at', page.created_at, 'updated_at', page.updated_at)), '[]'::jsonb)
    into v_total, v_rows
    from page;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'rows', v_rows);
end
$$;

revoke all on function public.list_listing_prep_queue(
  uuid, text[], text[], text[], text[], uuid, boolean, text, text, integer, integer)
  from public, anon;
grant execute on function public.list_listing_prep_queue(
  uuid, text[], text[], text[], text[], uuid, boolean, text, text, integer, integer)
  to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260801000600_listing_prep_readiness');
