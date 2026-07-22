-- Phase 6A intake kernel — the transactional commit kernel.
-- Graded slab, duplicate certificate, footwear + candidate (zero financial
-- effect), sealed lot vs serialized expansion, raw card, idempotency, stale
-- version, transactional rollback, and the next-action contract.
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

-- A minimal committed acquisition line for candidate-evidence tests. Inserted
-- with FK/trigger enforcement suspended so we need not stand up the whole
-- provenance chain; only its (id, workspace_id) identity is referenced.
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

create function pg_temp.g(cat text, name text, qty int, mode text, ser int,
  padd jsonb, sadd jsonb, src text, cond text, loc text) returns uuid language sql as $$
  select (public.upsert_intake_group((select v from t where k='ws')::uuid,
    (select v from t where k='sess')::uuid, null, cat, name, qty, mode, ser, padd, sadd, src, cond,
    loc, false, false, false)->>'id')::uuid; $$;
create function pg_temp.entry(g uuid, idx int, gc text, gr text, cert text, ser text)
  returns void language sql as $$
  select public.upsert_intake_entry((select v from t where k='ws')::uuid, g, idx, gc, gr, null, cert, ser, '{}')::text;
$$;
create function pg_temp.ver(g uuid) returns int language sql as $$
  select version from public.intake_draft_groups where id = g; $$;
create function pg_temp.hash(g uuid) returns text language sql as $$
  select public.preview_intake_commit((select v from t where k='ws')::uuid, g)->>'content_hash'; $$;
create function pg_temp.commit(g uuid, key text) returns jsonb language sql as $$
  select public.commit_intake_group((select v from t where k='ws')::uuid, g, key, pg_temp.ver(g), pg_temp.hash(g)); $$;

-- =============================== 1. GRADED SLAB ===============================
insert into t values ('graded', pg_temp.g('graded_tcg', 'Charizard Base #4', 1, 'serialized', 1,
  '{"set_name":"Base Set","card_number":"4","featured_subject":"Charizard"}'::jsonb,
  '{"grading_company":"CGC","numeric_grade":"9.5","product_format":"Graded slab"}'::jsonb,
  'stated', null, 'BIN-1')::text);
select pg_temp.entry((select v from t where k='graded')::uuid, 1, 'CGC', '9.5', 'CGC-77001', null);
insert into t values ('r1', (pg_temp.commit((select v from t where k='graded')::uuid, 'grade-key-0001'))::text);

select is((select v from t where k='r1')::jsonb->>'lot_public_id' ~ '^RV-I-[0-9]{10}$', true,
  'the graded commit produced a digit-shaped lot public id');
select is(jsonb_array_length((select v from t where k='r1')::jsonb->'items'), 1,
  'a graded slab commits exactly one serialized item');
select is((select v from t where k='r1')::jsonb->'items'->0->>'scan_sku' ~ '^RV-[0-9A-HJKMNP-TV-Z]{7,12}$', true,
  'the serialized item carries an opaque Crockford scan SKU');
select is((select v from t where k='r1')::jsonb->>'sku_public_id' ~ '^RV-SKU-', true,
  'the receipt carries a permanent SKU public id');
select is((select tracking_mode::text from public.inventory_lots
           where id = ((select v from t where k='r1')::jsonb->>'lot_id')::uuid), 'serialized',
  'the committed lot is serialized');
select is((select count(*)::int from public.inventory_items
           where lot_id = ((select v from t where k='r1')::jsonb->>'lot_id')::uuid), 1,
  'exactly one child inventory item exists for the graded lot');
-- The draft's explicit source state is carried, never invented.
select is((select v from t where k='r1')::jsonb->>'next_action', 'READY_FOR_FUTURE_LISTING_PREP',
  'a stated-source, located graded slab needs no immediate action beyond listing prep');

-- Repeated submit (same key + identical content) returns ONE committed result.
select is((pg_temp.commit((select v from t where k='graded')::uuid, 'grade-key-0001'))->>'idempotent_replay',
  'true', 'a repeated identical submit is an idempotent replay');
select is((select count(*)::int from public.inventory_lots
           where sku_id = ((select v from t where k='r1')::jsonb->>'sku_id')::uuid), 1,
  'the repeated submit created NO duplicate lot');
select is((select count(*)::int from public.intake_commit_attempts
           where group_id = (select v from t where k='graded')::uuid and outcome='committed'), 1,
  'exactly one committed receipt exists for the group');

-- Same key, CHANGED content fails closed with a structured conflict (no dup).
select is(
  (public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='graded')::uuid,
    'grade-key-0001', 99, 'deadbeef'))->>'conflict_type', 'idempotency_content_changed',
  'reuse of the idempotency key with changed content fails closed');
