-- Multi-category intake — migration 4: read models for the owner-facing
-- inventory, lot, and workbench surfaces.
--
-- All three are SECURITY INVOKER views: Postgres re-checks each underlying
-- table's own RLS for the querying role, so a view can never widen what its
-- caller could already read directly. No new authorization model.
--
--   inventory_item_overview  — rebuilt to read the item's OWN location
--                              (migration 2 gave serialized items their own),
--                              plus category-specific facts and media counts.
--   inventory_lot_overview   — the equivalent surface for quantity-tracked
--                              inventory, which had no read model at all.
--   inventory_work_queue     — the "what needs attention" projection behind
--                              the Daily Workbench: needs_location and
--                              needs_photos per subject.
--
-- Applied to the live project; see the repository migration log.

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

create view public.inventory_work_queue
with (security_invoker = true) as
select
  'item'::text as subject_kind,
  i.id as subject_id,
  i.workspace_id,
  i.public_id as subject_public_id,
  p.display_name as display_name,
  i.created_at,
  (coalesce(i.location_id, l.location_id) is null
    or loc.retired_at is not null) as needs_location,
  ((select count(*) from public.inventory_media m where m.item_id = i.id) = 0) as needs_photos
from public.inventory_items i
join public.inventory_lots l on l.id = i.lot_id
left join public.storage_locations loc on loc.id = coalesce(i.location_id, l.location_id)
join public.sellable_skus sk on sk.id = i.sku_id
join public.product_catalog p on p.id = sk.product_id
union all
select
  'lot'::text as subject_kind,
  l.id as subject_id,
  l.workspace_id,
  l.public_id as subject_public_id,
  p.display_name as display_name,
  l.created_at,
  (l.location_id is null or loc.retired_at is not null) as needs_location,
  ((select count(*) from public.inventory_media m where m.lot_id = l.id) = 0) as needs_photos
from public.inventory_lots l
left join public.storage_locations loc on loc.id = l.location_id
join public.sellable_skus sk on sk.id = l.sku_id
join public.product_catalog p on p.id = sk.product_id
where l.tracking_mode = 'lot_managed';

revoke all on public.inventory_work_queue from public, anon;
grant select on public.inventory_work_queue to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260728000500_inventory_read_models');
