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

-- begin_acquisition_import_job: provenance dependency enforcement ------------------------
select pg_temp.login('a2222222-2222-2222-2222-222222222222');

select throws_ok(
  format($$select public.begin_acquisition_import_job(
      'aaaa0000-0000-4000-8000-000000000001', %L, %L, 'idem-acq-00000001', 5)$$,
    pg_temp.get('channel'), '66660000-0000-4000-8000-000000000002'),
  '23514', null,
  'begin refuses to map a Phase 3 job that has not been committed');

select lives_ok(
  format($$select pg_temp.put('job', (public.begin_acquisition_import_job(
      'aaaa0000-0000-4000-8000-000000000001', %L, %L, 'idem-acq-00000001', 7)->>'id')::uuid)$$,
    pg_temp.get('channel'), '66660000-0000-4000-8000-000000000001'),
  'begin opens an acquisition import job against a COMMITTED Phase 3 job');

select is(
  (select (public.begin_acquisition_import_job(
     'aaaa0000-0000-4000-8000-000000000001', pg_temp.get('channel'),
     '66660000-0000-4000-8000-000000000001', 'idem-acq-00000001', 7)->>'resumed')::boolean),
  true, 'reopening with the same idempotency key resumes the existing job');

select throws_ok(
  format($$select public.begin_acquisition_import_job(
      'aaaa0000-0000-4000-8000-000000000001', %L, %L, 'idem-acq-00000001', 99)$$,
    pg_temp.get('channel'), '66660000-0000-4000-8000-000000000003'),
  '22023', null,
  'reusing the idempotency key for a DIFFERENT (also committed) source job is refused');

-- Stage orders: seller resolution, non-merging, within-batch and cross-call conflicts ----
select lives_ok(
  format($$select public.stage_acquisition_orders(%L, jsonb_build_array(
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
      'order_status','cancelled','source_reported_status','cancelled'),
    jsonb_build_object('source_order_reference','ORD-6','seller_raw_handle','acme_traders',
      'first_source_record_id','77770000-0000-4000-8000-000000000006',
      'order_status','completed','source_reported_status','completed')
  ))$$, pg_temp.get('job')),
  'six orders are staged, resolving four distinct suppliers');

select is(
  (select count(*)::int from public.acquisition_orders where acquisition_import_job_id = pg_temp.get('job')),
  6, 'exactly six orders staged');
select is(
  (select count(*)::int from public.suppliers where workspace_id = 'aaaa0000-0000-4000-8000-000000000001'),
  4, 'exactly four distinct suppliers were minted (acme_traders once, two colliding spellings stay separate)');
select is(
  (select count(distinct supplier_id)::int from public.supplier_aliases
   where workspace_id = 'aaaa0000-0000-4000-8000-000000000001'
     and normalized_handle = app.normalize_supplier_handle('west_coast_dealsRANDOM')),
  2, 'the colliding spellings resolve to TWO DIFFERENT suppliers: never auto-merged');

-- Within-batch duplicate source order reference is refused, before any insert ------------
select throws_ok(
  format($$select public.stage_acquisition_orders(%L, jsonb_build_array(
    jsonb_build_object('source_order_reference','ORD-DUP','seller_raw_handle','acme_traders',
      'first_source_record_id','77770000-0000-4000-8000-000000000001',
      'order_status','completed'),
    jsonb_build_object('source_order_reference','ORD-DUP','seller_raw_handle','acme_traders',
      'first_source_record_id','77770000-0000-4000-8000-000000000001',
      'order_status','completed')
  ))$$, pg_temp.get('job')),
  '23514', null, 'a batch with the same source order reference twice is refused');

select is(
  (select count(*)::int from public.acquisition_orders where source_order_reference = 'ORD-DUP'),
  0, 'the rejected duplicate-order batch inserted nothing');

-- A later, separate-call retry of already-staged orders is a content-idempotent no-op ----
select is(
  (select (public.stage_acquisition_orders(pg_temp.get('job'), jsonb_build_array(
    jsonb_build_object('source_order_reference','ORD-1','seller_raw_handle','acme_traders',
      'first_source_record_id','77770000-0000-4000-8000-000000000001',
      'order_status','completed','source_reported_status','completed')
  ))->>'inserted')::int),
  0, 'a separate-call retry of an already-staged order is a safe no-op');

