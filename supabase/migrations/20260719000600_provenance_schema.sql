-- Phase 3 source/import provenance — migration 6: staging provenance schema.
--
-- Purpose: a reproducible, append-only import and crosswalk layer so repository
-- JSON fixtures, a future Railway SQLite export, future Excel control exports,
-- and future legacy Supabase rows can be compared WITHOUT silent merging or
-- overwriting.
--
-- Everything created here is STAGING and NON-AUTHORITATIVE. The deployed
-- legacy SQLite application remains the only authoritative business path.
-- This migration deliberately creates NO acquisition, cost-basis, COGS,
-- product, inventory, listing, sale, or marketplace-domain schema. Crosswalks
-- record a *proposed* canonical entity as loose type+key text; they never
-- create that entity and carry no foreign key to one.
--
-- Conventions inherited from Phase 2 (migrations 1-5):
--   * internal identity is a UUID primary key; the governed public business
--     identifier (public_id) is a separate, immutable, per-workspace column;
--   * workspace_id is NOT NULL and references public.workspaces;
--   * UNIQUE (id, workspace_id) lets children carry composite foreign keys so
--     cross-workspace relationships are impossible at the constraint level;
--   * evidence-bearing foreign keys are ON DELETE RESTRICT.
--
-- RETENTION AND DELETION RULES (enforced by grants/policies in migration 8):
--   * source_records   — permanent, immutable. Never UPDATEd, never DELETEd by
--                        any role. Corrections require a NEW import job or a
--                        new parser/mapping version, never an edit.
--   * audit_events     — permanent, immutable. Never UPDATEd, never DELETEd.
--   * import_jobs      — retained permanently as the header for their records;
--                        status may advance, identity fields may not change.
--                        Not deletable by any application role.
--   * source_crosswalks— retained permanently; corrections happen by
--                        SUPERSESSION (a new row) rather than by rewriting.
--                        Not deletable by any application role.
--   * data_quality_issues — retained permanently; resolved in place by state
--                        change, never deleted, and always retaining either a
--                        link to the immutable source record or an inline raw
--                        payload snapshot.
--   * external_identifiers — retained permanently; deactivated rather than
--                        deleted. Not deletable by any application role.
--   * source_systems   — owner-administered registry; deactivated via
--                        active=false. Deletion is blocked while any import
--                        job references the row (ON DELETE RESTRICT).

-- Secret-free configuration guard --------------------------------------------
-- source_systems describes *where* data came from. It must never hold
-- credentials. This IMMUTABLE helper backs a CHECK constraint that rejects
-- secret-bearing configuration keys at write time.
--
-- RECURSIVE: it descends through nested objects AND arrays, so a secret cannot
-- be smuggled in by burying it one level down (e.g. {"conn":{"password":"x"}}
-- or {"servers":[{"api_key":"x"}]}). Only the KEY NAME is inspected; values are
-- never examined, so this never depends on a value's shape.
create function app.has_secret_like_key(p_config jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_element jsonb;
begin
  if p_config is null then
    return false;
  end if;

  if jsonb_typeof(p_config) = 'object' then
    for v_key, v_value in select * from jsonb_each(p_config) loop
      if lower(v_key) ~ '(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|bearer|session[_-]?key|dsn|conn(ection)?[_-]?string|service[_-]?role)' then
        return true;
      end if;
      -- Descend: nested objects and arrays are checked too.
      if app.has_secret_like_key(v_value) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_config) = 'array' then
    for v_element in select * from jsonb_array_elements(p_config) loop
      if app.has_secret_like_key(v_element) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end
$$;

revoke all on function app.has_secret_like_key(jsonb) from public;
grant execute on function app.has_secret_like_key(jsonb) to authenticated;

-- Immutability helper ---------------------------------------------------------
-- Governed public IDs and provenance identity columns must not drift after
-- insert. Used as a BEFORE UPDATE trigger with the protected column names
-- passed as trigger arguments.
create function app.forbid_column_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
  old_val text;
  new_val text;
begin
  foreach col in array tg_argv loop
    execute format('select ($1).%I::text, ($2).%I::text', col, col)
      into old_val, new_val
      using old, new;
    if old_val is distinct from new_val then
      raise exception 'column %.% is immutable and cannot be changed', tg_table_name, col
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end
$$;

revoke all on function app.forbid_column_change() from public;

