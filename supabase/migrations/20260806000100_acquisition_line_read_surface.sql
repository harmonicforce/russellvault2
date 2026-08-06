-- S1.3 governed, committed acquisition-line read surface.

create view public.acquisition_line_overview
with (security_invoker = true)
as
select
  li.workspace_id,
  li.id as acquisition_line_item_id,
  li.public_id as acquisition_line_public_id,
  li.acquisition_import_job_id,
  j.source_import_job_id,
  li.source_record_id,
  li.source_system_id,
  ss.public_id as source_system_public_id,
  ss.kind as source_system_kind,
  li.quantity,
  li.description,
  li.reference_number,
  li.source_detail,
  li.created_at,
  nullif(btrim(coalesce(li.source_detail->>'business_vertical', sr.raw_payload->>'business_vertical', sr.parser_output->>'business_vertical')), '') as business_vertical,
  nullif(btrim(coalesce(li.source_detail->>'product_name', li.source_detail->>'full_title', li.description, sr.raw_payload->>'product_name', sr.parser_output->>'product_name')), '') as full_title,
  app.acquisition_delivered_item_title(coalesce(li.source_detail->>'product_name', li.source_detail->>'full_title', li.description, sr.raw_payload->>'product_name', sr.parser_output->>'product_name')) as delivered_item_title,
  sa.normalized_handle as seller_normalized,
  o.id as acquisition_order_id,
  o.public_id as acquisition_order_public_id,
  o.source_order_reference,
  o.order_status::text as order_status,
  o.source_reported_status,
  o.occurred_at,
  s.id as supplier_id,
  s.public_id as supplier_public_id,
  c.id as classification_id,
  c.public_id as classification_public_id,
  c.classification_option_id,
  co.key as classification_key,
  co.label as classification_label,
  c.method as classification_method,
  c.confidence,
  c.rule_id,
  r.public_id as rule_public_id,
  r.logical_key as rule_logical_key,
  c.rule_version,
  c.created_at as classification_created_at,
  case
    when c.id is null then 'unclassified'
    when c.method = 'system_fallback' or co.key = 'unreviewed' then 'needs_review'
    else 'classified'
  end as classification_state,
  lower(concat_ws(' ', li.public_id, o.public_id, o.source_order_reference,
    coalesce(li.source_detail->>'product_name', li.source_detail->>'full_title', li.description, sr.raw_payload->>'product_name', sr.parser_output->>'product_name'),
    app.acquisition_delivered_item_title(coalesce(li.source_detail->>'product_name', li.source_detail->>'full_title', li.description, sr.raw_payload->>'product_name', sr.parser_output->>'product_name')),
    sa.normalized_handle,
    coalesce(li.source_detail->>'business_vertical', sr.raw_payload->>'business_vertical', sr.parser_output->>'business_vertical'),
    co.key, co.label, li.reference_number)) as search_text
from public.acquisition_line_items li
join public.acquisition_import_jobs j on j.id = li.acquisition_import_job_id and j.workspace_id = li.workspace_id and j.status = 'committed'
join public.source_records sr on sr.id = li.source_record_id and sr.workspace_id = li.workspace_id
join public.source_systems ss on ss.id = li.source_system_id and ss.workspace_id = li.workspace_id
left join public.acquisition_lot_lines ll on ll.line_item_id = li.id and ll.workspace_id = li.workspace_id and ll.state = 'active'
left join public.acquisition_lots lot on lot.id = ll.lot_id and lot.workspace_id = li.workspace_id
left join public.acquisition_orders o on o.id = lot.order_id and o.workspace_id = li.workspace_id
left join public.source_records osr on osr.id = o.first_source_record_id and osr.workspace_id = o.workspace_id
left join public.suppliers s on s.id = o.supplier_id and s.workspace_id = o.workspace_id
left join public.supplier_aliases sa on sa.supplier_id = o.supplier_id
 and sa.workspace_id = o.workspace_id and sa.source_system_id = o.source_system_id
 and sa.raw_handle = coalesce(li.source_detail->>'seller_raw_handle', osr.raw_payload->>'seller', osr.parser_output->>'seller')
left join public.acquisition_line_classifications c on c.acquisition_line_item_id = li.id and c.workspace_id = li.workspace_id and c.superseded_at is null
left join public.acquisition_classification_options co on co.id = c.classification_option_id and co.workspace_id = c.workspace_id
left join public.classification_rules r on r.id = c.rule_id and r.workspace_id = c.workspace_id;

revoke all on public.acquisition_line_overview from public, anon;
grant select on public.acquisition_line_overview to authenticated;