select is((select count(*)::int from public.inventory_lots
           where sku_id = ((select v from t where k='r1')::jsonb->>'sku_id')::uuid), 1,
  'the changed-content reuse created NO new lot');

-- =========================== 2. DUPLICATE CERTIFICATE + ROLLBACK ============
-- A second graded slab reusing CGC-77001 must fail closed; and because it fails
-- mid-commit (after product/sku/lot creation), the whole transaction rolls back:
-- no partial identity persists and the draft remains recoverable.
insert into t values ('dup', pg_temp.g('graded_tcg', 'Blastoise Base #2', 1, 'serialized', 1,
  '{"set_name":"Base Set","card_number":"2","featured_subject":"Blastoise"}'::jsonb,
  '{"grading_company":"CGC","numeric_grade":"9","product_format":"Graded slab"}'::jsonb,
  'stated', null, 'BIN-1')::text);
select pg_temp.entry((select v from t where k='dup')::uuid, 1, 'CGC', '9', 'CGC-77001', null);
select is((select count(*)::int from public.inventory_lots
           where workspace_id = (select v from t where k='ws')::uuid), 1, 'one lot exists before the dup attempt');
select throws_ok(
  format($$select public.commit_intake_group('aaaa0000-0000-4000-8000-000000000001', %L, 'dup-key-0001',
    pg_temp.ver(%L::uuid), pg_temp.hash(%L::uuid))$$,
    (select v from t where k='dup'), (select v from t where k='dup'), (select v from t where k='dup')),
  null, null, 'a duplicate certificate in the same workspace fails closed');
select is((select count(*)::int from public.inventory_lots
           where workspace_id = (select v from t where k='ws')::uuid), 1,
  'the failed commit created NO new lot (full rollback)');
select is((select count(*)::int from public.product_catalog
           where workspace_id = (select v from t where k='ws')::uuid
             and product_canonical_key like '%blastoise%'), 0,
  'the failed commit created NO partial product (full rollback)');
select isnt((select state::text from public.intake_draft_groups where id = (select v from t where k='dup')::uuid),
  'committed', 'the draft remains recoverable after the failed commit');

-- =========================== 3. FOOTWEAR + CANDIDATE EVIDENCE ================
insert into t values ('shoe', pg_temp.g('footwear', 'Air Jordan 1 Chicago', 1, 'serialized', 1,
  '{"silhouette":"Air Jordan 1","colorway_name":"Chicago","style_code":"DZ5485-612"}'::jsonb,
  '{"shoe_size":"10","color":"Red"}'::jsonb, 'unknown', null, null)::text);
select pg_temp.entry((select v from t where k='shoe')::uuid, 1, null, null, null, 'SNKR-0001');

-- Unknown source succeeds.
insert into t values ('rs', (pg_temp.commit((select v from t where k='shoe')::uuid, 'shoe-key-0001'))::text);
select is(jsonb_array_length((select v from t where k='rs')::jsonb->'items'), 1,
  'footwear commits one serialized item with an unknown source');
select is((select v from t where k='rs')::jsonb->>'next_action', 'SOURCE_REVIEW_NEEDED',
  'an unknown-source footwear commit reports SOURCE_REVIEW_NEEDED');

-- A second footwear draft with a Candidate acquisition line succeeds, and the
-- candidate link has ZERO financial effect.
insert into t values ('shoe2', pg_temp.g('footwear', 'Air Jordan 1 Bred', 1, 'serialized', 1,
  '{"silhouette":"Air Jordan 1","colorway_name":"Bred","style_code":"555088-062"}'::jsonb,
  '{"shoe_size":"11","color":"Black"}'::jsonb, 'unknown', null, null)::text);
select pg_temp.entry((select v from t where k='shoe2')::uuid, 1, null, null, null, 'SNKR-0002');
select is((public.attach_intake_candidate((select v from t where k='ws')::uuid,
    (select v from t where k='shoe2')::uuid, 'acacacac-0000-4000-8000-000000000001'::uuid,
    null, 'medium', '{"note":"matched by seller + date"}'::jsonb))->>'financial_effect', 'false',
  'attaching candidate evidence explicitly reports zero financial effect');
select is((select source_state::text from public.intake_draft_groups where id=(select v from t where k='shoe2')::uuid),
  'candidate', 'the candidate attachment moves source to candidate (evidence only)');
insert into t values ('rs2', (pg_temp.commit((select v from t where k='shoe2')::uuid, 'shoe-key-0002'))::text);
select is(jsonb_array_length((select v from t where k='rs2')::jsonb->'items'), 1,
  'footwear with a candidate acquisition line commits successfully');
