-- S1.4 source-qualified addressing, placement integrity, detail content, and
-- GENUINE concurrency.
--
-- The addressing fixture is the case the old two-argument API could not
-- express: ONE workspace holding TWO source systems whose acquisition lines
-- share the identical external line public ID. Every source-qualified call
-- must resolve the exact line; every legacy call must refuse rather than guess.
--
-- The concurrency section below the commit uses overlapping dblink sessions
-- (dblink_send_query on two connections, then a bounded wait for both). It is
-- placed after the commit because peer sessions cannot observe uncommitted
-- fixture rows. Sequential statements are not concurrency evidence and none
-- are represented as such here.
begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(89);

create function pg_temp.h(p_seed text) returns text language sql immutable as $$
  select encode(sha256(p_seed::bytea), 'hex')
$$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.detail(p_source text, p_line text) returns jsonb language sql as $$
  select public.get_acquisition_line_detail_by_source('62000000-1000-4000-8000-000000000001',p_source,p_line)
$$;

-- ---------------------------------------------------------------- fixture --
insert into auth.users(id,email) values
 ('62000000-0000-4000-8000-000000000001','owner62@example.test'),
 ('62000000-0000-4000-8000-000000000002','operator62@example.test'),
 ('62000000-0000-4000-8000-000000000003','viewer62@example.test'),
 ('62000000-0000-4000-8000-000000000004','ownerf62@example.test');
insert into public.workspaces(id,name,created_by) values
 ('62000000-1000-4000-8000-000000000001','S1.4 addressing','62000000-0000-4000-8000-000000000001'),
 ('62000000-1000-4000-8000-000000000002','S1.4 foreign','62000000-0000-4000-8000-000000000004');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('62000000-1000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002','operator'),
 ('62000000-1000-4000-8000-000000000001','62000000-0000-4000-8000-000000000003','viewer');
-- Two source systems in ONE workspace: the collision the source-qualified API exists for.
insert into public.source_systems(id,workspace_id,public_id,kind,instance_label,created_by) values
 ('62000000-2000-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','SRC-62-A','manual','source A','62000000-0000-4000-8000-000000000001'),
 ('62000000-2000-4000-8000-000000000002','62000000-1000-4000-8000-000000000001','SRC-62-B','manual','source B','62000000-0000-4000-8000-000000000001'),
 ('62000000-2000-4000-8000-000000000003','62000000-1000-4000-8000-000000000002','SRC-62-F','manual','foreign source','62000000-0000-4000-8000-000000000004');
insert into public.import_jobs(id,workspace_id,public_id,source_system_id,source_label,file_sha256,content_sha256,parser_version,mapping_version,idempotency_key,mode,status,source_row_count,accepted_row_count,issue_row_count,source_totals,actor_user_id,actor_process) values
 ('62000000-3000-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','IMP-62-A','62000000-2000-4000-8000-000000000001','fixture',repeat('a',64),repeat('b',64),'1.0.0','1.0.0','s14-addr-a','commit','preview',3,0,0,'{}','62000000-0000-4000-8000-000000000001','test.import'),
 ('62000000-3000-4000-8000-000000000002','62000000-1000-4000-8000-000000000001','IMP-62-B','62000000-2000-4000-8000-000000000002','fixture',repeat('c',64),repeat('d',64),'1.0.0','1.0.0','s14-addr-b','commit','preview',1,0,0,'{}','62000000-0000-4000-8000-000000000001','test.import'),
 ('62000000-3000-4000-8000-000000000003','62000000-1000-4000-8000-000000000002','IMP-62-F','62000000-2000-4000-8000-000000000003','fixture',repeat('e',64),repeat('f',64),'1.0.0','1.0.0','s14-addr-f','commit','preview',1,0,0,'{}','62000000-0000-4000-8000-000000000004','test.import');
