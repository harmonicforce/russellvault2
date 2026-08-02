-- Repair: every Listing Prep dashboard tile opens exactly the records it counted.
--
-- Three destinations were wrong.
--
-- 1. "Never started" counted inventory that has NO listing_prep row, using a
--    `not exists` against listing_prep, and then linked to the preparation
--    queue — which is populated exclusively FROM listing_prep rows. The
--    destination could not contain a single record the tile counted.
--
-- 2. The readiness tiles (needs photos, needs owner review, blocked) counted
--    every live preparation, including `ready_to_list` records that had since
--    regressed — a required photograph deleted, a media issue opened, a
--    correction raised. But the links forced the queue tab, whose statuses
--    exclude ready_to_list, so exactly those regressed records inflated the
--    number and were absent from the page.
--
-- 3. "Ready to list" counted raw status. A record can hold `ready_to_list`
--    while a live blocker has since appeared, and showing it as genuinely
--    ready is how something reaches a buyer that should not have.
--
-- The predicate is written ONCE, as a view, and both the summary count and the
-- candidate listing read it. Two copies of a predicate is what produced defect
-- 1 in the first place.
--
-- It is called NO ACTIVE PREPARATION, not "never started". A record whose
-- earlier preparation was listed or cancelled belongs here -- repeat
-- preparation is deliberate: stock comes back, a listing ends, and the record
-- needs preparing again. Calling that "never started" would have been false
-- about the record's own history, and an operator who noticed would rightly
-- stop trusting the tile.
--
-- listing_prep_readiness is recomputed on every read, so `regressed_ready`
-- below is a live fact, not a stored flag. No record's status is mutated to
-- make it appear in a queue: a regressed record keeps `ready_to_list` and the
-- UI says so.

-- ---------------------------------------------------------------------------
-- The one no-active-preparation definition
-- ---------------------------------------------------------------------------

create or replace view public.listing_prep_candidates
with (security_invoker = true) as
select
  o.workspace_id,
  o.record_kind as subject_kind,
  o.record_id as subject_id,
  o.record_public_id,
  o.product_display_name,
  o.detail_line,
  o.inventory_subtype,
  o.quantity,
  o.tracking_mode,
  o.needs_photos,
  o.created_at,
  o.search_text
from public.inventory_record_overview o
 -- Current sellable stock only. inventory_record_overview already excludes
 -- retired items, non-active lots and serialized parent lots; is_available
 -- additionally excludes depleted quantity lots.
where o.is_available
  -- Defensive: a serialized parent lot is not a sellable unit. The overview
  -- does not emit one today, and this makes that independent of it.
  and not (o.record_kind = 'lot' and o.tracking_mode = 'serialized')
  -- No LIVE preparation. A record whose only preparations are listed or
  -- cancelled is available to be prepared again, which is why this is "no
  -- active preparation" rather than "never started".
  and not exists (
    select 1 from public.listing_prep lp
     where lp.workspace_id = o.workspace_id
       and coalesce(lp.item_id, lp.lot_id) = o.record_id
       and lp.status not in ('listed', 'cancelled'));

comment on view public.listing_prep_candidates is
  'Current sellable stock with no live listing preparation. Includes records '
  'whose earlier preparation was listed or cancelled, because repeat '
  'preparation is supported; it is therefore NOT a "never started" population.';

revoke all on public.listing_prep_candidates from public, anon;
grant select on public.listing_prep_candidates to authenticated;

-- ---------------------------------------------------------------------------
-- The summary, now truthful about readiness
-- ---------------------------------------------------------------------------

