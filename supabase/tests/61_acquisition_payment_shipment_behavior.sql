-- S1.4 payment and shipment BEHAVIOR.
--
-- Every assertion below calls a public governed function against a real
-- committed acquisition fixture and inspects the resulting rows, events, and
-- audit trail. Nothing here inspects a function definition: a routine whose
-- source merely contains the right words but whose runtime behavior is wrong
-- must fail this file.
--
-- Fixture shape: two workspaces (A governed, B foreign), owner/operator/viewer
-- plus anonymous, two source systems, committed source and acquisition import
-- jobs, a preview job and a failed job, channels, suppliers, source records,
-- four orders in A (two committed, one preview-scoped, one failed-scoped),
-- one order in B, and lots/lines carrying an active placement.
begin;
create extension if not exists pgtap;
select plan(161);

create function pg_temp.h(p_seed text) returns text language sql immutable as $$
  select encode(sha256(p_seed::bytea), 'hex')
$$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- Counts business audit events of one type for one governed public id.
create function pg_temp.audit_count(p_type text, p_key text, p_value text) returns int language sql as $$
  select count(*)::int from public.audit_events where event_type=p_type and detail->>p_key=p_value
$$;

-- ---------------------------------------------------------------- fixture --
insert into auth.users(id,email) values
 ('61000000-0000-4000-8000-000000000001','owner61@example.test'),
 ('61000000-0000-4000-8000-000000000002','operator61@example.test'),
 ('61000000-0000-4000-8000-000000000003','viewer61@example.test'),
 ('61000000-0000-4000-8000-000000000004','ownerb61@example.test');
insert into public.workspaces(id,name,created_by) values
 ('61000000-1000-4000-8000-000000000001','S1.4 behavior A','61000000-0000-4000-8000-000000000001'),
 ('61000000-1000-4000-8000-000000000002','S1.4 behavior B','61000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('61000000-1000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','operator'),
 ('61000000-1000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','viewer');
insert into public.source_systems(id,workspace_id,public_id,kind,instance_label,created_by) values
 ('61000000-2000-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','SRC-61-A','manual','A source','61000000-0000-4000-8000-000000000001'),
 ('61000000-2000-4000-8000-000000000002','61000000-1000-4000-8000-000000000002','SRC-61-B','manual','B source','61000000-0000-4000-8000-000000000004');
-- Staged while the source imports are still previews, then committed, exactly
-- as the governed import workflow orders it.
insert into public.import_jobs(id,workspace_id,public_id,source_system_id,source_label,file_sha256,content_sha256,parser_version,mapping_version,idempotency_key,mode,status,source_row_count,accepted_row_count,issue_row_count,source_totals,actor_user_id,actor_process) values
 ('61000000-3000-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','IMP-61-A','61000000-2000-4000-8000-000000000001','fixture',repeat('a',64),repeat('b',64),'1.0.0','1.0.0','s14-behavior-a','commit','preview',4,0,0,'{}','61000000-0000-4000-8000-000000000001','test.import'),
 ('61000000-3000-4000-8000-000000000002','61000000-1000-4000-8000-000000000002','IMP-61-B','61000000-2000-4000-8000-000000000002','fixture',repeat('c',64),repeat('d',64),'1.0.0','1.0.0','s14-behavior-b','commit','preview',1,0,0,'{}','61000000-0000-4000-8000-000000000004','test.import');
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process) values
 ('61000000-5100-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','61000000-3000-4000-8000-000000000001',0,'a-row-1','{"product_name":"sealed booster box","business_vertical":"Pokémon / TCG"}',pg_temp.h('a-row-1'),'parsed','{}','1.0.0','1.0.0','test.import'),
 ('61000000-5100-4000-8000-000000000002','61000000-1000-4000-8000-000000000001','61000000-3000-4000-8000-000000000001',1,'a-row-2','{"product_name":"second line"}',pg_temp.h('a-row-2'),'parsed','{}','1.0.0','1.0.0','test.import'),
 ('61000000-5100-4000-8000-000000000003','61000000-1000-4000-8000-000000000001','61000000-3000-4000-8000-000000000001',2,'a-row-3','{"product_name":"preview line"}',pg_temp.h('a-row-3'),'parsed','{}','1.0.0','1.0.0','test.import'),
 ('61000000-5100-4000-8000-000000000004','61000000-1000-4000-8000-000000000001','61000000-3000-4000-8000-000000000001',3,'a-row-4','{"product_name":"failed line"}',pg_temp.h('a-row-4'),'parsed','{}','1.0.0','1.0.0','test.import'),
 ('61000000-5100-4000-8000-000000000005','61000000-1000-4000-8000-000000000002','61000000-3000-4000-8000-000000000002',0,'b-row-1','{"product_name":"foreign line"}',pg_temp.h('b-row-1'),'parsed','{}','1.0.0','1.0.0','test.import');
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=4 where id='61000000-3000-4000-8000-000000000001';
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=1 where id='61000000-3000-4000-8000-000000000002';
insert into public.channels(id,workspace_id,public_id,name,kind,created_by) values
 ('61000000-6000-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','RV-CH-61A001','A channel','manual','61000000-0000-4000-8000-000000000001'),
 ('61000000-6000-4000-8000-000000000002','61000000-1000-4000-8000-000000000002','RV-CH-61B001','B channel','manual','61000000-0000-4000-8000-000000000004');
insert into public.suppliers(id,workspace_id,public_id,display_name,created_by_process) values
 ('61000000-7000-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','RV-SUP-61A001','A seller','test.import'),
 ('61000000-7000-4000-8000-000000000002','61000000-1000-4000-8000-000000000002','RV-SUP-61B001','B seller','test.import');
