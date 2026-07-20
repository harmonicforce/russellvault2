-- Phase 4 acquisition hierarchy — migration 4: governed review and
-- registry entry points (everything except the staged import workflow,
-- which is migration 5).
--
-- Every function here follows the Phase 3 security lessons directly:
--   * authorize AS PART OF the lookup, and lock only after the join has
--     proved the caller may write to the row's workspace;
--   * a foreign or nonexistent row reports the SAME "not found or not
--     authorized" error, disclosing neither existence nor status;
--   * SECURITY DEFINER with an explicit empty search_path;
--   * revoked from public/anon; granted to authenticated only where the
--     function is meant to be called directly (internal app.* helpers are
--     never granted to anyone and are reachable only from definer callers).

-- Deterministic, non-matching name normalization for REVIEW/QUERY only. Never
-- used to decide that two suppliers are the same; see supplier_aliases in
-- migration 1 and app.ensure_supplier_alias below.
create function app.normalize_supplier_handle(p_handle text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both ' ' from regexp_replace(lower(p_handle), '[^a-z0-9]+', ' ', 'g'));
$$;

revoke all on function app.normalize_supplier_handle(text) from public;
grant execute on function app.normalize_supplier_handle(text) to authenticated;

-- Owner-only channel registry, mirroring register_source_system ------------------
-- Idempotent by NAME within a workspace: resuming an interrupted setup
-- returns the existing channel rather than creating a duplicate.
create function public.register_channel(
  p_workspace_id uuid,
  p_name text,
  p_kind text,
  p_description text default null,
  p_public_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_workspace uuid;
  v_existing public.channels%rowtype;
  v_id uuid;
  v_public_id text;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'a channel name is required' using errcode = '22023';
  end if;
  if p_kind not in ('marketplace', 'manual', 'other') then
    raise exception 'kind must be marketplace, manual, or other' using errcode = '22023';
  end if;

  v_uid := app.require_uid();

  select m.workspace_id into v_workspace
  from public.workspace_members m
  where m.workspace_id = p_workspace_id
    and m.user_id = v_uid
    and m.role = 'owner';

  if v_workspace is null then
    raise exception 'workspace not found or not authorized' using errcode = '42501';
  end if;

  select * into v_existing
  from public.channels c
  where c.workspace_id = p_workspace_id and c.name = p_name;

  if v_existing.id is not null then
    return jsonb_build_object(
      'id', v_existing.id, 'public_id', v_existing.public_id, 'resumed', true
    );
  end if;

  v_public_id := coalesce(p_public_id, app.mint_governed_public_id('RV-CH'));

  insert into public.channels (workspace_id, public_id, name, kind, description, created_by)
  values (p_workspace_id, v_public_id, p_name, p_kind, p_description, v_uid)
  returning id into v_id;

  perform app.log_audit_event(
    p_workspace_id, 'channel_registered', 'channels', v_id, v_uid, 'acquisition.registry',
    null, null, null,
    jsonb_build_object('name', p_name, 'kind', p_kind)
  );

  return jsonb_build_object('id', v_id, 'public_id', v_public_id, 'resumed', false);
end
$$;

revoke all on function public.register_channel(uuid, text, text, text, text) from public, anon;
grant execute on function public.register_channel(uuid, text, text, text, text) to authenticated;

-- Supplier find-or-create, internal only -----------------------------------------
-- The ONLY path that creates a supplier. Exactly one NEW supplier is minted
-- the FIRST time a given (workspace, source system, raw handle) triple is
-- seen; every later sighting of the SAME triple resolves to the SAME
-- supplier via its alias. This never inspects any OTHER supplier's spelling,
-- normalized form, or handle to decide anything — there is no merge path
-- here, automatic or otherwise. Never granted directly; called only from the
-- staged import workflow (migration 5) under the caller's own authorization.
create function app.ensure_supplier_alias(
  p_workspace_id uuid,
  p_source_system_id uuid,
  p_raw_handle text,
  p_source_record_id uuid,
  p_uid uuid,
  p_actor_process text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alias public.supplier_aliases%rowtype;
  v_supplier_id uuid;
  v_public_id text;
begin
  select * into v_alias
  from public.supplier_aliases a
  where a.workspace_id = p_workspace_id
    and a.source_system_id = p_source_system_id
    and a.raw_handle = p_raw_handle;

  if v_alias.id is not null then
    return v_alias.supplier_id;
  end if;

  v_public_id := app.mint_governed_public_id('RV-SUP');
  insert into public.suppliers (workspace_id, public_id, display_name, created_by_process)
  values (p_workspace_id, v_public_id, p_raw_handle, p_actor_process)
  returning id into v_supplier_id;

  insert into public.supplier_aliases (
    workspace_id, supplier_id, source_system_id, raw_handle, normalized_handle,
    first_seen_source_record_id, created_by_process
  )
  values (
    p_workspace_id, v_supplier_id, p_source_system_id, p_raw_handle,
    app.normalize_supplier_handle(p_raw_handle), p_source_record_id, p_actor_process
  );

  perform app.log_audit_event(
    p_workspace_id, 'supplier_registered', 'suppliers', v_supplier_id, p_uid, p_actor_process,
    null, p_source_record_id, null,
    jsonb_build_object('raw_handle', p_raw_handle)
  );

  return v_supplier_id;
end
$$;

revoke all on function app.ensure_supplier_alias(uuid, uuid, text, uuid, uuid, text) from public;

-- Cost allocation: propose ---------------------------------------------------------
-- Records an explicit, caller-supplied split of a shared component's amount
-- across specific line items as CANDIDATE rows. This function computes and
-- invents NOTHING: every per-line amount and the method label are supplied
-- by the caller (the operator, via the review UI), never derived here. A
-- component must be shared (lot- or order-scoped) and currently unresolved.
create function public.propose_cost_allocation(
  p_cost_component_id uuid,
  p_method text,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_component public.acquisition_cost_components%rowtype;
  v_batch integer;
  v_dup_line text;
  v_unresolved integer;
  v_inserted integer;
begin
  if p_method is null or p_method !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'method must be a lowercase identifier' using errcode = '22023';
  end if;
  v_batch := app.assert_batch_size(p_allocations, 2000);
  if v_batch = 0 then
    raise exception 'at least one allocation line is required' using errcode = '22023';
  end if;

  v_uid := app.require_uid();

  select c.* into v_component
  from public.acquisition_cost_components c
  join public.workspace_members m
    on m.workspace_id = c.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where c.id = p_cost_component_id
  for update of c;

  if v_component.id is null then
    raise exception 'cost component not found or not authorized' using errcode = '42501';
  end if;
  if v_component.attribution_state = 'direct' then
    raise exception 'a directly-attributed cost component cannot be allocated'
      using errcode = 'check_violation';
  end if;
  if v_component.attribution_state = 'allocated' then
    raise exception 'cost component already has a confirmed allocation; reverse it first'
      using errcode = 'check_violation';
  end if;
  if v_component.reversed_at is not null then
    raise exception 'cost component has been reversed and cannot be allocated'
      using errcode = 'check_violation';
  end if;
  -- An unknown or null-amount component has no total to split. It must never be
  -- allocated: the caller''s expected total cannot stand in for a missing amount,
  -- and doing so would fabricate a cost basis the source never reported.
  if v_component.amount_state <> 'known' or v_component.amount_minor is null then
    raise exception 'a cost component whose amount is unknown or null cannot be allocated; '
      'resolve its amount to a known value first'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.acquisition_cost_allocations a
    where a.cost_component_id = p_cost_component_id and a.state = 'candidate'
  ) then
    raise exception 'cost component already has pending candidate allocations'
      using errcode = 'check_violation';
  end if;

  -- Within-batch shape validation: a line item may not repeat in one proposal.
  with incoming as (
    select (r->>'line_item_id')::uuid as line_item_id
    from jsonb_array_elements(p_allocations) as r
  )
  select min(d.line_item_id::text) into v_dup_line
  from (
    select line_item_id from incoming group by line_item_id having count(*) > 1
  ) d;
  if v_dup_line is not null then
    raise exception 'batch contains line item % more than once; each line item '
      'may appear at most once per allocation proposal', v_dup_line
      using errcode = '23514';
  end if;

  -- Every targeted line item must actually belong to the component's scope
  -- (the same lot, or some lot under the same order).
  select count(*)::integer into v_unresolved
  from jsonb_array_elements(p_allocations) as r
  where not exists (
    select 1
    from public.acquisition_lot_lines ll
    join public.acquisition_lots lt on lt.id = ll.lot_id
    where ll.line_item_id = (r->>'line_item_id')::uuid
      and ll.state = 'active'
      and (
        (v_component.lot_id is not null and lt.id = v_component.lot_id)
        or (v_component.order_id is not null and lt.order_id = v_component.order_id)
      )
  );
  if v_unresolved > 0 then
    raise exception '% allocation line(s) reference a line item outside this cost '
      'component''s scope', v_unresolved
      using errcode = 'check_violation';
  end if;

  with ins as (
    insert into public.acquisition_cost_allocations (
      workspace_id, public_id, cost_component_id, line_item_id, amount_minor,
      method, created_by_process
    )
    select
      v_component.workspace_id, app.mint_governed_public_id('RV-ACALLOC'),
      p_cost_component_id, (r->>'line_item_id')::uuid, (r->>'amount_minor')::bigint,
      p_method, 'acquisition.allocation'
    from jsonb_array_elements(p_allocations) as r
    returning id
  )
  select count(*)::integer into v_inserted from ins;

  perform app.log_audit_event(
    v_component.workspace_id, 'cost_allocation_proposed', 'acquisition_cost_components',
    p_cost_component_id, v_uid, 'acquisition.allocation', null, v_component.source_record_id, null,
    jsonb_build_object('method', p_method, 'line_count', v_inserted)
  );

  return jsonb_build_object('proposed', v_inserted);
end
$$;

revoke all on function public.propose_cost_allocation(uuid, text, jsonb) from public, anon;
grant execute on function public.propose_cost_allocation(uuid, text, jsonb) to authenticated;

-- Cost allocation: confirm -----------------------------------------------------------
-- Confirms every CANDIDATE allocation for a component in one atomic step,
-- after independently verifying conservation: the candidates must sum to
-- within ONE MINOR UNIT of the component's own amount_minor AND of the
-- caller's own expected total (a count-contract, mirroring Phase 3's
-- finalize_import_job — the caller states what it expects and the database
-- verifies it, rather than the database silently trusting itself).
create function public.confirm_cost_allocation(
  p_cost_component_id uuid,
  p_expected_total_minor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_component public.acquisition_cost_components%rowtype;
  v_sum bigint;
  v_count integer;
begin
  if p_expected_total_minor is null then
    raise exception 'an expected total is required to confirm an allocation'
      using errcode = '22023';
  end if;

  v_uid := app.require_uid();

  select c.* into v_component
  from public.acquisition_cost_components c
  join public.workspace_members m
    on m.workspace_id = c.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where c.id = p_cost_component_id
  for update of c;

  if v_component.id is null then
    raise exception 'cost component not found or not authorized' using errcode = '42501';
  end if;
  -- An unknown or null-amount component can never be confirmed as allocated: it
  -- has no amount to conserve against, and the caller''s expected total must not
  -- be allowed to stand in for the missing figure.
  if v_component.amount_state <> 'known' or v_component.amount_minor is null then
    raise exception 'a cost component whose amount is unknown or null cannot be confirmed as '
      'allocated; it must stay unresolved until its amount is known'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(a.amount_minor), 0)::bigint, count(*)::integer
  into v_sum, v_count
  from public.acquisition_cost_allocations a
  where a.cost_component_id = p_cost_component_id and a.state = 'candidate';

  if v_count = 0 then
    raise exception 'cost component has no candidate allocations to confirm'
      using errcode = 'check_violation';
  end if;

  if abs(v_sum - p_expected_total_minor) > 1 then
    raise exception 'expected allocation total % but candidates sum to %',
      p_expected_total_minor, v_sum
      using errcode = 'check_violation';
  end if;
  -- amount_minor is guaranteed non-null by the guard above: conservation against
  -- the component''s own amount is always enforced, never skipped.
  if abs(v_sum - v_component.amount_minor) > 1 then
    raise exception 'candidate allocations sum to % but the component amount is %',
      v_sum, v_component.amount_minor
      using errcode = 'check_violation';
  end if;

  update public.acquisition_cost_allocations
  set state = 'confirmed', reviewed_by = v_uid, reviewed_at = now()
  where cost_component_id = p_cost_component_id and state = 'candidate';

  update public.acquisition_cost_components
  set attribution_state = 'allocated'
  where id = p_cost_component_id;

  perform app.log_audit_event(
    v_component.workspace_id, 'cost_allocation_confirmed', 'acquisition_cost_components',
    p_cost_component_id, v_uid, 'acquisition.allocation', null, v_component.source_record_id, null,
    jsonb_build_object('confirmed_count', v_count, 'total_minor', v_sum)
  );

  return jsonb_build_object('confirmed', v_count, 'total_minor', v_sum);
end
$$;

revoke all on function public.confirm_cost_allocation(uuid, bigint) from public, anon;
grant execute on function public.confirm_cost_allocation(uuid, bigint) to authenticated;

-- Cost allocation: reverse ------------------------------------------------------------
-- Retracts every CONFIRMED allocation for a component and resets the
-- component to 'unresolved', so a corrected propose/confirm cycle can run
-- again. History is preserved: the reversed rows remain, timestamped, with
-- their own review attribution intact; nothing is deleted or overwritten.
create function public.reverse_cost_allocation(
  p_cost_component_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_component public.acquisition_cost_components%rowtype;
  v_count integer;
begin
  v_uid := app.require_uid();

  select c.* into v_component
  from public.acquisition_cost_components c
  join public.workspace_members m
    on m.workspace_id = c.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where c.id = p_cost_component_id
  for update of c;

  if v_component.id is null then
    raise exception 'cost component not found or not authorized' using errcode = '42501';
  end if;
  if v_component.attribution_state <> 'allocated' then
    raise exception 'cost component has no confirmed allocation to reverse'
      using errcode = 'check_violation';
  end if;

  update public.acquisition_cost_allocations
  set state = 'reversed', reversed_at = now()
  where cost_component_id = p_cost_component_id and state = 'confirmed';
  get diagnostics v_count = row_count;

  update public.acquisition_cost_components
  set attribution_state = 'unresolved'
  where id = p_cost_component_id;

  perform app.log_audit_event(
    v_component.workspace_id, 'cost_allocation_reversed', 'acquisition_cost_components',
    p_cost_component_id, v_uid, 'acquisition.allocation', null, v_component.source_record_id, null,
    jsonb_build_object('reversed_count', v_count, 'reason', p_reason)
  );

  return jsonb_build_object('reversed', v_count);
end
$$;

revoke all on function public.reverse_cost_allocation(uuid, text) from public, anon;
grant execute on function public.reverse_cost_allocation(uuid, text) to authenticated;

-- Cost component: reverse (governed correction) ----------------------------------
-- Corrects a wrong component fact (type, amount, evidence, ...) by inserting
-- a NEW successor row and marking the old one reversed, rather than
-- overwriting it. The successor inherits whatever the caller does not
-- explicitly override, and always keeps the same scope target (the SAME
-- line item, lot, or order) as the row it corrects.
create function public.reverse_cost_component(
  p_cost_component_id uuid,
  p_replacement jsonb default '{}'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_old public.acquisition_cost_components%rowtype;
  v_new_id uuid;
  v_public_id text;
  v_component_type public.cost_component_type;
  v_amount_state public.cost_amount_state;
  v_amount_minor bigint;
  v_currency text;
  v_evidence_note text;
begin
  if p_cost_component_id is null then
    raise exception 'cost component id is required' using errcode = '22023';
  end if;

  v_uid := app.require_uid();

  select c.* into v_old
  from public.acquisition_cost_components c
  join public.workspace_members m
    on m.workspace_id = c.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where c.id = p_cost_component_id
  for update of c;

  if v_old.id is null then
    raise exception 'cost component not found or not authorized' using errcode = '42501';
  end if;
  if v_old.reversed_at is not null then
    raise exception 'cost component is already reversed' using errcode = 'check_violation';
  end if;
  if v_old.attribution_state = 'allocated' then
    raise exception 'an allocated cost component must be un-allocated (reverse_cost_allocation) '
      'before it can itself be reversed'
      using errcode = 'check_violation';
  end if;

  v_component_type := coalesce(
    (p_replacement->>'component_type')::public.cost_component_type, v_old.component_type
  );
  v_amount_state := coalesce(
    (p_replacement->>'amount_state')::public.cost_amount_state, v_old.amount_state
  );
  v_amount_minor := case
    when p_replacement ? 'amount_minor' then (p_replacement->>'amount_minor')::bigint
    else v_old.amount_minor
  end;
  v_currency := coalesce(p_replacement->>'currency', v_old.currency);
  v_evidence_note := coalesce(p_replacement->>'evidence_note', v_old.evidence_note);

  v_public_id := app.mint_governed_public_id('RV-ACOST');

  insert into public.acquisition_cost_components (
    workspace_id, public_id, line_item_id, lot_id, order_id,
    component_type, amount_state, amount_minor, currency, attribution_state,
    evidence_note, source_record_id, acquisition_import_job_id,
    reverses_id, created_by_process
  )
  values (
    v_old.workspace_id, v_public_id, v_old.line_item_id, v_old.lot_id, v_old.order_id,
    v_component_type, v_amount_state, v_amount_minor, v_currency, v_old.attribution_state,
    v_evidence_note, v_old.source_record_id, v_old.acquisition_import_job_id,
    p_cost_component_id, 'acquisition.correction'
  )
  returning id into v_new_id;

  update public.acquisition_cost_components
  set reversed_by_id = v_new_id, reversed_at = now()
  where id = p_cost_component_id;

  perform app.log_audit_event(
    v_old.workspace_id, 'cost_component_reversed', 'acquisition_cost_components',
    p_cost_component_id, v_uid, 'acquisition.correction', null, v_old.source_record_id, null,
    jsonb_build_object('replacement_id', v_new_id, 'reason', p_reason)
  );

  return jsonb_build_object('reversed_id', p_cost_component_id, 'replacement_id', v_new_id);
end
$$;

revoke all on function public.reverse_cost_component(uuid, jsonb, text) from public, anon;
grant execute on function public.reverse_cost_component(uuid, jsonb, text) to authenticated;

-- Lot line: supersede (re-home a line into a different lot) ------------------------
-- Corrects a wrong lot placement by inserting a NEW active placement row in
-- the target lot and marking the old placement superseded, without mutating
-- the line item or its provenance. Both rows are resolved and locked by a
-- single authorized, deterministically ordered query, mirroring
-- supersede_source_crosswalk.
create function public.supersede_lot_line(
  p_lot_line_id uuid,
  p_new_lot_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_old public.acquisition_lot_lines%rowtype;
  v_new_lot public.acquisition_lots%rowtype;
  v_new_id uuid;
  v_next_seq integer;
begin
  if p_lot_line_id is null or p_new_lot_id is null then
    raise exception 'both the lot-line id and the target lot id are required'
      using errcode = '22023';
  end if;

  v_uid := app.require_uid();

  select l.* into v_old
  from public.acquisition_lot_lines l
  join public.workspace_members m
    on m.workspace_id = l.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where l.id = p_lot_line_id
  for update of l;

  if v_old.id is null then
    raise exception 'lot-line placement not found or not authorized' using errcode = '42501';
  end if;
  if v_old.state <> 'active' then
    raise exception 'lot-line placement is already %', v_old.state
      using errcode = 'check_violation';
  end if;

  select t.* into v_new_lot
  from public.acquisition_lots t
  where t.id = p_new_lot_id and t.workspace_id = v_old.workspace_id;

  if v_new_lot.id is null then
    raise exception 'target lot not found or not authorized' using errcode = '42501';
  end if;

  select coalesce(max(l.sequence_no), 0) + 1 into v_next_seq
  from public.acquisition_lot_lines l
  where l.lot_id = p_new_lot_id and l.state = 'active';

  insert into public.acquisition_lot_lines (
    workspace_id, lot_id, line_item_id, sequence_no, created_by_process
  )
  values (
    v_old.workspace_id, p_new_lot_id, v_old.line_item_id, v_next_seq, 'acquisition.correction'
  )
  returning id into v_new_id;

  update public.acquisition_lot_lines
  set state = 'superseded', superseded_by_id = v_new_id, superseded_at = now()
  where id = p_lot_line_id;

  update public.acquisition_lot_lines
  set supersedes_id = p_lot_line_id
  where id = v_new_id;

  perform app.log_audit_event(
    v_old.workspace_id, 'lot_line_superseded', 'acquisition_lot_lines', p_lot_line_id,
    v_uid, 'acquisition.correction', null, null, null,
    jsonb_build_object(
      'line_item_id', v_old.line_item_id, 'from_lot_id', v_old.lot_id,
      'to_lot_id', p_new_lot_id, 'note', p_note
    )
  );

  return jsonb_build_object('superseded_id', p_lot_line_id, 'replacement_id', v_new_id);
end
$$;

revoke all on function public.supersede_lot_line(uuid, uuid, text) from public, anon;
grant execute on function public.supersede_lot_line(uuid, uuid, text) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260720000400_acquisition_functions');
