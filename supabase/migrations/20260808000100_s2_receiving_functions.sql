-- S2.2 governed receiving behaviour and acquisition-to-inventory provenance.

alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'source_system_registered','import_previewed','import_started','import_records_staged','import_committed','import_failed','source_record_ingested','crosswalk_candidate_created','crosswalk_confirmed','crosswalk_rejected','crosswalk_superseded','issue_opened','issue_acknowledged','issue_resolved','issue_wont_fix','channel_registered','supplier_registered','supplier_alias_created','acquisition_import_started','acquisition_import_staged','acquisition_import_committed','acquisition_import_failed','lot_line_superseded','cost_component_reversed','cost_allocation_proposed','cost_allocation_confirmed','cost_allocation_reversed','acquisition_line_classified','acquisition_line_classification_superseded','acquisition_line_classification_overridden','classification_rule_created','classification_rule_superseded','acquisition_payment_recorded','acquisition_payment_reversed','acquisition_shipment_created','acquisition_shipment_transitioned','acquisition_line_excluded','acquisition_line_restored',
  'acquisition_receipt_opened','acquisition_receipt_line_recorded','acquisition_receipt_line_corrected','acquisition_receipt_submitted','acquisition_receipt_cancelled','acquisition_receipt_inventory_linked','acquisition_receipt_reconciled','acquisition_discrepancy_raised','acquisition_discrepancy_claimed','acquisition_discrepancy_resolved','acquisition_discrepancy_written_off'
));

create table public.acquisition_receipt_line_inventory_links (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 public_id text not null default app.mint_governed_public_id('RV-ARIL') check(public_id ~ '^RV-ARIL-[A-Z0-9]{12}$'),
 acquisition_receipt_line_id uuid not null,
 inventory_lot_id uuid,
 inventory_item_id uuid,
 quantity_linked integer not null check(quantity_linked > 0),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(id,workspace_id), unique(workspace_id,public_id),
 foreign key(acquisition_receipt_line_id,workspace_id) references public.acquisition_receipt_lines(id,workspace_id) on delete restrict,
 foreign key(inventory_lot_id,workspace_id) references public.inventory_lots(id,workspace_id) on delete restrict,
 foreign key(inventory_item_id,workspace_id) references public.inventory_items(id,workspace_id) on delete restrict,
 constraint acquisition_receipt_inventory_one_subject check ((inventory_lot_id is null) <> (inventory_item_id is null)),
 constraint acquisition_receipt_inventory_item_quantity check (inventory_item_id is null or quantity_linked=1),
 unique(acquisition_receipt_line_id,inventory_lot_id), unique(acquisition_receipt_line_id,inventory_item_id),
 unique(inventory_item_id)
);
create index acquisition_receipt_inventory_line_idx on public.acquisition_receipt_line_inventory_links(workspace_id,acquisition_receipt_line_id);
alter table public.acquisition_receipt_line_inventory_links enable row level security;
create policy acquisition_receipt_inventory_member_read on public.acquisition_receipt_line_inventory_links for select to authenticated using(app.member_role(workspace_id) is not null);
revoke all on public.acquisition_receipt_line_inventory_links from public,anon,authenticated;
grant select on public.acquisition_receipt_line_inventory_links to authenticated;

create function app.receiving_line_order_lock(p_workspace_id uuid,p_line_id uuid,p_order_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare n integer; actual uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':exclusion-line:'||p_line_id::text,0));
 perform 1 from public.acquisition_line_items where id=p_line_id and workspace_id=p_workspace_id for share;
 select count(*),(array_agg(l.order_id))[1] into n,actual
 from public.acquisition_lot_lines ll join public.acquisition_lots l on l.id=ll.lot_id and l.workspace_id=ll.workspace_id
 where ll.workspace_id=p_workspace_id and ll.line_item_id=p_line_id and ll.state='active';
 if n=0 then raise exception 'acquisition_line_not_in_receipt_order' using errcode='23514'; end if;
 if n>1 then raise exception 'acquisition_integrity_error' using errcode='23514'; end if;
 if actual<>p_order_id then raise exception 'acquisition_line_not_in_receipt_order' using errcode='23514'; end if;
 perform app.assert_acquisition_line_eligible_for_downstream(p_workspace_id,p_line_id);