insert into public.source_records(id,workspace_id,import_job_id,source_row_index,source_row_key,raw_payload,normalized_hash,parse_status,parser_output,parser_version,mapping_version,created_by_process) values
 ('62000000-5100-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','62000000-3000-4000-8000-000000000001',0,'a-dup-row','{"product_name":"stream - PSA 10 Charizard","business_vertical":"Pokémon / TCG"}',pg_temp.h('a-dup-row'),'parsed','{}','1.0.0','1.0.0','test.import'),
 ('62000000-5100-4000-8000-000000000002','62000000-1000-4000-8000-000000000001','62000000-3000-4000-8000-000000000001',1,'a-unplaced-row','{"product_name":"stream - NM single","business_vertical":"Pokémon / TCG"}',pg_temp.h('a-unplaced-row'),'parsed','{}','1.0.0','1.0.0','test.import'),
 ('62000000-5100-4000-8000-000000000003','62000000-1000-4000-8000-000000000001','62000000-3000-4000-8000-000000000001',2,'a-conc-row','{"product_name":"stream - booster bundle","business_vertical":"Pokémon / TCG"}',pg_temp.h('a-conc-row'),'parsed','{}','1.0.0','1.0.0','test.import'),
 ('62000000-5100-4000-8000-000000000004','62000000-1000-4000-8000-000000000001','62000000-3000-4000-8000-000000000002',0,'b-dup-row','{"product_name":"stream - booster box","business_vertical":"Pokémon / TCG"}',pg_temp.h('b-dup-row'),'parsed','{}','1.0.0','1.0.0','test.import'),
 ('62000000-5100-4000-8000-000000000005','62000000-1000-4000-8000-000000000002','62000000-3000-4000-8000-000000000003',0,'f-row','{"product_name":"foreign line"}',pg_temp.h('f-row'),'parsed','{}','1.0.0','1.0.0','test.import');
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=3 where id='62000000-3000-4000-8000-000000000001';
update public.import_jobs set status='committed',completed_at=now(),accepted_row_count=1 where id in ('62000000-3000-4000-8000-000000000002','62000000-3000-4000-8000-000000000003');
insert into public.channels(id,workspace_id,public_id,name,kind,created_by) values
 ('62000000-6000-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','RV-CH-62A001','A channel','manual','62000000-0000-4000-8000-000000000001'),
 ('62000000-6000-4000-8000-000000000002','62000000-1000-4000-8000-000000000002','RV-CH-62F001','F channel','manual','62000000-0000-4000-8000-000000000004');
-- Distinct suppliers prove the two collided lines never bleed into each other.
insert into public.suppliers(id,workspace_id,public_id,display_name,created_by_process) values
 ('62000000-7000-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','RV-SUP-62A001','Source A seller','test.import'),
 ('62000000-7000-4000-8000-000000000002','62000000-1000-4000-8000-000000000001','RV-SUP-62B001','Source B seller','test.import'),
 ('62000000-7000-4000-8000-000000000003','62000000-1000-4000-8000-000000000002','RV-SUP-62F001','Foreign seller','test.import');
insert into public.acquisition_import_jobs(id,workspace_id,channel_id,source_import_job_id,idempotency_key,mode,status,expected_line_count,mapping_version,plan_sha256,actor_user_id,actor_process) values
 ('62000000-4000-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','62000000-6000-4000-8000-000000000001','62000000-3000-4000-8000-000000000001','s14-addr-acq-a','commit','preview',3,'1.0.0',repeat('1',64),'62000000-0000-4000-8000-000000000001','test.import'),
 ('62000000-4000-4000-8000-000000000002','62000000-1000-4000-8000-000000000001','62000000-6000-4000-8000-000000000001','62000000-3000-4000-8000-000000000002','s14-addr-acq-b','commit','preview',1,'1.0.0',repeat('2',64),'62000000-0000-4000-8000-000000000001','test.import'),
 ('62000000-4000-4000-8000-000000000003','62000000-1000-4000-8000-000000000002','62000000-6000-4000-8000-000000000002','62000000-3000-4000-8000-000000000003','s14-addr-acq-f','commit','preview',1,'1.0.0',repeat('3',64),'62000000-0000-4000-8000-000000000004','test.import');
