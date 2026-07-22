-- Phase 4 acquisition hierarchy — migration 3: row-level security.
--
-- Same read-only-table-access model as Phase 3 migration 8: `authenticated`
-- holds SELECT and nothing else on every acquisition table. Every write goes
-- through a SECURITY DEFINER function in migrations 4 and 5, each of which
-- authorizes internally as part of its lookup. A PostgREST-shaped request or
-- any other direct DML from an authenticated client cannot:
--   * register a channel or supplier, or create/reassign a supplier alias;
--   * open, stage into, or commit an acquisition import job;
--   * fabricate an order, lot, lot-line placement, line item, cost component,
--     or cost allocation;
--   * confirm or reverse a cost allocation;
--   * fabricate audit history.
--
-- Role model, identical to Phase 3:
--   anon      — NO grants and NO policies.
--   non-member— app.member_role(workspace_id) is NULL. Sees nothing.
--   viewer    — reads the whole acquisition review surface in own workspaces.
--   operator  — reads the same, and may run the governed preview/commit and
--               allocation RPCs.
--   owner     — as operator, plus the owner-only channel registry RPC.

alter table public.acquisition_import_jobs enable row level security;
alter table public.channels enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_aliases enable row level security;
alter table public.acquisition_orders enable row level security;
alter table public.acquisition_lots enable row level security;
alter table public.acquisition_lot_lines enable row level security;
alter table public.acquisition_line_items enable row level security;
alter table public.acquisition_cost_components enable row level security;
alter table public.acquisition_cost_allocations enable row level security;

-- Strip everything, then grant back SELECT only.
revoke all on table
  public.acquisition_import_jobs, public.channels, public.suppliers,
  public.supplier_aliases, public.acquisition_orders, public.acquisition_lots,
  public.acquisition_lot_lines, public.acquisition_line_items,
  public.acquisition_cost_components, public.acquisition_cost_allocations
from public, anon, authenticated;

-- service_role too — see Phase 3 migration 8 for the full rationale: a hosted
-- Supabase project's DEFAULT PRIVILEGES would otherwise silently grant
-- service_role write access (and service_role carries BYPASSRLS) to every one
-- of these new tables. Nothing in this application uses a service-role key,
-- so this costs nothing. Guarded because the local PostgreSQL shim may not
-- define the role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table
      public.acquisition_import_jobs, public.channels, public.suppliers,
      public.supplier_aliases, public.acquisition_orders, public.acquisition_lots,
      public.acquisition_lot_lines, public.acquisition_line_items,
      public.acquisition_cost_components, public.acquisition_cost_allocations
    from service_role';
  end if;
end $$;

grant select on table
  public.acquisition_import_jobs, public.channels, public.suppliers,
  public.supplier_aliases, public.acquisition_orders, public.acquisition_lots,
  public.acquisition_lot_lines, public.acquisition_line_items,
  public.acquisition_cost_components, public.acquisition_cost_allocations
to authenticated;

create policy acquisition_import_jobs_select on public.acquisition_import_jobs
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy channels_select on public.channels
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy suppliers_select on public.suppliers
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy supplier_aliases_select on public.supplier_aliases
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy acquisition_orders_select on public.acquisition_orders
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy acquisition_lots_select on public.acquisition_lots
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy acquisition_lot_lines_select on public.acquisition_lot_lines
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy acquisition_line_items_select on public.acquisition_line_items
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy acquisition_cost_components_select on public.acquisition_cost_components
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy acquisition_cost_allocations_select on public.acquisition_cost_allocations
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

insert into public.schema_migrations_log (migration_name)
values ('20260720000300_acquisition_rls');
