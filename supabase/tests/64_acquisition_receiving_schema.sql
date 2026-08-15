-- S2.1 governed receiving SCHEMA.
--
-- S2.1 ships no mutation function, so this file cannot test governed behaviour
-- and does not pretend to: every assertion below exercises the actual
-- relational constraints, triggers, privileges, and policies against a real
-- committed acquisition fixture. Structural existence checks are the minority.
-- The acceptance is that a privileged internal statement — one with no RLS over
-- it at all — still cannot create a cross-workspace or cross-order corruption,
-- still cannot record a zero or negative arrival, and still cannot rewrite or
-- erase receiving evidence without declaring itself a governed receiving
-- mutation.
--
-- The receiving contract under test:
--   * one acquisition order may have many receipts;
--   * one receipt may hold many acquisition lines;
--   * one acquisition line may be received across many receipts, at most once
--     per receipt;
--   * an overage is recordable, because it is a physical truth;
--   * receiving evidence never edits acquisition, classification, exclusion,
--     payment, or shipment evidence.
begin;
create extension if not exists pgtap;
select plan(168);

create function pg_temp.h(p_seed text) returns text language sql immutable as $$
  select encode(sha256(p_seed::bytea), 'hex')
$$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- Total quantity observed against one acquisition line, across every receipt.
create function pg_temp.received_total(p_line uuid) returns int language sql as $$
  select coalesce(sum(r.quantity_received),0)::int from public.acquisition_receipt_lines r
   where r.workspace_id='64000000-1000-4000-8000-000000000001' and r.acquisition_line_item_id=p_line
$$;
-- The EXPECTED side of the model, read straight from the immutable source row.
create function pg_temp.expected_qty(p_line uuid) returns int language sql as $$
  select quantity from public.acquisition_line_items where id=p_line
$$;

-- ---------------------------------------------------------------- structure --
select has_table('public','acquisition_receipts','the receipt table exists');
select has_table('public','acquisition_receipt_lines','the receipt-line table exists');
select has_table('public','acquisition_discrepancies','the discrepancy table exists');
select has_pk('public','acquisition_receipts','receipts have a primary key');
select has_pk('public','acquisition_receipt_lines','receipt lines have a primary key');
select has_pk('public','acquisition_discrepancies','discrepancies have a primary key');

select has_column('public','acquisition_receipts','public_id','receipts carry a governed public identity');
select has_column('public','acquisition_receipts','acquisition_order_id','receipts name their acquisition order');
select has_column('public','acquisition_receipts','acquisition_shipment_id','receipts may reference a governed shipment');
select has_column('public','acquisition_receipts','status','receipts carry a lifecycle status');
select has_column('public','acquisition_receipts','received_at','receipts record when goods arrived');
select has_column('public','acquisition_receipts','note','receipts carry a receiving note');
select has_column('public','acquisition_receipts','create_idempotency_key','receipt creation is keyed');
select has_column('public','acquisition_receipts','created_by','receipts record the recording actor');
select has_column('public','acquisition_receipts','created_at','receipts record creation time');
select col_not_null('public','acquisition_receipts','workspace_id','receipt workspace is required');
select col_not_null('public','acquisition_receipts','acquisition_order_id','receipt order is required');
select col_is_null('public','acquisition_receipts','acquisition_shipment_id','receipt shipment association is optional');

select has_column('public','acquisition_receipt_lines','public_id','receipt lines carry a governed public identity');
select has_column('public','acquisition_receipt_lines','acquisition_receipt_id','receipt lines name their receipt');
select has_column('public','acquisition_receipt_lines','acquisition_line_item_id','receipt lines name their acquisition line');
select has_column('public','acquisition_receipt_lines','quantity_received','receipt lines record observed quantity');
select col_not_null('public','acquisition_receipt_lines','workspace_id','receipt-line workspace is required');
select col_not_null('public','acquisition_receipt_lines','quantity_received','observed quantity is required');
select col_type_is('public','acquisition_receipt_lines','quantity_received','integer',
  'observed quantity uses the same integral representation as acquisition_line_items.quantity');

