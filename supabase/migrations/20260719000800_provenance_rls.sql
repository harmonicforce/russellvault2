-- Phase 3 source/import provenance — migration 8: row-level security.
--
-- Role model for the provenance/staging layer:
--   anon      — NO grants and NO policies. Anonymous users have no access to
--               any provenance table, not even read.
--   non-member— an authenticated user with no membership row resolves
--               app.member_role(workspace_id) to NULL, which every policy
--               below requires to be non-null. No access.
--   viewer    — READ-ONLY across the import-review surface. Cannot commit,
--               confirm, reject, supersede, or resolve issues.
--   operator  — ordinary preview/commit and candidate-review work, in its own
--               workspaces only.
--   owner     — everything operator can do, plus the explicitly owner-only
--               administration of the source_systems registry.
--
-- Cross-workspace isolation is enforced twice: by these policies AND by the
-- composite (id, workspace_id) foreign keys in migration 6, so user A cannot
-- read or mutate workspace B even if a policy were ever loosened.
--
-- Append-only tables (source_records, audit_events) receive SELECT and INSERT
-- only. No UPDATE or DELETE grant and no UPDATE or DELETE policy exists for
-- them anywhere, and the migration 7 triggers refuse both regardless.
--
-- NO table in this file grants DELETE to any role: provenance is retained, and
-- corrections are made by new imports or supersession, never by removal.

alter table public.source_systems enable row level security;
alter table public.import_jobs enable row level security;
alter table public.source_records enable row level security;
alter table public.external_identifiers enable row level security;
alter table public.source_crosswalks enable row level security;
alter table public.audit_events enable row level security;
alter table public.data_quality_issues enable row level security;

-- Baseline: strip everything, then grant back the minimum. anon is never
-- granted anything on any provenance table.
revoke all on table
  public.source_systems, public.import_jobs, public.source_records,
  public.external_identifiers, public.source_crosswalks, public.audit_events,
  public.data_quality_issues
from public, anon;

-- Mutable tables: select/insert/update. DELETE is deliberately never granted.
grant select, insert, update on table
  public.source_systems, public.import_jobs, public.external_identifiers,
  public.source_crosswalks, public.data_quality_issues
to authenticated;

-- Append-only tables: select/insert only.
grant select, insert on table
  public.source_records, public.audit_events
to authenticated;

-- source_systems (owner-only administration) ----------------------------------
-- Every member may read the registry so the review UI can label a job's
-- origin, but only owners may register or amend a source system.
create policy source_systems_select on public.source_systems
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy source_systems_insert on public.source_systems
  for insert to authenticated
  with check (
    app.member_role(workspace_id) = 'owner'
    and created_by = (select auth.uid())
  );

create policy source_systems_update on public.source_systems
  for update to authenticated
  using (app.member_role(workspace_id) = 'owner')
  with check (app.member_role(workspace_id) = 'owner');

-- No delete policy: a registered source system is retained (deactivate via
-- active = false) so historical jobs never lose their origin.

-- import_jobs ------------------------------------------------------------------
-- Members read. Operators and owners create previews and advance them; the
-- actor must be the acting user, so a job can never be attributed to someone
-- else. Viewers cannot insert or update at all — this is what blocks commit.
create policy import_jobs_select on public.import_jobs
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy import_jobs_insert on public.import_jobs
  for insert to authenticated
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and actor_user_id = (select auth.uid())
  );

create policy import_jobs_update on public.import_jobs
  for update to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'))
  with check (app.member_role(workspace_id) in ('owner', 'operator'));

-- No delete policy: import headers are retained permanently.

-- source_records (APPEND-ONLY) --------------------------------------------------
-- Members read raw rows for review. Operators and owners write them during
-- ingest. There is no update policy and no delete policy anywhere in this
-- schema for this table, by design.
create policy source_records_select on public.source_records
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy source_records_insert on public.source_records
  for insert to authenticated
  with check (app.member_role(workspace_id) in ('owner', 'operator'));

-- external_identifiers ----------------------------------------------------------
create policy external_identifiers_select on public.external_identifiers
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy external_identifiers_insert on public.external_identifiers
  for insert to authenticated
  with check (app.member_role(workspace_id) in ('owner', 'operator'));

create policy external_identifiers_update on public.external_identifiers
  for update to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'))
  with check (app.member_role(workspace_id) in ('owner', 'operator'));

-- source_crosswalks --------------------------------------------------------------
-- Members read every state (candidate/confirmed/rejected/superseded) so the
-- review UI can show history. Operators and owners create candidates and
-- perform review transitions; viewers cannot, which is what blocks confirm,
-- reject, and supersede for them.
--
-- The WITH CHECK on update additionally pins review attribution to the acting
-- user: an operator cannot record a decision under another reviewer's name.
-- Legal state transitions themselves are enforced by the migration 7 triggers.
create policy source_crosswalks_select on public.source_crosswalks
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy source_crosswalks_insert on public.source_crosswalks
  for insert to authenticated
  with check (app.member_role(workspace_id) in ('owner', 'operator'));

create policy source_crosswalks_update on public.source_crosswalks
  for update to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'))
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and (reviewed_by is null or reviewed_by = (select auth.uid()))
  );

-- audit_events (APPEND-ONLY) ------------------------------------------------------
-- Members read the history. Operators and owners append. The actor must be the
-- acting user (or NULL for a genuinely unattended process running as neither).
-- No update policy and no delete policy exist.
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy audit_events_insert on public.audit_events
  for insert to authenticated
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and actor_user_id = (select auth.uid())
  );

-- data_quality_issues ---------------------------------------------------------------
-- Members read. Operators and owners open issues during ingest and resolve
-- them afterwards; the resolver must be the acting user. Viewers cannot
-- insert or update, which is what blocks issue resolution for them.
create policy data_quality_issues_select on public.data_quality_issues
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy data_quality_issues_insert on public.data_quality_issues
  for insert to authenticated
  with check (app.member_role(workspace_id) in ('owner', 'operator'));

create policy data_quality_issues_update on public.data_quality_issues
  for update to authenticated
  using (app.member_role(workspace_id) in ('owner', 'operator'))
  with check (
    app.member_role(workspace_id) in ('owner', 'operator')
    and (resolved_by is null or resolved_by = (select auth.uid()))
  );

-- No delete policy: issues are retained with their raw payload permanently.

insert into public.schema_migrations_log (migration_name)
values ('20260719000800_provenance_rls');
