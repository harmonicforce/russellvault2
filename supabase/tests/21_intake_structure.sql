-- Phase 6A intake kernel — structure, RLS, grants, append-only, governed config.
begin;
create extension if not exists pgtap;
select no_plan();

-- Control-plane tables exist and are DISTINCT from the vestigial Phase 2 shadow
-- tables of similar names (sessions / intake_groups / field_registry ...).
select has_table('public'::name, 'intake_sessions'::name, 'intake_sessions exists');
select has_table('public'::name, 'intake_draft_groups'::name, 'intake_draft_groups exists');
select has_table('public'::name, 'intake_entries'::name, 'intake_entries exists');
select has_table('public'::name, 'intake_field_registry'::name, 'intake_field_registry exists');
select has_table('public'::name, 'intake_field_rules'::name, 'intake_field_rules exists');
select has_table('public'::name, 'intake_reference_lists'::name, 'intake_reference_lists exists');
select has_table('public'::name, 'intake_reference_options'::name, 'intake_reference_options exists');
select has_table('public'::name, 'intake_candidate_links'::name, 'intake_candidate_links exists');
select has_table('public'::name, 'intake_commit_attempts'::name, 'intake_commit_attempts exists');
select has_table('public'::name, 'intake_transition_events'::name, 'intake_transition_events exists');

-- The kernel does NOT create a second committed inventory/SKU/location truth.
select hasnt_table('public'::name, 'intake_items'::name, 'no second committed item table');
select hasnt_table('public'::name, 'intake_inventory'::name, 'no second committed inventory table');
select hasnt_table('public'::name, 'intake_skus'::name, 'no second committed SKU table');

-- The committed-truth tables remain the Phase 5 ones only.
select has_table('public'::name, 'product_catalog'::name, 'Phase 5 product_catalog present');
select has_table('public'::name, 'inventory_lots'::name, 'Phase 5 inventory_lots present');
select has_table('public'::name, 'inventory_items'::name, 'Phase 5 inventory_items present');

-- Candidate-evidence link has ZERO financial columns by construction.
select hasnt_column('public'::name, 'intake_candidate_links'::name, 'amount_minor'::name,
  'candidate link has no amount column');
select hasnt_column('public'::name, 'intake_candidate_links'::name, 'cents'::name,
  'candidate link has no cents column');
select hasnt_column('public'::name, 'intake_candidate_links'::name, 'quantity'::name,
  'candidate link cannot allocate quantity');
select hasnt_column('public'::name, 'intake_candidate_links'::name, 'cost_minor'::name,
  'candidate link has no cost column');
select hasnt_column('public'::name, 'intake_candidate_links'::name, 'allocated_minor'::name,
  'candidate link has no allocation column');

-- Enums exist.
select has_type('public'::name, 'intake_group_state'::name, 'intake_group_state enum exists');
select has_type('public'::name, 'intake_next_action'::name, 'intake_next_action enum exists');
select has_type('public'::name, 'intake_source_state'::name, 'intake_source_state enum exists');

-- RLS is enabled on every intake table.
select is(
  (select bool_and(rowsecurity) from pg_tables
   where schemaname = 'public' and tablename like 'intake\_%'),
  true, 'RLS enabled on every intake table');

-- authenticated has SELECT but NOT insert/update/delete on the tables (writes
-- go only through SECURITY DEFINER functions).
select ok(has_table_privilege('authenticated', 'public.intake_draft_groups', 'SELECT'),
  'authenticated may SELECT intake_draft_groups');
select ok(not has_table_privilege('authenticated', 'public.intake_draft_groups', 'INSERT'),
  'authenticated may NOT INSERT intake_draft_groups directly');
select ok(not has_table_privilege('authenticated', 'public.intake_commit_attempts', 'INSERT'),
  'authenticated may NOT INSERT commit receipts directly');
select ok(not has_table_privilege('authenticated', 'public.intake_transition_events', 'UPDATE'),
  'authenticated may NOT UPDATE the audit log');

-- anon has nothing.
select ok(not has_table_privilege('anon', 'public.intake_draft_groups', 'SELECT'),
  'anon cannot read intake_draft_groups');

-- Governed public-facing functions are executable by authenticated, not anon.
select ok(has_function_privilege('authenticated',
  'public.commit_intake_group(uuid,uuid,text,integer,text)', 'EXECUTE'),
  'authenticated may execute the commit kernel');
select ok(not has_function_privilege('anon',
  'public.commit_intake_group(uuid,uuid,text,integer,text)', 'EXECUTE'),
  'anon may not execute the commit kernel');

-- The commit receipt and audit log are append-only (UPDATE/DELETE forbidden even
-- as the table owner via the trigger). Prove with a direct attempt as superuser.
insert into auth.users (id, email) values ('c0000000-0000-4000-8000-000000000009', 's@a.test');
insert into public.workspaces (id, name, created_by)
  values ('cccc0000-0000-4000-8000-000000000009', 'WS S', 'c0000000-0000-4000-8000-000000000009');
insert into public.intake_transition_events (workspace_id, event_type, actor_process, reason)
  values ('cccc0000-0000-4000-8000-000000000009', 'session_created', 'test', '{}');
select throws_ok(
  $$update public.intake_transition_events set event_type = 'abandon'
    where workspace_id = 'cccc0000-0000-4000-8000-000000000009'$$,
  null, null, 'the transition/audit log is append-only (no UPDATE)');
select throws_ok(
  $$delete from public.intake_transition_events
    where workspace_id = 'cccc0000-0000-4000-8000-000000000009'$$,
  null, null, 'the transition/audit log is append-only (no DELETE)');

-- Governed config is seeded and immutable.
select ok((select count(*) from public.intake_field_registry) >= 15,
  'the field registry is seeded');
select ok((select count(*) from public.intake_field_rules
           where category = 'graded_tcg' and is_commit_blocker) >= 3,
  'graded_tcg has blocking rules seeded');
select throws_ok(
  $$update public.intake_field_rules set is_required = false$$,
  null, null, 'the field-rule config is immutable');

-- Every identity-driving registry field maps into a Phase 5 typed column, never
-- an EAV bag.
select is((select count(*) from public.intake_field_registry
           where is_identity_driving and maps_to is null), 0::bigint,
  'every identity-driving field maps into a typed Phase 5 column');

-- Acceptance-patch structure: governed attr_key, source evidence, security flag,
-- and governed non-text data types all exist.
select has_column('public'::name, 'intake_field_registry'::name, 'attr_key'::name,
  'the registry carries a governed attr_key');
select has_column('public'::name, 'intake_draft_groups'::name, 'source_evidence'::name,
  'a draft group carries governed source_evidence');
select has_column('public'::name, 'intake_draft_groups'::name, 'security_sensitive'::name,
  'a draft group carries a security_sensitive policy flag');
select ok((select count(*) from public.intake_field_registry
           where data_type in ('integer', 'boolean')) >= 2,
  'governed integer/boolean fields exist so the rule contract is truthful');
select ok((select count(*) from public.intake_reference_options where list_key = 'source_kind') >= 4,
  'governed stated-source kinds are seeded');

select * from finish();
rollback;
