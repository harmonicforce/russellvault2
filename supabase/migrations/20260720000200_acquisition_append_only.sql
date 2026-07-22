-- Phase 4 acquisition hierarchy — migration 2: append-only enforcement,
-- governed-identity immutability, and lifecycle/state governance.
--
-- Same three-layer append-only guarantee as Phase 3 migration 7 (grants, RLS,
-- and a BEFORE trigger that refuses even a privileged connection's ordinary
-- UPDATE/DELETE/TRUNCATE) — see that migration's header for the precise scope
-- of the claim. Reuses app.forbid_update_delete and app.forbid_column_change
-- from migration 6 (Phase 3) rather than redefining them.
--
-- WHAT IS FULLY APPEND-ONLY (evidence-shaped; never updated, ever):
--   channels, suppliers, supplier_aliases, acquisition_orders,
--   acquisition_lots, acquisition_line_items.
-- Correcting a wrong alias-to-supplier mapping, a wrong order/lot/line fact,
-- etc. is out of scope for this phase; it would require a new governed
-- correction mechanism, tracked as a remaining owner decision.
--
-- WHAT HAS A GOVERNED LIFECYCLE (identity immutable; state advances only
-- through the functions in migration 4, never a bare UPDATE):
--   acquisition_import_jobs   -- preview -> committed | failed (mirrors
--                                import_jobs' status flow exactly).
--   acquisition_lot_lines     -- active -> superseded, by re-homing a line
--                                into a different lot without mutating it.
--   acquisition_cost_components -- unresolved <-> allocated (attribution
--                                state only); reversed_at/by set once.
--   acquisition_cost_allocations -- candidate -> confirmed | reversed;
--                                confirmed -> reversed.

-- Append-only tables ------------------------------------------------------------
create trigger channels_append_only
  before update or delete on public.channels
  for each row execute function app.forbid_update_delete();
create trigger channels_append_only_truncate
  before truncate on public.channels
  for each statement execute function app.forbid_update_delete();

create trigger suppliers_append_only
  before update or delete on public.suppliers
  for each row execute function app.forbid_update_delete();
create trigger suppliers_append_only_truncate
  before truncate on public.suppliers
  for each statement execute function app.forbid_update_delete();

create trigger supplier_aliases_append_only
  before update or delete on public.supplier_aliases
  for each row execute function app.forbid_update_delete();
create trigger supplier_aliases_append_only_truncate
  before truncate on public.supplier_aliases
  for each statement execute function app.forbid_update_delete();

create trigger acquisition_orders_append_only
  before update or delete on public.acquisition_orders
  for each row execute function app.forbid_update_delete();
create trigger acquisition_orders_append_only_truncate
  before truncate on public.acquisition_orders
  for each statement execute function app.forbid_update_delete();

create trigger acquisition_lots_append_only
  before update or delete on public.acquisition_lots
  for each row execute function app.forbid_update_delete();
create trigger acquisition_lots_append_only_truncate
  before truncate on public.acquisition_lots
  for each statement execute function app.forbid_update_delete();

create trigger acquisition_line_items_append_only
  before update or delete on public.acquisition_line_items
  for each row execute function app.forbid_update_delete();
create trigger acquisition_line_items_append_only_truncate
  before truncate on public.acquisition_line_items
  for each statement execute function app.forbid_update_delete();

-- acquisition_import_jobs: identity immutable, status forward-only -------------------
create trigger acquisition_import_jobs_identity_immutable
  before update on public.acquisition_import_jobs
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'channel_id', 'source_import_job_id', 'mode',
    'idempotency_key', 'expected_line_count', 'started_at',
    'mapping_version', 'plan_sha256'
  );

