-- Fixture for the PostgREST transport suite.
--
-- The transport suite proves that the governed receiving RPCs are reachable and
-- correct through the SAME membrane the server uses — HTTP to PostgREST with a
-- named JSON body — rather than through a positional SQL call. To do that it
-- needs a real committed acquisition world to receive against.
--
-- This is the pre-receiving world ONLY: workspaces, members, source evidence,
-- an order, its lines, a shipment, and governed inventory subjects. Every
-- receipt, line, correction, link and state transition in the suite is created
-- through the public RPCs over HTTP, because those are the things under test.
--
-- The id space is deliberately disjoint from every pgTAP fixture (71.../72...)
-- so this fixture, which COMMITS, can never be mistaken for or collide with a
-- pgTAP fixture, which rolls back.
--
-- The helper below mirrors the pgTAP `as_user`, used here only while seeding.
begin;
create or replace function pg_temp.h(p_seed text) returns text language sql immutable as $$select encode(sha256(p_seed::bytea),'hex')$$;
insert into auth.users(id,email) values
 ('71000000-0000-4000-8000-000000000001','owner71@example.test'),
 ('71000000-0000-4000-8000-000000000002','operator71@example.test'),
 ('71000000-0000-4000-8000-000000000003','viewer71@example.test'),
 ('71000000-0000-4000-8000-000000000004','ownerf71@example.test');
insert into public.workspaces(id,name,created_by) values
 ('71000000-1000-4000-8000-000000000001','S2.1 receiving','71000000-0000-4000-8000-000000000001'),
 ('71000000-1000-4000-8000-000000000002','S2.1 foreign','71000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('71000000-1000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','operator'),
 ('71000000-1000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','viewer');
insert into public.source_systems(id,workspace_id,public_id,kind,instance_label,created_by) values
 ('71000000-2000-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','SRC-71-A','manual','A source','71000000-0000-4000-8000-000000000001'),
 ('71000000-2000-4000-8000-000000000002','71000000-1000-4000-8000-000000000002','SRC-71-F','manual','foreign source','71000000-0000-4000-8000-000000000004');
insert into public.import_jobs(id,workspace_id,public_id,source_system_id,source_label,file_sha256,content_sha256,parser_version,mapping_version,idempotency_key,mode,status,source_row_count,accepted_row_count,issue_row_count,source_totals,actor_user_id,actor_process) values
 ('71000000-3000-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','IMP-71-A','71000000-2000-4000-8000-000000000001','fixture',repeat('a',64),repeat('b',64),'1.0.0','1.0.0','t71-recv-a','commit','preview',3,0,0,'{}','71000000-0000-4000-8000-000000000001','test.import'),
 ('71000000-3000-4000-8000-000000000002','71000000-1000-4000-8000-000000000002','IMP-71-F','71000000-2000-4000-8000-000000000002','fixture',repeat('c',64),repeat('d',64),'1.0.0','1.0.0','t71-recv-f','commit','preview',1,0,0,'{}','71000000-0000-4000-8000-000000000004','test.import');
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process)
select ('71000000-5100-4000-8000-00000000000'||n)::uuid,'71000000-1000-4000-8000-000000000001','71000000-3000-4000-8000-000000000001',n-1,'t-row-a'||n,
 jsonb_build_object('product_name','sealed case '||n),pg_temp.h('t-row-a'||n),'parsed','{}','1.0.0','1.0.0','test.import'
from generate_series(1,3) n;
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process) values
 ('71000000-5100-4000-8000-000000000009','71000000-1000-4000-8000-000000000002','71000000-3000-4000-8000-000000000002',0,'t-row-f1','{"product_name":"foreign line"}',pg_temp.h('t-row-f1'),'parsed','{}','1.0.0','1.0.0','test.import');
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=3 where id='71000000-3000-4000-8000-000000000001';
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=1 where id='71000000-3000-4000-8000-000000000002';
insert into public.channels(id,workspace_id,public_id,name,kind,created_by) values
 ('71000000-6000-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','RV-CH-71A001','A channel','manual','71000000-0000-4000-8000-000000000001'),
 ('71000000-6000-4000-8000-000000000002','71000000-1000-4000-8000-000000000002','RV-CH-71F001','F channel','manual','71000000-0000-4000-8000-000000000004');
