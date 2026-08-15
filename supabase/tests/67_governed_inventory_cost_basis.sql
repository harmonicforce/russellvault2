begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(41);
create function pg_temp.h(p_seed text) returns text language sql immutable as $$select encode(sha256(p_seed::bytea),'hex')$$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$begin perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true); execute 'set local role authenticated'; end$$;
insert into auth.users(id,email) values
 ('68000000-0000-4000-8000-000000000001','owner67@example.test'),
 ('68000000-0000-4000-8000-000000000002','operator67@example.test'),
 ('68000000-0000-4000-8000-000000000003','viewer67@example.test'),
 ('68000000-0000-4000-8000-000000000004','ownerf67@example.test');
insert into public.workspaces(id,name,created_by) values
 ('68000000-1000-4000-8000-000000000001','S2.1 receiving','68000000-0000-4000-8000-000000000001'),
 ('68000000-1000-4000-8000-000000000002','S2.1 foreign','68000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('68000000-1000-4000-8000-000000000001','68000000-0000-4000-8000-000000000002','operator'),
 ('68000000-1000-4000-8000-000000000001','68000000-0000-4000-8000-000000000003','viewer');
insert into public.source_systems(id,workspace_id,public_id,kind,instance_label,created_by) values
 ('68000000-2000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','SRC-64-A','manual','A source','68000000-0000-4000-8000-000000000001'),
 ('68000000-2000-4000-8000-000000000002','68000000-1000-4000-8000-000000000002','SRC-64-F','manual','foreign source','68000000-0000-4000-8000-000000000004');
insert into public.import_jobs(id,workspace_id,public_id,source_system_id,source_label,file_sha256,content_sha256,parser_version,mapping_version,idempotency_key,mode,status,source_row_count,accepted_row_count,issue_row_count,source_totals,actor_user_id,actor_process) values
 ('68000000-3000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','IMP-64-A','68000000-2000-4000-8000-000000000001','fixture',repeat('a',64),repeat('b',64),'1.0.0','1.0.0','s21-recv-a','commit','preview',3,0,0,'{}','68000000-0000-4000-8000-000000000001','test.import'),
 ('68000000-3000-4000-8000-000000000002','68000000-1000-4000-8000-000000000002','IMP-64-F','68000000-2000-4000-8000-000000000002','fixture',repeat('c',64),repeat('d',64),'1.0.0','1.0.0','s21-recv-f','commit','preview',1,0,0,'{}','68000000-0000-4000-8000-000000000004','test.import');
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process)
select ('68000000-5100-4000-8000-00000000000'||n)::uuid,'68000000-1000-4000-8000-000000000001','68000000-3000-4000-8000-000000000001',n-1,'a-row-'||n,
 jsonb_build_object('product_name','sealed case '||n),pg_temp.h('a-row-'||n),'parsed','{}','1.0.0','1.0.0','test.import'
from generate_series(1,3) n;
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process) values
 ('68000000-5100-4000-8000-000000000009','68000000-1000-4000-8000-000000000002','68000000-3000-4000-8000-000000000002',0,'f-row-1','{"product_name":"foreign line"}',pg_temp.h('f-row-1'),'parsed','{}','1.0.0','1.0.0','test.import');
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=3 where id='68000000-3000-4000-8000-000000000001';
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=1 where id='68000000-3000-4000-8000-000000000002';
insert into public.channels(id,workspace_id,public_id,name,kind,created_by) values
 ('68000000-6000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-CH-64A001','A channel','manual','68000000-0000-4000-8000-000000000001'),
 ('68000000-6000-4000-8000-000000000002','68000000-1000-4000-8000-000000000002','RV-CH-64F001','F channel','manual','68000000-0000-4000-8000-000000000004');
insert into public.suppliers(id,workspace_id,public_id,display_name,created_by_process) values
 ('68000000-7000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-SUP-64A001','A seller','test.import'),
 ('68000000-7000-4000-8000-000000000002','68000000-1000-4000-8000-000000000002','RV-SUP-64F001','Foreign seller','test.import');
