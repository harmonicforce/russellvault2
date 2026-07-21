-- Phase 4 acceptance patch — cost-component retry idempotency (F1),
-- provenance-binding integrity (F3), and unknown-cost allocation guards (F4).
-- Self-contained fixture, mirroring 13_acquisition_workflow.sql's helpers.
begin;
create extension if not exists pgtap;
select no_plan();

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create temp table ids (k text primary key, v uuid);
grant all on table ids to public;
create function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ids values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v;
$$;
create function pg_temp.get(p_k text) returns uuid language sql stable as $$
  select v from ids where k = p_k;
$$;
create function pg_temp.h(p_seed text) returns text language sql immutable as $$
  select encode(sha256(p_seed::bytea), 'hex');
$$;

-- Fixtures ------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('a2222222-2222-2222-2222-222222222222', 'operator@example.test');

insert into public.workspaces (id, name, created_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'WS A', 'a1111111-1111-1111-1111-111111111111');
-- The workspace creator (a1) is added as owner automatically; add the operator.
insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'operator');

-- Two source systems: the mapped one (SS1) and an unrelated one (SS2), used to
-- prove external-identifier source-system binding.
insert into public.source_systems (id, workspace_id, public_id, kind, instance_label, created_by)
values
  ('55550000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
   'REPO', 'repository_fixture', 'seed fixtures', 'a1111111-1111-1111-1111-111111111111'),
  ('55550000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001',
   'REPO2', 'repository_fixture', 'other fixtures', 'a1111111-1111-1111-1111-111111111111');

-- JOB1 is the committed Phase 3 job being mapped; JOB2 is a second committed
-- job whose rows must NOT be adoptable by JOB1's acquisition mapping.
insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label, file_sha256,
  content_sha256, parser_version, mapping_version, idempotency_key, mode,
  source_row_count, actor_user_id, actor_process
) values
  ('66660000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
   'JOB1', '55550000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0', 'idem-accept-000001', 'commit',
   2, 'a1111111-1111-1111-1111-111111111111', 'provenance.import'),
  ('66660000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001',
   'JOB2', '55550000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('b', 64), repeat('b', 64), '1.0.0', '1.0.0', 'idem-accept-000002', 'commit',
   1, 'a1111111-1111-1111-1111-111111111111', 'provenance.import');

insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, source_row_key, raw_payload,
  normalized_hash, parse_status, parser_output, parser_version, mapping_version,
  created_by_process
) values
  ('77770000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000001', 0, 'WN-A-000100',
   '{"acquisition_line_id":"WN-A-000100","order_id":"ORD-A","seller":"acme","quantity_purchased":2,"total_paid":10}'::jsonb,
   pg_temp.h('r1'), 'parsed', '{"seller":"acme"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  ('77770000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000001', 1, 'WN-A-000101',
   '{"acquisition_line_id":"WN-A-000101","order_id":"ORD-B","seller":"acme","quantity_purchased":1,"total_paid":5}'::jsonb,
   pg_temp.h('r2'), 'parsed', '{"seller":"acme"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  ('77770000-0000-4000-8000-000000000003', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000002', 0, 'WN-A-000200',
   '{"acquisition_line_id":"WN-A-000200","order_id":"ORD-C","seller":"acme","quantity_purchased":1,"total_paid":9}'::jsonb,
   pg_temp.h('r3'), 'parsed', '{"seller":"acme"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import');

-- External identifiers: EXT1/EXT2 bind SS1 rows; EXT-SS2 is an SS2 identifier
-- pointing at JOB1's SR1 (wrong source system) for the binding test.
insert into public.external_identifiers (
  id, workspace_id, source_system_id, scope, identifier_type, identifier_value,
  source_record_id, created_by_process
) values
  ('88880000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
   '55550000-0000-4000-8000-000000000001', 'fixture.whatnot_purchases', 'source_row_key',
   'WN-A-000100', '77770000-0000-4000-8000-000000000001', 'provenance.import'),
  ('88880000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001',
   '55550000-0000-4000-8000-000000000001', 'fixture.whatnot_purchases', 'source_row_key',
   'WN-A-000101', '77770000-0000-4000-8000-000000000002', 'provenance.import'),
  ('88880000-0000-4000-8000-000000000009', 'aaaa0000-0000-4000-8000-000000000001',
   '55550000-0000-4000-8000-000000000002', 'fixture.other', 'source_row_key',
   'WN-A-000100', '77770000-0000-4000-8000-000000000001', 'provenance.import');

