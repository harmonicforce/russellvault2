-- S1.5 governed acquisition-line exclusion decisions.
create type public.acquisition_line_exclusion_state as enum ('excluded','included');

alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'source_system_registered','import_previewed','import_started','import_records_staged','import_committed','import_failed','source_record_ingested','crosswalk_candidate_created','crosswalk_confirmed','crosswalk_rejected','crosswalk_superseded','issue_opened','issue_acknowledged','issue_resolved','issue_wont_fix','channel_registered','supplier_registered','supplier_alias_created','acquisition_import_started','acquisition_import_staged','acquisition_import_committed','acquisition_import_failed','lot_line_superseded','cost_component_reversed','cost_allocation_proposed','cost_allocation_confirmed','cost_allocation_reversed','acquisition_line_classified','acquisition_line_classification_superseded','acquisition_line_classification_overridden','classification_rule_created','classification_rule_superseded','acquisition_payment_recorded','acquisition_payment_reversed','acquisition_shipment_created','acquisition_shipment_transitioned','acquisition_line_excluded','acquisition_line_restored'
));

create table public.acquisition_line_exclusions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 public_id text not null default app.mint_governed_public_id('RV-AEXCL') check(public_id ~ '^RV-AEXCL-[A-Z0-9]{12}$'),
 acquisition_line_item_id uuid not null,
 decision_state public.acquisition_line_exclusion_state not null,
 reason text not null check(reason=btrim(reason) and char_length(reason) between 1 and 500),
 idempotency_key text not null check(idempotency_key=btrim(idempotency_key) and char_length(idempotency_key) between 8 and 200),
 payload_fingerprint text not null check(char_length(payload_fingerprint)=64),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 superseded_at timestamptz, superseded_by_exclusion_id uuid, supersedes_exclusion_id uuid,
 unique(id,workspace_id), unique(workspace_id,public_id), unique(workspace_id,idempotency_key),
 foreign key(acquisition_line_item_id,workspace_id) references public.acquisition_line_items(id,workspace_id) on delete restrict,
 foreign key(superseded_by_exclusion_id,workspace_id) references public.acquisition_line_exclusions(id,workspace_id) on delete restrict deferrable initially deferred,
 foreign key(supersedes_exclusion_id,workspace_id) references public.acquisition_line_exclusions(id,workspace_id) on delete restrict,
 check ((superseded_at is null)=(superseded_by_exclusion_id is null)),
 check (superseded_by_exclusion_id is null or superseded_by_exclusion_id<>id),
 check (supersedes_exclusion_id is null or supersedes_exclusion_id<>id)
);
create unique index acquisition_line_exclusions_current_uidx on public.acquisition_line_exclusions(workspace_id,acquisition_line_item_id) where superseded_at is null;
create index acquisition_line_exclusions_history_idx on public.acquisition_line_exclusions(workspace_id,acquisition_line_item_id,created_at,id);

create function app.guard_acquisition_line_exclusion_history() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception 'append_only_violation' using errcode='55000'; end if;
 if current_setting('app.governed_acquisition_exclusion_mutation',true)<>'on'
 or new.id<>old.id or new.workspace_id<>old.workspace_id or new.public_id<>old.public_id
 or new.acquisition_line_item_id<>old.acquisition_line_item_id or new.decision_state<>old.decision_state
 or new.reason<>old.reason or new.idempotency_key<>old.idempotency_key or new.payload_fingerprint<>old.payload_fingerprint
 or new.created_by<>old.created_by or new.created_at<>old.created_at or old.superseded_at is not null
 or new.superseded_at is null or new.superseded_by_exclusion_id is null or new.supersedes_exclusion_id is distinct from old.supersedes_exclusion_id
 then raise exception 'append_only_violation' using errcode='55000'; end if; return new; end $$;
create trigger acquisition_line_exclusions_append_only before update or delete on public.acquisition_line_exclusions for each row execute function app.guard_acquisition_line_exclusion_history();
create trigger acquisition_line_exclusions_no_truncate before truncate on public.acquisition_line_exclusions execute function app.forbid_update_delete();

alter table public.acquisition_line_exclusions enable row level security;
create policy acquisition_line_exclusions_select on public.acquisition_line_exclusions for select to authenticated using (app.member_role(workspace_id) is not null);
revoke all on public.acquisition_line_exclusions from public,anon,authenticated;
grant select on public.acquisition_line_exclusions to authenticated;

