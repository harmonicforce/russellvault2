-- Operational completion — make the read models answer the questions the
-- operator actually asks at scale.
--
-- Current Inventory could only page 100 rows and then ask the operator to
-- narrow the search, sorting happened over whichever page happened to be in
-- the browser, and search reached six columns while intake collects roughly
-- thirty facts. All three are the same defect: the read model did not carry
-- enough for the database to answer, so the browser tried to finish the job
-- over a truncated sample and got a truncated answer.
--
-- This adds four derived columns to both overviews. Nothing here stores new
-- data and nothing widens visibility -- both views stay SECURITY INVOKER, so
-- every underlying table's RLS is still re-checked for the querying role.
--
--   inventory_subtype        the exact category (migration 000800)
--   needs_condition_details  no condition or grade recorded anywhere
--   last_moved_at            when this record last physically moved
--   search_text              every searchable identity fact, normalized
--
-- search_text is one lowercase haystack rather than thirty exposed columns.
-- The alternative -- a thirty-way OR across individually exposed columns,
-- assembled as a query string in the browser -- is both slower and a much
-- larger surface for filter-injection mistakes. Exact identifier matching is
-- NOT folded into this: identifiers keep their own columns and are matched
-- exactly, so a certificate number scan stays the highest-confidence result
-- and never loses to a substring hit somewhere in a product name.

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
  (coalesce(i.location_id, l.location_id) is null
    or loc.retired_at is not null) as needs_location,
  sk.id as sku_id,
  sk.public_id as sku_public_id,
  sk.business_vertical,
  sk.inventory_subtype,
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
  -- A unit with neither a recorded condition nor a grade cannot be listed
  -- honestly, so it is a work queue, not a display detail.
  (nullif(btrim(coalesce(tsa.condition_or_quality, fsa.condition_or_quality,
                         osa.condition_or_quality, '')), '') is null
   and nullif(btrim(coalesce(tsa.numeric_grade, '')), '') is null) as needs_condition_details,
  (select max(mv.moved_at) from public.inventory_movements mv
     where mv.item_id = i.id) as last_moved_at,
  (select count(*) from public.inventory_media m where m.item_id = i.id) as media_count,
  (select m.storage_path from public.inventory_media m
     where m.item_id = i.id order by m.is_primary desc, m.sort_order, m.created_at limit 1) as primary_media_path,
  lower(concat_ws(' ',
    p.display_name, p.public_id, i.public_id, l.public_id, sk.public_id, i.scan_sku,
    i.certificate_number, i.serial_number, i.grading_company,
    loc.location_code, loc.display_name,
    tpa.set_name, tpa.card_number, tpa.featured_subject, tpa.language,
    tsa.numeric_grade, tsa.grade_designation, tsa.product_format,
    tsa.variant_or_printing, tsa.seal_or_packaging_condition, tsa.condition_or_quality,
    fpa.silhouette, fpa.colorway_name, fpa.style_code,
    fsa.shoe_size, fsa.apparel_size, fsa.size_system, fsa.color,
    fsa.box_status, fsa.condition_or_quality,
    opa.brand, opa.product_line, opa.item_category, opa.model_number,
    osa.size_label, osa.color, osa.variant_label, osa.condition_or_quality
  )) as search_text
from public.inventory_items i
join public.inventory_lots l on l.id = i.lot_id
left join public.storage_locations loc on loc.id = coalesce(i.location_id, l.location_id)
join public.sellable_skus sk on sk.id = i.sku_id
join public.product_catalog p on p.id = sk.product_id
left join public.tcg_product_attributes tpa on tpa.product_id = p.id
left join public.footwear_product_attributes fpa on fpa.product_id = p.id
left join public.other_product_attributes opa on opa.product_id = p.id
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
  sk.inventory_subtype,
  p.id as product_id,
  p.public_id as product_public_id,
  p.display_name as product_display_name,
  coalesce(tsa.condition_or_quality, fsa.condition_or_quality, osa.condition_or_quality) as condition_or_quality,
  tsa.product_format,
  tsa.seal_or_packaging_condition,
  osa.size_label,
  fsa.shoe_size,
  (nullif(btrim(coalesce(tsa.condition_or_quality, fsa.condition_or_quality,
                         osa.condition_or_quality, '')), '') is null
   and nullif(btrim(coalesce(tsa.seal_or_packaging_condition, '')), '') is null)
    as needs_condition_details,
  (select max(mv.moved_at) from public.inventory_movements mv
     where mv.lot_id = l.id) as last_moved_at,
  (select count(*) from public.inventory_items it where it.lot_id = l.id) as serialized_child_count,
  (select count(*) from public.inventory_media m where m.lot_id = l.id) as media_count,
  (select m.storage_path from public.inventory_media m
     where m.lot_id = l.id order by m.is_primary desc, m.sort_order, m.created_at limit 1) as primary_media_path,
  lower(concat_ws(' ',
    p.display_name, p.public_id, l.public_id, sk.public_id,
    loc.location_code, loc.display_name,
    tpa.set_name, tpa.card_number, tpa.featured_subject, tpa.language,
    tsa.product_format, tsa.variant_or_printing, tsa.seal_or_packaging_condition,
    tsa.condition_or_quality,
    fpa.silhouette, fpa.colorway_name, fpa.style_code,
    fsa.shoe_size, fsa.apparel_size, fsa.size_system, fsa.color,
    fsa.box_status, fsa.condition_or_quality,
    opa.brand, opa.product_line, opa.item_category, opa.model_number,
    osa.size_label, osa.color, osa.variant_label, osa.condition_or_quality
  )) as search_text
