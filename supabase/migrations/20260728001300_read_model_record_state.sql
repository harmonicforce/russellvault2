-- Operational completion — a superseded or voided record must stop being
-- counted as stock, without disappearing.
--
-- Same rule the absorbed-lot change established in 20260728001100, now applied
-- to serialized units: retired records leave the record stream Current
-- Inventory pages, because they are not on the shelf; they stay fully readable
-- through the item and lot overviews, because their history, photos and
-- identifiers are still evidence and their detail pages still have to resolve.
--
-- The correction link is exposed on both grains so each record's page can show
-- the chain in both directions: what replaced this, and what this replaced.

drop view if exists public.inventory_record_overview;
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
  i.item_state,
  i.superseded_by_item_id,
  replacement.public_id as superseded_by_public_id,
  i.void_reason,
  (i.item_state = 'active') as is_available,
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
  (nullif(btrim(coalesce(tsa.condition_or_quality, fsa.condition_or_quality,
                         osa.condition_or_quality, '')), '') is null
   and nullif(btrim(coalesce(tsa.numeric_grade, '')), '') is null) as needs_condition_details,
  (select max(mv.moved_at) from public.inventory_movements mv
     where mv.item_id = i.id) as last_moved_at,
  (select count(*) from public.inventory_correction_requests c
     where c.item_id = i.id and c.state in ('open', 'approved')) as open_correction_count,
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
left join public.inventory_items replacement on replacement.id = i.superseded_by_item_id
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
  l.lot_state,
  l.superseded_by_lot_id,
  replacement.public_id as superseded_by_public_id,
  l.void_reason,
  l.created_at as lot_created_at,
  l.location_id,
  loc.public_id as location_public_id,
  loc.location_code,
  loc.display_name as location_display_name,
  loc.retired_at as location_retired_at,
  (l.location_id is null or loc.retired_at is not null) as needs_location,
  (l.lot_state = 'active' and l.quantity > 0) as is_available,
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
  (select count(*) from public.inventory_correction_requests c
     where c.lot_id = l.id and c.state in ('open', 'approved')) as open_correction_count,
  (select count(*) from public.inventory_items it
     where it.lot_id = l.id and it.item_state = 'active') as serialized_child_count,
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
left join public.inventory_lots replacement on replacement.id = l.superseded_by_lot_id
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
  o.item_state::text as record_state,
  o.is_available,
  o.open_correction_count,
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
-- Superseded and voided units are history, not stock.
where o.item_state = 'active'
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
  o.lot_state::text as record_state,
  o.is_available,
  o.open_correction_count,
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
where o.tracking_mode = 'lot_managed'
  and o.lot_state = 'active';

revoke all on public.inventory_record_overview from public, anon;
grant select on public.inventory_record_overview to authenticated;

-- Corrections, joined to the records they are about, so a queue can show what
-- the operator needs without a second round trip.
create view public.inventory_correction_overview
with (security_invoker = true) as
select
  c.id,
  c.workspace_id,
  c.public_id,
  c.subject_kind,
  coalesce(c.item_id, c.lot_id) as subject_id,
  coalesce(i.public_id, l.public_id) as subject_public_id,
  coalesce(ip.display_name, lp.display_name) as subject_display_name,
  c.issue_type,
  c.explanation,
  c.proposed_values,
  c.state,
  c.requested_at,
  c.reviewed_at,
  c.resolution_note,
  coalesce(c.replacement_item_id, c.replacement_lot_id) as replacement_id,
  coalesce(ri.public_id, rl.public_id) as replacement_public_id
from public.inventory_correction_requests c
left join public.inventory_items i on i.id = c.item_id
left join public.sellable_skus isk on isk.id = i.sku_id
left join public.product_catalog ip on ip.id = isk.product_id
left join public.inventory_lots l on l.id = c.lot_id
left join public.sellable_skus lsk on lsk.id = l.sku_id
left join public.product_catalog lp on lp.id = lsk.product_id
left join public.inventory_items ri on ri.id = c.replacement_item_id
left join public.inventory_lots rl on rl.id = c.replacement_lot_id;

revoke all on public.inventory_correction_overview from public, anon;
grant select on public.inventory_correction_overview to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260728001300_read_model_record_state');