insert into public.suppliers(id,workspace_id,public_id,display_name,created_by_process) values
 ('71000000-7000-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','RV-SUP-71A001','A seller','test.import'),
 ('71000000-7000-4000-8000-000000000002','71000000-1000-4000-8000-000000000002','RV-SUP-71F001','Foreign seller','test.import');
insert into public.acquisition_import_jobs(id,workspace_id,channel_id,source_import_job_id,idempotency_key,mode,status,expected_line_count,mapping_version,plan_sha256,actor_user_id,actor_process) values
 ('71000000-4000-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','71000000-6000-4000-8000-000000000001','71000000-3000-4000-8000-000000000001','t71-acq-a','commit','preview',3,'1.0.0',repeat('1',64),'71000000-0000-4000-8000-000000000001','test.import'),
 ('71000000-4000-4000-8000-000000000002','71000000-1000-4000-8000-000000000002','71000000-6000-4000-8000-000000000002','71000000-3000-4000-8000-000000000002','t71-acq-f','commit','preview',1,'1.0.0',repeat('2',64),'71000000-0000-4000-8000-000000000004','test.import');
-- Line 1 expects 10 units (the partial-receiving subject), lines 2 and 3 expect
-- 4 and 7 (the multi-line receipt subjects).
insert into public.acquisition_line_items(id,workspace_id,public_id,source_system_id,source_record_id,acquisition_import_job_id,quantity,description,source_detail,created_by_process) values
 ('71000000-5000-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','LINE-71-A1','71000000-2000-4000-8000-000000000001','71000000-5100-4000-8000-000000000001','71000000-4000-4000-8000-000000000001',10,'sealed case 1','{}','test.import'),
 ('71000000-5000-4000-8000-000000000002','71000000-1000-4000-8000-000000000001','LINE-71-A2','71000000-2000-4000-8000-000000000001','71000000-5100-4000-8000-000000000002','71000000-4000-4000-8000-000000000001',4,'sealed case 2','{}','test.import'),
 ('71000000-5000-4000-8000-000000000003','71000000-1000-4000-8000-000000000001','LINE-71-A3','71000000-2000-4000-8000-000000000001','71000000-5100-4000-8000-000000000003','71000000-4000-4000-8000-000000000001',7,'sealed case 3','{}','test.import'),
 ('71000000-5000-4000-8000-000000000009','71000000-1000-4000-8000-000000000002','LINE-71-F1','71000000-2000-4000-8000-000000000002','71000000-5100-4000-8000-000000000009','71000000-4000-4000-8000-000000000002',1,'foreign line','{}','test.import');
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=3,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='71000000-4000-4000-8000-000000000001';
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=1,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='71000000-4000-4000-8000-000000000002';
set local session_replication_role=replica;
-- Two orders in workspace A: the second exists so a receipt can be proven
-- unable to borrow another order's shipment.
insert into public.acquisition_orders(id,workspace_id,public_id,channel_id,supplier_id,source_system_id,acquisition_import_job_id,source_order_reference,first_source_record_id,order_status,occurred_at,created_by_process) values
 ('71000000-7200-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','RV-ACQ-71A001','71000000-6000-4000-8000-000000000001','71000000-7000-4000-8000-000000000001','71000000-2000-4000-8000-000000000001','71000000-4000-4000-8000-000000000001','ORDER-64-A1','71000000-5100-4000-8000-000000000001','unknown','2026-08-01T10:00:00Z','test.import'),
 ('71000000-7200-4000-8000-000000000003','71000000-1000-4000-8000-000000000001','RV-ACQ-71A002','71000000-6000-4000-8000-000000000001','71000000-7000-4000-8000-000000000001','71000000-2000-4000-8000-000000000001','71000000-4000-4000-8000-000000000001','ORDER-64-A2','71000000-5100-4000-8000-000000000002','unknown','2026-08-02T10:00:00Z','test.import'),
 ('71000000-7200-4000-8000-000000000002','71000000-1000-4000-8000-000000000002','RV-ACQ-71F001','71000000-6000-4000-8000-000000000002','71000000-7000-4000-8000-000000000002','71000000-2000-4000-8000-000000000002','71000000-4000-4000-8000-000000000002','ORDER-64-F1','71000000-5100-4000-8000-000000000009','unknown',null,'test.import');
