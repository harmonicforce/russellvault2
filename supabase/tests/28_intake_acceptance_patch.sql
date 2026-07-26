-- Phase 6A intake kernel — acceptance-patch proofs: session terminality,
-- candidate-evidence exactness, graded identity coherence, location resolution,
-- and the candidate-inclusive content hash.
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
select public.register_storage_location((select v from t where k='ws')::uuid, 'BIN-1', null, 'Bin 1');

create function pg_temp.gver(g uuid) returns int language sql as $$
  select version from public.intake_draft_groups where id = g; $$;
create function pg_temp.newg(sess uuid, cat text, name text, qty int, mode text, ser int,
  padd jsonb, sadd jsonb, sev jsonb, loc text) returns uuid language sql as $$
  select (public.upsert_intake_group((select v from t where k='ws')::uuid, sess, null, null, cat, name,
    qty, mode, ser, padd, sadd, sev, null, loc, false, false, false, false)->>'id')::uuid; $$;

-- ============================ SESSION TERMINALITY ============================
insert into t values ('s1', (public.create_intake_session((select v from t where k='ws')::uuid, 's1')->>'id'));
-- A committed group under the session (to prove it survives).
insert into t values ('gc', pg_temp.newg((select v from t where k='s1')::uuid, 'raw_tcg', 'Committed Card', 1,
  'lot_managed', 0, '{"set_name":"X","card_number":"1"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'BIN-1')::text);
select public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='gc')::uuid,
  'term-key-0001', pg_temp.gver((select v from t where k='gc')::uuid),
  public.preview_intake_commit((select v from t where k='ws')::uuid, (select v from t where k='gc')::uuid)->>'content_hash');
-- An uncommitted draft under the same session.
insert into t values ('gd', pg_temp.newg((select v from t where k='s1')::uuid, 'raw_tcg', 'Draft Card', 1,
  'lot_managed', 0, '{"set_name":"X","card_number":"2"}'::jsonb, '{}'::jsonb, '{}'::jsonb, null)::text);

-- Abandon the session: uncommitted groups auto-abandon; committed survive.
select is((public.abandon_intake_session((select v from t where k='ws')::uuid,
  (select v from t where k='s1')::uuid, 'closing up')->>'groups_abandoned')::int, 1,
  'abandoning a session auto-abandons its uncommitted groups');
select is((select state::text from public.intake_draft_groups where id=(select v from t where k='gd')::uuid),
  'abandoned', 'the uncommitted draft is now abandoned');
select is((select state::text from public.intake_draft_groups where id=(select v from t where k='gc')::uuid),
  'committed', 'the committed group remains committed and unchanged');
-- The committed group is still readable (receipt lookup works).
select ok(public.get_intake_commit_receipt((select v from t where k='ws')::uuid,
  (select v from t where k='gc')::uuid)->>'lot_public_id' is not null,
  'a committed group under an abandoned session is still readable');

-- Every mutating / readiness-implying op is refused under the dead session.
select throws_ok(
  format($$select public.upsert_intake_group('aaaa0000-0000-4000-8000-000000000001', %L::uuid, null, null,
    'raw_tcg','x',1,'lot_managed',0,'{}','{}','{}',null,null,false,false,false,false)$$,
    (select v from t where k='s1')),
  '42501', null, 'group creation is refused under an abandoned session');
select throws_ok(
  format($$select public.preview_intake_commit('aaaa0000-0000-4000-8000-000000000001', %L::uuid)$$,
    (select v from t where k='gd')),
  '42501', null, 'preview (implies commit readiness) is refused under an abandoned session');
select throws_ok(
  format($$select public.commit_intake_group('aaaa0000-0000-4000-8000-000000000001', %L::uuid, 'k-00000009', 1, 'x')$$,
    (select v from t where k='gd')),
  '42501', null, 'commit is refused under an abandoned session');

