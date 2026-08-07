-- S1.5 corrective migration: restore truthful pagination, ordering, and filter
-- validation to public.list_acquisition_lines.
--
-- Forward-only and additive. Migration
-- 20260806000700_acquisition_line_exclusions is merged history and is NOT
-- edited here; this migration replaces the function body it installed.
--
-- 00700 needed a twelfth parameter for the exclusion filter, and PostgreSQL
-- cannot add a parameter in place, so it dropped the eleven-argument function
-- and rewrote the body from scratch. The rewrite condensed the S1.3
-- implementation and lost four behaviours in the process. All four are
-- observable through the public RPC, and supabase/tests/63 now asserts each
-- one:
--
-- 1. TOTAL COUNTED THE PAGE, NOT THE RESULT SET.
--
--       select count(*), jsonb_agg(...) into total, rows
--       from (select * from f limit p_limit offset p_offset) x
--
--    Both aggregates read the ALREADY-PAGED subquery, so `total` came back as
--    the number of rows on the current page. With the client's page size of 50
--    every result set of 50 or more reported exactly "50 filtered lines", and
--    the header on /acquisitions was simply wrong. It also makes the page
--    count uncomputable, so page 2 is unreachable from the UI.
--
-- 2. LIMIT/OFFSET WERE APPLIED TO AN UNORDERED RELATION.
--
--    `select * from f limit ... offset ...` has no ORDER BY, so which rows land
--    on which page is undefined. Two pages of one result set could repeat a row
--    and silently drop another. Ordering was applied afterwards, inside
--    jsonb_agg, which only sorts the rows that already survived the cut.
--
-- 3. p_sort WAS VALIDATED AND THEN IGNORED. The ordering was always by
--    acquisition_line_public_id, so every sort the UI offers — occurred_at,
--    created_at, seller, title, quantity, classification — returned identical
--    ordering. Only p_order had any effect.
--
-- 4. CLOSED FILTER VOCABULARIES STOPPED FAILING CLOSED. S1.3 rejected an
--    unknown classification method, classification state, or classification
--    key with invalid_filter, and an over-length search with invalid_query.
--    00700 dropped those checks, so an unsupported filter silently matched
--    nothing and returned an empty page — which an operator reads as "there
--    are none", the most dangerous possible answer for an inventory filter.
--
-- The body below restores the S1.3 semantics verbatim and adds the exclusion
-- filter to them: total is counted over the full filtered set, ordering is
-- applied before LIMIT/OFFSET with a stable tie-break on the immutable line
-- public ID so pages partition the result set, and every closed vocabulary
-- fails closed again. The eleven-argument compatibility wrapper delegates here
-- and inherits all of it.
create or replace function public.list_acquisition_lines(
  p_workspace_id uuid, p_query text, p_classification_key text,
  p_seller_normalized text, p_business_vertical text, p_method text,
  p_classification_state text, p_sort text, p_order text,
  p_limit integer, p_offset integer, p_exclusion_state text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_query text := nullif(btrim(p_query), ''); v_total bigint; v_rows jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=auth.uid()) then
    raise exception 'unauthorized_workspace' using errcode='42501';
  end if;
  if v_query is not null and char_length(v_query) > 200 then raise exception 'invalid_query' using errcode='22023'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0 then raise exception 'invalid_query' using errcode='22023'; end if;
  if p_sort is null or p_sort not in ('occurred_at','created_at','seller','title','quantity','classification') or p_order is null or p_order not in ('asc','desc') then raise exception 'invalid_query' using errcode='22023'; end if;
  if p_classification_state is not null and p_classification_state not in ('classified','needs_review','unclassified') then raise exception 'invalid_filter' using errcode='22023'; end if;
  if p_method is not null and p_method not in ('rule','owner_override','seller_specialization','explicit_evidence','system_fallback') then raise exception 'invalid_filter' using errcode='22023'; end if;
  if p_exclusion_state is not null and p_exclusion_state not in ('included','excluded') then raise exception 'invalid_filter' using errcode='22023'; end if;
  if p_classification_key is not null and p_classification_key <> 'unclassified' and not exists (select 1 from public.acquisition_classification_options o where o.workspace_id=p_workspace_id and o.key=p_classification_key and o.active) then raise exception 'invalid_filter' using errcode='22023'; end if;

  -- Counted over the FULL filtered set, before any paging is applied.
  with filtered as (
    select * from public.acquisition_line_overview v where v.workspace_id=p_workspace_id
      and (v_query is null or v.search_text like '%'||lower(v_query)||'%')
      and (p_classification_key is null or (p_classification_key='unclassified' and v.classification_id is null) or v.classification_key=p_classification_key)
      and (p_seller_normalized is null or v.seller_normalized=p_seller_normalized)
      and (p_business_vertical is null or v.business_vertical=p_business_vertical)
      and (p_method is null or v.classification_method=p_method)
      and (p_classification_state is null or v.classification_state=p_classification_state)
      and (p_exclusion_state is null or v.exclusion_state=p_exclusion_state)
  ) select count(*) into v_total from filtered;

  -- Ordered BEFORE the cut, with an immutable tie-break, so successive pages
  -- partition the result set instead of overlapping it.
  with filtered as (
    select * from public.acquisition_line_overview v where v.workspace_id=p_workspace_id
      and (v_query is null or v.search_text like '%'||lower(v_query)||'%')
      and (p_classification_key is null or (p_classification_key='unclassified' and v.classification_id is null) or v.classification_key=p_classification_key)
      and (p_seller_normalized is null or v.seller_normalized=p_seller_normalized)
      and (p_business_vertical is null or v.business_vertical=p_business_vertical)
      and (p_method is null or v.classification_method=p_method)
      and (p_classification_state is null or v.classification_state=p_classification_state)
      and (p_exclusion_state is null or v.exclusion_state=p_exclusion_state)
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

insert into public.schema_migrations_log (migration_name)
values ('20260806000800_acquisition_list_pagination_repair')
on conflict (migration_name) do nothing;
