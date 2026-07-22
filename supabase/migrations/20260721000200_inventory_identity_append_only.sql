-- Phase 5 identity core — migration 2: append-only immutability + location acyclicity.
--
-- Reuses app.forbid_update_delete and app.forbid_column_change (Phase 3
-- migration 6). The identity tables are correction-by-new-row, not update-in-
-- place: products, SKUs, their subtype rows, lots and serialized items are
-- fully append-only, so every governed public id, the SKU fingerprint, and the
-- opaque unit scan_sku are immutable once written. Storage locations keep a
-- narrow governed mutation surface (re-parent / retire) but their identity
-- columns (id, workspace, public id, location_code) are frozen, and their
-- parent edges are kept acyclic.

-- Products, SKUs, and their subtype rows: append-only ----------------------------------
create trigger product_catalog_append_only
  before update or delete on public.product_catalog
  for each row execute function app.forbid_update_delete();
create trigger product_catalog_append_only_truncate
  before truncate on public.product_catalog
  for each statement execute function app.forbid_update_delete();

create trigger sellable_skus_append_only
  before update or delete on public.sellable_skus
  for each row execute function app.forbid_update_delete();
create trigger sellable_skus_append_only_truncate
  before truncate on public.sellable_skus
  for each statement execute function app.forbid_update_delete();

create trigger tcg_product_attributes_append_only
  before update or delete on public.tcg_product_attributes
  for each row execute function app.forbid_update_delete();
create trigger tcg_sku_attributes_append_only
  before update or delete on public.tcg_sku_attributes
  for each row execute function app.forbid_update_delete();
create trigger footwear_product_attributes_append_only
  before update or delete on public.footwear_product_attributes
  for each row execute function app.forbid_update_delete();
create trigger footwear_sku_attributes_append_only
  before update or delete on public.footwear_sku_attributes
  for each row execute function app.forbid_update_delete();

-- Lots and serialized items: append-only -----------------------------------------------
create trigger inventory_lots_append_only
  before update or delete on public.inventory_lots
  for each row execute function app.forbid_update_delete();
create trigger inventory_lots_append_only_truncate
  before truncate on public.inventory_lots
  for each statement execute function app.forbid_update_delete();

create trigger inventory_items_append_only
  before update or delete on public.inventory_items
  for each row execute function app.forbid_update_delete();
create trigger inventory_items_append_only_truncate
  before truncate on public.inventory_items
  for each statement execute function app.forbid_update_delete();

-- Storage locations: identity columns frozen, delete/truncate forbidden -----------------
-- parent_id, display_name, retired_at and updated_at may change (governed
-- re-parent / retire); id, workspace_id, public_id, location_code, and the
-- creation stamps never do. A retired code therefore stays present forever and
-- can never be reused (the workspace-unique location_code constraint sees it).
create trigger storage_locations_identity_immutable
  before update on public.storage_locations
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'location_code', 'created_by_process', 'created_at'
  );
create trigger storage_locations_no_delete
  before delete on public.storage_locations
  for each row execute function app.forbid_update_delete();
create trigger storage_locations_no_truncate
  before truncate on public.storage_locations
  for each statement execute function app.forbid_update_delete();

-- Location acyclicity ------------------------------------------------------------------
-- Reject self-parenting (also a table check) and any indirect cycle: walking up
-- from the new parent must never reach the row being written.
create function app.enforce_location_acyclic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cursor uuid := new.parent_id;
  v_steps integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'a storage location cannot be its own parent'
      using errcode = 'check_violation';
  end if;
  -- Walk up the ancestry. A well-formed tree terminates at a NULL parent; a
  -- cycle would revisit new.id (or loop past the workspace's location count).
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'storage location parenting would create a cycle'
        using errcode = 'check_violation';
    end if;
    v_steps := v_steps + 1;
    if v_steps > 10000 then
      raise exception 'storage location ancestry is too deep or cyclic'
        using errcode = 'check_violation';
    end if;
    select parent_id into v_cursor
    from public.storage_locations
    where id = v_cursor and workspace_id = new.workspace_id;
  end loop;
  return new;
end
$$;
revoke all on function app.enforce_location_acyclic() from public;

create trigger storage_locations_acyclic
  before insert or update on public.storage_locations
  for each row execute function app.enforce_location_acyclic();

insert into public.schema_migrations_log (migration_name)
values ('20260721000200_inventory_identity_append_only');
