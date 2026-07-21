-- Phase 4 acquisition hierarchy — the governed staged import workflow,
-- end to end, plus cost-allocation, correction, and direct-DML-bypass
-- denial proofs. Mirrors the shape of 10_provenance_workflow.sql.
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
  insert into ids values (p_k, p_v)
  on conflict (k) do update set v = excluded.v
  returning v;
$$;
create function pg_temp.get(p_k text) returns uuid language sql stable as $$
  select v from ids where k = p_k;
$$;

create function pg_temp.h(p_seed text) returns text language sql immutable as $$
  select encode(sha256(p_seed::bytea), 'hex');
$$;

-- Fixtures ------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner-a@example.test'),
  ('a2222222-2222-2222-2222-222222222222', 'operator-a@example.test'),
  ('a3333333-3333-3333-3333-333333333333', 'viewer-a@example.test'),
  ('a4444444-4444-4444-4444-444444444444', 'owner-b@example.test');

insert into public.workspaces (id, name, created_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'Acquisition Workspace A',
   'a1111111-1111-1111-1111-111111111111'),
  ('bbbb0000-0000-4000-8000-000000000001', 'Acquisition Workspace B',
   'a4444444-4444-4444-4444-444444444444');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'operator'),
  ('aaaa0000-0000-4000-8000-000000000001', 'a3333333-3333-3333-3333-333333333333', 'viewer');

-- A committed Phase 3 import job with five small, deterministic rows, and a
-- second job left in preview (used to prove the provenance-dependency gate).
insert into public.source_systems (id, workspace_id, public_id, kind, instance_label, created_by)
values ('55550000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
        'REPO', 'repository_fixture', 'repository JSON seed fixtures',
        'a1111111-1111-1111-1111-111111111111');

-- Both start in 'preview': the append-only job-open trigger only allows
-- source_records to be inserted while the parent job is still open. JOB-SMALL
-- is promoted to 'committed' by a separate UPDATE below, AFTER its rows exist
-- — mirroring 07_provenance_append_only.sql's own fixture pattern exactly.
insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label, file_sha256,
  content_sha256, parser_version, mapping_version, idempotency_key, mode,
  source_row_count, actor_user_id, actor_process
) values (
  '66660000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
  'JOB-SMALL', '55550000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
  repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0', 'idem-small-000001', 'commit',
  5, 'a1111111-1111-1111-1111-111111111111', 'provenance.import'
), (
  '66660000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001',
  'JOB-PREVIEW', '55550000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
  repeat('b', 64), repeat('b', 64), '1.0.0', '1.0.0', 'idem-preview-000001', 'commit',
  5, 'a1111111-1111-1111-1111-111111111111', 'provenance.import'
), (
  '66660000-0000-4000-8000-000000000003', 'aaaa0000-0000-4000-8000-000000000001',
  'JOB-SMALL-2', '55550000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
  repeat('c', 64), repeat('c', 64), '1.0.0', '1.0.0', 'idem-small-000002', 'commit',
  0, 'a1111111-1111-1111-1111-111111111111', 'provenance.import'
);

-- A second, independent COMMITTED Phase 3 job (no rows needed) used only to
-- prove idempotency-key rebinding is refused across two VALID committed jobs.
update public.import_jobs
set status = 'committed', completed_at = now()
where id = '66660000-0000-4000-8000-000000000003';

insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, source_row_key, raw_payload,
  normalized_hash, parse_status, parser_output, parser_version, mapping_version,
  created_by_process
) values
  ('77770000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000001', 0, 'WN-A-000001',
   '{"acquisition_line_id":"WN-A-000001","order_id":"ORD-1","seller":"acme_traders","quantity_purchased":2,"total_paid":10}'::jsonb,
   pg_temp.h('r0'), 'parsed', '{"seller":"acme_traders"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  ('77770000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000001', 1, 'WN-A-000002',
   '{"acquisition_line_id":"WN-A-000002","order_id":"ORD-2","seller":"acme_traders","quantity_purchased":1,"total_paid":5}'::jsonb,
   pg_temp.h('r1'), 'parsed', '{"seller":"acme_traders"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  ('77770000-0000-4000-8000-000000000003', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000001', 2, 'WN-A-000003',
   '{"acquisition_line_id":"WN-A-000003","order_id":"ORD-3","seller":"west_coast_dealsRANDOM","quantity_purchased":1,"total_paid":7.5}'::jsonb,
   pg_temp.h('r2'), 'parsed', '{"seller":"west_coast_dealsRANDOM"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  ('77770000-0000-4000-8000-000000000004', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000001', 3, 'WN-A-000004',
   '{"acquisition_line_id":"WN-A-000004","order_id":"ORD-4","seller":"west_coast_dealsRandom","quantity_purchased":3,"total_paid":12}'::jsonb,
   pg_temp.h('r3'), 'parsed', '{"seller":"west_coast_dealsRandom"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  ('77770000-0000-4000-8000-000000000005', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000001', 4, 'WN-A-000005',
   '{"acquisition_line_id":"WN-A-000005","order_id":"ORD-5","seller":"bravo_co","quantity_purchased":1,"total_paid":0}'::jsonb,
   pg_temp.h('r4'), 'parsed', '{"seller":"bravo_co"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  -- ORD-6 is a MULTI-LINE order (two rows, same order_id): the only fixture
  -- shape that lets a lot-scoped shared cost component have more than one
  -- eligible line item to allocate across.
  ('77770000-0000-4000-8000-000000000006', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000001', 5, 'WN-A-000006',
   '{"acquisition_line_id":"WN-A-000006","order_id":"ORD-6","seller":"acme_traders","quantity_purchased":2,"total_paid":10}'::jsonb,
   pg_temp.h('r5'), 'parsed', '{"seller":"acme_traders"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'),
  ('77770000-0000-4000-8000-000000000007', 'aaaa0000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000001', 6, 'WN-A-000007',
   '{"acquisition_line_id":"WN-A-000007","order_id":"ORD-6","seller":"acme_traders","quantity_purchased":1,"total_paid":5}'::jsonb,
   pg_temp.h('r6'), 'parsed', '{"seller":"acme_traders"}'::jsonb, '1.0.0', '1.0.0', 'provenance.import');

update public.import_jobs
set status = 'committed', completed_at = now(), accepted_row_count = 7, issue_row_count = 0,
    source_row_count = 7
where id = '66660000-0000-4000-8000-000000000001';

-- Channel registration is owner-only, idempotent by name ---------------------------------
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$select public.register_channel('aaaa0000-0000-4000-8000-000000000001', 'Whatnot', 'marketplace')$$,
  '42501', null, 'an operator cannot register a channel');
select pg_temp.logout();

select pg_temp.login('a1111111-1111-1111-1111-111111111111');
select lives_ok(
  $$select pg_temp.put('channel', (public.register_channel(
      'aaaa0000-0000-4000-8000-000000000001', 'Whatnot', 'marketplace',
      'a marketplace channel')->>'id')::uuid)$$,
  'an owner can register a channel');

select is(
  (select (public.register_channel(
     'aaaa0000-0000-4000-8000-000000000001', 'Whatnot', 'marketplace')->>'resumed')::boolean),
  true,
  'registering the same channel name again resumes rather than duplicating');
select is(
  (select count(*)::int from public.channels where workspace_id = 'aaaa0000-0000-4000-8000-000000000001'),
  1, 'resuming created no second channel');
select pg_temp.logout();

-- A reusable staging helper: stages the full CLEAN plan for p_job, or a plan
-- with exactly one field tampered (p_variant), so tamper tests are one-liners.
-- Runs as whoever is currently logged in (operator).
create function pg_temp.stage_clean_plan(p_job uuid, p_variant text default 'clean')
returns void language plpgsql as $$
declare
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_l4 uuid; v_l5 uuid; v_l6 uuid; v_l7 uuid;
  v_lot61 uuid;
  v_place1 text;
  v_qty1 int := 2;
  v_desc1 text := 'Item 1';
  v_sd1 jsonb := '{"seller_raw_handle":"acme_traders","unit_cost":5,"note":null}'::jsonb;
  v_amt1 bigint := 1000;