create function public.list_acquisition_lines(
  p_workspace_id uuid, p_query text default null, p_classification_key text default null,
  p_seller_normalized text default null, p_business_vertical text default null,
  p_method text default null, p_classification_state text default null,
  p_sort text default 'occurred_at', p_order text default 'desc',
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_query text := nullif(btrim(p_query), ''); v_total bigint; v_rows jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=auth.uid()) then
    raise exception 'unauthorized_workspace' using errcode='42501';
  end if;
  if v_query is not null and char_length(v_query) > 200 then raise exception 'invalid_query' using errcode='22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0 then raise exception 'invalid_query' using errcode='22023'; end if;
  if p_sort is null or p_sort not in ('occurred_at','created_at','seller','title','quantity','classification') or p_order is null or p_order not in ('asc','desc') then raise exception 'invalid_sort' using errcode='22023'; end if;
  if p_classification_state is not null and p_classification_state not in ('classified','needs_review','unclassified') then raise exception 'invalid_filter' using errcode='22023'; end if;
  if p_method is not null and p_method not in ('rule','owner_override','seller_specialization','explicit_evidence','system_fallback') then raise exception 'invalid_filter' using errcode='22023'; end if;
  if p_classification_key is not null and p_classification_key <> 'unclassified' and not exists (select 1 from public.acquisition_classification_options o where o.workspace_id=p_workspace_id and o.key=p_classification_key and o.active) then raise exception 'invalid_filter' using errcode='22023'; end if;

  with filtered as (
    select * from public.acquisition_line_overview v where v.workspace_id=p_workspace_id
      and (v_query is null or v.search_text like '%'||lower(v_query)||'%')
      and (p_classification_key is null or (p_classification_key='unclassified' and v.classification_id is null) or v.classification_key=p_classification_key)
      and (p_seller_normalized is null or v.seller_normalized=p_seller_normalized)
      and (p_business_vertical is null or v.business_vertical=p_business_vertical)
      and (p_method is null or v.classification_method=p_method)
      and (p_classification_state is null or v.classification_state=p_classification_state)
  ) select count(*) into v_total from filtered;

  with filtered as (
    select * from public.acquisition_line_overview v where v.workspace_id=p_workspace_id
      and (v_query is null or v.search_text like '%'||lower(v_query)||'%')
      and (p_classification_key is null or (p_classification_key='unclassified' and v.classification_id is null) or v.classification_key=p_classification_key)
      and (p_seller_normalized is null or v.seller_normalized=p_seller_normalized)
      and (p_business_vertical is null or v.business_vertical=p_business_vertical)
      and (p_method is null or v.classification_method=p_method)
      and (p_classification_state is null or v.classification_state=p_classification_state)
  ), sorted as (
    select * from filtered order by
      case when p_sort='occurred_at' and p_order='asc' then occurred_at end asc nulls last,
      case when p_sort='occurred_at' and p_order='desc' then occurred_at end desc nulls last,
      case when p_sort='created_at' and p_order='asc' then created_at end asc nulls last,
      case when p_sort='created_at' and p_order='desc' then created_at end desc nulls last,
      case when p_sort='seller' and p_order='asc' then lower(seller_normalized) end asc nulls last,
      case when p_sort='seller' and p_order='desc' then lower(seller_normalized) end desc nulls last,
      case when p_sort='title' and p_order='asc' then lower(full_title) end asc nulls last,
      case when p_sort='title' and p_order='desc' then lower(full_title) end desc nulls last,
      case when p_sort='quantity' and p_order='asc' then quantity end asc nulls last,
      case when p_sort='quantity' and p_order='desc' then quantity end desc nulls last,
      case when p_sort='classification' and p_order='asc' then lower(classification_label) end asc nulls last,
      case when p_sort='classification' and p_order='desc' then lower(classification_label) end desc nulls last,
      case when p_order='asc' then acquisition_line_public_id end asc,
      case when p_order='desc' then acquisition_line_public_id end desc
    limit p_limit offset p_offset
  ) select coalesce(jsonb_agg(to_jsonb(sorted)), '[]'::jsonb) into v_rows from sorted;
  return jsonb_build_object('total',v_total,'limit',p_limit,'offset',p_offset,'rows',v_rows);
end $$;

create function public.get_acquisition_facets(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=auth.uid()) then raise exception 'unauthorized_workspace' using errcode='42501'; end if;
  with lines as (select * from public.acquisition_line_overview where workspace_id=p_workspace_id)
  select jsonb_build_object(
    'classificationOptions',(select coalesce(jsonb_agg(jsonb_build_object('key',o.key,'label',o.label,'count',(select count(*) from lines l where l.classification_key=o.key)) order by o.display_order,o.key),'[]') from public.acquisition_classification_options o where o.workspace_id=p_workspace_id and o.active),
    'unclassified',(select count(*) from lines where classification_id is null),
    'methods',(select coalesce(jsonb_agg(jsonb_build_object('value',x.value,'count',x.n) order by x.value),'[]') from (select classification_method value,count(*) n from lines where classification_method is not null group by classification_method) x),
    'states',(select coalesce(jsonb_agg(jsonb_build_object('value',x.value,'count',x.n) order by x.value),'[]') from (select classification_state value,count(*) n from lines group by classification_state) x),
    'sellers',(select coalesce(jsonb_agg(jsonb_build_object('value',x.value,'count',x.n) order by x.value),'[]') from (select seller_normalized value,count(*) n from lines where seller_normalized is not null group by seller_normalized) x),
    'businessVerticals',(select coalesce(jsonb_agg(jsonb_build_object('value',x.value,'count',x.n) order by x.value),'[]') from (select business_vertical value,count(*) n from lines where business_vertical is not null group by business_vertical) x)
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.list_acquisition_lines(uuid,text,text,text,text,text,text,text,text,integer,integer) from public, anon;
revoke all on function public.get_acquisition_facets(uuid) from public, anon;
grant execute on function public.list_acquisition_lines(uuid,text,text,text,text,text,text,text,text,integer,integer) to authenticated;
grant execute on function public.get_acquisition_facets(uuid) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260806000100_acquisition_line_read_surface');
