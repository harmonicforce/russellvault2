-- Phase 6A intake kernel — migration 5: state machine + transactional commit kernel.
--
-- One reusable, server-authoritative intake state machine and one transactional
-- commit kernel that every future Phase 6 surface reuses. Every write here is
-- SECURITY DEFINER with an empty search_path and an explicit membership/role
-- check; read access is governed by RLS (migration 3). The kernel creates
-- canonical Phase 5 identity EXCLUSIVELY through the accepted Phase 5
-- registrars/mint; it never writes a second committed truth and never touches
-- legacy SQLite, which remains the sole authoritative deployed inventory.

-- Authorization helpers ----------------------------------------------------------------
create function app.require_intake_member(p_workspace_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := app.require_uid();
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  return v_uid;
end
$$;
revoke all on function app.require_intake_member(uuid) from public;

create function app.record_intake_transition(
  p_workspace_id uuid,
  p_session_id uuid,
  p_group_id uuid,
  p_event_type text,
  p_prior_state text,
  p_resulting_state text,
  p_actor uuid,
  p_reason jsonb default '{}'::jsonb,
  p_actor_process text default 'intake.kernel'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.intake_transition_events (
    workspace_id, session_id, group_id, event_type, prior_state, resulting_state,
    actor_user_id, actor_process, reason)
  values (p_workspace_id, p_session_id, p_group_id, p_event_type, p_prior_state,
    p_resulting_state, p_actor, p_actor_process, coalesce(p_reason, '{}'::jsonb));
end
$$;
revoke all on function app.record_intake_transition(uuid, uuid, uuid, text, text, text, uuid, jsonb, text)
  from public;

-- Governed state-transition matrix. Draft -> Ready to Commit -> Committed;
-- Draft -> Abandoned; Ready -> Draft (reopen); Ready -> Abandoned. Every other
-- edge fails closed. committed/abandoned are terminal.
create function app.intake_assert_transition(p_from text, p_to text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not (
       (p_from = 'draft'           and p_to in ('ready_to_commit', 'abandoned'))
    or (p_from = 'ready_to_commit'  and p_to in ('committed', 'draft', 'abandoned'))
  ) then
    raise exception 'invalid intake state transition % -> %', p_from, p_to
      using errcode = 'check_violation';
  end if;
end
$$;
revoke all on function app.intake_assert_transition(text, text) from public;

-- A session must be open for any mutation or readiness-implying operation.
create function app.intake_require_open_session(p_workspace_id uuid, p_session_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state public.intake_session_state;
begin
  select state into v_state from public.intake_sessions
  where id = p_session_id and workspace_id = p_workspace_id;
  if v_state is null then
    raise exception 'intake session not found' using errcode = '23514';
  end if;
  if v_state <> 'open' then
    raise exception 'intake session is % and accepts no further intake work', v_state
      using errcode = '42501';
  end if;
end
$$;
revoke all on function app.intake_require_open_session(uuid, uuid) from public;

create function app.mint_intake_lot_public_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'RV-I-' || lpad(nextval('app.intake_lot_public_seq')::text, 10, '0')
$$;
revoke all on function app.mint_intake_lot_public_id() from public;

create function app.intake_product_canonical_key(
  p_vertical text, p_display_name text, p_product_attrs jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_vertical
    when 'tcg' then
      'tcg|' || coalesce(app.norm_identity(p_product_attrs->>'featured_subject'),
                         app.norm_identity(p_display_name), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'set_name'), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'card_number'), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'language'), '')
    when 'footwear' then
      'footwear|' || coalesce(app.norm_identity(p_product_attrs->>'silhouette'),
                              app.norm_identity(p_display_name), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'colorway_name'), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'style_code'), '')
    else
      'other|' || coalesce(app.norm_identity(p_display_name), '')
  end
$$;
revoke all on function app.intake_product_canonical_key(text, text, jsonb) from public;

-- Approved hybrid serialization policy. Serialized units are REQUIRED for
-- graded/certified, footwear, and any owner-tagged / unique-condition /
-- item-media / security-sensitive unit.
create function app.intake_serialization_required(p_group_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.intake_draft_groups%rowtype;
begin
  select * into v from public.intake_draft_groups where id = p_group_id;
  if v.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  return v.category in ('graded_tcg', 'footwear')
    or nullif(btrim(coalesce(v.sku_attrs->>'grading_company', '')), '') is not null
    or v.owner_tagged or v.unique_condition or v.requires_item_media or v.security_sensitive;
end
$$;
revoke all on function app.intake_serialization_required(uuid) from public;

-- Coherent source-state derivation: a governed STATED source (a source_kind in
-- source_evidence) wins; else a CANDIDATE if at least one link exists; else
-- UNKNOWN. Facts are never invented.
create function app.intake_derive_source_state(p_group_id uuid)
returns public.intake_source_state
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_evidence jsonb;
  v_links integer;
begin
  select source_evidence into v_evidence from public.intake_draft_groups where id = p_group_id;
  if jsonb_typeof(v_evidence->'source_kind') = 'string' then
    return 'stated';
  end if;
  select count(*)::int into v_links from public.intake_candidate_links where group_id = p_group_id;
  if v_links > 0 then
    return 'candidate';
  end if;
  return 'unknown';
end
$$;
revoke all on function app.intake_derive_source_state(uuid) from public;

-- The deterministically ordered candidate-evidence snapshot (financially inert).
create function app.intake_candidate_snapshot(p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'acquisition_line_item_id', c.acquisition_line_item_id,
      'entry_id', c.entry_id,
      'evidence', c.evidence,
      'confidence', c.confidence,
      'source_state', c.source_state,
      'review_state', c.review_state)
    order by c.acquisition_line_item_id, c.entry_id nulls first), '[]'::jsonb)
  from public.intake_candidate_links c where c.group_id = p_group_id
$$;
revoke all on function app.intake_candidate_snapshot(uuid) from public;

-- Deterministic content digest of the EXACT committed snapshot: stable content
-- fields, the ordered entries, the ordered candidate-evidence snapshot, and the
-- governed source evidence — excluding volatile bookkeeping. Recomputes
-- identically on an idempotent replay (committed groups are frozen).
create function app.intake_content_hash(p_group_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.intake_draft_groups%rowtype;
  v_entries jsonb;
  v_doc jsonb;
begin
  select * into v from public.intake_draft_groups where id = p_group_id;
  if v.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'entry_index', e.entry_index, 'grading_company', e.grading_company,
      'numeric_grade', e.numeric_grade, 'grade_designation', e.grade_designation,
      'certificate_number', e.certificate_number, 'serial_number', e.serial_number,
      'entry_attrs', e.entry_attrs) order by e.entry_index), '[]'::jsonb)
    into v_entries from public.intake_entries e where e.group_id = p_group_id;
  v_doc := jsonb_build_object(
    'category', v.category, 'business_vertical', v.business_vertical,
    'display_name', v.display_name, 'product_attrs', v.product_attrs, 'sku_attrs', v.sku_attrs,
    'quantity', v.quantity, 'tracking_mode', v.tracking_mode,
    'serialized_child_count', v.serialized_child_count, 'source_state', v.source_state,
    'source_evidence', v.source_evidence, 'condition_state', v.condition_state,
    'location_code', v.location_code, 'owner_tagged', v.owner_tagged,
    'unique_condition', v.unique_condition, 'requires_item_media', v.requires_item_media,
    'security_sensitive', v.security_sensitive,
    'entries', v_entries,
    'candidates', app.intake_candidate_snapshot(p_group_id));
  return encode(sha256(convert_to(v_doc::text, 'UTF8')), 'hex');