-- A retry with DIFFERENT content for the same order is refused, not silently dropped -----
select throws_ok(
  format($$select public.stage_acquisition_orders(%L, jsonb_build_array(
    jsonb_build_object('source_order_reference','ORD-1','seller_raw_handle','acme_traders',
      'first_source_record_id','77770000-0000-4000-8000-000000000001',
      'order_status','cancelled','source_reported_status','cancelled')
  ))$$, pg_temp.get('job')),
  '23514', null,
  'a retry that changes an already-staged order''s content is refused');

-- Stage lots: one per order (sequence 1); the required grouping layer -------------------
select lives_ok(
  format($$
    select public.stage_acquisition_lots(%L, (
      select jsonb_agg(jsonb_build_object('order_id', o.id, 'sequence_no', 1))
      from public.acquisition_orders o where o.acquisition_import_job_id = %L
    ))
  $$, pg_temp.get('job'), pg_temp.get('job')),
  'one lot per order is staged');

select is(
  (select count(*)::int from public.acquisition_lots lt
   join public.acquisition_orders o on o.id = lt.order_id
   where o.acquisition_import_job_id = pg_temp.get('job')),
  6, 'exactly six lots staged, one per order');

select throws_ok(
  $$select public.stage_acquisition_lots(
      (select v from ids where k = 'job'),
      jsonb_build_array(
        jsonb_build_object('order_id', gen_random_uuid(), 'sequence_no', 1)
      ))$$,
  '23514', null, 'a lot referencing an order not staged in this job is refused');

-- Stage line items: WN-A ids preserved exactly, provenance-dependency enforced -----------
select lives_ok(
  format($$
    select public.stage_acquisition_line_items(%L, (
      select jsonb_agg(jsonb_build_object(
        'public_id', sr.source_row_key,
        'lot_id', lt.id,
        'source_record_id', sr.id,
        'quantity', (sr.raw_payload->>'quantity_purchased')::int,
        'description', sr.raw_payload->>'seller'
      ))
      from public.source_records sr
      join public.acquisition_orders o
        on o.acquisition_import_job_id = %L
       and o.source_order_reference = sr.raw_payload->>'order_id'
      join public.acquisition_lots lt on lt.order_id = o.id and lt.sequence_no = 1
      where sr.import_job_id = '66660000-0000-4000-8000-000000000001'
    ))
  $$, pg_temp.get('job'), pg_temp.get('job')),
  'seven canonical line items are staged, one per raw source row');

select is(
  (select count(*)::int from public.acquisition_line_items where acquisition_import_job_id = pg_temp.get('job')),
  7, 'exactly seven line items staged');
select results_eq(
  $$select public_id from public.acquisition_line_items
    where acquisition_import_job_id = (select v from ids where k = 'job')
    order by public_id$$,
  $$values ('WN-A-000001'), ('WN-A-000002'), ('WN-A-000003'), ('WN-A-000004'), ('WN-A-000005'),
           ('WN-A-000006'), ('WN-A-000007')$$,
  'every original WN-A public id is preserved exactly'
);
select is(
  (select count(*)::int from public.acquisition_lot_lines ll
   join public.acquisition_line_items li on li.id = ll.line_item_id
   where li.acquisition_import_job_id = pg_temp.get('job') and ll.state = 'active'),
  7, 'every line item has exactly one active lot-line placement');
select is(
  (select count(*)::int from public.acquisition_lot_lines ll
   join public.acquisition_lots lt on lt.id = ll.lot_id
   join public.acquisition_orders o on o.id = lt.order_id
   where o.source_order_reference = 'ORD-6' and ll.state = 'active'),
  2, 'ORD-6''s single lot correctly holds both of its line items');

