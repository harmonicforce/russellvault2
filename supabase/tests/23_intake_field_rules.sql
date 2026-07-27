-- Phase 6A intake kernel — governed field rules, no fabricated factual defaults,
-- the hybrid serialization policy, and the truthful generic rule contract
-- (conditional applicability, data types, governed entry attributes).
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

select pg_temp.login('a2222222-2222-2222-2222-222222222222');
create temp table t (k text primary key, v text);
insert into t values ('ws', 'aaaa0000-0000-4000-8000-000000000001');
insert into t values ('sess', (public.create_intake_session((select v from t where k='ws')::uuid, 's')->>'id'));

create function pg_temp.newgroup(cat text, name text, qty int, mode text, ser int,
  padd jsonb, sadd jsonb, sev jsonb, cond text) returns uuid language sql as $$
  select (public.upsert_intake_group((select v from t where k='ws')::uuid,
    (select v from t where k='sess')::uuid, null, null, cat, name, qty, mode, ser, padd, sadd, sev, cond,
    null, false, false, false, false)->>'id')::uuid; $$;
create function pg_temp.gver(g uuid) returns int language sql as $$
  select version from public.intake_draft_groups where id = g; $$;
create function pg_temp.addentry(g uuid, idx int, ser text, eattrs jsonb) returns jsonb language sql as $$
  select public.upsert_intake_entry((select v from t where k='ws')::uuid, g, pg_temp.gver(g), idx,
    null, null, null, null, ser, eattrs); $$;
create function pg_temp.eval(g uuid) returns jsonb language sql as $$
  select public.evaluate_intake_field_rules((select v from t where k='ws')::uuid, g); $$;

-- Facts are NEVER defaulted: fresh source is explicitly unknown, condition NULL,
-- no grade invented.
insert into t values ('raw', pg_temp.newgroup('raw_tcg', 'Bulbasaur Base #44', 1, 'lot_managed', 0,
  '{"set_name":"Base Set","card_number":"44"}'::jsonb, '{}'::jsonb, '{}'::jsonb, null)::text);
select is((select source_state::text from public.intake_draft_groups where id=(select v from t where k='raw')::uuid),
  'unknown', 'source is explicitly unknown, never defaulted');
select is((select condition_state from public.intake_draft_groups where id=(select v from t where k='raw')::uuid),
  null, 'raw condition is not fabricated (stays NULL)');
select is((pg_temp.eval((select v from t where k='raw')::uuid)->>'ready')::text, 'true',
  'a raw card with uncertain condition is ready (condition not required)');

