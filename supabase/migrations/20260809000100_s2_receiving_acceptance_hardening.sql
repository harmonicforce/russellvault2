-- S2.2 post-merge acceptance hardening.
--
-- Canonical mutation lock order is receipt -> receipt line -> downstream
-- eligibility/advisory decision -> inventory link.  In particular, correction
-- no longer takes the line lock before the receipt lock.

alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'source_system_registered','import_previewed','import_started','import_records_staged','import_committed','import_failed','source_record_ingested','crosswalk_candidate_created','crosswalk_confirmed','crosswalk_rejected','crosswalk_superseded','issue_opened','issue_acknowledged','issue_resolved','issue_wont_fix','channel_registered','supplier_registered','supplier_alias_created','acquisition_import_started','acquisition_import_staged','acquisition_import_committed','acquisition_import_failed','lot_line_superseded','cost_component_reversed','cost_allocation_proposed','cost_allocation_confirmed','cost_allocation_reversed','acquisition_line_classified','acquisition_line_classification_superseded','acquisition_line_classification_overridden','classification_rule_created','classification_rule_superseded','acquisition_payment_recorded','acquisition_payment_reversed','acquisition_shipment_created','acquisition_shipment_transitioned','acquisition_line_excluded','acquisition_line_restored',
  'acquisition_receipt_opened','acquisition_receipt_line_recorded','acquisition_receipt_line_corrected','acquisition_receipt_submitted','acquisition_receipt_cancelled','acquisition_receipt_inventory_linked','acquisition_receipt_inventory_unlinked','acquisition_receipt_reconciled','acquisition_discrepancy_raised','acquisition_discrepancy_claimed','acquisition_discrepancy_resolved','acquisition_discrepancy_written_off'
));

create or replace function app.enforce_receiving_graph() returns trigger
language plpgsql set search_path='' as $$
begin
 if coalesce(current_setting('app.governed_receiving_mutation',true),'')<>'on' then raise exception 'governed_write_required' using errcode='42501'; end if;
 if tg_table_name='acquisition_receipts' then
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.acquisition_order_id<>old.acquisition_order_id or new.acquisition_shipment_id is distinct from old.acquisition_shipment_id or new.create_idempotency_key<>old.create_idempotency_key or new.create_fingerprint<>old.create_fingerprint or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'receipt_terminal' using errcode='55000'; end if;
  if new.status<>old.status and not ((old.status='open' and new.status in ('submitted','cancelled')) or (old.status='submitted' and new.status='reconciled')) then raise exception 'invalid_transition' using errcode='23514'; end if;
  if old.status<>'open' and (new.note is distinct from old.note or new.received_at is distinct from old.received_at) then raise exception 'receipt_terminal' using errcode='55000'; end if;
 elsif tg_table_name='acquisition_receipt_lines' then
  if tg_op='DELETE' then
   if not exists(select 1 from public.acquisition_receipts r where r.id=old.acquisition_receipt_id and r.status='open') then raise exception 'receipt_not_open' using errcode='55000'; end if;
   return old;
  end if;
  if old.id<>new.id or old.public_id<>new.public_id or old.acquisition_receipt_id<>new.acquisition_receipt_id or old.acquisition_line_item_id<>new.acquisition_line_item_id or old.workspace_id<>new.workspace_id or old.created_by<>new.created_by or old.created_at<>new.created_at then raise exception 'receipt_line_conflict' using errcode='23514'; end if;
  if not exists(select 1 from public.acquisition_receipts r where r.id=old.acquisition_receipt_id and r.status='open') then raise exception 'receipt_not_open' using errcode='55000'; end if;
 elsif tg_table_name='acquisition_discrepancies' then
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.public_id<>old.public_id
     or new.acquisition_order_id<>old.acquisition_order_id
     or new.acquisition_receipt_id is distinct from old.acquisition_receipt_id
     or new.acquisition_receipt_line_id is distinct from old.acquisition_receipt_line_id
     or new.acquisition_line_item_id is distinct from old.acquisition_line_item_id
     or new.kind<>old.kind
     or new.quantity_expected is distinct from old.quantity_expected
     or new.quantity_observed is distinct from old.quantity_observed
     or new.expected_value_minor is distinct from old.expected_value_minor
     or new.actual_value_minor is distinct from old.actual_value_minor
     or new.currency is distinct from old.currency
     or new.detail<>old.detail or new.created_by<>old.created_by or new.created_at<>old.created_at
  then raise exception 'discrepancy_evidence_immutable' using errcode='55000'; end if;
  if new.status<>old.status and not ((old.status='open' and new.status in ('claimed','resolved','written_off')) or (old.status='claimed' and new.status in ('resolved','written_off'))) then raise exception 'invalid_transition' using errcode='23514'; end if;
  if old.status in ('resolved','written_off') then raise exception 'invalid_transition' using errcode='23514'; end if;
  if new.status in ('open','claimed') and (new.resolution_note is not null or new.resolved_by is not null or new.resolved_at is not null) then raise exception 'invalid_transition' using errcode='23514'; end if;
  if new.status in ('resolved','written_off') and (new.resolution_note is null or new.resolved_by is null or new.resolved_at is null) then raise exception 'invalid_transition' using errcode='23514'; end if;
 end if;
 return new;