-- A line item referencing a source record from a DIFFERENT Phase 3 job is refused -------
-- (Direct fixture insert: drop back to the owning role, which alone may
-- write source_records, then resume the operator session.)
select pg_temp.logout();
insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, source_row_key, raw_payload,
  normalized_hash, parse_status, parser_output, parser_version, mapping_version,
  created_by_process
) values (
  '77770000-0000-4000-8000-00000000009f', 'aaaa0000-0000-4000-8000-000000000001',
  '66660000-0000-4000-8000-000000000002', 0, 'WN-A-999999',
  '{"acquisition_line_id":"WN-A-999999"}'::jsonb, pg_temp.h('foreign-row'), 'parsed',
  '{}'::jsonb, '1.0.0', '1.0.0', 'provenance.import'
);
select pg_temp.login('a2222222-2222-2222-2222-222222222222');

select throws_ok(
  format($$select public.stage_acquisition_line_items(%L, jsonb_build_array(
    jsonb_build_object('public_id','WN-A-999999',
      'lot_id', (select lt.id from public.acquisition_lots lt
                 join public.acquisition_orders o on o.id = lt.order_id
                 where o.acquisition_import_job_id = %L and lt.sequence_no = 1 limit 1),
      'source_record_id','77770000-0000-4000-8000-00000000009f','quantity',1)
  ))$$, pg_temp.get('job'), pg_temp.get('job')),
  '23514', null,
  'a line item citing a source record from a DIFFERENT (uncommitted) Phase 3 job is refused');

select is(
  (select count(*)::int from public.acquisition_line_items where public_id = 'WN-A-999999'),
  0, 'the refused cross-job line item was not inserted');

-- Within-batch duplicate line item public id is refused ----------------------------------
select throws_ok(
  format($$select public.stage_acquisition_line_items(%L, jsonb_build_array(
    jsonb_build_object('public_id','WN-A-DUP',
      'lot_id', (select lt.id from public.acquisition_lots lt
                 join public.acquisition_orders o on o.id = lt.order_id
                 where o.acquisition_import_job_id = %L and lt.sequence_no = 1 limit 1),
      'source_record_id','77770000-0000-4000-8000-000000000001','quantity',1),
    jsonb_build_object('public_id','WN-A-DUP',
      'lot_id', (select lt.id from public.acquisition_lots lt
                 join public.acquisition_orders o on o.id = lt.order_id
                 where o.acquisition_import_job_id = %L and lt.sequence_no = 1 limit 1),
      'source_record_id','77770000-0000-4000-8000-000000000001','quantity',1)
  ))$$, pg_temp.get('job'), pg_temp.get('job'), pg_temp.get('job')),
  '23514', null, 'a batch with the same line item public id twice is refused');

-- Stage cost components: one direct component per line, from total_paid -----------------
select lives_ok(
  format($$
    select public.stage_acquisition_cost_components(%L, (
      select jsonb_agg(jsonb_build_object(
        'line_item_id', li.id,
        'component_type', 'item_price',
        'amount_state', case when (sr.raw_payload->>'total_paid')::numeric = 0
                              then 'documented_free' else 'known' end,
        'amount_minor', round((sr.raw_payload->>'total_paid')::numeric * 100)::bigint,
        'currency', 'USD',
        'evidence_note', case when (sr.raw_payload->>'total_paid')::numeric = 0
                               then 'seller-documented free item' else null end,
        'source_record_id', sr.id
      ))
      from public.acquisition_line_items li
      join public.source_records sr on sr.id = li.source_record_id
      where li.acquisition_import_job_id = %L
    ))
  $$, pg_temp.get('job'), pg_temp.get('job')),
  'seven direct cost components are staged, one per line'
);

select is(
  (select count(*)::int from public.acquisition_cost_components
   where acquisition_import_job_id = pg_temp.get('job')),
  7, 'exactly seven direct cost components staged');
select is(
  (select count(*)::int from public.acquisition_cost_components
   where acquisition_import_job_id = pg_temp.get('job') and attribution_state = 'direct'),
  7, 'every staged cost component is directly attributed to its own line');
select is(
  (select count(*)::int from public.acquisition_cost_components
   where acquisition_import_job_id = pg_temp.get('job') and amount_state = 'documented_free'),
  1, 'exactly one documented-free (zero-cost, evidenced) component exists');