end $$;
revoke all on function app.receiving_line_order_lock(uuid,uuid,uuid) from public,anon,authenticated;

create function app.enforce_receiving_graph() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='acquisition_receipts' then
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.acquisition_order_id<>old.acquisition_order_id or new.acquisition_shipment_id is distinct from old.acquisition_shipment_id or new.create_idempotency_key<>old.create_idempotency_key or new.create_fingerprint<>old.create_fingerprint or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'receipt_terminal' using errcode='55000'; end if;
  if new.status<>old.status and not ((old.status='open' and new.status in ('submitted','cancelled')) or (old.status='submitted' and new.status='reconciled')) then raise exception 'invalid_transition' using errcode='23514'; end if;
  if old.status<>'open' and (new.note is distinct from old.note or new.received_at is distinct from old.received_at) then raise exception 'receipt_terminal' using errcode='55000'; end if;
 elsif tg_table_name='acquisition_receipt_lines' then
  if old.acquisition_receipt_id<>new.acquisition_receipt_id or old.acquisition_line_item_id<>new.acquisition_line_item_id or old.workspace_id<>new.workspace_id then raise exception 'receipt_line_conflict' using errcode='23514'; end if;
  if not exists(select 1 from public.acquisition_receipts r where r.id=old.acquisition_receipt_id and r.status='open') then raise exception 'receipt_not_open' using errcode='55000'; end if;
 elsif tg_table_name='acquisition_discrepancies' then
  if new.status<>old.status and not ((old.status='open' and new.status in ('claimed','resolved','written_off')) or (old.status='claimed' and new.status in ('resolved','written_off'))) then raise exception 'invalid_transition' using errcode='23514'; end if;
  if old.status in ('resolved','written_off') then raise exception 'invalid_transition' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create trigger acquisition_receipts_graph before update on public.acquisition_receipts for each row execute function app.enforce_receiving_graph();
create trigger acquisition_receipt_lines_freeze before update on public.acquisition_receipt_lines for each row execute function app.enforce_receiving_graph();
create trigger acquisition_discrepancies_graph before update on public.acquisition_discrepancies for each row execute function app.enforce_receiving_graph();

create function app.enforce_receiving_link_conservation() returns trigger language plpgsql set search_path='' as $$
declare line_id uuid:=coalesce(new.acquisition_receipt_line_id,old.acquisition_receipt_line_id); cap integer; used bigint; receipt_state public.acquisition_receipt_status;
begin
 select l.quantity_received,r.status into cap,receipt_state from public.acquisition_receipt_lines l join public.acquisition_receipts r on r.id=l.acquisition_receipt_id where l.id=line_id for update of l;
 if receipt_state in ('reconciled','cancelled') then raise exception 'receipt_terminal' using errcode='55000'; end if;
 if tg_op<>'DELETE' then
  if new.inventory_item_id is not null and not exists(select 1 from public.inventory_items i join public.inventory_lots lot on lot.id=i.lot_id where i.id=new.inventory_item_id and lot.tracking_mode='serialized') then raise exception 'inventory_subject_not_found' using errcode='P0002'; end if;
  if new.inventory_lot_id is not null and not exists(select 1 from public.inventory_lots lot where lot.id=new.inventory_lot_id and lot.tracking_mode='lot_managed') then raise exception 'inventory_subject_not_found' using errcode='P0002'; end if;
 end if;
 select coalesce(sum(quantity_linked),0) into used from public.acquisition_receipt_line_inventory_links where acquisition_receipt_line_id=line_id and id<>coalesce(new.id,old.id);
 if tg_op<>'DELETE' and used+new.quantity_linked>cap then raise exception 'inventory_link_over_capacity' using errcode='23514'; end if;
 return coalesce(new,old);