insert into public.acquisition_import_jobs(id,workspace_id,channel_id,source_import_job_id,idempotency_key,mode,status,expected_line_count,mapping_version,plan_sha256,actor_user_id,actor_process) values
 ('68000000-4000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','68000000-6000-4000-8000-000000000001','68000000-3000-4000-8000-000000000001','s21-acq-a','commit','preview',3,'1.0.0',repeat('1',64),'68000000-0000-4000-8000-000000000001','test.import'),
 ('68000000-4000-4000-8000-000000000002','68000000-1000-4000-8000-000000000002','68000000-6000-4000-8000-000000000002','68000000-3000-4000-8000-000000000002','s21-acq-f','commit','preview',1,'1.0.0',repeat('2',64),'68000000-0000-4000-8000-000000000004','test.import');
-- Line 1 expects 10 units (the partial-receiving subject), lines 2 and 3 expect
-- 4 and 7 (the multi-line receipt subjects).
insert into public.acquisition_line_items(id,workspace_id,public_id,source_system_id,source_record_id,acquisition_import_job_id,quantity,description,source_detail,created_by_process) values
 ('68000000-5000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','LINE-64-A1','68000000-2000-4000-8000-000000000001','68000000-5100-4000-8000-000000000001','68000000-4000-4000-8000-000000000001',10,'sealed case 1','{}','test.import'),
 ('68000000-5000-4000-8000-000000000002','68000000-1000-4000-8000-000000000001','LINE-64-A2','68000000-2000-4000-8000-000000000001','68000000-5100-4000-8000-000000000002','68000000-4000-4000-8000-000000000001',3,'sealed case 2','{}','test.import'),
 ('68000000-5000-4000-8000-000000000003','68000000-1000-4000-8000-000000000001','LINE-64-A3','68000000-2000-4000-8000-000000000001','68000000-5100-4000-8000-000000000003','68000000-4000-4000-8000-000000000001',7,'sealed case 3','{}','test.import'),
 ('68000000-5000-4000-8000-000000000009','68000000-1000-4000-8000-000000000002','LINE-64-F1','68000000-2000-4000-8000-000000000002','68000000-5100-4000-8000-000000000009','68000000-4000-4000-8000-000000000002',1,'foreign line','{}','test.import');
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=3,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='68000000-4000-4000-8000-000000000001';
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=1,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='68000000-4000-4000-8000-000000000002';
set local session_replication_role=replica;
-- Two orders in workspace A: the second exists so a receipt can be proven
-- unable to borrow another order's shipment.
insert into public.acquisition_orders(id,workspace_id,public_id,channel_id,supplier_id,source_system_id,acquisition_import_job_id,source_order_reference,first_source_record_id,order_status,occurred_at,created_by_process) values
 ('68000000-7200-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-ACQ-64A001','68000000-6000-4000-8000-000000000001','68000000-7000-4000-8000-000000000001','68000000-2000-4000-8000-000000000001','68000000-4000-4000-8000-000000000001','ORDER-64-A1','68000000-5100-4000-8000-000000000001','unknown','2026-08-01T10:00:00Z','test.import'),
 ('68000000-7200-4000-8000-000000000003','68000000-1000-4000-8000-000000000001','RV-ACQ-64A002','68000000-6000-4000-8000-000000000001','68000000-7000-4000-8000-000000000001','68000000-2000-4000-8000-000000000001','68000000-4000-4000-8000-000000000001','ORDER-64-A2','68000000-5100-4000-8000-000000000002','unknown','2026-08-02T10:00:00Z','test.import'),
 ('68000000-7200-4000-8000-000000000002','68000000-1000-4000-8000-000000000002','RV-ACQ-64F001','68000000-6000-4000-8000-000000000002','68000000-7000-4000-8000-000000000002','68000000-2000-4000-8000-000000000002','68000000-4000-4000-8000-000000000002','ORDER-64-F1','68000000-5100-4000-8000-000000000009','unknown',null,'test.import');
insert into public.acquisition_lots(id,workspace_id,public_id,order_id,created_by_process) values
 ('68000000-7300-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-ALOT-64A001','68000000-7200-4000-8000-000000000001','test.import'),
 ('68000000-7300-4000-8000-000000000002','68000000-1000-4000-8000-000000000002','RV-ALOT-64F001','68000000-7200-4000-8000-000000000002','test.import');
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,sequence_no,created_by_process)
select ('68000000-7400-4000-8000-00000000000'||n)::uuid,'68000000-1000-4000-8000-000000000001','68000000-7300-4000-8000-000000000001',('68000000-5000-4000-8000-00000000000'||n)::uuid,n,'test.import'
from generate_series(1,3) n;
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,created_by_process) values
 ('68000000-7400-4000-8000-000000000009','68000000-1000-4000-8000-000000000002','68000000-7300-4000-8000-000000000002','68000000-5000-4000-8000-000000000009','test.import');
