begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(58);
create function pg_temp.h(p_seed text) returns text language sql immutable as $$select encode(sha256(p_seed::bytea),'hex')$$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$begin perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true); execute 'set local role authenticated'; end$$;
insert into auth.users(id,email) values
 ('64000000-0000-4000-8000-000000000001','owner64@example.test'),
 ('64000000-0000-4000-8000-000000000002','operator64@example.test'),
 ('64000000-0000-4000-8000-000000000003','viewer64@example.test'),
 ('64000000-0000-4000-8000-000000000004','ownerf64@example.test');
insert into public.workspaces(id,name,created_by) values
 ('64000000-1000-4000-8000-000000000001','S2.1 receiving','64000000-0000-4000-8000-000000000001'),
 ('64000000-1000-4000-8000-000000000002','S2.1 foreign','64000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('64000000-1000-4000-8000-000000000001','64000000-0000-4000-8000-000000000002','operator'),
 ('64000000-1000-4000-8000-000000000001','64000000-0000-4000-8000-000000000003','viewer');
insert into public.source_systems(id,workspace_id,public_id,kind,instance_label,created_by) values
 ('64000000-2000-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','SRC-64-A','manual','A source','64000000-0000-4000-8000-000000000001'),
 ('64000000-2000-4000-8000-000000000002','64000000-1000-4000-8000-000000000002','SRC-64-F','manual','foreign source','64000000-0000-4000-8000-000000000004');
insert into public.import_jobs(id,workspace_id,public_id,source_system_id,source_label,file_sha256,content_sha256,parser_version,mapping_version,idempotency_key,mode,status,source_row_count,accepted_row_count,issue_row_count,source_totals,actor_user_id,actor_process) values
 ('64000000-3000-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','IMP-64-A','64000000-2000-4000-8000-000000000001','fixture',repeat('a',64),repeat('b',64),'1.0.0','1.0.0','s21-recv-a','commit','preview',3,0,0,'{}','64000000-0000-4000-8000-000000000001','test.import'),
 ('64000000-3000-4000-8000-000000000002','64000000-1000-4000-8000-000000000002','IMP-64-F','64000000-2000-4000-8000-000000000002','fixture',repeat('c',64),repeat('d',64),'1.0.0','1.0.0','s21-recv-f','commit','preview',1,0,0,'{}','64000000-0000-4000-8000-000000000004','test.import');
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process)
select ('64000000-5100-4000-8000-00000000000'||n)::uuid,'64000000-1000-4000-8000-000000000001','64000000-3000-4000-8000-000000000001',n-1,'a-row-'||n,
 jsonb_build_object('product_name','sealed case '||n),pg_temp.h('a-row-'||n),'parsed','{}','1.0.0','1.0.0','test.import'
from generate_series(1,3) n;
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process) values
 ('64000000-5100-4000-8000-000000000009','64000000-1000-4000-8000-000000000002','64000000-3000-4000-8000-000000000002',0,'f-row-1','{"product_name":"foreign line"}',pg_temp.h('f-row-1'),'parsed','{}','1.0.0','1.0.0','test.import');
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=3 where id='64000000-3000-4000-8000-000000000001';
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=1 where id='64000000-3000-4000-8000-000000000002';
insert into public.channels(id,workspace_id,public_id,name,kind,created_by) values
 ('64000000-6000-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-CH-64A001','A channel','manual','64000000-0000-4000-8000-000000000001'),
 ('64000000-6000-4000-8000-000000000002','64000000-1000-4000-8000-000000000002','RV-CH-64F001','F channel','manual','64000000-0000-4000-8000-000000000004');
insert into public.suppliers(id,workspace_id,public_id,display_name,created_by_process) values
 ('64000000-7000-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-SUP-64A001','A seller','test.import'),
 ('64000000-7000-4000-8000-000000000002','64000000-1000-4000-8000-000000000002','RV-SUP-64F001','Foreign seller','test.import');
insert into public.acquisition_import_jobs(id,workspace_id,channel_id,source_import_job_id,idempotency_key,mode,status,expected_line_count,mapping_version,plan_sha256,actor_user_id,actor_process) values
 ('64000000-4000-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','64000000-6000-4000-8000-000000000001','64000000-3000-4000-8000-000000000001','s21-acq-a','commit','preview',3,'1.0.0',repeat('1',64),'64000000-0000-4000-8000-000000000001','test.import'),
 ('64000000-4000-4000-8000-000000000002','64000000-1000-4000-8000-000000000002','64000000-6000-4000-8000-000000000002','64000000-3000-4000-8000-000000000002','s21-acq-f','commit','preview',1,'1.0.0',repeat('2',64),'64000000-0000-4000-8000-000000000004','test.import');