end $$;
create trigger acquisition_receipt_inventory_conservation before insert or update or delete on public.acquisition_receipt_line_inventory_links for each row execute function app.enforce_receiving_link_conservation();
create trigger acquisition_receipt_inventory_guard before update or delete on public.acquisition_receipt_line_inventory_links for each row execute function app.guard_acquisition_receiving_rows();
create trigger acquisition_receipt_inventory_no_truncate before truncate on public.acquisition_receipt_line_inventory_links execute function app.forbid_update_delete();

create function public.open_acquisition_receipt(p_workspace_id uuid,p_acquisition_order_public_id text,p_shipment_public_id text,p_received_at timestamptz,p_note text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; o public.acquisition_orders%rowtype; ship uuid; x public.acquisition_receipts%rowtype; fp text; key text:=btrim(coalesce(p_idempotency_key,'')); note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]);
 if char_length(key) not between 8 and 200 then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into o from public.acquisition_orders where workspace_id=p_workspace_id and public_id=p_acquisition_order_public_id; if o.id is null then raise exception 'acquisition_not_found' using errcode='P0002'; end if;
 if p_shipment_public_id is not null then select id into ship from public.acquisition_shipments where workspace_id=p_workspace_id and acquisition_order_id=o.id and public_id=p_shipment_public_id; if ship is null then raise exception 'acquisition_not_found' using errcode='P0002'; end if; end if;
 fp:=encode(sha256(convert_to(jsonb_build_object('order',o.id,'shipment',ship,'received_at',p_received_at,'note',note)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':receipt-key:'||key,0));
 select * into x from public.acquisition_receipts where workspace_id=p_workspace_id and create_idempotency_key=key;
 if x.id is not null then if x.create_fingerprint<>fp then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('receiptPublicId',x.public_id,'status',x.status,'replayed',true); end if;
 insert into public.acquisition_receipts(workspace_id,acquisition_order_id,acquisition_shipment_id,received_at,note,create_idempotency_key,create_fingerprint,created_by) values(p_workspace_id,o.id,ship,p_received_at,note,key,fp,u) returning * into x;
 perform app.log_audit_event(p_workspace_id,'acquisition_receipt_opened','acquisition_receipts',x.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('receipt_public_id',x.public_id,'order_public_id',o.public_id,'shipment_public_id',p_shipment_public_id));
 return jsonb_build_object('receiptPublicId',x.public_id,'status',x.status,'replayed',false);
end $$;

create function public.record_acquisition_receipt_line(p_workspace_id uuid,p_receipt_public_id text,p_source_system_public_id text,p_acquisition_line_public_id text,p_quantity integer,p_note text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; r public.acquisition_receipts%rowtype; line_id uuid; n integer; x public.acquisition_receipt_lines%rowtype; note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]); if p_quantity is null or p_quantity<=0 then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into r from public.acquisition_receipts where workspace_id=p_workspace_id and public_id=p_receipt_public_id for update; if r.id is null then raise exception 'receipt_not_found' using errcode='P0002'; end if; if r.status<>'open' then raise exception 'receipt_not_open' using errcode='55000'; end if;
 select count(distinct acquisition_line_item_id),(array_agg(distinct acquisition_line_item_id))[1] into n,line_id from public.acquisition_line_overview where workspace_id=p_workspace_id and source_system_public_id=p_source_system_public_id and acquisition_line_public_id=p_acquisition_line_public_id;
 if n=0 then raise exception 'acquisition_not_found' using errcode='P0002'; elsif n>1 then raise exception 'acquisition_integrity_error' using errcode='23514'; end if;
 perform app.receiving_line_order_lock(p_workspace_id,line_id,r.acquisition_order_id);
 select * into x from public.acquisition_receipt_lines where acquisition_receipt_id=r.id and acquisition_line_item_id=line_id;
 if x.id is not null then if x.quantity_received<>p_quantity or x.note is distinct from note then raise exception 'receipt_line_conflict' using errcode='23505'; end if; return jsonb_build_object('receiptLinePublicId',x.public_id,'quantityReceived',x.quantity_received,'replayed',true); end if;
 insert into public.acquisition_receipt_lines(workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,note,created_by) values(p_workspace_id,r.id,line_id,p_quantity,note,u) returning * into x;
 perform app.log_audit_event(p_workspace_id,'acquisition_receipt_line_recorded','acquisition_receipt_lines',x.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('receipt_public_id',r.public_id,'receipt_line_public_id',x.public_id,'source_system_public_id',p_source_system_public_id,'acquisition_line_public_id',p_acquisition_line_public_id,'quantity_received',p_quantity));
 return jsonb_build_object('receiptLinePublicId',x.public_id,'quantityReceived',x.quantity_received,'replayed',false);