-- One shipment per order, plus a foreign-workspace shipment.
insert into public.acquisition_shipments(id,workspace_id,public_id,acquisition_order_id,carrier,tracking_number,status,create_idempotency_key,create_fingerprint,created_by) values
 ('68000000-7500-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-ASHIP-64A001','68000000-7200-4000-8000-000000000001','ups','1Z64A0001','in_transit','s21-ship-a1',repeat('3',64),'68000000-0000-4000-8000-000000000001'),
 ('68000000-7500-4000-8000-000000000003','68000000-1000-4000-8000-000000000001','RV-ASHIP-64A002','68000000-7200-4000-8000-000000000003','ups','1Z64A0002','in_transit','s21-ship-a2',repeat('4',64),'68000000-0000-4000-8000-000000000001'),
 ('68000000-7500-4000-8000-000000000002','68000000-1000-4000-8000-000000000002','RV-ASHIP-64F001','68000000-7200-4000-8000-000000000002','ups','1Z64F0001','in_transit','s21-ship-f1',repeat('5',64),'68000000-0000-4000-8000-000000000004');
set local session_replication_role=origin;

-- Freeze the EXPECTED side so any later mutation of it is provable.
create temporary table s21_expected as
  select id, quantity, source_record_id from public.acquisition_line_items
   where workspace_id='68000000-1000-4000-8000-000000000001';
create temporary table s21_shipments as
  select id, status, carrier, tracking_number, received_at, shipped_at
    from public.acquisition_shipments
   where workspace_id='68000000-1000-4000-8000-000000000001';

-- Real governed inventory subjects are selected, not fabricated by receiving.
insert into public.product_catalog(id,workspace_id,public_id,business_vertical,display_name,product_canonical_key,created_by_process) values('69000000-9000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-PROD-S2TEST1','other','Known fixture product','known-s2-product','test.fixture');
insert into public.sellable_skus(id,workspace_id,public_id,product_id,business_vertical,fingerprint,created_by_process) values('69000000-9100-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-SKU-S2TEST1','69000000-9000-4000-8000-000000000001','other',repeat('a',64),'test.fixture');
insert into public.inventory_lots(id,workspace_id,public_id,sku_id,tracking_mode,quantity,created_by_process) values('69000000-9200-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-C-650001','69000000-9100-4000-8000-000000000001','lot_managed',10,'test.fixture');
insert into public.inventory_lots(id,workspace_id,public_id,sku_id,tracking_mode,quantity,created_by_process) values('69000000-9200-4000-8000-000000000002','68000000-1000-4000-8000-000000000001','RV-C-650002','69000000-9100-4000-8000-000000000001','lot_managed',10,'test.fixture');
-- Serialized inventory fixtures use the governed Product -> SKU -> Lot -> Item model.
insert into public.inventory_lots(id,workspace_id,public_id,sku_id,tracking_mode,quantity,created_by_process) values
 ('6a000000-9200-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-C-660001','69000000-9100-4000-8000-000000000001','serialized',2,'test.fixture');
insert into public.inventory_items(id,workspace_id,public_id,lot_id,sku_id,scan_sku,serial_number,created_by_process) values
 ('6a000000-9300-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-ITEM-S2H001','6a000000-9200-4000-8000-000000000001','69000000-9100-4000-8000-000000000001','RV-7K3F9Q2','S2-H-1','test.fixture'),
 ('6a000000-9300-4000-8000-000000000002','68000000-1000-4000-8000-000000000001','RV-ITEM-S2H002','6a000000-9200-4000-8000-000000000001','69000000-9100-4000-8000-000000000001','RV-8K3F9Q2','S2-H-2','test.fixture');
commit;

begin;
create function pg_temp.auth(p_uid uuid) returns void language plpgsql as $$begin perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,false); end$$;
select pg_temp.auth('68000000-0000-4000-8000-000000000001');
set local session_replication_role=replica;
-- Three reconciled receipts: partial lot receipt, overreceipt, and serialized receipt.
insert into public.acquisition_receipts(id,workspace_id,public_id,acquisition_order_id,status,received_at,create_idempotency_key,create_fingerprint,created_by) values
 ('67000000-1000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-ARCPT-COST00000001','68000000-7200-4000-8000-000000000001','reconciled','2026-08-10','cost-receipt-0001',repeat('1',64),'68000000-0000-4000-8000-000000000001'),
 ('67000000-1000-4000-8000-000000000002','68000000-1000-4000-8000-000000000001','RV-ARCPT-COST00000002','68000000-7200-4000-8000-000000000001','reconciled','2026-08-11','cost-receipt-0002',repeat('2',64),'68000000-0000-4000-8000-000000000001'),
 ('67000000-1000-4000-8000-000000000003','68000000-1000-4000-8000-000000000001','RV-ARCPT-COST00000003','68000000-7200-4000-8000-000000000001','reconciled','2026-08-12','cost-receipt-0003',repeat('3',64),'68000000-0000-4000-8000-000000000001');