-- Committed, preview, and failed acquisition import jobs. The governed
-- functions must resolve orders ONLY through a committed job.
insert into public.acquisition_import_jobs(id,workspace_id,channel_id,source_import_job_id,idempotency_key,mode,status,expected_line_count,mapping_version,plan_sha256,committed_orders,committed_lots,committed_line_items,committed_cost_components,committed_unresolved_supplier_candidates,committed_unresolved_cost_components,actor_user_id,actor_process,completed_at) values
 ('61000000-4000-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','61000000-6000-4000-8000-000000000001','61000000-3000-4000-8000-000000000001','s14-a-commit','commit','preview',2,'1.0.0',repeat('e',64),null,null,null,null,null,null,'61000000-0000-4000-8000-000000000001','test.import',null),
 ('61000000-4000-4000-8000-000000000002','61000000-1000-4000-8000-000000000001','61000000-6000-4000-8000-000000000001','61000000-3000-4000-8000-000000000001','s14-a-preview','commit','preview',1,'1.0.0',repeat('f',64),null,null,null,null,null,null,'61000000-0000-4000-8000-000000000001','test.import',null),
 ('61000000-4000-4000-8000-000000000003','61000000-1000-4000-8000-000000000001','61000000-6000-4000-8000-000000000001','61000000-3000-4000-8000-000000000001','s14-a-failed','commit','preview',1,'1.0.0',repeat('1',64),null,null,null,null,null,null,'61000000-0000-4000-8000-000000000001','test.import',null),
 ('61000000-4000-4000-8000-000000000004','61000000-1000-4000-8000-000000000002','61000000-6000-4000-8000-000000000002','61000000-3000-4000-8000-000000000002','s14-b-commit','commit','preview',1,'1.0.0',repeat('2',64),null,null,null,null,null,null,'61000000-0000-4000-8000-000000000004','test.import',null);
insert into public.acquisition_line_items(id,workspace_id,public_id,source_system_id,source_record_id,acquisition_import_job_id,quantity,source_detail,created_by_process) values
 ('61000000-5000-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','LINE-61-A1','61000000-2000-4000-8000-000000000001','61000000-5100-4000-8000-000000000001','61000000-4000-4000-8000-000000000001',2,'{"product_name":"sealed booster box","business_vertical":"Pokémon / TCG"}','test.import'),
 ('61000000-5000-4000-8000-000000000002','61000000-1000-4000-8000-000000000001','LINE-61-A2','61000000-2000-4000-8000-000000000001','61000000-5100-4000-8000-000000000002','61000000-4000-4000-8000-000000000001',1,'{"product_name":"second line"}','test.import'),
 ('61000000-5000-4000-8000-000000000003','61000000-1000-4000-8000-000000000001','LINE-61-P1','61000000-2000-4000-8000-000000000001','61000000-5100-4000-8000-000000000003','61000000-4000-4000-8000-000000000002',1,'{"product_name":"preview line"}','test.import'),
 ('61000000-5000-4000-8000-000000000004','61000000-1000-4000-8000-000000000001','LINE-61-F1','61000000-2000-4000-8000-000000000001','61000000-5100-4000-8000-000000000004','61000000-4000-4000-8000-000000000003',1,'{"product_name":"failed line"}','test.import'),
 ('61000000-5000-4000-8000-000000000005','61000000-1000-4000-8000-000000000002','LINE-61-B1','61000000-2000-4000-8000-000000000002','61000000-5100-4000-8000-000000000005','61000000-4000-4000-8000-000000000004',1,'{"product_name":"foreign line"}','test.import');
-- Only jobs 1 and 4 reach committed. Job 2 stays a preview and job 3 fails, so
-- the orders hanging off them must stay invisible to every governed function.
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=2,committed_lots=2,committed_line_items=2,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='61000000-4000-4000-8000-000000000001';
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=1,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='61000000-4000-4000-8000-000000000004';
update public.acquisition_import_jobs set status='failed',completed_at=now(),failure_code='test_fixture_failure',failure_detail='deliberately failed acquisition import' where id='61000000-4000-4000-8000-000000000003';
-- Orders/lots/placements are append-only through governed import; the fixture
-- writes them directly, exactly as the established acquisition tests do.
set local session_replication_role=replica;
insert into public.acquisition_orders(id,workspace_id,public_id,channel_id,supplier_id,source_system_id,acquisition_import_job_id,source_order_reference,first_source_record_id,order_status,source_reported_status,source_reported_total_minor,currency,occurred_at,created_by_process) values
 ('61000000-7200-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','61000000-6000-4000-8000-000000000001','61000000-7000-4000-8000-000000000001','61000000-2000-4000-8000-000000000001','61000000-4000-4000-8000-000000000001','ORDER-61-A1','61000000-5100-4000-8000-000000000001','unknown','shipped',5000,'USD','2026-08-01T10:00:00Z','test.import'),
 ('61000000-7200-4000-8000-000000000002','61000000-1000-4000-8000-000000000001','RV-ACQ-61A002','61000000-6000-4000-8000-000000000001','61000000-7000-4000-8000-000000000001','61000000-2000-4000-8000-000000000001','61000000-4000-4000-8000-000000000001','ORDER-61-A2','61000000-5100-4000-8000-000000000002','unknown',null,null,null,'2026-08-02T10:00:00Z','test.import'),
 ('61000000-7200-4000-8000-000000000003','61000000-1000-4000-8000-000000000001','RV-ACQ-61P001','61000000-6000-4000-8000-000000000001','61000000-7000-4000-8000-000000000001','61000000-2000-4000-8000-000000000001','61000000-4000-4000-8000-000000000002','ORDER-61-P1','61000000-5100-4000-8000-000000000003','unknown',null,null,null,null,'test.import'),
 ('61000000-7200-4000-8000-000000000004','61000000-1000-4000-8000-000000000001','RV-ACQ-61F001','61000000-6000-4000-8000-000000000001','61000000-7000-4000-8000-000000000001','61000000-2000-4000-8000-000000000001','61000000-4000-4000-8000-000000000003','ORDER-61-F1','61000000-5100-4000-8000-000000000004','unknown',null,null,null,null,'test.import'),
 ('61000000-7200-4000-8000-000000000005','61000000-1000-4000-8000-000000000002','RV-ACQ-61B001','61000000-6000-4000-8000-000000000002','61000000-7000-4000-8000-000000000002','61000000-2000-4000-8000-000000000002','61000000-4000-4000-8000-000000000004','ORDER-61-B1','61000000-5100-4000-8000-000000000005','unknown',null,null,null,null,'test.import');
