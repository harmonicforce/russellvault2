-- S1.2 governed acquisition classification functions.

create function app.acquisition_delivered_item_title(p_full_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_full_title is null then null
    when strpos(reverse(p_full_title), ' - ') > 0 then
      nullif(btrim(right(p_full_title, strpos(reverse(p_full_title), ' - ') - 1)), '')
    else nullif(btrim(p_full_title), '')
  end;
$$;
revoke all on function app.acquisition_delivered_item_title(text) from public;

create function app.get_acquisition_classification_input(p_acquisition_line_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'workspace_id', li.workspace_id,
    'acquisition_line_item_id', li.id,
    'acquisition_line_public_id', li.public_id,
    'import_job_id', li.acquisition_import_job_id,
    'import_job_status', j.status::text,
    'business_vertical', nullif(btrim(coalesce(li.source_detail->>'business_vertical', sr.raw_payload->>'business_vertical', sr.parser_output->>'business_vertical')), ''),
    'full_title', nullif(btrim(coalesce(li.source_detail->>'product_name', li.source_detail->>'full_title', li.description, sr.raw_payload->>'product_name', sr.parser_output->>'product_name')), ''),
    'delivered_item_title', app.acquisition_delivered_item_title(coalesce(li.source_detail->>'product_name', li.source_detail->>'full_title', li.description, sr.raw_payload->>'product_name', sr.parser_output->>'product_name')),
    'seller_normalized', a.normalized_handle,
    'explicit_evidence', jsonb_build_object('legacy_sealed_line_ids_available', false),
    'source_record_id', li.source_record_id,
    'source_system_id', li.source_system_id,
    'source_system_kind', ss.kind,
    'source_system_public_id', ss.public_id
  ) into v
  from public.acquisition_line_items li
  join public.acquisition_import_jobs j on j.id = li.acquisition_import_job_id and j.workspace_id = li.workspace_id
  join public.source_records sr on sr.id = li.source_record_id and sr.workspace_id = li.workspace_id
  join public.source_systems ss on ss.id = li.source_system_id and ss.workspace_id = li.workspace_id
  left join public.acquisition_lot_lines ll on ll.line_item_id = li.id and ll.workspace_id = li.workspace_id and ll.state = 'active'
  left join public.acquisition_lots lt on lt.id = ll.lot_id and lt.workspace_id = li.workspace_id
  left join public.acquisition_orders o on o.id = lt.order_id and o.workspace_id = li.workspace_id
  left join public.supplier_aliases a on a.supplier_id = o.supplier_id and a.workspace_id = o.workspace_id and a.source_system_id = o.source_system_id
  where li.id = p_acquisition_line_item_id;
  if v is null then raise exception 'acquisition line not found or not authorized' using errcode='42501'; end if;
  return v;
end $$;
revoke all on function app.get_acquisition_classification_input(uuid) from public;

create function app.classification_match_value(p_input jsonb, p_field text)
returns text language sql immutable set search_path='' as $$
  select case p_field
    when 'business_vertical' then p_input->>'business_vertical'
    when 'delivered_item_title' then p_input->>'delivered_item_title'
    when 'full_title' then p_input->>'full_title'
    when 'seller_normalized' then p_input->>'seller_normalized'
    when 'acquisition_line_id' then p_input->>'acquisition_line_public_id'
    else null end;
$$;
revoke all on function app.classification_match_value(jsonb,text) from public;

create function app.regex_flags_supported(p_flags text)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_flags, '') ~ '^[imsx]*$';
$$;
revoke all on function app.regex_flags_supported(text) from public;