end $$;

create function public.correct_acquisition_receipt_line(p_workspace_id uuid,p_receipt_line_public_id text,p_expected_quantity integer,p_desired_quantity integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; x public.acquisition_receipt_lines%rowtype; r public.acquisition_receipts%rowtype; reason text:=btrim(coalesce(p_reason,''));
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]); if p_desired_quantity<=0 or char_length(reason) not between 1 and 500 then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into x from public.acquisition_receipt_lines where workspace_id=p_workspace_id and public_id=p_receipt_line_public_id for update; if x.id is null then raise exception 'receipt_line_not_found' using errcode='P0002'; end if;
 select * into r from public.acquisition_receipts where id=x.acquisition_receipt_id for update; if r.status<>'open' then raise exception 'receipt_not_open' using errcode='55000'; end if;
 perform app.receiving_line_order_lock(p_workspace_id,x.acquisition_line_item_id,r.acquisition_order_id);
 if x.quantity_received=p_desired_quantity then return jsonb_build_object('receiptLinePublicId',x.public_id,'quantityReceived',x.quantity_received,'replayed',true); end if;
 if x.quantity_received<>p_expected_quantity then raise exception 'receipt_line_conflict' using errcode='40001'; end if;
 perform set_config('app.governed_receiving_mutation','on',true); update public.acquisition_receipt_lines set quantity_received=p_desired_quantity where id=x.id;
 perform app.log_audit_event(p_workspace_id,'acquisition_receipt_line_corrected','acquisition_receipt_lines',x.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('receipt_line_public_id',x.public_id,'before_quantity',x.quantity_received,'after_quantity',p_desired_quantity,'reason',reason));
 return jsonb_build_object('receiptLinePublicId',x.public_id,'quantityReceived',p_desired_quantity,'replayed',false);
end $$;