begin
  if p_variant = 'qty' then v_qty1 := 3; end if;
  if p_variant = 'desc' then v_desc1 := 'TAMPERED'; end if;
  if p_variant = 'sd' then v_sd1 := '{"seller_raw_handle":"acme_traders","unit_cost":999,"note":null}'::jsonb; end if;
  if p_variant = 'amount' then v_amt1 := 9999; end if;

  perform public.stage_acquisition_orders(p_job, jsonb_build_array(
    jsonb_build_object('source_order_reference','ORD-1','seller_raw_handle','acme_traders',
      'first_source_record_id','77770000-0000-4000-8000-000000000001',
      'order_status','completed','source_reported_status','completed'),
    jsonb_build_object('source_order_reference','ORD-2','seller_raw_handle','acme_traders',
      'first_source_record_id','77770000-0000-4000-8000-000000000002',
      'order_status','completed','source_reported_status','completed'),
    jsonb_build_object('source_order_reference','ORD-3','seller_raw_handle','west_coast_dealsRANDOM',
      'first_source_record_id','77770000-0000-4000-8000-000000000003',
      'order_status','completed','source_reported_status','completed'),
    jsonb_build_object('source_order_reference','ORD-4','seller_raw_handle','west_coast_dealsRandom',
      'first_source_record_id','77770000-0000-4000-8000-000000000004',
      'order_status','completed','source_reported_status','completed'),
    jsonb_build_object('source_order_reference','ORD-5','seller_raw_handle','bravo_co',
      'first_source_record_id','77770000-0000-4000-8000-000000000005',
      'order_status','completed','source_reported_status','completed'),
    jsonb_build_object('source_order_reference','ORD-6','seller_raw_handle','acme_traders',
      'first_source_record_id','77770000-0000-4000-8000-000000000006',
      'order_status','completed','source_reported_status','completed')));

  -- lots: one per order, plus a second (empty) lot for ORD-6 (sequence 2).
  perform public.stage_acquisition_lots(p_job, (
    select jsonb_agg(jsonb_build_object('order_id', o.id, 'sequence_no', 1))
    from public.acquisition_orders o where o.acquisition_import_job_id = p_job));
  perform public.stage_acquisition_lots(p_job, jsonb_build_array(jsonb_build_object(
    'order_id', (select id from public.acquisition_orders
                 where acquisition_import_job_id = p_job and source_order_reference = 'ORD-6'),
    'sequence_no', 2)));

  v_lot61 := (select lt.id from public.acquisition_lots lt
              join public.acquisition_orders o on o.id = lt.order_id
              where o.acquisition_import_job_id = p_job and o.source_order_reference = 'ORD-6'
                and lt.sequence_no = 1);

  -- line 1's placement lot: normally ORD-1's lot; 'placement' variant mis-homes
  -- it into ORD-2's lot (still in-job, but not where the plan says).
  v_place1 := case when p_variant = 'placement' then 'ORD-2' else 'ORD-1' end;

  perform public.stage_acquisition_line_items(p_job, jsonb_build_array(
    jsonb_build_object('public_id','WN-A-000001',
      'lot_id',(select lt.id from public.acquisition_lots lt join public.acquisition_orders o on o.id=lt.order_id
                where o.acquisition_import_job_id=p_job and o.source_order_reference=v_place1 and lt.sequence_no=1),
      'source_record_id','77770000-0000-4000-8000-000000000001','quantity',v_qty1,
      'description',v_desc1,'source_detail',v_sd1),
    jsonb_build_object('public_id','WN-A-000002',
      'lot_id',(select lt.id from public.acquisition_lots lt join public.acquisition_orders o on o.id=lt.order_id
                where o.acquisition_import_job_id=p_job and o.source_order_reference='ORD-2' and lt.sequence_no=1),
      'source_record_id','77770000-0000-4000-8000-000000000002','quantity',1,'description','Item 2'),
    jsonb_build_object('public_id','WN-A-000003',
      'lot_id',(select lt.id from public.acquisition_lots lt join public.acquisition_orders o on o.id=lt.order_id
                where o.acquisition_import_job_id=p_job and o.source_order_reference='ORD-3' and lt.sequence_no=1),
      'source_record_id','77770000-0000-4000-8000-000000000003','quantity',1,'description','Item 3'),
    jsonb_build_object('public_id','WN-A-000004',
      'lot_id',(select lt.id from public.acquisition_lots lt join public.acquisition_orders o on o.id=lt.order_id
                where o.acquisition_import_job_id=p_job and o.source_order_reference='ORD-4' and lt.sequence_no=1),
      'source_record_id','77770000-0000-4000-8000-000000000004','quantity',3,'description','Item 4'),
    jsonb_build_object('public_id','WN-A-000005',
      'lot_id',(select lt.id from public.acquisition_lots lt join public.acquisition_orders o on o.id=lt.order_id
                where o.acquisition_import_job_id=p_job and o.source_order_reference='ORD-5' and lt.sequence_no=1),
      'source_record_id','77770000-0000-4000-8000-000000000005','quantity',1,'description','Item 5'),
    jsonb_build_object('public_id','WN-A-000006','lot_id',v_lot61,
      'source_record_id','77770000-0000-4000-8000-000000000006','quantity',2,'description','Item 6'),
    jsonb_build_object('public_id','WN-A-000007','lot_id',v_lot61,
      'source_record_id','77770000-0000-4000-8000-000000000007','quantity',1,'description','Item 7')));

  select id into v_l1 from public.acquisition_line_items where acquisition_import_job_id=p_job and public_id='WN-A-000001';
  select id into v_l2 from public.acquisition_line_items where acquisition_import_job_id=p_job and public_id='WN-A-000002';
  select id into v_l3 from public.acquisition_line_items where acquisition_import_job_id=p_job and public_id='WN-A-000003';
  select id into v_l4 from public.acquisition_line_items where acquisition_import_job_id=p_job and public_id='WN-A-000004';
  select id into v_l5 from public.acquisition_line_items where acquisition_import_job_id=p_job and public_id='WN-A-000005';
  select id into v_l6 from public.acquisition_line_items where acquisition_import_job_id=p_job and public_id='WN-A-000006';
  select id into v_l7 from public.acquisition_line_items where acquisition_import_job_id=p_job and public_id='WN-A-000007';

  -- 6 known + 1 unknown (line 5) line-scoped item_price components, each citing
  -- its own source record, plus one lot-scoped shared shipping (unresolved).
  perform public.stage_acquisition_cost_components(p_job, jsonb_build_array(
    jsonb_build_object('line_item_id',v_l1,'component_type','item_price','amount_state','known',
      'amount_minor',v_amt1,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000001'),
    jsonb_build_object('line_item_id',v_l2,'component_type','item_price','amount_state','known',
      'amount_minor',500,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000002'),
    jsonb_build_object('line_item_id',v_l3,'component_type','item_price','amount_state','known',
      'amount_minor',750,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000003'),
    jsonb_build_object('line_item_id',v_l4,'component_type','item_price','amount_state','known',
      'amount_minor',1200,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000004'),
    jsonb_build_object('line_item_id',v_l5,'component_type','item_price','amount_state','unknown',
      'currency','USD','source_record_id','77770000-0000-4000-8000-000000000005'),
    jsonb_build_object('line_item_id',v_l6,'component_type','item_price','amount_state','known',
      'amount_minor',1000,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000006'),
    jsonb_build_object('line_item_id',v_l7,'component_type','item_price','amount_state','known',
      'amount_minor',500,'currency','USD','source_record_id','77770000-0000-4000-8000-000000000007'),
    jsonb_build_object('lot_id',v_lot61,'component_type','shipping','amount_state','known',
      'amount_minor',300,'currency','USD')));
end $$;

-- The frozen plan digest for the clean plan, captured once from the database's
-- own canonical function app.compute_acquisition_plan_digest (this value is what
-- that function returns for the plan staged by pg_temp.stage_clean_plan).
set my.dclean = 'e567ba47fbfdc3bb9433b1fde7efaed2a73bbcb0c354a9d708e1fa88e49fb2cb';

-- ===== GF2: governed corrections are refused while the job is preview =====
savepoint pre;
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select pg_temp.put('pjob', (public.begin_acquisition_import_job(
  'aaaa0000-0000-4000-8000-000000000001', pg_temp.get('channel'),
  '66660000-0000-4000-8000-000000000001', 'idem-preview-guard', 7, '1.0.0', repeat('a',64))->>'id')::uuid);
select pg_temp.stage_clean_plan(pg_temp.get('pjob'), 'clean');
select pg_temp.put('pc_line1', (select id from public.acquisition_line_items
  where acquisition_import_job_id = pg_temp.get('pjob') and public_id = 'WN-A-000001'));
select pg_temp.put('pc_ship', (select c.id from public.acquisition_cost_components c
  where c.acquisition_import_job_id = pg_temp.get('pjob') and c.component_type = 'shipping'));
select pg_temp.put('pc_placement', (select ll.id from public.acquisition_lot_lines ll
  where ll.line_item_id = pg_temp.get('pc_line1') and ll.state = 'active'));
select pg_temp.put('pc_lot62', (select lt.id from public.acquisition_lots lt
  join public.acquisition_orders o on o.id = lt.order_id
  where o.acquisition_import_job_id = pg_temp.get('pjob') and o.source_order_reference='ORD-6' and lt.sequence_no=2));
select throws_ok(
  format($$select public.propose_cost_allocation(%L, 'equal_split', jsonb_build_array(
    jsonb_build_object('line_item_id',%L::uuid,'amount_minor',100)))$$,
    pg_temp.get('pc_ship'), pg_temp.get('pc_line1')),
  '23514', null, 'GF2: an operator cannot allocate a component while the job is preview');
select throws_ok(
  format($$select public.reverse_cost_component(%L, jsonb_build_object('amount_minor',1),'x')$$,
    (select id from public.acquisition_cost_components
     where acquisition_import_job_id = pg_temp.get('pjob') and line_item_id = pg_temp.get('pc_line1'))),
  '23514', null, 'GF2: an operator cannot reverse a component while the job is preview');
select throws_ok(
  format($$select public.supersede_lot_line(%L, %L, 'x')$$, pg_temp.get('pc_placement'), pg_temp.get('pc_lot62')),
  '23514', null, 'GF2: an operator cannot supersede a lot-line while the job is preview');
select pg_temp.logout();
rollback to savepoint pre;

-- ===== A line cannot be staged into another acquisition job's lot =====
savepoint xjob;
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
-- open two preview jobs on the same source is blocked once one commits; here both are preview.
select pg_temp.put('jobA', (public.begin_acquisition_import_job(
  'aaaa0000-0000-4000-8000-000000000001', pg_temp.get('channel'),
  '66660000-0000-4000-8000-000000000001', 'idem-xjob-a', 7, '1.0.0', repeat('a',64))->>'id')::uuid);
select public.stage_acquisition_orders(pg_temp.get('jobA'), jsonb_build_array(jsonb_build_object(
  'source_order_reference','ORD-1','seller_raw_handle','acme_traders',
  'first_source_record_id','77770000-0000-4000-8000-000000000001',
  'order_status','completed','source_reported_status','completed')));
select public.stage_acquisition_lots(pg_temp.get('jobA'), jsonb_build_array(jsonb_build_object(
  'order_id',(select id from public.acquisition_orders where acquisition_import_job_id=pg_temp.get('jobA')))));
-- a lot from a DIFFERENT job (the preview-guard job would be gone; use a foreign lot id)
select throws_ok(
  format($$select public.stage_acquisition_line_items(%L, jsonb_build_array(jsonb_build_object(
    'public_id','WN-A-000002','lot_id',%L::uuid,
    'source_record_id','77770000-0000-4000-8000-000000000002','quantity',1)))$$,
    pg_temp.get('jobA'), '00000000-0000-4000-8000-0000000000ff'),
  '23514', null, 'a line cannot be placed into a lot that is not staged in this job');
select pg_temp.logout();
rollback to savepoint xjob;

-- ===== Digest tamper refusals (each isolated by a savepoint) =====
-- Helper: stage a (possibly tampered) plan under DCLEAN and try to finalize.
create function pg_temp.try_finalize(p_variant text, p_digest text)
returns void language plpgsql as $$
declare v_job uuid;
begin
  v_job := (public.begin_acquisition_import_job(
    'aaaa0000-0000-4000-8000-000000000001', pg_temp.get('channel'),
    '66660000-0000-4000-8000-000000000001', 'idem-tamper', 7, '1.0.0', p_digest)->>'id')::uuid;
  perform pg_temp.stage_clean_plan(v_job, p_variant);
  perform public.finalize_acquisition_import_job(v_job, 'idem-tamper', 6, 7, 7, 8, 1, 1);
end $$;

select pg_temp.login('a2222222-2222-2222-2222-222222222222');
-- An arbitrary 64-char digest with otherwise-valid rows is refused.
savepoint t0;
select throws_ok($$select pg_temp.try_finalize('clean', repeat('f',64))$$, '23514', null,
  'an arbitrary plan digest with valid rows is refused at finalize');
rollback to savepoint t0;
-- Each single-field change is refused under the clean digest.
savepoint t1;
select throws_ok(format($$select pg_temp.try_finalize('qty', %L)$$, current_setting('my.dclean')),
  '23514', null, 'a changed quantity (same line count) is refused');
rollback to savepoint t1;
savepoint t2;
select throws_ok(format($$select pg_temp.try_finalize('desc', %L)$$, current_setting('my.dclean')),
  '23514', null, 'a changed description is refused');
rollback to savepoint t2;
savepoint t3;
select throws_ok(format($$select pg_temp.try_finalize('sd', %L)$$, current_setting('my.dclean')),
  '23514', null, 'a changed source_detail is refused');
rollback to savepoint t3;
savepoint t4;
select throws_ok(format($$select pg_temp.try_finalize('amount', %L)$$, current_setting('my.dclean')),
  '23514', null, 'a changed cost amount is refused');
rollback to savepoint t4;
savepoint t5;
select throws_ok(format($$select pg_temp.try_finalize('placement', %L)$$, current_setting('my.dclean')),
  '23514', null, 'a changed lot placement is refused');
rollback to savepoint t5;
-- The rejected finalizations left the job in preview and wrote no commit event.
select is((select count(*)::int from public.acquisition_import_jobs
           where source_import_job_id='66660000-0000-4000-8000-000000000001' and status='committed'),
  0, 'no tampered finalization committed');
select is((select count(*)::int from public.audit_events
           where event_type='acquisition_import_committed'), 0,
  'no rejected finalization wrote a commit audit event');
select pg_temp.logout();

-- ===== Clean commit: the correct plan digest finalizes =====
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select pg_temp.put('job', (public.begin_acquisition_import_job(
  'aaaa0000-0000-4000-8000-000000000001', pg_temp.get('channel'),
  '66660000-0000-4000-8000-000000000001', 'idem-acq-00000001', 7, '1.0.0',
  current_setting('my.dclean'))->>'id')::uuid);
select pg_temp.stage_clean_plan(pg_temp.get('job'), 'clean');
select is(
  (select (public.finalize_acquisition_import_job(pg_temp.get('job'), 'idem-acq-00000001',
     6, 7, 7, 8, 1, 1))->>'status'),
  'committed', 'the clean plan with the correct database-recomputed digest commits');
select is(
  (select count(*)::int from public.audit_events
   where event_type='acquisition_import_committed' and subject_id = pg_temp.get('job')),
  1, 'exactly one commit audit event was written');

-- ===== Frozen replay + changed-binding refusals =====
select is(
  (select (public.get_committed_acquisition_summary(pg_temp.get('job'), 'idem-acq-00000001',
     pg_temp.get('channel'), '66660000-0000-4000-8000-000000000001', 7, '1.0.0',
     current_setting('my.dclean')))->>'cost_components'),
  '8', 'a committed replay returns the frozen cost-component count');
select throws_ok(
  format($$select public.get_committed_acquisition_summary(%L,'idem-acq-00000001',%L,
    '66660000-0000-4000-8000-000000000001', 99, '1.0.0', %L)$$,
    pg_temp.get('job'), pg_temp.get('channel'), current_setting('my.dclean')),
  '22023', null, 'a committed replay with a changed line count is refused');
select throws_ok(
  format($$select public.get_committed_acquisition_summary(%L,'idem-acq-00000001',%L,
    '66660000-0000-4000-8000-000000000001', 7, '1.0.0', %L)$$,
    pg_temp.get('job'), pg_temp.get('channel'), repeat('e',64)),
  '22023', null, 'a committed replay with a changed plan digest is refused');

-- ===== Post-commit capabilities now work on the committed job =====
select pg_temp.put('ship', (select c.id from public.acquisition_cost_components c
  where c.acquisition_import_job_id = pg_temp.get('job') and c.component_type = 'shipping'));
select pg_temp.put('line6', (select id from public.acquisition_line_items
  where acquisition_import_job_id = pg_temp.get('job') and public_id = 'WN-A-000006'));
select pg_temp.put('line7', (select id from public.acquisition_line_items
  where acquisition_import_job_id = pg_temp.get('job') and public_id = 'WN-A-000007'));
select lives_ok(
  format($$select public.propose_cost_allocation(%L, 'quantity_share', jsonb_build_array(
    jsonb_build_object('line_item_id',%L::uuid,'amount_minor',200),
    jsonb_build_object('line_item_id',%L::uuid,'amount_minor',100)))$$,
    pg_temp.get('ship'), pg_temp.get('line6'), pg_temp.get('line7')),
  'post-commit: a shared component can be allocated');
select lives_ok(
  format($$select public.confirm_cost_allocation(%L, 300)$$, pg_temp.get('ship')),
  'post-commit: the allocation confirms and conserves');
select is((select attribution_state::text from public.acquisition_cost_components
  where id = pg_temp.get('ship')), 'allocated', 'post-commit: the component is allocated');
select lives_ok(
  format($$select public.reverse_cost_allocation(%L, 'redo')$$, pg_temp.get('ship')),
  'post-commit: the allocation can be reversed');
select lives_ok(
  format($$select public.reverse_cost_component(%L, jsonb_build_object('amount_minor',1100),
    'corrected')$$,
    (select id from public.acquisition_cost_components
     where acquisition_import_job_id = pg_temp.get('job') and line_item_id = pg_temp.get('line6')
       and reversed_at is null)),
  'post-commit: a cost component can be reversed/replaced');
select pg_temp.put('place7', (select ll.id from public.acquisition_lot_lines ll
  where ll.line_item_id = pg_temp.get('line7') and ll.state = 'active'));
select pg_temp.put('lot62', (select lt.id from public.acquisition_lots lt
  join public.acquisition_orders o on o.id = lt.order_id
  where o.acquisition_import_job_id = pg_temp.get('job') and o.source_order_reference='ORD-6' and lt.sequence_no=2));
select lives_ok(
  format($$select public.supersede_lot_line(%L, %L, 'rehome')$$, pg_temp.get('place7'), pg_temp.get('lot62')),
  'post-commit: a lot-line can be superseded (re-homed)');

-- ===== Post-commit actions did NOT change the frozen replay summary =====
select is(
  (select (public.get_committed_acquisition_summary(pg_temp.get('job'), 'idem-acq-00000001',
     pg_temp.get('channel'), '66660000-0000-4000-8000-000000000001', 7, '1.0.0',
     current_setting('my.dclean')))->>'cost_components'),
  '8', 'the frozen replay count is unchanged after post-commit corrections');

-- ===== Direct-DML bypass denial (authenticated has SELECT only) =====
select throws_ok(
  $$insert into public.channels (workspace_id, public_id, name, kind, created_by)
    values ('aaaa0000-0000-4000-8000-000000000001','RV-CH-AAAAAA','x','manual','a2222222-2222-2222-2222-222222222222')$$,
  '42501', null, 'authenticated cannot directly INSERT channels');
select throws_ok(
  $$update public.acquisition_import_jobs set status='failed' where id = '00000000-0000-0000-0000-000000000000'$$,
  '42501', null, 'authenticated cannot directly UPDATE acquisition_import_jobs');
select pg_temp.logout();

-- ===== Viewer is read-only; cross-workspace isolation =====
select pg_temp.login('a3333333-3333-3333-3333-333333333333');
select throws_ok(
  format($$select public.reverse_cost_allocation(%L,'x')$$, pg_temp.get('ship')),
  '42501', null, 'a viewer cannot run governed corrections');
select pg_temp.logout();

select pg_temp.login('a4444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.acquisition_orders), 0,
  'workspace B sees none of workspace A''s acquisition orders (RLS)');
select pg_temp.logout();

select * from finish();
rollback;