update public.import_jobs set status = 'committed', completed_at = now(),
  accepted_row_count = source_row_count, issue_row_count = 0
where id in ('66660000-0000-4000-8000-000000000001', '66660000-0000-4000-8000-000000000002');

-- Owner registers a channel; operator opens an acquisition job for JOB1 ------------------
select pg_temp.login('a1111111-1111-1111-1111-111111111111');
select pg_temp.put('channel',
  (public.register_channel('aaaa0000-0000-4000-8000-000000000001', 'Whatnot', 'marketplace')->>'id')::uuid);
select pg_temp.logout();
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
-- The frozen plan_sha256 is the DB-computed digest of the exact plan staged
-- below; finalize will recompute it from the staged rows and must agree.
select pg_temp.put('job', (public.begin_acquisition_import_job(
  'aaaa0000-0000-4000-8000-000000000001', pg_temp.get('channel'),
  '66660000-0000-4000-8000-000000000001', 'acq-key-accept-1', 2,
  '1.0.0', 'e58c2162fd87af44449b457c866596da73f1d7df089af191eda700d117e516e3')->>'id')::uuid);

-- F3: an order citing a source record from ANOTHER job is refused ------------------------
select throws_ok(
  format($$select public.stage_acquisition_orders(%L, jsonb_build_array(jsonb_build_object(
    'source_order_reference','ORD-A','seller_raw_handle','acme',
    'first_source_record_id','77770000-0000-4000-8000-000000000003',
    'order_status','completed','source_reported_status','completed','currency','USD')))$$,
    pg_temp.get('job')),
  '23514', null, 'F3: an order citing a cross-job source record is refused');

-- Stage the two REAL orders, lots, and line items -------------------------------------
select lives_ok(
  format($$select public.stage_acquisition_orders(%L, jsonb_build_array(
    jsonb_build_object('source_order_reference','ORD-A','seller_raw_handle','acme',
      'first_source_record_id','77770000-0000-4000-8000-000000000001',
      'order_status','completed','source_reported_status','completed',
      'source_reported_total_minor',1000,'currency','USD'),
    jsonb_build_object('source_order_reference','ORD-B','seller_raw_handle','acme',
      'first_source_record_id','77770000-0000-4000-8000-000000000002',
      'order_status','completed','source_reported_status','completed',
      'source_reported_total_minor',500,'currency','USD')))$$, pg_temp.get('job')),
  'orders stage');

select pg_temp.put('ord_a', (select id from public.acquisition_orders
  where acquisition_import_job_id = pg_temp.get('job') and source_order_reference = 'ORD-A'));
select pg_temp.put('ord_b', (select id from public.acquisition_orders
  where acquisition_import_job_id = pg_temp.get('job') and source_order_reference = 'ORD-B'));

select lives_ok(
  format($$select public.stage_acquisition_lots(%L, jsonb_build_array(
    jsonb_build_object('order_id',%L::uuid),
    jsonb_build_object('order_id',%L::uuid)))$$,
    pg_temp.get('job'), pg_temp.get('ord_a'), pg_temp.get('ord_b')),
  'lots stage');

select pg_temp.put('lot_a', (select lt.id from public.acquisition_lots lt
  where lt.order_id = pg_temp.get('ord_a')));
select pg_temp.put('lot_b', (select lt.id from public.acquisition_lots lt
  where lt.order_id = pg_temp.get('ord_b')));