create or replace function public.get_listing_prep_summary(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_readiness jsonb;
  v_row record;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) into v_status
    from (select p.status::text as status, count(*)::int as n
            from public.listing_prep p
           where p.workspace_id = p_workspace_id
           group by 1) s;

  select coalesce(jsonb_object_agg(r.readiness_status, r.n), '{}'::jsonb) into v_readiness
    from (select rr.readiness_status, count(*)::int as n
            from public.listing_prep_readiness rr
           where rr.workspace_id = p_workspace_id
             and rr.status not in ('listed', 'cancelled')
           group by 1) r;

  select
    count(*) filter (where p.assigned_to is null
                       and p.status not in ('listed', 'cancelled'))::int as unassigned,
    count(*) filter (where p.status = 'listed'
                       and p.listed_at >= now() - interval '7 days')::int as listed_last_7_days,
    -- Both of these read the ONE candidate view, so the tile and the page it
    -- opens cannot describe different populations.
    (select count(*)::int from public.listing_prep_candidates c
      where c.workspace_id = p_workspace_id) as no_active_preparation,
    -- Status says ready; live readiness agrees.
    (select count(*)::int from public.listing_prep_readiness rr
      where rr.workspace_id = p_workspace_id
        and rr.status = 'ready_to_list' and rr.blocker_count = 0) as ready_now,
    -- Status still says ready, but a blocker has appeared since. Counted
    -- separately rather than silently folded into either side.
    (select count(*)::int from public.listing_prep_readiness rr
      where rr.workspace_id = p_workspace_id
        and rr.status = 'ready_to_list' and rr.blocker_count > 0) as regressed_ready
    into v_row
    from public.listing_prep p
   where p.workspace_id = p_workspace_id;

  return jsonb_build_object(
    -- by_status is the raw lifecycle tally and is deliberately unchanged; other
    -- readers depend on it meaning exactly "how many rows hold this status".
    'by_status', v_status,
    'by_readiness', v_readiness,
    'unassigned', coalesce(v_row.unassigned, 0),
    'listed_last_7_days', coalesce(v_row.listed_last_7_days, 0),
    'no_active_preparation', coalesce(v_row.no_active_preparation, 0),
    'ready_now', coalesce(v_row.ready_now, 0),
    'regressed_ready', coalesce(v_row.regressed_ready, 0));
end
$$;

revoke all on function public.get_listing_prep_summary(uuid) from public, anon;
grant execute on function public.get_listing_prep_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The no-active-preparation destination
-- ---------------------------------------------------------------------------

-- The "No active preparation" tab. Reads the same view the count does, so an
-- operator who clicks the tile lands on exactly those records and can start a
-- preparation for any of them -- including a repeat preparation for a record
-- that has been listed before.
create or replace function public.list_listing_prep_candidates(
  p_workspace_id uuid,
  p_search text default null,
  p_subject_kind text default null,
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
    select * from public.listing_prep_candidates c
     where c.workspace_id = p_workspace_id
       and (p_subject_kind is null or c.subject_kind = p_subject_kind)
       and (v_search is null
            or c.record_public_id ilike '%' || v_search || '%'
            or coalesce(c.search_text, '') ilike '%' || v_search || '%')
  ),
  counted as (select count(*)::int as n from matched),
  page as (
    -- Batch intake shares one timestamp, so the page window needs a unique
    -- tie-breaker or repeated loads can return different rows.
    select * from matched
     order by created_at, subject_kind, subject_id
     limit v_limit offset v_offset
  )
  select (select n from counted),
         coalesce(jsonb_agg(jsonb_build_object(
           'subject_kind', page.subject_kind,
           'subject_id', page.subject_id,
           'public_id', page.record_public_id,
           'display_name', page.product_display_name,
           'detail_line', page.detail_line,
           'subtype', page.inventory_subtype,
           'quantity', page.quantity,
           'tracking_mode', page.tracking_mode,
           'needs_photos', page.needs_photos,
           'created_at', page.created_at)), '[]'::jsonb)
    into v_total, v_rows
    from page;

  return jsonb_build_object(
    'total', coalesce(v_total, 0), 'limit', v_limit, 'offset', v_offset,
    'rows', v_rows);
end
$$;

revoke all on function public.list_listing_prep_candidates(uuid, text, text, integer, integer)
  from public, anon;
grant execute on function public.list_listing_prep_candidates(uuid, text, text, integer, integer)
  to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260802000300_listing_prep_candidates');