create function app.assert_acquisition_line_eligible_for_downstream(p_workspace_id uuid,p_acquisition_line_item_id uuid) returns void language plpgsql stable security definer set search_path='' as $$ begin
 if not exists(select 1 from public.acquisition_line_items l where l.id=p_acquisition_line_item_id and l.workspace_id=p_workspace_id) then raise exception 'acquisition_not_found' using errcode='P0002'; end if;
 if exists(select 1 from public.acquisition_line_exclusions e where e.workspace_id=p_workspace_id and e.acquisition_line_item_id=p_acquisition_line_item_id and e.superseded_at is null and e.decision_state='excluded') then raise exception 'acquisition_line_excluded' using errcode='23514'; end if;
end $$;
revoke all on function app.assert_acquisition_line_eligible_for_downstream(uuid,uuid) from public,anon,authenticated;

create function app.decide_acquisition_line_exclusion(p_workspace_id uuid,p_source_system_public_id text,p_acquisition_line_public_id text,p_reason text,p_idempotency_key text,p_state public.acquisition_line_exclusion_state)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; new_id uuid:=gen_random_uuid(); reason text:=btrim(coalesce(p_reason,'')); key text:=btrim(coalesce(p_idempotency_key,'')); line_id uuid; n integer; old public.acquisition_line_exclusions%rowtype; fresh public.acquisition_line_exclusions%rowtype; fp text; prior text;
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner']::public.workspace_role[]);
 if char_length(reason) not between 1 and 500 or char_length(key) not between 8 and 200 or p_source_system_public_id is null or p_acquisition_line_public_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_object('workspace_id',p_workspace_id,'source_system_public_id',p_source_system_public_id,'acquisition_line_public_id',p_acquisition_line_public_id,'operation',p_state::text,'reason',reason)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':exclusion-key:'||key,0));
 select * into fresh from public.acquisition_line_exclusions where workspace_id=p_workspace_id and idempotency_key=key;
 if fresh.id is not null then if fresh.payload_fingerprint<>fp then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('decisionPublicId',fresh.public_id,'state',fresh.decision_state,'replayed',true); end if;
 select count(distinct v.acquisition_line_item_id),(array_agg(distinct v.acquisition_line_item_id))[1] into n,line_id from public.acquisition_line_overview v where v.workspace_id=p_workspace_id and v.source_system_public_id=p_source_system_public_id and v.acquisition_line_public_id=p_acquisition_line_public_id;
 if n=0 then raise exception 'acquisition_not_found' using errcode='P0002'; elsif n>1 then raise exception 'acquisition_integrity_error' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':exclusion-line:'||line_id::text,0));
 select * into old from public.acquisition_line_exclusions where workspace_id=p_workspace_id and acquisition_line_item_id=line_id and superseded_at is null for update;
 prior:=coalesce(old.decision_state::text,'included');
 if p_state='excluded' and prior='excluded' then raise exception 'already_excluded' using errcode='23505'; end if;
 if p_state='included' and prior='included' then raise exception 'not_excluded' using errcode='23505'; end if;
 if old.id is not null then
   perform set_config('app.governed_acquisition_exclusion_mutation','on',true);
   update public.acquisition_line_exclusions set superseded_at=clock_timestamp(),superseded_by_exclusion_id=new_id where id=old.id;
 end if;
 insert into public.acquisition_line_exclusions(id,workspace_id,acquisition_line_item_id,decision_state,reason,idempotency_key,payload_fingerprint,created_by,supersedes_exclusion_id) values(new_id,p_workspace_id,line_id,p_state,reason,key,fp,u,old.id) returning * into fresh;
 perform app.log_audit_event(p_workspace_id,case when p_state='excluded' then 'acquisition_line_excluded' else 'acquisition_line_restored' end,'acquisition_line_exclusions',fresh.id,u,'acquisition.exclusion',null,null,null,jsonb_build_object('decision_public_id',fresh.public_id,'source_system_public_id',p_source_system_public_id,'acquisition_line_public_id',p_acquisition_line_public_id,'reason',reason,'prior_state',prior,'new_state',p_state,'actor_id',u));
 return jsonb_build_object('decisionPublicId',fresh.public_id,'state',fresh.decision_state,'replayed',false);
