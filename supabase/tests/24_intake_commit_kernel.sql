-- Phase 6A intake kernel — the transactional commit kernel.
-- Graded slab, duplicate certificate (durable failure + full rollback),
-- footwear + candidate (zero financial effect), sealed lot vs serialized
-- expansion, raw card, idempotency, stale version, and the next-action contract.
begin;
create extension if not exists pgtap;
select no_plan();

create function pg_temp.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; end $$;

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@a.test'),
  ('a2222222-2222-2222-2222-222222222222', 'op@a.test');
insert into public.workspaces (id, name, created_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'WS A', 'a1111111-1111-1111-1111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'operator');
set session_replication_role = replica;
insert into public.acquisition_line_items
  (id, workspace_id, public_id, source_system_id, source_record_id,
   acquisition_import_job_id, quantity, created_by_process)
values ('acacacac-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
   'WN-A-000001', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'test.fixture');
set session_replication_role = origin;

select pg_temp.login('a2222222-2222-2222-2222-222222222222');
create temp table t (k text primary key, v text);
insert into t values ('ws', 'aaaa0000-0000-4000-8000-000000000001');
insert into t values ('sess', (public.create_intake_session((select v from t where k='ws')::uuid, 's')->>'id'));
-- Location masters are created via the governed Phase 5 registrar BEFORE intake,
-- never minted during a commit.
select public.register_storage_location((select v from t where k='ws')::uuid, 'BIN-1', null, 'Bin 1');
select public.register_storage_location((select v from t where k='ws')::uuid, 'BIN-2', null, 'Bin 2');
select public.register_storage_location((select v from t where k='ws')::uuid, 'BIN-3', null, 'Bin 3');

create function pg_temp.g(cat text, name text, qty int, mode text, ser int,
  padd jsonb, sadd jsonb, sev jsonb, cond text, loc text) returns uuid language sql as $$
  select (public.upsert_intake_group((select v from t where k='ws')::uuid,
    (select v from t where k='sess')::uuid, null, null, cat, name, qty, mode, ser, padd, sadd, sev, cond,
    loc, false, false, false, false)->>'id')::uuid; $$;
create function pg_temp.gver(g uuid) returns int language sql as $$
  select version from public.intake_draft_groups where id = g; $$;
create function pg_temp.entry(g uuid, idx int, gc text, gr text, cert text, ser text)
  returns void language sql as $$
  select public.upsert_intake_entry((select v from t where k='ws')::uuid, g, pg_temp.gver(g), idx,
    gc, gr, null, cert, ser, '{}')::text; $$;
create function pg_temp.hash(g uuid) returns text language sql as $$
  select public.preview_intake_commit((select v from t where k='ws')::uuid, g)->>'content_hash'; $$;
create function pg_temp.commit(g uuid, key text) returns jsonb language sql as $$
  select public.commit_intake_group((select v from t where k='ws')::uuid, g, key, pg_temp.gver(g), pg_temp.hash(g)); $$;

-- =============================== 1. GRADED SLAB ===============================
insert into t values ('graded', pg_temp.g('graded_tcg', 'Charizard Base #4', 1, 'serialized', 1,
  '{"set_name":"Base Set","card_number":"4","featured_subject":"Charizard"}'::jsonb,
  '{"grading_company":"CGC","numeric_grade":"9.5","product_format":"Graded slab"}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, null, 'BIN-1')::text);
select pg_temp.entry((select v from t where k='graded')::uuid, 1, 'CGC', '9.5', 'CGC-77001', null);
insert into t values ('r1', (pg_temp.commit((select v from t where k='graded')::uuid, 'grade-key-0001'))::text);

select is((select v from t where k='r1')::jsonb->>'outcome', 'committed', 'the graded slab commits');
select is((select v from t where k='r1')::jsonb->>'lot_public_id' ~ '^RV-I-[0-9]{10}$', true,
  'the graded commit produced a digit-shaped lot public id');
select is(jsonb_array_length((select v from t where k='r1')::jsonb->'items'), 1,
  'a graded slab commits exactly one serialized item');
select is((select v from t where k='r1')::jsonb->'items'->0->>'scan_sku' ~ '^RV-[0-9A-HJKMNP-TV-Z]{7,12}$', true,
  'the serialized item carries an opaque Crockford scan SKU');
-- Graded identity coherence: the minted item's grading company is the SKU's.
select is((select grading_company from public.inventory_items
           where id = ((select v from t where k='r1')::jsonb->'items'->0->>'item_id')::uuid), 'CGC',
  'the minted item grading company is derived from the SKU identity');
select is((select v from t where k='r1')::jsonb->>'next_action', 'READY_FOR_FUTURE_LISTING_PREP',
  'a stated-source, located graded slab needs only future listing prep');
select is((select state::text from public.intake_draft_groups where id=(select v from t where k='graded')::uuid),
  'committed', 'the graded group STORED state is committed');

-- Repeated submit (same key + identical content) is one idempotent result.
select is((pg_temp.commit((select v from t where k='graded')::uuid, 'grade-key-0001'))->>'idempotent_replay',
  'true', 'a repeated identical submit is an idempotent replay');
select is((select count(*)::int from public.inventory_lots
           where sku_id = ((select v from t where k='r1')::jsonb->>'sku_id')::uuid), 1,
  'the repeated submit created NO duplicate lot');

-- Same key, CHANGED content fails closed (structured conflict).
select is(
  (public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='graded')::uuid,
    'grade-key-0001', 99, 'deadbeef'))->>'conflict_type', 'idempotency_content_changed',
  'reuse of the idempotency key with changed content fails closed');

-- ==================== 2. DUPLICATE CERTIFICATE — DURABLE FAILURE =============
-- A second graded slab reusing CGC-77001 fails mid-write. The whole canonical
-- write rolls back (no partial identity), the draft stays recoverable, AND one
-- durable commit_failed audit event persists.
insert into t values ('dup', pg_temp.g('graded_tcg', 'Blastoise Base #2', 1, 'serialized', 1,
  '{"set_name":"Base Set","card_number":"2","featured_subject":"Blastoise"}'::jsonb,
  '{"grading_company":"CGC","numeric_grade":"9","product_format":"Graded slab"}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, null, 'BIN-1')::text);
select pg_temp.entry((select v from t where k='dup')::uuid, 1, 'CGC', '9', 'CGC-77001', null);
insert into t values ('rdup', (pg_temp.commit((select v from t where k='dup')::uuid, 'dup-key-0001'))::text);
select is((select v from t where k='rdup')::jsonb->>'outcome', 'failed',
  'the duplicate-certificate commit returns a structured failure');
select is((select v from t where k='rdup')::jsonb->>'failure_class', 'duplicate_identity',
  'the failure class is the sanitized duplicate_identity');
select is((select count(*)::int from public.inventory_lots
           where workspace_id=(select v from t where k='ws')::uuid), 1,
  'the failed commit created NO new lot (full rollback)');
select is((select count(*)::int from public.product_catalog
           where workspace_id=(select v from t where k='ws')::uuid
             and product_canonical_key like '%blastoise%'), 0,
  'the failed commit created NO partial product (full rollback)');
select isnt((select state::text from public.intake_draft_groups where id=(select v from t where k='dup')::uuid),
  'committed', 'the draft remains recoverable after the failed commit');
select is((select count(*)::int from public.intake_transition_events
           where group_id=(select v from t where k='dup')::uuid and event_type='commit_failed'), 1,
  'exactly one durable commit_failed audit event persists');
select ok((select reason ? 'sqlstate' and reason ? 'failure_class'
           from public.intake_transition_events
           where group_id=(select v from t where k='dup')::uuid and event_type='commit_failed'),
  'the durable failure event carries a sanitized class + sqlstate');

-- =========================== 3. FOOTWEAR + CANDIDATE EVIDENCE ================
insert into t values ('shoe', pg_temp.g('footwear', 'Air Jordan 1 Chicago', 1, 'serialized', 1,
  '{"silhouette":"Air Jordan 1","colorway_name":"Chicago","style_code":"DZ5485-612"}'::jsonb,
  '{"shoe_size":"10","color":"Red"}'::jsonb, '{}'::jsonb, null, null)::text);
select pg_temp.entry((select v from t where k='shoe')::uuid, 1, null, null, null, 'SNKR-0001');
insert into t values ('rs', (pg_temp.commit((select v from t where k='shoe')::uuid, 'shoe-key-0001'))::text);
select is(jsonb_array_length((select v from t where k='rs')::jsonb->'items'), 1,
  'footwear commits one serialized item with an unknown source');
select is((select v from t where k='rs')::jsonb->>'next_action', 'SOURCE_REVIEW_NEEDED',
  'an unknown-source footwear commit reports SOURCE_REVIEW_NEEDED');

insert into t values ('shoe2', pg_temp.g('footwear', 'Air Jordan 1 Bred', 1, 'serialized', 1,
  '{"silhouette":"Air Jordan 1","colorway_name":"Bred","style_code":"555088-062"}'::jsonb,
  '{"shoe_size":"11","color":"Black"}'::jsonb, '{}'::jsonb, null, null)::text);
select pg_temp.entry((select v from t where k='shoe2')::uuid, 1, null, null, null, 'SNKR-0002');
select is((public.attach_intake_candidate((select v from t where k='ws')::uuid,
    (select v from t where k='shoe2')::uuid, pg_temp.gver((select v from t where k='shoe2')::uuid),
    'acacacac-0000-4000-8000-000000000001'::uuid, null, 'medium',
    '{"note":"matched by seller + date"}'::jsonb))->>'financial_effect', 'false',
  'attaching candidate evidence reports zero financial effect');
select is((select source_state::text from public.intake_draft_groups where id=(select v from t where k='shoe2')::uuid),
  'candidate', 'the candidate attachment derives source = candidate');
insert into t values ('rs2', (pg_temp.commit((select v from t where k='shoe2')::uuid, 'shoe-key-0002'))::text);
select is(jsonb_array_length((select v from t where k='rs2')::jsonb->'items'), 1,
  'footwear with a candidate acquisition line commits successfully');
-- The receipt carries the candidate snapshot with the required fields.
select ok((select v from t where k='rs2')::jsonb->'candidates'->0 ? 'acquisition_line_item_id'
  and (select v from t where k='rs2')::jsonb->'candidates'->0 ? 'confidence'
  and (select v from t where k='rs2')::jsonb->'candidates'->0 ? 'review_state',
  'the receipt candidate snapshot carries the required evidence fields');
-- Zero financial effect: no acquisition cost component / allocation created.
select is((select count(*)::int from public.acquisition_cost_components
           where workspace_id=(select v from t where k='ws')::uuid), 0,
  'the candidate link created NO acquisition cost component');
select is((select count(*)::int from public.acquisition_cost_allocations
           where workspace_id=(select v from t where k='ws')::uuid), 0,
  'the candidate link created NO acquisition cost allocation');

-- =========================== 4. SEALED: LOT vs SERIALIZED EXPANSION ==========
insert into t values ('sealed', pg_temp.g('sealed_tcg', 'SV151 Booster Box', 6, 'lot_managed', 0,
  '{"set_name":"151"}'::jsonb, '{"product_format":"Sealed product"}'::jsonb,
  '{"source_kind":"retail_purchase"}'::jsonb, null, 'BIN-2')::text);
insert into t values ('rsl', (pg_temp.commit((select v from t where k='sealed')::uuid, 'seal-key-0001'))::text);
select is((select quantity from public.inventory_lots
           where id = ((select v from t where k='rsl')::jsonb->>'lot_id')::uuid), 6,
  'eligible sealed qty 6 commits as ONE lot of quantity 6');
select is((select count(*)::int from public.inventory_items
           where lot_id = ((select v from t where k='rsl')::jsonb->>'lot_id')::uuid), 0,
  'the lot-managed sealed lot has no serialized children (no double counting)');

insert into t values ('sealx', pg_temp.g('sealed_tcg', 'SV151 ETB', 3, 'serialized', 3,
  '{"set_name":"151"}'::jsonb,
  '{"product_format":"Sealed product","seal_or_packaging_condition":"factory sealed"}'::jsonb,
  '{"source_kind":"retail_purchase"}'::jsonb, null, 'BIN-2')::text);
select pg_temp.entry((select v from t where k='sealx')::uuid, 1, null, null, null, 'ETB-1');
select pg_temp.entry((select v from t where k='sealx')::uuid, 2, null, null, null, 'ETB-2');
select pg_temp.entry((select v from t where k='sealx')::uuid, 3, null, null, null, 'ETB-3');
insert into t values ('rsx', (pg_temp.commit((select v from t where k='sealx')::uuid, 'seal-key-0002'))::text);
select is((select count(*)::int from public.inventory_items
           where lot_id = ((select v from t where k='rsx')::jsonb->>'lot_id')::uuid), 3,
  'an expanded sealed group mints exactly N serialized children');
select is((select quantity from public.inventory_lots
           where id = ((select v from t where k='rsx')::jsonb->>'lot_id')::uuid), 3,
  'the expanded lot quantity equals the child count (no double counting)');

-- =========================== 5. RAW CARD ====================================
insert into t values ('raw', pg_temp.g('raw_tcg', 'Snorlax Jungle #11', 2, 'lot_managed', 0,
  '{"set_name":"Jungle","card_number":"11"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, null, 'BIN-3')::text);
insert into t values ('rr', (pg_temp.commit((select v from t where k='raw')::uuid, 'raw-key-0001'))::text);
select is((select count(*)::int from public.inventory_items
           where lot_id = ((select v from t where k='rr')::jsonb->>'lot_id')::uuid), 0,
  'a raw card commits as a lot-managed lot with no fabricated serialized detail');
select is((select v from t where k='rr')::jsonb->>'next_action', 'CONDITION_DETAILS_NEEDED',
  'a raw card with no stated condition reports CONDITION_DETAILS_NEEDED');

-- =========================== 6. STALE OPTIMISTIC VERSION ====================
insert into t values ('stale', pg_temp.g('raw_tcg', 'Mewtwo #10', 1, 'lot_managed', 0,
  '{"set_name":"Base Set","card_number":"10"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-3')::text);
select is(
  (public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='stale')::uuid,
    'stale-key-0001', pg_temp.gver((select v from t where k='stale')::uuid) + 5,
    pg_temp.hash((select v from t where k='stale')::uuid)))->>'conflict_type', 'stale_version',
  'a stale optimistic version fails closed with a structured stale_version conflict');
select isnt((select state::text from public.intake_draft_groups where id=(select v from t where k='stale')::uuid),
  'committed', 'the stale-version group is not committed');

-- =========================== 7. VALIDATION (blocked) ========================
insert into t values ('incomplete', pg_temp.g('graded_tcg', 'Venusaur Base #15', 1, 'serialized', 1,
  '{"set_name":"Base Set","card_number":"15"}'::jsonb,
  '{"grading_company":"PSA","product_format":"Graded slab"}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, null, 'BIN-1')::text);
select is(
  (public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='incomplete')::uuid,
    'inc-key-0001', pg_temp.gver((select v from t where k='incomplete')::uuid),
    pg_temp.hash((select v from t where k='incomplete')::uuid)))->>'outcome', 'blocked',
  'a graded draft missing grade + certificate is blocked from commit');
select isnt((select state::text from public.intake_draft_groups where id=(select v from t where k='incomplete')::uuid),
  'committed', 'the blocked graded draft is not committed');

select * from finish();
rollback;