-- F3: a line item citing an external identifier of a DIFFERENT source system is refused --
select throws_ok(
  format($$select public.stage_acquisition_line_items(%L, jsonb_build_array(jsonb_build_object(
    'public_id','WN-A-000100','lot_id',%L::uuid,
    'source_record_id','77770000-0000-4000-8000-000000000001',
    'external_identifier_id','88880000-0000-4000-8000-000000000009',
    'quantity',2)))$$, pg_temp.get('job'), pg_temp.get('lot_a')),
  '23514', null, 'F3: a line citing a wrong-source-system external identifier is refused');

select lives_ok(
  format($$select public.stage_acquisition_line_items(%L, jsonb_build_array(
    jsonb_build_object('public_id','WN-A-000100','lot_id',%L::uuid,
      'source_record_id','77770000-0000-4000-8000-000000000001',
      'external_identifier_id','88880000-0000-4000-8000-000000000001','quantity',2),
    jsonb_build_object('public_id','WN-A-000101','lot_id',%L::uuid,
      'source_record_id','77770000-0000-4000-8000-000000000002',
      'external_identifier_id','88880000-0000-4000-8000-000000000002','quantity',1)))$$,
    pg_temp.get('job'), pg_temp.get('lot_a'), pg_temp.get('lot_b')),
  'line items stage');

select pg_temp.put('line_a', (select id from public.acquisition_line_items
  where acquisition_import_job_id = pg_temp.get('job') and public_id = 'WN-A-000100'));
select pg_temp.put('line_b', (select id from public.acquisition_line_items
  where acquisition_import_job_id = pg_temp.get('job') and public_id = 'WN-A-000101'));

-- F3: a line-item retry that changes the external identifier is a conflict ---------------
select throws_ok(
  format($$select public.stage_acquisition_line_items(%L, jsonb_build_array(jsonb_build_object(
    'public_id','WN-A-000100','lot_id',%L::uuid,
    'source_record_id','77770000-0000-4000-8000-000000000001',
    'external_identifier_id','88880000-0000-4000-8000-000000000002','quantity',2)))$$,
    pg_temp.get('job'), pg_temp.get('lot_a')),
  '23514', null, 'F3: changing external_identifier_id on retry is a conflict');

-- F3: a line-item retry that re-homes the line to a different lot is a conflict ----------
select throws_ok(
  format($$select public.stage_acquisition_line_items(%L, jsonb_build_array(jsonb_build_object(
    'public_id','WN-A-000100','lot_id',%L::uuid,
    'source_record_id','77770000-0000-4000-8000-000000000001',
    'external_identifier_id','88880000-0000-4000-8000-000000000001','quantity',2)))$$,
    pg_temp.get('job'), pg_temp.get('lot_b')),
  '23514', null, 'F3: changing the requested lot placement on retry is a conflict');

-- ===== F1: cost-component retry idempotency =====
-- First stage: two line-scoped known components + one lot-scoped UNKNOWN one.
select lives_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(
    jsonb_build_object('line_item_id',%L::uuid,'component_type','item_price',
      'amount_state','known','amount_minor',1000,'currency','USD',
      'source_record_id','77770000-0000-4000-8000-000000000001'),
    jsonb_build_object('line_item_id',%L::uuid,'component_type','item_price',
      'amount_state','known','amount_minor',500,'currency','USD',
      'source_record_id','77770000-0000-4000-8000-000000000002'),
    jsonb_build_object('lot_id',%L::uuid,'component_type','shipping',
      'amount_state','unknown','currency','USD')))$$,
    pg_temp.get('job'), pg_temp.get('line_a'), pg_temp.get('line_b'), pg_temp.get('lot_a')),
  'components first stage');
select is((select count(*)::int from public.acquisition_cost_components
  where acquisition_import_job_id = pg_temp.get('job')), 3, 'three components staged');

-- Identical retry is a no-op that inserts zero.
select is(
  (select (public.stage_acquisition_cost_components(pg_temp.get('job'), jsonb_build_array(
     jsonb_build_object('line_item_id', pg_temp.get('line_a'),'component_type','item_price',
       'amount_state','known','amount_minor',1000,'currency','USD',
       'source_record_id','77770000-0000-4000-8000-000000000001')))->>'inserted')::int),
  0, 'F1: an identical cost-component retry inserts zero');
