begin;
create extension if not exists pgtap;
select plan(25);
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
select pg_temp.as_user('64000000-0000-4000-8000-000000000002');
create temporary table result(v jsonb);
insert into result select public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001','RV-ASHIP-64A001','2026-08-08T10:00:00Z','box intact','s22-open-0001');
select matches(v->>'receiptPublicId','^RV-ARCPT-[A-Z0-9]{12}$','operator opens a governed receipt') from result;
select is(v->>'replayed','false','first open applies') from result;
select is((select count(*)::int from public.audit_events where event_type='acquisition_receipt_opened'),1,'open audits once');
select is((public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001','RV-ASHIP-64A001','2026-08-08T10:00:00Z','box intact','s22-open-0001')->>'replayed'),'true','open replays');
select is((select count(*)::int from public.audit_events where event_type='acquisition_receipt_opened'),1,'open replay does not audit');
select throws_ok($$select public.open_acquisition_receipt('64000000-1000-4000-8000-000000000001','RV-ACQ-64A001',null,'2026-08-08T10:00:00Z','changed','s22-open-0001')$$,'23505','idempotency_conflict','changed open conflicts');
select lives_ok(format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,4,%L)','64000000-1000-4000-8000-000000000001',(select v->>'receiptPublicId' from result),'SRC-64-A','LINE-64-A1','first count'),'line A is recorded through the public function');
select lives_ok(format('select public.record_acquisition_receipt_line(%L,%L,%L,%L,4,%L)','64000000-1000-4000-8000-000000000001',(select v->>'receiptPublicId' from result),'SRC-64-A','LINE-64-A2','second count'),'line B is recorded through the public function');
select is((select count(*)::int from public.acquisition_receipt_lines),2,'both lines belong to the receipt order');
select is((select public.correct_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',public_id,4,5,'recounted physical units')->>'quantityReceived' from public.acquisition_receipt_lines where acquisition_line_item_id='64000000-5000-4000-8000-000000000001'),'5','explicit correction applies');
select is((select public.correct_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',public_id,4,5,'recounted physical units')->>'replayed' from public.acquisition_receipt_lines where acquisition_line_item_id='64000000-5000-4000-8000-000000000001'),'true','correction response-loss retry replays');
select is((select count(*)::int from public.audit_events where event_type='acquisition_receipt_line_corrected'),1,'correction audits once');
select is((public.submit_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v->>'receiptPublicId' from result))->>'status'),'submitted','operator submits');
select throws_ok($$select public.correct_acquisition_receipt_line('64000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_receipt_lines limit 1),4,3,'late')$$,'55000','receipt_not_open','submitted lines freeze');
select lives_ok($$select public.link_acquisition_receipt_inventory('64000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_receipt_lines where acquisition_line_item_id='64000000-5000-4000-8000-000000000001'),'RV-C-650001',null,5)$$,'line A links exactly to governed lot');
select lives_ok($$select public.link_acquisition_receipt_inventory('64000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_receipt_lines where acquisition_line_item_id='64000000-5000-4000-8000-000000000002'),'RV-C-650001',null,4)$$,'line B may contribute its own exact layer to the lot');
reset role;
select throws_ok($$insert into public.acquisition_receipt_line_inventory_links(workspace_id,acquisition_receipt_line_id,inventory_lot_id,quantity_linked,created_by) values('64000000-1000-4000-8000-000000000001',(select id from public.acquisition_receipt_lines where acquisition_line_item_id='64000000-5000-4000-8000-000000000001'),'65000000-9200-4000-8000-000000000002',1,'64000000-0000-4000-8000-000000000002')$$,'23514','inventory_link_over_capacity','over-link is rejected below API');
select pg_temp.as_user('64000000-0000-4000-8000-000000000001');
select is((public.reconcile_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v->>'receiptPublicId' from result))->>'status'),'reconciled','owner reconciles exact links');
select is((public.reconcile_acquisition_receipt('64000000-1000-4000-8000-000000000001',(select v->>'receiptPublicId' from result))->>'replayed'),'true','reconcile replays');
select is((select count(*)::int from public.audit_events where event_type='acquisition_receipt_reconciled'),1,'reconcile audits once');
reset role;
select set_config('app.governed_receiving_mutation','on',true);
select throws_ok($$delete from public.acquisition_receipt_line_inventory_links$$,'55000','receipt_terminal','reconciled links freeze');
select is((select quantity from public.acquisition_line_items where id='64000000-5000-4000-8000-000000000001'),10,'source expected quantity is untouched');
select is((select status::text from public.acquisition_shipments where id='64000000-7500-4000-8000-000000000001'),'in_transit','shipment transport truth is untouched');
select is((select count(*)::int from public.schema_migrations_log where migration_name='20260808000100_s2_receiving_functions'),1,'migration ledger records S2.2 once');
select ok(not has_table_privilege('authenticated','public.acquisition_receipt_line_inventory_links','insert'),'authenticated has no direct write grant');
select * from finish();
rollback;