-- LINE-62-DUP exists in BOTH source systems of workspace A.
insert into public.acquisition_line_items(id,workspace_id,public_id,source_system_id,source_record_id,acquisition_import_job_id,quantity,description,reference_number,source_detail,created_by_process) values
 ('62000000-5000-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','LINE-62-DUP','62000000-2000-4000-8000-000000000001','62000000-5100-4000-8000-000000000001','62000000-4000-4000-8000-000000000001',3,'source A line','REF-A-1','{"product_name":"stream - PSA 10 Charizard","business_vertical":"Pokémon / TCG"}','test.import'),
 ('62000000-5000-4000-8000-000000000002','62000000-1000-4000-8000-000000000001','LINE-62-UNPLACED','62000000-2000-4000-8000-000000000001','62000000-5100-4000-8000-000000000002','62000000-4000-4000-8000-000000000001',1,'unplaced line',null,'{"product_name":"stream - NM single","business_vertical":"Pokémon / TCG"}','test.import'),
 ('62000000-5000-4000-8000-000000000003','62000000-1000-4000-8000-000000000001','LINE-62-CONC','62000000-2000-4000-8000-000000000001','62000000-5100-4000-8000-000000000003','62000000-4000-4000-8000-000000000001',1,'concurrency line',null,'{"product_name":"stream - booster bundle","business_vertical":"Pokémon / TCG"}','test.import'),
 ('62000000-5000-4000-8000-000000000004','62000000-1000-4000-8000-000000000001','LINE-62-DUP','62000000-2000-4000-8000-000000000002','62000000-5100-4000-8000-000000000004','62000000-4000-4000-8000-000000000002',7,'source B line','REF-B-1','{"product_name":"stream - booster box","business_vertical":"Pokémon / TCG"}','test.import'),
 ('62000000-5000-4000-8000-000000000005','62000000-1000-4000-8000-000000000002','LINE-62-FOREIGN','62000000-2000-4000-8000-000000000003','62000000-5100-4000-8000-000000000005','62000000-4000-4000-8000-000000000003',1,'foreign line',null,'{"product_name":"foreign line"}','test.import');
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=3,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id='62000000-4000-4000-8000-000000000001';
update public.acquisition_import_jobs set status='committed',completed_at=now(),committed_orders=1,committed_lots=1,committed_line_items=1,committed_cost_components=0,committed_unresolved_supplier_candidates=0,committed_unresolved_cost_components=0 where id in ('62000000-4000-4000-8000-000000000002','62000000-4000-4000-8000-000000000003');
set local session_replication_role=replica;
insert into public.acquisition_orders(id,workspace_id,public_id,channel_id,supplier_id,source_system_id,acquisition_import_job_id,source_order_reference,first_source_record_id,order_status,source_reported_status,source_reported_total_minor,currency,occurred_at,created_by_process) values
 ('62000000-7200-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','RV-ACQ-62A001','62000000-6000-4000-8000-000000000001','62000000-7000-4000-8000-000000000001','62000000-2000-4000-8000-000000000001','62000000-4000-4000-8000-000000000001','ORDER-62-A','62000000-5100-4000-8000-000000000001','unknown','delivered',5000,'USD','2026-08-01T10:00:00Z','test.import'),
 ('62000000-7200-4000-8000-000000000002','62000000-1000-4000-8000-000000000001','RV-ACQ-62B001','62000000-6000-4000-8000-000000000001','62000000-7000-4000-8000-000000000002','62000000-2000-4000-8000-000000000002','62000000-4000-4000-8000-000000000002','ORDER-62-B','62000000-5100-4000-8000-000000000004','unknown','shipped',9000,'USD','2026-08-02T10:00:00Z','test.import'),
 ('62000000-7200-4000-8000-000000000003','62000000-1000-4000-8000-000000000001','RV-ACQ-62C001','62000000-6000-4000-8000-000000000001','62000000-7000-4000-8000-000000000001','62000000-2000-4000-8000-000000000001','62000000-4000-4000-8000-000000000001','ORDER-62-C','62000000-5100-4000-8000-000000000003','unknown',null,null,null,'2026-08-03T10:00:00Z','test.import'),
 ('62000000-7200-4000-8000-000000000004','62000000-1000-4000-8000-000000000002','RV-ACQ-62F001','62000000-6000-4000-8000-000000000002','62000000-7000-4000-8000-000000000003','62000000-2000-4000-8000-000000000003','62000000-4000-4000-8000-000000000003','ORDER-62-F','62000000-5100-4000-8000-000000000005','unknown',null,null,null,null,'test.import');
insert into public.acquisition_lots(id,workspace_id,public_id,order_id,sequence_no,label,created_by_process) values
 ('62000000-7300-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','RV-ALOT-62A001','62000000-7200-4000-8000-000000000001',1,'Lot A','test.import'),
 ('62000000-7300-4000-8000-000000000002','62000000-1000-4000-8000-000000000001','RV-ALOT-62B001','62000000-7200-4000-8000-000000000002',1,'Lot B','test.import'),
 ('62000000-7300-4000-8000-000000000003','62000000-1000-4000-8000-000000000001','RV-ALOT-62C001','62000000-7200-4000-8000-000000000003',1,'Lot C','test.import'),
 ('62000000-7300-4000-8000-000000000004','62000000-1000-4000-8000-000000000001','RV-ALOT-62A002','62000000-7200-4000-8000-000000000001',2,'Lot A second','test.import'),
 ('62000000-7300-4000-8000-000000000005','62000000-1000-4000-8000-000000000002','RV-ALOT-62F001','62000000-7200-4000-8000-000000000004',1,'Lot F','test.import');
-- LINE-62-UNPLACED deliberately receives NO placement row.
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,created_by_process) values
 ('62000000-7400-4000-8000-000000000001','62000000-1000-4000-8000-000000000001','62000000-7300-4000-8000-000000000001','62000000-5000-4000-8000-000000000001','test.import'),
 ('62000000-7400-4000-8000-000000000002','62000000-1000-4000-8000-000000000001','62000000-7300-4000-8000-000000000002','62000000-5000-4000-8000-000000000004','test.import'),
 ('62000000-7400-4000-8000-000000000003','62000000-1000-4000-8000-000000000001','62000000-7300-4000-8000-000000000003','62000000-5000-4000-8000-000000000003','test.import'),
 ('62000000-7400-4000-8000-000000000004','62000000-1000-4000-8000-000000000002','62000000-7300-4000-8000-000000000005','62000000-5000-4000-8000-000000000005','test.import');