select is((select count(*)::int from public.acquisition_cost_components
  where acquisition_import_job_id = pg_temp.get('job')), 3, 'F1: no duplicate row was created');

-- A changed retry (different amount, same natural key) is a content conflict.
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(jsonb_build_object(
    'line_item_id',%L::uuid,'component_type','item_price','amount_state','known',
    'amount_minor',1200,'currency','USD',
    'source_record_id','77770000-0000-4000-8000-000000000001')))$$,
    pg_temp.get('job'), pg_temp.get('line_a')),
  '23514', null, 'F1: a changed cost-component retry raises a content conflict');

-- A within-batch duplicate (same scope+type+source twice) rejects the whole batch.
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(
    jsonb_build_object('order_id',%L::uuid,'component_type','tax','amount_state','known',
      'amount_minor',100,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000001'),
    jsonb_build_object('order_id',%L::uuid,'component_type','tax','amount_state','known',
      'amount_minor',100,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000001')))$$,
    pg_temp.get('job'), pg_temp.get('ord_a'), pg_temp.get('ord_a')),
  '23514', null, 'F1: a within-batch duplicate rejects the whole batch');
select is((select count(*)::int from public.acquisition_cost_components
  where acquisition_import_job_id = pg_temp.get('job')), 3, 'F1: the rejected batch inserted nothing');

-- F1: the database itself forbids two ACTIVE components with the same key (what
-- two concurrent commits would attempt). Insert a duplicate active row directly
-- and force the deferred constraint to check.
select pg_temp.logout();
select throws_ok($$
  do $x$
  declare v_ws uuid := 'aaaa0000-0000-4000-8000-000000000001';
  begin
    insert into public.acquisition_cost_components (
      workspace_id, public_id, line_item_id, component_type, amount_state, amount_minor,
      currency, attribution_state, source_record_id, acquisition_import_job_id, created_by_process)
    select v_ws, app.mint_governed_public_id('RV-ACOST'), c.line_item_id, c.component_type,
           c.amount_state, c.amount_minor, c.currency, c.attribution_state, c.source_record_id,
           c.acquisition_import_job_id, 'acquisition.import'
    from public.acquisition_cost_components c
    where c.line_item_id is not null and c.reversed_at is null
    limit 1;
    set constraints public.acquisition_cost_components_one_active_uniq immediate;
  end $x$;
$$, '23505', null, 'F1: a second active component with the same key is rejected by the DB');
select pg_temp.login('a2222222-2222-2222-2222-222222222222');

-- F3: a DIRECT (line-scoped) component whose source_record_id does not match the
-- line item it prices is refused.
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(jsonb_build_object(
    'line_item_id',%L::uuid,'component_type','fee','amount_state','known','amount_minor',50,
    'currency','USD','source_record_id','77770000-0000-4000-8000-000000000002')))$$,
    pg_temp.get('job'), pg_temp.get('line_a')),
  '23514', null, 'F3: a direct component citing a different row than its line is refused');

-- F3: a mixed batch (one valid component + one citing a cross-job source record)
-- is rejected wholesale — nothing from the batch is inserted.
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(
    jsonb_build_object('line_item_id',%L::uuid,'component_type','fee','amount_state','known',
      'amount_minor',25,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000001'),
    jsonb_build_object('line_item_id',%L::uuid,'component_type','tax','amount_state','known',
      'amount_minor',25,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000003')))$$,
    pg_temp.get('job'), pg_temp.get('line_a'), pg_temp.get('line_a')),
  '23514', null, 'F3: a mixed batch with a cross-job source record is rejected wholesale');
select is((select count(*)::int from public.acquisition_cost_components
  where acquisition_import_job_id = pg_temp.get('job')), 3,
  'F3: the rejected mixed batch inserted nothing');

-- ===== F4 setup: stage the shared components (allocation is post-commit) =====
-- Governed corrections and allocations may not touch a job while it is preview;
-- the shared components below are STAGED here and ALLOCATED after the commit.
-- The lot-scoped shipping component staged above is UNKNOWN (amount NULL).
select pg_temp.put('unknown_c', (select id from public.acquisition_cost_components
  where lot_id = pg_temp.get('lot_a') and component_type = 'shipping'));

select is((select amount_state::text from public.acquisition_cost_components
  where id = pg_temp.get('unknown_c')), 'unknown', 'the shipping component is unknown');

-- An order-scoped documented_free component (amount 0, evidence). It is not
-- 'known', so post-commit allocation must still refuse it — zero-with-evidence
-- is never an unknown shortcut.
select lives_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(jsonb_build_object(
    'order_id',%L::uuid,'component_type','discount','amount_state','documented_free',
    'amount_minor',0,'currency','USD','evidence_note','seller-confirmed promotional credit')))$$,
    pg_temp.get('job'), pg_temp.get('ord_a')),
  'a documented-free shared component stages');