insert into public.acquisition_receipt_lines(id,workspace_id,public_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by) values
 ('67000000-2000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-ARL-COST00000001','67000000-1000-4000-8000-000000000001','68000000-5000-4000-8000-000000000001',6,'68000000-0000-4000-8000-000000000001'),
 ('67000000-2000-4000-8000-000000000002','68000000-1000-4000-8000-000000000001','RV-ARL-COST00000002','67000000-1000-4000-8000-000000000002','68000000-5000-4000-8000-000000000002',5,'68000000-0000-4000-8000-000000000001'),
 ('67000000-2000-4000-8000-000000000003','68000000-1000-4000-8000-000000000001','RV-ARL-COST00000003','67000000-1000-4000-8000-000000000003','68000000-5000-4000-8000-000000000003',2,'68000000-0000-4000-8000-000000000001');
insert into public.acquisition_receipt_line_inventory_links(id,workspace_id,public_id,acquisition_receipt_line_id,inventory_lot_id,inventory_item_id,quantity_linked,created_by) values
 ('67000000-3000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-ARIL-COST00000001','67000000-2000-4000-8000-000000000001','69000000-9200-4000-8000-000000000001',null,6,'68000000-0000-4000-8000-000000000001'),
 ('67000000-3000-4000-8000-000000000002','68000000-1000-4000-8000-000000000001','RV-ARIL-COST00000002','67000000-2000-4000-8000-000000000002','69000000-9200-4000-8000-000000000002',null,5,'68000000-0000-4000-8000-000000000001'),
 ('67000000-3000-4000-8000-000000000003','68000000-1000-4000-8000-000000000001','RV-ARIL-COST00000003','67000000-2000-4000-8000-000000000003',null,'6a000000-9300-4000-8000-000000000001',1,'68000000-0000-4000-8000-000000000001'),
 ('67000000-3000-4000-8000-000000000004','68000000-1000-4000-8000-000000000001','RV-ARIL-COST00000004','67000000-2000-4000-8000-000000000003',null,'6a000000-9300-4000-8000-000000000002',1,'68000000-0000-4000-8000-000000000001');
-- One submitted-only receipt is deliberately excluded.
insert into public.acquisition_receipts(id,workspace_id,public_id,acquisition_order_id,status,received_at,create_idempotency_key,create_fingerprint,created_by) values
 ('67000000-1000-4000-8000-000000000004','68000000-1000-4000-8000-000000000001','RV-ARCPT-COST00000004','68000000-7200-4000-8000-000000000001','submitted','2026-08-09','cost-receipt-0004',repeat('4',64),'68000000-0000-4000-8000-000000000001');
insert into public.acquisition_receipt_lines(id,workspace_id,public_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by) values
 ('67000000-2000-4000-8000-000000000004','68000000-1000-4000-8000-000000000001','RV-ARL-COST00000004','67000000-1000-4000-8000-000000000004','68000000-5000-4000-8000-000000000001',1,'68000000-0000-4000-8000-000000000001');
insert into public.acquisition_receipt_line_inventory_links(id,workspace_id,public_id,acquisition_receipt_line_id,inventory_lot_id,quantity_linked,created_by) values
 ('67000000-3000-4000-8000-000000000005','68000000-1000-4000-8000-000000000001','RV-ARIL-COST00000005','67000000-2000-4000-8000-000000000004','69000000-9200-4000-8000-000000000001',1,'68000000-0000-4000-8000-000000000001');
