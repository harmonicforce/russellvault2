-- NEXT PHASE — migration: first-run setup tracking + a read-only inventory
-- overview view.
--
-- Two small, additive changes, nothing rebuilt:
--   1. workspaces.setup_completed_at tracks whether a workspace has finished
--      the first-run setup flow (name already known, optional SKU prefix,
--      first storage location). Existing RLS (owners update their own
--      workspace) already covers writing this column — no policy changes.
--   2. inventory_item_overview is a SECURITY INVOKER view joining
--      item -> lot -> sku -> product -> location for the new Current
--      Inventory search/filter surface. security_invoker means Postgres
--      re-checks each underlying table's own row-level security for the
--      querying role, so this view can never expose a row its caller could
--      not already see directly. It creates no new authorization model.

alter table public.workspaces
  add column setup_completed_at timestamptz;

create view public.inventory_item_overview
with (security_invoker = true) as
select
  i.id as item_id,
  i.workspace_id,
  i.public_id as item_public_id,
  i.scan_sku,
  i.grading_company,
  i.certificate_number,
  i.serial_number,
  i.created_at as item_created_at,
  l.id as lot_id,
  l.public_id as lot_public_id,
  l.tracking_mode,
  l.quantity as lot_quantity,
  l.location_id,
  loc.public_id as location_public_id,
  loc.location_code,
  loc.display_name as location_display_name,
  loc.retired_at as location_retired_at,
  sk.id as sku_id,
  sk.public_id as sku_public_id,
  sk.business_vertical,
  p.id as product_id,
  p.public_id as product_public_id,
  p.display_name as product_display_name
from public.inventory_items i
join public.inventory_lots l on l.id = i.lot_id
left join public.storage_locations loc on loc.id = l.location_id
join public.sellable_skus sk on sk.id = i.sku_id
join public.product_catalog p on p.id = sk.product_id;

revoke all on public.inventory_item_overview from public, anon;
grant select on public.inventory_item_overview to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260728000100_workspace_setup_and_inventory_overview');