-- Append-only helper ----------------------------------------------------------
-- Database-enforced append-only: this refuses UPDATE and DELETE for EVERY
-- caller, including the table owner and service_role, so append-only does not
-- depend on grants or RLS alone. Grants and policies in migration 8 remove the
-- privilege as well; this trigger is the layer that cannot be bypassed by a
-- privileged connection.
create function app.forbid_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%.% is append-only: % is not permitted',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function app.forbid_update_delete() from public;

-- Enumerations ----------------------------------------------------------------
create type public.import_job_status as enum ('preview', 'committed', 'failed');
create type public.source_parse_status as enum ('parsed', 'malformed', 'skipped');
create type public.crosswalk_state as enum ('candidate', 'confirmed', 'rejected', 'superseded');
create type public.crosswalk_method as enum (
  'exact_key', 'content_hash', 'normalized_text', 'similarity', 'manual'
);
create type public.data_quality_status as enum ('open', 'acknowledged', 'resolved', 'wont_fix');

-- source_systems --------------------------------------------------------------
-- Governed registry of source types and instances. Stores NO credentials and
-- NO secrets; `config` is descriptive metadata only (e.g. a relative fixture
-- directory), guarded by a CHECK.
create table public.source_systems (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  kind text not null check (kind in (
    'repository_fixture',   -- deterministic JSON checked into this repository
    'sqlite_export',        -- a future exported snapshot file (not live access)
    'excel_export',         -- a future exported control workbook
    'legacy_supabase',      -- a future exported legacy row set
    'manual'                -- hand-entered staging observations
  )),
  instance_label text not null check (char_length(instance_label) between 1 and 200),
  description text check (description is null or char_length(description) <= 1000),
  active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, public_id),
  unique (id, workspace_id),
  constraint source_systems_config_is_object check (jsonb_typeof(config) = 'object'),
  constraint source_systems_config_no_secrets check (not app.has_secret_like_key(config))
);

create index source_systems_workspace_idx on public.source_systems (workspace_id);
create index source_systems_active_idx on public.source_systems (workspace_id, active);