create function app.evaluate_acquisition_classification(p_acquisition_line_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_input jsonb; v_match_count int; v_conflict_count int; v_rule public.classification_rules%rowtype; v_option public.acquisition_classification_options%rowtype;
begin
  v_input := app.get_acquisition_classification_input(p_acquisition_line_item_id);
  with matched as (
    select r.*
    from public.classification_rules r
    where r.workspace_id = (v_input->>'workspace_id')::uuid and r.status='active'
      and case r.matcher_kind
        when 'exact' then app.classification_match_value(v_input,r.match_field) = r.exact_value
        when 'regex' then app.classification_match_value(v_input,r.match_field) ~ (case when position('i' in coalesce(r.pattern_flags,''))>0 then '(?i)' else '' end || r.pattern)
        when 'evidence_set' then false
        else false end
  ), winning as (select * from matched where precedence = (select min(precedence) from matched))
  select count(*), count(distinct target_classification_option_id) into v_match_count, v_conflict_count from winning;

  if v_match_count > 0 and v_conflict_count > 1 then
    raise exception 'ambiguous acquisition classification rules for winning precedence' using errcode='23514';
  end if;
  if v_match_count > 1 then
    raise exception 'ambiguous acquisition classification rules for winning precedence' using errcode='23514';
  end if;
  if v_match_count = 1 then
    select * into v_rule from public.classification_rules r where r.id = (select id from (
      select r.id from public.classification_rules r
      where r.workspace_id=(v_input->>'workspace_id')::uuid and r.status='active'
        and case r.matcher_kind
          when 'exact' then app.classification_match_value(v_input,r.match_field)=r.exact_value
          when 'regex' then app.classification_match_value(v_input,r.match_field) ~ (case when position('i' in coalesce(r.pattern_flags,''))>0 then '(?i)' else '' end || r.pattern)
          when 'evidence_set' then false else false end
      order by r.precedence, r.logical_key
    ) s limit 1);
    select * into v_option from public.acquisition_classification_options where id=v_rule.target_classification_option_id and workspace_id=v_rule.workspace_id;
    return jsonb_build_object('workspace_id',v_rule.workspace_id,'acquisition_line_item_id',p_acquisition_line_item_id,'classification_option_id',v_option.id,'option_key',v_option.key,'option_label',v_option.label,'rule_id',v_rule.id,'rule_public_id',v_rule.public_id,'rule_version',v_rule.version,'logical_key',v_rule.logical_key,'rule_family',v_rule.rule_family,'method',case when v_rule.rule_family='seller_specialization' then 'seller_specialization' when v_rule.rule_family='explicit_evidence' then 'explicit_evidence' else 'rule' end,'confidence',1.0000,'system_provenance','governed_acquisition_classifier_s1_2','evidence',jsonb_build_object('input',v_input,'matched_field',v_rule.match_field,'matcher_kind',v_rule.matcher_kind,'explicit_evidence_status','legacy_sealed_line_ids_unavailable'));
  end if;
  select * into v_option from public.acquisition_classification_options where workspace_id=(v_input->>'workspace_id')::uuid and key='unreviewed' and active;
  if v_option.id is null then raise exception 'active unreviewed classification option is required' using errcode='23514'; end if;
  return jsonb_build_object('workspace_id',v_option.workspace_id,'acquisition_line_item_id',p_acquisition_line_item_id,'classification_option_id',v_option.id,'option_key',v_option.key,'option_label',v_option.label,'rule_id',null,'rule_public_id',null,'rule_version',null,'logical_key',null,'rule_family',null,'method','rule','confidence',1.0000,'system_provenance','governed_acquisition_classifier_s1_2','evidence',jsonb_build_object('input',v_input,'fallback','no_active_rule_match','explicit_evidence_status','legacy_sealed_line_ids_unavailable'));
end $$;
revoke all on function app.evaluate_acquisition_classification(uuid) from public;

alter table public.acquisition_line_classifications drop constraint acquisition_line_classifications_rule_presence;
alter table public.acquisition_line_classifications add constraint acquisition_line_classifications_rule_presence check (
  (method in ('seller_specialization','explicit_evidence') and rule_id is not null and rule_version is not null)
  or (method = 'rule' and ((rule_id is not null and rule_version is not null) or system_provenance is not null))
  or (method = 'owner_override' and rule_id is null and rule_version is null)
);

create function app.acquisition_classification_receipt(p_row public.acquisition_line_classifications, p_status text, p_predecessor_public_id text default null)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('status',p_status,'classification_public_id',p_row.public_id,'line_public_id',li.public_id,'option_key',o.key,'option_label',o.label,'method',p_row.method,'rule_public_id',r.public_id,'logical_key',r.logical_key,'rule_version',p_row.rule_version,'predecessor_public_id',p_predecessor_public_id,'owner_override_preserved',p_status='owner_override_preserved')
  from public.acquisition_line_items li join public.acquisition_classification_options o on o.id=p_row.classification_option_id and o.workspace_id=p_row.workspace_id left join public.classification_rules r on r.id=p_row.rule_id and r.workspace_id=p_row.workspace_id
  where li.id=p_row.acquisition_line_item_id and li.workspace_id=p_row.workspace_id;
$$;
revoke all on function app.acquisition_classification_receipt(public.acquisition_line_classifications,text,text) from public;

create function public.classify_acquisition_line(p_acquisition_line_item_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_line public.acquisition_line_items%rowtype; v_eval jsonb; v_current public.acquisition_line_classifications%rowtype; v_new public.acquisition_line_classifications%rowtype; v_prev_public text; v_status text;
begin
  v_uid := app.require_uid();
  select li.* into v_line from public.acquisition_line_items li join public.workspace_members m on m.workspace_id=li.workspace_id and m.user_id=v_uid and m.role in ('owner','operator') where li.id=p_acquisition_line_item_id for update of li;
  if v_line.id is null then raise exception 'acquisition line not found or not authorized' using errcode='42501'; end if;
  perform app.require_committed_acquisition_job(v_line.acquisition_import_job_id);
  select * into v_current from public.acquisition_line_classifications where workspace_id=v_line.workspace_id and acquisition_line_item_id=v_line.id and superseded_at is null for update;
  if v_current.method='owner_override' then return app.acquisition_classification_receipt(v_current,'owner_override_preserved'); end if;
  v_eval := app.evaluate_acquisition_classification(v_line.id);
  if v_current.id is not null and v_current.classification_option_id=(v_eval->>'classification_option_id')::uuid and v_current.method=v_eval->>'method' and v_current.rule_id is not distinct from nullif(v_eval->>'rule_id','')::uuid and v_current.rule_version is not distinct from nullif(v_eval->>'rule_version','')::integer then
    return app.acquisition_classification_receipt(v_current,'idempotent');
  end if;
  if v_current.id is not null then update public.acquisition_line_classifications set superseded_at=now() where id=v_current.id and superseded_at is null returning public_id into v_prev_public; v_status='superseded'; else v_status='classified'; end if;
  insert into public.acquisition_line_classifications(workspace_id,acquisition_line_item_id,classification_option_id,method,rule_id,rule_version,confidence,evidence,system_provenance,created_by,supersedes_classification_id)
  values(v_line.workspace_id,v_line.id,(v_eval->>'classification_option_id')::uuid,v_eval->>'method',nullif(v_eval->>'rule_id','')::uuid,nullif(v_eval->>'rule_version','')::integer,(v_eval->>'confidence')::numeric,v_eval->'evidence',v_eval->>'system_provenance',null,v_current.id) returning * into v_new;
  perform app.log_audit_event(v_line.workspace_id, case when v_current.id is null then 'acquisition_line_classified' else 'acquisition_line_classification_superseded' end, 'acquisition_line_classifications', v_new.id, v_uid, 'acquisition.classification', v_line.acquisition_import_job_id, v_line.source_record_id, null, jsonb_build_object('line_public_id',v_line.public_id,'option_key',v_eval->>'option_key','rule_version',v_eval->>'rule_version','predecessor_public_id',v_prev_public));
  return app.acquisition_classification_receipt(v_new,v_status,v_prev_public);
end $$;
revoke all on function public.classify_acquisition_line(uuid) from public, anon;
grant execute on function public.classify_acquisition_line(uuid) to authenticated;

create function public.override_acquisition_line_classification(p_acquisition_line_item_id uuid,p_classification_option_key text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_line public.acquisition_line_items%rowtype; v_opt public.acquisition_classification_options%rowtype; v_current public.acquisition_line_classifications%rowtype; v_new public.acquisition_line_classifications%rowtype; v_reason text; v_prev_public text;
begin
 v_uid:=app.require_uid(); v_reason:=btrim(coalesce(p_reason,'')); if char_length(v_reason) < 1 then raise exception 'override reason is required' using errcode='22023'; end if; if char_length(v_reason)>500 then raise exception 'override reason is too long' using errcode='22023'; end if;
 select li.* into v_line from public.acquisition_line_items li join public.workspace_members m on m.workspace_id=li.workspace_id and m.user_id=v_uid and m.role='owner' where li.id=p_acquisition_line_item_id for update of li;
 if v_line.id is null then raise exception 'acquisition line not found or not authorized' using errcode='42501'; end if; perform app.require_committed_acquisition_job(v_line.acquisition_import_job_id);
 select * into v_opt from public.acquisition_classification_options where workspace_id=v_line.workspace_id and key=p_classification_option_key and active;
 if v_opt.id is null then raise exception 'classification option not found or inactive' using errcode='23514'; end if;
 select * into v_current from public.acquisition_line_classifications where workspace_id=v_line.workspace_id and acquisition_line_item_id=v_line.id and superseded_at is null for update;
 if v_current.method='owner_override' and v_current.classification_option_id=v_opt.id then return app.acquisition_classification_receipt(v_current,'idempotent'); end if;
 if v_current.id is not null then update public.acquisition_line_classifications set superseded_at=now() where id=v_current.id and superseded_at is null returning public_id into v_prev_public; end if;
 insert into public.acquisition_line_classifications(workspace_id,acquisition_line_item_id,classification_option_id,method,confidence,evidence,created_by,supersedes_classification_id)
 values(v_line.workspace_id,v_line.id,v_opt.id,'owner_override',1.0000,jsonb_build_object('owner_reason',v_reason),v_uid,v_current.id) returning * into v_new;
 perform app.log_audit_event(v_line.workspace_id,'acquisition_line_classification_overridden','acquisition_line_classifications',v_new.id,v_uid,'acquisition.classification',v_line.acquisition_import_job_id,v_line.source_record_id,null,jsonb_build_object('line_public_id',v_line.public_id,'option_key',v_opt.key,'reason_length',char_length(v_reason),'predecessor_public_id',v_prev_public));
 return app.acquisition_classification_receipt(v_new,'overridden',v_prev_public);
end $$;
revoke all on function public.override_acquisition_line_classification(uuid,text,text) from public, anon;
grant execute on function public.override_acquisition_line_classification(uuid,text,text) to authenticated;

create function app.validate_classification_rule_payload(p_matcher_kind text,p_match_field text,p_pattern text,p_pattern_flags text,p_exact_value text)
returns void language plpgsql immutable set search_path='' as $$
begin
 if p_matcher_kind not in ('exact','regex','evidence_set') then raise exception 'unsupported matcher kind' using errcode='22023'; end if;
 if p_match_field not in ('business_vertical','delivered_item_title','full_title','seller_normalized','acquisition_line_id') then raise exception 'unsupported match field' using errcode='22023'; end if;
 if coalesce(p_pattern_flags,'') !~ '^[imsx]*$' then raise exception 'unsupported regex flags' using errcode='22023'; end if;
 if p_matcher_kind='exact' and (p_exact_value is null or p_pattern is not null or p_pattern_flags is not null) then raise exception 'invalid exact matcher payload' using errcode='22023'; end if;
 if p_matcher_kind='regex' and (p_pattern is null or p_exact_value is not null) then raise exception 'invalid regex matcher payload' using errcode='22023'; end if;
 if p_matcher_kind='evidence_set' and (p_exact_value is not null or p_pattern is not null or p_pattern_flags is not null) then raise exception 'invalid evidence-set matcher payload' using errcode='22023'; end if;
end $$;
revoke all on function app.validate_classification_rule_payload(text,text,text,text,text) from public;

create function public.create_classification_rule(p_workspace_id uuid,p_logical_key text,p_rule_family text,p_matcher_kind text,p_match_field text,p_pattern text,p_pattern_flags text,p_exact_value text,p_target_classification_option_key text,p_precedence integer,p_rationale text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_opt public.acquisition_classification_options%rowtype; v_rule public.classification_rules%rowtype;
begin
 v_uid:=app.assert_workspace_role(p_workspace_id,array['owner']::public.workspace_role[]);
 perform app.validate_classification_rule_payload(p_matcher_kind,p_match_field,p_pattern,p_pattern_flags,p_exact_value);
 if p_rule_family not in ('business_vertical_mapping','delivered_item_pattern','full_title_pattern','strong_mystery_pattern','seller_specialization','explicit_evidence') then raise exception 'unsupported rule family' using errcode='22023'; end if;
 select * into v_opt from public.acquisition_classification_options where workspace_id=p_workspace_id and key=p_target_classification_option_key and active;
 if v_opt.id is null then raise exception 'target classification option not found or inactive' using errcode='23514'; end if;
 insert into public.classification_rules(workspace_id,logical_key,rule_family,matcher_kind,match_field,pattern,pattern_flags,exact_value,target_classification_option_id,precedence,version,status,rationale,source,authored_by)
 values(p_workspace_id,p_logical_key,p_rule_family,p_matcher_kind,p_match_field,p_pattern,p_pattern_flags,p_exact_value,v_opt.id,p_precedence,1,'active',p_rationale,'owner_rule',v_uid) returning * into v_rule;
 perform app.log_audit_event(p_workspace_id,'classification_rule_created','classification_rules',v_rule.id,v_uid,'acquisition.classification',null,null,null,jsonb_build_object('logical_key',v_rule.logical_key,'version',v_rule.version,'option_key',v_opt.key));
 return jsonb_build_object('rule_public_id',v_rule.public_id,'logical_key',v_rule.logical_key,'version',v_rule.version,'status',v_rule.status,'option_key',v_opt.key);
end $$;
revoke all on function public.create_classification_rule(uuid,text,text,text,text,text,text,text,text,integer,text) from public, anon;
grant execute on function public.create_classification_rule(uuid,text,text,text,text,text,text,text,text,integer,text) to authenticated;

create function public.supersede_classification_rule(p_rule_id uuid,p_expected_current_version integer,p_matcher_kind text,p_match_field text,p_pattern text,p_pattern_flags text,p_exact_value text,p_target_classification_option_key text,p_precedence integer,p_rationale text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_old public.classification_rules%rowtype; v_opt public.acquisition_classification_options%rowtype; v_new public.classification_rules%rowtype;
begin
 v_uid:=app.require_uid();
 select r.* into v_old from public.classification_rules r join public.workspace_members m on m.workspace_id=r.workspace_id and m.user_id=v_uid and m.role='owner' where r.id=p_rule_id and r.status='active' for update of r;
 if v_old.id is null then raise exception 'classification rule not found or not authorized' using errcode='42501'; end if;
 if v_old.version <> p_expected_current_version then raise exception 'stale classification rule version' using errcode='40001'; end if;
 perform app.validate_classification_rule_payload(p_matcher_kind,p_match_field,p_pattern,p_pattern_flags,p_exact_value);
 select * into v_opt from public.acquisition_classification_options where workspace_id=v_old.workspace_id and key=p_target_classification_option_key and active;
 if v_opt.id is null then raise exception 'target classification option not found or inactive' using errcode='23514'; end if;
 update public.classification_rules set status='superseded' where id=v_old.id and status='active';
 insert into public.classification_rules(workspace_id,logical_key,rule_family,matcher_kind,match_field,pattern,pattern_flags,exact_value,target_classification_option_id,precedence,version,status,rationale,source,authored_by,supersedes_rule_id)
 values(v_old.workspace_id,v_old.logical_key,v_old.rule_family,p_matcher_kind,p_match_field,p_pattern,p_pattern_flags,p_exact_value,v_opt.id,p_precedence,v_old.version+1,'active',p_rationale,'owner_rule',v_uid,v_old.id) returning * into v_new;
 perform app.log_audit_event(v_old.workspace_id,'classification_rule_superseded','classification_rules',v_new.id,v_uid,'acquisition.classification',null,null,null,jsonb_build_object('logical_key',v_new.logical_key,'old_version',v_old.version,'new_version',v_new.version,'option_key',v_opt.key,'supersedes_rule_id',v_old.id));
 return jsonb_build_object('rule_public_id',v_new.public_id,'logical_key',v_new.logical_key,'version',v_new.version,'status',v_new.status,'supersedes_rule_id',v_old.id,'option_key',v_opt.key);
end $$;
revoke all on function public.supersede_classification_rule(uuid,integer,text,text,text,text,text,text,integer,text) from public, anon;
grant execute on function public.supersede_classification_rule(uuid,integer,text,text,text,text,text,text,integer,text) to authenticated;

insert into public.schema_migrations_log (migration_name) values ('20260805000100_governed_acquisition_classification_functions');