-- Direct, shared confirmed, candidate/reversed, discounts, and two currencies.
insert into public.acquisition_cost_components(id,workspace_id,public_id,line_item_id,order_id,component_type,amount_state,amount_minor,currency,attribution_state,acquisition_import_job_id,created_by_process) values
 ('67000000-4000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0001','68000000-5000-4000-8000-000000000001',null,'item_price','known',10000,'USD','direct','68000000-4000-4000-8000-000000000001','test.cost'),
 ('67000000-4000-4000-8000-000000000002','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0002','68000000-5000-4000-8000-000000000001',null,'discount','known',1000,'USD','direct','68000000-4000-4000-8000-000000000001','test.cost'),
 ('67000000-4000-4000-8000-000000000003','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0003',null,'68000000-7200-4000-8000-000000000001','shipping','known',3000,'USD','allocated','68000000-4000-4000-8000-000000000001','test.cost'),
 ('67000000-4000-4000-8000-000000000004','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0004',null,'68000000-7200-4000-8000-000000000001','tax','known',9999,'USD','allocated','68000000-4000-4000-8000-000000000001','test.cost'),
 ('67000000-4000-4000-8000-000000000005','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0005','68000000-5000-4000-8000-000000000001',null,'fee','known',300,'EUR','direct','68000000-4000-4000-8000-000000000001','test.cost'),
 ('67000000-4000-4000-8000-000000000006','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0006','68000000-5000-4000-8000-000000000002',null,'item_price','known',100,'USD','direct','68000000-4000-4000-8000-000000000001','test.cost'),
 ('67000000-4000-4000-8000-000000000007','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0007','68000000-5000-4000-8000-000000000003',null,'item_price','known',101,'USD','direct','68000000-4000-4000-8000-000000000001','test.cost'),
 ('67000000-4000-4000-8000-000000000008','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0008','68000000-5000-4000-8000-000000000003',null,'fee','known',100,'EUR','direct','68000000-4000-4000-8000-000000000001','test.cost');
insert into public.acquisition_cost_allocations(id,workspace_id,public_id,cost_component_id,line_item_id,amount_minor,method,state,reviewed_by,reviewed_at,reversed_at,created_by_process) values
 ('67000000-5000-4000-8000-000000000001','68000000-1000-4000-8000-000000000001','RV-ACALLOC-COST001','67000000-4000-4000-8000-000000000003','68000000-5000-4000-8000-000000000001',3000,'equal','confirmed','68000000-0000-4000-8000-000000000001',now(),null,'test.cost'),
 ('67000000-5000-4000-8000-000000000002','68000000-1000-4000-8000-000000000001','RV-ACALLOC-COST002','67000000-4000-4000-8000-000000000004','68000000-5000-4000-8000-000000000001',9999,'equal','candidate',null,null,null,'test.cost'),
 ('67000000-5000-4000-8000-000000000003','68000000-1000-4000-8000-000000000001','RV-ACALLOC-COST003','67000000-4000-4000-8000-000000000004','68000000-5000-4000-8000-000000000001',9999,'equal','reversed',null,null,now(),'test.cost');
update public.acquisition_cost_allocations set state='withdrawn' where id='67000000-5000-4000-8000-000000000002';
update public.acquisition_line_items set source_detail='{"specific_unit_costs_minor":[70,31,0,0,0,0,0]}' where id='68000000-5000-4000-8000-000000000003';
set local session_replication_role=origin;