-- Zero cost WITHOUT documented evidence is refused (schema-level, not importer logic) ----
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(
    jsonb_build_object('line_item_id', (select id from public.acquisition_line_items
                          where acquisition_import_job_id = %L limit 1),
      'component_type','fee','amount_state','known','amount_minor',0,'currency','USD')
  ))$$, pg_temp.get('job'), pg_temp.get('job')),
  '23514', null, 'a zero KNOWN amount with no documented-free evidence is refused');

-- Unknown cost must have a NULL amount, never zero ---------------------------------------
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(
    jsonb_build_object('line_item_id', (select id from public.acquisition_line_items
                          where acquisition_import_job_id = %L limit 1),
      'component_type','shipping','amount_state','unknown','amount_minor',0,'currency','USD')
  ))$$, pg_temp.get('job'), pg_temp.get('job')),
  '23514', null, 'an unknown-state component cannot carry a zero (or any) amount');

-- A cost component must scope to EXACTLY ONE target --------------------------------------
select throws_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(
    jsonb_build_object(
      'line_item_id', (select id from public.acquisition_line_items where acquisition_import_job_id = %L limit 1),
      'order_id', (select id from public.acquisition_orders where acquisition_import_job_id = %L limit 1),
      'component_type','item_price','amount_state','known','amount_minor',100,'currency','USD')
  ))$$, pg_temp.get('job'), pg_temp.get('job'), pg_temp.get('job')),
  '22023', null, 'a cost component naming two scope targets at once is refused');

-- Stage a LOT-scoped SHARED cost component (shipping) for ORD-6's lot -------------------
-- Two line items share this lot, so it is the only component in this fixture
-- that actually needs allocation.
select lives_ok(
  format($$select public.stage_acquisition_cost_components(%L, jsonb_build_array(
    jsonb_build_object(
      'lot_id', (select lt.id from public.acquisition_lots lt
                 join public.acquisition_orders o on o.id = lt.order_id
                 where o.source_order_reference = 'ORD-6' and lt.sequence_no = 1),
      'component_type','shipping','amount_state','known','amount_minor',300,'currency','USD')
  ))$$, pg_temp.get('job')),
  'a lot-scoped shared shipping cost component is staged');

select pg_temp.put('shipping_component',
  (select id from public.acquisition_cost_components
   where lot_id = (select lt.id from public.acquisition_lots lt
                   join public.acquisition_orders o on o.id = lt.order_id
                   where o.source_order_reference = 'ORD-6' and lt.sequence_no = 1)));
select pg_temp.put('line6', (select id from public.acquisition_line_items where public_id = 'WN-A-000006'));
select pg_temp.put('line7', (select id from public.acquisition_line_items where public_id = 'WN-A-000007'));

select is(
  (select attribution_state::text from public.acquisition_cost_components
   where id = pg_temp.get('shipping_component')),
  'unresolved',
  'a lot-scoped shared component is derived as unresolved: the importer never invents an allocation');

-- Allocation: within-batch duplicate line item is refused ---------------------------------
select throws_ok(
  format($$select public.propose_cost_allocation(%L, 'proportional_by_quantity', jsonb_build_array(
    jsonb_build_object('line_item_id', %L, 'amount_minor', 100),
    jsonb_build_object('line_item_id', %L, 'amount_minor', 100)
  ))$$, pg_temp.get('shipping_component'), pg_temp.get('line6'), pg_temp.get('line6')),
  '23514', null, 'a duplicate line item within one allocation proposal is refused');

-- Allocation: a line item outside the component's scope is refused -----------------------
select throws_ok(
  format($$select public.propose_cost_allocation(%L, 'proportional_by_quantity', jsonb_build_array(
    jsonb_build_object('line_item_id', %L, 'amount_minor', 300)
  ))$$, pg_temp.get('shipping_component'),
    (select id from public.acquisition_line_items where public_id = 'WN-A-000001')),
  '23514', null, 'an allocation line item outside the component''s lot is refused');

-- A conserving quantity-proportional split (2:1 => 200/100) is proposed -------------------
select lives_ok(
  format($$select public.propose_cost_allocation(%L, 'proportional_by_quantity', jsonb_build_array(
    jsonb_build_object('line_item_id', %L, 'amount_minor', 200),
    jsonb_build_object('line_item_id', %L, 'amount_minor', 100)
  ))$$, pg_temp.get('shipping_component'), pg_temp.get('line6'), pg_temp.get('line7')),
  'a conserving two-line allocation proposal is recorded as candidates');

