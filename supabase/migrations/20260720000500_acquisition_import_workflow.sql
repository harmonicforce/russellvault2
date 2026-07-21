-- Phase 4 acquisition hierarchy — migration 5: the governed staged import
-- workflow mapping an already-COMMITTED Phase 3 import job's source_records
-- into the acquisition hierarchy.
--
-- WHY STAGED BATCHES
-- The largest repository fixture is 2,149 rows; committing that as one HTTP
-- request and one giant RPC argument is not realistic, exactly as in Phase 3.
--
--   begin_acquisition_import_job    open a commit-mode job (status 'preview')
--   stage_acquisition_orders        one row per distinct source order
--   stage_acquisition_lots          the order/show/package grouping layer
--   stage_acquisition_line_items    canonical lines + their lot placement
--   stage_acquisition_cost_components  typed, priced, attributed cost facts
--   finalize_acquisition_import_job    verify every count, then commit
--   fail_acquisition_import_job        mark a doomed attempt failed, visibly
--
-- ORDERING IS ENFORCED, NOT ASSUMED, exactly as in Phase 3:
--   orders -> lots -> line items -> cost components. Each stage function
--   validates that everything it references was ALREADY staged in THIS job
--   (not merely that it exists somewhere), and refuses otherwise.
--
-- IDENTITY RESOLUTION IS BY UUID, NOT BY STRING, ACROSS STAGES. Each stage
-- function returns only counts; the caller reads back the ids it needs (e.g.
-- SELECT ... WHERE acquisition_import_job_id = $1) between stages, exactly
-- as a real client must. This keeps every stage function's own SQL simple
-- and auditable rather than re-deriving cross-entity string resolution
-- internally at every step.
--
-- PROVENANCE DEPENDENCY IS ENFORCED AT THE ROOT: begin_acquisition_import_job
-- refuses to open unless the named Phase 3 import job is already status =
-- 'committed'. Every line item additionally requires its own source_record to
-- belong to THAT SAME committed job (see stage_acquisition_line_items).
--
-- CONTENT-IDEMPOTENCY AND WITHIN-BATCH DUPLICATE REJECTION are built in from
-- the start in every staging function below, applying the two corrections
-- made to Phase 3's stage_source_records / stage_external_identifiers after
-- their initial acceptance review:
--   * a retried batch is a safe no-op ONLY when every immutable value it
--     carries for an already-staged key is identical; any difference rejects
--     the ENTIRE batch, naming the conflicting key;
--   * a batch containing the SAME key more than once is rejected before any
--     insert, whether or not the repeated payloads agree.
--
-- Every function authorizes as part of its lookup and is granted to
-- `authenticated` only.

-- Batch-open helper, mirroring app.open_job_for_caller (migration 9, Phase 3) --
create function app.open_acquisition_job_for_caller(p_import_job_id uuid, p_uid uuid)
returns public.acquisition_import_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.acquisition_import_jobs%rowtype;
begin
  select j.* into v_job
  from public.acquisition_import_jobs j
  join public.workspace_members m
    on m.workspace_id = j.workspace_id
   and m.user_id = p_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where j.id = p_import_job_id
  for update of j;

  if v_job.id is null then
    raise exception 'acquisition import job not found or not authorized' using errcode = '42501';
  end if;
  if v_job.mode <> 'commit' then
    raise exception 'this job is a preview and cannot receive staged rows'
      using errcode = 'check_violation';
  end if;
  if v_job.status <> 'preview' then
    raise exception 'this acquisition import is % and can no longer be staged', v_job.status
      using errcode = 'check_violation';
  end if;

  return v_job;
end
$$;

revoke all on function app.open_acquisition_job_for_caller(uuid, uuid) from public;