select set_config('request.jwt.claims',json_build_object('sub','68000000-0000-4000-8000-000000000001','role','authenticated')::text,true);
reset app.governed_cost_basis_mutation;
select throws_ok($$insert into public.inventory_cost_basis(workspace_id,recompute_id,subject_kind,inventory_lot_id,acquisition_line_item_id,acquisition_receipt_line_inventory_link_id,layer_seq,source_unit_ordinal,total_cost_minor,currency,basis_method,state,algorithm_version,input_content_hash) values('68000000-1000-4000-8000-000000000001',gen_random_uuid(),'lot','69000000-9200-4000-8000-000000000001','68000000-5000-4000-8000-000000000001','67000000-3000-4000-8000-000000000001',98,98,0,'USD','fifo','current','1.1.0',repeat('0',64))$$,'55000','inventory_cost_basis_is_derived','a completely unset governed-mutation GUC fails closed');
-- Restore the pending candidate to reproduce the old partial-basis defect.
set local session_replication_role=replica;
update public.acquisition_cost_allocations set state='candidate' where id='67000000-5000-4000-8000-000000000002';
update public.acquisition_cost_components set attribution_state='unresolved' where id='67000000-4000-4000-8000-000000000004';
set local session_replication_role=origin;
select public.recompute_inventory_cost_basis('68000000-1000-4000-8000-000000000001');
select is((select count(*)::int from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000001' and currency='USD' and state='current'),0,'candidate order-shared cost blocks complete/current basis despite known direct cost');
select ok((select bool_and(total_cost_minor is null and state='unresolved') from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000001' and currency='USD' and state in ('current','unresolved')),'partial known subtotal is not published as authoritative total');
select throws_ok($$select public.withdraw_cost_allocation('67000000-4000-4000-8000-000000000004',null)$$,'22023','a reason is required to withdraw an allocation proposal','withdrawal requires a reason');
select is((public.withdraw_cost_allocation('67000000-4000-4000-8000-000000000004','wrong allocation target')->>'withdrawn')::int,1,'candidate allocation can be withdrawn governably');
select is((select state::text from public.acquisition_cost_allocations where id='67000000-5000-4000-8000-000000000002'),'withdrawn','withdrawal preserves the original row as terminal history');
select is((public.propose_cost_allocation('67000000-4000-4000-8000-000000000004','equal','[{"line_item_id":"68000000-5000-4000-8000-000000000001","amount_minor":9999}]')->>'proposed')::int,1,'a corrected proposal is allowed after withdrawal');
select is((public.withdraw_cost_allocation('67000000-4000-4000-8000-000000000004','baseline after replacement proof')->>'withdrawn')::int,1,'replacement candidate is independently withdrawable');
set local session_replication_role=replica;
update public.acquisition_cost_components set attribution_state='allocated' where id='67000000-4000-4000-8000-000000000004';
set local session_replication_role=origin;
select is((public.recompute_inventory_cost_basis('68000000-1000-4000-8000-000000000001')->>'recomputed'),'true','first recompute publishes basis');
select ok((select bool_and(not has_table_privilege('authenticated',format('public.%I',t),'insert')) from unnest(array['inventory_cost_basis','inventory_cost_basis_contributions','inventory_cost_basis_events']) t),'authenticated has no direct writes');
select throws_ok($$insert into public.inventory_cost_basis(workspace_id,recompute_id,subject_kind,inventory_lot_id,acquisition_line_item_id,acquisition_receipt_line_inventory_link_id,layer_seq,source_unit_ordinal,total_cost_minor,currency,basis_method,state,algorithm_version,input_content_hash) values('68000000-1000-4000-8000-000000000001',gen_random_uuid(),'lot','69000000-9200-4000-8000-000000000001','68000000-5000-4000-8000-000000000001','67000000-3000-4000-8000-000000000001',99,99,0,'USD','fifo','current','1.0.0',repeat('0',64))$$,'55000','inventory_cost_basis_is_derived','even privileged direct writes are guarded');
select is((select count(*)::int from public.inventory_cost_basis where acquisition_receipt_line_inventory_link_id='67000000-3000-4000-8000-000000000005'),0,'submitted-only receiving never derives basis');
select is((select sum(total_cost_minor)::bigint from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000001' and currency='USD' and state='current'),7200::bigint,'six of ten units receive six tenths of direct plus confirmed allocated cost and discount');
select is((select sum(amount_minor)::bigint from public.inventory_cost_basis_contributions c join public.inventory_cost_basis b on b.id=c.inventory_cost_basis_id where b.state in ('current','unresolved') and c.acquisition_cost_component_id='67000000-4000-4000-8000-000000000002'),-600::bigint,'discount contribution subtracts');
select is((select count(*)::int from public.inventory_cost_basis_contributions c join public.inventory_cost_basis b on b.id=c.inventory_cost_basis_id where b.state in ('current','unresolved') and c.acquisition_cost_component_id='67000000-4000-4000-8000-000000000004'),0,'candidate and reversed allocations are excluded');
select is((select pending_expected_quantity from public.unresolved_inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000001'),4::bigint,'unreconciled expected quantity remains pending');
select is((select array_agg(total_cost_minor order by source_unit_ordinal) from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000002' and currency='USD' and state in ('current','unresolved')),array[34,33,33,null,null]::bigint[],'minor-unit remainder and overage are deterministic');
select is((select overage_quantity from public.unresolved_inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000002'),2::bigint,'overreceipt quantity is explicit');
select is((select count(*)::int from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000002' and state='unresolved'),2,'overage basis is unresolved, never zero');
select is((select array_agg(layer_seq order by source_unit_ordinal) from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000001' and currency='USD' and state in ('current','unresolved')),array[1,2,3,4,5,6]::integer[],'FIFO layers follow stable receiving order');
select is((select array_agg(total_cost_minor order by inventory_item_id) from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000003' and currency='USD' and state in ('current','unresolved')),array[15,15]::bigint[],'multi-unit serialized cost uses deterministic equal attribution');
select ok((select bool_and(basis_method='deterministic_equal_attribution') from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000003' and currency='USD' and state in ('current','unresolved')),'arbitrary source JSON cannot label multi-unit costs source-specific');
select is((select array_agg(total_cost_minor order by inventory_item_id) from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000003' and currency='EUR' and state in ('current','unresolved')),array[15,15]::bigint[],'serialized aggregate cost uses deterministic equal attribution');
select ok((select bool_and(basis_method='deterministic_equal_attribution') from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000003' and currency='EUR' and state in ('current','unresolved')),'equal split is never mislabeled source-specific');
select is((select count(distinct currency)::int from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000001'),2,'currencies remain separate');
select ok((select bool_and(b.total_cost_minor=(select sum(c.amount_minor) from public.inventory_cost_basis_contributions c where c.inventory_cost_basis_id=b.id)) from public.inventory_cost_basis b where b.state='current'),'basis equals contribution provenance exactly');
select is((select count(*)::int from public.inventory_cost_basis where state in ('current','unresolved')),21,'one derived layer exists for every reconciled linked unit and currency');
select is((public.recompute_inventory_cost_basis('68000000-1000-4000-8000-000000000001')->>'recomputed'),'false','unchanged inputs are an idempotent no-op');
select is((select count(*)::int from public.inventory_cost_basis_events where inventory_cost_basis_id is null),2,'no-op creates no history');
-- Change one authoritative input and prove supersession/history.
set local session_replication_role=replica;
insert into public.acquisition_cost_components(id,workspace_id,public_id,line_item_id,component_type,amount_state,amount_minor,currency,attribution_state,acquisition_import_job_id,created_by_process) values
 ('67000000-4000-4000-8000-000000000009','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0009','68000000-5000-4000-8000-000000000002','fee','known',3,'USD','direct','68000000-4000-4000-8000-000000000001','test.cost');
set local session_replication_role=origin;
select is((public.recompute_inventory_cost_basis('68000000-1000-4000-8000-000000000001')->>'recomputed'),'true','changed authority creates a new version');
select ok((select count(*)>0 from public.inventory_cost_basis where state='superseded'),'prior truth is preserved as superseded history');
select is((select count(*)::int from public.inventory_cost_basis_events where inventory_cost_basis_id is null),3,'three effective recomputes have three run events');
select is((select count(*)::int from public.inventory_cost_basis b where state in ('current','unresolved') and exists(select 1 from public.inventory_cost_basis x where x.workspace_id=b.workspace_id and x.acquisition_receipt_line_inventory_link_id=b.acquisition_receipt_line_inventory_link_id and x.source_unit_ordinal=b.source_unit_ordinal and x.currency=b.currency and x.state in ('current','unresolved') and x.id<>b.id)),0,'there are never competing current truths');
-- Genuine overlapping dblink recompute calls use the password-aware DSN pattern.
commit;
create temporary table s24_conn(dsn text); insert into s24_conn values(case when current_setting('is_superuser')='on' then 'dbname='||current_database() else format('host=%s port=%s dbname=%s user=postgres password=postgres',coalesce(host(inet_server_addr()),'127.0.0.1'),coalesce(inet_server_port()::text,current_setting('port')),current_database()) end);
select dblink_connect('s24a',(select dsn from s24_conn)); select dblink_connect('s24b',(select dsn from s24_conn));
select dblink_send_query('s24a',format($q$with s as materialized(select set_config('request.jwt.claims',%L,false)) select public.recompute_inventory_cost_basis('68000000-1000-4000-8000-000000000001')->>'recomputed' from s$q$,json_build_object('sub','68000000-0000-4000-8000-000000000001','role','authenticated')::text));
select dblink_send_query('s24b',format($q$with s as materialized(select set_config('request.jwt.claims',%L,false)) select public.recompute_inventory_cost_basis('68000000-1000-4000-8000-000000000001')->>'recomputed' from s$q$,json_build_object('sub','68000000-0000-4000-8000-000000000001','role','authenticated')::text));
select pg_sleep(.2);
create temporary table s24_results(v text); insert into s24_results select v from dblink_get_result('s24a') t(v text); insert into s24_results select v from dblink_get_result('s24b') t(v text);
select dblink_disconnect('s24a'); select dblink_disconnect('s24b');
select is((select count(*)::int from s24_results where v like 'ERR:%'),0,'genuine concurrent recomputes both complete without error');
select is((select count(*)::int from s24_results where v='false'),2,'concurrent unchanged recomputes both observe the same no-op truth');
-- Unknown direct evidence, lot-shared unresolved evidence, and negative net all fail closed.
begin;
set local session_replication_role=replica;
insert into public.acquisition_cost_components(id,workspace_id,public_id,line_item_id,lot_id,component_type,amount_state,amount_minor,currency,attribution_state,acquisition_import_job_id,created_by_process) values
 ('67000000-4000-4000-8000-000000000010','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0010','68000000-5000-4000-8000-000000000002',null,'fee','unknown',null,'USD','direct','68000000-4000-4000-8000-000000000001','test.cost'),
 ('67000000-4000-4000-8000-000000000011','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0011',null,'68000000-7300-4000-8000-000000000001','shipping','known',500,'CAD','unresolved','68000000-4000-4000-8000-000000000001','test.cost'),
 ('67000000-4000-4000-8000-000000000012','68000000-1000-4000-8000-000000000001','RV-ACOST-COST0012','68000000-5000-4000-8000-000000000003',null,'discount','known',1000,'USD','direct','68000000-4000-4000-8000-000000000001','test.cost');
set local session_replication_role=origin;
select public.recompute_inventory_cost_basis('68000000-1000-4000-8000-000000000001');
select ok((select bool_and(state='unresolved' and total_cost_minor is null) from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000002' and currency='USD' and state in ('current','unresolved')),'unknown direct cost blocks complete basis');
select ok((select count(*)>0 and bool_and(state='unresolved' and total_cost_minor is null) from public.inventory_cost_basis where currency='CAD' and state in ('current','unresolved')),'lot-scoped unresolved shared cost propagates to affected inventory coverage');
select ok((select bool_and(state='unresolved' and total_cost_minor is null) from public.inventory_cost_basis where acquisition_line_item_id='68000000-5000-4000-8000-000000000003' and currency='USD' and state in ('current','unresolved')),'negative net basis is explicit unresolved truth, never current negative value');
rollback;

-- Confirm and withdrawal serialize on the same component lock: exactly one wins.
create function public.s241_race(p_sql text) returns text language plpgsql as $$begin execute p_sql; return 'OK'; exception when others then return 'ERR:'||sqlstate; end$$;
set local session_replication_role=replica; update public.acquisition_cost_components set attribution_state='unresolved' where id='67000000-4000-4000-8000-000000000004'; set local session_replication_role=origin;
select public.propose_cost_allocation('67000000-4000-4000-8000-000000000004','equal','[{"line_item_id":"68000000-5000-4000-8000-000000000001","amount_minor":9999}]');
select dblink_connect('s241c',(select dsn from s24_conn)); select dblink_connect('s241w',(select dsn from s24_conn));
select dblink_send_query('s241c',format($q$with s as materialized(select set_config('request.jwt.claims',%L,false)) select public.s241_race('select public.confirm_cost_allocation(''67000000-4000-4000-8000-000000000004'',9999)') from s$q$,json_build_object('sub','68000000-0000-4000-8000-000000000001','role','authenticated')::text));
select dblink_send_query('s241w',format($q$with s as materialized(select set_config('request.jwt.claims',%L,false)) select public.s241_race('select public.withdraw_cost_allocation(''67000000-4000-4000-8000-000000000004'',''concurrent correction'')') from s$q$,json_build_object('sub','68000000-0000-4000-8000-000000000001','role','authenticated')::text));
create temporary table s241_results(v text); insert into s241_results select v from dblink_get_result('s241c') t(v text); insert into s241_results select v from dblink_get_result('s241w') t(v text);
select dblink_disconnect('s241c'); select dblink_disconnect('s241w');
select is((select count(*)::int from s241_results where v='OK'),1,'confirm versus withdrawal has exactly one winner');
select is((select count(*)::int from s241_results where v like 'ERR:%'),1,'confirm versus withdrawal has exactly one coherent loser');
drop function public.s241_race(text);

select is((select count(*)::int from public.schema_migrations_log where migration_name='20260812000100_governed_inventory_cost_basis'),1,'S2.4 migration is logged once');
select * from finish();