select has_column('public','acquisition_discrepancies','public_id','discrepancies carry a governed public identity');
select has_column('public','acquisition_discrepancies','acquisition_order_id','discrepancies name their acquisition order');
select has_column('public','acquisition_discrepancies','acquisition_receipt_id','discrepancies may name a receipt');
select has_column('public','acquisition_discrepancies','acquisition_receipt_line_id','discrepancies may name a receipt line');
select has_column('public','acquisition_discrepancies','acquisition_line_item_id','discrepancies may name an acquisition line');
select has_column('public','acquisition_discrepancies','kind','discrepancies carry a governed kind');
select has_column('public','acquisition_discrepancies','status','discrepancies carry a resolution status');
select has_column('public','acquisition_discrepancies','quantity_expected','discrepancies record the expected quantity');
select has_column('public','acquisition_discrepancies','quantity_observed','discrepancies record the observed quantity');
select has_column('public','acquisition_discrepancies','detail','discrepancies require a human explanation');
select col_not_null('public','acquisition_discrepancies','workspace_id','discrepancy workspace is required');
select col_not_null('public','acquisition_discrepancies','detail','the human explanation is required');
select col_not_null('public','acquisition_discrepancies','acquisition_order_id','discrepancy order is required');

-- The receipt grain is the constraint, not a convention: one canonical
-- receipt-line row per acquisition line per receipt.
select has_index('public','acquisition_receipt_lines','acquisition_receipt_lines_receipt_line_uniq',
  'one canonical receipt line per (receipt, acquisition line)');
select has_index('public','acquisition_receipts','acquisition_receipts_order_idx',
  'receipts are indexed by workspace and acquisition order');
select has_index('public','acquisition_receipts','acquisition_receipts_received_at_idx',
  'receipts are indexed by workspace and arrival time');
select has_index('public','acquisition_receipts','acquisition_receipts_status_idx',
  'receipts are indexed by workspace and lifecycle status');
select has_index('public','acquisition_receipts','acquisition_receipts_shipment_idx',
  'receipts are indexed by their optional shipment association');
select has_index('public','acquisition_receipt_lines','acquisition_receipt_lines_line_item_idx',
  'cumulative receiving against one acquisition line has a covering index');
select has_index('public','acquisition_discrepancies','acquisition_discrepancies_order_idx',
  'discrepancies are indexed by workspace and order');
select has_index('public','acquisition_discrepancies','acquisition_discrepancies_receipt_idx',
  'discrepancies are indexed by receipt');
select has_index('public','acquisition_discrepancies','acquisition_discrepancies_line_item_idx',
  'discrepancies are indexed by affected acquisition line');
select has_index('public','acquisition_discrepancies','acquisition_discrepancies_open_idx',
  'unresolved discrepancies have a partial index');

-- Governed vocabularies, pinned exactly as the target architecture states them.
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e where e.enumtypid='public.acquisition_receipt_status'::regtype),
  array['open','submitted','reconciled','cancelled'],
  'the receipt lifecycle is the smallest closed set the architecture approves');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e where e.enumtypid='public.acquisition_discrepancy_kind'::regtype),
  array['short_shipped','over_shipped','damaged','wrong_item','not_as_described','price_mismatch','never_arrived'],
  'the discrepancy taxonomy is exactly the approved one');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e where e.enumtypid='public.acquisition_discrepancy_status'::regtype),
  array['open','claimed','resolved','written_off'],
  'the discrepancy lifecycle is exactly the approved one');

select ok((select relrowsecurity from pg_class where oid='public.acquisition_receipts'::regclass),
  'RLS is enabled on receipts');
select ok((select relrowsecurity from pg_class where oid='public.acquisition_receipt_lines'::regclass),
  'RLS is enabled on receipt lines');
select ok((select relrowsecurity from pg_class where oid='public.acquisition_discrepancies'::regclass),
  'RLS is enabled on discrepancies');
select has_function('app','guard_acquisition_receiving_rows','the direct-write guard exists');

select is((select count(*)::int from public.schema_migrations_log
            where migration_name='20260807000100_s2_receiving_schema'),1,
  'migration ledger recorded once');

-- No inventory or cost-basis schema was created by S2.1.
select hasnt_column('public','acquisition_receipt_lines','inventory_lot_id',
  'S2.1 creates no inventory linkage; S2.2 owns conversion');
select hasnt_column('public','acquisition_receipt_lines','inventory_item_id',
  'S2.1 creates no inventory linkage; S2.2 owns conversion');
select has_table('public','inventory_cost_basis','later S2.4 adds the governed cost-basis table');
select has_table('public','inventory_cost_basis_events','later S2.4 adds append-only cost-basis history');
select hasnt_table('public','unresolved_cost_queue','S2.1 creates no unresolved-cost queue');
-- The receipt table does not restate what acquisition_shipments already owns.
select hasnt_column('public','acquisition_receipts','carrier','receipts do not duplicate carrier');
select hasnt_column('public','acquisition_receipts','tracking_number','receipts do not duplicate tracking');
select hasnt_column('public','acquisition_receipts','shipped_at','receipts do not duplicate shipment timing');

