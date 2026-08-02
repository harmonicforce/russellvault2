-- Repair: operational media backlogs describe CURRENT stock only, and the
-- dashboard's photo totals are exact.
--
-- Two defects, one cause.
--
-- 1. `inventory_media_readiness` builds its subject set from every row in
--    inventory_items and inventory_lots with no lifecycle, state or quantity
--    predicate. That is correct for the view's original job — a record's detail
--    page must still resolve its photo readiness after the record is voided —
--    but reusing it as an operational backlog means a workspace's voided,
--    lost, superseded, absorbed and depleted records appear as photo work
--    forever.
--
-- 2. The dashboard showed `missing_required_angle` and linked it to Current
--    Inventory's no-active-photo filter. Those are different populations: a
--    record can hold a front photograph and still be missing its back, its
--    label, or its condition shot. The number and its destination disagreed by
--    construction.
--
-- The base view is deliberately NOT narrowed. `get_inventory_media_readiness`
-- answers for one named subject including retired ones, and
-- `listing_prep_readiness` consumes it; narrowing it would break both. A
-- current-stock view is layered on top instead.
--
-- Current stock is defined by `inventory_record_overview`, which already
-- excludes voided/lost/superseded items, non-active and absorbed lots, and
-- serialized parent lots; `is_available` additionally excludes depleted
-- quantity lots. Reusing it means "current" cannot drift away from what
-- Current Inventory shows.

create or replace view public.inventory_media_readiness_current
with (security_invoker = true) as
select r.*
  from public.inventory_media_readiness r
  join public.inventory_record_overview o
    on o.workspace_id = r.workspace_id
   and o.record_kind = r.subject_kind
   and o.record_id = r.subject_id
 where o.is_available;

revoke all on public.inventory_media_readiness_current from public, anon;
grant select on public.inventory_media_readiness_current to authenticated;

-- ---------------------------------------------------------------------------
-- The Workbench/dashboard summary now describes current stock
-- ---------------------------------------------------------------------------

create or replace function public.get_media_readiness_summary(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare v_counts jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(readiness_status, subject_count), '{}'::jsonb)
    into v_counts
    from (
      select readiness_status, count(*)::int as subject_count
        from public.inventory_media_readiness_current
       where workspace_id = p_workspace_id
       group by readiness_status
    ) grouped;

  return jsonb_build_object(
    'counts', v_counts,
    'open_issue_count', (select count(*)::int from public.inventory_media_issues
                          where workspace_id = p_workspace_id and state = 'open'));
end
$$;

revoke all on function public.get_media_readiness_summary(uuid) from public, anon;
grant execute on function public.get_media_readiness_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Exact photo backlog totals
-- ---------------------------------------------------------------------------

-- The dashboard needs two different, both-exact numbers:
--
--   no_active_photo        records with no live photograph at all
--   missing_required_angle records that have one but still owe a required angle
--
-- They are counted here rather than derived from the Today's Work endpoint,
-- which is capped at twenty candidates and would silently understate any real
-- backlog. `no_active_photo` counts inventory_work_queue, so it is by
-- construction the same population the "needs photos" drill-down opens.
create or replace function public.get_operations_media_backlog(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_counts jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(readiness_status, subject_count), '{}'::jsonb)
    into v_counts
    from (
      select readiness_status, count(*)::int as subject_count
        from public.inventory_media_readiness_current
       where workspace_id = p_workspace_id
       group by readiness_status
    ) grouped;

  return jsonb_build_object(
    'no_active_photo', (select count(*)::int from public.inventory_work_queue q
                         where q.workspace_id = p_workspace_id and q.needs_photos),
    'by_readiness', v_counts,
    'open_issue_count', (select count(*)::int from public.inventory_media_issues
                          where workspace_id = p_workspace_id and state = 'open'));
end
$$;

revoke all on function public.get_operations_media_backlog(uuid) from public, anon;
grant execute on function public.get_operations_media_backlog(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The readiness drill-down
-- ---------------------------------------------------------------------------

-- The destination for "missing required angles". Returns exactly the current
-- records counted above, with the outstanding angle names, so the operator sees
-- which photograph each record still owes.
create or replace function public.list_current_media_readiness(
  p_workspace_id uuid,
  p_statuses text[] default null,
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
  v_total integer;
  v_rows jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  with matched as (
    select r.subject_kind, r.subject_id, r.subtype, r.readiness_status,
           r.active_count, r.reserved_count, r.open_issue_count,
           r.missing_required_angles, r.missing_required_defect_photos,
           o.record_public_id, o.product_display_name, o.detail_line, o.created_at
      from public.inventory_media_readiness_current r
      join public.inventory_record_overview o
        on o.workspace_id = r.workspace_id
       and o.record_kind = r.subject_kind
       and o.record_id = r.subject_id
     where r.workspace_id = p_workspace_id
       and (p_statuses is null or r.readiness_status = any (p_statuses))
  ),
  counted as (select count(*)::int as n from matched),
  page as (
    -- created_at alone is not a total order under batch intake, so the page
    -- window carries a unique tie-breaker.
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
           'subtype', page.subtype,
           'readiness_status', page.readiness_status,
           'active_count', page.active_count,
           'reserved_count', page.reserved_count,
           'open_issue_count', page.open_issue_count,
           'missing_required_angles', to_jsonb(page.missing_required_angles),
           'missing_required_defect_photos', to_jsonb(page.missing_required_defect_photos)
         )), '[]'::jsonb)
    into v_total, v_rows
    from page;

  return jsonb_build_object(
    'total', coalesce(v_total, 0), 'limit', v_limit, 'offset', v_offset,
    'rows', v_rows);
end
$$;

revoke all on function public.list_current_media_readiness(uuid, text[], integer, integer)
  from public, anon;
grant execute on function public.list_current_media_readiness(uuid, text[], integer, integer)
  to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260802000200_current_media_readiness');