-- ============================ CANDIDATE EXACTNESS ===========================
insert into t values ('s2', (public.create_intake_session((select v from t where k='ws')::uuid, 's2')->>'id'));
insert into t values ('ga', pg_temp.newg((select v from t where k='s2')::uuid, 'sealed_tcg', 'Cand A', 1,
  'serialized', 1, '{"set_name":"A"}'::jsonb,
  '{"product_format":"Sealed product","seal_or_packaging_condition":"sealed"}'::jsonb, '{}'::jsonb, 'BIN-1')::text);
insert into t values ('ea', (public.upsert_intake_entry((select v from t where k='ws')::uuid,
  (select v from t where k='ga')::uuid, pg_temp.gver((select v from t where k='ga')::uuid), 1,
  null, null, null, null, 'A-1', '{}')->>'id'));
insert into t values ('gb', pg_temp.newg((select v from t where k='s2')::uuid, 'sealed_tcg', 'Cand B', 1,
  'serialized', 1, '{"set_name":"B"}'::jsonb,
  '{"product_format":"Sealed product","seal_or_packaging_condition":"sealed"}'::jsonb, '{}'::jsonb, 'BIN-1')::text);

-- A candidate entry_id must belong to the SAME group as the link.
select throws_ok(
  format($$select public.attach_intake_candidate('aaaa0000-0000-4000-8000-000000000001', %L::uuid,
    pg_temp.gver(%L::uuid), 'acacacac-0000-4000-8000-000000000001'::uuid, %L::uuid, 'low', '{}')$$,
    (select v from t where k='gb'), (select v from t where k='gb'), (select v from t where k='ea')),
  null, null, 'a candidate entry from another group is refused (same-group composite FK)');

-- A caller may NOT claim candidate without evidence: source stays unknown until
-- a real link is attached; attaching derives candidate; removing the last link
-- returns to unknown.
select is((select source_state::text from public.intake_draft_groups where id=(select v from t where k='gb')::uuid),
  'unknown', 'a fresh group with no evidence is unknown, never a bare candidate');
insert into t values ('cl', (public.attach_intake_candidate((select v from t where k='ws')::uuid,
  (select v from t where k='gb')::uuid, pg_temp.gver((select v from t where k='gb')::uuid),
  'acacacac-0000-4000-8000-000000000001'::uuid, null, 'high', '{"note":"x"}'::jsonb))->>'id');
select is((select source_state::text from public.intake_draft_groups where id=(select v from t where k='gb')::uuid),
  'candidate', 'attaching a candidate derives source = candidate');
-- Content hash includes the candidate snapshot: it changed after the attach.
select isnt(public.preview_intake_commit((select v from t where k='ws')::uuid, (select v from t where k='gb')::uuid)->>'content_hash',
  public.preview_intake_commit((select v from t where k='ws')::uuid, (select v from t where k='ga')::uuid)->>'content_hash',
  'the content hash reflects candidate evidence (differs from a no-candidate peer)');
select is((public.remove_intake_candidate((select v from t where k='ws')::uuid,
  (select v from t where k='cl')::uuid, pg_temp.gver((select v from t where k='gb')::uuid))->>'source_state'),
  'unknown', 'removing the last candidate returns the group to unknown');

-- A bare "stated" is refused; a governed source_kind is required.
select throws_ok(
  format($$select public.upsert_intake_group('aaaa0000-0000-4000-8000-000000000001', %L::uuid, null, null,
    'raw_tcg','x',1,'lot_managed',0,'{}','{}','{"source_kind":"not_a_real_kind"}',null,null,false,false,false,false)$$,
    (select v from t where k='s2')),
  '22023', null, 'an ungoverned stated source_kind is refused');

