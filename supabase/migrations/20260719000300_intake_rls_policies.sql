-- Phase 2 shadow foundation — migration 3: row-level security for the intake
-- shadow schema.
--
-- Every workspace-scoped table gets RLS enabled plus membership-scoped
-- policies. There are deliberately no broad "authenticated users can access
-- all rows" policies anywhere:
--   * anon has no grants at all — anonymous users have no business-data access;
--   * viewer: read-only within its own workspaces;
--   * operator: ordinary intake work (sessions, groups, items, photos) within
--     its own workspaces;
--   * owner: everything operator can do, plus configuration administration
--     (photo requirements, field registry/rules, reference lists/options).

-- Enable RLS and set baseline grants ------------------------------------------
alter table public.sessions enable row level security;
alter table public.intake_groups enable row level security;
alter table public.items enable row level security;
alter table public.photos enable row level security;
alter table public.photo_requirements enable row level security;
alter table public.reference_lists enable row level security;
alter table public.reference_options enable row level security;
alter table public.field_registry enable row level security;
alter table public.field_rules enable row level security;

revoke all on table
  public.sessions, public.intake_groups, public.items, public.photos,
  public.photo_requirements, public.reference_lists, public.reference_options,
  public.field_registry, public.field_rules
from public, anon;

grant select, insert, update, delete on table
  public.sessions, public.intake_groups, public.items, public.photos,
  public.photo_requirements, public.reference_lists, public.reference_options,
  public.field_registry, public.field_rules
to authenticated;

-- Intake work tables: members read; owner/operator write ---------------------

-- sessions
create policy sessions_select on public.sessions
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy sessions_insert on public.sessions
  for insert to authenticated
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and created_by = (select auth.uid())
  );
create policy sessions_update on public.sessions
  for update to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'))
  with check (app.member_role(workspace_id) in ('owner', 'operator'));
create policy sessions_delete on public.sessions
  for delete to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'));

-- intake_groups
create policy intake_groups_select on public.intake_groups
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy intake_groups_insert on public.intake_groups
  for insert to authenticated
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and created_by = (select auth.uid())
  );
create policy intake_groups_update on public.intake_groups
  for update to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'))
  with check (app.member_role(workspace_id) in ('owner', 'operator'));
create policy intake_groups_delete on public.intake_groups
  for delete to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'));

-- items
create policy items_select on public.items
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy items_insert on public.items
  for insert to authenticated
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and created_by = (select auth.uid())
  );
create policy items_update on public.items
  for update to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'))
  with check (app.member_role(workspace_id) in ('owner', 'operator'));
create policy items_delete on public.items
  for delete to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'));

-- photos (evidence: deletion is owner-only)
create policy photos_select on public.photos
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy photos_insert on public.photos
  for insert to authenticated
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and created_by = (select auth.uid())
  );
create policy photos_update on public.photos
  for update to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'))
  with check (app.member_role(workspace_id) in ('owner', 'operator'));
create policy photos_delete on public.photos
  for delete to authenticated
  using (app.member_role(workspace_id) = 'owner');

-- Configuration tables: members read; owner-only writes ----------------------

-- photo_requirements
create policy photo_requirements_select on public.photo_requirements
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy photo_requirements_insert on public.photo_requirements
  for insert to authenticated
  with check (app.member_role(workspace_id) = 'owner');
create policy photo_requirements_update on public.photo_requirements
  for update to authenticated
  using (app.member_role(workspace_id) = 'owner')
  with check (app.member_role(workspace_id) = 'owner');
create policy photo_requirements_delete on public.photo_requirements
  for delete to authenticated
  using (app.member_role(workspace_id) = 'owner');

-- reference_lists
create policy reference_lists_select on public.reference_lists
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy reference_lists_insert on public.reference_lists
  for insert to authenticated
  with check (app.member_role(workspace_id) = 'owner');
create policy reference_lists_update on public.reference_lists
  for update to authenticated
  using (app.member_role(workspace_id) = 'owner')
  with check (app.member_role(workspace_id) = 'owner');
create policy reference_lists_delete on public.reference_lists
  for delete to authenticated
  using (app.member_role(workspace_id) = 'owner');

-- reference_options
create policy reference_options_select on public.reference_options
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy reference_options_insert on public.reference_options
  for insert to authenticated
  with check (app.member_role(workspace_id) = 'owner');
create policy reference_options_update on public.reference_options
  for update to authenticated
  using (app.member_role(workspace_id) = 'owner')
  with check (app.member_role(workspace_id) = 'owner');
create policy reference_options_delete on public.reference_options
  for delete to authenticated
  using (app.member_role(workspace_id) = 'owner');

-- field_registry
create policy field_registry_select on public.field_registry
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy field_registry_insert on public.field_registry
  for insert to authenticated
  with check (app.member_role(workspace_id) = 'owner');
create policy field_registry_update on public.field_registry
  for update to authenticated
  using (app.member_role(workspace_id) = 'owner')
  with check (app.member_role(workspace_id) = 'owner');
create policy field_registry_delete on public.field_registry
  for delete to authenticated
  using (app.member_role(workspace_id) = 'owner');

-- field_rules
create policy field_rules_select on public.field_rules
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy field_rules_insert on public.field_rules
  for insert to authenticated
  with check (app.member_role(workspace_id) = 'owner');
create policy field_rules_update on public.field_rules
  for update to authenticated
  using (app.member_role(workspace_id) = 'owner')
  with check (app.member_role(workspace_id) = 'owner');
create policy field_rules_delete on public.field_rules
  for delete to authenticated
  using (app.member_role(workspace_id) = 'owner');

insert into public.schema_migrations_log (migration_name)
values ('20260719000300_intake_rls_policies');