-- The frozen committed summary is write-once: finalize sets it (NULL -> value)
-- as it commits, and it can never change afterwards. This is what makes a
-- committed replay return the ORIGINAL counts no matter what corrections,
-- allocations, re-homings, or later aliases/imports happen next.
create function app.enforce_acquisition_committed_summary_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.committed_orders is not null
        and new.committed_orders is distinct from old.committed_orders)
     or (old.committed_lots is not null
        and new.committed_lots is distinct from old.committed_lots)
     or (old.committed_line_items is not null
        and new.committed_line_items is distinct from old.committed_line_items)
     or (old.committed_cost_components is not null
        and new.committed_cost_components is distinct from old.committed_cost_components)
     or (old.committed_unresolved_supplier_candidates is not null
        and new.committed_unresolved_supplier_candidates
            is distinct from old.committed_unresolved_supplier_candidates)
     or (old.committed_unresolved_cost_components is not null
        and new.committed_unresolved_cost_components
            is distinct from old.committed_unresolved_cost_components) then
    raise exception 'the committed acquisition summary is frozen and cannot be changed'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.enforce_acquisition_committed_summary_frozen() from public;

create trigger acquisition_import_jobs_committed_summary_frozen
  before update on public.acquisition_import_jobs
  for each row execute function app.enforce_acquisition_committed_summary_frozen();

create function app.enforce_acquisition_job_status_flow()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'preview' then
      raise exception 'acquisition import job % is terminal (%): status cannot change to %',
        old.id, old.status, new.status
        using errcode = 'check_violation';
    end if;
    if new.status not in ('committed', 'failed') then
      raise exception 'invalid acquisition import job status transition % -> %',
        old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function app.enforce_acquisition_job_status_flow() from public;

create trigger acquisition_import_jobs_status_flow
  before update on public.acquisition_import_jobs
  for each row execute function app.enforce_acquisition_job_status_flow();

-- Children may only be staged while their acquisition job is still open -------------
-- Mirrors app.enforce_child_job_open (migration 7) but keyed on
-- acquisition_import_jobs / acquisition_import_job_id, a distinct job table.
create function app.enforce_acquisition_job_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_status public.import_job_status;
begin
  select j.status into job_status
  from public.acquisition_import_jobs j
  where j.id = new.acquisition_import_job_id
    and j.workspace_id = new.workspace_id;

  if job_status is null then
    raise exception 'acquisition import job does not exist in this workspace'
      using errcode = 'foreign_key_violation';
  end if;

  if job_status <> 'preview' then
    raise exception
      'this acquisition import is % and can no longer accept new %; '
      'a correction requires a new acquisition import',
      job_status, tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function app.enforce_acquisition_job_open() from public;

create trigger acquisition_orders_job_open
  before insert on public.acquisition_orders
  for each row execute function app.enforce_acquisition_job_open();

create trigger acquisition_line_items_job_open
  before insert on public.acquisition_line_items
  for each row execute function app.enforce_acquisition_job_open();