-- ============================ GRADED IDENTITY COHERENCE =====================
insert into t values ('gm', pg_temp.newg((select v from t where k='s2')::uuid, 'graded_tcg', 'Mismatch Graded', 1,
  'serialized', 1, '{"set_name":"Base","card_number":"9"}'::jsonb,
  '{"grading_company":"CGC","numeric_grade":"9.5","product_format":"Graded slab"}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'BIN-1')::text);
-- entry says PSA / 9 — disagrees with the CGC / 9.5 SKU identity.
select public.upsert_intake_entry((select v from t where k='ws')::uuid, (select v from t where k='gm')::uuid,
  pg_temp.gver((select v from t where k='gm')::uuid), 1, 'PSA', '9', null, 'MIS-1', null, '{}');
select ok((public.evaluate_intake_field_rules((select v from t where k='ws')::uuid, (select v from t where k='gm')::uuid)->'blockers')::text
  like '%graded_identity_mismatch%',
  'a graded entry disagreeing with the SKU identity is blocked');
-- The mismatch blocks the commit BEFORE any canonical write.
select is(
  (public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='gm')::uuid,
    'gm-key-0001', pg_temp.gver((select v from t where k='gm')::uuid),
    public.preview_intake_commit((select v from t where k='ws')::uuid, (select v from t where k='gm')::uuid)->>'content_hash'))->>'outcome',
  'blocked', 'the graded mismatch blocks commit');
select is((select count(*)::int from public.product_catalog
           where workspace_id=(select v from t where k='ws')::uuid and product_canonical_key like '%|base|9|%'), 0,
  'no product was created for the blocked graded mismatch');

-- ============================ LOCATION RESOLUTION ===========================
insert into t values ('s3', (public.create_intake_session((select v from t where k='ws')::uuid, 's3')->>'id'));
-- Unknown code -> blocked.
insert into t values ('glu', pg_temp.newg((select v from t where k='s3')::uuid, 'raw_tcg', 'Loc Unknown', 1,
  'lot_managed', 0, '{"set_name":"L","card_number":"1"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'NO-SUCH-BIN')::text);
select ok((public.evaluate_intake_field_rules((select v from t where k='ws')::uuid, (select v from t where k='glu')::uuid)->'blockers')::text
  like '%location_unresolved%', 'an unknown location code is blocked');
-- Retired code -> blocked.
select public.register_storage_location((select v from t where k='ws')::uuid, 'RET-1', null, 'Retired');
select public.retire_storage_location((select v from t where k='ws')::uuid, 'RET-1');
insert into t values ('glr', pg_temp.newg((select v from t where k='s3')::uuid, 'raw_tcg', 'Loc Retired', 1,
  'lot_managed', 0, '{"set_name":"L","card_number":"2"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'RET-1')::text);
select ok((public.evaluate_intake_field_rules((select v from t where k='ws')::uuid, (select v from t where k='glr')::uuid)->'blockers')::text
  like '%location_unresolved%', 'a retired location code is blocked');
-- A parented / labeled location resolves and commit mints NO new location.
select public.register_storage_location((select v from t where k='ws')::uuid, 'AISLE', null, 'Aisle 1');
select public.register_storage_location((select v from t where k='ws')::uuid, 'SHELF', 'AISLE', 'Shelf A');
insert into t values ('loc_before', (select count(*)::text from public.storage_locations
  where workspace_id=(select v from t where k='ws')::uuid));
insert into t values ('glok', pg_temp.newg((select v from t where k='s3')::uuid, 'raw_tcg', 'Loc OK', 1,
  'lot_managed', 0, '{"set_name":"L","card_number":"3"}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'SHELF')::text);
select is((public.commit_intake_group((select v from t where k='ws')::uuid, (select v from t where k='glok')::uuid,
  'loc-key-0001', pg_temp.gver((select v from t where k='glok')::uuid),
  public.preview_intake_commit((select v from t where k='ws')::uuid, (select v from t where k='glok')::uuid)->>'content_hash'))->>'outcome',
  'committed', 'a parented/labeled active location resolves and the group commits');
select is((select count(*)::int from public.storage_locations where workspace_id=(select v from t where k='ws')::uuid),
  (select v::int from t where k='loc_before'),
  'intake minted NO new storage location during commit');

select * from finish();
rollback;
