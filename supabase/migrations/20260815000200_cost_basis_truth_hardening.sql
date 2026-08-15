-- S2.4.1 cost-basis truth hardening and allocation proposal recovery.

alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'source_system_registered','import_previewed','import_started','import_records_staged','import_committed','import_failed','source_record_ingested','crosswalk_candidate_created','crosswalk_confirmed','crosswalk_rejected','crosswalk_superseded','issue_opened','issue_acknowledged','issue_resolved','issue_wont_fix','channel_registered','supplier_registered','supplier_alias_created','acquisition_import_started','acquisition_import_staged','acquisition_import_committed','acquisition_import_failed','lot_line_superseded','cost_component_reversed','cost_allocation_proposed','cost_allocation_confirmed','cost_allocation_reversed','acquisition_line_classified','acquisition_line_classification_superseded','acquisition_line_classification_overridden','classification_rule_created','classification_rule_superseded','acquisition_payment_recorded','acquisition_payment_reversed','acquisition_shipment_created','acquisition_shipment_transitioned','acquisition_line_excluded','acquisition_line_restored','acquisition_receipt_opened','acquisition_receipt_line_recorded','acquisition_receipt_line_corrected','acquisition_receipt_submitted','acquisition_receipt_cancelled','acquisition_receipt_inventory_linked','acquisition_receipt_inventory_unlinked','acquisition_receipt_reconciled','acquisition_discrepancy_raised','acquisition_discrepancy_claimed','acquisition_discrepancy_resolved','acquisition_discrepancy_written_off','cost_allocation_withdrawn'
));

create or replace function app.guard_inventory_cost_basis_rows() returns trigger language plpgsql set search_path='' as $$
begin
 if coalesce(current_setting('app.governed_cost_basis_mutation',true),'') <> 'on' then
   raise exception 'inventory_cost_basis_is_derived' using errcode='55000';
 end if;
 return case when tg_op='DELETE' then old else new end;
end$$;

create or replace function app.enforce_cost_allocation_transition() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state is distinct from old.state then
   if old.state in ('reversed','withdrawn') then raise exception 'cost allocation % is terminal',old.id using errcode='check_violation'; end if;
   if old.state='confirmed' and new.state<>'reversed' then raise exception 'confirmed allocation may only be reversed' using errcode='check_violation'; end if;
   if old.state='candidate' and new.state not in ('confirmed','withdrawn') then raise exception 'invalid candidate allocation transition' using errcode='check_violation'; end if;
   if new.state='candidate' then raise exception 'a reviewed cost allocation cannot return to candidate' using errcode='check_violation'; end if;
 end if;
 if old.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by then raise exception 'cost allocation review attribution is immutable' using errcode='check_violation'; end if;
 return new;
end$$;