-- Line 1 expects 10 units (the partial-receiving subject), lines 2 and 3 expect
-- 4 and 7 (the multi-line receipt subjects).
insert into public.acquisition_line_items(id,workspace_id,public_id,source_system_id,source_record_id,acquisition_import_job_id,quantity,description,source_detail,created_by_process) values
 ('64000000-5000-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','LINE-64-A1','64000000-2000-4000-8000-000000000001','64000000-5100-4000-8000-000000000001','64000000-4000-4000-8000-000000000001',10,'sealed case 1','{}','test.import'),
 ('64000000-5000-4000-8000-000000000002','64000000-1000-4000-8000-000000000001','LINE-64-A2','64000000-2000-4000-8000-000000000001','64000000-5100-4000-8000-000000000002','64000000-4000-4000-8000-000000000001',4,'sealed case 2','{}','test.import'),
 ('64000000-5000-4000-8000-000000000003','64000000-1000-4000-8000-000000000001','LINE-64-A3','64000000-2000-4000-8000-000000000001','64000000-5100-4000-8000-000000000003','64000000-4000-4000-8000-000000000001',7,'sealed case 3','{}','test.import'),
 ('64000000-5000-4000-8000-000000000009','64000000-1000-4000-8000-000000000002','LINE-64-F1','64000000-2000-4000-8000-000000000002','64000000-5100-4000-8000-000000000009','64000000-4000-4000-8000-000000000002',1,'foreign line','{}','test.import');
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=3,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='64000000-4000-4000-8000-000000000001';
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=1,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='64000000-4000-4000-8000-000000000002';
set local session_replication_role=replica;
-- Two orders in workspace A: the second exists so a receipt can be proven
-- unable to borrow another order's shipment.
insert into public.acquisition_orders(id,workspace_id,public_id,channel_id,supplier_id,source_system_id,acquisition_import_job_id,source_order_reference,first_source_record_id,order_status,occurred_at,created_by_process) values
 ('64000000-7200-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-ACQ-64A001','64000000-6000-4000-8000-000000000001','64000000-7000-4000-8000-000000000001','64000000-2000-4000-8000-000000000001','64000000-4000-4000-8000-000000000001','ORDER-64-A1','64000000-5100-4000-8000-000000000001','unknown','2026-08-01T10:00:00Z','test.import'),
 ('64000000-7200-4000-8000-000000000003','64000000-1000-4000-8000-000000000001','RV-ACQ-64A002','64000000-6000-4000-8000-000000000001','64000000-7000-4000-8000-000000000001','64000000-2000-4000-8000-000000000001','64000000-4000-4000-8000-000000000001','ORDER-64-A2','64000000-5100-4000-8000-000000000002','unknown','2026-08-02T10:00:00Z','test.import'),
 ('64000000-7200-4000-8000-000000000002','64000000-1000-4000-8000-000000000002','RV-ACQ-64F001','64000000-6000-4000-8000-000000000002','64000000-7000-4000-8000-000000000002','64000000-2000-4000-8000-000000000002','64000000-4000-4000-8000-000000000002','ORDER-64-F1','64000000-5100-4000-8000-000000000009','unknown',null,'test.import');
insert into public.acquisition_lots(id,workspace_id,public_id,order_id,created_by_process) values
 ('64000000-7300-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-ALOT-64A001','64000000-7200-4000-8000-000000000001','test.import'),
 ('64000000-7300-4000-8000-000000000002','64000000-1000-4000-8000-000000000002','RV-ALOT-64F001','64000000-7200-4000-8000-000000000002','test.import');
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,sequence_no,created_by_process)
select ('64000000-7400-4000-8000-00000000000'||n)::uuid,'64000000-1000-4000-8000-000000000001','64000000-7300-4000-8000-000000000001',('64000000-5000-4000-8000-00000000000'||n)::uuid,n,'test.import'
from generate_series(1,3) n;
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,created_by_process) values
 ('64000000-7400-4000-8000-000000000009','64000000-1000-4000-8000-000000000002','64000000-7300-4000-8000-000000000002','64000000-5000-4000-8000-000000000009','test.import');