set local session_replication_role=origin;

-- ==================================== source-qualified identity =============
select pg_temp.as_user('62000000-0000-4000-8000-000000000001');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'identity'->>'sourceSystemPublicId','SRC-62-A','source A resolves to source A');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'identity'->>'sourceSystemPublicId','SRC-62-B','source B resolves to source B');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'order'->>'publicId','RV-ACQ-62A001','collided lines keep distinct orders (A)');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'order'->>'publicId','RV-ACQ-62B001','collided lines keep distinct orders (B)');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'line'->>'fullTitle','stream - PSA 10 Charizard','collided lines keep distinct titles (A)');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'line'->>'fullTitle','stream - booster box','collided lines keep distinct titles (B)');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'order'->'supplier'->>'displayName','Source A seller','collided lines keep distinct suppliers (A)');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'order'->'supplier'->>'displayName','Source B seller','collided lines keep distinct suppliers (B)');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'line'->>'quantity','3','collided lines keep distinct quantities (A)');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'line'->>'quantity','7','collided lines keep distinct quantities (B)');
-- Zero matches and foreign-workspace targets are indistinguishable.
select is(pg_temp.detail('SRC-62-A','NO-SUCH-LINE'),null,'a zero-match line discloses nothing');
select is(pg_temp.detail('NO-SUCH-SOURCE','LINE-62-DUP'),null,'a zero-match source discloses nothing');
select is(pg_temp.detail('SRC-62-F','LINE-62-FOREIGN'),null,'a foreign-workspace line discloses exactly what a zero match does');
-- The legacy two-argument surface must refuse, never guess.
select throws_ok($$select public.get_acquisition_line_detail('62000000-1000-4000-8000-000000000001','LINE-62-DUP')$$,'23514','ambiguous_acquisition_line_id','the legacy detail API refuses an ambiguous line ID');
select throws_ok($$select public.classify_acquisition_line_by_public_id('62000000-1000-4000-8000-000000000001','LINE-62-DUP')$$,'23514','ambiguous_acquisition_line_id','the legacy classifier fails closed on an ambiguous line ID');
select throws_ok($$select public.override_acquisition_line_classification_by_public_id('62000000-1000-4000-8000-000000000001','LINE-62-DUP','sealed','owner evidence')$$,'23514','ambiguous_acquisition_line_id','the legacy override fails closed on an ambiguous line ID');
select throws_ok($$select public.classify_acquisition_line_by_source('62000000-1000-4000-8000-000000000001','NO-SUCH-SOURCE','LINE-62-DUP')$$,'P0002','acquisition_not_found','the qualified classifier fails closed for zero matches');
select throws_ok($$select public.override_acquisition_line_classification_by_source('62000000-1000-4000-8000-000000000001','NO-SUCH-SOURCE','LINE-62-DUP','sealed','x')$$,'P0002','acquisition_not_found','the qualified override fails closed for zero matches');
select is(public.get_acquisition_line_detail('62000000-1000-4000-8000-000000000001','LINE-62-UNPLACED')->'identity'->>'linePublicId','LINE-62-UNPLACED','the legacy detail API still resolves an unambiguous line');

-- Automatic classification targets ONLY the addressed line.
reset role; select pg_temp.as_user('62000000-0000-4000-8000-000000000002');
select is(public.classify_acquisition_line_by_source('62000000-1000-4000-8000-000000000001','SRC-62-A','LINE-62-DUP')->>'status','classified','operator may classify by source');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'classification'->>'optionKey','slab','the addressed line was classified from its own evidence');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'classification','null'::jsonb,'the collided sibling line was not touched');
select throws_ok($$select public.override_acquisition_line_classification_by_source('62000000-1000-4000-8000-000000000001','SRC-62-A','LINE-62-DUP','sealed','operator attempt')$$,'42501',null,'operator may not owner-override');
reset role; select pg_temp.as_user('62000000-0000-4000-8000-000000000003');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'identity'->>'linePublicId','LINE-62-DUP','viewer may read the governed detail');
select throws_ok($$select public.classify_acquisition_line_by_source('62000000-1000-4000-8000-000000000001','SRC-62-A','LINE-62-DUP')$$,'42501',null,'viewer may not classify');
reset role; select pg_temp.as_user('62000000-0000-4000-8000-000000000001');
select is(public.override_acquisition_line_classification_by_source('62000000-1000-4000-8000-000000000001','SRC-62-A','LINE-62-DUP','sealed','owner inspected the sealed case')->>'status','overridden','owner may override by source');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'classification'->>'optionKey','sealed','the owner override applied to the addressed line');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'classification','null'::jsonb,'the owner override did not reach the collided sibling');