create function app.transition_receipt(p_workspace_id uuid,p_receipt_public_id text,p_action text,p_reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare roles public.workspace_role[]:=case when p_action='reconcile' then array['owner']::public.workspace_role[] else array['owner','operator']::public.workspace_role[] end; u uuid; r public.acquisition_receipts%rowtype; l record; target public.acquisition_receipt_status; event text; reason text:=btrim(coalesce(p_reason,''));
begin
 u:=app.assert_workspace_role(p_workspace_id,roles); select * into r from public.acquisition_receipts where workspace_id=p_workspace_id and public_id=p_receipt_public_id for update; if r.id is null then raise exception 'receipt_not_found' using errcode='P0002'; end if;
 target:=case p_action when 'submit' then 'submitted' when 'cancel' then 'cancelled' when 'reconcile' then 'reconciled' else null end;
 if r.status=target then return jsonb_build_object('receiptPublicId',r.public_id,'status',r.status,'replayed',true); end if;
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
create function public.submit_acquisition_receipt(uuid,text) returns jsonb language sql security definer set search_path='' as $$select app.transition_receipt($1,$2,'submit')$$;
create function public.cancel_acquisition_receipt(uuid,text,text) returns jsonb language sql security definer set search_path='' as $$select app.transition_receipt($1,$2,'cancel',$3)$$;
create function public.reconcile_acquisition_receipt(uuid,text) returns jsonb language sql security definer set search_path='' as $$select app.transition_receipt($1,$2,'reconcile')$$;

create function public.link_acquisition_receipt_inventory(p_workspace_id uuid,p_receipt_line_public_id text,p_inventory_lot_public_id text default null,p_inventory_item_public_id text default null,p_quantity integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; l public.acquisition_receipt_lines%rowtype; r public.acquisition_receipts%rowtype; lot uuid; item uuid; x public.acquisition_receipt_line_inventory_links%rowtype;
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]); if (p_inventory_lot_public_id is null)=(p_inventory_item_public_id is null) then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into l from public.acquisition_receipt_lines where workspace_id=p_workspace_id and public_id=p_receipt_line_public_id; if l.id is null then raise exception 'receipt_line_not_found' using errcode='P0002'; end if;
 select * into r from public.acquisition_receipts where id=l.acquisition_receipt_id for update; if r.status not in ('open','submitted') then raise exception 'receipt_terminal' using errcode='55000'; end if;
 if p_inventory_lot_public_id is not null then select id into lot from public.inventory_lots where workspace_id=p_workspace_id and public_id=p_inventory_lot_public_id; else select id into item from public.inventory_items where workspace_id=p_workspace_id and public_id=p_inventory_item_public_id; end if;
 if coalesce(lot,item) is null then raise exception 'inventory_subject_not_found' using errcode='P0002'; end if;
 select * into x from public.acquisition_receipt_line_inventory_links where acquisition_receipt_line_id=l.id and (inventory_lot_id=lot or inventory_item_id=item);
 if x.id is not null then if x.quantity_linked<>p_quantity then raise exception 'receipt_line_conflict' using errcode='23505'; end if; return jsonb_build_object('inventoryLinkPublicId',x.public_id,'replayed',true); end if;
 insert into public.acquisition_receipt_line_inventory_links(workspace_id,acquisition_receipt_line_id,inventory_lot_id,inventory_item_id,quantity_linked,created_by) values(p_workspace_id,l.id,lot,item,p_quantity,u) returning * into x;
 perform app.log_audit_event(p_workspace_id,'acquisition_receipt_inventory_linked','acquisition_receipt_line_inventory_links',x.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('receipt_line_public_id',l.public_id,'inventory_link_public_id',x.public_id,'inventory_lot_public_id',p_inventory_lot_public_id,'inventory_item_public_id',p_inventory_item_public_id,'quantity_linked',p_quantity));
 return jsonb_build_object('inventoryLinkPublicId',x.public_id,'replayed',false);
end $$;

create function public.raise_acquisition_discrepancy(p_workspace_id uuid,p_order_public_id text,p_receipt_public_id text,p_receipt_line_public_id text,p_kind public.acquisition_discrepancy_kind,p_quantity_expected integer,p_quantity_observed integer,p_detail text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; oid uuid; rid uuid; lid uuid; ali uuid; d public.acquisition_discrepancies%rowtype; detail text:=btrim(coalesce(p_detail,''));
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]); if char_length(detail) not between 1 and 2000 then raise exception 'invalid_request' using errcode='22023'; end if;
 select id into oid from public.acquisition_orders where workspace_id=p_workspace_id and public_id=p_order_public_id; if oid is null then raise exception 'acquisition_not_found' using errcode='P0002'; end if;
 if p_receipt_public_id is not null then select id into rid from public.acquisition_receipts where workspace_id=p_workspace_id and public_id=p_receipt_public_id and acquisition_order_id=oid; if rid is null then raise exception 'receipt_not_found' using errcode='P0002'; end if; end if;
 if p_receipt_line_public_id is not null then select id,acquisition_line_item_id into lid,ali from public.acquisition_receipt_lines where workspace_id=p_workspace_id and public_id=p_receipt_line_public_id and acquisition_receipt_id=rid; if lid is null then raise exception 'receipt_line_not_found' using errcode='P0002'; end if; end if;
 insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,acquisition_receipt_id,acquisition_receipt_line_id,acquisition_line_item_id,kind,quantity_expected,quantity_observed,detail,created_by) values(p_workspace_id,oid,rid,lid,ali,p_kind,p_quantity_expected,p_quantity_observed,detail,u) returning * into d;
 perform app.log_audit_event(p_workspace_id,'acquisition_discrepancy_raised','acquisition_discrepancies',d.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('discrepancy_public_id',d.public_id,'kind',p_kind,'detail',detail)); return jsonb_build_object('discrepancyPublicId',d.public_id,'status',d.status);