-- Deliberately NO acquisition_cost_components_job_open trigger: unlike orders
-- and line items (only ever inserted during the original staged import, like
-- Phase 3's source_records), cost components must remain insertable AFTER
-- their job is committed, because reverse_cost_component (migration 4)
-- corrects a component by inserting a NEW successor row that cites the
-- ORIGINAL (by then committed) job for lineage. The initial staging function
-- (stage_acquisition_cost_components, migration 5) enforces its own
-- job-must-be-open check explicitly, the same way Phase 3's
-- app.open_job_for_caller does, rather than relying on a table-wide trigger
-- that a later correction would then have to work around.

-- acquisition_lot_lines: candidate-shaped supersession governance --------------------
-- ACTIVE is the only permitted initial state, for every caller. A new row can
-- never arrive pre-superseded.
create function app.enforce_lot_line_initial_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state <> 'active' then
    raise exception
      'acquisition_lot_lines must be inserted as active (attempted %); '
      'superseding requires an explicit governed transition',
      new.state
      using errcode = 'check_violation';
  end if;
  if new.superseded_by_id is not null or new.superseded_at is not null then
    raise exception 'a new lot-line placement cannot already be superseded'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.enforce_lot_line_initial_state() from public;

create trigger acquisition_lot_lines_initial_state
  before insert on public.acquisition_lot_lines
  for each row execute function app.enforce_lot_line_initial_state();

create function app.enforce_lot_line_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state then
    if old.state = 'superseded' then
      raise exception 'lot-line placement % is superseded and is terminal', old.id
        using errcode = 'check_violation';
    end if;
    if new.state <> 'superseded' then
      raise exception 'invalid lot-line placement transition % -> %', old.state, new.state
        using errcode = 'check_violation';
    end if;
  end if;
  -- The line item a placement refers to, and the workspace/lot it started in,
  -- are historical facts once written; only its lifecycle may advance. The
  -- CORRECTION is a NEW row (a different placement superseding this one).
  return new;
end
$$;

revoke all on function app.enforce_lot_line_transition() from public;

create trigger acquisition_lot_lines_transition
  before update on public.acquisition_lot_lines
  for each row execute function app.enforce_lot_line_transition();

create function app.enforce_lot_line_supersession_coherence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replacement public.acquisition_lot_lines%rowtype;
  v_cursor uuid;
  v_hops integer := 0;
begin
  if new.superseded_by_id is null
     or new.superseded_by_id is not distinct from old.superseded_by_id then
    return new;
  end if;

  select * into v_replacement
  from public.acquisition_lot_lines l
  where l.id = new.superseded_by_id;

  if v_replacement.id is null then
    raise exception 'replacement lot-line placement does not exist' using errcode = '42501';
  end if;

  if v_replacement.workspace_id <> new.workspace_id then
    raise exception 'replacement lot-line placement does not exist' using errcode = '42501';
  end if;

  if v_replacement.line_item_id <> new.line_item_id then
    raise exception
      'a replacement placement must re-home the SAME line item (expected %, got %)',
      new.line_item_id, v_replacement.line_item_id
      using errcode = 'check_violation';
  end if;

  if v_replacement.state <> 'active' then
    raise exception 'a replacement lot-line placement must itself be active (it is %)',
      v_replacement.state
      using errcode = 'check_violation';
  end if;

  v_cursor := v_replacement.superseded_by_id;
  while v_cursor is not null loop
    v_hops := v_hops + 1;
    if v_cursor = new.id then
      raise exception 'supersession would create a cycle' using errcode = 'check_violation';
    end if;
    if v_hops > 1000 then
      raise exception 'supersession chain is implausibly long' using errcode = 'check_violation';
    end if;
    select l.superseded_by_id into v_cursor
    from public.acquisition_lot_lines l
    where l.id = v_cursor;
  end loop;

  return new;
end
$$;

revoke all on function app.enforce_lot_line_supersession_coherence() from public;

create trigger acquisition_lot_lines_supersession_coherence
  before update on public.acquisition_lot_lines
  for each row execute function app.enforce_lot_line_supersession_coherence();

-- acquisition_cost_components: identity immutable except attribution/reversal ------
create trigger acquisition_cost_components_identity_immutable
  before update on public.acquisition_cost_components
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'line_item_id', 'lot_id', 'order_id',
    'component_type', 'amount_state', 'amount_minor', 'currency',
    'evidence_note', 'source_record_id', 'acquisition_import_job_id', 'created_at'
  );

-- attribution_state may only move between 'unresolved' and 'allocated' — never
-- INTO or OUT OF 'direct', which is a structural fact fixed by which scope
-- column is populated (enforced by the CHECK constraints in migration 1).
create function app.enforce_cost_component_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.attribution_state is distinct from old.attribution_state then
    if old.attribution_state = 'direct' or new.attribution_state = 'direct' then
      raise exception 'a cost component''s direct/shared attribution is structural and immutable'
        using errcode = 'check_violation';
    end if;
  end if;
  if old.reversed_at is not null and new.reversed_at is distinct from old.reversed_at then
    raise exception 'a reversed cost component''s reversal is permanent' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.enforce_cost_component_transition() from public;