-- ================================================ placement integrity ======
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'placement'->>'lotPublicId','RV-ALOT-62A001','one active placement returns the exact lot');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'placement'->>'integrityState','current','one active placement reports a current placement');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'placement'->>'label','Lot A','the exact lot label is returned');
select is(pg_temp.detail('SRC-62-A','LINE-62-UNPLACED')->'placement'->>'integrityState','missing_active_placement','zero active placements report a missing placement');
select is(pg_temp.detail('SRC-62-A','LINE-62-UNPLACED')->'placement'->>'lotPublicId',null,'zero active placements invent no lot');
-- Two ACTIVE placements: the uniqueness constraint is DEFERRABLE INITIALLY
-- DEFERRED, so a second active row is legal until commit. Inside that window
-- the read model must fail closed rather than pick one of the two.
savepoint two_active_placements;
-- The fixture write needs superuser; the reads that follow must not.
reset role;
set local session_replication_role=replica;
insert into public.acquisition_lot_lines(id,workspace_id,lot_id,line_item_id,created_by_process)
 values ('62000000-7400-4000-8000-000000000099','62000000-1000-4000-8000-000000000001','62000000-7300-4000-8000-000000000004','62000000-5000-4000-8000-000000000001','test.import');
set local session_replication_role=origin;
select pg_temp.as_user('62000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.acquisition_lot_lines where line_item_id='62000000-5000-4000-8000-000000000001' and state='active'),2,'the deferred constraint permits two active placements before commit');
select throws_ok($$select public.get_acquisition_line_detail_by_source('62000000-1000-4000-8000-000000000001','SRC-62-A','LINE-62-DUP')$$,'23514','acquisition_integrity_error','two active placements fail closed instead of returning an arbitrary lot');
rollback to savepoint two_active_placements;
select pg_temp.as_user('62000000-0000-4000-8000-000000000001');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'placement'->>'lotPublicId','RV-ALOT-62A001','the exact lot returns once the split placement is gone');