-- One shipment per order, plus a foreign-workspace shipment.
insert into public.acquisition_shipments(id,workspace_id,public_id,acquisition_order_id,carrier,tracking_number,status,create_idempotency_key,create_fingerprint,created_by) values
 ('64000000-7500-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-ASHIP-64A001','64000000-7200-4000-8000-000000000001','ups','1Z64A0001','in_transit','s21-ship-a1',repeat('3',64),'64000000-0000-4000-8000-000000000001'),
 ('64000000-7500-4000-8000-000000000003','64000000-1000-4000-8000-000000000001','RV-ASHIP-64A002','64000000-7200-4000-8000-000000000003','ups','1Z64A0002','in_transit','s21-ship-a2',repeat('4',64),'64000000-0000-4000-8000-000000000001'),
 ('64000000-7500-4000-8000-000000000002','64000000-1000-4000-8000-000000000002','RV-ASHIP-64F001','64000000-7200-4000-8000-000000000002','ups','1Z64F0001','in_transit','s21-ship-f1',repeat('5',64),'64000000-0000-4000-8000-000000000004');
set local session_replication_role=origin;

-- Freeze the EXPECTED side so any later mutation of it is provable.
create temporary table s21_expected as
  select id, quantity, source_record_id from public.acquisition_line_items
   where workspace_id='64000000-1000-4000-8000-000000000001';
create temporary table s21_shipments as
  select id, status, carrier, tracking_number, received_at, shipped_at
    from public.acquisition_shipments
   where workspace_id='64000000-1000-4000-8000-000000000001';

-- Real governed inventory subjects are selected, not fabricated by receiving.
insert into public.product_catalog(id,workspace_id,public_id,business_vertical,display_name,product_canonical_key,created_by_process) values('65000000-9000-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-PROD-S2TEST1','other','Known fixture product','known-s2-product','test.fixture');
insert into public.sellable_skus(id,workspace_id,public_id,product_id,business_vertical,fingerprint,created_by_process) values('65000000-9100-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-SKU-S2TEST1','65000000-9000-4000-8000-000000000001','other',repeat('a',64),'test.fixture');
insert into public.inventory_lots(id,workspace_id,public_id,sku_id,tracking_mode,quantity,created_by_process) values('65000000-9200-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-C-650001','65000000-9100-4000-8000-000000000001','lot_managed',10,'test.fixture');
insert into public.inventory_lots(id,workspace_id,public_id,sku_id,tracking_mode,quantity,created_by_process) values('65000000-9200-4000-8000-000000000002','64000000-1000-4000-8000-000000000001','RV-C-650002','65000000-9100-4000-8000-000000000001','lot_managed',10,'test.fixture');
-- Serialized inventory fixtures use the governed Product -> SKU -> Lot -> Item model.
insert into public.inventory_lots(id,workspace_id,public_id,sku_id,tracking_mode,quantity,created_by_process) values
 ('66000000-9200-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-C-660001','65000000-9100-4000-8000-000000000001','serialized',2,'test.fixture');
insert into public.inventory_items(id,workspace_id,public_id,lot_id,sku_id,scan_sku,serial_number,created_by_process) values
 ('66000000-9300-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','RV-ITEM-S2H001','66000000-9200-4000-8000-000000000001','65000000-9100-4000-8000-000000000001','RV-7K3F9Q2','S2-H-1','test.fixture'),
 ('66000000-9300-4000-8000-000000000002','64000000-1000-4000-8000-000000000001','RV-ITEM-S2H002','66000000-9200-4000-8000-000000000001','65000000-9100-4000-8000-000000000001','RV-8K3F9Q2','S2-H-2','test.fixture');
commit;

create function pg_temp.auth(p_uid uuid) returns void language plpgsql as $$begin perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,false); end$$;
select pg_temp.auth('64000000-0000-4000-8000-000000000002');