end $$;

drop trigger acquisition_receipt_lines_freeze on public.acquisition_receipt_lines;
create trigger acquisition_receipt_lines_freeze before update or delete on public.acquisition_receipt_lines for each row execute function app.enforce_receiving_graph();

create or replace function app.enforce_receiving_link_conservation() returns trigger
language plpgsql set search_path='' as $$
declare line_id uuid:=coalesce(new.acquisition_receipt_line_id,old.acquisition_receipt_line_id); cap integer; used bigint; receipt_state public.acquisition_receipt_status;
begin
 if tg_op='UPDATE' and (new.id<>old.id or new.workspace_id<>old.workspace_id or new.public_id<>old.public_id
    or new.acquisition_receipt_line_id<>old.acquisition_receipt_line_id
    or new.inventory_lot_id is distinct from old.inventory_lot_id
    or new.inventory_item_id is distinct from old.inventory_item_id
    or new.quantity_linked<>old.quantity_linked
    or new.created_by<>old.created_by or new.created_at<>old.created_at) then
   raise exception 'inventory_link_immutable' using errcode='55000';
 end if;
 select l.quantity_received,r.status into cap,receipt_state
 from public.acquisition_receipt_lines l join public.acquisition_receipts r on r.id=l.acquisition_receipt_id
 where l.id=line_id for update of l;
 if receipt_state is null then raise exception 'receipt_line_not_found' using errcode='P0002'; end if;
 if tg_op='INSERT' and receipt_state<>'submitted' then raise exception 'receipt_not_submitted' using errcode='55000'; end if;
 if receipt_state in ('reconciled','cancelled') then raise exception 'receipt_terminal' using errcode='55000'; end if;
 if tg_op<>'DELETE' then
  if new.inventory_item_id is not null and not exists(select 1 from public.inventory_items i join public.inventory_lots lot on lot.id=i.lot_id and lot.workspace_id=i.workspace_id where i.id=new.inventory_item_id and i.workspace_id=new.workspace_id and lot.tracking_mode='serialized') then raise exception 'inventory_subject_not_found' using errcode='P0002'; end if;
  if new.inventory_lot_id is not null and not exists(select 1 from public.inventory_lots lot where lot.id=new.inventory_lot_id and lot.workspace_id=new.workspace_id and lot.tracking_mode='lot_managed') then raise exception 'inventory_subject_not_found' using errcode='P0002'; end if;
 end if;
 select coalesce(sum(quantity_linked),0) into used from public.acquisition_receipt_line_inventory_links where acquisition_receipt_line_id=line_id and id<>coalesce(new.id,old.id);
 if tg_op<>'DELETE' and used+new.quantity_linked>cap then raise exception 'inventory_link_over_capacity' using errcode='23514'; end if;
 return coalesce(new,old);
end $$;