insert into public.acquisition_lots(id,workspace_id,public_id,order_id,created_by_process) values
 ('61000000-7300-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','RV-ALOT-61A001','61000000-7200-4000-8000-000000000001','test.import'),
 ('61000000-7300-4000-8000-000000000002','61000000-1000-4000-8000-000000000001','RV-ALOT-61A002','61000000-7200-4000-8000-000000000002','test.import'),
 ('61000000-7300-4000-8000-000000000003','61000000-1000-4000-8000-000000000001','RV-ALOT-61P001','61000000-7200-4000-8000-000000000003','test.import'),
 ('61000000-7300-4000-8000-000000000004','61000000-1000-4000-8000-000000000001','RV-ALOT-61F001','61000000-7200-4000-8000-000000000004','test.import'),
 ('61000000-7300-4000-8000-000000000005','61000000-1000-4000-8000-000000000002','RV-ALOT-61B001','61000000-7200-4000-8000-000000000005','test.import');
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,created_by_process) values
 ('61000000-7400-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','61000000-7300-4000-8000-000000000001','61000000-5000-4000-8000-000000000001','test.import'),
 ('61000000-7400-4000-8000-000000000002','61000000-1000-4000-8000-000000000001','61000000-7300-4000-8000-000000000002','61000000-5000-4000-8000-000000000002','test.import'),
 ('61000000-7400-4000-8000-000000000003','61000000-1000-4000-8000-000000000001','61000000-7300-4000-8000-000000000003','61000000-5000-4000-8000-000000000003','test.import'),
 ('61000000-7400-4000-8000-000000000004','61000000-1000-4000-8000-000000000001','61000000-7300-4000-8000-000000000004','61000000-5000-4000-8000-000000000004','test.import'),
 ('61000000-7400-4000-8000-000000000005','61000000-1000-4000-8000-000000000002','61000000-7300-4000-8000-000000000005','61000000-5000-4000-8000-000000000005','test.import');
set local session_replication_role=origin;

-- A missing custom GUC must fail closed even for the privileged migration/test
-- role. These fixture rows are removed with triggers disabled after the guard
-- assertions so the governed lifecycle below remains unchanged.
set local session_replication_role=replica;
insert into public.acquisition_payments(id,workspace_id,public_id,acquisition_order_id,paid_at,amount_minor,currency,instrument,idempotency_key,payload_fingerprint,created_by) values
 ('61000000-7600-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','RV-APAY-GUARD61','61000000-7200-4000-8000-000000000001','2026-08-03T08:00:00Z',25,'USD','cash','guard-pay-key-61',repeat('a',64),'61000000-0000-4000-8000-000000000001');
insert into public.acquisition_shipments(id,workspace_id,public_id,acquisition_order_id,status,create_idempotency_key,create_fingerprint,created_by) values
 ('61000000-7700-4000-8000-000000000001','61000000-1000-4000-8000-000000000001','RV-ASHIP-GUARD61','61000000-7200-4000-8000-000000000001','expected','guard-ship-key-61',repeat('b',64),'61000000-0000-4000-8000-000000000001');
set local session_replication_role=origin;
select is(current_setting('app.governed_acquisition_mutation',true),null,'the acquisition mutation GUC is genuinely unset');
select throws_ok($$update public.acquisition_payments set evidence_note='direct rewrite' where id='61000000-7600-4000-8000-000000000001'$$,'42501','governed_write_required','privileged direct payment UPDATE fails closed with the GUC unset');
select throws_ok($$delete from public.acquisition_payments where id='61000000-7600-4000-8000-000000000001'$$,'42501','governed_write_required','privileged direct payment DELETE fails closed with the GUC unset');
select throws_ok($$update public.acquisition_shipments set evidence_note='direct rewrite' where id='61000000-7700-4000-8000-000000000001'$$,'42501','governed_write_required','privileged direct shipment UPDATE fails closed with the GUC unset');
select throws_ok($$delete from public.acquisition_shipments where id='61000000-7700-4000-8000-000000000001'$$,'42501','governed_write_required','privileged direct shipment DELETE fails closed with the GUC unset');
set local session_replication_role=replica;
delete from public.acquisition_payments where id='61000000-7600-4000-8000-000000000001';
delete from public.acquisition_shipments where id='61000000-7700-4000-8000-000000000001';
set local session_replication_role=origin;

-- =========================================================== anonymous ======
set local role anon;
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',now(),1,'USD','cash',null,null,null,'anon-pay-key')$$,'42501',null,'anonymous payment is denied');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-APAY-XXXXXX','reason','anon-rev-key')$$,'42501',null,'anonymous reversal is denied');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'anon-ship-key')$$,'42501',null,'anonymous shipment is denied');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ASHIP-XXXXXX','expected','in_transit',null,null,'anon-tran-key')$$,'42501',null,'anonymous transition is denied');
reset role;