-- Regression, cancellation, recovery, and replay contract.
create temporary table s22_ids(k text primary key,v text);
insert into s22_ids select 'open_receipt',public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,'2026-08-09T10:00:00Z','hardening open','hardening-open-0001')->>'receiptPublicId';
insert into s22_ids select 'open_line',public.record_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='open_receipt'),'SRC-64-A','LINE-64-A1',5,'five')->>'receiptLinePublicId';
select throws_ok(format('select public.link_acquisition_receipt_inventory(%L,%L,%L,null,5)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='open_line'),'RV-C-650001'),'55000','receipt_not_submitted','links cannot precede submission');
select is((public.correct_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='open_line'),5,4,'count corrected')->>'quantityReceived'),'4','open correction remains legal before any link');
select is((public.cancel_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='open_receipt'),'abandoned duplicate box')->>'status'),'cancelled','operator can cancel an open receipt with reason');
select is((public.cancel_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='open_receipt'),'abandoned duplicate box')->>'replayed'),'true','exact cancellation replays');
select throws_ok(format('select public.cancel_acquisition_receipt(%L,%L,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='open_receipt'),'changed reason'),'23505','idempotency_conflict','changed cancellation reason conflicts');
select is((select count(*)::int from public.acquisition_receipt_line_inventory_links k join public.acquisition_receipt_lines l on l.id=k.acquisition_receipt_line_id join public.acquisition_receipts r on r.id=l.acquisition_receipt_id where r.status='cancelled'),0,'cancelled evidence has no inventory-origin link');
select is((select count(*)::int from public.audit_events where event_type='acquisition_receipt_cancelled'),1,'cancellation audits exactly once');

-- Submitted link can be governed-unlinked, retried, and linked correctly.
insert into s22_ids select 'recover_receipt',public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,'2026-08-09T11:00:00Z','recovery','hardening-recover-01')->>'receiptPublicId';
insert into s22_ids select 'recover_line',public.record_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='recover_receipt'),'SRC-64-A','LINE-64-A2',4,'four')->>'receiptLinePublicId';
select public.submit_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='recover_receipt'));
insert into s22_ids select 'wrong_link',public.link_acquisition_receipt_inventory('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='recover_line'),'RV-C-650001',null,4)->>'inventoryLinkPublicId';
select is((public.unlink_acquisition_receipt_inventory('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='wrong_link'),'wrong lot selected')->>'replayed'),'false','governed wrong-link recovery applies before reconciliation');
select is((public.unlink_acquisition_receipt_inventory('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='wrong_link'),'wrong lot selected')->>'replayed'),'true','unlink response-loss retry replays');
select throws_ok(format('select public.unlink_acquisition_receipt_inventory(%L,%L,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='wrong_link'),'different reason'),'23505','idempotency_conflict','changed unlink reason conflicts');
select is((select count(*)::int from public.audit_events where event_type='acquisition_receipt_inventory_unlinked'),1,'unlink audits once');
select lives_ok(format('select public.link_acquisition_receipt_inventory(%L,%L,%L,null,4)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='recover_line'),'RV-C-650002'),'correct inventory subject can be linked after recovery');

-- Below-function immutability.
select set_config('app.governed_receiving_mutation','on',false);
select throws_ok(format('delete from public.acquisition_receipt_lines where public_id=%L',(select v from s22_ids where k='recover_line')),'55000','receipt_not_open','submitted receipt line cannot be deleted');
select throws_ok(format('update public.acquisition_receipt_lines set acquisition_line_item_id=%L where public_id=%L','64000000-5000-4000-8000-000000000003',(select v from s22_ids where k='recover_line')),'23514','receipt_line_conflict','receipt line cannot swap acquisition evidence');
select throws_ok($$update public.acquisition_receipt_line_inventory_links set acquisition_receipt_line_id=(select id from public.acquisition_receipt_lines where public_id=(select v from s22_ids where k='open_line'))$$,'55000','inventory_link_immutable','inventory link cannot be reparented');
select throws_ok($$update public.acquisition_receipt_line_inventory_links set quantity_linked=3$$,'55000','inventory_link_immutable','inventory provenance quantity cannot be rewritten');

-- Discrepancy evidence and state graph.
select pg_temp.auth('64000000-0000-4000-8000-000000000002');
insert into s22_ids select 'disc',public.raise_acquisition_discrepancy('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,null,'never_arrived',10,0,'carrier never delivered')->>'discrepancyPublicId';
select set_config('app.governed_receiving_mutation','on',false);
select throws_ok(format('update public.acquisition_discrepancies set detail=%L,quantity_expected=999 where public_id=%L','rewritten',(select v from s22_ids where k='disc')),'55000','discrepancy_evidence_immutable','privileged SQL cannot rewrite discrepancy evidence');
select pg_temp.auth('64000000-0000-4000-8000-000000000002');
select is((public.transition_acquisition_discrepancy('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='disc'),'claimed',null)->>'status'),'claimed','operator may claim discrepancy');
select throws_ok(format('select public.transition_acquisition_discrepancy(%L,%L,%L,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='disc'),'resolved','owner decision'),'42501','insufficient role for this operation','operator cannot resolve');
select pg_temp.auth('64000000-0000-4000-8000-000000000001');
select is((public.transition_acquisition_discrepancy('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='disc'),'resolved','carrier claim paid')->>'status'),'resolved','owner resolves with note');
select is((public.transition_acquisition_discrepancy('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='disc'),'resolved','carrier claim paid')->>'replayed'),'true','exact terminal discrepancy replay succeeds');
select throws_ok(format('select public.transition_acquisition_discrepancy(%L,%L,%L,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='disc'),'resolved','changed note'),'23505','idempotency_conflict','changed terminal resolution note conflicts');
select throws_ok(format('select public.transition_acquisition_discrepancy(%L,%L,%L,null)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='disc'),'claimed'),'23514','invalid_transition','terminal discrepancy cannot reverse');
select ok((select resolved_by is not null and resolved_at is not null from public.acquisition_discrepancies where public_id=(select v from s22_ids where k='disc')),'terminal discrepancy records resolver and time');

-- Authorization and direct authenticated table-write matrix.
select pg_temp.auth('64000000-0000-4000-8000-000000000003');
select throws_ok($$select public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,now(),null,'viewer-denied-01')$$,'42501','insufficient role for this operation','viewer cannot mutate receiving');
select set_config('request.jwt.claims','{}',false);
select throws_ok($$select public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,now(),null,'anon-denied-0001')$$,'42501','authentication required','anonymous cannot mutate receiving');
select ok((select bool_and(not has_table_privilege('authenticated',format('public.%I',t),'insert')) from unnest(array['acquisition_receipts','acquisition_receipt_lines','acquisition_discrepancies','acquisition_receipt_line_inventory_links']) t),'authenticated has no direct INSERT on every receiving table');
select ok((select bool_and(not has_table_privilege('authenticated',format('public.%I',t),'update')) from unnest(array['acquisition_receipts','acquisition_receipt_lines','acquisition_discrepancies','acquisition_receipt_line_inventory_links']) t),'authenticated has no direct UPDATE on every receiving table');
select ok((select bool_and(not has_table_privilege('authenticated',format('public.%I',t),'delete')) from unnest(array['acquisition_receipts','acquisition_receipt_lines','acquisition_discrepancies','acquisition_receipt_line_inventory_links']) t),'authenticated has no direct DELETE on every receiving table');
select ok((select bool_and(not has_table_privilege('authenticated',format('public.%I',t),'truncate')) from unnest(array['acquisition_receipts','acquisition_receipt_lines','acquisition_discrepancies','acquisition_receipt_line_inventory_links']) t),'authenticated has no direct TRUNCATE on every receiving table');

-- Wrong-order and excluded-line boundaries execute the real public function.
select pg_temp.auth('64000000-0000-4000-8000-000000000002');
insert into s22_ids select 'target_receipt',public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A002',null,now(),'wrong target tests','hardening-target-01')->>'receiptPublicId';
select throws_ok(format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,1,null)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='target_receipt'),'SRC-64-A','LINE-64-A1'),'23514','acquisition_line_not_in_receipt_order','same-workspace line from wrong order is rejected');
select pg_temp.auth('64000000-0000-4000-8000-000000000001');
select public.exclude_acquisition_line_by_source('64000000-1000-4000-8000-000000000001','SRC-64-A','LINE-64-A3','not inventory','hardening-exclude-01');
select pg_temp.auth('64000000-0000-4000-8000-000000000002');
select throws_ok(format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,1,null)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='recover_receipt'),'SRC-64-A','LINE-64-A3'),'55000','receipt_not_open','submitted parent fails closed before downstream evaluation');
insert into s22_ids select 'eligible_receipt',public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,now(),'eligibility','hardening-eligible-01')->>'receiptPublicId';
select throws_ok(format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,1,null)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='eligible_receipt'),'SRC-64-A','LINE-64-A3'),'23514','acquisition_line_excluded','excluded line fails through downstream eligibility contract');
select pg_temp.auth('64000000-0000-4000-8000-000000000001');
select public.restore_acquisition_line_by_source('64000000-1000-4000-8000-000000000001','SRC-64-A','LINE-64-A3','race fixture','hardening-restore-01');

-- Serialized receipt links two distinct real Item children and rejects masquerades/duplicates.
select pg_temp.auth('64000000-0000-4000-8000-000000000002');
insert into s22_ids select 'serial_receipt',public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,now(),'serialized','hardening-serial-01')->>'receiptPublicId';
insert into s22_ids select 'serial_line',public.record_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='serial_receipt'),'SRC-64-A','LINE-64-A3',2,'two serials')->>'receiptLinePublicId';
select public.submit_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='serial_receipt'));
select lives_ok(format('select public.link_acquisition_receipt_inventory(%L,%L,null,%L,1)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='serial_line'),'RV-ITEM-S2H001'),'first serialized item links at quantity one');
select lives_ok(format('select public.link_acquisition_receipt_inventory(%L,%L,null,%L,1)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='serial_line'),'RV-ITEM-S2H002'),'second serialized item links at quantity one');
select throws_ok(format('select public.link_acquisition_receipt_inventory(%L,%L,null,%L,2)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='serial_line'),'RV-ITEM-S2H001'),'23505','receipt_line_conflict','serialized replay cannot change quantity');
select is((select sum(quantity_linked)::int from public.acquisition_receipt_line_inventory_links where acquisition_receipt_line_id=(select id from public.acquisition_receipt_lines where public_id=(select v from s22_ids where k='serial_line'))),2,'serialized exact total satisfies receipt quantity');
select is((select tracking_mode::text from public.inventory_lots where id='66000000-9200-4000-8000-000000000001'),'serialized','serialized subjects belong to a serialized lot');
select pg_temp.auth('64000000-0000-4000-8000-000000000001');
select is((public.reconcile_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='serial_receipt'))->>'status'),'reconciled','serialized exact total reconciles');

-- Genuine two-backend race harness.  Every race sends both requests before
-- await_all or dblink_get_result is called.
create function pg_temp.await_all(p_conns text[],p_seconds numeric default 15) returns void language plpgsql as $$declare started timestamptz:=clock_timestamp();c text;busy boolean;begin loop busy:=false;foreach c in array p_conns loop busy:=busy or dblink_is_busy(c)=1;end loop;exit when not busy;if clock_timestamp()-started>make_interval(secs=>p_seconds) then raise exception 'S2.2 race deadline' using errcode='55P03';end if;perform pg_sleep(.02);end loop;end$$;
create function public.s22_try(p_sql text) returns text language plpgsql as $$declare r text;begin execute p_sql into r;return coalesce(r,'null');exception when others then return 'ERR:'||sqlstate;end$$;
create temporary table s22_conn(dsn text); insert into s22_conn values(case when current_setting('is_superuser')='on' then 'dbname='||current_database()
 else format('host=%s port=%s dbname=%s user=postgres password=postgres',coalesce(host(inet_server_addr()),'127.0.0.1'),coalesce(inet_server_port()::text,current_setting('port')),current_database()) end);
create function pg_temp.auth_sql(p_uid uuid,p_call text) returns text language sql as $$select format($q$with s as materialized(select set_config('statement_timeout','8s',false),set_config('lock_timeout','6s',false),set_config('request.jwt.claims',%L,false)) select (%s)::text from s$q$,json_build_object('sub',p_uid,'role','authenticated')::text,p_call)$$;
create function pg_temp.race(p_name text,p_uid1 uuid,p_left text,p_uid2 uuid,p_right text) returns text[] language plpgsql as $$declare cs text[]:=array[p_name||'_1',p_name||'_2'];a text;b text;begin perform dblink_connect(cs[1],(select dsn from s22_conn));perform dblink_connect(cs[2],(select dsn from s22_conn));perform dblink_send_query(cs[1],pg_temp.auth_sql(p_uid1,p_left));perform dblink_send_query(cs[2],pg_temp.auth_sql(p_uid2,p_right));perform pg_temp.await_all(cs);select result into a from dblink_get_result(cs[1]) t(result text);select result into b from dblink_get_result(cs[2]) t(result text);perform dblink_disconnect(cs[1]);perform dblink_disconnect(cs[2]);return array[a,b];exception when others then begin perform dblink_disconnect(cs[1]);exception when others then null;end;begin perform dblink_disconnect(cs[2]);exception when others then null;end;raise;end$$;
create temporary table s22_races(name text primary key,result text[]);

-- A same receipt create.
insert into s22_races select 'same_create',pg_temp.race('s22_a','64000000-0000-4000-8000-000000000002',$$public.s22_try($x$select public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,'2026-08-10','race same','race-same-create')$x$)$$,'64000000-0000-4000-8000-000000000002',$$public.s22_try($x$select public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,'2026-08-10','race same','race-same-create')$x$)$$);
select is((select count(*)::int from public.acquisition_receipts where create_idempotency_key='race-same-create'),1,'race A creates one receipt');
select is((select count(*)::int from unnest((select result from s22_races where name='same_create')) x where x like 'ERR:%'),0,'race A gives both callers semantic success');
-- B conflicting create.
insert into s22_races select 'conflict_create',pg_temp.race('s22_b','64000000-0000-4000-8000-000000000002',$$public.s22_try($x$select public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,'2026-08-10','winner A','race-conflict-create')$x$)$$,'64000000-0000-4000-8000-000000000002',$$public.s22_try($x$select public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,'2026-08-10','winner B','race-conflict-create')$x$)$$);
select is((select count(*)::int from unnest((select result from s22_races where name='conflict_create')) x where x='ERR:23505'),1,'race B has one bounded idempotency loser');
select is((select count(*)::int from public.acquisition_receipts where create_idempotency_key='race-conflict-create'),1,'race B leaves one receipt');
-- Prepare receipt for line races.
select pg_temp.auth('64000000-0000-4000-8000-000000000002');insert into s22_ids select 'line_race_receipt',public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,now(),'line races','race-lines-parent')->>'receiptPublicId';
-- C same line.
insert into s22_races select 'same_line',pg_temp.race('s22_c','64000000-0000-4000-8000-000000000002',format('public.s22_try(%L)',format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,3,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='line_race_receipt'),'SRC-64-A','LINE-64-A1','same')),'64000000-0000-4000-8000-000000000002',format('public.s22_try(%L)',format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,3,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='line_race_receipt'),'SRC-64-A','LINE-64-A1','same')));
select is((select count(*)::int from public.acquisition_receipt_lines l join public.acquisition_receipts r on r.id=l.acquisition_receipt_id where r.public_id=(select v from s22_ids where k='line_race_receipt') and l.acquisition_line_item_id='64000000-5000-4000-8000-000000000001'),1,'race C leaves one line');
select is((select count(*)::int from unnest((select result from s22_races where name='same_line')) x where x like 'ERR:%'),0,'race C identical callers both succeed');
-- D different line payload.
insert into s22_races select 'different_line',pg_temp.race('s22_d','64000000-0000-4000-8000-000000000002',format('public.s22_try(%L)',format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,3,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='line_race_receipt'),'SRC-64-A','LINE-64-A2','A')),'64000000-0000-4000-8000-000000000002',format('public.s22_try(%L)',format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,4,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='line_race_receipt'),'SRC-64-A','LINE-64-A2','B')));
select is((select count(*)::int from unnest((select result from s22_races where name='different_line')) x where x='ERR:23505'),1,'race D refuses one changed payload');
select is((select count(*)::int from public.acquisition_receipt_lines l join public.acquisition_receipts r on r.id=l.acquisition_receipt_id where r.public_id=(select v from s22_ids where k='line_race_receipt') and l.acquisition_line_item_id='64000000-5000-4000-8000-000000000002'),1,'race D leaves one coherent line');
-- E correction versus submit.
insert into s22_ids select 'race_e_line',public.record_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='line_race_receipt'),'SRC-64-A','LINE-64-A3',2,'E')->>'receiptLinePublicId';
insert into s22_races select 'correct_submit',pg_temp.race('s22_e','64000000-0000-4000-8000-000000000002',format('public.s22_try(%L)',format('select public.correct_acquisition_receipt_line(%L,%L,2,3,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_e_line'),'race correction')),'64000000-0000-4000-8000-000000000002',format('public.s22_try(%L)',format('select public.submit_acquisition_receipt(%L,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='line_race_receipt'))));
select is((select count(*)::int from unnest((select result from s22_races where name='correct_submit')) x where x='ERR:40P01'),0,'race E has no deadlock');
select ok((select status='submitted' from public.acquisition_receipts where public_id=(select v from s22_ids where k='line_race_receipt')),'race E ends submitted without post-submit correction');
-- F joint over-link.
insert into s22_ids select 'race_f_receipt',public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,now(),'link race','race-link-parent')->>'receiptPublicId';insert into s22_ids select 'race_f_line',public.record_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_f_receipt'),'SRC-64-A','LINE-64-A1',5,'F')->>'receiptLinePublicId';select public.submit_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_f_receipt'));
insert into s22_races select 'overlink',pg_temp.race('s22_f','64000000-0000-4000-8000-000000000002',format('public.s22_try(%L)',format('select public.link_acquisition_receipt_inventory(%L,%L,%L,null,3)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_f_line'),'RV-C-650001')),'64000000-0000-4000-8000-000000000002',format('public.s22_try(%L)',format('select public.link_acquisition_receipt_inventory(%L,%L,%L,null,3)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_f_line'),'RV-C-650002')));
select is((select count(*)::int from unnest((select result from s22_races where name='overlink')) x where x='ERR:23514'),1,'race F refuses one jointly excessive link');
select ok((select coalesce(sum(quantity_linked),0)<=5 from public.acquisition_receipt_line_inventory_links where acquisition_receipt_line_id=(select id from public.acquisition_receipt_lines where public_id=(select v from s22_ids where k='race_f_line'))),'race F conserves linked quantity');
-- G double reconcile.
insert into s22_ids select 'race_g_receipt',public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,now(),'reconcile race','race-reconcile-parent')->>'receiptPublicId';insert into s22_ids select 'race_g_line',public.record_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_g_receipt'),'SRC-64-A','LINE-64-A2',4,'G')->>'receiptLinePublicId';select public.submit_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_g_receipt'));select public.link_acquisition_receipt_inventory('64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_g_line'),'RV-C-650001',null,4);select public.raise_acquisition_discrepancy('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',(select v from s22_ids where k='race_g_receipt'),(select v from s22_ids where k='race_g_line'),'over_shipped',4,4,'prior receipts make cumulative quantity exceed source expectation');
insert into s22_races select 'reconcile',pg_temp.race('s22_g','64000000-0000-4000-8000-000000000001',format('public.s22_try(%L)',format('select public.reconcile_acquisition_receipt(%L,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_g_receipt'))),'64000000-0000-4000-8000-000000000001',format('public.s22_try(%L)',format('select public.reconcile_acquisition_receipt(%L,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_g_receipt'))));
select is((select count(*)::int from unnest((select result from s22_races where name='reconcile')) x where x like 'ERR:%'),0,'race G both callers succeed/replay');
select is((select count(*)::int from public.audit_events a join public.acquisition_receipts r on r.id=a.subject_id where r.public_id=(select v from s22_ids where k='race_g_receipt') and a.event_type='acquisition_receipt_reconciled'),1,'race G audits one reconcile');
-- H exclusion versus receiving uses the identical :exclusion-line: advisory identity.
insert into s22_ids select 'race_h_receipt',public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,now(),'exclusion race','race-exclusion-parent')->>'receiptPublicId';
insert into s22_races select 'exclude_receive',pg_temp.race('s22_h','64000000-0000-4000-8000-000000000001',$$public.s22_try($x$select public.exclude_acquisition_line_by_source('64000000-1000-4000-8000-000000000001','SRC-64-A','LINE-64-A3','race exclusion','race-exclusion-key')$x$)$$,'64000000-0000-4000-8000-000000000002',format('public.s22_try(%L)',format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,1,%L)','64000000-1000-4000-8000-000000000001',(select v from s22_ids where k='race_h_receipt'),'SRC-64-A','LINE-64-A3','race receive')));
select ok((select count(*) from unnest((select result from s22_races where name='exclude_receive')) x where x like 'ERR:%')<=1,'race H has at most one bounded loser');
select ok(not exists(select 1 from public.acquisition_receipt_lines l join public.acquisition_receipts r on r.id=l.acquisition_receipt_id join public.acquisition_line_exclusions e on e.acquisition_line_item_id=l.acquisition_line_item_id and e.decision_state='excluded' and e.superseded_at is null where r.public_id=(select v from s22_ids where k='race_h_receipt') and l.created_at>e.created_at),'race H never inserts after an exclusion won the shared lock');
select is((select count(*)::int from public.schema_migrations_log where migration_name='20260809000100_s2_receiving_acceptance_hardening'),1,'hardening migration logged exactly once');
select is((select count(*)::int from s22_races),8,'all eight race harnesses executed');
select is((select count(*)::int from s22_races where cardinality(result)=2),8,'every race collected two dispatched backend outcomes');
drop function public.s22_try(text);
select * from finish();