create or replace function public.correct_acquisition_receipt_line(p_workspace_id uuid,p_receipt_line_public_id text,p_expected_quantity integer,p_desired_quantity integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; probe public.acquisition_receipt_lines%rowtype; x public.acquisition_receipt_lines%rowtype; r public.acquisition_receipts%rowtype; reason text:=btrim(coalesce(p_reason,'')); prior_reason text;
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]); if p_desired_quantity<=0 or char_length(reason) not between 1 and 500 then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into probe from public.acquisition_receipt_lines where workspace_id=p_workspace_id and public_id=p_receipt_line_public_id; if probe.id is null then raise exception 'receipt_line_not_found' using errcode='P0002'; end if;
 select * into r from public.acquisition_receipts where id=probe.acquisition_receipt_id for update; if r.status<>'open' then raise exception 'receipt_not_open' using errcode='55000'; end if;
 select * into x from public.acquisition_receipt_lines where id=probe.id for update; if x.acquisition_receipt_id<>r.id then raise exception 'receipt_line_conflict' using errcode='40001'; end if;
 perform app.receiving_line_order_lock(p_workspace_id,x.acquisition_line_item_id,r.acquisition_order_id);
 if x.quantity_received=p_desired_quantity then
  select a.detail->>'reason' into prior_reason from public.audit_events a where a.workspace_id=p_workspace_id and a.subject_table='acquisition_receipt_lines' and a.subject_id=x.id and a.event_type='acquisition_receipt_line_corrected' and (a.detail->>'before_quantity')::integer=p_expected_quantity and (a.detail->>'after_quantity')::integer=p_desired_quantity order by a.created_at desc limit 1;
  if prior_reason is distinct from reason then raise exception 'receipt_line_conflict' using errcode='40001'; end if;
  return jsonb_build_object('receiptLinePublicId',x.public_id,'quantityReceived',x.quantity_received,'replayed',true);
 end if;
 if x.quantity_received<>p_expected_quantity then raise exception 'receipt_line_conflict' using errcode='40001'; end if;
 perform set_config('app.governed_receiving_mutation','on',true); update public.acquisition_receipt_lines set quantity_received=p_desired_quantity where id=x.id;
 perform app.log_audit_event(p_workspace_id,'acquisition_receipt_line_corrected','acquisition_receipt_lines',x.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('receipt_line_public_id',x.public_id,'before_quantity',x.quantity_received,'after_quantity',p_desired_quantity,'reason',reason));
 return jsonb_build_object('receiptLinePublicId',x.public_id,'quantityReceived',p_desired_quantity,'replayed',false);
end $$;

