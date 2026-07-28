-- Operational completion — a lot that is no longer stock must stop being
-- counted as stock.
--
-- Merging leaves absorbed lots behind, and adjustments can take a lot to zero.
-- Neither is deleted: their movement, adjustment and (later) cost history has
-- to stay true and readable. But neither is available inventory either, and a
-- Current Inventory that keeps listing them is lying about what is on the
-- shelf.
--
-- The rule this settles:
--   * absorbed / void lots leave the record stream entirely -- the stock they
--     held now lives in the surviving lot, and listing both would double-count
--     it, exactly as listing a serialized parent beside its units would;
--   * zero-quantity ACTIVE lots stay visible and are flagged, because "this
--     lot is empty" is something the operator needs to see and act on, not
--     something to hide.
--
-- Both lots keep their own detail pages either way: inventory_lot_overview
-- still resolves every lot by id, whatever its state.

drop view if exists public.inventory_record_overview;
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
  l.created_at as lot_created_at,
  l.location_id,
  loc.public_id as location_public_id,
  loc.location_code,
  loc.display_name as location_display_name,
  loc.retired_at as location_retired_at,
  (l.location_id is null or loc.retired_at is not null) as needs_location,
  -- What "can this be sold or moved" means, in one place.
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
  'active'::public.inventory_lot_state as lot_state,
  true as is_available,
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
  o.lot_state,
  o.is_available,
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
  -- Absorbed and voided lots are history, not stock.
  and o.lot_state = 'active';

revoke all on public.inventory_record_overview from public, anon;
grant select on public.inventory_record_overview to authenticated;

-- Lineage, for a lot's own page ------------------------------------------------
-- Both directions in one readable shape: what this lot was split from or
-- merged into, and what was split off it or merged into it.
create view public.inventory_lot_lineage_view
with (security_invoker = true) as
select
  ln.id,
  ln.workspace_id,
  ln.public_id,
  ln.event_kind,
  ln.quantity,
  ln.note,
  ln.created_at,
  ln.parent_lot_id,
  parent.public_id as parent_public_id,
  ln.child_lot_id,
  child.public_id as child_public_id
from public.inventory_lot_lineage ln
join public.inventory_lots parent on parent.id = ln.parent_lot_id
join public.inventory_lots child on child.id = ln.child_lot_id;

revoke all on public.inventory_lot_lineage_view from public, anon;
grant select on public.inventory_lot_lineage_view to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260728001100_read_model_lot_state');
