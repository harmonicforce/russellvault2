-- Phase 5 identity core — migration 3: row-level security and grants.
--
-- Same read-only-table-access model as Phases 3–4: `authenticated` holds SELECT
-- and nothing else on every Phase 5 table. Every write goes through a SECURITY
-- DEFINER function in migration 4, which authorizes internally. anon has no
-- grants and no policies; a non-member sees nothing; viewers/operators/owners
-- read the identity surface in their own workspaces only.

alter table public.product_catalog enable row level security;
alter table public.sellable_skus enable row level security;
alter table public.tcg_product_attributes enable row level security;
alter table public.tcg_sku_attributes enable row level security;
alter table public.footwear_product_attributes enable row level security;
alter table public.footwear_sku_attributes enable row level security;
alter table public.storage_locations enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_items enable row level security;

-- Strip everything, then grant back SELECT only.
revoke all on table
  public.product_catalog, public.sellable_skus, public.tcg_product_attributes,
  public.tcg_sku_attributes, public.footwear_product_attributes,
  public.footwear_sku_attributes, public.storage_locations,
  public.inventory_lots, public.inventory_items
from public, anon, authenticated;
revoke all on public.inventory_location_balances from public, anon, authenticated;

-- service_role too (carries BYPASSRLS and hosted default privileges); nothing
-- in this app uses a service-role key. Guarded because the local shim may not
-- define the role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table
      public.product_catalog, public.sellable_skus, public.tcg_product_attributes,
      public.tcg_sku_attributes, public.footwear_product_attributes,
      public.footwear_sku_attributes, public.storage_locations,
      public.inventory_lots, public.inventory_items
    from service_role';
    execute 'revoke all on public.inventory_location_balances from service_role';
  end if;
end $$;

grant select on table
  public.product_catalog, public.sellable_skus, public.tcg_product_attributes,
  public.tcg_sku_attributes, public.footwear_product_attributes,
  public.footwear_sku_attributes, public.storage_locations,
  public.inventory_lots, public.inventory_items
to authenticated;

-- The projection view must honor the underlying tables' RLS rather than run
-- with the view owner's privileges (which would leak across workspaces).
alter view public.inventory_location_balances set (security_invoker = true);
grant select on public.inventory_location_balances to authenticated;

-- SELECT policies: any member of the workspace may read.
create policy product_catalog_select on public.product_catalog
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy sellable_skus_select on public.sellable_skus
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy tcg_product_attributes_select on public.tcg_product_attributes
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy tcg_sku_attributes_select on public.tcg_sku_attributes
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy footwear_product_attributes_select on public.footwear_product_attributes
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy footwear_sku_attributes_select on public.footwear_sku_attributes
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy storage_locations_select on public.storage_locations
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy inventory_lots_select on public.inventory_lots
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy inventory_items_select on public.inventory_items
  for select to authenticated using (app.member_role(workspace_id) is not null);

insert into public.schema_migrations_log (migration_name)
values ('20260721000300_inventory_identity_rls');