select is(
  (select count(*)::int from public.acquisition_cost_allocations
   where cost_component_id = pg_temp.get('shipping_component') and state = 'candidate'),
  2, 'two candidate allocation rows exist');

-- Confirm with the WRONG expected total is refused ----------------------------------------
select throws_ok(
  format($$select public.confirm_cost_allocation(%L, 250)$$, pg_temp.get('shipping_component')),
  '23514', null, 'confirming with a mismatched expected total is refused');

select is(
  (select attribution_state::text from public.acquisition_cost_components
   where id = pg_temp.get('shipping_component')),
  'unresolved', 'the rejected confirmation left the component unresolved');

-- Confirm with the correct expected total succeeds ----------------------------------------
select lives_ok(
  format($$select public.confirm_cost_allocation(%L, 300)$$, pg_temp.get('shipping_component')),
  'confirming with the correct expected total succeeds');

select is(
  (select attribution_state::text from public.acquisition_cost_components
   where id = pg_temp.get('shipping_component')),
  'allocated', 'the component is now allocated');
select is(
  (select count(*)::int from public.acquisition_cost_allocations
   where cost_component_id = pg_temp.get('shipping_component') and state = 'confirmed'),
  2, 'both allocations are confirmed');
select is(
  (select sum(amount_minor)::bigint from public.acquisition_cost_allocations
   where cost_component_id = pg_temp.get('shipping_component') and state = 'confirmed'),
  300::bigint, 'confirmed allocations conserve the component amount exactly, to the minor unit');

-- Proposing again on an already-allocated component is refused ----------------------------
select throws_ok(
  format($$select public.propose_cost_allocation(%L, 'equal_split', jsonb_build_array(
    jsonb_build_object('line_item_id', %L, 'amount_minor', 150)
  ))$$, pg_temp.get('shipping_component'), pg_temp.get('line6')),
  '23514', null, 'proposing a new allocation on an already-allocated component is refused');

-- Reverse: retracts the confirmed allocations and resets to unresolved --------------------
select lives_ok(
  format($$select public.reverse_cost_allocation(%L, 'shipping estimate corrected')$$,
    pg_temp.get('shipping_component')),
  'reversing the confirmed allocation succeeds');

select is(
  (select attribution_state::text from public.acquisition_cost_components
   where id = pg_temp.get('shipping_component')),
  'unresolved', 'the component is back to unresolved after reversal');
select is(
  (select count(*)::int from public.acquisition_cost_allocations
   where cost_component_id = pg_temp.get('shipping_component') and state = 'reversed'),
  2, 'the original two allocations remain, now reversed: history is preserved, not deleted');

-- A corrected re-propose + confirm cycle finishes the same component ----------------------
select lives_ok(
  format($$select public.propose_cost_allocation(%L, 'proportional_by_quantity', jsonb_build_array(
    jsonb_build_object('line_item_id', %L, 'amount_minor', 200),
    jsonb_build_object('line_item_id', %L, 'amount_minor', 100)
  ))$$, pg_temp.get('shipping_component'), pg_temp.get('line6'), pg_temp.get('line7')),
  'a corrected re-proposal succeeds after reversal');
select lives_ok(
  format($$select public.confirm_cost_allocation(%L, 300)$$, pg_temp.get('shipping_component')),
  'the corrected re-proposal confirms successfully, leaving the component allocated');
select is(
  (select count(*)::int from public.acquisition_cost_allocations
   where cost_component_id = pg_temp.get('shipping_component')),
  4, 'all four allocation rows (two reversed, two confirmed) are retained: nothing was deleted');

-- Cost component correction: reverse_cost_component preserves history --------------------
select pg_temp.put('wn1_component',
  (select id from public.acquisition_cost_components
   where line_item_id = (select id from public.acquisition_line_items where public_id = 'WN-A-000001')));

select lives_ok(
  format($$select public.reverse_cost_component(%L,
    jsonb_build_object('amount_minor', 1100), 'corrected price after reconciliation')$$,
    pg_temp.get('wn1_component')),
  'reverse_cost_component corrects a wrong amount by inserting a successor');