-- ==================================================== payment creation ======
select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
-- Owner records a real payment and it lands as a real row.
select is(public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','2026-08-03T09:00:00Z',1500,'USD','card',null,null,null,'pay-owner-key-1')->>'replayed','false','owner payment succeeds');
select is((select count(*)::int from public.acquisition_payments where workspace_id='61000000-1000-4000-8000-000000000001' and idempotency_key='pay-owner-key-1'),1,'owner payment inserted exactly one row');
select is((select amount_minor from public.acquisition_payments where idempotency_key='pay-owner-key-1'),1500::bigint,'owner payment stored the exact minor units');
select is((select currency from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'USD','owner payment stored the exact currency');
select is((select instrument::text from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'card','owner payment stored the exact instrument');
select is(pg_temp.audit_count('acquisition_payment_recorded','payment_public_id',(select public_id from public.acquisition_payments where idempotency_key='pay-owner-key-1')),1,'owner payment emitted exactly one audit event');
-- Large value proves bigint minor units, not an integer-truncating path.
select is(public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','2026-08-03T09:05:00Z',9007199254740993,'USD','bank',null,null,null,'pay-bigint-key-1')->>'replayed','false','a payment beyond 2^53 is accepted');
select is((select amount_minor from public.acquisition_payments where idempotency_key='pay-bigint-key-1'),9007199254740993::bigint,'bigint minor units survive exactly');
-- Currency normalization and the closed vocabularies.
select is(public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','2026-08-03T09:10:00Z',100,'usd','cash',null,null,null,'pay-lower-cur-key')->>'replayed','false','lowercase currency is accepted');
select is((select currency from public.acquisition_payments where idempotency_key='pay-lower-cur-key'),'USD','lowercase currency is normalized to uppercase');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',now(),0,'USD','cash',null,null,null,'pay-zero-key-1')$$,'22023','invalid_request','a zero payment is rejected');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',now(),-5,'USD','cash',null,null,null,'pay-neg-key-1')$$,'22023','invalid_request','a negative payment is rejected');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,100,'USD','cash',null,null,null,'pay-nodate-key-1')$$,'22023','invalid_request','a payment without a date is rejected');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',now(),100,'US1','cash',null,null,null,'pay-badcur-key-1')$$,'22023','invalid_currency','an invalid currency is rejected');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',now(),100,'USD','wire',null,null,null,'pay-badinst-key-1')$$,'22023','invalid_instrument','an instrument outside the closed vocabulary is rejected');
-- Committed-order gating.
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-MISSING',now(),100,'USD','cash',null,null,null,'pay-missing-key-1')$$,'P0002','acquisition_not_found','a missing order is rejected');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61P001',now(),100,'USD','cash',null,null,null,'pay-preview-key-1')$$,'P0002','acquisition_not_found','a preview acquisition job is rejected');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61F001',now(),100,'USD','cash',null,null,null,'pay-failed-key-1')$$,'P0002','acquisition_not_found','a failed acquisition job is rejected');
-- Source evidence must belong to the same workspace.
select is(public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','2026-08-03T09:15:00Z',250,'USD','cash',null,'61000000-5100-4000-8000-000000000001',null,'pay-evidence-key-1')->>'replayed','false','same-workspace source evidence is accepted');
select is((select source_record_id from public.acquisition_payments where idempotency_key='pay-evidence-key-1'),'61000000-5100-4000-8000-000000000001'::uuid,'accepted source evidence is stored exactly');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',now(),250,'USD','cash',null,'61000000-5100-4000-8000-000000000005',null,'pay-foreign-ev-key')$$,'22023','invalid_source_evidence','foreign-workspace source evidence is rejected');
-- Idempotent replay.
select is(public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','2026-08-03T09:00:00Z',1500,'USD','card',null,null,null,'pay-owner-key-1')->>'replayed','true','identical payment replay reports a replay');
select is(public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','2026-08-03T09:00:00Z',1500,'USD','card',null,null,null,'pay-owner-key-1')->>'paymentPublicId',(select public_id from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'identical payment replay returns the same payment public ID');
select is((select count(*)::int from public.acquisition_payments where idempotency_key='pay-owner-key-1'),1,'identical payment replay creates exactly one payment row');
select is(pg_temp.audit_count('acquisition_payment_recorded','payment_public_id',(select public_id from public.acquisition_payments where idempotency_key='pay-owner-key-1')),1,'identical payment replay creates exactly one audit event');
-- One key, one meaning.
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','2026-08-03T09:00:00Z',1600,'USD','card',null,null,null,'pay-owner-key-1')$$,'23505','idempotency_conflict','a changed payment payload under the same key fails');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A002','2026-08-03T09:00:00Z',1500,'USD','card',null,null,null,'pay-owner-key-1')$$,'23505','idempotency_conflict','one payment key cannot represent two orders');
-- Duplicate active external reference is a bounded, named error.
select is(public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','2026-08-03T09:20:00Z',300,'USD','card','EXT-REF-61',null,null,'pay-ext-key-1')->>'replayed','false','an external reference is accepted once');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A002','2026-08-03T09:25:00Z',400,'USD','card','ext-ref-61',null,null,'pay-ext-key-2')$$,'23505','duplicate_external_reference','a duplicate active external reference returns the exact bounded error');
select is((select count(*)::int from public.acquisition_payments where lower(external_reference)='ext-ref-61'),1,'the duplicate external reference created no second row');

-- Operator may record payments; viewer may not.
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000002');
select is(public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','2026-08-03T10:00:00Z',700,'USD','balance',null,null,null,'pay-operator-key-1')->>'replayed','false','operator payment succeeds');
select is((select created_by from public.acquisition_payments where idempotency_key='pay-operator-key-1'),'61000000-0000-4000-8000-000000000002'::uuid,'operator payment records the acting operator');
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000003');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',now(),100,'USD','cash',null,null,null,'pay-viewer-key-1')$$,'42501',null,'viewer may not record a payment');
-- Workspace isolation: A's owner has no authority in B, and learns nothing.
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000002','RV-ACQ-61B001',now(),100,'USD','cash',null,null,null,'pay-cross-key-1')$$,'42501',null,'a payment into a foreign workspace is denied');
-- The same external reference in a different workspace is a different fact.
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000004');
select is(public.record_acquisition_payment('61000000-1000-4000-8000-000000000002','RV-ACQ-61B001','2026-08-03T09:20:00Z',300,'USD','card','EXT-REF-61',null,null,'pay-b-ext-key-1')->>'replayed','false','a foreign workspace may reuse the same external reference');
-- Counted outside RLS: B's member must never SEE A's row, only coexist with it.
reset role;
select is((select count(*)::int from public.acquisition_payments where lower(external_reference)='ext-ref-61'),2,'external-reference uniqueness is scoped per workspace');
select pg_temp.as_user('61000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.acquisition_payments where lower(external_reference)='ext-ref-61'),1,'a foreign member still sees only its own workspace payment');

-- Audit failure must roll the payment back with it.
reset role;
create function public.s14_fail_payment_audit() returns trigger language plpgsql as $$
begin if new.event_type='acquisition_payment_recorded' and new.detail->>'order_public_id'='RV-ACQ-61A002' then raise exception 'test audit failure' using errcode='23514'; end if; return new; end $$;
create trigger s14_fail_payment_audit before insert on public.audit_events for each row execute function public.s14_fail_payment_audit();
select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select throws_ok($$select public.record_acquisition_payment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A002','2026-08-03T11:00:00Z',900,'USD','cash',null,null,null,'pay-auditfail-key')$$,'23514',null,'a failing audit event surfaces atomically');
select is((select count(*)::int from public.acquisition_payments where idempotency_key='pay-auditfail-key'),0,'a failed audit event rolls the payment insertion back');
reset role;
drop trigger s14_fail_payment_audit on public.audit_events;
drop function public.s14_fail_payment_audit();

-- ==================================================== payment reversal ======
select pg_temp.as_user('61000000-0000-4000-8000-000000000002');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'operator attempt','rev-operator-key')$$,'42501',null,'operator may not reverse a payment');
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000003');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'viewer attempt','rev-viewer-key')$$,'42501',null,'viewer may not reverse a payment');
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'  ','rev-noreason-key')$$,'22023','invalid_request','a reversal reason is required');

