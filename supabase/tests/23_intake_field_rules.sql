-- Phase 6A intake kernel — governed field rules, no fabricated factual defaults,
-- and the hybrid serialization policy (readiness level).
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
  padd jsonb, sadd jsonb, src text, cond text) returns uuid language sql as $$
  select (public.upsert_intake_group((select v from t where k='ws')::uuid,
    (select v from t where k='sess')::uuid, null, cat, name, qty, mode, ser, padd, sadd, src, cond,
    null, false, false, false)->>'id')::uuid; $$;
create function pg_temp.eval(g uuid) returns jsonb language sql as $$
  select public.evaluate_intake_field_rules((select v from t where k='ws')::uuid, g); $$;

-- A factual value is NEVER defaulted: a fresh draft's source is explicitly
-- 'unknown', its condition is NULL, and no grade is invented.
insert into t values ('raw', pg_temp.newgroup('raw_tcg', 'Bulbasaur Base #44', 1, 'lot_managed', 0,
  '{"set_name":"Base Set","card_number":"44"}'::jsonb, '{}'::jsonb, 'unknown', null)::text);
select is((select source_state::text from public.intake_draft_groups where id=(select v from t where k='raw')::uuid),
  'unknown', 'source is explicitly unknown, never defaulted to a value');
select is((select condition_state from public.intake_draft_groups where id=(select v from t where k='raw')::uuid),
  null, 'raw condition is not fabricated (stays NULL)');
select is((select sku_attrs->>'numeric_grade' from public.intake_draft_groups where id=(select v from t where k='raw')::uuid),
  null, 'no grade is invented for a raw card');

-- Raw TCG: uncertain/unknown condition is PERMITTED — the draft is ready with no
-- condition asserted and no fabricated grade or defect.
select is((pg_temp.eval((select v from t where k='raw')::uuid)->>'ready')::text, 'true',
  'a raw card with uncertain condition is ready (condition not required)');

-- HYBRID: graded TCG must be a single serialized unit. A graded draft entered as
-- lot-managed / qty>1 is blocked with a structured reason.
insert into t values ('gbad', pg_temp.newgroup('graded_tcg', 'Charizard Base #4', 2, 'lot_managed', 0,
  '{"set_name":"Base Set","card_number":"4"}'::jsonb,
  '{"grading_company":"PSA","numeric_grade":"10","product_format":"Graded slab"}'::jsonb, 'stated', null)::text);
select is((pg_temp.eval((select v from t where k='gbad')::uuid)->>'ready')::text, 'false',
  'a graded slab as lot-managed qty>1 is blocked');
select ok(
  (pg_temp.eval((select v from t where k='gbad')::uuid)->'blockers')::text like '%graded_requires_single_serialized%',
  'the graded structural blocker is explicit');

-- HYBRID: footwear requires serialization. Footwear entered lot-managed blocks.
insert into t values ('fbad', pg_temp.newgroup('footwear', 'Air Jordan 1', 1, 'lot_managed', 0,
  '{"silhouette":"Air Jordan 1"}'::jsonb, '{"shoe_size":"10"}'::jsonb, 'unknown', null)::text);
select ok(
  (pg_temp.eval((select v from t where k='fbad')::uuid)->'blockers')::text like '%serialization_required%',
  'footwear must be serialized');

-- HYBRID: eligible sealed quantity > 1 MAY remain a single lot-managed lot.
insert into t values ('sealed', pg_temp.newgroup('sealed_tcg', 'SV Booster Box', 6, 'lot_managed', 0,
  '{"set_name":"Scarlet & Violet"}'::jsonb, '{"product_format":"Sealed product"}'::jsonb, 'stated', null)::text);
select is((pg_temp.eval((select v from t where k='sealed')::uuid)->>'ready')::text, 'true',
  'eligible sealed qty>1 is ready as one lot-managed lot');

-- HYBRID: sealed may ALSO be explicitly expanded into serialized children.
insert into t values ('sealedser', pg_temp.newgroup('sealed_tcg', 'SV Booster Box Serialized', 3,
  'serialized', 3, '{"set_name":"Scarlet & Violet"}'::jsonb,
  '{"product_format":"Sealed product"}'::jsonb, 'stated', null)::text);
select is(
  (select public.upsert_intake_entry((select v from t where k='ws')::uuid,
    (select v from t where k='sealedser')::uuid, 1, null, null, null, null, 'UNIT-1', '{}')->>'entry_index'),
  '1', 'a serialized sealed unit can carry its own entry');
select public.upsert_intake_entry((select v from t where k='ws')::uuid,
  (select v from t where k='sealedser')::uuid, 2, null, null, null, null, 'UNIT-2', '{}');
select public.upsert_intake_entry((select v from t where k='ws')::uuid,
  (select v from t where k='sealedser')::uuid, 3, null, null, null, null, 'UNIT-3', '{}');
select is((pg_temp.eval((select v from t where k='sealedser')::uuid)->>'ready')::text, 'true',
  'an explicitly-expanded sealed group with N entries is ready');

-- A serialized group whose entry count does not match its child count is blocked
-- (no double counting / missing children).
insert into t values ('mism', pg_temp.newgroup('sealed_tcg', 'Mismatch Box', 2, 'serialized', 2,
  '{"set_name":"x"}'::jsonb, '{}'::jsonb, 'stated', null)::text);
select public.upsert_intake_entry((select v from t where k='ws')::uuid,
  (select v from t where k='mism')::uuid, 1, null, null, null, null, 'ONLY-1', '{}');
select ok(
  (pg_temp.eval((select v from t where k='mism')::uuid)->'blockers')::text like '%entry_count_mismatch%',
  'a serialized group with too few entries is blocked');

-- An ungoverned identity attribute is refused at write (no EAV identity).
select throws_ok(
  $$select public.upsert_intake_group('aaaa0000-0000-4000-8000-000000000001',
    (select v from t where k='sess')::uuid, null, 'raw_tcg', 'x', 1, 'lot_managed', 0,
    '{"totally_made_up_field":"z"}'::jsonb, '{}', 'stated', null, null, false, false, false)$$,
  null, null, 'an ungoverned product attribute is refused (no EAV identity)');

-- The rule set is versioned and reported.
select is(pg_temp.eval((select v from t where k='raw')::uuid)->>'rule_version', 'INTAKE_RULES_1',
  'the applied rule version is reported');

select * from finish();
rollback;