create trigger acquisition_cost_components_transition
  before update on public.acquisition_cost_components
  for each row execute function app.enforce_cost_component_transition();

create function app.enforce_cost_component_reversal_coherence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replacement public.acquisition_cost_components%rowtype;
begin
  if new.reversed_by_id is null
     or new.reversed_by_id is not distinct from old.reversed_by_id then
    return new;
  end if;

  select * into v_replacement
  from public.acquisition_cost_components c
  where c.id = new.reversed_by_id;

  if v_replacement.id is null then
    raise exception 'reversing cost component does not exist' using errcode = '42501';
  end if;

  if v_replacement.workspace_id <> new.workspace_id then
    raise exception 'reversing cost component does not exist' using errcode = '42501';
  end if;

  if v_replacement.line_item_id is distinct from new.line_item_id
     or v_replacement.lot_id is distinct from new.lot_id
     or v_replacement.order_id is distinct from new.order_id then
    raise exception 'a reversing cost component must apply to the SAME scope target'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function app.enforce_cost_component_reversal_coherence() from public;

create trigger acquisition_cost_components_reversal_coherence
  before update on public.acquisition_cost_components
  for each row execute function app.enforce_cost_component_reversal_coherence();

-- acquisition_cost_allocations: candidate-only initial state + state flow ----------
create function app.enforce_cost_allocation_initial_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state <> 'candidate' then
    raise exception
      'acquisition_cost_allocations must be inserted as candidate (attempted %); '
      'confirmation requires an explicit governed transition',
      new.state
      using errcode = 'check_violation';
  end if;
  if new.reviewed_by is not null or new.reviewed_at is not null then
    raise exception 'a new cost-allocation candidate cannot carry review attribution'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.enforce_cost_allocation_initial_state() from public;

create trigger acquisition_cost_allocations_initial_state
  before insert on public.acquisition_cost_allocations
  for each row execute function app.enforce_cost_allocation_initial_state();

create trigger acquisition_cost_allocations_identity_immutable
  before update on public.acquisition_cost_allocations
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'cost_component_id', 'line_item_id',
    'amount_minor', 'method', 'created_at'
  );

create function app.enforce_cost_allocation_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state then
    if old.state = 'reversed' then
      raise exception 'cost allocation % is reversed and is terminal', old.id
        using errcode = 'check_violation';
    end if;
    if new.state = 'candidate' then
      raise exception 'a reviewed cost allocation cannot return to candidate'
        using errcode = 'check_violation';
    end if;
  end if;
  if old.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by then
    raise exception 'cost allocation review attribution is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.enforce_cost_allocation_transition() from public;

create trigger acquisition_cost_allocations_transition
  before update on public.acquisition_cost_allocations
  for each row execute function app.enforce_cost_allocation_transition();

-- Extend the shared audit_events event_type vocabulary --------------------------------
-- audit_events itself (migration 6, Phase 3) is untouched as a migration file;
-- this is a NEW, additive migration widening its CHECK constraint so Phase 4
-- can log to the SAME append-only audit log rather than creating a second one.
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'source_system_registered',
  'import_previewed',
  'import_started',
  'import_records_staged',
  'import_committed',
  'import_failed',
  'source_record_ingested',
  'crosswalk_candidate_created',
  'crosswalk_confirmed',
  'crosswalk_rejected',
  'crosswalk_superseded',
  'issue_opened',
  'issue_acknowledged',
  'issue_resolved',
  'issue_wont_fix',
  -- Phase 4 additions.
  'channel_registered',
  'supplier_registered',
  'supplier_alias_created',
  'acquisition_import_started',
  'acquisition_import_staged',
  'acquisition_import_committed',
  'acquisition_import_failed',
  'lot_line_superseded',
  'cost_component_reversed',
  'cost_allocation_proposed',
  'cost_allocation_confirmed',
  'cost_allocation_reversed'
));

insert into public.schema_migrations_log (migration_name)
values ('20260720000200_acquisition_append_only');
