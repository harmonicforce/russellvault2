-- Phase 3 source/import provenance — migration 9: governed review functions.
--
-- Every public entry point here is SECURITY DEFINER with a fixed EMPTY
-- search_path (all references schema-qualified), performs authentication and
-- workspace-role authorization INTERNALLY before taking any lock, validates
-- its inputs, and is executable only by the authenticated role — never by
-- anon or PUBLIC. None can act across workspaces: the workspace is resolved
-- from the target row and then checked against the caller's own membership.
--
-- Authorize-before-lock: each function reads the row's workspace WITHOUT a
-- lock, authorizes, and only then takes FOR UPDATE and re-reads. An
-- unauthorized caller therefore can never hold a lock on another workspace's
-- row, and cannot use lock-wait timing to probe for foreign row ids.
--
-- These functions are the ONLY path to confirmed, rejected, or superseded
-- crosswalk states and to issue resolution. Nothing here creates a canonical
-- acquisition, inventory, listing, sale, or cost-basis record — a confirmed
-- crosswalk records reviewed INTENT to map and nothing more.

-- Shared audit append ----------------------------------------------------------
-- No authorization of its own and no grants: callable only from the definer
-- entry points below, which authorize first.
create function app.log_audit_event(
  p_workspace_id uuid,
  p_event_type text,
  p_subject_table text,
  p_subject_id uuid,
  p_actor uuid,
  p_import_job_id uuid default null,
  p_source_record_id uuid default null,
  p_crosswalk_id uuid default null,
  p_detail jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_events (
    workspace_id, event_type, subject_table, subject_id,
    import_job_id, source_record_id, crosswalk_id,
    actor_user_id, actor_process, detail
  )
  values (
    p_workspace_id, p_event_type, p_subject_table, p_subject_id,
    p_import_job_id, p_source_record_id, p_crosswalk_id,
    p_actor, 'provenance.review', coalesce(p_detail, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function app.log_audit_event(
  uuid, text, text, uuid, uuid, uuid, uuid, uuid, jsonb
) from public;

-- commit_import_job --------------------------------------------------------------
-- Commit REQUIRES an idempotency key and it must match the key the job was
-- created with. Re-committing an already-committed identity is refused with a
-- distinct, catchable error rather than silently producing a second import;
-- the partial unique index import_jobs_committed_identity_uidx is the
-- backstop if two commits race.
create function public.commit_import_job(
  p_import_job_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_actor uuid;
  v_job public.import_jobs%rowtype;
  v_existing uuid;
begin
  if p_import_job_id is null then
    raise exception 'import job id is required' using errcode = '22023';
  end if;
  -- Commit must require an idempotency key: absent or blank is refused before
  -- anything else happens.
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'an idempotency key is required to commit an import'
      using errcode = '22023';
  end if;

  -- Authorize BEFORE locking.
  select j.workspace_id into v_workspace
  from public.import_jobs j
  where j.id = p_import_job_id;

  if v_workspace is null then
    raise exception 'import job not found or not authorized' using errcode = '42501';
  end if;

  v_actor := app.assert_workspace_role(v_workspace, array['owner', 'operator']::public.workspace_role[]);

  select * into v_job
  from public.import_jobs j
  where j.id = p_import_job_id
  for update;

  if v_job.idempotency_key is distinct from p_idempotency_key then
    raise exception 'idempotency key does not match this import job'
      using errcode = '22023';
  end if;

  if v_job.mode <> 'commit' then
    raise exception 'import job % is a preview and cannot be committed; run a commit import',
      v_job.public_id
      using errcode = 'check_violation';
  end if;

  if v_job.status = 'committed' then
    raise exception 'import job % is already committed', v_job.public_id
      using errcode = 'unique_violation';
  end if;

  if v_job.status <> 'preview' then
    raise exception 'import job % is % and cannot be committed', v_job.public_id, v_job.status
      using errcode = 'check_violation';
  end if;

  -- Explicit duplicate-identity refusal: same source system, same content
  -- hash, same parser and mapping version, already committed.
  select j.id into v_existing
  from public.import_jobs j
  where j.workspace_id = v_job.workspace_id
    and j.source_system_id = v_job.source_system_id
    and j.content_sha256 = v_job.content_sha256
    and j.parser_version = v_job.parser_version
    and j.mapping_version = v_job.mapping_version
    and j.status = 'committed'
  limit 1;

  if v_existing is not null then
    raise exception
      'an identical import (same source, content hash %, parser %, mapping %) is already committed as %',
      v_job.content_sha256, v_job.parser_version, v_job.mapping_version, v_existing
      using errcode = 'unique_violation';
  end if;

  update public.import_jobs
  set status = 'committed',
      completed_at = now()
  where id = p_import_job_id;

  perform app.log_audit_event(
    v_job.workspace_id, 'import_committed', 'import_jobs', p_import_job_id, v_actor,
    p_import_job_id, null, null,
    jsonb_build_object(
      'content_sha256', v_job.content_sha256,
      'parser_version', v_job.parser_version,
      'mapping_version', v_job.mapping_version,
      'source_row_count', v_job.source_row_count,
      'accepted_row_count', v_job.accepted_row_count,
      'issue_row_count', v_job.issue_row_count
    )
  );

  return p_import_job_id;
end
$$;

revoke all on function public.commit_import_job(uuid, text) from public, anon;
grant execute on function public.commit_import_job(uuid, text) to authenticated;

-- Crosswalk review ------------------------------------------------------------------
-- Shared implementation for confirm/reject. Confirmation is reachable ONLY
-- here, never by insert, and always records the acting reviewer.
create function app.review_source_crosswalk(
  p_crosswalk_id uuid,
  p_state public.crosswalk_state,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_actor uuid;
  v_row public.source_crosswalks%rowtype;
begin
  if p_crosswalk_id is null then
    raise exception 'crosswalk id is required' using errcode = '22023';
  end if;
  if p_state not in ('confirmed', 'rejected') then
    raise exception 'review state must be confirmed or rejected' using errcode = '22023';
  end if;

  select c.workspace_id into v_workspace
  from public.source_crosswalks c
  where c.id = p_crosswalk_id;

  if v_workspace is null then
    raise exception 'crosswalk not found or not authorized' using errcode = '42501';
  end if;

  v_actor := app.assert_workspace_role(v_workspace, array['owner', 'operator']::public.workspace_role[]);

  select * into v_row
  from public.source_crosswalks c
  where c.id = p_crosswalk_id
  for update;

  if v_row.review_state <> 'candidate' then
    raise exception 'crosswalk % is already % and cannot be reviewed again',
      p_crosswalk_id, v_row.review_state
      using errcode = 'check_violation';
  end if;

  update public.source_crosswalks
  set review_state = p_state,
      reviewed_by = v_actor,
      reviewed_at = now(),
      review_note = p_note
  where id = p_crosswalk_id;

  perform app.log_audit_event(
    v_row.workspace_id,
    case p_state when 'confirmed' then 'crosswalk_confirmed' else 'crosswalk_rejected' end,
    'source_crosswalks', p_crosswalk_id, v_actor,
    null, v_row.source_record_id, p_crosswalk_id,
    jsonb_build_object(
      'proposed_entity_type', v_row.proposed_entity_type,
      'proposed_entity_key', v_row.proposed_entity_key,
      'match_method', v_row.match_method,
      'confidence', v_row.confidence,
      'note', p_note
    )
  );

  return p_crosswalk_id;
end
$$;

revoke all on function app.review_source_crosswalk(uuid, public.crosswalk_state, text) from public;

-- The shared implementation is never granted to any role: it is reachable only
-- through these two definer wrappers, so 'confirmed' cannot be requested for an
-- arbitrary state value by a caller.
create function public.confirm_source_crosswalk(p_crosswalk_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.review_source_crosswalk(p_crosswalk_id, 'confirmed'::public.crosswalk_state, p_note);
end
$$;

revoke all on function public.confirm_source_crosswalk(uuid, text) from public, anon;
grant execute on function public.confirm_source_crosswalk(uuid, text) to authenticated;

create function public.reject_source_crosswalk(p_crosswalk_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.review_source_crosswalk(p_crosswalk_id, 'rejected'::public.crosswalk_state, p_note);
end
$$;

revoke all on function public.reject_source_crosswalk(uuid, text) from public, anon;
grant execute on function public.reject_source_crosswalk(uuid, text) to authenticated;

-- Supersession ---------------------------------------------------------------------
-- Replaces an existing mapping with a newer candidate WITHOUT erasing the
-- original: the old row becomes 'superseded' and both rows keep a link to each
-- other, so the full review history remains reconstructable.
create function public.supersede_source_crosswalk(
  p_crosswalk_id uuid,
  p_replacement_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_actor uuid;
  v_old public.source_crosswalks%rowtype;
  v_new public.source_crosswalks%rowtype;
begin
  if p_crosswalk_id is null or p_replacement_id is null then
    raise exception 'both the superseded and replacement crosswalk ids are required'
      using errcode = '22023';
  end if;
  if p_crosswalk_id = p_replacement_id then
    raise exception 'a crosswalk cannot supersede itself' using errcode = '22023';
  end if;

  select c.workspace_id into v_workspace
  from public.source_crosswalks c
  where c.id = p_crosswalk_id;

  if v_workspace is null then
    raise exception 'crosswalk not found or not authorized' using errcode = '42501';
  end if;

  v_actor := app.assert_workspace_role(v_workspace, array['owner', 'operator']::public.workspace_role[]);

  -- Lock both rows in a deterministic order to avoid deadlocking against a
  -- concurrent supersession of the same pair.
  select * into v_old from public.source_crosswalks c
  where c.id = least(p_crosswalk_id, p_replacement_id) for update;
  select * into v_new from public.source_crosswalks c
  where c.id = greatest(p_crosswalk_id, p_replacement_id) for update;

  select * into v_old from public.source_crosswalks c where c.id = p_crosswalk_id;
  select * into v_new from public.source_crosswalks c where c.id = p_replacement_id;

  if v_new.id is null then
    raise exception 'replacement crosswalk not found or not authorized' using errcode = '42501';
  end if;
  -- Same-workspace requirement: never supersede across workspaces.
  if v_new.workspace_id <> v_old.workspace_id then
    raise exception 'replacement crosswalk not found or not authorized' using errcode = '42501';
  end if;
  if v_old.review_state = 'superseded' then
    raise exception 'crosswalk % is already superseded', p_crosswalk_id
      using errcode = 'check_violation';
  end if;
  if v_new.review_state <> 'candidate' then
    raise exception 'the replacement crosswalk must itself still be a candidate'
      using errcode = 'check_violation';
  end if;

  update public.source_crosswalks
  set review_state = 'superseded',
      superseded_by_id = p_replacement_id,
      superseded_at = now(),
      review_note = coalesce(p_note, review_note)
  where id = p_crosswalk_id;

  update public.source_crosswalks
  set supersedes_id = p_crosswalk_id
  where id = p_replacement_id;

  perform app.log_audit_event(
    v_old.workspace_id, 'crosswalk_superseded', 'source_crosswalks', p_crosswalk_id, v_actor,
    null, v_old.source_record_id, p_crosswalk_id,
    jsonb_build_object(
      'superseded_by', p_replacement_id,
      'previous_state', v_old.review_state,
      'note', p_note
    )
  );

  return p_replacement_id;
end
$$;

revoke all on function public.supersede_source_crosswalk(uuid, uuid, text) from public, anon;
grant execute on function public.supersede_source_crosswalk(uuid, uuid, text) to authenticated;

-- Issue resolution ------------------------------------------------------------------
-- Resolving an issue never touches the raw payload it preserves: the immutable
-- source record stays exactly as ingested and raw_payload_snapshot is in the
-- immutable column set.
create function public.resolve_data_quality_issue(
  p_issue_id uuid,
  p_status public.data_quality_status,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_actor uuid;
  v_row public.data_quality_issues%rowtype;
  v_event text;
begin
  if p_issue_id is null then
    raise exception 'issue id is required' using errcode = '22023';
  end if;
  if p_status not in ('acknowledged', 'resolved', 'wont_fix') then
    raise exception 'status must be acknowledged, resolved, or wont_fix'
      using errcode = '22023';
  end if;

  select i.workspace_id into v_workspace
  from public.data_quality_issues i
  where i.id = p_issue_id;

  if v_workspace is null then
    raise exception 'issue not found or not authorized' using errcode = '42501';
  end if;

  v_actor := app.assert_workspace_role(v_workspace, array['owner', 'operator']::public.workspace_role[]);

  select * into v_row
  from public.data_quality_issues i
  where i.id = p_issue_id
  for update;

  if v_row.status in ('resolved', 'wont_fix') then
    raise exception 'issue % is already %', p_issue_id, v_row.status
      using errcode = 'check_violation';
  end if;

  update public.data_quality_issues
  set status = p_status,
      resolved_by = case when p_status = 'acknowledged' then null else v_actor end,
      resolved_at = case when p_status = 'acknowledged' then null else now() end,
      resolution_note = p_note
  where id = p_issue_id;

  v_event := case p_status
    when 'acknowledged' then 'issue_acknowledged'
    when 'resolved' then 'issue_resolved'
    else 'issue_wont_fix'
  end;

  perform app.log_audit_event(
    v_row.workspace_id, v_event, 'data_quality_issues', p_issue_id, v_actor,
    v_row.import_job_id, v_row.source_record_id, null,
    jsonb_build_object('issue_type', v_row.issue_type, 'note', p_note)
  );

  return p_issue_id;
end
$$;

revoke all on function public.resolve_data_quality_issue(uuid, public.data_quality_status, text)
  from public, anon;
grant execute on function public.resolve_data_quality_issue(uuid, public.data_quality_status, text)
  to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260719000900_provenance_functions');