-- HYBRID: graded must be single serialized.
insert into t values ('gbad', pg_temp.newgroup('graded_tcg', 'Charizard Base #4', 2, 'lot_managed', 0,
  '{"set_name":"Base Set","card_number":"4"}'::jsonb,
  '{"grading_company":"PSA","numeric_grade":"10","product_format":"Graded slab"}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, null)::text);
select ok((pg_temp.eval((select v from t where k='gbad')::uuid)->'blockers')::text like '%graded_requires_single_serialized%',
  'a graded slab as lot-managed qty>1 is blocked');

-- HYBRID: footwear requires serialization AND serialized_child_count = quantity.
insert into t values ('fbad', pg_temp.newgroup('footwear', 'Air Jordan 1', 2, 'serialized', 1,
  '{"silhouette":"Air Jordan 1"}'::jsonb, '{"shoe_size":"10"}'::jsonb, '{}'::jsonb, null)::text);
select ok((pg_temp.eval((select v from t where k='fbad')::uuid)->'blockers')::text like '%footwear_serial_count%',
  'footwear with fewer serialized children than quantity is blocked');

-- HYBRID: eligible sealed qty>1 MAY remain one lot-managed lot.
insert into t values ('sealed', pg_temp.newgroup('sealed_tcg', 'SV Booster Box', 6, 'lot_managed', 0,
  '{"set_name":"Scarlet & Violet"}'::jsonb, '{"product_format":"Sealed product"}'::jsonb,
  '{"source_kind":"retail_purchase"}'::jsonb, null)::text);
select is((pg_temp.eval((select v from t where k='sealed')::uuid)->>'ready')::text, 'true',
  'eligible sealed qty>1 is ready as one lot-managed lot');

-- CONDITIONAL RULE: seal/packaging condition is required ONLY when a sealed group
-- is expanded into serialized units. Without it -> blocked; with it -> ready.
insert into t values ('sealx0', pg_temp.newgroup('sealed_tcg', 'SV Box Ser NoSeal', 2, 'serialized', 2,
  '{"set_name":"SV"}'::jsonb, '{"product_format":"Sealed product"}'::jsonb,
  '{"source_kind":"retail_purchase"}'::jsonb, null)::text);
select pg_temp.addentry((select v from t where k='sealx0')::uuid, 1, 'U1', '{}');
select pg_temp.addentry((select v from t where k='sealx0')::uuid, 2, 'U2', '{}');
select ok((pg_temp.eval((select v from t where k='sealx0')::uuid)->'blockers')::text like '%tcg_seal_or_packaging_condition%',
  'a serialized sealed group without seal condition is blocked (conditional rule applies)');

insert into t values ('sealx1', pg_temp.newgroup('sealed_tcg', 'SV Box Ser Sealed', 2, 'serialized', 2,
  '{"set_name":"SV"}'::jsonb,
  '{"product_format":"Sealed product","seal_or_packaging_condition":"factory sealed"}'::jsonb,
  '{"source_kind":"retail_purchase"}'::jsonb, null)::text);
select pg_temp.addentry((select v from t where k='sealx1')::uuid, 1, 'U1', '{}');
select pg_temp.addentry((select v from t where k='sealx1')::uuid, 2, 'U2', '{}');
select is((pg_temp.eval((select v from t where k='sealx1')::uuid)->>'ready')::text, 'true',
  'the same sealed group WITH seal condition is ready (conditional rule satisfied)');

-- A serialized group whose entry count != child count is blocked.
insert into t values ('mism', pg_temp.newgroup('sealed_tcg', 'Mismatch Box', 2, 'serialized', 2,
  '{"set_name":"x"}'::jsonb,
  '{"product_format":"Sealed product","seal_or_packaging_condition":"sealed"}'::jsonb,
  '{"source_kind":"retail_purchase"}'::jsonb, null)::text);
select pg_temp.addentry((select v from t where k='mism')::uuid, 1, 'ONLY-1', '{}');
select ok((pg_temp.eval((select v from t where k='mism')::uuid)->'blockers')::text like '%entry_count_mismatch%',
  'a serialized group with too few entries is blocked');

-- DATA TYPES: a governed integer entry field rejects a non-integer; a governed
-- boolean field rejects a non-boolean.
select pg_temp.addentry((select v from t where k='sealx1')::uuid, 1, 'U1', '{"case_count":"notanumber"}'::jsonb);
select ok((pg_temp.eval((select v from t where k='sealx1')::uuid)->'blockers')::text like '%tcg_case_count%',
  'a non-integer value for an integer entry field is an invalid_value blocker');
select pg_temp.addentry((select v from t where k='sealx1')::uuid, 1, 'U1', '{"is_sealed_case":"maybe"}'::jsonb);
select ok((pg_temp.eval((select v from t where k='sealx1')::uuid)->'blockers')::text like '%tcg_is_sealed_case%',
  'a non-boolean value for a boolean entry field is an invalid_value blocker');
select pg_temp.addentry((select v from t where k='sealx1')::uuid, 1, 'U1', '{"case_count":"36","is_sealed_case":"true"}'::jsonb);
select ok((pg_temp.eval((select v from t where k='sealx1')::uuid)->'blockers')::text not like '%tcg_case_count%',
  'valid integer/boolean entry values pass type validation');

-- A reference value outside the governed list is rejected.
insert into t values ('badref', pg_temp.newgroup('raw_tcg', 'Bad Ref', 1, 'lot_managed', 0,
  '{"set_name":"x","language":"Klingon"}'::jsonb, '{}'::jsonb, '{}'::jsonb, null)::text);
select ok((pg_temp.eval((select v from t where k='badref')::uuid)->'blockers')::text like '%tcg_language%',
  'an out-of-list reference value is blocked');

-- Ungoverned identity and entry attributes are refused at write (no EAV).
select throws_ok(
  $$select public.upsert_intake_group('aaaa0000-0000-4000-8000-000000000001',
    (select v from t where k='sess')::uuid, null, null, 'raw_tcg', 'x', 1, 'lot_managed', 0,
    '{"totally_made_up_field":"z"}'::jsonb, '{}', '{}', null, null, false, false, false, false)$$,
  '22023', null, 'an ungoverned product attribute is refused (no EAV identity)');
select throws_ok(
  format($$select public.upsert_intake_entry('aaaa0000-0000-4000-8000-000000000001', %L::uuid,
    pg_temp.gver(%L::uuid), 1, null, null, null, null, 'S', '{"made_up_entry_key":"z"}'::jsonb)$$,
    (select v from t where k='mism'), (select v from t where k='mism')),
  '22023', null, 'an ungoverned entry attribute is refused (no EAV)');

-- The rule set is versioned and reported.
select is(pg_temp.eval((select v from t where k='raw')::uuid)->>'rule_version', 'INTAKE_RULES_1',
  'the applied rule version is reported');

select * from finish();
rollback;