create temporary table s14_rev(k text primary key, payment text, reversal text);
insert into s14_rev(k,payment) select 'r1',public_id from public.acquisition_payments where idempotency_key='pay-owner-key-1';
insert into s14_rev(k,payment) select 'r2',public_id from public.acquisition_payments where idempotency_key='pay-operator-key-1';
update s14_rev set reversal=(public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',payment,'duplicate charge','rev-owner-key-1')->>'reversalPublicId') where k='r1';
select is((select state from (select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',payment,'duplicate charge','rev-owner-key-1')->>'state' as state from s14_rev where k='r1') s),'reversed','owner reversal succeeds');
select is((select count(*)::int from public.acquisition_payment_reversals where idempotency_key='rev-owner-key-1'),1,'reversal inserted exactly one durable event');
select is((select p.reversal_event_id from public.acquisition_payments p where p.idempotency_key='pay-owner-key-1'),(select e.id from public.acquisition_payment_reversals e where e.idempotency_key='rev-owner-key-1'),'the payment links to the exact reversal event');
select is((select e.reason from public.acquisition_payment_reversals e where e.idempotency_key='rev-owner-key-1'),'duplicate charge','the reversal event stores the exact reason');
select is((select reversed_by from public.acquisition_payment_reversals where idempotency_key='rev-owner-key-1'),'61000000-0000-4000-8000-000000000001'::uuid,'the reversal event records the acting owner');
-- Reversal preserves, never edits, the original payment facts.
select is((select amount_minor from public.acquisition_payments where idempotency_key='pay-owner-key-1'),1500::bigint,'reversal leaves the original amount unchanged');
select is((select currency from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'USD','reversal leaves the original currency unchanged');
select is((select paid_at from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'2026-08-03T09:00:00Z'::timestamptz,'reversal leaves the original payment date unchanged');
select is((select instrument::text from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'card','reversal leaves the original instrument unchanged');
select ok((select reversed_at is not null from public.acquisition_payments where idempotency_key='pay-owner-key-1'),'the reversed payment is marked reversed');
-- Reversal replay.
select is((select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',payment,'duplicate charge','rev-owner-key-1')->>'replayed' from s14_rev where k='r1'),'true','identical reversal replay reports a replay');
select is((select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',payment,'duplicate charge','rev-owner-key-1')->>'reversalPublicId' from s14_rev where k='r1'),(select reversal from s14_rev where k='r1'),'identical reversal replay returns the same reversal public ID');
select is((select count(*)::int from public.acquisition_payment_reversals where idempotency_key='rev-owner-key-1'),1,'reversal replay creates no second event');
select is(pg_temp.audit_count('acquisition_payment_reversed','reversal_public_id',(select reversal from s14_rev where k='r1')),1,'reversal replay creates no second audit event');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',(select payment from s14_rev where k='r1'),'different reason','rev-owner-key-1')$$,'23505','idempotency_conflict','a changed reversal payload under the same key fails');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',(select payment from s14_rev where k='r2'),'duplicate charge','rev-owner-key-1')$$,'23505','idempotency_conflict','one reversal key cannot reverse two payments');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',(select payment from s14_rev where k='r1'),'second attempt','rev-owner-key-2')$$,'23505','already_reversed','a second independent reversal of one payment fails');
select is((select count(*)::int from public.acquisition_payment_reversals where acquisition_payment_id=(select id from public.acquisition_payments where idempotency_key='pay-owner-key-1')),1,'the refused second reversal left exactly one event');

-- Reversal rollback matrix.
reset role;
create function public.s14_fail_reversal_event() returns trigger language plpgsql as $$
begin if new.reason='EVENT-FAIL' then raise exception 'test reversal event failure' using errcode='23514'; end if; return new; end $$;
create trigger s14_fail_reversal_event before insert on public.acquisition_payment_reversals for each row execute function public.s14_fail_reversal_event();
select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',(select payment from s14_rev where k='r2'),'EVENT-FAIL','rev-eventfail-key')$$,'23514',null,'a failing reversal-event insertion surfaces atomically');
select ok((select reversed_at is null from public.acquisition_payments where idempotency_key='pay-operator-key-1'),'a failed reversal-event insertion leaves the payment active');
reset role;
drop trigger s14_fail_reversal_event on public.acquisition_payment_reversals;
drop function public.s14_fail_reversal_event();
create function public.s14_fail_payment_update() returns trigger language plpgsql as $$
begin if new.reversal_reason='UPDATE-FAIL' then raise exception 'test payment update failure' using errcode='23514'; end if; return new; end $$;
create trigger s14_fail_payment_update before update on public.acquisition_payments for each row execute function public.s14_fail_payment_update();
select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select throws_ok($$select public.reverse_acquisition_payment('61000000-1000-4000-8000-000000000001',(select payment from s14_rev where k='r2'),'UPDATE-FAIL','rev-updfail-key')$$,'23514',null,'a failing payment update surfaces atomically');
select is((select count(*)::int from public.acquisition_payment_reversals where idempotency_key='rev-updfail-key'),0,'a failed payment update rolls the reversal event back');
select ok((select reversed_at is null from public.acquisition_payments where idempotency_key='pay-operator-key-1'),'the payment remains active after the rolled-back reversal');
reset role;
drop trigger s14_fail_payment_update on public.acquisition_payments;
drop function public.s14_fail_payment_update();

-- The reversal is visible in the governed detail response.
select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select is((select jsonb_array_length(public.get_acquisition_line_detail_by_source('61000000-1000-4000-8000-000000000001','SRC-61-A','LINE-61-A1')->'payments')),6,'detail lists every payment recorded against the order');
select is((select p->'reversalEvent'->>'reason' from jsonb_array_elements(public.get_acquisition_line_detail_by_source('61000000-1000-4000-8000-000000000001','SRC-61-A','LINE-61-A1')->'payments') p where p->>'publicId'=(select payment from s14_rev where k='r1')),'duplicate charge','detail carries the reversal event and its reason');
select is((select p->>'state' from jsonb_array_elements(public.get_acquisition_line_detail_by_source('61000000-1000-4000-8000-000000000001','SRC-61-A','LINE-61-A1')->'payments') p where p->>'publicId'=(select payment from s14_rev where k='r1')),'reversed','detail reports the reversed state as history, not deletion');

-- =================================================== shipment creation ======
select is(public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'ship-owner-key-1')->>'status','expected','owner shipment succeeds as expected');
select is((select count(*)::int from public.acquisition_shipments where create_idempotency_key='ship-owner-key-1'),1,'owner shipment inserted exactly one row');
select is(pg_temp.audit_count('acquisition_shipment_created','shipment_public_id',(select public_id from public.acquisition_shipments where create_idempotency_key='ship-owner-key-1')),1,'owner shipment emitted exactly one audit event');
select is(public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'in_transit',null,null,null,null,'ship-intransit-key')->>'status','in_transit','an initially in_transit shipment succeeds');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'delivered',null,null,null,null,'ship-delivered-key')$$,'22023','invalid_initial_status','an initially delivered shipment is rejected');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'lost',null,null,null,null,'ship-lost-key')$$,'22023','invalid_initial_status','an initially lost shipment is rejected');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'cancelled',null,null,null,null,'ship-cancel-key')$$,'22023','invalid_initial_status','an initially cancelled shipment is rejected');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-MISSING',null,null,null,null,'expected',null,null,null,null,'ship-missing-key')$$,'P0002','acquisition_not_found','a shipment against a missing order is rejected');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61P001',null,null,null,null,'expected',null,null,null,null,'ship-preview-key')$$,'P0002','acquisition_not_found','a shipment against a preview acquisition job is rejected');
-- Raw carrier and tracking evidence survives exactly as entered.
select is(public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','USPS Priority Mail','9400 1234-5678',null,null,'expected',null,null,null,null,'ship-tracked-key-1')->>'status','expected','a tracked shipment succeeds');
select is((select carrier from public.acquisition_shipments where create_idempotency_key='ship-tracked-key-1'),'USPS Priority Mail','raw carrier capitalization is retained');
select is((select tracking_number from public.acquisition_shipments where create_idempotency_key='ship-tracked-key-1'),'9400 1234-5678','raw tracking spaces and punctuation are retained');
-- ...but duplicate identity is decided on the NORMALIZED form.
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A002','usps priority mail','940012345678',null,null,'expected',null,null,null,null,'ship-dup-track-key')$$,'23505','duplicate_tracking','a normalized-equivalent tracking number is a duplicate');
select is((select count(*)::int from public.acquisition_shipments where lower(carrier)='usps priority mail'),1,'the duplicate tracking attempt created no second row');
select is(public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'ship-untracked-key-2')->>'status','expected','a second untracked shipment is not a duplicate');
-- Replay and key discipline.
select is(public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','USPS Priority Mail','9400 1234-5678',null,null,'expected',null,null,null,null,'ship-tracked-key-1')->>'replayed','true','identical shipment replay reports a replay');
select is(public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','USPS Priority Mail','9400 1234-5678',null,null,'expected',null,null,null,null,'ship-tracked-key-1')->>'shipmentPublicId',(select public_id from public.acquisition_shipments where create_idempotency_key='ship-tracked-key-1'),'identical shipment replay returns the same shipment');
select is((select count(*)::int from public.acquisition_shipments where create_idempotency_key='ship-tracked-key-1'),1,'identical shipment replay creates exactly one row');
select is(pg_temp.audit_count('acquisition_shipment_created','shipment_public_id',(select public_id from public.acquisition_shipments where create_idempotency_key='ship-tracked-key-1')),1,'identical shipment replay creates exactly one audit event');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001','FedEx','9400 1234-5678',null,null,'expected',null,null,null,null,'ship-tracked-key-1')$$,'23505','idempotency_conflict','a changed shipment payload under one key fails');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A002',null,null,null,null,'expected',null,null,null,null,'ship-owner-key-1')$$,'23505','idempotency_conflict','one shipment key cannot represent two orders');
-- Shipping reference amount, currency pairing, and date ordering.
select is(public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',1250,'usd',null,null,'ship-cost-key-1')->>'status','expected','a paired shipping reference amount is accepted');
select is((select currency from public.acquisition_shipments where create_idempotency_key='ship-cost-key-1'),'USD','the shipping reference currency is normalized');
select is((select shipping_cost_minor from public.acquisition_shipments where create_idempotency_key='ship-cost-key-1'),1250::bigint,'the shipping reference amount is stored exactly');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',1250,null,null,null,'ship-nocur-key')$$,'22023','invalid_currency','a shipping amount without a currency is rejected');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,'USD',null,null,'ship-noamt-key')$$,'22023','invalid_currency','a shipping currency without an amount is rejected');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,'2026-08-05T00:00:00Z','2026-08-01T00:00:00Z','expected',null,null,null,null,'ship-baddate-key')$$,'22023','invalid_request','an expected date before the shipped date is rejected');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,'61000000-5100-4000-8000-000000000005',null,'ship-foreign-ev-key')$$,'22023','invalid_source_evidence','foreign-workspace shipment evidence is rejected');
-- Operator may create shipments; viewer may not; workspaces stay isolated.
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000002');
select is(public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A002',null,null,null,null,'expected',null,null,null,null,'ship-operator-key-1')->>'status','expected','operator shipment succeeds');
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000003');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'ship-viewer-key-1')$$,'42501',null,'viewer may not create a shipment');
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select throws_ok($$select public.create_acquisition_shipment('61000000-1000-4000-8000-000000000002','RV-ACQ-61B001',null,null,null,null,'expected',null,null,null,null,'ship-cross-key-1')$$,'42501',null,'a shipment into a foreign workspace is denied');

-- ================================================ shipment transitions ======
-- Seven shipments walk every legal edge of the governed transition graph.
create temporary table s14_ship(k text primary key, id text);
insert into s14_ship
 select 's1',public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'tship-key-s1')->>'shipmentPublicId'
 union all select 's2',public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'tship-key-s2')->>'shipmentPublicId'
 union all select 's3',public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'tship-key-s3')->>'shipmentPublicId'
 union all select 's4',public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'tship-key-s4')->>'shipmentPublicId'
 union all select 's5',public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'tship-key-s5')->>'shipmentPublicId'
 union all select 's6',public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'tship-key-s6')->>'shipmentPublicId'
 union all select 's7',public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'tship-key-s7')->>'shipmentPublicId'
 union all select 's8',public.create_acquisition_shipment('61000000-1000-4000-8000-000000000001','RV-ACQ-61A001',null,null,null,null,'expected',null,null,null,null,'tship-key-s8')->>'shipmentPublicId';
