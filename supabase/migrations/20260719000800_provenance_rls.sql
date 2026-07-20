-- Phase 3 source/import provenance — migration 8: row-level security.
--
-- READ-ONLY TABLE ACCESS. `authenticated` holds SELECT and nothing else on
-- every provenance table. There is no INSERT, UPDATE, or DELETE grant and no
-- INSERT, UPDATE, or DELETE policy anywhere in this schema.
--
-- Every write goes through a SECURITY DEFINER function in migrations 9 and 10,
-- each of which authorizes internally as part of its lookup. This is what makes
-- the governed path exclusive rather than merely preferred: a PostgREST-shaped
-- request, a raw SQL statement, or any other direct DML from an authenticated
-- client is refused by the grant layer before RLS is even consulted. Concretely
-- it means an authenticated client cannot:
--   * commit an import job (no UPDATE on import_jobs);
--   * confirm, reject, or supersede a crosswalk (no UPDATE on source_crosswalks);
--   * resolve a data-quality issue (no UPDATE on data_quality_issues);
--   * fabricate evidence (no INSERT on source_records);
--   * fabricate audit history (no INSERT on audit_events);
--   * bypass idempotency (no INSERT on import_jobs).
--
-- Role model for READING:
--   anon      — NO grants and NO policies. Anonymous users see nothing.
--   non-member— app.member_role(workspace_id) resolves to NULL, which every
--               policy requires to be non-null. Sees nothing.
--   viewer    — reads the whole import-review surface in its own workspaces.
--   operator  — reads the same, and may additionally invoke the preview/commit
--               and candidate-review RPCs.
--   owner     — as operator, plus the owner-only source-system registry RPC.
--
-- Read authorization is enforced twice: by these policies AND by the composite
-- (id, workspace_id) foreign keys in migration 6, so user A cannot reach
-- workspace B even if a policy were ever loosened.

alter table public.source_systems enable row level security;
alter table public.import_jobs enable row level security;
alter table public.source_records enable row level security;
alter table public.external_identifiers enable row level security;
alter table public.source_crosswalks enable row level security;
alter table public.audit_events enable row level security;
alter table public.data_quality_issues enable row level security;

-- Strip everything, then grant back SELECT only. anon is never granted
-- anything on any provenance table.
revoke all on table
  public.source_systems, public.import_jobs, public.source_records,
  public.external_identifiers, public.source_crosswalks, public.audit_events,
  public.data_quality_issues
from public, anon, authenticated;

-- service_role too. A hosted Supabase project configures DEFAULT PRIVILEGES on
-- the public schema that automatically grant service_role write access to every
-- new table, so without this revoke it would silently retain INSERT/UPDATE/
-- DELETE here — and service_role also carries BYPASSRLS, so those grants would
-- be a complete bypass of the governed path.
--
-- Nothing in this application uses a service-role key (the server authenticates
-- as the calling user and holds no privileged credential), so revoking costs
-- nothing and means even a leaked service-role key cannot fabricate evidence,
-- forge audit history, or commit an import outside the governed RPCs.
--
-- Guarded because the local PostgreSQL shim may not define the role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table
      public.source_systems, public.import_jobs, public.source_records,
      public.external_identifiers, public.source_crosswalks, public.audit_events,
      public.data_quality_issues
    from service_role';
  end if;
end $$;

grant select on table
  public.source_systems, public.import_jobs, public.source_records,
  public.external_identifiers, public.source_crosswalks, public.audit_events,
  public.data_quality_issues
to authenticated;

-- Membership-scoped read policies. Every one is SELECT-only; there is
-- deliberately no other policy on any provenance table in this schema.
create policy source_systems_select on public.source_systems
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy import_jobs_select on public.import_jobs
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy source_records_select on public.source_records
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy external_identifiers_select on public.external_identifiers
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy source_crosswalks_select on public.source_crosswalks
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy data_quality_issues_select on public.data_quality_issues
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

insert into public.schema_migrations_log (migration_name)
values ('20260719000800_provenance_rls');