-- ========================================================= detail JSON ======
-- Payments: order A single-currency with a reversal, order B mixed-currency.
select public.record_acquisition_payment('62000000-1000-4000-8000-000000000001','RV-ACQ-62A001','2026-08-03T09:00:00Z',1500,'USD','card',null,null,null,'d62-pay-key-1');
select public.record_acquisition_payment('62000000-1000-4000-8000-000000000001','RV-ACQ-62A001','2026-08-03T10:00:00Z',2000,'USD','bank',null,null,null,'d62-pay-key-2');
select public.record_acquisition_payment('62000000-1000-4000-8000-000000000001','RV-ACQ-62A001','2026-08-03T11:00:00Z',800,'USD','cash',null,null,null,'d62-pay-key-3');
select public.reverse_acquisition_payment('62000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_payments where idempotency_key='d62-pay-key-3'),'recorded against the wrong order','d62-rev-key-1');
select public.record_acquisition_payment('62000000-1000-4000-8000-000000000001','RV-ACQ-62B001','2026-08-03T09:00:00Z',1000,'USD','card',null,null,null,'d62-pay-key-4');
select public.record_acquisition_payment('62000000-1000-4000-8000-000000000001','RV-ACQ-62B001','2026-08-03T09:30:00Z',900,'EUR','card',null,null,null,'d62-pay-key-5');
select public.create_acquisition_shipment('62000000-1000-4000-8000-000000000001','RV-ACQ-62A001','FedEx Ground',' 7712 3344-5566 ',null,null,'expected',450,'usd',null,'left at door','d62-ship-key-1');
select public.transition_acquisition_shipment('62000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_shipments where create_idempotency_key='d62-ship-key-1'),'expected','in_transit',null,null,'d62-tran-key-1');

select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->>'coverage','governed_native_committed','coverage metadata states the committed governed-native scope');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->>'historicalLegacyImported','false','coverage metadata states legacy purchases are not imported');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'identity'->>'linePublicId','LINE-62-DUP','the identity tuple carries the line public ID');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'classification'->>'method','owner_override','the current classification reports the owner override method');
select is(jsonb_array_length(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'classificationHistory'),2,'the complete classification history is returned');
-- Both classifications land in ONE transaction, so created_at is identical
-- across them and "first element" would be a coin toss. History is asserted
-- on supersession state instead, which is the durable ordering fact.
select is((select h->>'optionKey' from jsonb_array_elements(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'classificationHistory') h where h->>'supersededAt' is not null),'slab','the superseded automatic classification is preserved in history');
select is((select h->>'ownerOverrideReason' from jsonb_array_elements(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'classificationHistory') h where h->>'supersededAt' is null),'owner inspected the sealed case','the owner override reason is preserved on the current history entry');
select ok((select count(*) from jsonb_array_elements(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'classificationOptions'))>=5,'the active classification options are offered');
select is(jsonb_array_length(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'payments'),3,'the payment history is returned');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'paymentSummary'->>'activeCount','2','the payment summary counts only active payments');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'paymentSummary'->>'activeTotalMinor','3500','a single-currency payment summary totals exactly');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'paymentSummary'->>'mixedCurrencies','false','a single-currency summary is not mixed');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'paymentSummary'->>'sourceReportedTotalMinor','5000','the source-reported order total stays a separate fact');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'paymentSummary'->>'differenceMinor','1500','the payment difference is reported only against a comparable total');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'order'->>'sourceReportedTotalMinor','5000','the order keeps its own source-reported total');
select is((select p->'reversalEvent'->>'reason' from jsonb_array_elements(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'payments') p where p->>'state'='reversed'),'recorded against the wrong order','the reversal event is carried with its reason');
select is((select p->>'amountMinor' from jsonb_array_elements(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'payments') p where p->>'state'='reversed'),'800','the reversed payment keeps its original amount as history');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'paymentSummary'->>'mixedCurrencies','true','a mixed-currency summary is reported as mixed');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'paymentSummary'->>'activeTotalMinor',null,'a mixed-currency summary refuses one combined total');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'paymentSummary'->>'differenceMinor',null,'a mixed-currency summary reports no difference');
select is(pg_temp.detail('SRC-62-B','LINE-62-DUP')->'paymentSummary'->>'sourceReportedTotalMinor','9000','the source-reported total survives a mixed-currency summary');
select is(jsonb_array_length(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'shipments'),1,'the shipment history is returned');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'shipments'->0->>'carrier','FedEx Ground','the raw carrier evidence is returned unchanged');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'shipments'->0->>'trackingNumber','7712 3344-5566','the raw tracking evidence keeps its spacing and punctuation');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'shipments'->0->>'shippingReferenceMinor','450','the shipping reference amount is returned');
select is(jsonb_array_length(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'shipments'->0->'transitionHistory'),1,'the shipment transition history is returned');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'shipments'->0->'allowedNextTransitions','["delivered","lost","cancelled"]'::jsonb,'the allowed next transitions match the current state');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'sourceEvidence'->>'sourceSystemPublicId','SRC-62-A','the source system public ID is reported');
-- Truthful evidence names: a source row key is not an RV public identity, and
-- the import job behind this line is the SOURCE import job.
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'sourceEvidence'->>'sourceRecordRowKey','a-dup-row','the source record evidence is named as the row key it is');
select is(pg_temp.detail('SRC-62-A','LINE-62-DUP')->'sourceEvidence'->>'sourceImportJobPublicId','IMP-62-A','the source import job public ID is named truthfully');
select ok(not (pg_temp.detail('SRC-62-A','LINE-62-DUP')->'sourceEvidence' ? 'acquisitionImportPublicIdentity'),'the misleading acquisition-import identity name is gone');
select ok(not (pg_temp.detail('SRC-62-A','LINE-62-DUP')->'sourceEvidence' ? 'sourceRecordPublicIdentity'),'the misleading source-record identity name is gone');
-- Out-of-scope concepts must not appear anywhere in the response.
select ok(not (pg_temp.detail('SRC-62-A','LINE-62-DUP') ?| array['receiving','receipts','discrepancies','costBasis','profit','payout']),'no out-of-scope top-level keys are present');
select ok(pg_temp.detail('SRC-62-A','LINE-62-DUP')::text !~* '(receiving|receipt|discrepanc|cost[_ ]?basis|profit|payout)','no receiving, discrepancy, cost-basis, profit, or payout content appears');

reset role;
commit;

-- ================================================ GENUINE CONCURRENCY ======
-- Overlapping sessions only. Every scenario below dispatches BOTH calls with
-- dblink_send_query before collecting either result, so the two backends are
-- in flight at the same time and must be serialized by the governed locks.
create function pg_temp.await_all(p_conns text[], p_seconds numeric default 30)
returns void language plpgsql as $$
declare started timestamptz:=clock_timestamp(); c text; busy boolean;
begin loop busy:=false; foreach c in array p_conns loop busy:=busy or dblink_is_busy(c)=1; end loop;
 exit when not busy; if clock_timestamp()-started>make_interval(secs=>p_seconds) then raise exception 'S1.4 concurrency deadline' using errcode='55P03'; end if;
 perform pg_sleep(.02); end loop; end $$;
create temporary table s62_conn(dsn text);
insert into s62_conn values(case when current_setting('is_superuser')='on' then 'dbname='||current_database()
 else format('host=%s port=%s dbname=%s user=postgres password=postgres',coalesce(host(inet_server_addr()),'127.0.0.1'),coalesce(inet_server_port()::text,current_setting('port')),current_database()) end);
create function pg_temp.auth_sql(p_call text) returns text language sql as $$
 select format($q$with auth as materialized (select set_config('request.jwt.claims',%L,false)) select (%s)::text from auth$q$,
 json_build_object('sub','62000000-0000-4000-8000-000000000001','role','authenticated')::text,p_call)