end
$$;
revoke all on function app.intake_content_hash(uuid) from public;

-- Resolve an EXISTING active storage location by workspace + code. Returns its
-- id, or NULL when the code is absent, unknown, or retired. Never mints.
create function app.intake_resolve_location(p_workspace_id uuid, p_location_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.storage_locations
  where workspace_id = p_workspace_id and location_code = p_location_code and retired_at is null
$$;
revoke all on function app.intake_resolve_location(uuid, text) from public;

-- Exactly one governed next-action reason. A STATED source carries governed
-- evidence and is explained, so it does not by itself require source review; an
-- unknown or candidate source always does.
create function app.intake_compute_next_action(p_group_id uuid)
returns public.intake_next_action
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.intake_draft_groups%rowtype;
begin
  select * into v from public.intake_draft_groups where id = p_group_id;
  if v.source_state <> 'stated' then
    return 'SOURCE_REVIEW_NEEDED';
  elsif v.category = 'raw_tcg' and v.condition_state is null then
    return 'CONDITION_DETAILS_NEEDED';
  elsif v.location_code is null then
    return 'LOCATION_ASSIGNMENT_NEEDED';
  elsif v.requires_item_media then
    return 'PHOTOS_NEEDED';
  else
    return 'READY_FOR_FUTURE_LISTING_PREP';
  end if;
end
$$;
revoke all on function app.intake_compute_next_action(uuid) from public;

-- Data-type check for a single governed value. Returns an error code or NULL.
create function app.intake_value_type_error(p_data_type text, p_ref_list text, p_value text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_value is null then return null; end if;
  if p_data_type = 'integer' then
    if p_value !~ '^-?[0-9]+$' then return 'not_integer'; end if;
  elsif p_data_type = 'boolean' then
    if p_value not in ('true', 'false') then return 'not_boolean'; end if;
  elsif p_data_type = 'reference' then
    if not exists (select 1 from public.intake_reference_options o
                   where o.list_key = p_ref_list and o.option_value = p_value and o.is_active) then
      return 'not_allowed';
    end if;
  end if;
  return null;
end
$$;
revoke all on function app.intake_value_type_error(text, text, text) from public;

-- Whether a conditional rule applies to a group (cross-field check).
create function app.intake_condition_met(p_group_id uuid, p_condition jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.intake_draft_groups%rowtype;
  v_field text := p_condition->>'when_field';
  v_equals text := p_condition->>'equals';
  v_actual text;
begin
  if v_field is null then return true; end if;
  select * into v from public.intake_draft_groups where id = p_group_id;
  v_actual := case v_field
    when 'tracking_mode' then v.tracking_mode::text
    when 'category' then v.category::text
    when 'source_state' then v.source_state::text
    else coalesce(v.sku_attrs->>v_field, v.product_attrs->>v_field)
  end;
  return v_actual is not distinct from v_equals;
end
$$;
revoke all on function app.intake_condition_met(uuid, jsonb) from public;

-- Server-authoritative rule evaluation. Re-runs every governed blocker: required
-- identity/facts by scope (honoring conditional applicability), data types,
-- allowed reference values, serialization policy, category structure, graded
-- identity coherence, governed source evidence, and location resolution.
-- Returns {ready, blockers[], rule_version}. Never mutates.
create function app.intake_validate_group(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.intake_draft_groups%rowtype;
  v_blockers jsonb := '[]'::jsonb;
  v_rule_version text;
  r record;
  e record;
  v_val text;
  v_entry_count integer;
  v_missing integer;
  v_type_err text;
begin
  select * into v from public.intake_draft_groups where id = p_group_id;
  if v.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;

  select coalesce(max(rule_version), 'INTAKE_RULES_1') into v_rule_version
  from public.intake_field_rules where category = v.category;

  select count(*)::int into v_entry_count from public.intake_entries where group_id = p_group_id;

  -- Required, commit-blocking fields by scope, honoring conditional applicability.
  for r in
    select fr.field_key, fr.applicability, fr.condition, reg.scope, reg.attr_key
    from public.intake_field_rules fr
    join public.intake_field_registry reg on reg.field_key = fr.field_key
    where fr.category = v.category and fr.is_commit_blocker and fr.is_required
  loop
    if r.applicability = 'conditional' and not app.intake_condition_met(p_group_id, r.condition) then
      continue;  -- rule does not apply to this group
    end if;
    if r.scope = 'product' then
      if nullif(btrim(coalesce(v.product_attrs->>r.attr_key, '')), '') is null then
        v_blockers := v_blockers || jsonb_build_object('code', 'missing_required',
          'field', r.field_key, 'message', format('%s is required', r.field_key));
      end if;
    elsif r.scope = 'sku' then
      if nullif(btrim(coalesce(v.sku_attrs->>r.attr_key, '')), '') is null then
        v_blockers := v_blockers || jsonb_build_object('code', 'missing_required',
          'field', r.field_key, 'message', format('%s is required', r.field_key));
      end if;
    elsif r.scope = 'entry' and r.attr_key = 'certificate_number' then
      select count(*)::int into v_missing from public.intake_entries e2
      where e2.group_id = p_group_id
        and (nullif(btrim(coalesce(e2.certificate_number, '')), '') is null
             or nullif(btrim(coalesce(e2.grading_company, '')), '') is null);
      if v_entry_count = 0 or v_missing > 0 then
        v_blockers := v_blockers || jsonb_build_object('code', 'missing_required',
          'field', r.field_key,
          'message', 'every serialized entry needs a certificate number and grading company');
      end if;
    end if;
  end loop;

  -- Data-type + allowed-value validation for provided product / sku values.
  for r in
    select reg.field_key, reg.scope, reg.attr_key, reg.data_type, reg.reference_list_key
    from public.intake_field_registry reg
    where (reg.business_vertical is null or reg.business_vertical = v.business_vertical)
      and reg.scope in ('product', 'sku')
  loop
    v_val := nullif(btrim(coalesce(
      case when r.scope = 'product' then v.product_attrs->>r.attr_key else v.sku_attrs->>r.attr_key end, '')), '');
    v_type_err := app.intake_value_type_error(r.data_type, r.reference_list_key, v_val);
    if v_type_err is not null then
      v_blockers := v_blockers || jsonb_build_object('code', 'invalid_value',
        'field', r.field_key, 'message', format('%s (%s)', v_val, v_type_err));
    end if;
  end loop;

  -- Data-type validation for provided entry bag / column values, per entry.
  for e in select * from public.intake_entries where group_id = p_group_id loop
    for r in
      select reg.field_key, reg.attr_key, reg.data_type, reg.reference_list_key, reg.maps_to
      from public.intake_field_registry reg
      where (reg.business_vertical is null or reg.business_vertical = v.business_vertical)
        and reg.scope = 'entry'
    loop
      if r.attr_key = 'certificate_number' then
        v_val := nullif(btrim(coalesce(e.certificate_number, '')), '');
      else
        v_val := nullif(btrim(coalesce(e.entry_attrs->>r.attr_key, '')), '');
      end if;
      v_type_err := app.intake_value_type_error(r.data_type, r.reference_list_key, v_val);
      if v_type_err is not null then
        v_blockers := v_blockers || jsonb_build_object('code', 'invalid_value',
          'field', r.field_key,
          'message', format('entry %s: %s (%s)', e.entry_index, v_val, v_type_err));
      end if;
    end loop;
  end loop;

  -- Serialization policy + category structure.
  if app.intake_serialization_required(p_group_id) and v.tracking_mode <> 'serialized' then
    v_blockers := v_blockers || jsonb_build_object('code', 'serialization_required',
      'field', 'tracking_mode', 'message', 'this category/policy requires serialized units');
  end if;
  if v.category = 'graded_tcg'
     and not (v.quantity = 1 and v.tracking_mode = 'serialized' and v.serialized_child_count = 1) then
    v_blockers := v_blockers || jsonb_build_object('code', 'graded_requires_single_serialized',
      'field', 'quantity', 'message', 'a graded slab must be quantity 1 with exactly one serialized item');
  end if;
  if v.category = 'footwear'
     and not (v.tracking_mode = 'serialized' and v.serialized_child_count = v.quantity) then
    v_blockers := v_blockers || jsonb_build_object('code', 'footwear_serial_count',
      'field', 'serialized_child_count',
      'message', 'footwear must serialize every unit (serialized_child_count = quantity)');
  end if;
  if v.tracking_mode = 'serialized' and v_entry_count <> v.serialized_child_count then
    v_blockers := v_blockers || jsonb_build_object('code', 'entry_count_mismatch',
      'field', 'serialized_child_count',
      'message', format('expected %s serialized entries but found %s',
        v.serialized_child_count, v_entry_count));
  end if;
  -- A serial-numbered or certified/graded entry forces serialized tracking.
  if v.tracking_mode <> 'serialized' and exists (
       select 1 from public.intake_entries e2 where e2.group_id = p_group_id
       and (nullif(btrim(coalesce(e2.serial_number, '')), '') is not null
            or nullif(btrim(coalesce(e2.certificate_number, '')), '') is not null
            or nullif(btrim(coalesce(e2.grading_company, '')), '') is not null)) then
    v_blockers := v_blockers || jsonb_build_object('code', 'entry_requires_serialization',
      'field', 'tracking_mode',
      'message', 'a serial-numbered or certified entry requires serialized tracking');
  end if;

  -- Graded identity coherence: the entry may not disagree with the SKU identity.
  if v.category = 'graded_tcg' then
    for e in select * from public.intake_entries where group_id = p_group_id loop
      if nullif(btrim(coalesce(e.grading_company, '')), '') is not null
         and app.norm_identity(e.grading_company) is distinct from app.norm_identity(v.sku_attrs->>'grading_company') then
        v_blockers := v_blockers || jsonb_build_object('code', 'graded_identity_mismatch',
          'field', 'grading_company',
          'message', 'the entry grading company disagrees with the SKU identity');
      end if;
      if nullif(btrim(coalesce(e.numeric_grade, '')), '') is not null
         and app.norm_identity(e.numeric_grade) is distinct from app.norm_identity(v.sku_attrs->>'numeric_grade') then
        v_blockers := v_blockers || jsonb_build_object('code', 'graded_identity_mismatch',
          'field', 'numeric_grade',
          'message', 'the entry numeric grade disagrees with the SKU identity');
      end if;
      if nullif(btrim(coalesce(e.grade_designation, '')), '') is not null
         and nullif(btrim(coalesce(v.sku_attrs->>'grade_designation', '')), '') is not null
         and app.norm_identity(e.grade_designation) is distinct from app.norm_identity(v.sku_attrs->>'grade_designation') then
        v_blockers := v_blockers || jsonb_build_object('code', 'graded_identity_mismatch',
          'field', 'grade_designation',
          'message', 'the entry grade designation disagrees with the SKU identity');
      end if;
    end loop;
  end if;

  -- Governed stated source evidence: a stated source names a governed source_kind.
  if v.source_state = 'stated' and not exists (
       select 1 from public.intake_reference_options o
       where o.list_key = 'source_kind' and o.option_value = v.source_evidence->>'source_kind'
         and o.is_active) then
    v_blockers := v_blockers || jsonb_build_object('code', 'invalid_source_kind',
      'field', 'source_evidence',
      'message', 'a stated source must name a governed source_kind');
  end if;
  -- A candidate source must be backed by at least one candidate link.
  if v.source_state = 'candidate' and not exists (
       select 1 from public.intake_candidate_links c where c.group_id = p_group_id) then
    v_blockers := v_blockers || jsonb_build_object('code', 'candidate_without_evidence',
      'field', 'source_state', 'message', 'a candidate source needs at least one candidate link');
  end if;

  -- Location: an entered code must resolve to an existing ACTIVE location.
  if v.location_code is not null and app.intake_resolve_location(v.workspace_id, v.location_code) is null then
    v_blockers := v_blockers || jsonb_build_object('code', 'location_unresolved',
      'field', 'location_code',
      'message', 'the location code is unknown or retired');
  end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'rule_version', v_rule_version);
end
$$;
revoke all on function app.intake_validate_group(uuid) from public;

-- Validate that draft attribute keys are GOVERNED for the scope + vertical
-- (resolved by attr_key). Prevents an EAV free-for-all in product / sku / entry
-- bags. For entry scope only NON-mapped (bag) fields are valid keys.
create function app.intake_assert_governed_attrs(
  p_vertical public.inventory_vertical, p_scope text, p_attrs jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text;
begin
  for k in select jsonb_object_keys(coalesce(p_attrs, '{}'::jsonb)) loop
    if not exists (
      select 1 from public.intake_field_registry reg
      where reg.scope = p_scope
        and (reg.business_vertical is null or reg.business_vertical = p_vertical)
        and reg.attr_key = k
        and (p_scope <> 'entry' or reg.maps_to is null)
    ) then
      raise exception 'ungoverned % attribute "%": not in the field registry', p_scope, k
        using errcode = '22023';
    end if;
  end loop;
end
$$;
revoke all on function app.intake_assert_governed_attrs(public.inventory_vertical, text, jsonb) from public;

-- =====================================================================================
-- PUBLIC API — sessions
-- =====================================================================================
create function public.create_intake_session(p_workspace_id uuid, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_public text;
  v_id uuid;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  v_public := app.mint_governed_public_id('RV-ISESS');
  insert into public.intake_sessions (workspace_id, public_id, label, opened_by)
  values (p_workspace_id, v_public, p_label, v_uid)
  returning id into v_id;
  perform app.record_intake_transition(p_workspace_id, v_id, null, 'session_created',
    null, 'open', v_uid, jsonb_build_object('label', p_label));
  return jsonb_build_object('id', v_id, 'public_id', v_public, 'state', 'open');
end
$$;
revoke all on function public.create_intake_session(uuid, text) from public, anon;
grant execute on function public.create_intake_session(uuid, text) to authenticated;

create function public.resume_intake_session(p_workspace_id uuid, p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_sess public.intake_sessions%rowtype;
  v_counts jsonb;
begin
  v_uid := app.require_intake_member(p_workspace_id);
  select * into v_sess from public.intake_sessions
  where id = p_session_id and workspace_id = p_workspace_id;
  if v_sess.id is null then
    raise exception 'intake session not found' using errcode = '23514';
  end if;
  select coalesce(jsonb_object_agg(state, n), '{}'::jsonb) into v_counts
  from (select state::text as state, count(*) as n from public.intake_draft_groups
        where session_id = p_session_id and workspace_id = p_workspace_id group by state) s;
  return jsonb_build_object('id', v_sess.id, 'public_id', v_sess.public_id,
    'state', v_sess.state, 'group_counts', v_counts);
end
$$;
revoke all on function public.resume_intake_session(uuid, uuid) from public, anon;
grant execute on function public.resume_intake_session(uuid, uuid) to authenticated;

-- Abandoning a session AUTOMATICALLY abandons its uncommitted (draft /
-- ready_to_commit) groups, so their stored state is truthful and no editable
-- draft survives under a dead session. Committed groups remain readable and
-- unchanged. This choice (auto-abandon, not silent freeze) keeps stored state
-- and audit state in agreement.
create function public.abandon_intake_session(p_workspace_id uuid, p_session_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_sess public.intake_sessions%rowtype;
  g record;
  v_abandoned integer := 0;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  select * into v_sess from public.intake_sessions
  where id = p_session_id and workspace_id = p_workspace_id for update;
  if v_sess.id is null then
    raise exception 'intake session not found' using errcode = '23514';
  end if;
  if v_sess.state = 'abandoned' then
    return jsonb_build_object('id', v_sess.id, 'state', 'abandoned', 'changed', false,
      'groups_abandoned', 0);
  end if;
  for g in select id, state from public.intake_draft_groups
           where session_id = p_session_id and workspace_id = p_workspace_id
             and state in ('draft', 'ready_to_commit') for update loop
    update public.intake_draft_groups set state = 'abandoned' where id = g.id;
    perform app.record_intake_transition(p_workspace_id, p_session_id, g.id, 'abandon',
      g.state::text, 'abandoned', v_uid, jsonb_build_object('reason', 'session_abandoned'));
    v_abandoned := v_abandoned + 1;
  end loop;
  update public.intake_sessions
  set state = 'abandoned', abandoned_by = v_uid, abandoned_at = now(), abandon_reason = p_reason
  where id = p_session_id;
  perform app.record_intake_transition(p_workspace_id, p_session_id, null, 'session_abandoned',
    'open', 'abandoned', v_uid, jsonb_build_object('reason', p_reason, 'groups_abandoned', v_abandoned));
  return jsonb_build_object('id', v_sess.id, 'state', 'abandoned', 'changed', true,
    'groups_abandoned', v_abandoned);
end
$$;
revoke all on function public.abandon_intake_session(uuid, uuid, text) from public, anon;
grant execute on function public.abandon_intake_session(uuid, uuid, text) to authenticated;

-- =====================================================================================
-- PUBLIC API — draft groups and entries
-- =====================================================================================
-- A stale optimistic-concurrency response (returned, not raised).
create function app.intake_stale_conflict(p_group_id uuid, p_expected integer, p_actual integer)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('outcome', 'conflict', 'conflict_type', 'stale_version',
    'message', format('expected version %s but group is at %s', p_expected, p_actual),
    'expected_version', p_expected, 'actual_version', p_actual, 'group_id', p_group_id)
$$;
revoke all on function app.intake_stale_conflict(uuid, integer, integer) from public;

create function public.upsert_intake_group(
  p_workspace_id uuid,
  p_session_id uuid,
  p_group_id uuid,
  p_expected_version integer,
  p_category text,
  p_display_name text,
  p_quantity integer,
  p_tracking_mode text,
  p_serialized_child_count integer,
  p_product_attrs jsonb default '{}'::jsonb,
  p_sku_attrs jsonb default '{}'::jsonb,
  p_source_evidence jsonb default '{}'::jsonb,
  p_condition_state text default null,
  p_location_code text default null,
  p_owner_tagged boolean default false,
  p_unique_condition boolean default false,
  p_requires_item_media boolean default false,
  p_security_sensitive boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public.intake_draft_groups%rowtype;
  v_vertical public.inventory_vertical;
  v_public text;
  v_id uuid;
  v_new_version integer;
  v_prior_state text;
  v_source_state public.intake_source_state;
  v_evidence jsonb;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  if p_category not in ('graded_tcg', 'raw_tcg', 'sealed_tcg', 'footwear', 'other') then
    raise exception 'unknown intake category %', p_category using errcode = '22023';
  end if;
  v_vertical := case
    when p_category in ('graded_tcg', 'raw_tcg', 'sealed_tcg') then 'tcg'
    when p_category = 'footwear' then 'footwear'
    else 'other' end::public.inventory_vertical;

  perform app.intake_assert_governed_attrs(v_vertical, 'product', p_product_attrs);
  perform app.intake_assert_governed_attrs(v_vertical, 'sku', p_sku_attrs);
  perform app.intake_require_open_session(p_workspace_id, p_session_id);

  -- Governed source evidence: a source_kind (when supplied) must be governed; a
  -- caller may NOT force 'candidate' here (candidate is derived from evidence
  -- links). 'stated' is asserted by supplying a governed source_kind.
  if jsonb_typeof(coalesce(p_source_evidence, '{}'::jsonb)->'source_kind') = 'string' then
    if not exists (select 1 from public.intake_reference_options o
                   where o.list_key = 'source_kind'
                     and o.option_value = p_source_evidence->>'source_kind' and o.is_active) then
      raise exception 'ungoverned source_kind "%"', p_source_evidence->>'source_kind'
        using errcode = '22023';
    end if;
    v_evidence := jsonb_build_object('source_kind', p_source_evidence->>'source_kind')
      || (coalesce(p_source_evidence, '{}'::jsonb) - 'source_kind');
    v_source_state := 'stated';
  else
    v_evidence := '{}'::jsonb;
    v_source_state := 'unknown';  -- candidate is derived from links after any attach
  end if;

  if p_group_id is null then
    v_public := app.mint_governed_public_id('RV-IG');
    insert into public.intake_draft_groups (
      workspace_id, session_id, public_id, category, business_vertical, display_name,
      product_attrs, sku_attrs, quantity, tracking_mode, serialized_child_count,
      source_state, source_evidence, condition_state, location_code, owner_tagged,
      unique_condition, requires_item_media, security_sensitive, created_by)
    values (p_workspace_id, p_session_id, v_public, p_category::public.intake_category,
      v_vertical, p_display_name, coalesce(p_product_attrs, '{}'::jsonb),
      coalesce(p_sku_attrs, '{}'::jsonb), p_quantity,
      p_tracking_mode::public.inventory_tracking_mode, p_serialized_child_count,
      v_source_state, v_evidence, p_condition_state, p_location_code, p_owner_tagged,
      p_unique_condition, p_requires_item_media, p_security_sensitive, v_uid)
    returning id, version into v_id, v_new_version;
    perform app.record_intake_transition(p_workspace_id, p_session_id, v_id, 'group_created',
      null, 'draft', v_uid, jsonb_build_object('category', p_category));
    return jsonb_build_object('id', v_id, 'public_id', v_public, 'state', 'draft',
      'version', v_new_version, 'source_state', v_source_state);
  end if;

  select * into v_group from public.intake_draft_groups
  where id = p_group_id and workspace_id = p_workspace_id for update;
  if v_group.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  if v_group.state in ('committed', 'abandoned') then
    raise exception 'intake group % is % and cannot be edited', v_group.public_id, v_group.state
      using errcode = '42501';
  end if;
  if p_expected_version is distinct from v_group.version then
    return app.intake_stale_conflict(p_group_id, p_expected_version, v_group.version);
  end if;
  v_prior_state := v_group.state::text;

  -- If a governed source_kind was supplied, keep 'stated'; otherwise derive
  -- from existing candidate links (attach/remove already keep this coherent).
  if v_source_state <> 'stated' then
    v_source_state := case when exists (
      select 1 from public.intake_candidate_links where group_id = p_group_id)
      then 'candidate' else 'unknown' end;
  end if;

  -- Editing a ready_to_commit group reopens it to draft (governed reopen).
  update public.intake_draft_groups set
    state = 'draft', category = p_category::public.intake_category, business_vertical = v_vertical,
    display_name = p_display_name, product_attrs = coalesce(p_product_attrs, '{}'::jsonb),
    sku_attrs = coalesce(p_sku_attrs, '{}'::jsonb), quantity = p_quantity,
    tracking_mode = p_tracking_mode::public.inventory_tracking_mode,
    serialized_child_count = p_serialized_child_count, source_state = v_source_state,
    source_evidence = v_evidence, condition_state = p_condition_state, location_code = p_location_code,
    owner_tagged = p_owner_tagged, unique_condition = p_unique_condition,
    requires_item_media = p_requires_item_media, security_sensitive = p_security_sensitive,
    version = v_group.version + 1
  where id = p_group_id
  returning version into v_new_version;
  if v_prior_state = 'ready_to_commit' then
    perform app.record_intake_transition(p_workspace_id, p_session_id, p_group_id,
      'state_transition', 'ready_to_commit', 'draft', v_uid, jsonb_build_object('reason', 'edited'));
  end if;
  perform app.record_intake_transition(p_workspace_id, p_session_id, p_group_id, 'group_updated',
    v_prior_state, 'draft', v_uid, jsonb_build_object('version', v_new_version));
  return jsonb_build_object('id', p_group_id, 'public_id', v_group.public_id, 'state', 'draft',
    'version', v_new_version, 'source_state', v_source_state);
end
$$;
revoke all on function public.upsert_intake_group(
  uuid, uuid, uuid, integer, text, text, integer, text, integer, jsonb, jsonb, jsonb, text, text,
  boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.upsert_intake_group(
  uuid, uuid, uuid, integer, text, text, integer, text, integer, jsonb, jsonb, jsonb, text, text,
  boolean, boolean, boolean, boolean) to authenticated;

create function public.upsert_intake_entry(
  p_workspace_id uuid,
  p_group_id uuid,
  p_expected_version integer,
  p_entry_index integer,
  p_grading_company text default null,
  p_numeric_grade text default null,
  p_grade_designation text default null,
  p_certificate_number text default null,
  p_serial_number text default null,
  p_entry_attrs jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public.intake_draft_groups%rowtype;
  v_existing public.intake_entries%rowtype;
  v_public text;
  v_id uuid;
  v_new_version integer;
  v_prior_state text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  select * into v_group from public.intake_draft_groups
  where id = p_group_id and workspace_id = p_workspace_id for update;
  if v_group.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  if v_group.state in ('committed', 'abandoned') then
    raise exception 'intake group % is % and cannot be edited', v_group.public_id, v_group.state
      using errcode = '42501';
  end if;
  perform app.intake_require_open_session(p_workspace_id, v_group.session_id);
  if p_expected_version is distinct from v_group.version then
    return app.intake_stale_conflict(p_group_id, p_expected_version, v_group.version);
  end if;
  perform app.intake_assert_governed_attrs(v_group.business_vertical, 'entry', p_entry_attrs);
  v_prior_state := v_group.state::text;

  select * into v_existing from public.intake_entries
  where group_id = p_group_id and entry_index = p_entry_index and workspace_id = p_workspace_id;
  if v_existing.id is not null then
    update public.intake_entries set
      grading_company = p_grading_company, numeric_grade = p_numeric_grade,
      grade_designation = p_grade_designation, certificate_number = p_certificate_number,
      serial_number = p_serial_number, entry_attrs = coalesce(p_entry_attrs, '{}'::jsonb)
    where id = v_existing.id;
    v_id := v_existing.id;
    v_public := v_existing.public_id;
  else
    v_public := app.mint_governed_public_id('RV-IE');
    insert into public.intake_entries (
      workspace_id, group_id, public_id, entry_index, grading_company, numeric_grade,
      grade_designation, certificate_number, serial_number, entry_attrs, created_by)
    values (p_workspace_id, p_group_id, v_public, p_entry_index, p_grading_company,
      p_numeric_grade, p_grade_designation, p_certificate_number, p_serial_number,
      coalesce(p_entry_attrs, '{}'::jsonb), v_uid)
    returning id into v_id;
  end if;
  -- Any entry change reopens a ready group to draft and bumps version once.
  update public.intake_draft_groups set state = 'draft', version = version + 1
  where id = p_group_id returning version into v_new_version;
  if v_prior_state = 'ready_to_commit' then
    perform app.record_intake_transition(p_workspace_id, v_group.session_id, p_group_id,
      'state_transition', 'ready_to_commit', 'draft', v_uid, jsonb_build_object('reason', 'entry_edited'));
  end if;
  perform app.record_intake_transition(p_workspace_id, v_group.session_id, p_group_id,
    'entry_updated', v_prior_state, 'draft', v_uid,
    jsonb_build_object('entry_index', p_entry_index, 'version', v_new_version));
  return jsonb_build_object('id', v_id, 'public_id', v_public, 'entry_index', p_entry_index,
    'version', v_new_version);
end
$$;
revoke all on function public.upsert_intake_entry(
  uuid, uuid, integer, integer, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.upsert_intake_entry(
  uuid, uuid, integer, integer, text, text, text, text, text, jsonb) to authenticated;

-- =====================================================================================
-- PUBLIC API — rule evaluation, readiness, candidate evidence, preview
-- =====================================================================================
create function public.evaluate_intake_field_rules(p_workspace_id uuid, p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := app.require_intake_member(p_workspace_id);
  if not exists (select 1 from public.intake_draft_groups
                 where id = p_group_id and workspace_id = p_workspace_id) then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  return app.intake_validate_group(p_group_id);
end
$$;
revoke all on function public.evaluate_intake_field_rules(uuid, uuid) from public, anon;
grant execute on function public.evaluate_intake_field_rules(uuid, uuid) to authenticated;

create function public.validate_intake_readiness(p_workspace_id uuid, p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public.intake_draft_groups%rowtype;
  v_eval jsonb;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  select * into v_group from public.intake_draft_groups
  where id = p_group_id and workspace_id = p_workspace_id for update;
  if v_group.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  if v_group.state in ('committed', 'abandoned') then
    raise exception 'intake group % is %', v_group.public_id, v_group.state using errcode = '42501';
  end if;
  perform app.intake_require_open_session(p_workspace_id, v_group.session_id);

  v_eval := app.intake_validate_group(p_group_id);
  if (v_eval->>'ready')::boolean then
    if v_group.state = 'draft' then
      perform app.intake_assert_transition('draft', 'ready_to_commit');
      update public.intake_draft_groups set state = 'ready_to_commit' where id = p_group_id;
      perform app.record_intake_transition(p_workspace_id, v_group.session_id, p_group_id,
        'state_transition', 'draft', 'ready_to_commit', v_uid, v_eval);
    end if;
  else
    if v_group.state = 'ready_to_commit' then
      update public.intake_draft_groups set state = 'draft' where id = p_group_id;
      perform app.record_intake_transition(p_workspace_id, v_group.session_id, p_group_id,
        'state_transition', 'ready_to_commit', 'draft', v_uid, v_eval);
    end if;
  end if;
  return v_eval
    || jsonb_build_object('next_action_preview', app.intake_compute_next_action(p_group_id),
                          'version', v_group.version);
end
$$;
revoke all on function public.validate_intake_readiness(uuid, uuid) from public, anon;
grant execute on function public.validate_intake_readiness(uuid, uuid) to authenticated;

create function public.transition_intake_group(
  p_workspace_id uuid, p_group_id uuid, p_target_state text, p_reason jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public.intake_draft_groups%rowtype;
  v_eval jsonb;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  if p_target_state not in ('ready_to_commit', 'draft', 'abandoned') then
    raise exception 'commit uses commit_intake_group; target % is not a manual edge', p_target_state
      using errcode = '22023';
  end if;
  select * into v_group from public.intake_draft_groups
  where id = p_group_id and workspace_id = p_workspace_id for update;
  if v_group.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  -- Abandonment is always permitted (even under an abandoned session, though the
  -- session's own abandon already cascades). Other edges require an open session.
  if p_target_state <> 'abandoned' then
    perform app.intake_require_open_session(p_workspace_id, v_group.session_id);
  end if;
  perform app.intake_assert_transition(v_group.state::text, p_target_state);
  if p_target_state = 'ready_to_commit' then
    v_eval := app.intake_validate_group(p_group_id);
    if not (v_eval->>'ready')::boolean then
      raise exception 'intake group not ready: %', v_eval->'blockers' using errcode = '23514';
    end if;
  end if;
  update public.intake_draft_groups set state = p_target_state::public.intake_group_state
  where id = p_group_id;
  perform app.record_intake_transition(p_workspace_id, v_group.session_id, p_group_id,
    case when p_target_state = 'abandoned' then 'abandon' else 'state_transition' end,
    v_group.state::text, p_target_state, v_uid, coalesce(p_reason, '{}'::jsonb));
  return jsonb_build_object('id', p_group_id, 'state', p_target_state);
end
$$;
revoke all on function public.transition_intake_group(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.transition_intake_group(uuid, uuid, text, jsonb) to authenticated;

create function public.attach_intake_candidate(
  p_workspace_id uuid,
  p_group_id uuid,
  p_expected_version integer,
  p_acquisition_line_item_id uuid,
  p_entry_id uuid default null,
  p_confidence text default 'low',
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public.intake_draft_groups%rowtype;
  v_id uuid;
  v_new_version integer;
  v_source_state public.intake_source_state;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  select * into v_group from public.intake_draft_groups
  where id = p_group_id and workspace_id = p_workspace_id for update;
  if v_group.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  if v_group.state <> 'draft' then
    raise exception 'candidate evidence may only be attached to a draft group'
      using errcode = '42501';
  end if;
  perform app.intake_require_open_session(p_workspace_id, v_group.session_id);
  if p_expected_version is distinct from v_group.version then
    return app.intake_stale_conflict(p_group_id, p_expected_version, v_group.version);
  end if;
  if not exists (select 1 from public.acquisition_line_items
                 where id = p_acquisition_line_item_id and workspace_id = p_workspace_id) then
    raise exception 'acquisition line not found in this workspace' using errcode = '23514';
  end if;
  -- The composite FK (entry_id, group_id) -> intake_entries(id, group_id)
  -- guarantees any supplied entry belongs to THIS group.
  insert into public.intake_candidate_links (
    workspace_id, group_id, entry_id, acquisition_line_item_id, evidence, confidence, created_by)
  values (p_workspace_id, p_group_id, p_entry_id, p_acquisition_line_item_id,
    coalesce(p_evidence, '{}'::jsonb), p_confidence, v_uid)
  returning id into v_id;
  -- Derive source_state coherently and bump version exactly once.
  v_source_state := app.intake_derive_source_state(p_group_id);
  update public.intake_draft_groups
  set source_state = v_source_state, version = version + 1 where id = p_group_id
  returning version into v_new_version;
  perform app.record_intake_transition(p_workspace_id, v_group.session_id, p_group_id,
    'candidate_attached', 'draft', 'draft', v_uid,
    jsonb_build_object('acquisition_line_item_id', p_acquisition_line_item_id,
      'confidence', p_confidence, 'version', v_new_version));
  return jsonb_build_object('id', v_id, 'financial_effect', false, 'version', v_new_version,
    'source_state', v_source_state);
end
$$;
revoke all on function public.attach_intake_candidate(uuid, uuid, integer, uuid, uuid, text, jsonb)
  from public, anon;
grant execute on function public.attach_intake_candidate(uuid, uuid, integer, uuid, uuid, text, jsonb)
  to authenticated;

create function public.remove_intake_candidate(
  p_workspace_id uuid, p_candidate_link_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_link public.intake_candidate_links%rowtype;
  v_group public.intake_draft_groups%rowtype;
  v_new_version integer;
  v_source_state public.intake_source_state;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  select * into v_link from public.intake_candidate_links
  where id = p_candidate_link_id and workspace_id = p_workspace_id;
  if v_link.id is null then
    raise exception 'candidate link not found' using errcode = '23514';
  end if;
  select * into v_group from public.intake_draft_groups where id = v_link.group_id for update;
  if v_group.state <> 'draft' then
    raise exception 'candidate evidence may only be changed on a draft group'
      using errcode = '42501';
  end if;
  perform app.intake_require_open_session(p_workspace_id, v_group.session_id);
  if p_expected_version is distinct from v_group.version then
    return app.intake_stale_conflict(v_link.group_id, p_expected_version, v_group.version);
  end if;
  delete from public.intake_candidate_links where id = p_candidate_link_id;
  -- Removing the last candidate returns to unknown unless a governed stated
  -- source exists.
  v_source_state := app.intake_derive_source_state(v_link.group_id);
  update public.intake_draft_groups
  set source_state = v_source_state, version = version + 1 where id = v_link.group_id
  returning version into v_new_version;
  perform app.record_intake_transition(p_workspace_id, v_group.session_id, v_link.group_id,
    'candidate_removed', 'draft', 'draft', v_uid,
    jsonb_build_object('acquisition_line_item_id', v_link.acquisition_line_item_id,
      'version', v_new_version, 'source_state', v_source_state));
  return jsonb_build_object('id', p_candidate_link_id, 'removed', true, 'version', v_new_version,
    'source_state', v_source_state);
end
$$;
revoke all on function public.remove_intake_candidate(uuid, uuid, integer) from public, anon;
grant execute on function public.remove_intake_candidate(uuid, uuid, integer) to authenticated;

create function public.preview_intake_commit(p_workspace_id uuid, p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_g public.intake_draft_groups%rowtype;
  v_key text;
  v_fp text;
  v_product public.product_catalog%rowtype;
  v_sku_exists boolean := false;
  v_eval jsonb;
begin
  v_uid := app.require_intake_member(p_workspace_id);
  select * into v_g from public.intake_draft_groups
  where id = p_group_id and workspace_id = p_workspace_id;
  if v_g.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  -- Preview implies commit readiness, so it is refused under a dead session.
  perform app.intake_require_open_session(p_workspace_id, v_g.session_id);
  v_key := app.intake_product_canonical_key(v_g.business_vertical::text, v_g.display_name, v_g.product_attrs);
  v_fp := app.sku_fingerprint('IDSKU1', v_g.business_vertical::text, v_key, coalesce(v_g.sku_attrs, '{}'::jsonb));
  select * into v_product from public.product_catalog
  where workspace_id = p_workspace_id and product_canonical_key = v_key;
  if v_product.id is not null then
    select exists (
      select 1 from public.sellable_skus s
      where s.workspace_id = p_workspace_id and s.product_id = v_product.id
        and s.identity_schema_version = 'IDSKU1' and s.fingerprint = v_fp and s.is_active
    ) into v_sku_exists;
  end if;
  v_eval := app.intake_validate_group(p_group_id);
  return jsonb_build_object(
    'staging', true, 'authoritative', false,
    'content_hash', app.intake_content_hash(p_group_id),
    'product_canonical_key', v_key, 'sku_fingerprint', v_fp,
    'would_create_product', v_product.id is null, 'would_create_sku', not v_sku_exists,
    'existing_product_id', v_product.id, 'tracking_mode', v_g.tracking_mode,
    'quantity', v_g.quantity, 'serialized_child_count', v_g.serialized_child_count,
    'source_state', v_g.source_state,
    'candidates', app.intake_candidate_snapshot(p_group_id),
    'next_action_preview', app.intake_compute_next_action(p_group_id),
    'ready', v_eval->'ready', 'blockers', v_eval->'blockers', 'rule_version', v_eval->'rule_version');
end
$$;
revoke all on function public.preview_intake_commit(uuid, uuid) from public, anon;
grant execute on function public.preview_intake_commit(uuid, uuid) to authenticated;

-- =====================================================================================
-- PUBLIC API — the transactional commit kernel
-- =====================================================================================
create function public.commit_intake_group(
  p_workspace_id uuid,
  p_group_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_g public.intake_draft_groups%rowtype;
  v_existing public.intake_commit_attempts%rowtype;
  v_server_hash text;
  v_eval jsonb;
  v_rulever text;
  v_prod jsonb;
  v_sku jsonb;
  v_lot jsonb;
  v_lot_public text;
  v_product_id uuid;
  v_sku_id uuid;
  v_lot_id uuid;
  v_next public.intake_next_action;
  v_entry record;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_receipt jsonb;
  v_gc text;
  v_sqlstate text;
  v_class text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_g from public.intake_draft_groups
  where id = p_group_id and workspace_id = p_workspace_id for update;
  if v_g.id is null then
    raise exception 'intake group not found' using errcode = '23514';
  end if;
  perform app.intake_require_open_session(p_workspace_id, v_g.session_id);

  v_server_hash := app.intake_content_hash(p_group_id);

  -- Already committed: idempotent replay or a structured conflict (audit durable).
  if v_g.state = 'committed' then
    select * into v_existing from public.intake_commit_attempts
    where workspace_id = p_workspace_id and group_id = p_group_id
      and idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      if v_existing.content_hash is distinct from p_content_hash then
        perform app.record_intake_transition(p_workspace_id, v_g.session_id, p_group_id,
          'commit_conflict', 'committed', 'committed', v_uid,
          jsonb_build_object('reason', 'idempotency_content_changed', 'idempotency_key', p_idempotency_key));
        return jsonb_build_object('outcome', 'conflict', 'conflict_type', 'idempotency_content_changed',
          'message', 'the idempotency key was reused with changed content', 'group_id', p_group_id);
      end if;
      return v_existing.receipt || jsonb_build_object('outcome', 'committed', 'idempotent_replay', true);
    end if;
    perform app.record_intake_transition(p_workspace_id, v_g.session_id, p_group_id,
      'commit_conflict', 'committed', 'committed', v_uid,
      jsonb_build_object('reason', 'already_committed', 'idempotency_key', p_idempotency_key));
    return jsonb_build_object('outcome', 'conflict', 'conflict_type', 'already_committed',
      'message', format('intake group %s is already committed', v_g.public_id), 'group_id', p_group_id);
  end if;

  if v_g.state = 'abandoned' then
    raise exception 'intake group % is abandoned', v_g.public_id using errcode = '23514';
  end if;

  if p_content_hash is distinct from v_server_hash then
    perform app.record_intake_transition(p_workspace_id, v_g.session_id, p_group_id,
      'commit_conflict', v_g.state::text, v_g.state::text, v_uid,
      jsonb_build_object('reason', 'content_hash_mismatch'));
    return jsonb_build_object('outcome', 'conflict', 'conflict_type', 'content_hash_mismatch',
      'message', 'submitted content does not match the current draft', 'group_id', p_group_id);
  end if;

  if p_expected_version is distinct from v_g.version then
    perform app.record_intake_transition(p_workspace_id, v_g.session_id, p_group_id,
      'commit_conflict', v_g.state::text, v_g.state::text, v_uid,
      jsonb_build_object('reason', 'stale_version', 'expected', p_expected_version, 'actual', v_g.version));
    return app.intake_stale_conflict(p_group_id, p_expected_version, v_g.version);
  end if;

  -- Re-run all authoritative rules INSIDE the transaction.
  v_eval := app.intake_validate_group(p_group_id);
  if not (v_eval->>'ready')::boolean then
    perform app.record_intake_transition(p_workspace_id, v_g.session_id, p_group_id,
      'commit_failed', v_g.state::text, v_g.state::text, v_uid,
      jsonb_build_object('reason', 'not_ready', 'blockers', v_eval->'blockers'));
    return jsonb_build_object('outcome', 'blocked', 'blockers', v_eval->'blockers',
      'rule_version', v_eval->'rule_version', 'group_id', p_group_id);
  end if;
  v_rulever := v_eval->>'rule_version';
  v_next := app.intake_compute_next_action(p_group_id);

  -- Canonical writes in a controlled subtransaction. On a genuine mid-write
  -- failure the subtransaction rolls back ALL Product/SKU/Lot/Item writes and
  -- the group state change, then a durable commit_failed event is recorded in
  -- the outer transaction and a structured failure is returned — no partial
  -- identity persists and the draft remains recoverable.
  begin
    -- Persist the governed draft -> ready_to_commit edge (stored state, not just
    -- an audit note), then ready_to_commit -> committed.
    if v_g.state = 'draft' then
      perform app.intake_assert_transition('draft', 'ready_to_commit');
      update public.intake_draft_groups set state = 'ready_to_commit' where id = p_group_id;
      perform app.record_intake_transition(p_workspace_id, v_g.session_id, p_group_id,
        'state_transition', 'draft', 'ready_to_commit', v_uid, v_eval);
    end if;
    perform app.intake_assert_transition('ready_to_commit', 'committed');

    v_prod := public.register_product(p_workspace_id, v_g.business_vertical::text, v_g.display_name,
      app.intake_product_canonical_key(v_g.business_vertical::text, v_g.display_name, v_g.product_attrs),
      coalesce(v_g.product_attrs, '{}'::jsonb));
    v_product_id := (v_prod->>'id')::uuid;
    v_sku := public.register_sellable_sku(p_workspace_id, v_product_id, coalesce(v_g.sku_attrs, '{}'::jsonb));
    v_sku_id := (v_sku->>'id')::uuid;

    -- Location was validated to resolve to an existing ACTIVE location; pass the
    -- code to the lot registrar (which resolves it). No location is ever minted
    -- during intake.
    v_lot_public := app.mint_intake_lot_public_id();
    v_lot := public.stage_inventory_lot(p_workspace_id, v_lot_public, v_sku_id,
      v_g.tracking_mode::text, v_g.quantity, v_g.location_code, 'intake.kernel', '1.0.0', null);
    v_lot_id := (v_lot->>'id')::uuid;

    if v_g.tracking_mode = 'serialized' then
      for v_entry in
        select * from public.intake_entries
        where group_id = p_group_id and workspace_id = p_workspace_id order by entry_index
      loop
        -- Graded identity is canonical on the SKU: derive the item's grading
        -- company from the SKU so a CGC SKU can never mint a PSA item.
        v_gc := case when v_g.category = 'graded_tcg'
          then nullif(btrim(coalesce(v_g.sku_attrs->>'grading_company', '')), '')
          else v_entry.grading_company end;
        v_item := public.mint_serialized_item(p_workspace_id, v_lot_id,
          v_gc, v_entry.certificate_number, v_entry.serial_number);
        update public.intake_entries set committed_item_id = (v_item->>'id')::uuid
        where id = v_entry.id;
        v_items := v_items || jsonb_build_object(
          'entry_id', v_entry.id, 'entry_index', v_entry.entry_index,
          'item_id', v_item->>'id', 'item_public_id', v_item->>'public_id',
          'scan_sku', v_item->>'scan_sku');
      end loop;
      if jsonb_array_length(v_items) <> v_g.serialized_child_count then
        raise exception 'serialized child count mismatch: expected % but minted %',
          v_g.serialized_child_count, jsonb_array_length(v_items) using errcode = 'check_violation';
      end if;
    end if;

    update public.intake_draft_groups set
      state = 'committed', committed_product_id = v_product_id, committed_sku_id = v_sku_id,
      committed_lot_id = v_lot_id, committed_at = now(), committed_by = v_uid,
      applied_rule_version = v_rulever, next_action = v_next
    where id = p_group_id;

    v_receipt := jsonb_build_object(
      'session_id', v_g.session_id, 'group_id', p_group_id, 'group_public_id', v_g.public_id,
      'idempotency_key', p_idempotency_key,
      'product_id', v_product_id, 'product_public_id', v_prod->>'public_id',
      'product_created', (v_prod->>'created')::boolean,
      'sku_id', v_sku_id, 'sku_public_id', v_sku->>'public_id',
      'sku_fingerprint', v_sku->>'fingerprint', 'sku_created', (v_sku->>'created')::boolean,
      'lot_id', v_lot_id, 'lot_public_id', v_lot->>'public_id',
      'tracking_mode', v_g.tracking_mode, 'quantity', v_g.quantity, 'items', v_items,
      'source_state', v_g.source_state, 'source_evidence', v_g.source_evidence,
      'candidates', app.intake_candidate_snapshot(p_group_id),
      'applied_rule_version', v_rulever, 'next_action', v_next,
      'actor', v_uid, 'committed_at', to_jsonb(now()));

    insert into public.intake_commit_attempts (
      workspace_id, session_id, group_id, idempotency_key, content_hash, outcome, receipt,
      applied_rule_version, next_action, actor_user_id)
    values (p_workspace_id, v_g.session_id, p_group_id, p_idempotency_key, v_server_hash,
      'committed', v_receipt, v_rulever, v_next, v_uid);

    perform app.record_intake_transition(p_workspace_id, v_g.session_id, p_group_id,
      'commit', 'ready_to_commit', 'committed', v_uid,
      jsonb_build_object('idempotency_key', p_idempotency_key, 'lot_public_id', v_lot->>'public_id',
        'next_action', v_next));
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    v_class := case
      when v_sqlstate = '23505' then 'duplicate_identity'
      when v_sqlstate = '23514' then 'check_violation'
      when v_sqlstate = '23503' then 'foreign_key_violation'
      else 'internal_error' end;
    -- The subtransaction rolled back every canonical write and the state change.
    -- Record a durable, sanitized failure event in the OUTER transaction.
    perform app.record_intake_transition(p_workspace_id, v_g.session_id, p_group_id,
      'commit_failed', v_g.state::text, v_g.state::text, v_uid,
      jsonb_build_object('idempotency_key', p_idempotency_key, 'failure_class', v_class,
        'sqlstate', v_sqlstate, 'reason', 'canonical write failed and was rolled back'));
    return jsonb_build_object('outcome', 'failed', 'failure_class', v_class, 'sqlstate', v_sqlstate,
      'message', 'the commit failed and was fully rolled back; the draft is recoverable',
      'group_id', p_group_id);
  end;

  return v_receipt || jsonb_build_object('outcome', 'committed', 'idempotent_replay', false);
end
$$;
revoke all on function public.commit_intake_group(uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.commit_intake_group(uuid, uuid, text, integer, text) to authenticated;

create function public.get_intake_commit_receipt(p_workspace_id uuid, p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_attempt public.intake_commit_attempts%rowtype;
begin
  v_uid := app.require_intake_member(p_workspace_id);
  select * into v_attempt from public.intake_commit_attempts
  where workspace_id = p_workspace_id and group_id = p_group_id and outcome = 'committed'
  order by created_at asc limit 1;
  if v_attempt.id is null then
    raise exception 'no committed receipt for this intake group' using errcode = '23514';
  end if;
  return v_attempt.receipt
    || jsonb_build_object('next_action', v_attempt.next_action,
                          'applied_rule_version', v_attempt.applied_rule_version);
end
$$;
revoke all on function public.get_intake_commit_receipt(uuid, uuid) from public, anon;
grant execute on function public.get_intake_commit_receipt(uuid, uuid) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260722000500_intake_kernel_functions');