-- ----------------------------------------------------------- privileges -----
select ok(has_table_privilege('authenticated','public.acquisition_receipts','select'),
  'members can read receipts');
select ok(has_table_privilege('authenticated','public.acquisition_receipt_lines','select'),
  'members can read receipt lines');
select ok(has_table_privilege('authenticated','public.acquisition_discrepancies','select'),
  'members can read discrepancies');
select ok(not has_table_privilege('authenticated','public.acquisition_receipts','insert'),
  'authenticated cannot directly insert receipts');
select ok(not has_table_privilege('authenticated','public.acquisition_receipts','update'),
  'authenticated cannot directly update receipts');
select ok(not has_table_privilege('authenticated','public.acquisition_receipts','delete'),
  'authenticated cannot directly delete receipts');
select ok(not has_table_privilege('authenticated','public.acquisition_receipts','truncate'),
  'authenticated cannot truncate receipts');
select ok(not has_table_privilege('authenticated','public.acquisition_receipt_lines','insert'),
  'authenticated cannot directly insert receipt lines');
select ok(not has_table_privilege('authenticated','public.acquisition_receipt_lines','update'),
  'authenticated cannot directly update receipt lines');
select ok(not has_table_privilege('authenticated','public.acquisition_receipt_lines','delete'),
  'authenticated cannot directly delete receipt lines');
select ok(not has_table_privilege('authenticated','public.acquisition_receipt_lines','truncate'),
  'authenticated cannot truncate receipt lines');
select ok(not has_table_privilege('authenticated','public.acquisition_discrepancies','insert'),
  'authenticated cannot directly insert discrepancies');
select ok(not has_table_privilege('authenticated','public.acquisition_discrepancies','update'),
  'authenticated cannot directly update discrepancies');
select ok(not has_table_privilege('authenticated','public.acquisition_discrepancies','delete'),
  'authenticated cannot directly delete discrepancies');
select ok(not has_table_privilege('authenticated','public.acquisition_discrepancies','truncate'),
  'authenticated cannot truncate discrepancies');
select ok(not has_table_privilege('anon','public.acquisition_receipts','select'),
  'anon has no access to receipts');
select ok(not has_table_privilege('anon','public.acquisition_receipt_lines','select'),
  'anon has no access to receipt lines');
select ok(not has_table_privilege('anon','public.acquisition_discrepancies','select'),
  'anon has no access to discrepancies');

-- ---------------------------------------------------------------- fixture ---
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

-- ============================================== GATE 9A — PARTIAL RECEIVING ==
-- Acquisition line 1 expects 10 units and arrives as 4 + 6 across two separate
-- physical deliveries against the SAME order.
insert into public.acquisition_receipts(id,workspace_id,acquisition_order_id,acquisition_shipment_id,status,received_at,note,create_idempotency_key,create_fingerprint,created_by) values
 ('64000000-8000-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','64000000-7500-4000-8000-000000000001','open','2026-08-03T09:00:00Z','first box','s21-rcpt-a1',repeat('6',64),'64000000-0000-4000-8000-000000000002'),
 ('64000000-8000-4000-8000-000000000002','64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001',null,'open','2026-08-05T09:00:00Z','second box, no shipment record','s21-rcpt-a2',repeat('7',64),'64000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.acquisition_receipts
            where acquisition_order_id='64000000-7200-4000-8000-000000000001'),2,
  'one acquisition order carries two independent receipts');
select matches((select public_id from public.acquisition_receipts where id='64000000-8000-4000-8000-000000000001'),
  '^RV-ARCPT-[A-Z0-9]{12}$','receipts mint a governed RV-ARCPT public identity');
select is((select status::text from public.acquisition_receipts where id='64000000-8000-4000-8000-000000000002'),'open',
  'a new receipt opens in the open state');
select ok((select acquisition_shipment_id is null from public.acquisition_receipts where id='64000000-8000-4000-8000-000000000002'),
  'a receipt against an order with no shipment record is legitimate');

insert into public.acquisition_receipt_lines(id,workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by) values
 ('64000000-8100-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000001','64000000-5000-4000-8000-000000000001',4,'64000000-0000-4000-8000-000000000002'),
 ('64000000-8100-4000-8000-000000000002','64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000002','64000000-5000-4000-8000-000000000001',6,'64000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.acquisition_receipt_lines
            where acquisition_line_item_id='64000000-5000-4000-8000-000000000001'),2,
  'one acquisition line appears in two different receipts');
