-- Phase 6A intake kernel — governed state machine: transitions, draft-only edit,
-- terminal freeze, abandon audit, invalid transitions fail closed.
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

-- Build a session and a valid raw-card draft (lot-managed, no blockers).
create temp table t (k text primary key, v text);
insert into t values ('ws', 'aaaa0000-0000-4000-8000-000000000001');
insert into t values ('sess', (public.create_intake_session((select v from t where k='ws')::uuid, 's')->>'id'));
insert into t values ('g', (public.upsert_intake_group(
  (select v from t where k='ws')::uuid, (select v from t where k='sess')::uuid, null,
  'raw_tcg', 'Pikachu Jungle #60', 3, 'lot_managed', 0,
  '{"set_name":"Jungle","card_number":"60","featured_subject":"Pikachu"}'::jsonb,
  '{}'::jsonb, 'stated', 'Near Mint', 'BIN-1', false, false, false)->>'id'));

-- The draft starts in 'draft'.
select is((select state::text from public.intake_draft_groups where id = (select v from t where k='g')::uuid),
  'draft', 'a new group is in draft');

-- draft -> ready_to_commit via readiness (no blockers).
select is((public.validate_intake_readiness((select v from t where k='ws')::uuid,
  (select v from t where k='g')::uuid)->>'ready')::text, 'true', 'a clean raw draft is ready');
select is((select state::text from public.intake_draft_groups where id=(select v from t where k='g')::uuid),
  'ready_to_commit', 'readiness advanced draft -> ready_to_commit');

-- Editing a ready_to_commit group reopens it to draft (governed reopen) and
-- bumps the version.
select is((public.upsert_intake_group(
  (select v from t where k='ws')::uuid, (select v from t where k='sess')::uuid,
  (select v from t where k='g')::uuid,
  'raw_tcg', 'Pikachu Jungle #60', 4, 'lot_managed', 0,
  '{"set_name":"Jungle","card_number":"60","featured_subject":"Pikachu"}'::jsonb,
  '{}'::jsonb, 'stated', 'Near Mint', 'BIN-1', false, false, false)->>'state'), 'draft',
  'editing a ready group reopens it to draft');

-- Invalid transitions fail closed via the governed matrix.
select throws_ok(
  $$select public.transition_intake_group('aaaa0000-0000-4000-8000-000000000001',
    (select v from t where k='g')::uuid, 'committed', '{}')$$,
  null, null, 'commit is not a manual transition target');

-- Only a draft/ready may be edited: abandon then prove edits are refused.
insert into t values ('g2', (public.upsert_intake_group(
  (select v from t where k='ws')::uuid, (select v from t where k='sess')::uuid, null,
  'raw_tcg', 'Abandoned Card', 1, 'lot_managed', 0,
  '{}'::jsonb, '{}'::jsonb, 'stated', 'Near Mint', 'BIN-1', false, false, false)->>'id'));
select is((public.transition_intake_group((select v from t where k='ws')::uuid,
  (select v from t where k='g2')::uuid, 'abandoned',
  '{"reason":"mis-scan"}'::jsonb)->>'state'), 'abandoned', 'a draft may be abandoned');

-- An abandoned group is frozen: no edit, and no further transition.
select throws_ok(
  $$select public.upsert_intake_group('aaaa0000-0000-4000-8000-000000000001',
    (select v from t where k='sess')::uuid, (select v from t where k='g2')::uuid,
    'raw_tcg', 'x', 1, 'lot_managed', 0, '{}', '{}', 'stated', null, null, false, false, false)$$,
  null, null, 'an abandoned group cannot be edited');
select throws_ok(
  $$select public.transition_intake_group('aaaa0000-0000-4000-8000-000000000001',
    (select v from t where k='g2')::uuid, 'ready_to_commit', '{}')$$,
  null, null, 'abandoned -> ready_to_commit fails closed');

-- Abandonment preserved enough audit evidence to explain what and by whom.
select is(
  (select count(*)::int from public.intake_transition_events
   where group_id = (select v from t where k='g2')::uuid and event_type = 'abandon'
     and actor_user_id = 'a2222222-2222-2222-2222-222222222222'
     and prior_state = 'draft' and resulting_state = 'abandoned'),
  1, 'abandon recorded actor, prior and resulting state, and a reason');
select is(
  (select reason->>'reason' from public.intake_transition_events
   where group_id = (select v from t where k='g2')::uuid and event_type = 'abandon'),
  'mis-scan', 'the structured abandon reason is preserved');

-- A direct UPDATE on a terminal group is blocked at the trigger layer, even for
-- a privileged connection.
select pg_temp.logout();
select throws_ok(
  $$update public.intake_draft_groups set display_name = 'hacked'
    where id = (select v from t where k='g2')::uuid$$,
  null, null, 'a terminal group is frozen against direct UPDATE');
select throws_ok(
  $$delete from public.intake_draft_groups where id = (select v from t where k='g2')::uuid$$,
  null, null, 'intake groups are never deleted');

-- Every transition carries actor, timestamp, workspace, prior + resulting state.
select is(
  (select count(*)::int from public.intake_transition_events
   where workspace_id = (select v from t where k='ws')::uuid
     and occurred_at is not null and actor_process = 'intake.kernel'),
  (select count(*)::int from public.intake_transition_events
   where workspace_id = (select v from t where k='ws')::uuid),
  'every transition event carries a timestamp and actor process');

select * from finish();
rollback;