select is(
  (select amount_minor from public.acquisition_cost_components where id = pg_temp.get('wn1_component')),
  1000::bigint, 'the original (reversed) component''s amount is unchanged: history is preserved');
select is(
  (select (reversed_at is not null) from public.acquisition_cost_components
   where id = pg_temp.get('wn1_component')),
  true, 'the original component is marked reversed');
select is(
  (select c.amount_minor from public.acquisition_cost_components c
   join public.acquisition_cost_components old_c on old_c.reversed_by_id = c.id
   where old_c.id = pg_temp.get('wn1_component')),
  1100::bigint, 'the successor component carries the corrected amount');
select is(
  (select c.line_item_id from public.acquisition_cost_components c
   join public.acquisition_cost_components old_c on old_c.reversed_by_id = c.id
   where old_c.id = pg_temp.get('wn1_component')),
  (select id from public.acquisition_line_items where public_id = 'WN-A-000001'),
  'the successor component applies to the SAME line item as the row it corrects');

-- Stage a second lot for ORD-6 (e.g. a reshipped package), then supersede a placement ------
select lives_ok(
  format($$select public.stage_acquisition_lots(%L, jsonb_build_array(
    jsonb_build_object('order_id',
      (select o.id from public.acquisition_orders o where o.source_order_reference = 'ORD-6'),
      'sequence_no', 2, 'label', 'reshipped package')
  ))$$, pg_temp.get('job')),
  'a second lot is staged for ORD-6');

select pg_temp.put('ord6_lot2',
  (select lt.id from public.acquisition_lots lt
   join public.acquisition_orders o on o.id = lt.order_id
   where o.source_order_reference = 'ORD-6' and lt.sequence_no = 2));
select pg_temp.put('line7_lot_line',
  (select id from public.acquisition_lot_lines
   where line_item_id = pg_temp.get('line7') and state = 'active'));

select lives_ok(
  format($$select public.supersede_lot_line(%L, %L, 're-homed after reshipment')$$,
    pg_temp.get('line7_lot_line'), pg_temp.get('ord6_lot2')),
  'supersede_lot_line re-homes WN-A-000007 into the new lot');

select is(
  (select state::text from public.acquisition_lot_lines where id = pg_temp.get('line7_lot_line')),
  'superseded', 'the original placement is now superseded');
select is(
  (select lt.sequence_no from public.acquisition_lot_lines ll
   join public.acquisition_lots lt on lt.id = ll.lot_id
   where ll.line_item_id = pg_temp.get('line7') and ll.state = 'active'),
  2, 'WN-A-000007''s active placement now points at lot sequence 2');
select is(
  (select count(*)::int from public.acquisition_lot_lines where line_item_id = pg_temp.get('line7')),
  2, 'both the original and the corrective placement are retained');

-- Direct-DML bypass denial ----------------------------------------------------------------
select throws_ok(
  $$insert into public.channels (workspace_id, public_id, name, kind, created_by)
    values ('aaaa0000-0000-4000-8000-000000000001', 'RV-CH-FORGED000001', 'Forged', 'marketplace',
      'a2222222-2222-2222-2222-222222222222')$$,
  '42501', null, 'direct DML cannot register a channel');

select throws_ok(
  $$insert into public.suppliers (workspace_id, public_id, display_name, created_by_process)
    values ('aaaa0000-0000-4000-8000-000000000001', 'RV-SUP-FORGED00001', 'Forged Supplier', 'forged')$$,
  '42501', null, 'direct DML cannot create a supplier');

select throws_ok(
  format($$update public.acquisition_orders set order_status = 'refunded' where
    acquisition_import_job_id = %L$$, pg_temp.get('job')),
  '42501', null, 'direct DML cannot mutate an acquisition order');

select throws_ok(
  $$delete from public.acquisition_line_items$$,
  '42501', null, 'direct DML cannot delete a line item');

select throws_ok(
  format($$update public.acquisition_cost_components set attribution_state = 'allocated'
    where id = %L$$, pg_temp.get('wn1_component')),
  '42501', null, 'direct DML cannot mutate a cost component''s attribution state');