create or replace function app.transition_receipt(p_workspace_id uuid,p_receipt_public_id text,p_action text,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare roles public.workspace_role[]:=case when p_action='reconcile' then array['owner']::public.workspace_role[] else array['owner','operator']::public.workspace_role[] end; u uuid; r public.acquisition_receipts%rowtype; l record; target public.acquisition_receipt_status; event text; reason text:=btrim(coalesce(p_reason,'')); prior_reason text;
begin
 u:=app.assert_workspace_role(p_workspace_id,roles); select * into r from public.acquisition_receipts where workspace_id=p_workspace_id and public_id=p_receipt_public_id for update; if r.id is null then raise exception 'receipt_not_found' using errcode='P0002'; end if;
 target:=case p_action when 'submit' then 'submitted' when 'cancel' then 'cancelled' when 'reconcile' then 'reconciled' else null end;
 if target is null then raise exception 'invalid_request' using errcode='22023'; end if;
 if r.status=target then
  if p_action='cancel' then select a.detail->>'reason' into prior_reason from public.audit_events a where a.workspace_id=p_workspace_id and a.subject_id=r.id and a.event_type='acquisition_receipt_cancelled' order by a.created_at desc limit 1; if prior_reason is distinct from reason then raise exception 'idempotency_conflict' using errcode='23505'; end if; end if;
  return jsonb_build_object('receiptPublicId',r.public_id,'status',r.status,'replayed',true);
 end if;
 -- A submit retry after reconciliation is a semantic replay, never a reverse transition.
 if p_action='submit' and r.status='reconciled' then return jsonb_build_object('receiptPublicId',r.public_id,'status',r.status,'replayed',true); end if;
 if p_action='submit' and r.status<>'open' then raise exception 'receipt_not_open' using errcode='55000'; elsif p_action='cancel' and r.status<>'open' then raise exception 'receipt_terminal' using errcode='55000'; elsif p_action='reconcile' and r.status<>'submitted' then raise exception 'receipt_not_submitted' using errcode='55000'; end if;
 if p_action='cancel' and char_length(reason) not between 1 and 500 then raise exception 'invalid_request' using errcode='22023'; end if;
 if p_action='submit' and (r.received_at is null or not exists(select 1 from public.acquisition_receipt_lines where acquisition_receipt_id=r.id)) then raise exception 'invalid_request' using errcode='23514'; end if;
 for l in select * from public.acquisition_receipt_lines where acquisition_receipt_id=r.id order by id for update loop
  perform app.receiving_line_order_lock(p_workspace_id,l.acquisition_line_item_id,r.acquisition_order_id);
  if p_action='reconcile' and (select coalesce(sum(quantity_linked),0) from public.acquisition_receipt_line_inventory_links where acquisition_receipt_line_id=l.id)<>l.quantity_received then raise exception 'inventory_link_incomplete' using errcode='23514'; end if;
  if p_action='reconcile' and (select coalesce(sum(rl.quantity_received),0) from public.acquisition_receipt_lines rl join public.acquisition_receipts rr on rr.id=rl.acquisition_receipt_id where rl.acquisition_line_item_id=l.acquisition_line_item_id and rr.status<>'cancelled') > (select quantity from public.acquisition_line_items where id=l.acquisition_line_item_id) and not exists(select 1 from public.acquisition_discrepancies d where d.acquisition_receipt_line_id=l.id and d.kind='over_shipped') then raise exception 'inventory_link_incomplete' using errcode='23514'; end if;
 end loop;
 perform set_config('app.governed_receiving_mutation','on',true); update public.acquisition_receipts set status=target,updated_at=clock_timestamp() where id=r.id;
 event:=case p_action when 'submit' then 'acquisition_receipt_submitted' when 'cancel' then 'acquisition_receipt_cancelled' else 'acquisition_receipt_reconciled' end;
 perform app.log_audit_event(p_workspace_id,event,'acquisition_receipts',r.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('receipt_public_id',r.public_id,'from_status',r.status,'to_status',target,'reason',nullif(reason,'')));
 return jsonb_build_object('receiptPublicId',r.public_id,'status',target,'replayed',false);
end $$;

create or replace function public.link_acquisition_receipt_inventory(p_workspace_id uuid,p_receipt_line_public_id text,p_inventory_lot_public_id text default null,p_inventory_item_public_id text default null,p_quantity integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; probe public.acquisition_receipt_lines%rowtype; l public.acquisition_receipt_lines%rowtype; r public.acquisition_receipts%rowtype; lot uuid; item uuid; x public.acquisition_receipt_line_inventory_links%rowtype;
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]); if (p_inventory_lot_public_id is null)=(p_inventory_item_public_id is null) or p_quantity is null or p_quantity<=0 then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into probe from public.acquisition_receipt_lines where workspace_id=p_workspace_id and public_id=p_receipt_line_public_id; if probe.id is null then raise exception 'receipt_line_not_found' using errcode='P0002'; end if;
 select * into r from public.acquisition_receipts where id=probe.acquisition_receipt_id for update; if r.status<>'submitted' then raise exception 'receipt_not_submitted' using errcode='55000'; end if;
 select * into l from public.acquisition_receipt_lines where id=probe.id for update;
 if p_inventory_lot_public_id is not null then select id into lot from public.inventory_lots where workspace_id=p_workspace_id and public_id=p_inventory_lot_public_id; else select id into item from public.inventory_items where workspace_id=p_workspace_id and public_id=p_inventory_item_public_id; end if;
 if coalesce(lot,item) is null then raise exception 'inventory_subject_not_found' using errcode='P0002'; end if;
 select * into x from public.acquisition_receipt_line_inventory_links where acquisition_receipt_line_id=l.id and (inventory_lot_id=lot or inventory_item_id=item);
 if x.id is not null then if x.quantity_linked<>p_quantity then raise exception 'receipt_line_conflict' using errcode='23505'; end if; return jsonb_build_object('inventoryLinkPublicId',x.public_id,'replayed',true); end if;
 insert into public.acquisition_receipt_line_inventory_links(workspace_id,acquisition_receipt_line_id,inventory_lot_id,inventory_item_id,quantity_linked,created_by) values(p_workspace_id,l.id,lot,item,p_quantity,u) returning * into x;
 perform app.log_audit_event(p_workspace_id,'acquisition_receipt_inventory_linked','acquisition_receipt_line_inventory_links',x.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('receipt_line_public_id',l.public_id,'inventory_link_public_id',x.public_id,'inventory_lot_public_id',p_inventory_lot_public_id,'inventory_item_public_id',p_inventory_item_public_id,'quantity_linked',p_quantity));
 return jsonb_build_object('inventoryLinkPublicId',x.public_id,'replayed',false);
end $$;