select pg_temp.put('free_c', (select id from public.acquisition_cost_components
  where order_id = pg_temp.get('ord_a') and component_type = 'discount'));

-- An order-scoped KNOWN shipping component (300) to be allocated post-commit.
select lives_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(jsonb_build_object(
    'order_id',%L::uuid,'component_type','shipping','amount_state','known',
    'amount_minor',300,'currency','USD')))$$, pg_temp.get('job'), pg_temp.get('ord_a')),
  'a known shared component stages');
select pg_temp.put('known_c', (select id from public.acquisition_cost_components
  where order_id = pg_temp.get('ord_a') and component_type = 'shipping'));

-- GF2: allocation and confirmation are refused while the job is still preview.
select throws_ok(
  format($$select public.propose_cost_allocation(%L, 'manual_single', jsonb_build_array(
    jsonb_build_object('line_item_id',%L::uuid,'amount_minor',300)))$$,
    pg_temp.get('known_c'), pg_temp.get('line_a')),
  '23514', null, 'GF2: a known component cannot be allocated while the job is preview');
select throws_ok(
  format($$select public.confirm_cost_allocation(%L, 300)$$, pg_temp.get('known_c')),
  '23514', null, 'GF2: a component cannot be confirmed while the job is preview');

-- ===== F2 (final patch): complete cost provenance + zero-state enforcement =====
-- Five components exist on the job so far (3 from F1's first stage + 2 shared
-- from F4); the rejection tests below must leave that count unchanged.
select is((select count(*)::int from public.acquisition_cost_components
  where acquisition_import_job_id = pg_temp.get('job')), 5, 'F2: five components staged so far');

-- A DIRECT (line-scoped) import component with NO source_record_id is refused.
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(jsonb_build_object(
    'line_item_id',%L::uuid,'component_type','fee','amount_state','known',
    'amount_minor',50,'currency','USD')))$$, pg_temp.get('job'), pg_temp.get('line_a')),
  '23514', null, 'F2: a direct component without a source record is refused');

-- A known ZERO with an evidence_note is still refused (evidence does not rescue it).
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(jsonb_build_object(
    'line_item_id',%L::uuid,'component_type','fee','amount_state','known','amount_minor',0,
    'currency','USD','evidence_note','was free but priced as known',
    'source_record_id','77770000-0000-4000-8000-000000000001')))$$,
    pg_temp.get('job'), pg_temp.get('line_a')),
  '23514', null, 'F2: a known zero is refused even with an evidence note');

-- A mixed batch (one valid + one known-zero) is rejected wholesale.
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(
    jsonb_build_object('line_item_id',%L::uuid,'component_type','tax','amount_state','known',
      'amount_minor',10,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000001'),
    jsonb_build_object('line_item_id',%L::uuid,'component_type','fee','amount_state','known',
      'amount_minor',0,'currency','USD','evidence_note','x',
      'source_record_id','77770000-0000-4000-8000-000000000001')))$$,
    pg_temp.get('job'), pg_temp.get('line_a'), pg_temp.get('line_a')),
  '23514', null, 'F2: a mixed batch containing a known zero is rejected wholesale');