create function pg_temp.ship(p_k text) returns text language sql as $$ select id from s14_ship where k=p_k $$;

-- Every legal edge, executed.
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s1'),'expected','in_transit',null,null,'tr-key-s1-a')->>'status','in_transit','expected to in_transit succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s1'),'in_transit','delivered','2026-08-04T12:00:00Z',null,'tr-key-s1-b')->>'status','delivered','in_transit to delivered succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s2'),'expected','delivered','2026-08-04T13:00:00Z',null,'tr-key-s2-a')->>'status','delivered','expected to delivered succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s3'),'expected','lost',null,'carrier reported loss','tr-key-s3-a')->>'status','lost','expected to lost succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s3'),'lost','in_transit',null,null,'tr-key-s3-b')->>'status','in_transit','lost to in_transit succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s4'),'expected','cancelled',null,'order cancelled at source','tr-key-s4-a')->>'status','cancelled','expected to cancelled succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s5'),'expected','in_transit',null,null,'tr-key-s5-a')->>'status','in_transit','a second expected to in_transit succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s5'),'in_transit','lost',null,'lost in transit','tr-key-s5-b')->>'status','lost','in_transit to lost succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s5'),'lost','delivered','2026-08-05T09:00:00Z',null,'tr-key-s5-c')->>'status','delivered','lost to delivered succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s6'),'expected','in_transit',null,null,'tr-key-s6-a')->>'status','in_transit','a third expected to in_transit succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s6'),'in_transit','cancelled',null,'cancelled while in transit','tr-key-s6-b')->>'status','cancelled','in_transit to cancelled succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s7'),'expected','lost',null,'second loss','tr-key-s7-a')->>'status','lost','a second expected to lost succeeds');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s7'),'lost','cancelled',null,'cancelled after loss','tr-key-s7-b')->>'status','cancelled','lost to cancelled succeeds');