end $$;
create function public.exclude_acquisition_line_by_source(p_workspace_id uuid,p_source_system_public_id text,p_acquisition_line_public_id text,p_reason text,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app.decide_acquisition_line_exclusion($1,$2,$3,$4,$5,'excluded') $$;
create function public.restore_acquisition_line_by_source(p_workspace_id uuid,p_source_system_public_id text,p_acquisition_line_public_id text,p_reason text,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$ select app.decide_acquisition_line_exclusion($1,$2,$3,$4,$5,'included') $$;
revoke all on function app.decide_acquisition_line_exclusion(uuid,text,text,text,text,public.acquisition_line_exclusion_state), public.exclude_acquisition_line_by_source(uuid,text,text,text,text), public.restore_acquisition_line_by_source(uuid,text,text,text,text) from public,anon;
revoke all on function app.decide_acquisition_line_exclusion(uuid,text,text,text,text,public.acquisition_line_exclusion_state) from authenticated;
grant execute on function public.exclude_acquisition_line_by_source(uuid,text,text,text,text), public.restore_acquisition_line_by_source(uuid,text,text,text,text) to authenticated;
create or replace view public.acquisition_line_overview
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
    co.key, co.label, li.reference_number)) as search_text,
  case when ex.decision_state='excluded' then 'excluded' else 'included' end as exclusion_state,
  case when ex.decision_state='excluded' then ex.public_id end as current_exclusion_public_id,
  case when ex.decision_state='excluded' then ex.reason end as current_exclusion_reason,
  case when ex.decision_state='excluded' then ex.created_at end as excluded_at,
  case when ex.decision_state='excluded' then ex.created_by end as exclusion_actor_id
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
left join public.classification_rules r on r.id = c.rule_id and r.workspace_id = c.workspace_id
left join public.acquisition_line_exclusions ex on ex.workspace_id=li.workspace_id and ex.acquisition_line_item_id=li.id and ex.superseded_at is null;

drop function public.list_acquisition_lines(uuid,text,text,text,text,text,text,text,text,integer,integer);
create function public.list_acquisition_lines(p_workspace_id uuid,p_query text,p_classification_key text,p_seller_normalized text,p_business_vertical text,p_method text,p_classification_state text,p_sort text,p_order text,p_limit integer,p_offset integer,p_exclusion_state text)
returns jsonb language plpgsql stable security definer set search_path='' as $$ declare q text:=nullif(btrim(p_query),''); total bigint; rows jsonb; begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=auth.uid()) then raise exception 'unauthorized_workspace' using errcode='42501'; end if;
 if p_exclusion_state is not null and p_exclusion_state not in ('included','excluded') then raise exception 'invalid_filter' using errcode='22023'; end if;
 if p_limit is null or p_limit<1 or p_limit>200 or p_offset is null or p_offset<0 or p_sort not in ('occurred_at','created_at','seller','title','quantity','classification') or p_order not in ('asc','desc') then raise exception 'invalid_query' using errcode='22023'; end if;
 with f as (select * from public.acquisition_line_overview v where v.workspace_id=p_workspace_id and (q is null or v.search_text like '%'||lower(q)||'%') and (p_classification_key is null or (p_classification_key='unclassified' and v.classification_id is null) or v.classification_key=p_classification_key) and (p_seller_normalized is null or v.seller_normalized=p_seller_normalized) and (p_business_vertical is null or v.business_vertical=p_business_vertical) and (p_method is null or v.classification_method=p_method) and (p_classification_state is null or v.classification_state=p_classification_state) and (p_exclusion_state is null or v.exclusion_state=p_exclusion_state)) select count(*),coalesce(jsonb_agg(to_jsonb(x) order by case when p_order='asc' then x.acquisition_line_public_id end asc,case when p_order='desc' then x.acquisition_line_public_id end desc),'[]') into total,rows from (select * from f limit p_limit offset p_offset)x;
 return jsonb_build_object('total',total,'limit',p_limit,'offset',p_offset,'rows',rows); end $$;
revoke all on function public.list_acquisition_lines(uuid,text,text,text,text,text,text,text,text,integer,integer,text) from public,anon;
grant execute on function public.list_acquisition_lines(uuid,text,text,text,text,text,text,text,text,integer,integer,text) to authenticated;

