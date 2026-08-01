-- Listing Prep Command Center — migration 4: package presets, bulk work, and
-- the Workbench summary.
--
-- The bulk operation is a loop over the SAME governed single-record functions,
-- not a set-based UPDATE. That costs a little speed and buys the guarantee
-- that a batch can never do something one record at a time could not: the
-- owner-only gates, the readiness re-check and the event log all still apply
-- to every row. Each record's failure is reported and the rest of the batch
-- continues, because a batch that aborts on row 7 of 50 leaves the operator
-- with no idea what happened.

-- ---------------------------------------------------------------------------
-- Package presets
-- ---------------------------------------------------------------------------

create or replace function public.create_listing_package_preset(
  p_workspace_id uuid,
  p_name text,
  p_package_weight_grams integer default null,
  p_package_length_mm integer default null,
  p_package_width_mm integer default null,
  p_package_height_mm integer default null,
  p_shipping_policy_ref text default null,
  p_return_policy_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  v_uid := app.require_listing_prep_writer(p_workspace_id);
  if v_name is null then
    raise exception 'a preset name is required' using errcode = '23514';
  end if;

  begin
    insert into public.listing_package_presets
      (workspace_id, name, package_weight_grams, package_length_mm,
       package_width_mm, package_height_mm, shipping_policy_ref,
       return_policy_ref, created_by)
    values (p_workspace_id, v_name, p_package_weight_grams, p_package_length_mm,
            p_package_width_mm, p_package_height_mm,
            nullif(btrim(coalesce(p_shipping_policy_ref, '')), ''),
            nullif(btrim(coalesce(p_return_policy_ref, '')), ''), v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'a package preset called "%" already exists', v_name using errcode = '23505';
  end;

  return jsonb_build_object('id', v_id, 'name', v_name);
end
$$;

revoke all on function public.create_listing_package_preset(
  uuid, text, integer, integer, integer, integer, text, text) from public, anon;
grant execute on function public.create_listing_package_preset(
  uuid, text, integer, integer, integer, integer, text, text) to authenticated;

-- Retire rather than delete: a preset that was applied to real listings is
-- part of how those listings came to say what they say.
create or replace function public.retire_listing_package_preset(
  p_workspace_id uuid, p_preset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_name text;
begin
  perform app.require_listing_prep_writer(p_workspace_id);

  update public.listing_package_presets set retired_at = now()
   where id = p_preset_id and workspace_id = p_workspace_id and retired_at is null
  returning name into v_name;

  if v_name is null then
    raise exception 'package preset not found in this workspace' using errcode = '23514';
  end if;
  return jsonb_build_object('id', p_preset_id, 'name', v_name, 'retired', true);
end
$$;

revoke all on function public.retire_listing_package_preset(uuid, uuid) from public, anon;
grant execute on function public.retire_listing_package_preset(uuid, uuid) to authenticated;

create or replace function public.list_listing_package_presets(
  p_workspace_id uuid, p_include_retired boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_rows jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name,
           'package_weight_grams', s.package_weight_grams,
           'package_length_mm', s.package_length_mm,
           'package_width_mm', s.package_width_mm,
           'package_height_mm', s.package_height_mm,
           'shipping_policy_ref', s.shipping_policy_ref,
           'return_policy_ref', s.return_policy_ref,
           'retired_at', s.retired_at) order by s.name), '[]'::jsonb)
    into v_rows
    from public.listing_package_presets s
   where s.workspace_id = p_workspace_id
     and (coalesce(p_include_retired, false) or s.retired_at is null);

  return v_rows;
end
$$;

revoke all on function public.list_listing_package_presets(uuid, boolean) from public, anon;
grant execute on function public.list_listing_package_presets(uuid, boolean) to authenticated;

-- Applying a preset is an ordinary content edit, so it goes through the same
-- governed content function and lands in the same history.
create or replace function public.apply_listing_package_preset(
  p_workspace_id uuid, p_prep_id uuid, p_preset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preset public.listing_package_presets%rowtype;
  v_patch jsonb;
begin
  perform app.require_listing_prep_writer(p_workspace_id);

  select * into v_preset from public.listing_package_presets
   where id = p_preset_id and workspace_id = p_workspace_id and retired_at is null;
  if v_preset.id is null then
    raise exception 'package preset not found in this workspace' using errcode = '23514';
  end if;

  -- Only the fields the preset actually defines. A preset that says nothing
  -- about the return policy must not blank out the one already recorded.
  v_patch := '{}'::jsonb;
  if v_preset.package_weight_grams is not null then
    v_patch := v_patch || jsonb_build_object('package_weight_grams', v_preset.package_weight_grams);
  end if;
  if v_preset.package_length_mm is not null then
    v_patch := v_patch || jsonb_build_object('package_length_mm', v_preset.package_length_mm);
  end if;
  if v_preset.package_width_mm is not null then
    v_patch := v_patch || jsonb_build_object('package_width_mm', v_preset.package_width_mm);
  end if;
  if v_preset.package_height_mm is not null then
    v_patch := v_patch || jsonb_build_object('package_height_mm', v_preset.package_height_mm);
  end if;
  if v_preset.shipping_policy_ref is not null then
    v_patch := v_patch || jsonb_build_object('shipping_policy_ref', v_preset.shipping_policy_ref);
  end if;
  if v_preset.return_policy_ref is not null then
    v_patch := v_patch || jsonb_build_object('return_policy_ref', v_preset.return_policy_ref);
  end if;

  if v_patch = '{}'::jsonb then
    raise exception 'this package preset defines no values to apply' using errcode = '23514';
  end if;

  perform public.update_listing_prep_content(p_workspace_id, p_prep_id, v_patch);

  perform app.listing_prep_log(p_workspace_id, p_prep_id, 'preset_applied',
    app.require_uid(), null, null, null,
    jsonb_build_object('preset_id', v_preset.id, 'preset_name', v_preset.name));

  return public.get_listing_prep(p_workspace_id, p_prep_id);
end
$$;

revoke all on function public.apply_listing_package_preset(uuid, uuid, uuid) from public, anon;
grant execute on function public.apply_listing_package_preset(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bulk operations
-- ---------------------------------------------------------------------------

create or replace function public.bulk_listing_prep_action(
  p_workspace_id uuid,
  p_prep_ids uuid[],
  p_action text,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_results jsonb := '[]'::jsonb;
  v_ok int := 0;
  v_failed int := 0;
  v_reason text := nullif(btrim(coalesce(v_params ->> 'reason', '')), '');
begin
  -- Membership is checked here so an outsider gets one clear refusal rather
  -- than a per-record report that leaks which ids exist.
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  if v_action not in ('assign', 'set_priority', 'apply_package_preset',
                      'request_review', 'mark_blocked', 'unblock',
                      'cancel', 'mark_ready') then
    raise exception 'unknown bulk action: %', p_action using errcode = '23514';
  end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_prep_ids, '{}'::uuid[])) x;
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'select at least one preparation record' using errcode = '23514';
  end if;
  if array_length(v_ids, 1) > 200 then
    raise exception 'a bulk action covers at most 200 records at a time' using errcode = '23514';
  end if;

  -- Deterministic order across concurrent batches, so two overlapping bulk
  -- actions queue behind each other instead of deadlocking.
  select array_agg(x order by x) into v_ids from unnest(v_ids) x;

  foreach v_id in array v_ids loop
    begin
      case v_action
        when 'assign' then
          perform public.assign_listing_prep(p_workspace_id, v_id,
            nullif(v_params ->> 'assigned_to', '')::uuid);
        when 'set_priority' then
          perform public.set_listing_prep_priority(p_workspace_id, v_id,
            (v_params ->> 'priority')::public.listing_prep_priority);
        when 'apply_package_preset' then
          perform public.apply_listing_package_preset(p_workspace_id, v_id,
            (v_params ->> 'preset_id')::uuid);
        when 'request_review' then
          perform public.transition_listing_prep(p_workspace_id, v_id, 'needs_review', v_reason);
        when 'mark_blocked' then
          perform public.transition_listing_prep(p_workspace_id, v_id, 'blocked', v_reason);
        when 'unblock' then
          perform public.transition_listing_prep(p_workspace_id, v_id, 'in_preparation', v_reason);
        when 'cancel' then
          perform public.transition_listing_prep(p_workspace_id, v_id, 'cancelled', v_reason);
        when 'mark_ready' then
          -- Still owner-only, and still readiness-gated per record: a bulk
          -- action is not a way to wave fifty records through at once.
          perform public.transition_listing_prep(p_workspace_id, v_id, 'ready_to_list', v_reason);
      end case;
      v_ok := v_ok + 1;
      v_results := v_results || jsonb_build_object('prep_id', v_id, 'outcome', 'applied');
    exception
      when insufficient_privilege then
        -- An authority failure is about the caller, not the record: stop
        -- rather than reporting the same refusal fifty times.
        raise;
      when others then
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_object(
          'prep_id', v_id, 'outcome', 'failed', 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'action', v_action,
    'requested', array_length(v_ids, 1),
    'applied', v_ok,
    'failed', v_failed,
    'results', v_results);
end
$$;

revoke all on function public.bulk_listing_prep_action(uuid, uuid[], text, jsonb)
  from public, anon;
grant execute on function public.bulk_listing_prep_action(uuid, uuid[], text, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Workbench summary
-- ---------------------------------------------------------------------------

-- Bounded counts, not a second copy of the queue. The Workbench links into
-- Listing Prep; it does not reproduce it.
--
-- There is no "listed without an external reference" bucket: recording a
-- listing requires that reference, so the bucket could only ever be empty and
-- showing it would be noise.
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
    -- Stock that could be worked on but nobody has opened yet. Computed from
    -- the shared read model so it cannot disagree with Inventory.
    (select count(*)::int from public.inventory_record_overview o
      where o.workspace_id = p_workspace_id
        and o.is_available
        and not (o.record_kind = 'lot' and o.tracking_mode = 'serialized')
        and not exists (
          select 1 from public.listing_prep lp
           where lp.workspace_id = p_workspace_id
             and coalesce(lp.item_id, lp.lot_id) = o.record_id
             and lp.status not in ('listed', 'cancelled'))) as never_started
    into v_row
    from public.listing_prep p
   where p.workspace_id = p_workspace_id;

  return jsonb_build_object(
    'by_status', v_status,
    'by_readiness', v_readiness,
    'unassigned', coalesce(v_row.unassigned, 0),
    'listed_last_7_days', coalesce(v_row.listed_last_7_days, 0),
    'never_started', coalesce(v_row.never_started, 0));
end
$$;

revoke all on function public.get_listing_prep_summary(uuid) from public, anon;
grant execute on function public.get_listing_prep_summary(uuid) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260801000800_listing_prep_bulk_and_presets');
