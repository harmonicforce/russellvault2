-- Phase 6A intake kernel — governed state machine: transitions, draft-only edit,
-- terminal freeze, abandon audit, invalid transitions fail closed, and STORED
-- state always agreeing with AUDIT state.
begin;
create extension if not exists pgtap;
select no_plan();

create function pg_temp.login(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated'; end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@a.test'),
  ('a2222222-2222-2222-2222-222222222222', 'op@a.test'),
  ('a3333333-3333-3333-3333-333333333333', 'view@a.test');
insert into public.workspaces (id, name, created_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'WS A', 'a1111111-1111-1111-1111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'operator'),
  ('aaaa0000-0000-4000-8000-000000000001', 'a3333333-3333-3333-3333-333333333333', 'viewer');

select pg_temp.login('a2222222-2222-2222-2222-222222222222');

create temp table t (k text primary key, v text);
insert into t values ('ws', 'aaaa0000-0000-4000-8000-000000000001');
insert into t values ('sess', (public.create_intake_session((select v from t where k='ws')::uuid, 's')->>'id'));
select public.register_storage_location((select v from t where k='ws')::uuid, 'BIN-1', null, 'Bin 1');

create function pg_temp.gver(g uuid) returns int language sql as $$
  select version from public.intake_draft_groups where id = g; $$;
-- stored state must equal the latest audited resulting_state for a group.
create function pg_temp.stored_eq_audit(g uuid) returns boolean language sql stable as $$
  select (select state::text from public.intake_draft_groups where id = g)
       = (select resulting_state from public.intake_transition_events
          where group_id = g and resulting_state is not null
          order by event_seq desc limit 1); $$;

-- A valid raw-card draft (lot-managed, stated source, resolvable location).
insert into t values ('g', (public.upsert_intake_group(
  (select v from t where k='ws')::uuid, (select v from t where k='sess')::uuid, null, null,
  'raw_tcg', 'Pikachu Jungle #60', 3, 'lot_managed', 0,
  '{"set_name":"Jungle","card_number":"60","featured_subject":"Pikachu"}'::jsonb,
  '{}'::jsonb, '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-1',
  false, false, false, false)->>'id'));

select is((select state::text from public.intake_draft_groups where id = (select v from t where k='g')::uuid),
  'draft', 'a new group is in draft');
select ok(pg_temp.stored_eq_audit((select v from t where k='g')::uuid),
  'stored state agrees with the audit trail after creation');

-- draft -> ready_to_commit via readiness (stored state actually advances).
select is((public.validate_intake_readiness((select v from t where k='ws')::uuid,
  (select v from t where k='g')::uuid)->>'ready')::text, 'true', 'a clean raw draft is ready');
select is((select state::text from public.intake_draft_groups where id=(select v from t where k='g')::uuid),
  'ready_to_commit', 'readiness advanced STORED state draft -> ready_to_commit');
select ok(pg_temp.stored_eq_audit((select v from t where k='g')::uuid),
  'stored state agrees with the audit trail after readiness');

-- Editing a ready_to_commit group actually reopens STORED state to draft and
-- records the matching transition.
select is((public.upsert_intake_group(
  (select v from t where k='ws')::uuid, (select v from t where k='sess')::uuid,
  (select v from t where k='g')::uuid, pg_temp.gver((select v from t where k='g')::uuid),
  'raw_tcg', 'Pikachu Jungle #60', 4, 'lot_managed', 0,
  '{"set_name":"Jungle","card_number":"60","featured_subject":"Pikachu"}'::jsonb,
  '{}'::jsonb, '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-1',
  false, false, false, false)->>'state'), 'draft', 'editing a ready group reopens it to draft');
select is((select state::text from public.intake_draft_groups where id=(select v from t where k='g')::uuid),
  'draft', 'the STORED state is draft again after the edit');
select is((select count(*)::int from public.intake_transition_events
  where group_id=(select v from t where k='g')::uuid and event_type='state_transition'
    and prior_state='ready_to_commit' and resulting_state='draft'), 1,
  'the ready_to_commit -> draft reopen was audited');
select ok(pg_temp.stored_eq_audit((select v from t where k='g')::uuid),
  'stored state agrees with the audit trail after reopen');

-- Editing an ENTRY on a ready group also reopens it to draft.
select public.validate_intake_readiness((select v from t where k='ws')::uuid, (select v from t where k='g')::uuid);
-- (raw group has no entries; put it back to ready then edit an entry on a serialized group)
insert into t values ('gs', (public.upsert_intake_group(
  (select v from t where k='ws')::uuid, (select v from t where k='sess')::uuid, null, null,
  'sealed_tcg', 'Sealed Ser', 1, 'serialized', 1, '{"set_name":"S"}'::jsonb,
  '{"product_format":"Sealed product","seal_or_packaging_condition":"factory sealed"}'::jsonb,
  '{"source_kind":"retail_purchase"}'::jsonb, null, 'BIN-1', false, false, false, false)->>'id'));
select public.upsert_intake_entry((select v from t where k='ws')::uuid, (select v from t where k='gs')::uuid,
  pg_temp.gver((select v from t where k='gs')::uuid), 1, null, null, null, null, 'S-1', '{}');
select public.validate_intake_readiness((select v from t where k='ws')::uuid, (select v from t where k='gs')::uuid);
select is((select state::text from public.intake_draft_groups where id=(select v from t where k='gs')::uuid),
  'ready_to_commit', 'the serialized group is ready');
select public.upsert_intake_entry((select v from t where k='ws')::uuid, (select v from t where k='gs')::uuid,
  pg_temp.gver((select v from t where k='gs')::uuid), 1, null, null, null, null, 'S-1B', '{}');
select is((select state::text from public.intake_draft_groups where id=(select v from t where k='gs')::uuid),
  'draft', 'editing an entry reopened the group STORED state to draft');
select ok(pg_temp.stored_eq_audit((select v from t where k='gs')::uuid),
  'stored state agrees with audit after an entry edit reopen');

-- Invalid transitions fail closed via the governed matrix.
select throws_ok(
  $$select public.transition_intake_group('aaaa0000-0000-4000-8000-000000000001',
    (select v from t where k='g')::uuid, 'committed', '{}')$$,
  null, null, 'commit is not a manual transition target');

-- Abandon a draft; an abandoned group is frozen and its stored state is truthful.
insert into t values ('g2', (public.upsert_intake_group(
  (select v from t where k='ws')::uuid, (select v from t where k='sess')::uuid, null, null,
  'raw_tcg', 'Abandoned Card', 1, 'lot_managed', 0, '{}'::jsonb, '{}'::jsonb,
  '{"source_kind":"personal_collection"}'::jsonb, 'Near Mint', 'BIN-1', false, false, false, false)->>'id'));
select is((public.transition_intake_group((select v from t where k='ws')::uuid,
  (select v from t where k='g2')::uuid, 'abandoned', '{"reason":"mis-scan"}'::jsonb)->>'state'),
  'abandoned', 'a draft may be abandoned');
select is((select state::text from public.intake_draft_groups where id=(select v from t where k='g2')::uuid),
  'abandoned', 'the abandoned group STORED state is abandoned');
select throws_ok(
  $$select public.upsert_intake_group('aaaa0000-0000-4000-8000-000000000001',
    (select v from t where k='sess')::uuid, (select v from t where k='g2')::uuid, 1,
    'raw_tcg', 'x', 1, 'lot_managed', 0, '{}', '{}', '{}', null, null, false, false, false, false)$$,
  null, null, 'an abandoned group cannot be edited');
select throws_ok(
  $$select public.transition_intake_group('aaaa0000-0000-4000-8000-000000000001',
    (select v from t where k='g2')::uuid, 'ready_to_commit', '{}')$$,
  null, null, 'abandoned -> ready_to_commit fails closed');
select is((select reason->>'reason' from public.intake_transition_events
   where group_id=(select v from t where k='g2')::uuid and event_type='abandon'),
  'mis-scan', 'the structured abandon reason is preserved');

-- Direct terminal mutation is blocked at the trigger layer.
select pg_temp.logout();
select throws_ok(
  $$update public.intake_draft_groups set display_name = 'hacked'
    where id = (select v from t where k='g2')::uuid$$,
  null, null, 'a terminal group is frozen against direct UPDATE');
select throws_ok(
  $$delete from public.intake_draft_groups where id = (select v from t where k='g2')::uuid$$,
  null, null, 'intake groups are never deleted');

select * from finish();
rollback;