create or replace function public.get_acquisition_facets(p_workspace_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare r jsonb; begin if auth.uid() is null or not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=auth.uid()) then raise exception 'unauthorized_workspace' using errcode='42501'; end if; with lines as(select * from public.acquisition_line_overview where workspace_id=p_workspace_id) select jsonb_build_object('classificationOptions',(select coalesce(jsonb_agg(jsonb_build_object('key',o.key,'label',o.label,'count',(select count(*) from lines l where l.classification_key=o.key)) order by o.display_order,o.key),'[]') from public.acquisition_classification_options o where o.workspace_id=p_workspace_id and o.active),'unclassified',(select count(*) from lines where classification_id is null),'methods',(select coalesce(jsonb_agg(jsonb_build_object('value',x.v,'count',x.n)),'[]') from(select classification_method v,count(*)n from lines where classification_method is not null group by 1)x),'states',(select coalesce(jsonb_agg(jsonb_build_object('value',x.v,'count',x.n)),'[]') from(select classification_state v,count(*)n from lines group by 1)x),'exclusionStates',(select coalesce(jsonb_agg(jsonb_build_object('value',x.v,'count',x.n) order by x.v),'[]') from(select exclusion_state v,count(*)n from lines group by 1)x),'sellers',(select coalesce(jsonb_agg(jsonb_build_object('value',x.v,'count',x.n)),'[]') from(select seller_normalized v,count(*)n from lines where seller_normalized is not null group by 1)x),'businessVerticals',(select coalesce(jsonb_agg(jsonb_build_object('value',x.v,'count',x.n)),'[]') from(select business_vertical v,count(*)n from lines where business_vertical is not null group by 1)x)) into r; return r; end $$;
create or replace function public.get_acquisition_line_detail_by_source(p_workspace_id uuid, p_source_system_public_id text, p_acquisition_line_public_id text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v public.acquisition_line_overview%rowtype; result jsonb; placement_rows integer;
begin
 if auth.uid() is null or not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=auth.uid()) then raise exception 'unauthorized_workspace' using errcode='42501'; end if;

 -- Root-row cardinality over ROWS, never distinct line ids, and proven in the
 -- SAME statement that fetches the row. Counting first and selecting second
 -- would take two READ COMMITTED snapshots, so a placement written between
 -- them would let a non-strict SELECT INTO fall back to an arbitrary row --
 -- the very failure this replaces. INTO STRICT cannot do that.
 begin
  select * into strict v from public.acquisition_line_overview
   where workspace_id=p_workspace_id and source_system_public_id=p_source_system_public_id and acquisition_line_public_id=p_acquisition_line_public_id;
 exception
  -- Zero matches and a foreign workspace are indistinguishable to the caller.
  when no_data_found then return null;
  when too_many_rows then raise exception 'acquisition_integrity_error' using errcode='23514';
 end;

 -- Named, direct proof of the placement contract, independent of the view.
 select count(*) into placement_rows from public.acquisition_lot_lines
  where workspace_id=p_workspace_id and line_item_id=v.acquisition_line_item_id and state='active';
 if placement_rows>1 then raise exception 'acquisition_integrity_error' using errcode='23514'; end if;

 begin
  select jsonb_build_object(
   'coverage','governed_native_committed','historicalLegacyImported',false,
   'identity',jsonb_build_object('sourceSystemPublicId',v.source_system_public_id,'linePublicId',v.acquisition_line_public_id),
   'line',jsonb_build_object('publicId',v.acquisition_line_public_id,'quantity',v.quantity,'description',v.description,'referenceNumber',v.reference_number,'sourceDetail',v.source_detail,'createdAt',v.created_at,'businessVertical',v.business_vertical,'fullTitle',v.full_title,'deliveredItemTitle',v.delivered_item_title,'sellerNormalized',v.seller_normalized),
   'order',jsonb_build_object('publicId',v.acquisition_order_public_id,'sourceOrderReference',v.source_order_reference,'status',v.order_status,'sourceReportedStatus',v.source_reported_status,'sourceReportedTotalMinor',o.source_reported_total_minor,'currency',o.currency,'occurredAt',v.occurred_at,
     'channel',jsonb_build_object('publicId',ch.public_id,'name',ch.name),
     'supplier',jsonb_build_object('publicId',s.public_id,'displayName',s.display_name),
     'sourceSystem',jsonb_build_object('publicId',v.source_system_public_id,'kind',v.source_system_kind)),
   'placement',jsonb_build_object('lotPublicId',lot.public_id,'sequence',lot.sequence_no,'label',lot.label,'integrityState',case when lot.id is null then 'missing_active_placement' else 'current' end),
   'classification',case when c.id is null then null else jsonb_build_object('publicId',c.public_id,'optionKey',co.key,'optionLabel',co.label,'method',c.method,'confidence',c.confidence,'createdAt',c.created_at,'state',v.classification_state,'rulePublicId',r.public_id,'ruleLogicalKey',r.logical_key,'ruleVersion',c.rule_version) end,
   'classificationHistory',(select coalesce(jsonb_agg(jsonb_build_object('publicId',h.public_id,'optionKey',ho.key,'optionLabel',ho.label,'method',h.method,'confidence',h.confidence,'createdAt',h.created_at,'supersededAt',h.superseded_at,'ownerOverrideReason',h.evidence->>'owner_reason') order by h.created_at,h.id),'[]') from public.acquisition_line_classifications h join public.acquisition_classification_options ho on ho.id=h.classification_option_id and ho.workspace_id=h.workspace_id where h.workspace_id=p_workspace_id and h.acquisition_line_item_id=v.acquisition_line_item_id),
   'classificationOptions',(select coalesce(jsonb_agg(jsonb_build_object('key',x.key,'label',x.label) order by x.display_order,x.key),'[]') from public.acquisition_classification_options x where x.workspace_id=p_workspace_id and x.active),
   'payments',(select coalesce(jsonb_agg(jsonb_build_object('publicId',p.public_id,'paidAt',p.paid_at,'amountMinor',p.amount_minor,'currency',p.currency,'instrument',p.instrument,'externalReference',p.external_reference,'evidenceNote',p.evidence_note,'state',case when p.reversed_at is null then 'active' else 'reversed' end,'reversedAt',p.reversed_at,'reversalReason',p.reversal_reason,'reversalEvent',case when pr.id is null then null else jsonb_build_object('publicId',pr.public_id,'actorId',pr.reversed_by,'reversedAt',pr.reversed_at,'reason',pr.reason) end) order by p.paid_at,p.created_at),'[]') from public.acquisition_payments p left join public.acquisition_payment_reversals pr on pr.id=p.reversal_event_id and pr.workspace_id=p.workspace_id where p.workspace_id=p_workspace_id and p.acquisition_order_id=v.acquisition_order_id),
   'paymentSummary',(select jsonb_build_object('activeCount',count(*) filter(where p.reversed_at is null),'activeCurrencies',coalesce(jsonb_agg(distinct p.currency) filter(where p.reversed_at is null),'[]'),'mixedCurrencies',count(distinct p.currency) filter(where p.reversed_at is null)>1,'activeTotalMinor',case when count(distinct p.currency) filter(where p.reversed_at is null)=1 then sum(p.amount_minor) filter(where p.reversed_at is null) end,'sourceReportedTotalMinor',o.source_reported_total_minor,'differenceMinor',case when count(distinct p.currency) filter(where p.reversed_at is null)=1 and min(p.currency) filter(where p.reversed_at is null)=o.currency then o.source_reported_total_minor-sum(p.amount_minor) filter(where p.reversed_at is null) end) from public.acquisition_payments p where p.workspace_id=p_workspace_id and p.acquisition_order_id=v.acquisition_order_id),
   'shipments',(select coalesce(jsonb_agg(jsonb_build_object('publicId',sh.public_id,'carrier',sh.carrier,'trackingNumber',sh.tracking_number,'status',sh.status,'shippedAt',sh.shipped_at,'expectedAt',sh.expected_at,'receivedAt',sh.received_at,'shippingReferenceMinor',sh.shipping_cost_minor,'currency',sh.currency,'evidenceNote',sh.evidence_note,'transitionHistory',(select coalesce(jsonb_agg(jsonb_build_object('publicId',t.public_id,'fromStatus',t.from_status,'toStatus',t.to_status,'applied',t.applied,'receivedAt',t.received_at,'reason',t.reason,'actorId',t.transitioned_by,'createdAt',t.created_at) order by t.created_at,t.id),'[]') from public.acquisition_shipment_transitions t where t.workspace_id=sh.workspace_id and t.acquisition_shipment_id=sh.id),'allowedNextTransitions',case sh.status when 'expected' then '["in_transit","delivered","lost","cancelled"]'::jsonb when 'in_transit' then '["delivered","lost","cancelled"]'::jsonb when 'lost' then '["in_transit","delivered","cancelled"]'::jsonb else '[]'::jsonb end) order by sh.created_at),'[]') from public.acquisition_shipments sh where sh.workspace_id=p_workspace_id and sh.acquisition_order_id=v.acquisition_order_id),
   'exclusion',jsonb_build_object('state',v.exclusion_state,'current',case when ex.id is null then null else jsonb_build_object('publicId',ex.public_id,'state',ex.decision_state,'reason',ex.reason,'actorId',ex.created_by,'createdAt',ex.created_at,'supersededAt',ex.superseded_at) end,'history',(select coalesce(jsonb_agg(jsonb_build_object('publicId',h.public_id,'state',h.decision_state,'reason',h.reason,'actorId',h.created_by,'createdAt',h.created_at,'supersededAt',h.superseded_at) order by h.created_at,h.id),'[]') from public.acquisition_line_exclusions h where h.workspace_id=p_workspace_id and h.acquisition_line_item_id=v.acquisition_line_item_id)),
   'sourceEvidence',jsonb_build_object(
     'sourceSystemPublicId',v.source_system_public_id,
     -- A raw source row key. Never presented as a governed RV public identity.
     'sourceRecordRowKey',(select sr.source_row_key from public.source_records sr where sr.id=v.source_record_id and sr.workspace_id=p_workspace_id),
     -- public.import_jobs.public_id: the SOURCE import job behind this
     -- acquisition import. acquisition_import_jobs has no governed public ID.
     'sourceImportJobPublicId',(select ij.public_id from public.import_jobs ij where ij.id=v.source_import_job_id and ij.workspace_id=p_workspace_id))
  ) into strict result
  -- One literal root row; every join below is a LEFT JOIN onto a unique key,
  -- so exactly one row is produced without an arbitrary LIMIT.
  from (select 1) as root(one)
  left join public.acquisition_orders o on o.id=v.acquisition_order_id and o.workspace_id=p_workspace_id
  left join public.channels ch on ch.id=o.channel_id and ch.workspace_id=o.workspace_id
  left join public.suppliers s on s.id=o.supplier_id and s.workspace_id=o.workspace_id
  left join public.acquisition_lot_lines ll on ll.line_item_id=v.acquisition_line_item_id and ll.workspace_id=p_workspace_id and ll.state='active'
  left join public.acquisition_lots lot on lot.id=ll.lot_id and lot.workspace_id=ll.workspace_id
  left join public.acquisition_line_classifications c on c.id=v.classification_id and c.workspace_id=p_workspace_id
  left join public.acquisition_classification_options co on co.id=c.classification_option_id and co.workspace_id=p_workspace_id
  left join public.classification_rules r on r.id=c.rule_id and r.workspace_id=p_workspace_id 
  left join public.acquisition_line_exclusions ex on ex.acquisition_line_item_id=v.acquisition_line_item_id and ex.workspace_id=p_workspace_id and ex.superseded_at is null;
 exception
  -- The cardinality argument above is enforced, not assumed.
  when too_many_rows or no_data_found then raise exception 'acquisition_integrity_error' using errcode='23514';
 end;

 return result;
