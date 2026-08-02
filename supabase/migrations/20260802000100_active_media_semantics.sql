-- Repair: one authoritative "no active photograph" fact.
--
-- inventory_work_queue.needs_photos already asked the right question --
-- does a LIVE photograph exist -- but Current Inventory's needsPhotos filter
-- asked inventory_record_overview for `media_count = 0`, and media_count
-- counts every lifecycle. A record whose only photograph was reserved and
-- never committed, or was deleted, therefore appeared in the dashboard's work
-- queue and then vanished from the filtered list that queue linked to. The
-- operator followed a task to a page that did not contain it.
--
-- media_count is deliberately NOT redefined: it is a display fact with other
-- consumers, and silently changing what an existing column means is how the
-- next divergence starts. Two new columns are appended instead --
-- active_media_count and needs_photos -- and every operational consumer moves
-- to needs_photos.
--
-- primary_media_path IS corrected in place: a soft-deleted photograph must
-- never be a record's thumbnail. Same column, same type, so this stays a
-- create-or-replace.
--
-- Additive throughout. Columns are appended after search_text because
-- create-or-replace-view may add columns only at the end; nothing is dropped,
-- renamed, or reordered, so no dependent view needs a cascade.

create or replace view public.inventory_item_overview
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
     where m.item_id = i.id and m.lifecycle = 'active'
     order by m.is_primary desc, m.sort_order, m.created_at limit 1) as primary_media_path,
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
  )) as search_text,
  -- Live photographs only. media_count above is retained unchanged for
  -- display and counts every lifecycle; this is the operational fact.
  (select count(*) from public.inventory_media m
    where m.item_id = i.id and m.lifecycle = 'active') as active_media_count,
  -- THE authoritative no-active-photo predicate, written once per grain and
  -- identical to inventory_work_queue.needs_photos -- INCLUDING its current-
  -- stock scope. Without that scope the overviews, which deliberately retain
  -- historical records so detail pages resolve, would offer a depleted lot or
  -- a retired item as photo work the dashboard never counted.
  (i.item_state = 'active'
   and not exists (select 1 from public.inventory_media m
                    where m.item_id = i.id and m.lifecycle = 'active')) as needs_photos
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

create or replace view public.inventory_lot_overview
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
     where m.lot_id = l.id and m.lifecycle = 'active'
     order by m.is_primary desc, m.sort_order, m.created_at limit 1) as primary_media_path,
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
  )) as search_text,
  -- Live photographs only. media_count above is retained unchanged for
  -- display and counts every lifecycle; this is the operational fact.
  (select count(*) from public.inventory_media m
    where m.lot_id = l.id and m.lifecycle = 'active') as active_media_count,
  -- THE authoritative no-active-photo predicate, written once per grain and
  -- identical to inventory_work_queue.needs_photos -- INCLUDING its current-
  -- stock scope. Without that scope the overviews, which deliberately retain
  -- historical records so detail pages resolve, would offer a depleted lot or
  -- a retired item as photo work the dashboard never counted.
  (l.tracking_mode = 'lot_managed' and l.lot_state = 'active' and l.quantity > 0
   and not exists (select 1 from public.inventory_media m
                    where m.lot_id = l.id and m.lifecycle = 'active')) as needs_photos
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

create or replace view public.inventory_record_overview
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
  o.search_text,
  o.active_media_count,
  o.needs_photos
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
  o.search_text,
  o.active_media_count,
  o.needs_photos
from public.inventory_lot_overview o
where o.tracking_mode = 'lot_managed'
  and o.lot_state = 'active';

insert into public.schema_migrations_log (migration_name)
values ('20260802000100_active_media_semantics');