create function public.unlink_acquisition_receipt_inventory(p_workspace_id uuid,p_inventory_link_public_id text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; reason text:=btrim(coalesce(p_reason,'')); x public.acquisition_receipt_line_inventory_links%rowtype; probe public.acquisition_receipt_lines%rowtype; l public.acquisition_receipt_lines%rowtype; r public.acquisition_receipts%rowtype; prior_reason text;
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]); if char_length(reason) not between 1 and 500 then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into x from public.acquisition_receipt_line_inventory_links where workspace_id=p_workspace_id and public_id=p_inventory_link_public_id;
 if x.id is null then
  select a.detail->>'reason' into prior_reason from public.audit_events a where a.workspace_id=p_workspace_id and a.event_type='acquisition_receipt_inventory_unlinked' and a.detail->>'inventory_link_public_id'=p_inventory_link_public_id order by a.created_at desc limit 1;
  if prior_reason is null then raise exception 'inventory_link_not_found' using errcode='P0002'; end if;
  if prior_reason<>reason then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('inventoryLinkPublicId',p_inventory_link_public_id,'unlinked',true,'replayed',true);
 end if;
 select * into probe from public.acquisition_receipt_lines where id=x.acquisition_receipt_line_id;
 select * into r from public.acquisition_receipts where id=probe.acquisition_receipt_id for update; if r.status<>'submitted' then raise exception 'receipt_not_submitted' using errcode='55000'; end if;
 select * into l from public.acquisition_receipt_lines where id=probe.id for update;
 select * into x from public.acquisition_receipt_line_inventory_links where id=x.id for update; if x.id is null then raise exception 'inventory_link_not_found' using errcode='P0002'; end if;
 perform set_config('app.governed_receiving_mutation','on',true); delete from public.acquisition_receipt_line_inventory_links where id=x.id;
 perform app.log_audit_event(p_workspace_id,'acquisition_receipt_inventory_unlinked','acquisition_receipt_line_inventory_links',x.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('receipt_line_public_id',l.public_id,'inventory_link_public_id',x.public_id,'inventory_lot_id',x.inventory_lot_id,'inventory_item_id',x.inventory_item_id,'quantity_linked',x.quantity_linked,'reason',reason));
 return jsonb_build_object('inventoryLinkPublicId',x.public_id,'unlinked',true,'replayed',false);
end $$;

create or replace function public.transition_acquisition_discrepancy(p_workspace_id uuid,p_discrepancy_public_id text,p_target public.acquisition_discrepancy_status,p_resolution_note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare roles public.workspace_role[]:=case when p_target in ('resolved','written_off') then array['owner']::public.workspace_role[] else array['owner','operator']::public.workspace_role[] end; u uuid; d public.acquisition_discrepancies%rowtype; note text:=btrim(coalesce(p_resolution_note,'')); event text;
begin
 u:=app.assert_workspace_role(p_workspace_id,roles); select * into d from public.acquisition_discrepancies where workspace_id=p_workspace_id and public_id=p_discrepancy_public_id for update; if d.id is null then raise exception 'discrepancy_not_found' using errcode='P0002'; end if;
 if d.status=p_target then if p_target in ('resolved','written_off') and d.resolution_note is distinct from note then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('discrepancyPublicId',d.public_id,'status',d.status,'replayed',true); end if;
 if p_target in ('resolved','written_off') and char_length(note) not between 1 and 2000 then raise exception 'invalid_request' using errcode='22023'; end if;
 perform set_config('app.governed_receiving_mutation','on',true); update public.acquisition_discrepancies set status=p_target,resolution_note=case when p_target in ('resolved','written_off') then note else null end,resolved_by=case when p_target in ('resolved','written_off') then u else null end,resolved_at=case when p_target in ('resolved','written_off') then clock_timestamp() else null end,updated_at=clock_timestamp() where id=d.id;
 event:=case p_target when 'claimed' then 'acquisition_discrepancy_claimed' when 'resolved' then 'acquisition_discrepancy_resolved' else 'acquisition_discrepancy_written_off' end; perform app.log_audit_event(p_workspace_id,event,'acquisition_discrepancies',d.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('discrepancy_public_id',d.public_id,'from_status',d.status,'to_status',p_target,'resolution_note',nullif(note,''))); return jsonb_build_object('discrepancyPublicId',d.public_id,'status',p_target,'replayed',false);
end $$;

revoke all on function public.unlink_acquisition_receipt_inventory(uuid,text,text) from public,anon;
grant execute on function public.unlink_acquisition_receipt_inventory(uuid,text,text) to authenticated;

insert into public.schema_migrations_log(migration_name)
values('20260809000100_s2_receiving_acceptance_hardening');
