-- Stabilization — the Daily Workbench's queues must open the SAME set of
-- records in Current Inventory that the workbench counted.
--
-- "Needs location" was computed in the browser, after a capped page of rows had
-- already been fetched: the workbench could report 240 records needing a
-- location while Current Inventory showed only the ones that happened to fall
-- inside the first page. The predicate already exists in
-- inventory_work_queue; this puts the same expression on the two overview
-- views so the filter runs in the database, over the whole workspace, exactly
-- once and in exactly one place.
--
-- Both views stay SECURITY INVOKER: each underlying table's RLS is still
-- re-checked for the querying role, so this widens no one's visibility. Adding
-- a derived column changes no stored data and no authorization.

drop view if exists public.inventory_item_overview;

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
  coalesce(i.location_id, l.location_id) as location_id,
  loc.public_id as location_public_id,
  loc.location_code,
  loc.display_name as location_display_name,
  loc.retired_at as location_retired_at,
  -- Identical to inventory_work_queue's item branch: no location at all, or a
  -- location that has since been retired. A retired location is not a place
  -- the operator can go and find the thing.
  (coalesce(i.location_id, l.location_id) is null
    or loc.retired_at is not null) as needs_location,
  sk.id as sku_id,
  sk.public_id as sku_public_id,
  sk.business_vertical,
  p.id as product_id,
  p.public_id as product_public_id,
  p.display_name as product_display_name,
  tsa.numeric_grade,
  tsa.grade_designation,
  coalesce(tsa.condition_or_quality, fsa.condition_or_quality, osa.condition_or_quality) as condition_or_quality,
  coalesce(tsa.product_format, osa.variant_label) as product_format,
  fsa.shoe_size,
  fsa.size_system,
  osa.size_label,
  (select count(*) from public.inventory_media m where m.item_id = i.id) as media_count,
  (select m.storage_path from public.inventory_media m
     where m.item_id = i.id order by m.is_primary desc, m.sort_order, m.created_at limit 1) as primary_media_path
from public.inventory_items i
join public.inventory_lots l on l.id = i.lot_id
left join public.storage_locations loc on loc.id = coalesce(i.location_id, l.location_id)
join public.sellable_skus sk on sk.id = i.sku_id
join public.product_catalog p on p.id = sk.product_id
left join public.tcg_sku_attributes tsa on tsa.sku_id = sk.id
left join public.footwear_sku_attributes fsa on fsa.sku_id = sk.id
left join public.other_sku_attributes osa on osa.sku_id = sk.id;

revoke all on public.inventory_item_overview from public, anon;
grant select on public.inventory_item_overview to authenticated;

drop view if exists public.inventory_lot_overview;

create view public.inventory_lot_overview
with (security_invoker = true) as
select
  l.id as lot_id,
  l.workspace_id,
  l.public_id as lot_public_id,
  l.tracking_mode,
  l.quantity,
  l.created_at as lot_created_at,
  l.location_id,
  loc.public_id as location_public_id,
  loc.location_code,
  loc.display_name as location_display_name,
  loc.retired_at as location_retired_at,
  (l.location_id is null or loc.retired_at is not null) as needs_location,
  sk.id as sku_id,
  sk.public_id as sku_public_id,
  sk.business_vertical,
  p.id as product_id,
  p.public_id as product_public_id,
  p.display_name as product_display_name,
  coalesce(tsa.condition_or_quality, fsa.condition_or_quality, osa.condition_or_quality) as condition_or_quality,
  tsa.product_format,
  tsa.seal_or_packaging_condition,
  osa.size_label,
  fsa.shoe_size,
  (select count(*) from public.inventory_items it where it.lot_id = l.id) as serialized_child_count,
  (select count(*) from public.inventory_media m where m.lot_id = l.id) as media_count,
  (select m.storage_path from public.inventory_media m
     where m.lot_id = l.id order by m.is_primary desc, m.sort_order, m.created_at limit 1) as primary_media_path
from public.inventory_lots l
left join public.storage_locations loc on loc.id = l.location_id
join public.sellable_skus sk on sk.id = l.sku_id
join public.product_catalog p on p.id = sk.product_id
left join public.tcg_sku_attributes tsa on tsa.sku_id = sk.id
left join public.footwear_sku_attributes fsa on fsa.sku_id = sk.id
left join public.other_sku_attributes osa on osa.sku_id = sk.id;

revoke all on public.inventory_lot_overview from public, anon;
grant select on public.inventory_lot_overview to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260728000700_read_model_needs_location');