-- Delivery evidence is recorded exactly as supplied, never invented.
select is((select received_at from public.acquisition_shipments where public_id=pg_temp.ship('s1')),'2026-08-04T12:00:00Z'::timestamptz,'the delivered timestamp is the explicitly supplied instant');
-- Terminal states and invalid edges.
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s1'),'delivered','in_transit',null,null,'tr-bad-1')$$,'22023','invalid_transition','delivered is terminal');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s4'),'cancelled','in_transit',null,null,'tr-bad-2')$$,'22023','invalid_transition','cancelled is terminal');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s6'),'cancelled','delivered','2026-08-06T00:00:00Z',null,'tr-bad-3')$$,'22023','invalid_transition','cancelled cannot become delivered');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s3'),'in_transit','expected',null,null,'tr-bad-4')$$,'22023','invalid_transition','a shipment cannot return to expected');
-- Stale expected status.
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s1'),'expected','in_transit',null,null,'tr-stale-1')$$,'40001','stale_status','a stale expected status is rejected');
-- Required evidence.
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'expected','lost',null,null,'tr-need-reason-1')$$,'22023','invalid_request','lost requires a reason');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'expected','cancelled',null,'   ','tr-need-reason-2')$$,'22023','invalid_request','cancelled requires a reason');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'expected','delivered',null,null,'tr-need-recv-1')$$,'22023','invalid_request','delivered requires an explicit received time');
-- The event ledger is the history, and the row agrees with it.
select is((select count(*)::int from public.acquisition_shipment_transitions t join public.acquisition_shipments s on s.id=t.acquisition_shipment_id where s.public_id=pg_temp.ship('s5')),3,'every applied transition persisted an event');
-- created_at defaults to now(), which is the TRANSACTION timestamp, so every
-- event in this file shares one instant and "latest by created_at" would be a
-- coin toss. Agreement is asserted against the ledger by identity instead: the
-- row must equal the to_status of the last transition actually applied, and
-- the applied edges must be exactly the walked path with nothing invented.
select is((select s.status::text from public.acquisition_shipments s where s.public_id=pg_temp.ship('s5')),(select t.to_status::text from public.acquisition_shipment_transitions t where t.idempotency_key='tr-key-s5-c'),'the current shipment state agrees with its last applied event');
select is((select array_agg(t.from_status::text||'>'||t.to_status::text order by t.from_status::text||'>'||t.to_status::text) from public.acquisition_shipment_transitions t join public.acquisition_shipments s on s.id=t.acquisition_shipment_id where s.public_id=pg_temp.ship('s5') and t.applied),array['expected>in_transit','in_transit>lost','lost>delivered'],'the applied transition edges are exactly the path that was walked');
select is((select count(*)::int from public.acquisition_shipment_transitions t join public.acquisition_shipments s on s.id=t.acquisition_shipment_id where s.public_id=pg_temp.ship('s5') and t.applied),3,'no applied transition was lost');
-- Transition replay.
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s5'),'expected','in_transit',null,null,'tr-key-s5-a')->>'replayed','true','identical transition replay reports a replay');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s5'),'expected','in_transit',null,null,'tr-key-s5-a')->>'status','in_transit','an old transition replay still returns its original outcome after later transitions');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s5'),'expected','in_transit',null,null,'tr-key-s5-a')->>'transitionPublicId',(select public_id from public.acquisition_shipment_transitions where idempotency_key='tr-key-s5-a'),'an old transition replay returns the original event');
select is((select status::text from public.acquisition_shipments where public_id=pg_temp.ship('s5')),'delivered','an old transition replay does not rewind the shipment');
select is((select count(*)::int from public.acquisition_shipment_transitions where idempotency_key='tr-key-s5-a'),1,'transition replay creates no second event');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s5'),'expected','in_transit',null,'changed reason','tr-key-s5-a')$$,'23505','idempotency_conflict','a changed transition payload under one key conflicts');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'expected','in_transit',null,null,'tr-key-s5-a')$$,'23505','idempotency_conflict','one transition key cannot operate on two shipments');
-- A no-op transition is durable evidence that someone looked, and is not a
-- business event.
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'expected','expected',null,null,'tr-noop-1')->>'applied','false','a no-op transition reports that nothing was applied');
select is((select count(*)::int from public.acquisition_shipment_transitions where idempotency_key='tr-noop-1'),1,'a no-op transition is durably recorded');
select is((select applied::text from public.acquisition_shipment_transitions where idempotency_key='tr-noop-1'),'false','the no-op event is marked unapplied');
select is((select status::text from public.acquisition_shipments where public_id=pg_temp.ship('s8')),'expected','a no-op transition leaves the shipment unchanged');
select is(pg_temp.audit_count('acquisition_shipment_transitioned','shipment_public_id',pg_temp.ship('s8')),0,'a no-op transition emits no business audit event');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'expected','expected',null,null,'tr-noop-1')->>'replayed','true','a no-op transition replays durably');
select is((select count(*)::int from public.acquisition_shipment_transitions where idempotency_key='tr-noop-1'),1,'a no-op replay creates no second event');
-- Roles on transitions.
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000003');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'expected','in_transit',null,null,'tr-viewer-1')$$,'42501',null,'viewer may not transition a shipment');
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000002');
select is(public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'expected','in_transit',null,null,'tr-operator-1')->>'status','in_transit','operator may transition a shipment');
reset role; select pg_temp.as_user('61000000-0000-4000-8000-000000000001');