-- Begin ----------------------------------------------------------------------------
create function public.begin_acquisition_import_job(
  p_workspace_id uuid,
  p_channel_id uuid,
  p_source_import_job_id uuid,
  p_idempotency_key text,
  p_expected_line_count integer,
  p_mapping_version text,
  p_plan_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_channel uuid;
  v_source_job public.import_jobs%rowtype;
  v_existing public.acquisition_import_jobs%rowtype;
  v_id uuid;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'an idempotency key is required to open a commit acquisition import'
      using errcode = '22023';
  end if;
  if p_workspace_id is null or p_channel_id is null or p_source_import_job_id is null then
    raise exception 'workspace id, channel id, and source import job id are required'
      using errcode = '22023';
  end if;
  if p_expected_line_count is null or p_expected_line_count < 0 then
    raise exception 'a non-negative expected line count is required' using errcode = '22023';
  end if;
  if p_mapping_version is null or p_mapping_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    raise exception 'a valid mapping version is required' using errcode = '22023';
  end if;
  if p_plan_sha256 is null or p_plan_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'a valid plan digest is required' using errcode = '22023';
  end if;

  v_uid := app.require_uid();

  select c.id into v_channel
  from public.channels c
  join public.workspace_members m
    on m.workspace_id = c.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where c.id = p_channel_id and c.workspace_id = p_workspace_id and c.active;

  if v_channel is null then
    raise exception 'channel not found or not authorized' using errcode = '42501';
  end if;

  -- PROVENANCE DEPENDENCY: only an already-COMMITTED Phase 3 import may be
  -- mapped. A preview or failed job is refused outright, before anything
  -- else is staged.
  select j.* into v_source_job
  from public.import_jobs j
  where j.id = p_source_import_job_id and j.workspace_id = p_workspace_id;

  if v_source_job.id is null then
    raise exception 'source import job not found or not authorized' using errcode = '42501';
  end if;
  if v_source_job.status <> 'committed' then
    raise exception
      'source import job is % and has not been committed; only a committed Phase 3 '
      'import may be mapped into the acquisition hierarchy',
      v_source_job.status
      using errcode = 'check_violation';
  end if;

  select * into v_existing
  from public.acquisition_import_jobs j
  where j.workspace_id = p_workspace_id and j.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    -- The idempotency key is bound to ONE exact plan. A resume (preview,
    -- committed, or failed) is allowed only when every part of the binding
    -- matches: channel, source job, expected line count, mapping version, and
    -- the plan digest. A change in ANY of these — including a changed mapping
    -- with the same number of lines — is a changed-content retry, refused.
    if v_existing.channel_id <> p_channel_id
       or v_existing.source_import_job_id <> p_source_import_job_id
       or v_existing.expected_line_count <> p_expected_line_count
       or v_existing.mapping_version <> p_mapping_version
       or v_existing.plan_sha256 <> p_plan_sha256 then
      raise exception
        'idempotency key is already bound to a different acquisition plan '
        '(channel, source job, line count, mapping version, or plan digest changed)'
        using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'resumed', true);
  end if;

  if exists (
    select 1 from public.acquisition_import_jobs j
    where j.workspace_id = p_workspace_id
      and j.source_import_job_id = p_source_import_job_id
      and j.status = 'committed'
  ) then
    raise exception
      'this source import job has already been committed into the acquisition hierarchy'
      using errcode = 'unique_violation';
  end if;

  insert into public.acquisition_import_jobs (
    workspace_id, channel_id, source_import_job_id, idempotency_key, mode,
    status, expected_line_count, mapping_version, plan_sha256, actor_user_id, actor_process
  )
  values (
    p_workspace_id, p_channel_id, p_source_import_job_id, p_idempotency_key, 'commit',
    'preview', p_expected_line_count, p_mapping_version, p_plan_sha256, v_uid, 'acquisition.import'
  )
  returning id into v_id;

  perform app.log_audit_event(
    p_workspace_id, 'acquisition_import_started', 'acquisition_import_jobs', v_id, v_uid,
    'acquisition.import', null, null, null,
    jsonb_build_object(
      'channel_id', p_channel_id, 'source_import_job_id', p_source_import_job_id,
      'expected_line_count', p_expected_line_count
    )
  );

  return jsonb_build_object('id', v_id, 'status', 'preview', 'resumed', false);
end
$$;

revoke all on function public.begin_acquisition_import_job(
  uuid, uuid, uuid, text, integer, text, text
) from public, anon;
grant execute on function public.begin_acquisition_import_job(
  uuid, uuid, uuid, text, integer, text, text
) to authenticated;