end $$;

create function public.transition_acquisition_discrepancy(p_workspace_id uuid,p_discrepancy_public_id text,p_target public.acquisition_discrepancy_status,p_resolution_note text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare roles public.workspace_role[]:=case when p_target in ('resolved','written_off') then array['owner']::public.workspace_role[] else array['owner','operator']::public.workspace_role[] end; u uuid; d public.acquisition_discrepancies%rowtype; note text:=btrim(coalesce(p_resolution_note,'')); event text;
begin
 u:=app.assert_workspace_role(p_workspace_id,roles); select * into d from public.acquisition_discrepancies where workspace_id=p_workspace_id and public_id=p_discrepancy_public_id for update; if d.id is null then raise exception 'discrepancy_not_found' using errcode='P0002'; end if;
 if d.status=p_target then return jsonb_build_object('discrepancyPublicId',d.public_id,'status',d.status,'replayed',true); end if;
 if p_target in ('resolved','written_off') and char_length(note) not between 1 and 2000 then raise exception 'invalid_request' using errcode='22023'; end if;
 perform set_config('app.governed_receiving_mutation','on',true); update public.acquisition_discrepancies set status=p_target,resolution_note=case when p_target in ('resolved','written_off') then note else null end,resolved_by=case when p_target in ('resolved','written_off') then u else null end,resolved_at=case when p_target in ('resolved','written_off') then clock_timestamp() else null end,updated_at=clock_timestamp() where id=d.id;
 event:=case p_target when 'claimed' then 'acquisition_discrepancy_claimed' when 'resolved' then 'acquisition_discrepancy_resolved' else 'acquisition_discrepancy_written_off' end; perform app.log_audit_event(p_workspace_id,event,'acquisition_discrepancies',d.id,u,'acquisition.receiving',null,null,null,jsonb_build_object('discrepancy_public_id',d.public_id,'from_status',d.status,'to_status',p_target,'resolution_note',nullif(note,''))); return jsonb_build_object('discrepancyPublicId',d.public_id,'status',p_target,'replayed',false);
end $$;

revoke all on function public.open_acquisition_receipt(uuid,text,text,timestamptz,text,text),public.record_acquisition_receipt_line(uuid,text,text,text,integer,text),public.correct_acquisition_receipt_line(uuid,text,integer,integer,text),app.transition_receipt(uuid,text,text,text),public.submit_acquisition_receipt(uuid,text),public.cancel_acquisition_receipt(uuid,text,text),public.reconcile_acquisition_receipt(uuid,text),public.link_acquisition_receipt_inventory(uuid,text,text,text,integer),public.raise_acquisition_discrepancy(uuid,text,text,text,public.acquisition_discrepancy_kind,integer,integer,text),public.transition_acquisition_discrepancy(uuid,text,public.acquisition_discrepancy_status,text) from public,anon;
revoke all on function app.transition_receipt(uuid,text,text,text) from authenticated;
grant execute on function public.open_acquisition_receipt(uuid,text,text,timestamptz,text,text),public.record_acquisition_receipt_line(uuid,text,text,text,integer,text),public.correct_acquisition_receipt_line(uuid,text,integer,integer,text),public.submit_acquisition_receipt(uuid,text),public.cancel_acquisition_receipt(uuid,text,text),public.reconcile_acquisition_receipt(uuid,text),public.link_acquisition_receipt_inventory(uuid,text,text,text,integer),public.raise_acquisition_discrepancy(uuid,text,text,text,public.acquisition_discrepancy_kind,integer,integer,text),public.transition_acquisition_discrepancy(uuid,text,public.acquisition_discrepancy_status,text) to authenticated;

insert into public.schema_migrations_log(migration_name) values('20260808000100_s2_receiving_functions');
