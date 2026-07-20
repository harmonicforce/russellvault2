-- Phase 3 source/import provenance — migration 7: append-only enforcement,
-- governed-identity immutability, and crosswalk state governance.
--
-- Append-only here means DATABASE-ENFORCED, not merely un-granted. Three
-- independent layers protect historical facts:
--   1. grants     — authenticated receives SELECT only (migration 8);
--   2. RLS        — no UPDATE/DELETE policy exists at all (migration 8);
--   3. triggers   — this file. A BEFORE UPDATE OR DELETE trigger raises for
--                   every caller that issues an ordinary DML statement,
--                   including the table owner, postgres, and service_role.
--
-- SCOPE OF THE GUARANTEE — stated precisely:
--   Layers 1 and 2 are bypassed by any superuser or BYPASSRLS role, and the
--   local Supabase stack ships several. Layer 3 still refuses their ordinary
--   UPDATE, DELETE, and TRUNCATE statements, which is what makes append-only
--   meaningful for a privileged application connection.
--
--   It is NOT a claim of tamper-proofing against a PostgreSQL superuser. A
--   superuser can ALTER TABLE ... DISABLE TRIGGER, DROP TRIGGER, or otherwise
--   change the schema and then mutate these tables freely. Schema-changing
--   superuser access is outside this application's threat boundary; defending
--   it requires controls this layer cannot provide (restricted role grants,
--   audited DDL, off-host log shipping).

-- Append-only: source_records --------------------------------------------------
-- Raw payloads are immutable. Corrections require a NEW import job or a new
-- parser/mapping version — never an edit to the recorded original.
create trigger source_records_append_only
  before update or delete on public.source_records
  for each row execute function app.forbid_update_delete();

-- Statement-level guard as well, so a TRUNCATE-shaped or zero-row-matching
-- statement cannot be used to imply mutation is allowed.
create trigger source_records_append_only_truncate
  before truncate on public.source_records
  for each statement execute function app.forbid_update_delete();

-- Append-only: audit_events ----------------------------------------------------
create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function app.forbid_update_delete();

create trigger audit_events_append_only_truncate
  before truncate on public.audit_events
  for each statement execute function app.forbid_update_delete();

-- Governed identity immutability ------------------------------------------------
-- Provenance identity must never drift after the fact: a job's public ID,
-- workspace, source system, hashes, versions, and idempotency key define what
-- was imported. Status and reconciliation counts may still advance.
create trigger import_jobs_identity_immutable
  before update on public.import_jobs
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'source_system_id', 'mode',
    'file_sha256', 'content_sha256', 'parser_version', 'mapping_version',
    'idempotency_key', 'started_at'
  );
-- `mode` is in that immutable set on purpose: a preview job can NEVER be
-- promoted into a commit. Combined with the import_jobs_commit_mode CHECK
-- (status 'committed' requires mode 'commit'), preview and commit are
-- permanently distinct jobs, so previewing cannot mutate committed provenance.

create trigger source_systems_identity_immutable
  before update on public.source_systems
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'kind'
  );

-- A crosswalk's subject and how it was proposed are historical facts; only the
-- review state and its supersession linkage may advance.
create trigger source_crosswalks_identity_immutable
  before update on public.source_crosswalks
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'source_record_id', 'proposed_entity_type',
    'proposed_entity_key', 'match_method', 'created_by_process', 'created_at'
  );

-- The issue's subject and the raw payload it preserves are immutable; only its
-- resolution state may advance.
create trigger data_quality_issues_identity_immutable
  before update on public.data_quality_issues
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'import_job_id', 'source_record_id',
    'issue_type', 'raw_payload_snapshot', 'created_at'
  );

-- Import status governance ------------------------------------------------------
-- Status is a forward-only lifecycle. A committed job can never be walked back
-- to preview, and a terminal job can never be reopened — otherwise the
-- idempotency guarantee could be evaded by flipping status and re-committing.
create function app.enforce_import_job_status_flow()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'preview' then
      raise exception 'import job % is terminal (%): status cannot change to %',
        old.public_id, old.status, new.status
        using errcode = 'check_violation';
    end if;
    if new.status not in ('committed', 'failed') then
      raise exception 'invalid import job status transition % -> %', old.status, new.status
        using errcode = 'check_violation';
    end if;
    new.status_changed_at := now();
  end if;

  return new;
end
$$;

revoke all on function app.enforce_import_job_status_flow() from public;

create trigger import_jobs_status_flow
  before update on public.import_jobs
  for each row execute function app.enforce_import_job_status_flow();

-- Crosswalk initial-state governance ---------------------------------------------
-- CANDIDATE IS THE ONLY PERMITTED INITIAL STATE, for every caller and every
-- matching method. There is no code path — automatic or manual — that can
-- INSERT a row already confirmed. Confirmation is only reachable through the
-- reviewed transition in migration 9, which records a human reviewer.
create function app.enforce_crosswalk_initial_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.review_state <> 'candidate' then
    raise exception
      'source_crosswalks must be inserted as candidate (attempted %); '
      'confirmation requires an explicit reviewed transition',
      new.review_state
      using errcode = 'check_violation';
  end if;
  if new.reviewed_by is not null or new.reviewed_at is not null then
    raise exception 'a new crosswalk candidate cannot carry review attribution'
      using errcode = 'check_violation';
  end if;
  if new.superseded_by_id is not null or new.superseded_at is not null then
    raise exception 'a new crosswalk candidate cannot already be superseded'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.enforce_crosswalk_initial_state() from public;

create trigger source_crosswalks_initial_state
  before insert on public.source_crosswalks
  for each row execute function app.enforce_crosswalk_initial_state();