-- Stage orders -----------------------------------------------------------------------
-- Each entry: {source_order_reference, seller_raw_handle, first_source_record_id,
-- order_status, source_reported_status, source_reported_total_minor?, currency?,
-- occurred_at?}. Resolves (find-or-creates) the supplier for the seller handle.
create function public.stage_acquisition_orders(
  p_import_job_id uuid,
  p_orders jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.acquisition_import_jobs%rowtype;
  v_source_system_id uuid;
  v_batch integer;
  v_dup_ref text;
  v_conflict_ref text;
  v_inserted integer;
  -- Named v_row, NOT r: this function's embedded SQL uses "r" as a table
  -- alias (jsonb_array_elements(...) AS r) throughout, and a plpgsql
  -- variable of the same name is ambiguous inside those statements.
  v_row jsonb;
begin
  v_uid := app.require_uid();
  v_batch := app.assert_batch_size(p_orders, 500);
  v_job := app.open_acquisition_job_for_caller(p_import_job_id, v_uid);

  select j.source_system_id into v_source_system_id
  from public.import_jobs j where j.id = v_job.source_import_job_id;

  -- Within-batch shape validation, before any side effect.
  with incoming as (
    select r->>'source_order_reference' as source_order_reference
    from jsonb_array_elements(p_orders) as r
  )
  select min(d.source_order_reference) into v_dup_ref
  from (
    select source_order_reference from incoming
    group by source_order_reference having count(*) > 1
  ) d;
  if v_dup_ref is not null then
    raise exception 'batch contains source order reference % more than once', v_dup_ref
      using errcode = '23514';
  end if;

  -- PROVENANCE BINDING: every first_source_record_id used to seed a supplier
  -- alias must be a raw row of THIS committed Phase 3 job. A record from another
  -- job (or another workspace) is refused before any supplier is created.
  if exists (
    select 1 from jsonb_array_elements(p_orders) as r
    where not exists (
      select 1 from public.source_records sr
      where sr.id = (r->>'first_source_record_id')::uuid
        and sr.import_job_id = v_job.source_import_job_id
        and sr.workspace_id = v_job.workspace_id
    )
  ) then
    raise exception 'an order cites a source record that does not belong to the mapped '
      'Phase 3 import job'
      using errcode = 'check_violation';
  end if;

  -- Resolve (find-or-create) the supplier for every seller handle in this
  -- batch. Rolled back with everything else if this call later aborts.
  for v_row in select * from jsonb_array_elements(p_orders)
  loop
    perform app.ensure_supplier_alias(
      v_job.workspace_id, v_source_system_id, v_row->>'seller_raw_handle',
      (v_row->>'first_source_record_id')::uuid, v_uid, 'acquisition.import'
    );
  end loop;

  -- Content-idempotent retry check against already-stored orders.
  select min(o.source_order_reference) into v_conflict_ref
  from jsonb_array_elements(p_orders) as r
  join public.supplier_aliases a
    on a.workspace_id = v_job.workspace_id
   and a.source_system_id = v_source_system_id
   and a.raw_handle = r->>'seller_raw_handle'
  join public.acquisition_orders o
    on o.workspace_id = v_job.workspace_id
   and o.source_system_id = v_source_system_id
   and o.source_order_reference = r->>'source_order_reference'
  where o.supplier_id is distinct from a.supplier_id
     or o.order_status is distinct from (r->>'order_status')::public.acquisition_order_status
     or o.source_reported_status is distinct from r->>'source_reported_status'
     or o.source_reported_total_minor is distinct from
        case when r ? 'source_reported_total_minor'
             then (r->>'source_reported_total_minor')::bigint else null end
     or o.currency is distinct from r->>'currency'
     or o.occurred_at is distinct from
        case when r ? 'occurred_at' then (r->>'occurred_at')::timestamptz else null end;

  if v_conflict_ref is not null then
    raise exception
      'staged retry for source order % conflicts with already-stored content', v_conflict_ref
      using errcode = '23514';
  end if;

  with ins as (
    insert into public.acquisition_orders (
      workspace_id, public_id, channel_id, supplier_id, source_system_id,
      acquisition_import_job_id, source_order_reference, order_status,
      source_reported_status, source_reported_total_minor, currency, occurred_at,
      created_by_process
    )
    select
      v_job.workspace_id, app.mint_governed_public_id('RV-ACQ'), v_job.channel_id,
      a.supplier_id, v_source_system_id, v_job.id, r->>'source_order_reference',
      (r->>'order_status')::public.acquisition_order_status, r->>'source_reported_status',
      case when r ? 'source_reported_total_minor'
           then (r->>'source_reported_total_minor')::bigint else null end,
      r->>'currency',
      case when r ? 'occurred_at' then (r->>'occurred_at')::timestamptz else null end,
      'acquisition.import'
    from jsonb_array_elements(p_orders) as r
    join public.supplier_aliases a
      on a.workspace_id = v_job.workspace_id
     and a.source_system_id = v_source_system_id
     and a.raw_handle = r->>'seller_raw_handle'
    on conflict (workspace_id, source_system_id, source_order_reference) do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from ins;

  return jsonb_build_object('batch', v_batch, 'inserted', v_inserted);
end
$$;

revoke all on function public.stage_acquisition_orders(uuid, jsonb) from public, anon;
grant execute on function public.stage_acquisition_orders(uuid, jsonb) to authenticated;

-- Stage lots --------------------------------------------------------------------------
-- Each entry: {order_id, sequence_no?, label?}. order_id must already be
-- staged in THIS job.
create function public.stage_acquisition_lots(
  p_import_job_id uuid,
  p_lots jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.acquisition_import_jobs%rowtype;
  v_batch integer;
  v_dup_key text;
  v_unresolved integer;
  v_conflict_id text;
  v_inserted integer;
begin
  v_uid := app.require_uid();
  v_batch := app.assert_batch_size(p_lots, 500);
  v_job := app.open_acquisition_job_for_caller(p_import_job_id, v_uid);

  with incoming as (
    select
      (r->>'order_id')::uuid as order_id,
      coalesce((r->>'sequence_no')::integer, 1) as sequence_no
    from jsonb_array_elements(p_lots) as r
  )
  select min(order_id::text) into v_dup_key
  from (
    select order_id, sequence_no from incoming
    group by order_id, sequence_no having count(*) > 1
  ) d;
  if v_dup_key is not null then
    raise exception 'batch contains order %, lot sequence more than once', v_dup_key
      using errcode = '23514';
  end if;

  select count(*)::integer into v_unresolved
  from jsonb_array_elements(p_lots) as r
  where not exists (
    select 1 from public.acquisition_orders o
    where o.id = (r->>'order_id')::uuid and o.acquisition_import_job_id = v_job.id
  );
  if v_unresolved > 0 then
    raise exception '% lot(s) reference an order that has not been staged yet in this job',
      v_unresolved
      using errcode = 'check_violation';
  end if;

  select min(o.id::text) into v_conflict_id
  from jsonb_array_elements(p_lots) as r
  join public.acquisition_lots lt
    on lt.order_id = (r->>'order_id')::uuid
   and lt.sequence_no = coalesce((r->>'sequence_no')::integer, 1)
  join public.acquisition_orders o on o.id = lt.order_id
  where lt.label is distinct from (r->>'label');

  if v_conflict_id is not null then
    raise exception 'staged retry for order %''s lot conflicts with already-stored content',
      v_conflict_id
      using errcode = '23514';
  end if;

  with ins as (
    insert into public.acquisition_lots (
      workspace_id, public_id, order_id, sequence_no, label, created_by_process
    )
    select
      v_job.workspace_id, app.mint_governed_public_id('RV-ALOT'), (r->>'order_id')::uuid,
      coalesce((r->>'sequence_no')::integer, 1), r->>'label', 'acquisition.import'
    from jsonb_array_elements(p_lots) as r
    on conflict (workspace_id, order_id, sequence_no) do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from ins;

  return jsonb_build_object('batch', v_batch, 'inserted', v_inserted);
end
$$;

revoke all on function public.stage_acquisition_lots(uuid, jsonb) from public, anon;
grant execute on function public.stage_acquisition_lots(uuid, jsonb) to authenticated;

-- Stage line items ---------------------------------------------------------------------
-- Each entry: {public_id, lot_id, source_record_id, external_identifier_id?,
-- quantity, description?, reference_number?, source_detail?}. lot_id must
-- already be staged in this job; source_record_id must belong to the SAME
-- committed Phase 3 job this acquisition job maps (the provenance-dependency
-- enforcement point). Inserts the canonical line item AND its initial active
-- lot-line placement together.
create function public.stage_acquisition_line_items(
  p_import_job_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.acquisition_import_jobs%rowtype;
  v_source_system_id uuid;
  v_batch integer;
  v_batch_inserted integer := 0;
  v_dup_id text;
  v_unresolved integer;
  v_conflict_id text;
  v_staged_total integer;
  -- Named v_row, NOT r: see stage_acquisition_orders for why.
  v_row jsonb;
  v_line_id uuid;
  v_next_seq integer;
begin
  v_uid := app.require_uid();
  v_batch := app.assert_batch_size(p_lines, 500);
  v_job := app.open_acquisition_job_for_caller(p_import_job_id, v_uid);

  select j.source_system_id into v_source_system_id
  from public.import_jobs j where j.id = v_job.source_import_job_id;

  with incoming as (
    select r->>'public_id' as public_id from jsonb_array_elements(p_lines) as r
  )
  select min(public_id) into v_dup_id
  from (select public_id from incoming group by public_id having count(*) > 1) d;
  if v_dup_id is not null then
    raise exception 'batch contains line item public id % more than once', v_dup_id
      using errcode = '23514';
  end if;

  select count(*)::integer into v_unresolved
  from jsonb_array_elements(p_lines) as r
  where not exists (
    select 1 from public.source_records sr
    where sr.id = (r->>'source_record_id')::uuid
      and sr.import_job_id = v_job.source_import_job_id
  ) or not exists (
    select 1 from public.acquisition_lots lt
    join public.acquisition_orders o on o.id = lt.order_id
    where lt.id = (r->>'lot_id')::uuid and o.acquisition_import_job_id = v_job.id
  );
  if v_unresolved > 0 then
    raise exception
      '% line item(s) reference a raw source row or lot that has not been staged yet',
      v_unresolved
      using errcode = 'check_violation';
  end if;

  -- PROVENANCE BINDING: a supplied external_identifier_id must be an identifier
  -- of THIS workspace and source system that points at the EXACT source record
  -- this line item is built from — never some other row's alias.
  if exists (
    select 1 from jsonb_array_elements(p_lines) as r
    where r ? 'external_identifier_id' and r->>'external_identifier_id' is not null
      and not exists (
        select 1 from public.external_identifiers ei
        where ei.id = (r->>'external_identifier_id')::uuid
          and ei.workspace_id = v_job.workspace_id
          and ei.source_system_id = v_source_system_id
          and ei.source_record_id = (r->>'source_record_id')::uuid
      )
  ) then
    raise exception 'a line item cites an external identifier that does not belong to the '
      'same workspace, source system, and source record'
      using errcode = 'check_violation';
  end if;

  -- Content-idempotent retry check. A retry must match on EVERY immutable value,
  -- now including the external identifier AND the requested active lot placement
  -- (compared against the line''s current active lot_line), so re-homing or
  -- re-aliasing on retry is refused rather than silently ignored.
  select min(li.public_id) into v_conflict_id
  from jsonb_array_elements(p_lines) as r
  join public.acquisition_line_items li
    on li.workspace_id = v_job.workspace_id
   and li.source_system_id = v_source_system_id
   and li.public_id = r->>'public_id'
  left join public.acquisition_lot_lines ll
    on ll.line_item_id = li.id and ll.state = 'active'
  where li.source_record_id is distinct from (r->>'source_record_id')::uuid
     or li.quantity is distinct from (r->>'quantity')::integer
     or li.description is distinct from (r->>'description')
     or li.reference_number is distinct from (r->>'reference_number')
     or li.source_detail is distinct from coalesce(r->'source_detail', '{}'::jsonb)
     or li.external_identifier_id is distinct from
        case when r ? 'external_identifier_id' and r->>'external_identifier_id' is not null
             then (r->>'external_identifier_id')::uuid else null end
     or ll.lot_id is distinct from (r->>'lot_id')::uuid;

  if v_conflict_id is not null then
    raise exception 'staged retry for line item % conflicts with already-stored content',
      v_conflict_id
      using errcode = '23514';
  end if;

  for v_row in select * from jsonb_array_elements(p_lines)
  loop
    if exists (
      select 1 from public.acquisition_line_items li
      where li.workspace_id = v_job.workspace_id
        and li.source_system_id = v_source_system_id
        and li.public_id = v_row->>'public_id'
    ) then
      continue;
    end if;

    insert into public.acquisition_line_items (
      workspace_id, public_id, source_system_id, source_record_id,
      external_identifier_id, acquisition_import_job_id, quantity, description,
      reference_number, source_detail, created_by_process
    )
    values (
      v_job.workspace_id, v_row->>'public_id', v_source_system_id,
      (v_row->>'source_record_id')::uuid,
      case when v_row ? 'external_identifier_id' and v_row->>'external_identifier_id' is not null
           then (v_row->>'external_identifier_id')::uuid else null end,
      v_job.id, (v_row->>'quantity')::integer, v_row->>'description', v_row->>'reference_number',
      coalesce(v_row->'source_detail', '{}'::jsonb), 'acquisition.import'
    )
    returning id into v_line_id;

    select coalesce(max(sequence_no), 0) + 1 into v_next_seq
    from public.acquisition_lot_lines
    where lot_id = (v_row->>'lot_id')::uuid and state = 'active';

    insert into public.acquisition_lot_lines (
      workspace_id, lot_id, line_item_id, sequence_no, created_by_process
    )
    values (
      v_job.workspace_id, (v_row->>'lot_id')::uuid, v_line_id, v_next_seq, 'acquisition.import'
    );

    v_batch_inserted := v_batch_inserted + 1;
  end loop;

  select count(*)::integer into v_staged_total
  from public.acquisition_line_items where acquisition_import_job_id = v_job.id;

  return jsonb_build_object(
    'batch', v_batch, 'inserted', v_batch_inserted, 'staged_total', v_staged_total
  );
end
$$;

revoke all on function public.stage_acquisition_line_items(uuid, jsonb) from public, anon;
grant execute on function public.stage_acquisition_line_items(uuid, jsonb) to authenticated;

-- Stage cost components ------------------------------------------------------------------
-- Each entry: {line_item_id? | lot_id? | order_id? (exactly one), component_type,
-- amount_state, amount_minor?, currency, evidence_note?, source_record_id?}.
-- attribution_state is DERIVED, never supplied: line-item-scoped is always
-- 'direct'; lot- or order-scoped is always 'unresolved' — the importer never
-- invents an allocation. Requires its own job-open check (see migration 2's
-- header: this table has no blanket insert trigger, because corrections
-- insert into it after commit).
create function public.stage_acquisition_cost_components(
  p_import_job_id uuid,
  p_components jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.acquisition_import_jobs%rowtype;
  v_batch integer;
  v_dup_key text;
  v_unresolved integer;
  v_conflict_id text;
  v_inserted integer;
begin
  v_uid := app.require_uid();
  v_batch := app.assert_batch_size(p_components, 2000);
  v_job := app.open_acquisition_job_for_caller(p_import_job_id, v_uid);

  if exists (
    select 1 from jsonb_array_elements(p_components) as r
    where num_nonnulls(
      case when r ? 'line_item_id' then (r->>'line_item_id')::uuid end,
      case when r ? 'lot_id' then (r->>'lot_id')::uuid end,
      case when r ? 'order_id' then (r->>'order_id')::uuid end
    ) <> 1
  ) then
    raise exception 'each cost component must scope to exactly one of '
      'line_item_id, lot_id, or order_id'
      using errcode = '22023';
  end if;

  -- Within-batch shape validation: the natural key is (scope target,
  -- component type, source record), so distinct genuine components of the
  -- same type on the same target (e.g. two separate fees) stay
  -- distinguishable, while an exact repeat is refused.
  with incoming as (
    select
      coalesce(r->>'line_item_id', '') || '|' || coalesce(r->>'lot_id', '') || '|' ||
      coalesce(r->>'order_id', '') || '|' || (r->>'component_type') || '|' ||
      coalesce(r->>'source_record_id', '') as natural_key
    from jsonb_array_elements(p_components) as r
  )
  select min(natural_key) into v_dup_key
  from (select natural_key from incoming group by natural_key having count(*) > 1) d;
  if v_dup_key is not null then
    raise exception 'batch contains a duplicate cost component (same scope, type, and source row)'
      using errcode = '23514';
  end if;

  select count(*)::integer into v_unresolved
  from jsonb_array_elements(p_components) as r
  where
    (r ? 'line_item_id' and not exists (
      select 1 from public.acquisition_line_items li
      where li.id = (r->>'line_item_id')::uuid and li.acquisition_import_job_id = v_job.id
    ))
    or (r ? 'lot_id' and not exists (
      select 1 from public.acquisition_lots lt
      join public.acquisition_orders o on o.id = lt.order_id
      where lt.id = (r->>'lot_id')::uuid and o.acquisition_import_job_id = v_job.id
    ))
    or (r ? 'order_id' and not exists (
      select 1 from public.acquisition_orders o
      where o.id = (r->>'order_id')::uuid and o.acquisition_import_job_id = v_job.id
    ));
  if v_unresolved > 0 then
    raise exception '% cost component(s) reference a target that has not been staged yet',
      v_unresolved
      using errcode = 'check_violation';
  end if;

  -- PROVENANCE BINDING for cost evidence:
  --   * any supplied source_record_id must be a raw row of THIS committed Phase
  --     3 job;
  --   * a line-scoped (direct) component's source_record_id must MATCH the
  --     target line item's own source_record_id — a direct cost cannot cite a
  --     different row than the line it prices;
  --   * a shared (lot/order-scoped) component's evidence, when supplied, must
  --     belong to a line item that actually sits in that lot or order — evidence
  --     is tied to the scope it explains, not attached arbitrarily.
  if exists (
    select 1 from jsonb_array_elements(p_components) as r
    where r ? 'source_record_id' and r->>'source_record_id' is not null
      and not exists (
        select 1 from public.source_records sr
        where sr.id = (r->>'source_record_id')::uuid
          and sr.import_job_id = v_job.source_import_job_id
          and sr.workspace_id = v_job.workspace_id
      )
  ) then
    raise exception 'a cost component cites a source record that does not belong to the '
      'mapped Phase 3 import job'
      using errcode = 'check_violation';
  end if;

  -- A direct (line-scoped) import component MUST be traceable: it must cite a
  -- source record. A missing one rejects the whole batch — the import RPC never
  -- creates an untraceable direct cost fact. (Shared lot/order-scoped components
  -- may omit it, preserving later governed shared-cost entry.)
  if exists (
    select 1 from jsonb_array_elements(p_components) as r
    where r ? 'line_item_id'
      and (not (r ? 'source_record_id') or r->>'source_record_id' is null)
  ) then
    raise exception 'a direct (line-scoped) cost component must cite the source record it '
      'came from; an untraceable direct cost fact is refused'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_components) as r
    where r ? 'line_item_id' and r ? 'source_record_id'
      and r->>'source_record_id' is not null
      and not exists (
        select 1 from public.acquisition_line_items li
        where li.id = (r->>'line_item_id')::uuid
          and li.source_record_id = (r->>'source_record_id')::uuid
      )
  ) then
    raise exception 'a direct cost component''s source record must match the line item it prices'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_components) as r
    where (r ? 'lot_id' or r ? 'order_id')
      and r ? 'source_record_id' and r->>'source_record_id' is not null
      and not exists (
        select 1
        from public.acquisition_line_items li
        join public.acquisition_lot_lines ll on ll.line_item_id = li.id and ll.state = 'active'
        join public.acquisition_lots lt on lt.id = ll.lot_id
        where li.source_record_id = (r->>'source_record_id')::uuid
          and (
            (r ? 'lot_id' and lt.id = (r->>'lot_id')::uuid)
            or (r ? 'order_id' and lt.order_id = (r->>'order_id')::uuid)
          )
      )
  ) then
    raise exception 'a shared cost component''s evidence must belong to a line item within its '
      'lot or order scope'
      using errcode = 'check_violation';
  end if;

  select min(coalesce(r->>'line_item_id', coalesce(r->>'lot_id', r->>'order_id'))) into v_conflict_id
  from jsonb_array_elements(p_components) as r
  join public.acquisition_cost_components c
    on c.workspace_id = v_job.workspace_id
   and c.line_item_id is not distinct from
       case when r ? 'line_item_id' then (r->>'line_item_id')::uuid end
   and c.lot_id is not distinct from case when r ? 'lot_id' then (r->>'lot_id')::uuid end
   and c.order_id is not distinct from case when r ? 'order_id' then (r->>'order_id')::uuid end
   and c.component_type = (r->>'component_type')::public.cost_component_type
   and c.source_record_id is not distinct from
       case when r ? 'source_record_id' then (r->>'source_record_id')::uuid end
   and c.reversed_at is null
  where c.amount_state is distinct from (r->>'amount_state')::public.cost_amount_state
     or c.amount_minor is distinct from
        case when r ? 'amount_minor' then (r->>'amount_minor')::bigint end
     or c.currency is distinct from r->>'currency'
     or c.evidence_note is distinct from r->>'evidence_note';

  if v_conflict_id is not null then
    raise exception 'staged retry for cost component on % conflicts with already-stored content',
      v_conflict_id
      using errcode = '23514';
  end if;

  -- Insert only components not already present as an ACTIVE (unreversed) row
  -- with the same natural key, so an identical cross-call retry inserts zero
  -- (idempotent) while a genuinely new component is added. The changed-content
  -- case was already rejected above; concurrent identical inserts are caught by
  -- the deferred acquisition_cost_components_one_active_uniq constraint at
  -- commit. ON CONFLICT is deliberately NOT used: it cannot arbiter a
  -- deferrable constraint.
  with ins as (
    insert into public.acquisition_cost_components (
      workspace_id, public_id, line_item_id, lot_id, order_id, component_type,
      amount_state, amount_minor, currency, attribution_state, evidence_note,
      source_record_id, acquisition_import_job_id, created_by_process
    )
    select
      v_job.workspace_id, app.mint_governed_public_id('RV-ACOST'),
      case when r ? 'line_item_id' then (r->>'line_item_id')::uuid end,
      case when r ? 'lot_id' then (r->>'lot_id')::uuid end,
      case when r ? 'order_id' then (r->>'order_id')::uuid end,
      (r->>'component_type')::public.cost_component_type,
      (r->>'amount_state')::public.cost_amount_state,
      case when r ? 'amount_minor' then (r->>'amount_minor')::bigint end,
      r->>'currency',
      case when r ? 'line_item_id' then 'direct'::public.cost_attribution_state
           else 'unresolved'::public.cost_attribution_state end,
      r->>'evidence_note',
      case when r ? 'source_record_id' then (r->>'source_record_id')::uuid end,
      v_job.id, 'acquisition.import'
    from jsonb_array_elements(p_components) as r
    where not exists (
      select 1 from public.acquisition_cost_components c
      where c.workspace_id = v_job.workspace_id
        and c.reversed_at is null
        and c.line_item_id is not distinct from
            case when r ? 'line_item_id' then (r->>'line_item_id')::uuid end
        and c.lot_id is not distinct from case when r ? 'lot_id' then (r->>'lot_id')::uuid end
        and c.order_id is not distinct from case when r ? 'order_id' then (r->>'order_id')::uuid end
        and c.component_type = (r->>'component_type')::public.cost_component_type
        and c.source_record_id is not distinct from
            case when r ? 'source_record_id' then (r->>'source_record_id')::uuid end
    )
    returning 1
  )
  select count(*)::integer into v_inserted from ins;

  return jsonb_build_object('batch', v_batch, 'inserted', v_inserted);
end
$$;

revoke all on function public.stage_acquisition_cost_components(uuid, jsonb) from public, anon;
grant execute on function public.stage_acquisition_cost_components(uuid, jsonb) to authenticated;

-- Finalize ----------------------------------------------------------------------------
-- The ONLY path to committed status. Recounts what is actually stored and
-- compares against SIX mandatory, non-nullable expected counts — mirroring
-- Phase 3's finalize_import_job count contract from the start, rather than
-- discovering the gap after the fact: order count, lot count, line item
-- count, cost component count, unresolved supplier candidate count, and
-- unresolved (unallocated) cost component count. None may be omitted, even
-- when the true count is zero.
create function public.finalize_acquisition_import_job(
  p_import_job_id uuid,
  p_idempotency_key text,
  p_expected_orders integer,
  p_expected_lots integer,
  p_expected_line_items integer,
  p_expected_cost_components integer,
  p_expected_unresolved_supplier_candidates integer,
  p_expected_unresolved_cost_components integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.acquisition_import_jobs%rowtype;
  v_orders integer;
  v_lots integer;
  v_line_items integer;
  v_cost_components integer;
  v_unresolved_candidates integer;
  v_unresolved_costs integer;
  v_source_system_id uuid;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'an idempotency key is required to commit an acquisition import'
      using errcode = '22023';
  end if;
  if p_expected_orders is null or p_expected_lots is null or p_expected_line_items is null
     or p_expected_cost_components is null or p_expected_unresolved_supplier_candidates is null
     or p_expected_unresolved_cost_components is null then
    raise exception
      'all six expected counts (orders, lots, line items, cost components, '
      'unresolved supplier candidates, unresolved cost components) are required; '
      'none may be omitted, even when the true count is zero'
      using errcode = '22023';
  end if;

  v_uid := app.require_uid();
  v_job := app.open_acquisition_job_for_caller(p_import_job_id, v_uid);

  if v_job.idempotency_key <> p_idempotency_key then
    raise exception 'idempotency key does not match this acquisition import job'
      using errcode = '22023';
  end if;

  select j.source_system_id into v_source_system_id
  from public.import_jobs j where j.id = v_job.source_import_job_id;

  select count(*)::integer into v_orders
  from public.acquisition_orders where acquisition_import_job_id = v_job.id;

  select count(*)::integer into v_lots
  from public.acquisition_lots lt
  join public.acquisition_orders o on o.id = lt.order_id
  where o.acquisition_import_job_id = v_job.id;

  select count(*)::integer into v_line_items
  from public.acquisition_line_items where acquisition_import_job_id = v_job.id;

  select count(*)::integer into v_cost_components
  from public.acquisition_cost_components where acquisition_import_job_id = v_job.id;

  select count(*)::integer into v_unresolved_costs
  from public.acquisition_cost_components
  where acquisition_import_job_id = v_job.id and attribution_state = 'unresolved';

  -- Unresolved supplier candidates: distinct normalized-handle groups, within
  -- this source system, spanning more than one supplier. Counted at the
  -- WORKSPACE+SOURCE-SYSTEM level (not just this job) because a candidate
  -- pair may straddle two different import jobs over time.
  select count(*)::integer into v_unresolved_candidates
  from (
    select normalized_handle
    from public.supplier_aliases
    where workspace_id = v_job.workspace_id and source_system_id = v_source_system_id
    group by normalized_handle
    having count(distinct supplier_id) > 1
  ) g;

  -- Completeness: every declared line must actually be present.
  if v_line_items <> v_job.expected_line_count then
    raise exception
      'incomplete acquisition import: % of % declared line items are staged; not committing',
      v_line_items, v_job.expected_line_count
      using errcode = 'check_violation';
  end if;

  if p_expected_orders is distinct from v_orders then
    raise exception 'expected % orders but % are stored', p_expected_orders, v_orders
      using errcode = 'check_violation';
  end if;
  if p_expected_lots is distinct from v_lots then
    raise exception 'expected % lots but % are stored', p_expected_lots, v_lots
      using errcode = 'check_violation';
  end if;
  if p_expected_line_items is distinct from v_line_items then
    raise exception 'expected % line items but % are stored', p_expected_line_items, v_line_items
      using errcode = 'check_violation';
  end if;
  if p_expected_cost_components is distinct from v_cost_components then
    raise exception 'expected % cost components but % are stored',
      p_expected_cost_components, v_cost_components
      using errcode = 'check_violation';
  end if;
  if p_expected_unresolved_supplier_candidates is distinct from v_unresolved_candidates then
    raise exception 'expected % unresolved supplier candidates but % are stored',
      p_expected_unresolved_supplier_candidates, v_unresolved_candidates
      using errcode = 'check_violation';
  end if;
  if p_expected_unresolved_cost_components is distinct from v_unresolved_costs then
    raise exception 'expected % unresolved cost components but % are stored',
      p_expected_unresolved_cost_components, v_unresolved_costs
      using errcode = 'check_violation';
  end if;

  -- Every line item must have carried at least one cost component: a line
  -- with zero cost facts of any kind (known, documented-free, or unknown) is
  -- an import bug, not a legitimate state.
  if exists (
    select 1 from public.acquisition_line_items li
    where li.acquisition_import_job_id = v_job.id
      and not exists (
        select 1 from public.acquisition_cost_components c where c.line_item_id = li.id
      )
  ) then
    raise exception 'one or more line items have no cost component at all; not committing'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.acquisition_import_jobs j
    where j.workspace_id = v_job.workspace_id
      and j.source_import_job_id = v_job.source_import_job_id
      and j.status = 'committed'
      and j.id <> v_job.id
  ) then
    raise exception 'this source import job is already committed into the acquisition hierarchy'
      using errcode = 'unique_violation';
  end if;

  -- Freeze the six reconciliation counts on the job as it commits. These
  -- become immutable (see migration 2) and are what a later replay returns,
  -- regardless of any subsequent correction, allocation, re-homing, or alias.
  update public.acquisition_import_jobs
  set status = 'committed', completed_at = now(),
      committed_orders = v_orders, committed_lots = v_lots,
      committed_line_items = v_line_items, committed_cost_components = v_cost_components,
      committed_unresolved_supplier_candidates = v_unresolved_candidates,
      committed_unresolved_cost_components = v_unresolved_costs
  where id = v_job.id;

  perform app.log_audit_event(
    v_job.workspace_id, 'acquisition_import_committed', 'acquisition_import_jobs', v_job.id,
    v_uid, 'acquisition.import', null, null, null,
    jsonb_build_object(
      'orders', v_orders, 'lots', v_lots, 'line_items', v_line_items,
      'cost_components', v_cost_components,
      'unresolved_supplier_candidates', v_unresolved_candidates,
      'unresolved_cost_components', v_unresolved_costs
    )
  );

  return jsonb_build_object(
    'id', v_job.id, 'status', 'committed', 'orders', v_orders, 'lots', v_lots,
    'line_items', v_line_items, 'cost_components', v_cost_components,
    'unresolved_supplier_candidates', v_unresolved_candidates,
    'unresolved_cost_components', v_unresolved_costs
  );
end
$$;

revoke all on function public.finalize_acquisition_import_job(
  uuid, text, integer, integer, integer, integer, integer, integer
) from public, anon;
grant execute on function public.finalize_acquisition_import_job(
  uuid, text, integer, integer, integer, integer, integer, integer
) to authenticated;

-- Committed-replay summary (idempotent, read-only) --------------------------------------
-- Safe for the case where finalize COMMITTED but the HTTP response was lost:
-- replaying the same request must return the existing committed outcome, not a
-- 409. It returns the FROZEN committed summary stored on the job at finalize —
-- never recomputed from mutable correction history or workspace-global aliases —
-- so later reversals, allocations, re-homings, added aliases, or other imports
-- can never alter the replay result. It verifies the FULL binding (idempotency
-- key, channel, source import job, expected line count, mapping version, plan
-- digest) before returning, performs NO write, and creates NO audit event. A
-- replay whose binding differs is refused, identically to not-found.
create function public.get_committed_acquisition_summary(
  p_import_job_id uuid,
  p_idempotency_key text,
  p_channel_id uuid,
  p_source_import_job_id uuid,
  p_expected_line_count integer,
  p_mapping_version text,
  p_plan_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.acquisition_import_jobs%rowtype;
begin
  v_uid := app.require_uid();

  -- Authorize as part of the lookup: a caller who is not an owner/operator of
  -- this job's workspace gets the same answer as "does not exist". No FOR
  -- UPDATE / no lock — this path never mutates the committed job.
  select j.* into v_job
  from public.acquisition_import_jobs j
  join public.workspace_members m
    on m.workspace_id = j.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where j.id = p_import_job_id;

  if v_job.id is null then
    raise exception 'acquisition import job not found or not authorized' using errcode = '42501';
  end if;
  if v_job.status <> 'committed' then
    raise exception 'acquisition import job is not committed' using errcode = 'check_violation';
  end if;

  -- FULL binding check: the replay must describe the SAME work in every part,
  -- including the frozen mapping version and plan digest.
  if v_job.idempotency_key is distinct from p_idempotency_key
     or v_job.channel_id is distinct from p_channel_id
     or v_job.source_import_job_id is distinct from p_source_import_job_id
     or v_job.expected_line_count is distinct from p_expected_line_count
     or v_job.mapping_version is distinct from p_mapping_version
     or v_job.plan_sha256 is distinct from p_plan_sha256 then
    raise exception 'the replayed request does not match this committed acquisition import'
      using errcode = '22023';
  end if;

  -- Return the FROZEN counts recorded at finalize — not a recomputation.
  return jsonb_build_object(
    'id', v_job.id, 'status', 'committed',
    'orders', v_job.committed_orders, 'lots', v_job.committed_lots,
    'line_items', v_job.committed_line_items,
    'cost_components', v_job.committed_cost_components,
    'unresolved_supplier_candidates', v_job.committed_unresolved_supplier_candidates,
    'unresolved_cost_components', v_job.committed_unresolved_cost_components
  );
end
$$;

revoke all on function public.get_committed_acquisition_summary(
  uuid, text, uuid, uuid, integer, text, text
) from public, anon;
grant execute on function public.get_committed_acquisition_summary(
  uuid, text, uuid, uuid, integer, text, text
) to authenticated;

-- Fail an attempt visibly ---------------------------------------------------------------
create function public.fail_acquisition_import_job(
  p_import_job_id uuid,
  p_failure_code text,
  p_failure_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.acquisition_import_jobs%rowtype;
begin
  if p_failure_code is null or btrim(p_failure_code) = '' then
    raise exception 'a failure code is required' using errcode = '22023';
  end if;

  v_uid := app.require_uid();
  v_job := app.open_acquisition_job_for_caller(p_import_job_id, v_uid);

  update public.acquisition_import_jobs
  set status = 'failed', completed_at = now(),
      failure_code = p_failure_code, failure_detail = p_failure_detail
  where id = v_job.id;

  perform app.log_audit_event(
    v_job.workspace_id, 'acquisition_import_failed', 'acquisition_import_jobs', v_job.id,
    v_uid, 'acquisition.import', null, null, null,
    jsonb_build_object('failure_code', p_failure_code, 'failure_detail', p_failure_detail)
  );

  return v_job.id;
end
$$;

revoke all on function public.fail_acquisition_import_job(uuid, text, text) from public, anon;
grant execute on function public.fail_acquisition_import_job(uuid, text, text) to authenticated;

-- Least privilege for service_role on every Phase 4 governed entry point ---------------
-- Same class of gap as the table grants (migration 3): a hosted Supabase
-- project configures DEFAULT PRIVILEGES on the public schema that grant
-- EXECUTE on new functions to anon, authenticated and service_role. Each
-- function above revokes from `public` and `anon` and grants `authenticated`,
-- so service_role would otherwise silently retain EXECUTE.
do $$
declare
  v_signature text;
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    return;
  end if;

  for v_signature in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'register_channel', 'propose_cost_allocation', 'confirm_cost_allocation',
        'reverse_cost_allocation', 'reverse_cost_component', 'supersede_lot_line',
        'begin_acquisition_import_job', 'stage_acquisition_orders',
        'stage_acquisition_lots', 'stage_acquisition_line_items',
        'stage_acquisition_cost_components', 'finalize_acquisition_import_job',
        'get_committed_acquisition_summary', 'fail_acquisition_import_job')
  loop
    execute format('revoke all on function %s from service_role', v_signature);
  end loop;
end $$;

insert into public.schema_migrations_log (migration_name)
values ('20260720000500_acquisition_import_workflow');