from public.inventory_lots l
left join public.storage_locations loc on loc.id = l.location_id
join public.sellable_skus sk on sk.id = l.sku_id
join public.product_catalog p on p.id = sk.product_id
left join public.tcg_product_attributes tpa on tpa.product_id = p.id
left join public.footwear_product_attributes fpa on fpa.product_id = p.id
left join public.other_product_attributes opa on opa.product_id = p.id
left join public.tcg_sku_attributes tsa on tsa.sku_id = sk.id
left join public.footwear_sku_attributes fsa on fsa.sku_id = sk.id
left join public.other_sku_attributes osa on osa.sku_id = sk.id;

revoke all on public.inventory_lot_overview from public, anon;
grant select on public.inventory_lot_overview to authenticated;

-- One stream of records ------------------------------------------------------
-- Individually tracked units and quantity-managed lots are two grains of the
-- same inventory, and Current Inventory shows them together. Paging that
-- combined list from two separate queries cannot be done correctly: "the 50
-- newest records" is not "the 50 newest items" plus "the 50 newest lots", and
-- any attempt to stitch two offset windows together either drops rows at the
-- seam or re-sorts a truncated sample in the browser -- which is the bug this
-- whole migration exists to remove.
--
-- So the union happens in the database, where ORDER BY and LIMIT see every
-- row. One query answers the page, the sort, every filter, and the exact total.
--
-- A serialized lot is deliberately absent: it is represented here by its own
-- units, and including both would count the same physical stock twice. It is
-- still present in inventory_lot_overview, because its detail page needs it.
--
-- SECURITY INVOKER, like every other read model here: the underlying tables'
-- RLS is re-checked for the querying role, so this composes visibility rather
-- than widening it.
create view public.inventory_record_overview
with (security_invoker = true) as
select
  'item'::text as record_kind,
  o.item_id as record_id,
  o.workspace_id,
  o.item_public_id as record_public_id,
  o.lot_id as parent_lot_id,
  o.product_display_name,
  o.business_vertical,
  o.inventory_subtype,
  1::bigint as quantity,
  o.tracking_mode,
  -- What the operator reads in the "condition or grade" column: a graded slab
  -- shows its grade, everything else shows its condition.
  coalesce(nullif(btrim(concat_ws(' ', o.numeric_grade, o.grade_designation)), ''),
           o.condition_or_quality) as condition_or_grade,
  o.condition_or_quality,
  o.grading_company,
  o.location_id,
  o.location_code,
  o.location_display_name,
  o.location_retired_at,
  o.needs_location,
  o.needs_condition_details,
  o.scan_sku as scan_identifier,
  o.item_created_at as created_at,
  o.last_moved_at,
  o.media_count,
  o.primary_media_path,
  nullif(btrim(concat_ws(' · ', o.grading_company, o.certificate_number,
    o.serial_number, o.shoe_size, o.size_label)), '') as detail_line,
  o.search_text
from public.inventory_item_overview o
union all
select
  'lot'::text as record_kind,
  o.lot_id as record_id,
  o.workspace_id,
  o.lot_public_id as record_public_id,
  null::uuid as parent_lot_id,
  o.product_display_name,
  o.business_vertical,
  o.inventory_subtype,
  o.quantity::bigint,
  o.tracking_mode,
  o.condition_or_quality as condition_or_grade,
  o.condition_or_quality,
  null::text as grading_company,
  o.location_id,
  o.location_code,
  o.location_display_name,
  o.location_retired_at,
  o.needs_location,
  o.needs_condition_details,
  o.lot_public_id as scan_identifier,
  o.lot_created_at as created_at,
  o.last_moved_at,
  o.media_count,
  o.primary_media_path,
  nullif(btrim(concat_ws(' · ', o.product_format, o.seal_or_packaging_condition,
    o.size_label, o.shoe_size)), '') as detail_line,
  o.search_text
from public.inventory_lot_overview o
where o.tracking_mode = 'lot_managed';

revoke all on public.inventory_record_overview from public, anon;
grant select on public.inventory_record_overview to authenticated;

-- Supporting indexes ---------------------------------------------------------
-- The overviews sort and filter on these; without them "newest added" over a
-- large workspace degrades to a full scan plus sort.
create index if not exists inventory_items_workspace_created_idx
  on public.inventory_items (workspace_id, created_at desc);
create index if not exists inventory_lots_workspace_created_idx
  on public.inventory_lots (workspace_id, created_at desc);
create index if not exists inventory_movements_item_moved_idx
  on public.inventory_movements (item_id, moved_at desc);
create index if not exists inventory_movements_lot_moved_idx
  on public.inventory_movements (lot_id, moved_at desc);

insert into public.schema_migrations_log (migration_name)
values ('20260728000900_inventory_read_model_operations');