create function public.withdraw_cost_allocation(p_cost_component_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_component public.acquisition_cost_components%rowtype; v_count integer;
begin
 if nullif(btrim(p_reason),'') is null then raise exception 'a reason is required to withdraw an allocation proposal' using errcode='22023'; end if;
 v_uid:=app.require_uid();
 select c.* into v_component from public.acquisition_cost_components c join public.workspace_members m on m.workspace_id=c.workspace_id and m.user_id=v_uid and m.role=any(array['owner','operator']::public.workspace_role[]) where c.id=p_cost_component_id for update of c;
 if v_component.id is null then raise exception 'cost component not found or not authorized' using errcode='42501'; end if;
 perform app.require_committed_acquisition_job(v_component.acquisition_import_job_id);
 update public.acquisition_cost_allocations set state='withdrawn' where cost_component_id=p_cost_component_id and state='candidate';
 get diagnostics v_count=row_count;
 if v_count=0 then raise exception 'cost component has no candidate allocations to withdraw' using errcode='check_violation'; end if;
 perform app.log_audit_event(v_component.workspace_id,'cost_allocation_withdrawn','acquisition_cost_components',p_cost_component_id,v_uid,'acquisition.allocation',null,v_component.source_record_id,null,jsonb_build_object('withdrawn_count',v_count,'reason',btrim(p_reason)));
 return jsonb_build_object('withdrawn',v_count);
end$$;
revoke all on function public.withdraw_cost_allocation(uuid,text) from public,anon;
grant execute on function public.withdraw_cost_allocation(uuid,text) to authenticated;

create or replace function public.recompute_inventory_cost_basis(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_hash text; v_recompute uuid:=gen_random_uuid(); v_count integer; v_version constant text:='1.1.0';
begin
 if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
 if app.member_role(p_workspace_id) not in ('owner','operator') then raise exception 'insufficient role for this operation' using errcode='42501'; end if;
 -- One lock covers hash observation, supersession and replacement. Competing
 -- callers therefore cannot publish two current truths.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':inventory-cost-basis',0));

 select encode(sha256(coalesce(jsonb_agg(x.payload order by x.sort_key)::text,'[]')::bytea),'hex') into v_hash
 from (
   select 'R|'||r.id::text sort_key, jsonb_build_array('receipt',r.id,r.status,r.received_at,rl.id,rl.quantity_received,k.id,k.inventory_lot_id,k.inventory_item_id,k.quantity_linked) payload
   from public.acquisition_receipts r join public.acquisition_receipt_lines rl on rl.acquisition_receipt_id=r.id
   join public.acquisition_receipt_line_inventory_links k on k.acquisition_receipt_line_id=rl.id
   where r.workspace_id=p_workspace_id and r.status='reconciled'
   union all
   select 'C|'||c.id::text, jsonb_build_array('cost',c.id,c.line_item_id,c.component_type,c.amount_state,c.amount_minor,c.currency,c.attribution_state,c.reversed_at)
   from public.acquisition_cost_components c where c.workspace_id=p_workspace_id
   union all
   select 'A|'||a.id::text, jsonb_build_array('allocation',a.id,a.cost_component_id,a.line_item_id,a.amount_minor,a.state,a.reversed_at)
   from public.acquisition_cost_allocations a where a.workspace_id=p_workspace_id
   union all
   select 'L|'||ali.id::text, jsonb_build_array('line',ali.id,ali.quantity,ali.source_detail)
   from public.acquisition_line_items ali where ali.workspace_id=p_workspace_id
 ) x;
 v_hash:=coalesce(v_hash,encode(sha256('[]'::bytea),'hex'));
 if exists(select 1 from public.inventory_cost_basis_events where workspace_id=p_workspace_id and inventory_cost_basis_id is null and algorithm_version=v_version and input_content_hash=v_hash) then
   return jsonb_build_object('recomputed',false,'algorithmVersion',v_version,'contentHash',v_hash,
     'basisRows',(select count(*) from public.inventory_cost_basis where workspace_id=p_workspace_id and state in ('current','unresolved')));
 end if;

 drop table if exists pg_temp._icb_unit_contrib, pg_temp._icb_costs, pg_temp._icb_blockers, pg_temp._icb_units;
 create temporary table _icb_units on commit drop as
 with links as (
  select r.received_at,r.id receipt_id,rl.id receipt_line_id,rl.acquisition_line_item_id,k.id link_id,
    k.inventory_lot_id,k.inventory_item_id,k.quantity_linked,
    coalesce(sum(k.quantity_linked) over(partition by rl.acquisition_line_item_id order by r.received_at,r.id,
      coalesce(i.public_id,l.public_id),k.id rows between unbounded preceding and 1 preceding),0) prior_units
  from public.acquisition_receipts r join public.acquisition_receipt_lines rl on rl.acquisition_receipt_id=r.id
  join public.acquisition_receipt_line_inventory_links k on k.acquisition_receipt_line_id=rl.id
  left join public.inventory_items i on i.id=k.inventory_item_id
  left join public.inventory_lots l on l.id=k.inventory_lot_id
  where r.workspace_id=p_workspace_id and r.status='reconciled'
 ), expanded as (
  select x.*,g unit_in_link,
    prior_units + g source_ord
  from links x cross join lateral generate_series(1,x.quantity_linked) g
 )
 select e.*,ali.quantity expected_quantity from expanded e join public.acquisition_line_items ali on ali.id=e.acquisition_line_item_id;

 create temporary table _icb_costs on commit drop as
 select c.id component_id, null::uuid allocation_id,c.line_item_id,c.component_type,c.currency,c.amount_minor,
   (c.component_type='item_price' and ali.quantity=1)::boolean single_unit_specific
 from public.acquisition_cost_components c join public.acquisition_line_items ali on ali.id=c.line_item_id
 where c.workspace_id=p_workspace_id and c.line_item_id is not null and c.attribution_state='direct'
   and c.amount_state in ('known','documented_free') and c.reversed_at is null
 union all
 select c.id,a.id,a.line_item_id,c.component_type,c.currency,a.amount_minor,false
 from public.acquisition_cost_components c join public.acquisition_cost_allocations a on a.cost_component_id=c.id
 where c.workspace_id=p_workspace_id and c.attribution_state='allocated' and c.amount_state in ('known','documented_free')
   and c.reversed_at is null and a.state='confirmed' and a.reversed_at is null;

 -- A blocker is applicable evidence whose monetary truth cannot yet be attributed.
 -- Shared order/lot evidence expands to every active line in that scope.
 create temporary table _icb_blockers on commit drop as
 with applicable as (
   select c.id component_id,c.currency,c.line_item_id
   from public.acquisition_cost_components c
   where c.workspace_id=p_workspace_id and c.reversed_at is null and c.line_item_id is not null
     and (c.amount_state not in ('known','documented_free') or c.attribution_state<>'direct')
   union all
   select c.id,c.currency,ll.line_item_id
   from public.acquisition_cost_components c
   join public.acquisition_lots al on (c.lot_id=al.id or (c.lot_id is null and c.order_id=al.order_id))
   join public.acquisition_lot_lines ll on ll.lot_id=al.id and ll.state='active'
   where c.workspace_id=p_workspace_id and c.reversed_at is null and c.line_item_id is null
     and (c.amount_state not in ('known','documented_free') or c.attribution_state<>'allocated'
       or exists(select 1 from public.acquisition_cost_allocations ca
                 where ca.cost_component_id=c.id and ca.state='candidate'))
 ) select distinct line_item_id,currency from applicable;

 create temporary table _icb_unit_contrib on commit drop as
 select u.*,c.component_id,c.allocation_id,c.component_type,c.currency,
   (case when c.component_type='discount' then -1 else 1 end) *
   ((c.amount_minor/u.expected_quantity) + case when u.source_ord <= (c.amount_minor%u.expected_quantity) then 1 else 0 end) amount_minor,
   (c.single_unit_specific and u.inventory_item_id is not null) source_specific
 from _icb_units u join _icb_costs c on c.line_item_id=u.acquisition_line_item_id
 where u.source_ord<=u.expected_quantity;

 perform set_config('app.governed_cost_basis_mutation','on',true);
 update public.inventory_cost_basis set state='superseded',superseded_at=now(),superseded_by_recompute_id=v_recompute
 where workspace_id=p_workspace_id and state in ('current','unresolved');
 insert into public.inventory_cost_basis_events(workspace_id,recompute_id,inventory_cost_basis_id,event_kind,algorithm_version,input_content_hash,actor_user_id)
 select p_workspace_id,v_recompute,b.id,'superseded',v_version,v_hash,v_user from public.inventory_cost_basis b
 where b.workspace_id=p_workspace_id and b.superseded_by_recompute_id=v_recompute;

 insert into public.inventory_cost_basis(workspace_id,recompute_id,subject_kind,inventory_lot_id,inventory_item_id,
   acquisition_line_item_id,acquisition_receipt_line_inventory_link_id,layer_seq,source_unit_ordinal,total_cost_minor,currency,basis_method,state,algorithm_version,input_content_hash)
 select p_workspace_id,v_recompute,case when u.inventory_item_id is null then 'lot'::public.inventory_cost_basis_subject_kind else 'item' end,
   u.inventory_lot_id,u.inventory_item_id,u.acquisition_line_item_id,u.link_id,
   row_number() over(partition by coalesce(u.inventory_item_id,u.inventory_lot_id),currencies.currency order by u.received_at,u.receipt_id,u.link_id,u.unit_in_link),
   u.source_ord,case when u.source_ord>u.expected_quantity or blocker.line_item_id is not null or coalesce(sum(c.amount_minor),0)<0 then null else sum(c.amount_minor) end,currencies.currency,
   case when u.source_ord>u.expected_quantity or blocker.line_item_id is not null or coalesce(sum(c.amount_minor),0)<0 then 'unresolved'::public.inventory_cost_basis_method
        when u.inventory_item_id is null then 'fifo'::public.inventory_cost_basis_method
        when bool_or(coalesce(c.source_specific,false)) then 'source_observed_specific'::public.inventory_cost_basis_method
        else 'deterministic_equal_attribution'::public.inventory_cost_basis_method end,
   case when u.source_ord>u.expected_quantity or blocker.line_item_id is not null or coalesce(sum(c.amount_minor),0)<0 then 'unresolved'::public.inventory_cost_basis_state else 'current'::public.inventory_cost_basis_state end,
   v_version,v_hash
 from _icb_units u join (
   select line_item_id,currency from _icb_costs union select line_item_id,currency from _icb_blockers
 ) currencies on currencies.line_item_id=u.acquisition_line_item_id
 left join _icb_unit_contrib c on c.link_id=u.link_id and c.unit_in_link=u.unit_in_link and c.currency=currencies.currency
 left join _icb_blockers blocker on blocker.line_item_id=u.acquisition_line_item_id and blocker.currency=currencies.currency
 group by u.inventory_lot_id,u.inventory_item_id,u.acquisition_line_item_id,u.link_id,u.source_ord,u.expected_quantity,u.received_at,u.receipt_id,u.unit_in_link,currencies.currency,blocker.line_item_id;

 insert into public.inventory_cost_basis_contributions(workspace_id,inventory_cost_basis_id,acquisition_cost_component_id,
   acquisition_cost_allocation_id,acquisition_receipt_line_id,acquisition_receipt_line_inventory_link_id,amount_minor,currency,component_type)
 select p_workspace_id,b.id,c.component_id,c.allocation_id,c.receipt_line_id,c.link_id,c.amount_minor,c.currency,c.component_type
 from _icb_unit_contrib c join public.inventory_cost_basis b on b.recompute_id=v_recompute and b.workspace_id=p_workspace_id
  and b.acquisition_receipt_line_inventory_link_id=c.link_id and b.source_unit_ordinal=c.source_ord and b.currency=c.currency;
 insert into public.inventory_cost_basis_events(workspace_id,recompute_id,inventory_cost_basis_id,event_kind,algorithm_version,input_content_hash,actor_user_id)
 select p_workspace_id,v_recompute,b.id,'created',v_version,v_hash,v_user from public.inventory_cost_basis b where b.recompute_id=v_recompute;
 insert into public.inventory_cost_basis_events(workspace_id,recompute_id,event_kind,algorithm_version,input_content_hash,actor_user_id)
 values(p_workspace_id,v_recompute,'created',v_version,v_hash,v_user);
 select count(*) into v_count from public.inventory_cost_basis where recompute_id=v_recompute;
 perform set_config('app.governed_cost_basis_mutation','off',true);
 return jsonb_build_object('recomputed',true,'recomputeId',v_recompute,'algorithmVersion',v_version,'contentHash',v_hash,'basisRows',v_count);
end$$;

insert into public.schema_migrations_log(migration_name)
values ('20260815000200_cost_basis_truth_hardening');