-- Transition rollback matrix.
reset role;
create function public.s14_fail_transition_event() returns trigger language plpgsql as $$
begin if new.reason='EVENT-FAIL' then raise exception 'test transition event failure' using errcode='23514'; end if; return new; end $$;
create trigger s14_fail_transition_event before insert on public.acquisition_shipment_transitions for each row execute function public.s14_fail_transition_event();
select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'in_transit','lost',null,'EVENT-FAIL','tr-eventfail-1')$$,'23514',null,'a failing transition-event insertion surfaces atomically');
select is((select status::text from public.acquisition_shipments where public_id=pg_temp.ship('s8')),'in_transit','a failed transition-event insertion leaves the shipment unchanged');
reset role;
drop trigger s14_fail_transition_event on public.acquisition_shipment_transitions;
drop function public.s14_fail_transition_event();
create function public.s14_fail_shipment_update() returns trigger language plpgsql as $$
begin if new.transition_reason='UPDATE-FAIL' then raise exception 'test shipment update failure' using errcode='23514'; end if; return new; end $$;
create trigger s14_fail_shipment_update before update on public.acquisition_shipments for each row execute function public.s14_fail_shipment_update();
select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select throws_ok($$select public.transition_acquisition_shipment('61000000-1000-4000-8000-000000000001',pg_temp.ship('s8'),'in_transit','lost',null,'UPDATE-FAIL','tr-updfail-1')$$,'23514',null,'a failing shipment update surfaces atomically');
select is((select count(*)::int from public.acquisition_shipment_transitions where idempotency_key='tr-updfail-1'),0,'a failed shipment update rolls the transition event back');
select is((select status::text from public.acquisition_shipments where public_id=pg_temp.ship('s8')),'in_transit','the shipment survives the rolled-back transition unchanged');
reset role;
drop trigger s14_fail_shipment_update on public.acquisition_shipments;
drop function public.s14_fail_shipment_update();

-- The governed detail response reflects the shipment ledger.
select pg_temp.as_user('61000000-0000-4000-8000-000000000001');
select ok((select jsonb_array_length(public.get_acquisition_line_detail_by_source('61000000-1000-4000-8000-000000000001','SRC-61-A','LINE-61-A1')->'shipments'))>=8,'detail lists the order shipments');
select is((select s->>'carrier' from jsonb_array_elements(public.get_acquisition_line_detail_by_source('61000000-1000-4000-8000-000000000001','SRC-61-A','LINE-61-A1')->'shipments') s where s->>'publicId'=(select public_id from public.acquisition_shipments where create_idempotency_key='ship-tracked-key-1')),'USPS Priority Mail','detail returns the raw carrier evidence');
select is((select s->>'trackingNumber' from jsonb_array_elements(public.get_acquisition_line_detail_by_source('61000000-1000-4000-8000-000000000001','SRC-61-A','LINE-61-A1')->'shipments') s where s->>'publicId'=(select public_id from public.acquisition_shipments where create_idempotency_key='ship-tracked-key-1')),'9400 1234-5678','detail returns the raw tracking evidence');
select is((select jsonb_array_length(s->'transitionHistory') from jsonb_array_elements(public.get_acquisition_line_detail_by_source('61000000-1000-4000-8000-000000000001','SRC-61-A','LINE-61-A1')->'shipments') s where s->>'publicId'=pg_temp.ship('s5')),3,'detail returns the full transition history');
select is((select s->'allowedNextTransitions' from jsonb_array_elements(public.get_acquisition_line_detail_by_source('61000000-1000-4000-8000-000000000001','SRC-61-A','LINE-61-A1')->'shipments') s where s->>'publicId'=pg_temp.ship('s5')),'[]'::jsonb,'a delivered shipment offers no further transitions');
select is((select s->'allowedNextTransitions' from jsonb_array_elements(public.get_acquisition_line_detail_by_source('61000000-1000-4000-8000-000000000001','SRC-61-A','LINE-61-A1')->'shipments') s where s->>'publicId'=pg_temp.ship('s3')),'["delivered","lost","cancelled"]'::jsonb,'an in_transit shipment offers only its legal next states');

reset role;
select * from finish();
rollback;
