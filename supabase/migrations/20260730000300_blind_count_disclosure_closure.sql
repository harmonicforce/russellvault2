-- Phase A closure: the blind-count disclosure boundary, and the grant-drift
-- class it exposed.
--
-- 20260730000100 closed the obvious half of the blind-count leak: the frozen
-- expected quantity and the copied variance were readable straight out of
-- cycle_count_expected_lots and cycle_count_lot_observations. Auditing the whole
-- disclosure path afterwards found two more things.
--
-- === 1. The recount round was not blind ===
--
-- A blind count reaches review, discrepancies are written carrying
-- expected_quantity and observed_quantity, and `authenticated` holds table-wide
-- SELECT on cycle_count_discrepancies. A reviewer then requests a recount, which
-- returns the SESSION to in_progress while blind_count is still true — and the
-- person now counting can read the expected quantity out of the discrepancy row
-- for the very lot they are being asked to recount.
--
-- That is the round where blindness matters most. A recount exists to obtain an
-- independent second observation; an observation made while looking at the
-- number it is supposed to confirm is not independent, and the disagreement a
-- recount is meant to settle silently stops being detectable.
--
-- Same treatment as the snapshot columns: the quantity columns leave the client
-- grant, and the only path to them is cycle_count_review, which now withholds
-- them for exactly as long as app.cycle_count_quantities_withheld says so.
-- cycle_count_resolutions.expected_value / observed_value are gated for the same
-- reason — they are copies of the same two numbers.
--
-- The cost is deliberate and small: while a blind count is mid-recount, the
-- review screen shows the disagreement without the figures. They reappear the
-- moment the recount is submitted. Withholding a number from the reviewer for
-- the length of a recount is the price of the recount being worth anything.
--
-- === 2. Six more views carried inert write grants ===
--
-- A hosted Supabase project ships with
--   alter default privileges in schema public grant all on tables to authenticated
-- so every table AND VIEW created afterwards starts with the full privilege set,
-- and a migration that revokes only from `public, anon` leaves the rest behind.
-- 20260730000200 fixed the two cycle-count views. Inspecting the live project
-- for the same pattern found six more read models with INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES and TRIGGER granted to `authenticated`:
--
--   inventory_correction_overview, inventory_item_overview,
--   inventory_lot_lineage_view, inventory_lot_overview,
--   inventory_record_overview, inventory_work_queue
--
-- All eight are non-auto-updatable (aggregates, DISTINCT, or UNION ALL) and none
-- has an INSTEAD OF trigger, so PostgreSQL refuses DML against them whatever the
-- grant says. The exposure is latent, not active, and no write was ever possible
-- through them. Corrected anyway: a boundary that holds only because of an
-- unrelated property of the object is not a boundary, and the next read model
-- someone writes as a simple single-table view would be auto-updatable and would
-- inherit the same grants.
--
-- NOT fixed here, because it is not drift: twelve base tables from the Phase 2
-- intake schema (workspaces, workspace_members, sessions, items, photos,
-- photo_requirements, intake_groups, field_registry, field_rules,
-- reference_lists, reference_options, inventory_media) hold INSERT/UPDATE/DELETE
-- for `authenticated` AND carry matching per-command RLS policies. Those grants
-- are the intake shadow schema's designed direct-write path, authorized by
-- policy rather than by function. They are left exactly as they are.

-- ===========================================================================
-- 1. Blind-count quantities leave the client grant
-- ===========================================================================
-- Every other column stays readable: the discrepancy queue, its statuses, its
-- subjects and its timestamps are all still directly selectable, and
-- cycle_count_session_overview keeps working because it only counts rows.

revoke select on table public.cycle_count_discrepancies from authenticated;
grant select (
  id, session_id, workspace_id, public_id, discrepancy_kind, status,
  expected_item_id, expected_lot_id, item_id, lot_id,
  expected_location_id, observed_location_id,
  detected_at, recount_requested_at, recount_requested_by,
  resolved_at, resolved_by, deferral_reason
) on table public.cycle_count_discrepancies to authenticated;

revoke select on table public.cycle_count_resolutions from authenticated;
grant select (
  id, session_id, workspace_id, discrepancy_id, action, note,
  movement_id, adjustment_id, affected_item_id, affected_lot_id,
  succeeded, failure_detail, resolved_by, resolved_at
) on table public.cycle_count_resolutions to authenticated;