-- import_jobs -----------------------------------------------------------------
-- One row per preview or commit attempt. Identity for idempotency is the
-- tuple (workspace, source system, content hash, parser version, mapping
-- version); a partial unique index makes a second COMMITTED job for that
-- tuple impossible, so re-running an identical file cannot silently duplicate.
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  source_system_id uuid not null,
  -- Original filename or object label exactly as presented by the source.
  source_label text not null check (char_length(source_label) between 1 and 400),
  -- SHA-256 of the raw bytes read from the source artifact.
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the canonicalized content actually parsed. Equal to
  -- file_sha256 when the bytes are consumed verbatim.
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text not null check (parser_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  mapping_version text not null check (mapping_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  -- Required for commit; preview rows carry a preview-scoped key.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  mode text not null check (mode in ('preview', 'commit')),
  status public.import_job_status not null default 'preview',
  status_changed_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  source_row_count integer not null default 0 check (source_row_count >= 0),
  accepted_row_count integer not null default 0 check (accepted_row_count >= 0),
  issue_row_count integer not null default 0 check (issue_row_count >= 0),
  -- Declared source-side totals (row counts, monetary sums) for reconciliation.
  source_totals jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users (id),
  actor_process text not null check (actor_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  failure_detail text check (failure_detail is null or char_length(failure_detail) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, public_id),
  unique (workspace_id, idempotency_key),
  unique (id, workspace_id),
  foreign key (source_system_id, workspace_id)
    references public.source_systems (id, workspace_id) on delete restrict,
  constraint import_jobs_totals_is_object check (jsonb_typeof(source_totals) = 'object'),
  constraint import_jobs_counts_consistent
    check (accepted_row_count + issue_row_count <= source_row_count),
  constraint import_jobs_failure_detail_present
    check ((status = 'failed') = (failure_code is not null)),
  constraint import_jobs_commit_mode
    check (status <> 'committed' or mode = 'commit'),
  constraint import_jobs_completed_after_start
    check (completed_at is null or completed_at >= started_at)
);

create index import_jobs_workspace_idx on public.import_jobs (workspace_id);
create index import_jobs_source_system_idx on public.import_jobs (source_system_id);
-- Operational review listing: newest first within a workspace.
create index import_jobs_workspace_started_idx
  on public.import_jobs (workspace_id, started_at desc);
create index import_jobs_status_idx on public.import_jobs (workspace_id, status);
-- Fast "have we already seen this exact artifact?" probe.
create index import_jobs_content_identity_idx
  on public.import_jobs (workspace_id, content_sha256, parser_version, mapping_version);

-- THE idempotency guarantee: at most one COMMITTED job per identity tuple.
create unique index import_jobs_committed_identity_uidx
  on public.import_jobs (workspace_id, source_system_id, content_sha256, parser_version, mapping_version)
  where status = 'committed';

-- source_records --------------------------------------------------------------
-- The exact raw source payload, persisted BEFORE any transformation.
-- APPEND-ONLY: never UPDATEd, never DELETEd, by anyone (see migration 7).
create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  import_job_id uuid not null,
  -- Position in the source artifact; stable for re-import comparison.
  source_row_index integer not null check (source_row_index >= 0),
  -- Natural key as it appeared in the source, when the source has one.
  -- Never treated as a canonical identifier.
  source_row_key text check (source_row_key is null or char_length(source_row_key) <= 400),
  -- The exact raw payload. Kept verbatim; transformation output lives in
  -- parser_output so the original is always recoverable.
  raw_payload jsonb not null,
  -- Verbatim original text when the source row was not natively JSON.
  raw_text text,
  -- SHA-256 over the canonicalized payload; identical rows hash identically.
  normalized_hash text not null check (normalized_hash ~ '^[0-9a-f]{64}$'),
  parse_status public.source_parse_status not null,
  parser_output jsonb,
  parser_version text not null check (parser_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  mapping_version text not null check (mapping_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  unique (workspace_id, import_job_id, source_row_index),
  unique (id, workspace_id),
  foreign key (import_job_id, workspace_id)
    references public.import_jobs (id, workspace_id) on delete restrict,
  constraint source_records_errors_is_array check (jsonb_typeof(errors) = 'array'),
  constraint source_records_warnings_is_array check (jsonb_typeof(warnings) = 'array'),
  -- A malformed row must say why; a parsed row must have produced output.
  constraint source_records_malformed_has_errors
    check (parse_status <> 'malformed' or jsonb_array_length(errors) > 0),
  constraint source_records_parsed_has_output
    check (parse_status <> 'parsed' or parser_output is not null)
);

create index source_records_workspace_idx on public.source_records (workspace_id);
create index source_records_job_idx on public.source_records (import_job_id, source_row_index);
create index source_records_hash_idx on public.source_records (workspace_id, normalized_hash);
create index source_records_parse_status_idx
  on public.source_records (workspace_id, parse_status);
create index source_records_row_key_idx
  on public.source_records (workspace_id, source_row_key)
  where source_row_key is not null;

-- external_identifiers --------------------------------------------------------
-- Scoped aliases observed in sources. Deliberately NOT unique globally and
-- NEVER promoted to a canonical primary key: identity is the surrogate UUID,
-- and the same-looking string in two scopes stays two separate rows.
create table public.external_identifiers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  source_system_id uuid not null,
  -- The namespace the value is meaningful within (e.g. 'whatnot.order').
  scope text not null check (scope ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  identifier_type text not null check (identifier_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  identifier_value text not null check (char_length(identifier_value) between 1 and 400),
  -- Provenance: the immutable raw row this alias was observed in.
  source_record_id uuid,
  observation_count integer not null default 1 check (observation_count >= 1),
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  -- Uniqueness is SCOPED, never global: the same value in a different scope,
  -- type, or source system is a different alias, not the same identity.
  unique (workspace_id, source_system_id, scope, identifier_type, identifier_value),
  unique (id, workspace_id),
  foreign key (source_system_id, workspace_id)
    references public.source_systems (id, workspace_id) on delete restrict,
  foreign key (source_record_id, workspace_id)
    references public.source_records (id, workspace_id) on delete restrict,
  constraint external_identifiers_seen_order check (last_seen_at >= first_seen_at)
);

create index external_identifiers_workspace_idx on public.external_identifiers (workspace_id);
create index external_identifiers_lookup_idx
  on public.external_identifiers (workspace_id, identifier_type, identifier_value);
create index external_identifiers_source_record_idx
  on public.external_identifiers (source_record_id);

-- source_crosswalks -----------------------------------------------------------
-- Reviewed source-to-canonical mapping. The proposed canonical entity is
-- recorded as loose type + key TEXT and is deliberately NOT a foreign key:
-- this phase records intent to map, and creates no canonical entity at all.
create table public.source_crosswalks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  source_record_id uuid not null,
  -- Intent only. No table of this name is created in Phase 3.
  proposed_entity_type text not null check (proposed_entity_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  proposed_entity_key text not null check (char_length(proposed_entity_key) between 1 and 400),
  confidence numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  match_method public.crosswalk_method not null,
  evidence jsonb not null default '{}'::jsonb,
  review_state public.crosswalk_state not null default 'candidate',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  -- Supersession history: the row that replaced this one, and why.
  superseded_by_id uuid,
  superseded_at timestamptz,
  supersedes_id uuid,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (source_record_id, workspace_id)
    references public.source_records (id, workspace_id) on delete restrict,
  foreign key (superseded_by_id, workspace_id)
    references public.source_crosswalks (id, workspace_id) on delete restrict,
  foreign key (supersedes_id, workspace_id)
    references public.source_crosswalks (id, workspace_id) on delete restrict,
  constraint source_crosswalks_evidence_is_object check (jsonb_typeof(evidence) = 'object'),
  -- A candidate has not been reviewed by anyone, by definition.
  constraint source_crosswalks_candidate_unreviewed
    check (review_state <> 'candidate' or (reviewed_by is null and reviewed_at is null)),
  -- Confirmation and rejection are human acts and must name the reviewer.
  constraint source_crosswalks_decision_has_reviewer
    check (review_state not in ('confirmed', 'rejected')
           or (reviewed_by is not null and reviewed_at is not null)),
  -- Supersession must point at the replacement.
  constraint source_crosswalks_superseded_has_successor
    check ((review_state = 'superseded')
           = (superseded_by_id is not null and superseded_at is not null)),
  constraint source_crosswalks_no_self_supersede
    check (superseded_by_id is distinct from id and supersedes_id is distinct from id)
);

create index source_crosswalks_workspace_idx on public.source_crosswalks (workspace_id);
create index source_crosswalks_source_record_idx on public.source_crosswalks (source_record_id);
create index source_crosswalks_state_idx on public.source_crosswalks (workspace_id, review_state);
create index source_crosswalks_proposed_idx
  on public.source_crosswalks (workspace_id, proposed_entity_type, proposed_entity_key);
create index source_crosswalks_superseded_by_idx on public.source_crosswalks (superseded_by_id);

-- At most one live CONFIRMED mapping per source record + proposed entity type.
-- Superseded/rejected history is unconstrained so it accumulates freely.
create unique index source_crosswalks_one_confirmed_uidx
  on public.source_crosswalks (workspace_id, source_record_id, proposed_entity_type)
  where review_state = 'confirmed';

-- Supersession must form LINEAR CHAINS, never a branching or converging graph:
--   * a given replacement row succeeds at most one superseded row, and
--   * a given superseded row has at most one successor.
-- Together these forbid "one replacement row serving as the successor to
-- multiple unrelated rows" and any fan-in/fan-out shape. Cycles and the
-- same-record / same-entity-type requirements are enforced by the
-- app.enforce_supersession_coherence trigger in migration 7, which can see
-- both rows.
create unique index source_crosswalks_one_successor_uidx
  on public.source_crosswalks (superseded_by_id)
  where superseded_by_id is not null;

create unique index source_crosswalks_one_predecessor_uidx
  on public.source_crosswalks (supersedes_id)
  where supersedes_id is not null;

-- audit_events ----------------------------------------------------------------
-- APPEND-ONLY log of import, preview, commit, review, rejection, supersession,
-- and issue-resolution actions. Never UPDATEd, never DELETEd (see migration 7).
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  -- Monotonic ordering independent of clock skew.
  event_seq bigint generated always as identity,
  event_type text not null check (event_type in (
    'source_system_registered',
    'import_previewed',
    -- A commit-mode job opened for staging. Emitted before any raw row is
    -- written, so an interrupted upload still leaves a visible trail.
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
    'issue_wont_fix'
  )),
  subject_table text not null check (subject_table ~ '^[a-z][a-z0-9_]{1,63}$'),
  subject_id uuid,
  import_job_id uuid,
  source_record_id uuid,
  crosswalk_id uuid,
  actor_user_id uuid references auth.users (id),
  actor_process text not null check (actor_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- Composite FKs keep audit rows inside their own workspace. ON DELETE
  -- RESTRICT: an audited subject can never be removed out from under its log.
  foreign key (import_job_id, workspace_id)
    references public.import_jobs (id, workspace_id) on delete restrict,
  foreign key (source_record_id, workspace_id)
    references public.source_records (id, workspace_id) on delete restrict,
  foreign key (crosswalk_id, workspace_id)
    references public.source_crosswalks (id, workspace_id) on delete restrict,
  constraint audit_events_detail_is_object check (jsonb_typeof(detail) = 'object')
);

create index audit_events_workspace_idx on public.audit_events (workspace_id, event_seq desc);
create index audit_events_type_idx on public.audit_events (workspace_id, event_type);
create index audit_events_job_idx on public.audit_events (import_job_id);
create index audit_events_record_idx on public.audit_events (source_record_id);
create index audit_events_crosswalk_idx on public.audit_events (crosswalk_id);
create index audit_events_occurred_idx on public.audit_events (workspace_id, occurred_at desc);

-- data_quality_issues ---------------------------------------------------------
-- Malformed rows, conflicts, duplicate candidates, count/total discrepancies
-- and blocked mappings — always retaining the underlying raw payload, either
-- by reference to the immutable source record or as an inline snapshot when
-- the problem prevented a source record from being written at all.
create table public.data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  import_job_id uuid not null,
  source_record_id uuid,
  issue_type text not null check (issue_type in (
    'malformed_row',
    'conflict',
    'duplicate_candidate',
    'count_discrepancy',
    'total_discrepancy',
    'blocked_mapping',
    'missing_required'
  )),
  severity text not null default 'error' check (severity in ('info', 'warning', 'error')),
  message text not null check (char_length(message) between 1 and 2000),
  detail jsonb not null default '{}'::jsonb,
  -- Inline preservation of the exact raw payload when no source record exists.
  raw_payload_snapshot jsonb,
  status public.data_quality_status not null default 'open',
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  unique (id, workspace_id),
  foreign key (import_job_id, workspace_id)
    references public.import_jobs (id, workspace_id) on delete restrict,
  foreign key (source_record_id, workspace_id)
    references public.source_records (id, workspace_id) on delete restrict,
  constraint data_quality_issues_detail_is_object check (jsonb_typeof(detail) = 'object'),
  -- The raw payload is never lost: either the immutable record or a snapshot.
  constraint data_quality_issues_retains_payload
    check (source_record_id is not null or raw_payload_snapshot is not null),
  -- A terminal state must name who ended it.
  constraint data_quality_issues_resolution_attributed
    check (status not in ('resolved', 'wont_fix')
           or (resolved_by is not null and resolved_at is not null)),
  constraint data_quality_issues_open_unresolved
    check (status <> 'open' or (resolved_by is null and resolved_at is null))
);

create index data_quality_issues_workspace_idx on public.data_quality_issues (workspace_id);
create index data_quality_issues_job_idx on public.data_quality_issues (import_job_id);
create index data_quality_issues_record_idx on public.data_quality_issues (source_record_id);
create index data_quality_issues_open_idx
  on public.data_quality_issues (workspace_id, status, severity)
  where status = 'open';
create index data_quality_issues_type_idx on public.data_quality_issues (workspace_id, issue_type);

-- updated_at maintenance ------------------------------------------------------
-- Only mutable tables get this; source_records and audit_events are
-- append-only and deliberately have no updated_at column at all.
create trigger source_systems_touch_updated_at
  before update on public.source_systems
  for each row execute function app.touch_updated_at();
create trigger import_jobs_touch_updated_at
  before update on public.import_jobs
  for each row execute function app.touch_updated_at();
create trigger external_identifiers_touch_updated_at
  before update on public.external_identifiers
  for each row execute function app.touch_updated_at();
create trigger source_crosswalks_touch_updated_at
  before update on public.source_crosswalks
  for each row execute function app.touch_updated_at();
create trigger data_quality_issues_touch_updated_at
  before update on public.data_quality_issues
  for each row execute function app.touch_updated_at();

insert into public.schema_migrations_log (migration_name)
values ('20260719000600_provenance_schema');