$$;
create function pg_temp.race(p_name text,p_left text,p_right text) returns text[] language plpgsql as $$
declare cs text[]:=array[p_name||'_1',p_name||'_2']; a text; b text;
begin
 perform dblink_connect(cs[1],(select dsn from s62_conn)); perform dblink_connect(cs[2],(select dsn from s62_conn));
 -- Both dispatched before either is collected: the sessions genuinely overlap.
 perform dblink_send_query(cs[1],pg_temp.auth_sql(p_left)); perform dblink_send_query(cs[2],pg_temp.auth_sql(p_right)); perform pg_temp.await_all(cs);
 select result into a from dblink_get_result(cs[1]) t(result text); select result into b from dblink_get_result(cs[2]) t(result text);
 perform dblink_disconnect(cs[1]); perform dblink_disconnect(cs[2]); return array[a,b];
exception when others then begin perform dblink_disconnect(cs[1]); exception when others then null; end; begin perform dblink_disconnect(cs[2]); exception when others then null; end; raise;
end $$;
-- Catches the loser's error so the race itself does not abort; the SQLSTATE is
-- returned as evidence that the refusal was bounded and named.
create function public.s62_try(p_sql text) returns text language plpgsql as $$
declare r text; begin execute p_sql into r; return coalesce(r,'null');
exception when others then return 'ERR:'||sqlstate; end $$;
create temporary table s62_race(name text primary key, result text[]);
-- The fixture claims were transaction-local and ended at the commit above;
-- re-establish them at SESSION level for the direct calls in this section.
select set_config('request.jwt.claims',json_build_object('sub','62000000-0000-4000-8000-000000000001','role','authenticated')::text,false);

-- Two identical payment creates under one key.
insert into s62_race select 'pay_same', pg_temp.race('s62_pay_same',
 $$public.s62_try($x$select public.record_acquisition_payment('62000000-1000-4000-8000-000000000001','RV-ACQ-62C001','2026-08-05T09:00:00Z',2500,'USD','card',null,null,null,'conc-pay-same-1')$x$)$$,
 $$public.s62_try($x$select public.record_acquisition_payment('62000000-1000-4000-8000-000000000001','RV-ACQ-62C001','2026-08-05T09:00:00Z',2500,'USD','card',null,null,null,'conc-pay-same-1')$x$)$$);
select is((select count(*)::int from public.acquisition_payments where idempotency_key='conc-pay-same-1'),1,'two identical concurrent payment creates yield exactly one payment');
select is((select count(*)::int from public.audit_events where event_type='acquisition_payment_recorded' and detail->>'payment_public_id'=(select public_id from public.acquisition_payments where idempotency_key='conc-pay-same-1')),1,'two identical concurrent payment creates emit exactly one audit event');
select is((select count(*)::int from unnest((select result from s62_race where name='pay_same')) r where r like 'ERR:%'),0,'an identical concurrent payment replay is not an error');

-- Two CONFLICTING payment creates under one key.
insert into s62_race select 'pay_conflict', pg_temp.race('s62_pay_conflict',
 $$public.s62_try($x$select public.record_acquisition_payment('62000000-1000-4000-8000-000000000001','RV-ACQ-62C001','2026-08-05T10:00:00Z',3300,'USD','card',null,null,null,'conc-pay-conflict-1')$x$)$$,
 $$public.s62_try($x$select public.record_acquisition_payment('62000000-1000-4000-8000-000000000001','RV-ACQ-62C001','2026-08-05T10:00:00Z',4400,'USD','bank',null,null,null,'conc-pay-conflict-1')$x$)$$);
select is((select count(*)::int from public.acquisition_payments where idempotency_key='conc-pay-conflict-1'),1,'two conflicting concurrent payment creates yield exactly one winner');
select is((select count(*)::int from unnest((select result from s62_race where name='pay_conflict')) r where r='ERR:23505'),1,'the losing conflicting payment is refused with a bounded idempotency conflict');
select is((select count(*)::int from public.audit_events where event_type='acquisition_payment_recorded' and detail->>'payment_public_id'=(select public_id from public.acquisition_payments where idempotency_key='conc-pay-conflict-1')),1,'the refused payment left no partial audit event');