-- ===========================================================================
-- 2. The review function decides disclosure
-- ===========================================================================
-- Identical to 20260730000100's version except that the four quantity fields —
-- the discrepancy's expected and observed quantity, its derived variance, and
-- the per-observation lot figures — are withheld while the session is blind and
-- being counted, and the payload says so.
create or replace function public.cycle_count_review(
  p_workspace_id uuid,
  p_session_id uuid,
  p_kinds public.cycle_count_discrepancy_kind[] default null,
  p_statuses public.cycle_count_discrepancy_status[] default null,
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
  v_limit integer;
  v_offset integer;
  v_withheld boolean;
  v_total bigint;
  v_rows jsonb;
begin
  perform app.cycle_count_require_member(p_workspace_id);
  if not exists (select 1 from public.cycle_count_sessions
                 where id = p_session_id and workspace_id = p_workspace_id) then
    raise exception 'that cycle count is not in this workspace' using errcode = '23514';
  end if;
  v_limit := app.cycle_count_page_limit(p_limit);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_withheld := app.cycle_count_quantities_withheld(p_session_id);

  with filtered as (
    select d.*
    from public.cycle_count_discrepancies d
    where d.session_id = p_session_id
      and (p_kinds is null or d.discrepancy_kind = any (p_kinds))
      and (p_statuses is null or d.status = any (p_statuses))
  )
  select
    (select count(*) from filtered),
    coalesce(jsonb_agg(to_jsonb(page) order by page.discrepancy_kind, page.detected_at), '[]'::jsonb)
  into v_total, v_rows
  from (
    select
      d.id as discrepancy_id, d.public_id, d.discrepancy_kind, d.status,
      case when v_withheld then null else d.expected_quantity end as expected_quantity,
      case when v_withheld then null else d.observed_quantity end as observed_quantity,
      case when v_withheld then null
           else coalesce(d.observed_quantity, 0) - coalesce(d.expected_quantity, 0) end as variance,
      d.detected_at, d.recount_requested_at, d.resolved_at, d.deferral_reason,
      recounter.email as recount_requested_by_email,
      resolver.email as resolved_by_email,
      coalesce(ei.item_public_id, el.lot_public_id, it.public_id) as subject_public_id,
      coalesce(ei.display_name, el.display_name, 'Unknown record') as subject_display_name,
      case when d.lot_id is not null then 'lot' else 'item' end as subject_kind,
      d.item_id, d.lot_id,
      ei.certificate_number, ei.serial_number, ei.grading_company,
      exp_loc.location_code as expected_location_code,
      obs_loc.location_code as observed_location_code,
      -- Every round, not just the current one: a recount is only meaningful
      -- next to the count it disagrees with.
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'observation_id', o.id, 'count_round', o.count_round,
          'outcome', o.observation_kind::text, 'observed_at', o.observed_at,
          'observed_by_email', oa.email, 'note', o.note,
          'raw_identifier', o.raw_identifier,
          'observed_location_code', ol.location_code,
          'voided_at', o.voided_at, 'void_reason', o.void_reason)
          order by o.count_round, o.observed_at)
        from public.cycle_count_item_observations o
        left join auth.users oa on oa.id = o.observed_by
        left join public.storage_locations ol on ol.id = o.observed_location_id
        where o.session_id = d.session_id and d.item_id is not null and o.item_id = d.item_id
      ), '[]'::jsonb) || coalesce((
        select jsonb_agg(jsonb_build_object(
          'observation_id', o.id, 'count_round', o.count_round,
          -- 'saved' rather than short/over while withheld: the word alone
          -- hands back the sign of the variance.
          'outcome', case when v_withheld then 'saved'
                          when o.variance = 0 then 'matched'
                          when o.variance < 0 then 'short' else 'over' end,
          'observed_at', o.observed_at, 'observed_by_email', oa.email,
          'note', o.note, 'observed_quantity', o.observed_quantity,
          'expected_quantity', case when v_withheld then null else o.expected_quantity end,
          'variance', case when v_withheld then null else o.variance end,
          'voided_at', o.voided_at, 'void_reason', o.void_reason)
          order by o.count_round, o.observed_at)
        from public.cycle_count_lot_observations o
        left join auth.users oa on oa.id = o.observed_by
        where o.session_id = d.session_id and d.lot_id is not null and o.lot_id = d.lot_id
      ), '[]'::jsonb) as observations,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'activity_kind', a.activity_kind, 'activity_public_id', a.activity_public_id,
          'occurred_at', a.occurred_at, 'detail', a.detail,
          'from_value', a.from_value, 'to_value', a.to_value)
          order by a.occurred_at)
        from public.cycle_count_post_snapshot_activity a
        where a.discrepancy_id = d.id
      ), '[]'::jsonb) as post_snapshot_activity,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'resolution_id', r.id, 'action', r.action::text, 'note', r.note,
          'succeeded', r.succeeded, 'failure_detail', r.failure_detail,
          'resolved_at', r.resolved_at, 'resolved_by_email', ra.email,
          'movement_id', r.movement_id, 'adjustment_id', r.adjustment_id)
          order by r.resolved_at)
        from public.cycle_count_resolutions r
        left join auth.users ra on ra.id = r.resolved_by
        where r.discrepancy_id = d.id
      ), '[]'::jsonb) as resolutions
    from filtered d
    left join public.cycle_count_expected_items ei on ei.id = d.expected_item_id
    left join public.cycle_count_expected_lots el on el.id = d.expected_lot_id
    left join public.inventory_items it on it.id = d.item_id
    left join public.storage_locations exp_loc on exp_loc.id = d.expected_location_id
    left join public.storage_locations obs_loc on obs_loc.id = d.observed_location_id
    left join auth.users recounter on recounter.id = d.recount_requested_by
    left join auth.users resolver on resolver.id = d.resolved_by
    order by d.discrepancy_kind, d.detected_at
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'quantities_withheld', v_withheld);
end
$$;

revoke all on function public.cycle_count_review(
  uuid, uuid, public.cycle_count_discrepancy_kind[],
  public.cycle_count_discrepancy_status[], integer, integer)
  from public, anon;
grant execute on function public.cycle_count_review(
  uuid, uuid, public.cycle_count_discrepancy_kind[],
  public.cycle_count_discrepancy_status[], integer, integer)
  to authenticated;

-- ===========================================================================
-- 3. The remaining read models lose their inert write grants
-- ===========================================================================
-- Written defensively rather than as six tidy statements: these views are
-- created across several earlier migrations, and a fresh plain-PostgreSQL shim
-- has no default privileges to strip. The loop touches only what exists.
do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'inventory_correction_overview',
    'inventory_item_overview',
    'inventory_lot_lineage_view',
    'inventory_lot_overview',
    'inventory_record_overview',
    'inventory_work_queue'
  ]
  loop
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_view and c.relkind = 'v'
    ) then
      execute format('revoke all on table public.%I from public, anon, authenticated', v_view);
      execute format('grant select on table public.%I to authenticated', v_view);
    end if;
  end loop;
end
$$;

insert into public.schema_migrations_log (migration_name)
values ('20260730000300_blind_count_disclosure_closure');
