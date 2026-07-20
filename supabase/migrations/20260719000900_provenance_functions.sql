-- Phase 3 source/import provenance — migration 9: governed review functions.
--
-- Every public entry point here is SECURITY DEFINER with a fixed EMPTY
-- search_path (all references schema-qualified), and is executable only by the
-- authenticated role — never by anon or PUBLIC. Because migration 8 grants
-- authenticated nothing but SELECT, these functions are the ONLY way any
-- provenance row is ever written.
--
-- AUTHORIZATION IS PART OF THE LOOKUP.
-- No function reads or locks a target row and then checks permission
-- afterwards. Instead every target is resolved by a query that JOINS
-- workspace_members on the caller's auth.uid() and the permitted roles, so:
--   * a row in another workspace is never read and never locked — it simply
--     does not appear in the result set;
--   * FOR UPDATE OF applies only to rows the join already proved authorized,
--     so an unauthorized caller cannot take a lock or use lock-wait timing as
--     an existence oracle;
--   * "does not exist" and "not authorized" are reported with the SAME error
--     text and SQLSTATE, so neither can be distinguished by probing.
--
-- Nothing here creates a canonical acquisition, inventory, listing, sale, or
-- cost-basis record. A confirmed crosswalk records reviewed INTENT to map and
-- nothing more.

-- Caller identity ------------------------------------------------------------
create function app.require_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return v_uid;
end
$$;

revoke all on function app.require_uid() from public;

-- Shared audit append ----------------------------------------------------------
-- No authorization of its own and no grants: reachable only from the definer
-- entry points below and in migration 10, which authorize first. This is the
-- only path that writes audit_events at all — authenticated has no INSERT.
create function app.log_audit_event(
  p_workspace_id uuid,
  p_event_type text,
  p_subject_table text,
  p_subject_id uuid,
  p_actor uuid,
  p_actor_process text default 'provenance.review',
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
    p_actor, p_actor_process, coalesce(p_detail, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function app.log_audit_event(
  uuid, text, text, uuid, uuid, text, uuid, uuid, uuid, jsonb
) from public;

-- Crosswalk review ------------------------------------------------------------------
-- Shared implementation for confirm/reject. Never granted to any role; the two
-- definer wrappers below are the only callers, so a caller cannot request an
-- arbitrary target state.
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
  v_uid uuid;
  v_row public.source_crosswalks%rowtype;
begin
  if p_crosswalk_id is null then
    raise exception 'crosswalk id is required' using errcode = '22023';
  end if;
  if p_state not in ('confirmed', 'rejected') then
    raise exception 'review state must be confirmed or rejected' using errcode = '22023';
  end if;

  v_uid := app.require_uid();

  -- Authorization is part of the lookup: a crosswalk outside the caller's
  -- workspaces, or in a workspace where the caller lacks a write role, is
  -- never returned and never locked.
  select c.* into v_row
  from public.source_crosswalks c
  join public.workspace_members m
    on m.workspace_id = c.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where c.id = p_crosswalk_id
  for update of c;

  if v_row.id is null then
    raise exception 'crosswalk not found or not authorized' using errcode = '42501';
  end if;

  if v_row.review_state <> 'candidate' then
    raise exception 'crosswalk is already % and cannot be reviewed again', v_row.review_state
      using errcode = 'check_violation';
  end if;

  update public.source_crosswalks
  set review_state = p_state,
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_note = p_note
  where id = p_crosswalk_id;

  perform app.log_audit_event(
    v_row.workspace_id,
    case p_state when 'confirmed' then 'crosswalk_confirmed' else 'crosswalk_rejected' end,
    'source_crosswalks', p_crosswalk_id, v_uid, 'provenance.review',
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
-- original. Both rows are resolved and locked by a SINGLE authorized query
-- ordered by id, so:
--   * the replacement is never read or locked until the join has proved it is
--     in a workspace the caller may write to;
--   * the two locks are always taken in the same deterministic order, so two
--     concurrent supersessions of the same pair cannot deadlock.
-- The coherence rules (same source record, same entity type, candidate state,
-- no cycles) are enforced by app.enforce_supersession_coherence in migration 7,
-- and linear-chain shape by the two partial unique indexes in migration 6.
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
  v_uid uuid;
  v_locked uuid[];
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

  v_uid := app.require_uid();

  -- One authorized, deterministically ordered locking pass over both ids.
  -- A row the caller may not write is filtered out by the join and is
  -- therefore neither read nor locked.
  select array_agg(t.id order by t.id) into v_locked
  from (
    select c.id
    from public.source_crosswalks c
    join public.workspace_members m
      on m.workspace_id = c.workspace_id
     and m.user_id = v_uid
     and m.role = any (array['owner', 'operator']::public.workspace_role[])
    where c.id in (p_crosswalk_id, p_replacement_id)
    order by c.id
    for update of c
  ) t;

  -- Both rows must have been authorized. Anything less is reported
  -- identically to "does not exist".
  if v_locked is null or array_length(v_locked, 1) <> 2 then
    raise exception 'crosswalk not found or not authorized' using errcode = '42501';
  end if;

  select * into v_old from public.source_crosswalks where id = p_crosswalk_id;
  select * into v_new from public.source_crosswalks where id = p_replacement_id;

  if v_old.review_state = 'superseded' then
    raise exception 'crosswalk is already superseded' using errcode = 'check_violation';
  end if;
  if v_new.review_state <> 'candidate' then
    raise exception 'the replacement crosswalk must itself still be a candidate'
      using errcode = 'check_violation';
  end if;

  -- These two updates fire the coherence trigger, which verifies same
  -- workspace, same source record, same entity type, and no cycle.
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
    v_old.workspace_id, 'crosswalk_superseded', 'source_crosswalks', p_crosswalk_id,
    v_uid, 'provenance.review',
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
  v_uid uuid;
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

  v_uid := app.require_uid();

  select i.* into v_row
  from public.data_quality_issues i
  join public.workspace_members m
    on m.workspace_id = i.workspace_id
   and m.user_id = v_uid
   and m.role = any (array['owner', 'operator']::public.workspace_role[])
  where i.id = p_issue_id
  for update of i;

  if v_row.id is null then
    raise exception 'issue not found or not authorized' using errcode = '42501';
  end if;

  if v_row.status in ('resolved', 'wont_fix') then
    raise exception 'issue is already %', v_row.status using errcode = 'check_violation';
  end if;

  update public.data_quality_issues
  set status = p_status,
      resolved_by = case when p_status = 'acknowledged' then null else v_uid end,
      resolved_at = case when p_status = 'acknowledged' then null else now() end,
      resolution_note = p_note
  where id = p_issue_id;

  v_event := case p_status
    when 'acknowledged' then 'issue_acknowledged'
    when 'resolved' then 'issue_resolved'
    else 'issue_wont_fix'
  end;

  perform app.log_audit_event(
    v_row.workspace_id, v_event, 'data_quality_issues', p_issue_id, v_uid,
    'provenance.review',
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
