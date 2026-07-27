-- Phase 6A intake kernel — migration 3: row-level security and grants.
--
-- Same posture as Phases 3-5: `authenticated` holds SELECT and nothing else on
-- every intake table; every write goes through a SECURITY DEFINER function
-- (migration 5) that authorizes internally. anon has no grants and no policies.
-- A non-member sees nothing; viewers/operators/owners read the intake surface in
-- their own workspaces only. The governed config tables (registry, rules,
-- reference lists/options) are workspace-independent and readable by any
-- authenticated user; they are never writable through the API.

alter table public.intake_field_registry enable row level security;
alter table public.intake_field_rules enable row level security;
alter table public.intake_reference_lists enable row level security;
alter table public.intake_reference_options enable row level security;
alter table public.intake_sessions enable row level security;
alter table public.intake_draft_groups enable row level security;
alter table public.intake_entries enable row level security;
alter table public.intake_candidate_links enable row level security;
alter table public.intake_commit_attempts enable row level security;
alter table public.intake_transition_events enable row level security;

-- Strip everything, then grant back SELECT only.
revoke all on table
  public.intake_field_registry, public.intake_field_rules,
  public.intake_reference_lists, public.intake_reference_options,
  public.intake_sessions, public.intake_draft_groups, public.intake_entries,
  public.intake_candidate_links, public.intake_commit_attempts,
  public.intake_transition_events
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table
      public.intake_field_registry, public.intake_field_rules,
      public.intake_reference_lists, public.intake_reference_options,
      public.intake_sessions, public.intake_draft_groups, public.intake_entries,
      public.intake_candidate_links, public.intake_commit_attempts,
      public.intake_transition_events
    from service_role';
  end if;
end $$;

grant select on table
  public.intake_field_registry, public.intake_field_rules,
  public.intake_reference_lists, public.intake_reference_options,
  public.intake_sessions, public.intake_draft_groups, public.intake_entries,
  public.intake_candidate_links, public.intake_commit_attempts,
  public.intake_transition_events
to authenticated;

-- Governed config: workspace-independent, readable by any authenticated caller.
-- Gated on a resolved caller identity (auth.uid()) rather than an unconditional
-- TRUE, so no always-true policy exists anywhere in public.
create policy intake_field_registry_select on public.intake_field_registry
  for select to authenticated using ((select auth.uid()) is not null);
create policy intake_field_rules_select on public.intake_field_rules
  for select to authenticated using ((select auth.uid()) is not null);
create policy intake_reference_lists_select on public.intake_reference_lists
  for select to authenticated using ((select auth.uid()) is not null);
create policy intake_reference_options_select on public.intake_reference_options
  for select to authenticated using ((select auth.uid()) is not null);

-- Workspace-scoped: any member may read within their own workspace.
create policy intake_sessions_select on public.intake_sessions
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy intake_draft_groups_select on public.intake_draft_groups
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy intake_entries_select on public.intake_entries
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy intake_candidate_links_select on public.intake_candidate_links
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy intake_commit_attempts_select on public.intake_commit_attempts
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy intake_transition_events_select on public.intake_transition_events
  for select to authenticated using (app.member_role(workspace_id) is not null);

insert into public.schema_migrations_log (migration_name)
values ('20260722000300_intake_kernel_rls');