end $function$;

-- 4. The S1.4 mutation path could never succeed.
--
--    record_acquisition_payment, reverse_acquisition_payment,
--    create_acquisition_shipment, and transition_acquisition_shipment each
--    compute their idempotency fingerprint with an UNQUALIFIED digest(). All
--    four are SECURITY DEFINER with `SET search_path = ''`, and pgcrypto is not
--    installed in this database at all, so digest() resolves nowhere: every one
--    of those calls raises 42883 undefined_function the moment control reaches
--    the fingerprint assignment.
--
--    That assignment sits AFTER role, validation, and order-resolution checks,
--    so every fail-closed path returned before reaching it and looked healthy,
--    while every success path was dead. This is why S1.4 has no successful
--    payment, reversal, shipment, or transition lifecycle to point at: not an
--    untested feature, an unexecutable one. supabase/tests/61 now drives all
--    four to completion, which is what surfaced it.
--
--    These eight digest() calls are the only ones in the repository; every
--    other hash uses encode(sha256(convert_to(..., 'UTF8')), 'hex'), whose
create function public.list_acquisition_lines(p_workspace_id uuid,p_query text default null,p_classification_key text default null,p_seller_normalized text default null,p_business_vertical text default null,p_method text default null,p_classification_state text default null,p_sort text default 'occurred_at',p_order text default 'desc',p_limit integer default 50,p_offset integer default 0) returns jsonb language sql stable security definer set search_path='' as $$ select public.list_acquisition_lines($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null) $$;
revoke all on function public.list_acquisition_lines(uuid,text,text,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.list_acquisition_lines(uuid,text,text,text,text,text,text,text,text,integer,integer) to authenticated;

insert into public.schema_migrations_log(migration_name) values('20260806000700_acquisition_line_exclusions');
