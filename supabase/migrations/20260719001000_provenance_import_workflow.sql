-- Phase 3 source/import provenance — migration 10: the governed import
-- persistence workflow.
--
-- WHY STAGED BATCHES
-- The largest repository fixture is 2,149 rows (~1.3 MB of raw JSON), and a
-- future SQLite or Excel export will be larger. Committing that as one HTTP
-- request and one giant RPC argument is not realistic, so the workflow is a
-- staged batch upload finished by a transactional finalize:
--
--   begin_import_job          open a commit-mode job (status 'preview')
--   stage_source_records      raw rows, in batches, idempotent per row index
--   stage_external_identifiers scoped aliases, in batches, idempotent
--   stage_import_derivatives  issues + candidate crosswalks, atomic, idempotent
--   finalize_import_job       verify every count, then mark committed
--   fail_import_job           mark a doomed attempt failed, visibly
--
-- ORDERING IS ENFORCED, NOT ASSUMED
-- Raw source records are always written first. Derivatives are addressed by
-- source_row_index and are resolved against already-persisted source_records;
-- if the raw row is not there yet, the derivative is refused. Committed status
-- is set last, and only by finalize_import_job.
--
-- NO PARTIALLY-POPULATED COMMITTED JOB CAN EXIST
-- finalize_import_job recounts what is actually stored and compares it against
-- both the job header and the caller's expectations. Any mismatch raises, the
-- transaction rolls back, and the job stays 'preview' — visibly uncommitted and
-- resumable. Status only ever advances preview -> committed | failed, enforced
-- by the migration 7 trigger.
--
-- IDEMPOTENCY
-- begin_import_job returns the existing job for a repeated idempotency key
-- rather than creating a second one, so an interrupted upload resumes instead
-- of duplicating. Row staging is ON CONFLICT DO NOTHING against the
-- (workspace, job, row index) unique key. finalize refuses a second committed
-- job for the same (workspace, source system, content hash, parser, mapping)
-- identity, with the partial unique index as the backstop if two racing
-- finalizes get that far.
--
-- Every function authorizes as part of its lookup (see migration 9) and is
-- granted to `authenticated` only.