insert into public.acquisition_lots(id,workspace_id,public_id,order_id,created_by_process) values
 ('71000000-7300-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','RV-ALOT-71A001','71000000-7200-4000-8000-000000000001','test.import'),
 ('71000000-7300-4000-8000-000000000002','71000000-1000-4000-8000-000000000002','RV-ALOT-71F001','71000000-7200-4000-8000-000000000002','test.import');
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,sequence_no,created_by_process)
select ('71000000-7400-4000-8000-00000000000'||n)::uuid,'71000000-1000-4000-8000-000000000001','71000000-7300-4000-8000-000000000001',('71000000-5000-4000-8000-00000000000'||n)::uuid,n,'test.import'
from generate_series(1,3) n;
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,created_by_process) values
 ('71000000-7400-4000-8000-000000000009','71000000-1000-4000-8000-000000000002','71000000-7300-4000-8000-000000000002','71000000-5000-4000-8000-000000000009','test.import');
-- One shipment per order, plus a foreign-workspace shipment.
insert into public.acquisition_shipments(id,workspace_id,public_id,acquisition_order_id,carrier,tracking_number,status,create_idempotency_key,create_fingerprint,created_by) values
 ('71000000-7500-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','RV-ASHIP-71A001','71000000-7200-4000-8000-000000000001','ups','1Z64A0001','in_transit','t71-ship-a1',repeat('3',64),'71000000-0000-4000-8000-000000000001'),
 ('71000000-7500-4000-8000-000000000003','71000000-1000-4000-8000-000000000001','RV-ASHIP-71A002','71000000-7200-4000-8000-000000000003','ups','1Z64A0002','in_transit','t71-ship-a2',repeat('4',64),'71000000-0000-4000-8000-000000000001'),
 ('71000000-7500-4000-8000-000000000002','71000000-1000-4000-8000-000000000002','RV-ASHIP-71F001','71000000-7200-4000-8000-000000000002','ups','1Z64F0001','in_transit','t71-ship-f1',repeat('5',64),'71000000-0000-4000-8000-000000000004');
set local session_replication_role=origin;

create temporary table s21_shipments as
  select id, status, carrier, tracking_number, received_at, shipped_at
    from public.acquisition_shipments
   where workspace_id='71000000-1000-4000-8000-000000000001';

-- Real governed inventory subjects are selected, not fabricated by receiving.
insert into public.product_catalog(id,workspace_id,public_id,business_vertical,display_name,product_canonical_key,created_by_process) values('72000000-9000-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','RV-PROD-T71001','other','Known fixture product','known-t71-product','test.fixture');
insert into public.sellable_skus(id,workspace_id,public_id,product_id,business_vertical,fingerprint,created_by_process) values('72000000-9100-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','RV-SKU-T71001','72000000-9000-4000-8000-000000000001','other',repeat('a',64),'test.fixture');
insert into public.inventory_lots(id,workspace_id,public_id,sku_id,tracking_mode,quantity,created_by_process) values('72000000-9200-4000-8000-000000000001','71000000-1000-4000-8000-000000000001','RV-C-720001','72000000-9100-4000-8000-000000000001','lot_managed',10,'test.fixture');
commit;
