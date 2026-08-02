-- Exact, current-stock dashboard metrics and active-media work semantics.

create or replace function public.get_operations_inventory_health(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'serializedUnits', count(*) filter (where o.record_kind = 'item'),
    'lotManagedRecords', count(*) filter (where o.record_kind = 'lot' and o.tracking_mode = 'lot_managed'),
    'lotManagedUnits', coalesce(sum(o.quantity) filter (where o.record_kind = 'lot' and o.tracking_mode = 'lot_managed'), 0),
    'withoutLocation', count(*) filter (where o.needs_location)
  ) into v_result
  from public.inventory_record_overview o
  where o.workspace_id = p_workspace_id
    and o.is_available
    and not (o.record_kind = 'lot' and o.tracking_mode = 'serialized');
  return v_result;
end
$$;

revoke all on function public.get_operations_inventory_health(uuid) from public, anon;
grant execute on function public.get_operations_inventory_health(uuid) to authenticated;

create or replace view public.inventory_work_queue
with (security_invoker = true) as
select
  'item'::text as subject_kind, i.id as subject_id, i.workspace_id,
  i.public_id as subject_public_id, p.display_name, i.created_at,
  (coalesce(i.location_id, l.location_id) is null or loc.retired_at is not null) as needs_location,
  not exists (select 1 from public.inventory_media m where m.item_id = i.id and m.lifecycle = 'active') as needs_photos
from public.inventory_items i
join public.inventory_lots l on l.id = i.lot_id
left join public.storage_locations loc on loc.id = coalesce(i.location_id, l.location_id)
join public.sellable_skus sk on sk.id = i.sku_id
join public.product_catalog p on p.id = sk.product_id
where i.item_state = 'active'
union all
select
  'lot'::text, l.id, l.workspace_id, l.public_id, p.display_name, l.created_at,
  (l.location_id is null or loc.retired_at is not null),
  not exists (select 1 from public.inventory_media m where m.lot_id = l.id and m.lifecycle = 'active')
from public.inventory_lots l
left join public.storage_locations loc on loc.id = l.location_id
join public.sellable_skus sk on sk.id = l.sku_id
join public.product_catalog p on p.id = sk.product_id
where l.tracking_mode = 'lot_managed' and l.lot_state = 'active' and l.quantity > 0;

revoke all on public.inventory_work_queue from public, anon;
grant select on public.inventory_work_queue to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260801000900_operations_dashboard_contracts');