-- Zero financial effect: no acquisition cost component / allocation / balance
-- was created or altered by the candidate link or the commit.
select is((select count(*)::int from public.acquisition_cost_components
           where workspace_id = (select v from t where k='ws')::uuid), 0,
  'the candidate link created NO acquisition cost component');
select is((select count(*)::int from public.acquisition_cost_allocations
           where workspace_id = (select v from t where k='ws')::uuid), 0,
  'the candidate link created NO acquisition cost allocation');
select is((select count(*)::int from public.intake_candidate_links
           where group_id = (select v from t where k='shoe2')::uuid), 1,
  'exactly one candidate evidence link is recorded');

-- =========================== 4. SEALED: LOT vs SERIALIZED EXPANSION ==========
-- Eligible sealed qty>1 as ONE lot-managed lot.
insert into t values ('sealed', pg_temp.g('sealed_tcg', 'SV151 Booster Box', 6, 'lot_managed', 0,
  '{"set_name":"151"}'::jsonb, '{"product_format":"Sealed product"}'::jsonb, 'stated', null, 'BIN-2')::text);
insert into t values ('rsl', (pg_temp.commit((select v from t where k='sealed')::uuid, 'seal-key-0001'))::text);
select is((select quantity from public.inventory_lots
           where id = ((select v from t where k='rsl')::jsonb->>'lot_id')::uuid), 6,
  'eligible sealed qty 6 commits as ONE lot of quantity 6');
select is((select count(*)::int from public.inventory_items
           where lot_id = ((select v from t where k='rsl')::jsonb->>'lot_id')::uuid), 0,
  'the lot-managed sealed lot has no serialized children (no double counting)');

-- Sealed explicitly expanded into serialized children creates exactly N.
insert into t values ('sealx', pg_temp.g('sealed_tcg', 'SV151 ETB', 3, 'serialized', 3,
  '{"set_name":"151"}'::jsonb, '{"product_format":"Sealed product"}'::jsonb, 'stated', null, 'BIN-2')::text);
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
  '{"set_name":"Jungle","card_number":"11"}'::jsonb, '{}'::jsonb, 'stated', null, 'BIN-3')::text);
insert into t values ('rr', (pg_temp.commit((select v from t where k='raw')::uuid, 'raw-key-0001'))::text);
select is((select count(*)::int from public.inventory_items
           where lot_id = ((select v from t where k='rr')::jsonb->>'lot_id')::uuid), 0,
  'a raw card commits as a lot-managed lot with no fabricated serialized detail');
select is((select v from t where k='rr')::jsonb->>'next_action', 'CONDITION_DETAILS_NEEDED',
  'a raw card with no stated condition reports CONDITION_DETAILS_NEEDED');

-- =========================== 6. STALE OPTIMISTIC VERSION ====================
insert into t values ('stale', pg_temp.g('raw_tcg', 'Mewtwo #10', 1, 'lot_managed', 0,
  '{"set_name":"Base Set","card_number":"10"}'::jsonb, '{}'::jsonb, 'stated', 'Near Mint', 'BIN-3')::text);
select is(
  (public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='stale')::uuid,
    'stale-key-0001', pg_temp.ver((select v from t where k='stale')::uuid) + 5,
    pg_temp.hash((select v from t where k='stale')::uuid)))->>'conflict_type', 'stale_version',
  'a stale optimistic version fails closed with a structured stale_version conflict');
select isnt((select state::text from public.intake_draft_groups where id=(select v from t where k='stale')::uuid),
  'committed', 'the stale-version group is not committed');

-- =========================== 7. VALIDATION ERRORS ===========================
-- A graded draft missing its required grade/cert cannot commit.
insert into t values ('incomplete', pg_temp.g('graded_tcg', 'Venusaur Base #15', 1, 'serialized', 1,
  '{"set_name":"Base Set","card_number":"15"}'::jsonb,
  '{"grading_company":"PSA","product_format":"Graded slab"}'::jsonb, 'stated', null, 'BIN-1')::text);
-- no entry / no numeric_grade -> a structured "blocked" outcome, no write.
select is(
  (public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='incomplete')::uuid,
    'inc-key-0001', pg_temp.ver((select v from t where k='incomplete')::uuid),
    pg_temp.hash((select v from t where k='incomplete')::uuid)))->>'outcome', 'blocked',
  'a graded draft missing grade + certificate is blocked from commit');
select isnt((select state::text from public.intake_draft_groups where id=(select v from t where k='incomplete')::uuid),
  'committed', 'the blocked graded draft is not committed');

select * from finish();
rollback;
