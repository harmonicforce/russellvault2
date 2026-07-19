-- Phase 3 source/import provenance — migration 7: append-only enforcement,
-- governed-identity immutability, and crosswalk state governance.
--
-- Append-only here means DATABASE-ENFORCED, not merely un-granted. Three
-- independent layers protect historical facts:
--   1. grants     — authenticated never receives UPDATE/DELETE (migration 8);
--   2. RLS        — no UPDATE/DELETE policy exists at all (migration 8);
--   3. triggers   — this file. A BEFORE UPDATE OR DELETE trigger raises for
--                   EVERY caller, including the table owner, postgres, and
--                   service_role, so a privileged connection cannot quietly
--                   rewrite history either.
--
-- Layer 3 is what makes the guarantee real: layers 1 and 2 are bypassed by any
-- superuser or BYPASSRLS role, and the local Supabase stack ships several.

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

-- Preview isolation ----------------------------------------------------------------
-- Preview must not mutate committed provenance. Source records, crosswalks and
-- issues may only ever attach to a job that is still in preview (the ingest
-- transaction) or that reached committed — never to a failed job, and never
-- retroactively to a job whose lifecycle already closed.
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
  where j.id = new.import_job_id;

  if job_status is null then
    raise exception 'import job % does not exist', new.import_job_id
      using errcode = 'foreign_key_violation';
  end if;

  if job_status <> 'preview' then
    raise exception
      'import job % is % and can no longer accept new %; a correction requires a new import',
      new.import_job_id, job_status, tg_table_name
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