select is((select count(*)::int from public.acquisition_cost_components
  where acquisition_import_job_id = pg_temp.get('job')), 5,
  'F2: the rejected batches inserted nothing');

-- A valid DOCUMENTED-FREE line-scoped component (0 + evidence + its source) stages.
select lives_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(jsonb_build_object(
    'line_item_id',%L::uuid,'component_type','discount','amount_state','documented_free',
    'amount_minor',0,'currency','USD','evidence_note','seller-confirmed free bonus',
    'source_record_id','77770000-0000-4000-8000-000000000001')))$$,
    pg_temp.get('job'), pg_temp.get('line_a')),
  'F2: a valid documented-free direct component stages');

-- A valid KNOWN-POSITIVE line-scoped component (with its matching source) stages.
select lives_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(jsonb_build_object(
    'line_item_id',%L::uuid,'component_type','fee','amount_state','known','amount_minor',25,
    'currency','USD','source_record_id','77770000-0000-4000-8000-000000000002')))$$,
    pg_temp.get('job'), pg_temp.get('line_b')),
  'F2: a valid known-positive direct component stages');

-- ===== Commit the frozen plan, then prove post-commit allocation capabilities =====
-- Finalize recomputes the plan digest from the staged rows and compares it with
-- the frozen plan_sha256; the six reconciliation counts must also agree.
select lives_ok(
  format($$select public.finalize_acquisition_import_job(%L,
    'acq-key-accept-1', 2, 2, 2, 7, 0, 3)$$,
    pg_temp.get('job')),
  'the frozen plan finalizes: staged rows match the digest and the six counts');
select is((select status::text from public.acquisition_import_jobs where id = pg_temp.get('job')),
  'committed', 'the job is committed');

-- F4: an UNKNOWN-amount component still cannot be allocated (post-commit).
select throws_ok(
  format($$select public.propose_cost_allocation(%L, 'equal_split', jsonb_build_array(
    jsonb_build_object('line_item_id',%L::uuid,'amount_minor',100)))$$,
    pg_temp.get('unknown_c'), pg_temp.get('line_a')),
  '23514', null, 'F4: an unknown-amount component cannot be allocated');
select is((select attribution_state::text from public.acquisition_cost_components
  where id = pg_temp.get('unknown_c')), 'unresolved', 'F4: the component stays unresolved');
select is((select count(*)::int from public.acquisition_cost_allocations
  where cost_component_id = pg_temp.get('unknown_c')), 0, 'F4: no allocation rows were created');
select throws_ok(
  format($$select public.confirm_cost_allocation(%L, 100)$$, pg_temp.get('unknown_c')),
  '23514', null, 'F4: an unknown-amount component cannot be confirmed as allocated');

-- F4: a documented-free component is not an unknown-allocation shortcut.
select throws_ok(
  format($$select public.propose_cost_allocation(%L, 'equal_split', jsonb_build_array(
    jsonb_build_object('line_item_id',%L::uuid,'amount_minor',0)))$$,
    pg_temp.get('free_c'), pg_temp.get('line_a')),
  '23514', null, 'F4: a documented-free component cannot be used as an unknown allocation shortcut');

-- F4: a KNOWN shared component allocates and conserves within one minor unit.
select lives_ok(
  format($$select public.propose_cost_allocation(%L, 'manual_single', jsonb_build_array(
    jsonb_build_object('line_item_id',%L::uuid,'amount_minor',300)))$$,
    pg_temp.get('known_c'), pg_temp.get('line_a')),
  'F4: a known shared component can be proposed post-commit');
select lives_ok(
  format($$select public.confirm_cost_allocation(%L, 300)$$, pg_temp.get('known_c')),
  'F4: a known shared component confirms and conserves to the minor unit');
select is((select attribution_state::text from public.acquisition_cost_components
  where id = pg_temp.get('known_c')), 'allocated', 'F4: the known component is now allocated');
select is((select attribution_state::text from public.acquisition_cost_components
  where id = pg_temp.get('unknown_c')), 'unresolved',
  'F4: the unknown component remains unresolved throughout');

select pg_temp.logout();
select * from finish();
rollback;