-- Batch ceiling. Keeps any single RPC argument bounded regardless of caller.
create function app.assert_batch_size(p_batch jsonb, p_max integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'array' then
    raise exception 'batch must be a JSON array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_batch);
  if v_count > p_max then
    raise exception 'batch of % exceeds the maximum of % rows', v_count, p_max
      using errcode = '22023';
  end if;
  return v_count;
end
$$;

revoke all on function app.assert_batch_size(jsonb, integer) from public;

-- Owner-only source-system registration -----------------------------------------
create function public.register_source_system(
  p_workspace_id uuid,
  p_public_id text,
  p_kind text,
  p_instance_label text,
  p_description text default null,
  p_config jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_workspace uuid;
  v_id uuid;
begin
  v_uid := app.require_uid();

  -- Owner-only, resolved as part of the lookup.
  select m.workspace_id into v_workspace
  from public.workspace_members m
  where m.workspace_id = p_workspace_id
    and m.user_id = v_uid
    and m.role = 'owner';

  if v_workspace is null then
    raise exception 'workspace not found or not authorized' using errcode = '42501';
  end if;

  insert into public.source_systems (
    workspace_id, public_id, kind, instance_label, description, config, created_by
  )
  values (
    p_workspace_id, p_public_id, p_kind, p_instance_label, p_description,
    coalesce(p_config, '{}'::jsonb), v_uid
  )
  returning id into v_id;

  perform app.log_audit_event(
    p_workspace_id, 'source_system_registered', 'source_systems', v_id, v_uid,
    'provenance.registry', null, null, null,
    jsonb_build_object('public_id', p_public_id, 'kind', p_kind)
  );

  return v_id;
end
$$;

revoke all on function public.register_source_system(uuid, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.register_source_system(uuid, text, text, text, text, jsonb)
  to authenticated;

-- Open a governed import job ------------------------------------------------------
-- Returns {id, status, resumed}. `resumed` is true when an existing job was
-- returned for a repeated idempotency key rather than a new one created.
create function public.begin_import_job(
  p_workspace_id uuid,
  p_source_system_id uuid,
  p_source_label text,
  p_file_sha256 text,
  p_content_sha256 text,
  p_parser_version text,
  p_mapping_version text,
  p_idempotency_key text,
  p_source_row_count integer,
  p_source_totals jsonb default '{}'::jsonb,
  p_public_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_source_system uuid;
  v_existing public.import_jobs%rowtype;
  v_id uuid;
  v_public_id text;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'an idempotency key is required to open a commit import'
      using errcode = '22023';
  end if;
  if p_workspace_id is null or p_source_system_id is null then
    raise exception 'workspace id and source system id are required' using errcode = '22023';
  end if;
  if p_source_row_count is null or p_source_row_count < 0 then
    raise exception 'a non-negative source row count is required' using errcode = '22023';
  end if;

  v_uid := app.require_uid();

  -- Authorization AND source-system ownership resolved in one lookup: the
  -- source system must belong to the same workspace the caller may write to.
  -- A foreign source system is simply not returned.
  select s.id into v_source_system
  from public.source_systems s
  join public.workspace_members m
    on m.workspace_id = s.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where s.id = p_source_system_id
    and s.workspace_id = p_workspace_id
    and s.active;

  if v_source_system is null then
    raise exception 'source system not found or not authorized' using errcode = '42501';
  end if;

  -- Idempotent resume: the same key returns the same job.
  select * into v_existing
  from public.import_jobs j
  where j.workspace_id = p_workspace_id
    and j.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    -- The key must describe the same artifact; reusing it for different
    -- content would silently retarget a committed import.
    if v_existing.content_sha256 <> p_content_sha256
       or v_existing.parser_version <> p_parser_version
       or v_existing.mapping_version <> p_mapping_version
       or v_existing.source_system_id <> p_source_system_id then
      raise exception
        'idempotency key is already bound to a different source, hash, or version'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.status,
      'resumed', true
    );
  end if;

  -- Refuse to even open a job whose identity is already committed.
  if exists (
    select 1 from public.import_jobs j
    where j.workspace_id = p_workspace_id
      and j.source_system_id = p_source_system_id
      and j.content_sha256 = p_content_sha256
      and j.parser_version = p_parser_version
      and j.mapping_version = p_mapping_version
      and j.status = 'committed'
  ) then
    raise exception
      'an identical import (same source, content hash, parser and mapping version) is already committed'
      using errcode = 'unique_violation';
  end if;

  v_public_id := coalesce(
    p_public_id,
    'IMP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  );

  insert into public.import_jobs (
    workspace_id, public_id, source_system_id, source_label,
    file_sha256, content_sha256, parser_version, mapping_version,
    idempotency_key, mode, status, source_row_count, source_totals,
    actor_user_id, actor_process
  )
  values (
    p_workspace_id, v_public_id, p_source_system_id, p_source_label,
    p_file_sha256, p_content_sha256, p_parser_version, p_mapping_version,
    p_idempotency_key, 'commit', 'preview', p_source_row_count,
    coalesce(p_source_totals, '{}'::jsonb), v_uid, 'provenance.import'
  )
  returning id into v_id;

  perform app.log_audit_event(
    p_workspace_id, 'import_started', 'import_jobs', v_id, v_uid, 'provenance.import',
    v_id, null, null,
    jsonb_build_object(
      'source_label', p_source_label,
      'content_sha256', p_content_sha256,
      'parser_version', p_parser_version,
      'mapping_version', p_mapping_version,
      'expected_source_rows', p_source_row_count
    )
  );

  return jsonb_build_object('id', v_id, 'status', 'preview', 'resumed', false);
end
$$;

revoke all on function public.begin_import_job(
  uuid, uuid, text, text, text, text, text, text, integer, jsonb, text
) from public, anon;
grant execute on function public.begin_import_job(
  uuid, uuid, text, text, text, text, text, text, integer, jsonb, text
) to authenticated;

-- Internal: resolve an open, writable job for the caller -------------------------
-- Authorization is part of the lookup; the job is locked only after the join
-- has proved the caller may write to its workspace.
create function app.open_job_for_caller(p_import_job_id uuid, p_uid uuid)
returns public.import_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.import_jobs%rowtype;
begin
  select j.* into v_job
  from public.import_jobs j
  join public.workspace_members m
    on m.workspace_id = j.workspace_id
   and m.user_id = p_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where j.id = p_import_job_id
  for update of j;

  if v_job.id is null then
    raise exception 'import job not found or not authorized' using errcode = '42501';
  end if;
  if v_job.mode <> 'commit' then
    raise exception 'this job is a preview and cannot receive staged rows'
      using errcode = 'check_violation';
  end if;
  if v_job.status <> 'preview' then
    raise exception 'this import is % and can no longer be staged', v_job.status
      using errcode = 'check_violation';
  end if;

  return v_job;
end
$$;

revoke all on function app.open_job_for_caller(uuid, uuid) from public;

-- Stage raw source records --------------------------------------------------------
-- The exact raw payload, written before anything derived from it. Idempotent
-- per (job, source_row_index), so a retried batch inserts nothing new.
create function public.stage_source_records(
  p_import_job_id uuid,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.import_jobs%rowtype;
  v_batch integer;
  v_inserted integer;
  v_total integer;
begin
  v_uid := app.require_uid();
  v_batch := app.assert_batch_size(p_records, 500);
  v_job := app.open_job_for_caller(p_import_job_id, v_uid);

  with incoming as (
    select
      (r->>'source_row_index')::integer as source_row_index,
      nullif(r->>'source_row_key', '') as source_row_key,
      r->'raw_payload' as raw_payload,
      r->>'normalized_hash' as normalized_hash,
      (r->>'parse_status')::public.source_parse_status as parse_status,
      case when jsonb_typeof(r->'parser_output') = 'null' then null
           else r->'parser_output' end as parser_output,
      coalesce(r->'errors', '[]'::jsonb) as errors,
      coalesce(r->'warnings', '[]'::jsonb) as warnings
    from jsonb_array_elements(p_records) as r
  ),
  ins as (
    insert into public.source_records (
      workspace_id, import_job_id, source_row_index, source_row_key,
      raw_payload, normalized_hash, parse_status, parser_output,
      parser_version, mapping_version, errors, warnings,
      created_by, created_by_process
    )
    select
      v_job.workspace_id, v_job.id, i.source_row_index, i.source_row_key,
      i.raw_payload, i.normalized_hash, i.parse_status, i.parser_output,
      v_job.parser_version, v_job.mapping_version, i.errors, i.warnings,
      v_uid, 'provenance.import'
    from incoming i
    on conflict (workspace_id, import_job_id, source_row_index) do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from ins;

  select count(*)::integer into v_total
  from public.source_records sr
  where sr.import_job_id = v_job.id;

  -- Never let staging exceed what the job declared.
  if v_total > v_job.source_row_count then
    raise exception 'staged % rows but the job declared only %',
      v_total, v_job.source_row_count
      using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'batch', v_batch, 'inserted', v_inserted, 'staged_total', v_total
  );
end
$$;

revoke all on function public.stage_source_records(uuid, jsonb) from public, anon;
grant execute on function public.stage_source_records(uuid, jsonb) to authenticated;

-- Stage scoped external identifiers -------------------------------------------------
-- Addressed by source_row_index, so the raw row MUST already exist: the join
-- below yields nothing otherwise and the identifier is refused.
create function public.stage_external_identifiers(
  p_import_job_id uuid,
  p_identifiers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.import_jobs%rowtype;
  v_batch integer;
  v_inserted integer;
  v_unresolved integer;
begin
  v_uid := app.require_uid();
  v_batch := app.assert_batch_size(p_identifiers, 500);
  v_job := app.open_job_for_caller(p_import_job_id, v_uid);

  -- Ordering guard: every identifier must resolve to an already-persisted raw
  -- record of this job.
  select count(*)::integer into v_unresolved
  from jsonb_array_elements(p_identifiers) as r
  where not exists (
    select 1 from public.source_records sr
    where sr.import_job_id = v_job.id
      and sr.source_row_index = (r->>'source_row_index')::integer
  );

  if v_unresolved > 0 then
    raise exception
      '% identifier(s) reference a raw source row that has not been staged yet; '
      'raw records must be written first',
      v_unresolved
      using errcode = 'check_violation';
  end if;

  with ins as (
    insert into public.external_identifiers (
      workspace_id, source_system_id, scope, identifier_type, identifier_value,
      source_record_id, created_by_process
    )
    select
      v_job.workspace_id, v_job.source_system_id,
      r->>'scope', r->>'identifier_type', r->>'identifier_value',
      sr.id, 'provenance.import'
    from jsonb_array_elements(p_identifiers) as r
    join public.source_records sr
      on sr.import_job_id = v_job.id
     and sr.source_row_index = (r->>'source_row_index')::integer
    on conflict (workspace_id, source_system_id, scope, identifier_type, identifier_value)
      do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from ins;

  return jsonb_build_object('batch', v_batch, 'inserted', v_inserted);
end
$$;

revoke all on function public.stage_external_identifiers(uuid, jsonb) from public, anon;
grant execute on function public.stage_external_identifiers(uuid, jsonb) to authenticated;

-- Stage issues and candidate crosswalks ----------------------------------------------
-- One atomic call per job. Idempotent: if this job already has derivatives, the
-- call is a no-op that reports the existing counts, so a retry cannot double
-- them. Crosswalks are inserted WITHOUT a review_state, so the migration 7
-- trigger's candidate-only rule applies with no way to request otherwise.
create function public.stage_import_derivatives(
  p_import_job_id uuid,
  p_issues jsonb default '[]'::jsonb,
  p_crosswalks jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.import_jobs%rowtype;
  v_existing_issues integer;
  v_existing_crosswalks integer;
  v_issues integer;
  v_crosswalks integer;
  v_unresolved integer;
begin
  v_uid := app.require_uid();
  perform app.assert_batch_size(p_issues, 2000);
  perform app.assert_batch_size(p_crosswalks, 2000);
  v_job := app.open_job_for_caller(p_import_job_id, v_uid);

  select count(*)::integer into v_existing_issues
  from public.data_quality_issues i where i.import_job_id = v_job.id;

  select count(*)::integer into v_existing_crosswalks
  from public.source_crosswalks c
  join public.source_records sr on sr.id = c.source_record_id
  where sr.import_job_id = v_job.id;

  if v_existing_issues > 0 or v_existing_crosswalks > 0 then
    return jsonb_build_object(
      'issues', v_existing_issues, 'crosswalks', v_existing_crosswalks, 'skipped', true
    );
  end if;

  -- Ordering guard for crosswalks: each must attach to a staged raw record.
  select count(*)::integer into v_unresolved
  from jsonb_array_elements(p_crosswalks) as r
  where not exists (
    select 1 from public.source_records sr
    where sr.import_job_id = v_job.id
      and sr.source_row_index = (r->>'source_row_index')::integer
  );
  if v_unresolved > 0 then
    raise exception
      '% crosswalk candidate(s) reference an unstaged raw source row', v_unresolved
      using errcode = 'check_violation';
  end if;

  with ins as (
    insert into public.data_quality_issues (
      workspace_id, import_job_id, source_record_id, issue_type, severity,
      message, detail, raw_payload_snapshot, created_by_process
    )
    select
      v_job.workspace_id, v_job.id, sr.id,
      r->>'issue_type', coalesce(r->>'severity', 'error'),
      r->>'message', coalesce(r->'detail', '{}'::jsonb),
      case when jsonb_typeof(r->'raw_payload_snapshot') = 'null' then null
           else r->'raw_payload_snapshot' end,
      'provenance.import'
    from jsonb_array_elements(p_issues) as r
    left join public.source_records sr
      on sr.import_job_id = v_job.id
     and r->>'source_row_index' is not null
     and sr.source_row_index = (r->>'source_row_index')::integer
    returning 1
  )
  select count(*)::integer into v_issues from ins;

  with ins as (
    insert into public.source_crosswalks (
      workspace_id, source_record_id, proposed_entity_type, proposed_entity_key,
      confidence, match_method, evidence, created_by_process
    )
    select
      v_job.workspace_id, sr.id,
      r->>'proposed_entity_type', r->>'proposed_entity_key',
      (r->>'confidence')::numeric,
      (r->>'match_method')::public.crosswalk_method,
      coalesce(r->'evidence', '{}'::jsonb),
      'provenance.import'
    from jsonb_array_elements(p_crosswalks) as r
    join public.source_records sr
      on sr.import_job_id = v_job.id
     and sr.source_row_index = (r->>'source_row_index')::integer
    returning 1
  )
  select count(*)::integer into v_crosswalks from ins;

  return jsonb_build_object(
    'issues', v_issues, 'crosswalks', v_crosswalks, 'skipped', false
  );
end
$$;

revoke all on function public.stage_import_derivatives(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.stage_import_derivatives(uuid, jsonb, jsonb) to authenticated;

-- Finalize -----------------------------------------------------------------------------
-- The ONLY path to committed status. Recounts what is actually stored and
-- refuses to commit anything incomplete or inconsistent, so a partially
-- populated job can never be marked committed.
create function public.finalize_import_job(
  p_import_job_id uuid,
  p_idempotency_key text,
  p_expected_source_rows integer,
  p_expected_accepted_rows integer,
  p_expected_issue_rows integer,
  p_expected_crosswalks integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_job public.import_jobs%rowtype;
  v_records integer;
  v_accepted integer;
  v_malformed integer;
  v_issue_rows integer;
  v_issues integer;
  v_crosswalks integer;
  v_identifiers integer;
  v_non_candidate integer;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'an idempotency key is required to commit an import'
      using errcode = '22023';
  end if;

  v_uid := app.require_uid();
  -- open_job_for_caller authorizes, locks, and rejects a job that is not an
  -- open commit-mode job (including one already committed).
  v_job := app.open_job_for_caller(p_import_job_id, v_uid);

  if v_job.idempotency_key <> p_idempotency_key then
    raise exception 'idempotency key does not match this import job' using errcode = '22023';
  end if;

  -- Recount what is ACTUALLY stored.
  select
    count(*)::integer,
    count(*) filter (where sr.parse_status = 'parsed')::integer,
    count(*) filter (where sr.parse_status = 'malformed')::integer
  into v_records, v_accepted, v_malformed
  from public.source_records sr
  where sr.import_job_id = v_job.id;

  select count(*)::integer,
         count(distinct i.source_record_id)::integer
  into v_issues, v_issue_rows
  from public.data_quality_issues i
  where i.import_job_id = v_job.id;

  select count(*)::integer into v_crosswalks
  from public.source_crosswalks c
  join public.source_records sr on sr.id = c.source_record_id
  where sr.import_job_id = v_job.id;

  select count(*)::integer into v_identifiers
  from public.external_identifiers e
  join public.source_records sr on sr.id = e.source_record_id
  where sr.import_job_id = v_job.id;

  -- Completeness: every declared row must actually be present.
  if v_records <> v_job.source_row_count then
    raise exception
      'incomplete import: % of % declared source rows are staged; not committing',
      v_records, v_job.source_row_count
      using errcode = 'check_violation';
  end if;

  -- Consistency with the caller's own expectations.
  if p_expected_source_rows is distinct from v_records then
    raise exception 'expected % source rows but % are stored',
      p_expected_source_rows, v_records using errcode = 'check_violation';
  end if;
  if p_expected_accepted_rows is distinct from v_accepted then
    raise exception 'expected % accepted rows but % are stored',
      p_expected_accepted_rows, v_accepted using errcode = 'check_violation';
  end if;
  if p_expected_issue_rows is distinct from v_issue_rows then
    raise exception 'expected % issue rows but % are stored',
      p_expected_issue_rows, v_issue_rows using errcode = 'check_violation';
  end if;
  if p_expected_crosswalks is not null and p_expected_crosswalks <> v_crosswalks then
    raise exception 'expected % crosswalk candidates but % are stored',
      p_expected_crosswalks, v_crosswalks using errcode = 'check_violation';
  end if;

  -- Every malformed row must have produced an issue, so evidence is never lost.
  if v_malformed > 0 and v_issues = 0 then
    raise exception 'malformed rows are staged but no data-quality issue was recorded'
      using errcode = 'check_violation';
  end if;

  -- No import may commit while carrying a pre-decided mapping.
  select count(*)::integer into v_non_candidate
  from public.source_crosswalks c
  join public.source_records sr on sr.id = c.source_record_id
  where sr.import_job_id = v_job.id
    and c.review_state <> 'candidate';
  if v_non_candidate > 0 then
    raise exception 'an import cannot commit with % non-candidate crosswalk(s)', v_non_candidate
      using errcode = 'check_violation';
  end if;

  -- Last guard against a racing duplicate identity.
  if exists (
    select 1 from public.import_jobs j
    where j.workspace_id = v_job.workspace_id
      and j.source_system_id = v_job.source_system_id
      and j.content_sha256 = v_job.content_sha256
      and j.parser_version = v_job.parser_version
      and j.mapping_version = v_job.mapping_version
      and j.status = 'committed'
      and j.id <> v_job.id
  ) then
    raise exception 'an identical import is already committed' using errcode = 'unique_violation';
  end if;

  update public.import_jobs
  set status = 'committed',
      completed_at = now(),
      accepted_row_count = v_accepted,
      issue_row_count = v_issue_rows
  where id = v_job.id;

  perform app.log_audit_event(
    v_job.workspace_id, 'import_committed', 'import_jobs', v_job.id, v_uid,
    'provenance.import', v_job.id, null, null,
    jsonb_build_object(
      'content_sha256', v_job.content_sha256,
      'parser_version', v_job.parser_version,
      'mapping_version', v_job.mapping_version,
      'source_row_count', v_records,
      'accepted_row_count', v_accepted,
      'issue_row_count', v_issue_rows,
      'crosswalk_candidates', v_crosswalks,
      'external_identifiers', v_identifiers
    )
  );

  return jsonb_build_object(
    'id', v_job.id,
    'status', 'committed',
    'source_rows', v_records,
    'accepted_rows', v_accepted,
    'issue_rows', v_issue_rows,
    'issues', v_issues,
    'crosswalks', v_crosswalks,
    'external_identifiers', v_identifiers
  );
end
$$;

revoke all on function public.finalize_import_job(uuid, text, integer, integer, integer, integer)
  from public, anon;
grant execute on function public.finalize_import_job(uuid, text, integer, integer, integer, integer)
  to authenticated;

-- Fail an attempt visibly ------------------------------------------------------------------
-- An interrupted or doomed upload is marked failed rather than left ambiguous.
-- It never becomes committed, its staged raw rows remain readable as evidence,
-- and a corrected run proceeds under a new idempotency key.
create function public.fail_import_job(
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
  v_job public.import_jobs%rowtype;
begin
  if p_failure_code is null or btrim(p_failure_code) = '' then
    raise exception 'a failure code is required' using errcode = '22023';
  end if;

  v_uid := app.require_uid();
  v_job := app.open_job_for_caller(p_import_job_id, v_uid);

  update public.import_jobs
  set status = 'failed',
      completed_at = now(),
      failure_code = p_failure_code,
      failure_detail = p_failure_detail
  where id = v_job.id;

  perform app.log_audit_event(
    v_job.workspace_id, 'import_failed', 'import_jobs', v_job.id, v_uid,
    'provenance.import', v_job.id, null, null,
    jsonb_build_object('failure_code', p_failure_code, 'failure_detail', p_failure_detail)
  );

  return v_job.id;
end
$$;

revoke all on function public.fail_import_job(uuid, text, text) from public, anon;
grant execute on function public.fail_import_job(uuid, text, text) to authenticated;

-- Least privilege for service_role on the governed entry points ---------------------------
-- Same class of gap as the table grants: a hosted Supabase project configures
-- DEFAULT PRIVILEGES on the public schema that grant EXECUTE on new functions
-- to anon, authenticated and service_role. Each function above revokes from
-- `public` and `anon` and grants `authenticated`, but service_role would
-- otherwise silently retain EXECUTE.
--
-- In practice a service-role JWT carries no `sub`, so auth.uid() is null and
-- every one of these functions refuses with 'authentication required' before
-- doing anything. This revoke removes the reliance on that second-order
-- argument and makes the restriction explicit and testable.
--
-- The app schema needs no equivalent: service_role is never granted USAGE on
-- it, so the internal helpers are unreachable regardless of any EXECUTE grant.
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
        'register_source_system', 'begin_import_job', 'stage_source_records',
        'stage_external_identifiers', 'stage_import_derivatives',
        'finalize_import_job', 'fail_import_job',
        'confirm_source_crosswalk', 'reject_source_crosswalk',
        'supersede_source_crosswalk', 'resolve_data_quality_issue')
  loop
    execute format('revoke all on function %s from service_role', v_signature);
  end loop;
end $$;

insert into public.schema_migrations_log (migration_name)
values ('20260719001000_provenance_import_workflow');