select is(pg_temp.received_total('64000000-5000-4000-8000-000000000001'),10,
  'cumulative partial receiving reaches the expected quantity across receipts');
select is(pg_temp.expected_qty('64000000-5000-4000-8000-000000000001'),10,
  'the acquisition line quantity is untouched by receiving');
select matches((select public_id from public.acquisition_receipt_lines where id='64000000-8100-4000-8000-000000000001'),
  '^RV-ARL-[A-Z0-9]{12}$','receipt lines mint a governed RV-ARL public identity');
-- The canonical grain: the same acquisition line cannot appear twice inside one
-- receipt, so partial receiving is expressed by more receipts, never by
-- duplicated rows inside one.
select throws_ok($$insert into public.acquisition_receipt_lines(workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000001','64000000-5000-4000-8000-000000000001',1,'64000000-0000-4000-8000-000000000002')$$,
  '23505',null,'one acquisition line cannot be recorded twice inside one receipt');

-- ============================================== GATE 9B — MULTI-LINE RECEIPT ==
-- A third receipt holds three distinct acquisition lines without the receipt
-- itself being duplicated.
insert into public.acquisition_receipts(id,workspace_id,acquisition_order_id,status,received_at,create_idempotency_key,create_fingerprint,created_by) values
 ('64000000-8000-4000-8000-000000000003','64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','open','2026-08-06T09:00:00Z','s21-rcpt-a3',repeat('8',64),'64000000-0000-4000-8000-000000000002');
insert into public.acquisition_receipt_lines(id,workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by) values
 ('64000000-8100-4000-8000-000000000003','64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000003','64000000-5000-4000-8000-000000000002',4,'64000000-0000-4000-8000-000000000002'),
 ('64000000-8100-4000-8000-000000000004','64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000003','64000000-5000-4000-8000-000000000003',7,'64000000-0000-4000-8000-000000000002');
select is((select count(distinct acquisition_line_item_id)::int from public.acquisition_receipt_lines
            where acquisition_receipt_id='64000000-8000-4000-8000-000000000003'),2,
  'one receipt holds several distinct acquisition lines');
select is((select count(*)::int from public.acquisition_receipts where id='64000000-8000-4000-8000-000000000003'),1,
  'a multi-line receipt is still exactly one receipt row');
select is((select count(distinct acquisition_line_item_id)::int from public.acquisition_receipt_lines
            where workspace_id='64000000-1000-4000-8000-000000000001'),3,
  'three distinct acquisition lines have receiving evidence');

-- ==================================================== GATE 3 — QUANTITY ======
select throws_ok($$insert into public.acquisition_receipt_lines(workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000003','64000000-5000-4000-8000-000000000001',0,'64000000-0000-4000-8000-000000000002')$$,
  '23514',null,'a zero-quantity arrival is refused: it is not an arrival');
select throws_ok($$insert into public.acquisition_receipt_lines(workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000003','64000000-5000-4000-8000-000000000001',-3,'64000000-0000-4000-8000-000000000002')$$,
  '23514',null,'a negative arrival quantity is refused');
select lives_ok($$insert into public.acquisition_receipt_lines(id,workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by)
  values('64000000-8100-4000-8000-000000000005','64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000003','64000000-5000-4000-8000-000000000001',1,'64000000-0000-4000-8000-000000000002')$$,
  'a positive arrival quantity is accepted');
-- Over-receipt is recordable: line 1 expected 10 and has now observed 11. The
-- schema must not make the physical truth unsayable; S2.2 decides whether that
-- evidence may become inventory.
select is(pg_temp.received_total('64000000-5000-4000-8000-000000000001'),11,
  'observed quantity may legitimately exceed the expected acquisition quantity');
select is(pg_temp.expected_qty('64000000-5000-4000-8000-000000000001'),10,
  'the expected acquisition quantity is still 10 after an over-receipt');

-- ============================================= GATE 2 — RECEIPT LIFECYCLE ====
select throws_ok($$insert into public.acquisition_receipts(workspace_id,acquisition_order_id,status,create_idempotency_key,create_fingerprint,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','submitted','s21-rcpt-bad1',repeat('9',64),'64000000-0000-4000-8000-000000000002')$$,
  '23514',null,'a submitted receipt cannot assert an arrival with no arrival time');
select throws_ok($$insert into public.acquisition_receipts(workspace_id,acquisition_order_id,status,create_idempotency_key,create_fingerprint,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','reconciled','s21-rcpt-bad2',repeat('9',64),'64000000-0000-4000-8000-000000000002')$$,
  '23514',null,'a reconciled receipt cannot assert an arrival with no arrival time');
select lives_ok($$insert into public.acquisition_receipts(workspace_id,acquisition_order_id,status,create_idempotency_key,create_fingerprint,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','cancelled','s21-rcpt-cancel',repeat('9',64),'64000000-0000-4000-8000-000000000002')$$,
  'an abandoned receiving session may be cancelled with no arrival time');
select throws_ok($$insert into public.acquisition_receipts(workspace_id,acquisition_order_id,status,create_idempotency_key,create_fingerprint,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','putaway','s21-rcpt-bad3',repeat('9',64),'64000000-0000-4000-8000-000000000002')$$,
  '22P02',null,'a status outside the approved lifecycle is refused');
select throws_ok($$insert into public.acquisition_receipts(workspace_id,acquisition_order_id,create_idempotency_key,create_fingerprint,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','s21-rcpt-a1',repeat('6',64),'64000000-0000-4000-8000-000000000002')$$,
  '23505',null,'the receipt create key is unique per workspace');

-- ======================================== GATE 8 — SAME-WORKSPACE INTEGRITY ==
-- Every statement below runs as a privileged internal session with no RLS over
-- it. The relationships must still fail closed.
select throws_ok($$insert into public.acquisition_receipts(workspace_id,acquisition_order_id,status,create_idempotency_key,create_fingerprint,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000002','open','s21-x-order',repeat('a',64),'64000000-0000-4000-8000-000000000002')$$,
  '23503',null,'a receipt cannot name an acquisition order in another workspace');
select throws_ok($$insert into public.acquisition_receipts(workspace_id,acquisition_order_id,acquisition_shipment_id,status,create_idempotency_key,create_fingerprint,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','64000000-7500-4000-8000-000000000002','open','s21-x-ship',repeat('a',64),'64000000-0000-4000-8000-000000000002')$$,
  '23503',null,'a receipt cannot name a shipment in another workspace');
select throws_ok($$insert into public.acquisition_receipts(workspace_id,acquisition_order_id,acquisition_shipment_id,status,create_idempotency_key,create_fingerprint,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','64000000-7500-4000-8000-000000000003','open','s21-x-ship2',repeat('a',64),'64000000-0000-4000-8000-000000000002')$$,
  '23503',null,'a receipt cannot borrow another order''s shipment, even in its own workspace');
select throws_ok($$insert into public.acquisition_receipt_lines(workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by)
  values('64000000-1000-4000-8000-000000000002','64000000-8000-4000-8000-000000000001','64000000-5000-4000-8000-000000000009',1,'64000000-0000-4000-8000-000000000004')$$,
  '23503',null,'a receipt line cannot name a receipt in another workspace');
select throws_ok($$insert into public.acquisition_receipt_lines(workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000001','64000000-5000-4000-8000-000000000009',1,'64000000-0000-4000-8000-000000000002')$$,
  '23503',null,'a receipt line cannot name an acquisition line in another workspace');

-- ================================================ GATE 4 — DISCREPANCIES ====
-- Line 2 expected 4 and 4 arrived; line 3 expected 7 but only 7 were recorded
-- as received, so the shortage evidence below is raised against line 1's first
-- delivery, where 4 of 10 arrived.
insert into public.acquisition_discrepancies(id,workspace_id,acquisition_order_id,acquisition_receipt_id,acquisition_receipt_line_id,acquisition_line_item_id,kind,quantity_expected,quantity_observed,detail,created_by) values
 ('64000000-8200-4000-8000-000000000001','64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','64000000-8000-4000-8000-000000000001','64000000-8100-4000-8000-000000000001','64000000-5000-4000-8000-000000000001','short_shipped',10,4,'first box held 4 of the 10 ordered units','64000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.acquisition_discrepancies where id='64000000-8200-4000-8000-000000000001'),1,
  'a discrepancy attaches to valid receiving evidence');
select matches((select public_id from public.acquisition_discrepancies where id='64000000-8200-4000-8000-000000000001'),
  '^RV-ADISC-[A-Z0-9]{12}$','discrepancies are separately addressable by a governed RV-ADISC identity');
select is((select status::text from public.acquisition_discrepancies where id='64000000-8200-4000-8000-000000000001'),'open',
  'a new discrepancy opens unresolved');
-- Raising a discrepancy is evidence, not a repair.
select is(pg_temp.expected_qty('64000000-5000-4000-8000-000000000001'),10,
  'recording a shortage does not correct the source acquisition quantity');
select is((select quantity_received from public.acquisition_receipt_lines where id='64000000-8100-4000-8000-000000000001'),4,
  'recording a shortage does not alter the receiving evidence it describes');
select is((select count(*)::int from public.acquisition_receipt_lines where id='64000000-8100-4000-8000-000000000001'),1,
  'the receipt line the discrepancy concerns is not deleted');

-- Overage evidence must be recordable, exactly as shortage evidence is.
select lives_ok($$insert into public.acquisition_discrepancies(id,workspace_id,acquisition_order_id,acquisition_receipt_id,acquisition_receipt_line_id,acquisition_line_item_id,kind,quantity_expected,quantity_observed,detail,created_by)
  values('64000000-8200-4000-8000-000000000002','64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','64000000-8000-4000-8000-000000000003','64000000-8100-4000-8000-000000000005','64000000-5000-4000-8000-000000000001','over_shipped',10,11,'an eleventh unit arrived that was never ordered','64000000-0000-4000-8000-000000000002')$$,
  'an overage — observed greater than expected — is recordable');
select ok((select quantity_observed > quantity_expected from public.acquisition_discrepancies where id='64000000-8200-4000-8000-000000000002'),
  'the overage is stored as the physical truth, not clamped to the expected quantity');
-- An order-level discrepancy with no receipt at all: nothing arrived.
select lives_ok($$insert into public.acquisition_discrepancies(id,workspace_id,acquisition_order_id,kind,detail,created_by)
  values('64000000-8200-4000-8000-000000000003','64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000003','never_arrived','tracking stalled; no parcel was ever delivered','64000000-0000-4000-8000-000000000002')$$,
  'a never-arrived discrepancy needs no receipt');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,acquisition_receipt_line_id,kind,detail,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','64000000-8100-4000-8000-000000000001','damaged','x','64000000-0000-4000-8000-000000000002')$$,
  '23514',null,'a receipt line is only meaningful inside the receipt that produced it');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,kind,detail,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','damaged','   ','64000000-0000-4000-8000-000000000002')$$,
  '23514',null,'a discrepancy with no human explanation is refused');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,kind,detail,expected_value_minor,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','price_mismatch','charged more than agreed',1999,'64000000-0000-4000-8000-000000000002')$$,
  '23514',null,'a money figure with no currency is refused');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,kind,status,detail,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','damaged','resolved','x','64000000-0000-4000-8000-000000000002')$$,
  '23514',null,'a terminal discrepancy must carry its resolution evidence');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,kind,detail,resolved_at,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','damaged','x',now(),'64000000-0000-4000-8000-000000000002')$$,
  '23514',null,'a resolution with no resolving actor is refused');

-- Cross-workspace and cross-relationship discrepancy association fails closed.
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,kind,detail,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000002','damaged','x','64000000-0000-4000-8000-000000000002')$$,
  '23503',null,'a discrepancy cannot name an acquisition order in another workspace');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,acquisition_line_item_id,kind,detail,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','64000000-5000-4000-8000-000000000009','damaged','x','64000000-0000-4000-8000-000000000002')$$,
  '23503',null,'a discrepancy cannot name an acquisition line in another workspace');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,acquisition_receipt_id,kind,detail,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000003','64000000-8000-4000-8000-000000000001','damaged','x','64000000-0000-4000-8000-000000000002')$$,
  '23503',null,'a discrepancy cannot attach a receipt that belongs to a different order');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,acquisition_receipt_id,acquisition_receipt_line_id,kind,detail,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','64000000-8000-4000-8000-000000000001','64000000-8100-4000-8000-000000000003','damaged','x','64000000-0000-4000-8000-000000000002')$$,
  '23503',null,'a discrepancy cannot claim a receipt line that belongs to a different receipt');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,acquisition_receipt_id,acquisition_receipt_line_id,acquisition_line_item_id,kind,detail,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','64000000-8000-4000-8000-000000000001','64000000-8100-4000-8000-000000000001','64000000-5000-4000-8000-000000000002','damaged','x','64000000-0000-4000-8000-000000000002')$$,
  '23503',null,'a discrepancy cannot claim a receipt line that concerns a different acquisition line');

-- ==================================== GATE 7 — DIRECT-WRITE DENIAL (GUARD) ===
-- Even this privileged session cannot rewrite or erase receiving evidence
-- without declaring itself a governed receiving mutation.
select throws_ok($$update public.acquisition_receipts set note='rewritten' where id='64000000-8000-4000-8000-000000000001'$$,
  '42501','governed_write_required','an undeclared session cannot update a receipt');
select throws_ok($$update public.acquisition_receipt_lines set quantity_received=99 where id='64000000-8100-4000-8000-000000000001'$$,
  '42501','governed_write_required','an undeclared session cannot rewrite observed quantity');
select throws_ok($$update public.acquisition_discrepancies set status='written_off' where id='64000000-8200-4000-8000-000000000001'$$,
  '42501','governed_write_required','an undeclared session cannot resolve a discrepancy');
select throws_ok($$delete from public.acquisition_receipt_lines where id='64000000-8100-4000-8000-000000000001'$$,
  '42501','governed_write_required','an undeclared session cannot delete receiving evidence');
select throws_ok($$delete from public.acquisition_discrepancies where id='64000000-8200-4000-8000-000000000001'$$,
  '42501','governed_write_required','an undeclared session cannot delete discrepancy evidence');
select throws_ok($$truncate public.acquisition_receipt_lines cascade$$,
  '42501',null,'receiving evidence cannot be truncated');
-- A session that DOES declare itself a governed receiving mutation — the path
-- S2.2's SECURITY DEFINER functions will take — passes the guard. The guard is
-- a declaration boundary, not a freeze.
select lives_ok($q$do $x$ begin
  perform set_config('app.governed_receiving_mutation','on',true);
  update public.acquisition_receipts set status='submitted', updated_at=now()
   where id='64000000-8000-4000-8000-000000000001';
  perform set_config('app.governed_receiving_mutation','off',true);
end $x$;$q$,
  'a declared governed receiving mutation passes the guard');
select is((select status::text from public.acquisition_receipts where id='64000000-8000-4000-8000-000000000001'),
  'submitted','the declared mutation actually applied');
select throws_ok($$update public.acquisition_receipts set note='x' where id='64000000-8000-4000-8000-000000000002'$$,
  '42501','governed_write_required','the declaration does not leak past the statement that set it');

-- ======================================== GATE 7 — AUTHENTICATED DIRECT WRITE
select pg_temp.as_user('64000000-0000-4000-8000-000000000002');
select throws_ok($$insert into public.acquisition_receipts(workspace_id,acquisition_order_id,create_idempotency_key,create_fingerprint,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','s21-direct-1',repeat('b',64),'64000000-0000-4000-8000-000000000002')$$,
  '42501',null,'an authenticated operator cannot directly insert a receipt');
select throws_ok($$insert into public.acquisition_receipt_lines(workspace_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-8000-4000-8000-000000000001','64000000-5000-4000-8000-000000000002',1,'64000000-0000-4000-8000-000000000002')$$,
  '42501',null,'an authenticated operator cannot directly insert a receipt line');
select throws_ok($$insert into public.acquisition_discrepancies(workspace_id,acquisition_order_id,kind,detail,created_by)
  values('64000000-1000-4000-8000-000000000001','64000000-7200-4000-8000-000000000001','damaged','x','64000000-0000-4000-8000-000000000002')$$,
  '42501',null,'an authenticated operator cannot directly insert a discrepancy');
select throws_ok($$update public.acquisition_receipts set note='x' where id='64000000-8000-4000-8000-000000000001'$$,
  '42501',null,'an authenticated operator cannot directly update a receipt');
select throws_ok($$update public.acquisition_receipt_lines set quantity_received=1 where id='64000000-8100-4000-8000-000000000001'$$,
  '42501',null,'an authenticated operator cannot directly update a receipt line');
select throws_ok($$update public.acquisition_discrepancies set detail='x' where id='64000000-8200-4000-8000-000000000001'$$,
  '42501',null,'an authenticated operator cannot directly update a discrepancy');
select throws_ok($$delete from public.acquisition_receipts where id='64000000-8000-4000-8000-000000000001'$$,
  '42501',null,'an authenticated operator cannot directly delete a receipt');
select throws_ok($$delete from public.acquisition_receipt_lines where id='64000000-8100-4000-8000-000000000001'$$,
  '42501',null,'an authenticated operator cannot directly delete a receipt line');
select throws_ok($$delete from public.acquisition_discrepancies where id='64000000-8200-4000-8000-000000000001'$$,
  '42501',null,'an authenticated operator cannot directly delete a discrepancy');

-- ================================================== GATE 7 — WORKSPACE READ ==
select is((select count(*)::int from public.acquisition_receipts),4,
  'a same-workspace operator reads their own receipts');
select is((select count(*)::int from public.acquisition_receipt_lines),5,
  'a same-workspace operator reads their own receipt lines');
select is((select count(*)::int from public.acquisition_discrepancies),3,
  'a same-workspace operator reads their own discrepancies');
reset role;
select pg_temp.as_user('64000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.acquisition_receipts),4,
  'a same-workspace viewer reads receiving evidence');
select is((select count(*)::int from public.acquisition_discrepancies),3,
  'a same-workspace viewer reads discrepancy evidence');
reset role;
select pg_temp.as_user('64000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.acquisition_receipts),0,
  'a foreign-workspace owner sees no receipts at all');
select is((select count(*)::int from public.acquisition_receipt_lines),0,
  'a foreign-workspace owner sees no receipt lines at all');
select is((select count(*)::int from public.acquisition_discrepancies),0,
  'a foreign-workspace owner sees no discrepancies at all');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.acquisition_receipts$$,
  '42501',null,'anonymous callers cannot read receipts');
select throws_ok($$select count(*) from public.acquisition_receipt_lines$$,
  '42501',null,'anonymous callers cannot read receipt lines');
select throws_ok($$select count(*) from public.acquisition_discrepancies$$,
  '42501',null,'anonymous callers cannot read discrepancies');
reset role;

-- ================================ GATE 5/15 — SOURCE AND SHIPMENT UNCHANGED ==
-- Nothing in this file mutated the EXPECTED side, and nothing mutated S1.4's
-- shipment truth, even though a receipt references one of those shipments.
select is((select count(*)::int from public.acquisition_line_items l join s21_expected e on e.id=l.id
            where l.quantity is distinct from e.quantity or l.source_record_id is distinct from e.source_record_id),0,
  'every acquisition line quantity and source-record link is byte-identical after receiving');
select is((select count(*)::int from public.acquisition_line_items
            where workspace_id='64000000-1000-4000-8000-000000000001'),3,
  'no acquisition line was created or deleted by receiving');
-- Scoped to this file's workspace: earlier test files in the suite commit their
-- own fixtures, so an unscoped count here would measure them, not this slice.
select is((select count(*)::int from public.acquisition_line_classifications
            where workspace_id='64000000-1000-4000-8000-000000000001'),0,
  'no classification row was created or altered by receiving');
select is((select count(*)::int from public.acquisition_line_exclusions
            where workspace_id='64000000-1000-4000-8000-000000000001'),0,
  'no exclusion decision was created or altered by receiving');
select is((select count(*)::int from public.acquisition_payments
            where workspace_id='64000000-1000-4000-8000-000000000001'),0,
  'no payment evidence was created or altered by receiving');
select is((select count(*)::int from public.acquisition_shipments s join s21_shipments f on f.id=s.id
            where s.status is distinct from f.status or s.carrier is distinct from f.carrier
               or s.tracking_number is distinct from f.tracking_number
               or s.received_at is distinct from f.received_at or s.shipped_at is distinct from f.shipped_at),0,
  'shipment transport state is untouched by the receipt that references it');
select is((select count(*)::int from public.acquisition_shipments
            where workspace_id='64000000-1000-4000-8000-000000000001'),2,
  'no shipment was created or deleted by receiving');
select is((select count(*)::int from public.acquisition_lot_lines
            where workspace_id='64000000-1000-4000-8000-000000000001' and state='superseded'),0,
  'no acquisition placement was superseded by receiving');

-- =============================== GATE 6 — EXCLUSION BOUNDARY STAYS DYNAMIC ===
-- The eligibility contract is a function S2.2 must call, not state copied into
-- this schema. Proving both: the contract still exists and still answers, and
-- nothing in the receiving tables caches an exclusion verdict.
select has_function('app','assert_acquisition_line_eligible_for_downstream',array['uuid','uuid'],
  'the S1.5 downstream eligibility contract is the one S2.2 must call');
select lives_ok($$select app.assert_acquisition_line_eligible_for_downstream('64000000-1000-4000-8000-000000000001','64000000-5000-4000-8000-000000000001')$$,
  'the eligibility contract answers for a line that already has receiving evidence');
select is((select count(*)::int from information_schema.columns
            where table_schema='public'
              and table_name in ('acquisition_receipts','acquisition_receipt_lines','acquisition_discrepancies')
              and column_name like '%exclu%'),0,
  'no receiving table caches a copy of exclusion state');

select * from finish();
rollback;