-- Crosswalk transition governance -------------------------------------------------
-- Legal transitions:
--   candidate -> confirmed | rejected | superseded
--   confirmed -> superseded
--   rejected  -> superseded
--   superseded-> (terminal)
-- Nothing ever returns to candidate: review history is never erased, only
-- extended by a superseding row.
create function app.enforce_crosswalk_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.review_state is distinct from old.review_state then
    if old.review_state = 'superseded' then
      raise exception 'crosswalk % is superseded and is terminal', old.id
        using errcode = 'check_violation';
    end if;
    if new.review_state = 'candidate' then
      raise exception 'a reviewed crosswalk cannot return to candidate'
        using errcode = 'check_violation';
    end if;
    if old.review_state in ('confirmed', 'rejected')
       and new.review_state <> 'superseded' then
      raise exception 'crosswalk % is already % and may only be superseded',
        old.id, old.review_state
        using errcode = 'check_violation';
    end if;
  end if;

  -- Review attribution, once recorded, is a historical fact.
  if old.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by then
    raise exception 'crosswalk review attribution is immutable'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function app.enforce_crosswalk_transition() from public;

create trigger source_crosswalks_transition
  before update on public.source_crosswalks
  for each row execute function app.enforce_crosswalk_transition();

-- Supersession coherence -----------------------------------------------------
-- A replacement must be a genuine alternative reading of THE SAME evidence:
-- same workspace, same source record, same proposed entity type, and itself
-- still an unreviewed candidate. Fan-in/fan-out is already impossible via the
-- two partial unique indexes in migration 6; this trigger adds the checks that
-- require seeing both rows, plus cycle detection along the chain.
create function app.enforce_supersession_coherence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replacement public.source_crosswalks%rowtype;
  v_cursor uuid;
  v_hops integer := 0;
begin
  if new.superseded_by_id is null
     or new.superseded_by_id is not distinct from old.superseded_by_id then
    return new;
  end if;

  select * into v_replacement
  from public.source_crosswalks c
  where c.id = new.superseded_by_id;

  if v_replacement.id is null then
    raise exception 'replacement crosswalk does not exist' using errcode = '42501';
  end if;

  if v_replacement.workspace_id <> new.workspace_id then
    -- Same error as "not found": never confirm a foreign row's existence.
    raise exception 'replacement crosswalk does not exist' using errcode = '42501';
  end if;

  if v_replacement.source_record_id <> new.source_record_id then
    raise exception
      'a replacement must re-interpret the same source record (expected %, got %)',
      new.source_record_id, v_replacement.source_record_id
      using errcode = 'check_violation';
  end if;

  if v_replacement.proposed_entity_type <> new.proposed_entity_type then
    raise exception
      'a replacement must propose the same entity type (expected %, got %)',
      new.proposed_entity_type, v_replacement.proposed_entity_type
      using errcode = 'check_violation';
  end if;

  if v_replacement.review_state <> 'candidate' then
    raise exception 'a replacement crosswalk must itself still be a candidate (it is %)',
      v_replacement.review_state
      using errcode = 'check_violation';
  end if;

  -- Cycle detection: walk forward from the replacement. If the chain leads
  -- back to the row being superseded, the link would close a loop and the
  -- history would no longer be reconstructable.
  v_cursor := v_replacement.superseded_by_id;
  while v_cursor is not null loop
    v_hops := v_hops + 1;
    if v_cursor = new.id then
      raise exception 'supersession would create a cycle' using errcode = 'check_violation';
    end if;
    -- Defensive bound: the unique indexes make an unbounded chain impossible,
    -- but never spin forever on unexpected data.
    if v_hops > 1000 then
      raise exception 'supersession chain is implausibly long' using errcode = 'check_violation';
    end if;
    select c.superseded_by_id into v_cursor
    from public.source_crosswalks c
    where c.id = v_cursor;
  end loop;

  return new;
end
$$;

revoke all on function app.enforce_supersession_coherence() from public;

create trigger source_crosswalks_supersession_coherence
  before update on public.source_crosswalks
  for each row execute function app.enforce_supersession_coherence();

-- Preview isolation ----------------------------------------------------------------
-- Preview must not mutate committed provenance. Source records, crosswalks and
-- issues may only ever attach to a job that is still in preview (the ingest
-- transaction) or that reached committed — never to a failed job, and never
-- retroactively to a job whose lifecycle already closed.
-- The lookup is keyed on BOTH the job id and the row's own workspace_id, so a
-- caller cannot use this trigger as an oracle: naming a job from another
-- workspace yields the same "does not exist" error as naming a job that was
-- never created, disclosing neither its existence nor its status. (The
-- composite foreign key would reject the row anyway, but the trigger fires
-- first, so it must not leak on its own.)
create function app.enforce_child_job_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_status public.import_job_status;
begin
  select j.status into job_status
  from public.import_jobs j
  where j.id = new.import_job_id
    and j.workspace_id = new.workspace_id;

  if job_status is null then
    raise exception 'import job does not exist in this workspace'
      using errcode = 'foreign_key_violation';
  end if;

  if job_status <> 'preview' then
    raise exception
      'this import is % and can no longer accept new %; a correction requires a new import',
      job_status, tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function app.enforce_child_job_open() from public;

create trigger source_records_job_open
  before insert on public.source_records
  for each row execute function app.enforce_child_job_open();

create trigger data_quality_issues_job_open
  before insert on public.data_quality_issues
  for each row execute function app.enforce_child_job_open();

insert into public.schema_migrations_log (migration_name)
values ('20260719000700_provenance_append_only');