select throws_ok(
  $$update public.acquisition_cost_allocations set state = 'confirmed'$$,
  '42501', null, 'direct DML cannot confirm a cost allocation');

select throws_ok(
  format($$update public.acquisition_import_jobs set status = 'committed' where id = %L$$,
    pg_temp.get('job')),
  '42501', null, 'direct DML cannot commit an acquisition import job');

select pg_temp.logout();

-- Viewer: read-only ------------------------------------------------------------------------
select pg_temp.login('a3333333-3333-3333-3333-333333333333');

select throws_ok(
  format($$select public.stage_acquisition_orders(%L, '[]'::jsonb)$$, pg_temp.get('job')),
  '42501', null, 'a viewer cannot stage acquisition orders');

select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 6, 7, 7, 9, 1, 0)$$,
    pg_temp.get('job')),
  '42501', null, 'a viewer cannot finalize an acquisition import');

select is(
  (select count(*)::int from public.acquisition_orders where acquisition_import_job_id = pg_temp.get('job')),
  6, 'a viewer reads all six staged orders');

select pg_temp.logout();

-- Cross-workspace isolation -----------------------------------------------------------------
select pg_temp.login('a4444444-4444-4444-4444-444444444444');

select is((select count(*)::int from public.acquisition_orders), 0,
  'workspace B sees none of workspace A''s acquisition orders');
select is((select count(*)::int from public.suppliers), 0,
  'workspace B sees none of workspace A''s suppliers');

select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 6, 7, 7, 9, 1, 0)$$,
    pg_temp.get('job')),
  '42501', null, 'workspace B cannot finalize a workspace A acquisition import');

select pg_temp.logout();
select pg_temp.login('a2222222-2222-2222-2222-222222222222');

-- Finalize: every one of the six expected counts is mandatory and verified -----------------
select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 99, 7, 7, 9, 1, 0)$$,
    pg_temp.get('job')),
  '23514', null, 'finalize refuses a mismatched order count');
select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 6, 99, 7, 9, 1, 0)$$,
    pg_temp.get('job')),
  '23514', null, 'finalize refuses a mismatched lot count');
select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 6, 7, 99, 9, 1, 0)$$,
    pg_temp.get('job')),
  '23514', null, 'finalize refuses a mismatched line item count');
select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 6, 7, 7, 99, 1, 0)$$,
    pg_temp.get('job')),
  '23514', null, 'finalize refuses a mismatched cost component count');
select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 6, 7, 7, 9, 0, 0)$$,
    pg_temp.get('job')),
  '23514', null,
  'finalize refuses omitting the unresolved supplier candidate (expecting 0 when 1 exists)');
select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 6, 7, 7, 9, 1, 5)$$,
    pg_temp.get('job')),
  '23514', null, 'finalize refuses a mismatched unresolved cost component count');
select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 6, 7, 7, 9, 1, null)$$,
    pg_temp.get('job')),
  '22023', null, 'finalize refuses an omitted (null) expected count, even at zero');

select is(
  (select status::text from public.acquisition_import_jobs where id = pg_temp.get('job')),
  'preview', 'every rejected finalization left the job uncommitted');
select is(
  (select count(*)::int from public.audit_events
   where event_type = 'acquisition_import_committed' and subject_id = pg_temp.get('job')),
  0, 'no rejected finalization wrote an acquisition_import_committed event');

-- Finalize: correct counts commit successfully ---------------------------------------------
select is(
  (select (public.finalize_acquisition_import_job(pg_temp.get('job'), 'idem-acq-00000001',
     6, 7, 7, 9, 1, 0))->>'status'),
  'committed', 'the acquisition import commits once every expected count is correct');

select is(
  (select count(*)::int from public.audit_events
   where event_type = 'acquisition_import_committed' and subject_id = pg_temp.get('job')),
  1, 'exactly one acquisition_import_committed audit event was written');

select throws_ok(
  format($$select public.finalize_acquisition_import_job(%L, 'idem-acq-00000001', 6, 7, 7, 9, 1, 0)$$,
    pg_temp.get('job')),
  '23514', null, 'an already-committed acquisition import cannot be finalized again');

select pg_temp.logout();

select * from finish();
rollback;