-- Two reversals of ONE payment under different keys.
insert into s62_race select 'reverse', pg_temp.race('s62_reverse',
 $$public.s62_try($x$select public.reverse_acquisition_payment('62000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_payments where workspace_id='62000000-1000-4000-8000-000000000001' and idempotency_key='conc-pay-same-1'),'concurrent reversal A','conc-rev-key-a')$x$)$$,
 $$public.s62_try($x$select public.reverse_acquisition_payment('62000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_payments where workspace_id='62000000-1000-4000-8000-000000000001' and idempotency_key='conc-pay-same-1'),'concurrent reversal B','conc-rev-key-b')$x$)$$);
select is((select count(*)::int from public.acquisition_payment_reversals where acquisition_payment_id=(select id from public.acquisition_payments where idempotency_key='conc-pay-same-1')),1,'two concurrent reversals yield exactly one reversal event');
select is((select count(*)::int from unnest((select result from s62_race where name='reverse')) r where r='ERR:23505'),1,'the losing concurrent reversal is refused with a bounded conflict');
select is((select p.reversal_event_id from public.acquisition_payments p where p.idempotency_key='conc-pay-same-1'),(select e.id from public.acquisition_payment_reversals e where e.acquisition_payment_id=(select id from public.acquisition_payments where idempotency_key='conc-pay-same-1')),'the payment points at the single surviving reversal event');
select ok((select reversed_at is not null and reversal_reason is not null from public.acquisition_payments where idempotency_key='conc-pay-same-1'),'the losing reversal left no half-updated payment row');

-- Two normalized-equivalent tracked shipment creates under different keys.
insert into s62_race select 'ship_track', pg_temp.race('s62_ship_track',
 $$public.s62_try($x$select public.create_acquisition_shipment('62000000-1000-4000-8000-000000000001','RV-ACQ-62C001','UPS Ground','1Z 9999-8888',null,null,'expected',null,null,null,null,'conc-ship-key-a')$x$)$$,
 $$public.s62_try($x$select public.create_acquisition_shipment('62000000-1000-4000-8000-000000000001','RV-ACQ-62C001','ups ground','1z99998888',null,null,'expected',null,null,null,null,'conc-ship-key-b')$x$)$$);
select is((select count(*)::int from public.acquisition_shipments where workspace_id='62000000-1000-4000-8000-000000000001' and lower(regexp_replace(btrim(tracking_number),'[[:space:]-]','','g'))='1z99998888'),1,'two normalized-equivalent concurrent shipment creates yield exactly one shipment');
select is((select count(*)::int from unnest((select result from s62_race where name='ship_track')) r where r='ERR:23505'),1,'the losing duplicate-tracking shipment is refused with a bounded conflict');
select is((select count(*)::int from public.acquisition_shipments where create_idempotency_key in ('conc-ship-key-a','conc-ship-key-b')),1,'the refused shipment left no partial row behind its own key');

-- Two transitions racing out of ONE expected status.
select public.create_acquisition_shipment('62000000-1000-4000-8000-000000000001','RV-ACQ-62C001',null,null,null,null,'expected',null,null,null,null,'conc-ship-base-1');
insert into s62_race select 'transition', pg_temp.race('s62_transition',
 $$public.s62_try($x$select public.transition_acquisition_shipment('62000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_shipments where workspace_id='62000000-1000-4000-8000-000000000001' and create_idempotency_key='conc-ship-base-1'),'expected','in_transit',null,null,'conc-tran-key-a')$x$)$$,
 $$public.s62_try($x$select public.transition_acquisition_shipment('62000000-1000-4000-8000-000000000001',(select public_id from public.acquisition_shipments where workspace_id='62000000-1000-4000-8000-000000000001' and create_idempotency_key='conc-ship-base-1'),'expected','in_transit',null,null,'conc-tran-key-b')$x$)$$);
select is((select count(*)::int from public.acquisition_shipment_transitions t join public.acquisition_shipments s on s.id=t.acquisition_shipment_id where s.create_idempotency_key='conc-ship-base-1' and t.applied),1,'two concurrent transitions from one expected status yield exactly one winner');
select is((select count(*)::int from unnest((select result from s62_race where name='transition')) r where r='ERR:40001'),1,'the losing transition returns a bounded stale-status outcome');
select is((select status::text from public.acquisition_shipments where create_idempotency_key='conc-ship-base-1'),'in_transit','the winning transition is the shipment state');
select is((select count(*)::int from public.acquisition_shipment_transitions t join public.acquisition_shipments s on s.id=t.acquisition_shipment_id where s.create_idempotency_key='conc-ship-base-1'),1,'the refused transition left no partial event');
-- The winner's key must still replay cleanly afterwards.
select is(public.transition_acquisition_shipment('62000000-1000-4000-8000-000000000001',
  (select public_id from public.acquisition_shipments where create_idempotency_key='conc-ship-base-1'),
  'expected','in_transit',null,null,
  (select t.idempotency_key from public.acquisition_shipment_transitions t join public.acquisition_shipments s on s.id=t.acquisition_shipment_id where s.create_idempotency_key='conc-ship-base-1' and t.applied))->>'replayed','true','replay of the winning transition remains valid');
select is((select count(*)::int from public.acquisition_shipment_transitions t join public.acquisition_shipments s on s.id=t.acquisition_shipment_id where s.create_idempotency_key='conc-ship-base-1'),1,'the winning replay created no second event');

drop function public.s62_try(text);
select * from finish();
