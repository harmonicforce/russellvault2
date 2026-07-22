-- Phase 5 identity core — migration 4: governed functions.
--
-- Every write to the identity tables happens here, under SECURITY DEFINER with
-- an empty search_path and an explicit membership check. Nothing in this phase
-- implements intake, movement, counting, listing, sale, reconciliation, or cost
-- allocation — only the identity registrars and a concurrency-safe minting path
-- for opaque unit scan codes. Read access is governed by RLS (migration 3).

-- Writer authorization: operator or owner of the target workspace ----------------------
create function app.require_inventory_writer(p_workspace_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_role public.workspace_role;
begin
  v_uid := app.require_uid();
  v_role := app.member_role(p_workspace_id);
  if v_role is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  if v_role not in ('operator', 'owner') then
    raise exception 'a viewer cannot register inventory identity' using errcode = '42501';
  end if;
  return v_uid;
end
$$;
revoke all on function app.require_inventory_writer(uuid) from public;

-- Deterministic, versioned SKU fingerprint ---------------------------------------------
-- Length-prefixed canonical text over the identity-driving fields in a FIXED
-- order (governed columns, never an arbitrary jsonb bag), then SHA-256. Used
-- both when registering a SKU (from the request) and by app.compute_sku_
-- fingerprint (from stored rows); the two must agree.
create function app.dg_fld(p text)
returns text language sql immutable
set search_path = ''
as $$
  select case when p is null then '~' else octet_length(p)::text || ':' || p end
$$;
revoke all on function app.dg_fld(text) from public;

create function app.sku_fingerprint(
  p_identity_schema_version text,
  p_business_vertical text,
  p_product_canonical_key text,
  p_attrs jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(
    'SKU' || app.dg_fld(p_identity_schema_version) || app.dg_fld(p_business_vertical)
      || app.dg_fld(p_product_canonical_key)
      || case p_business_vertical
           when 'tcg' then
             'TCG'
             || app.dg_fld(p_attrs->>'condition_or_quality')
             || app.dg_fld(p_attrs->>'grading_company')
             || app.dg_fld(p_attrs->>'numeric_grade')
             || app.dg_fld(p_attrs->>'grade_designation')
             || app.dg_fld(p_attrs->>'seal_or_packaging_condition')
             || app.dg_fld(p_attrs->>'product_format')
           when 'footwear' then
             'FTW'
             || app.dg_fld(p_attrs->>'shoe_size')
             || app.dg_fld(p_attrs->>'apparel_size')
             || app.dg_fld(p_attrs->>'color')
             || app.dg_fld(p_attrs->>'condition_or_quality')
           else 'OTH'
         end,
    'UTF8')), 'hex')
$$;
revoke all on function app.sku_fingerprint(text, text, text, jsonb) from public;

-- Recompute a stored SKU's fingerprint from its persisted identity rows. Must
-- equal the value stored at registration.
create function app.compute_sku_fingerprint(p_sku_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sku public.sellable_skus%rowtype;
  v_key text;
  v_attrs jsonb;
begin
  select * into v_sku from public.sellable_skus where id = p_sku_id;
  if v_sku.id is null then
    raise exception 'sellable sku not found' using errcode = '42501';
  end if;
  select product_canonical_key into v_key
  from public.product_catalog where id = v_sku.product_id;
  if v_sku.business_vertical = 'tcg' then
    select jsonb_build_object(
      'condition_or_quality', a.condition_or_quality, 'grading_company', a.grading_company,
      'numeric_grade', a.numeric_grade, 'grade_designation', a.grade_designation,
      'seal_or_packaging_condition', a.seal_or_packaging_condition, 'product_format', a.product_format)
    into v_attrs from public.tcg_sku_attributes a where a.sku_id = p_sku_id;
  elsif v_sku.business_vertical = 'footwear' then
    select jsonb_build_object(
      'shoe_size', a.shoe_size, 'apparel_size', a.apparel_size, 'color', a.color,
      'condition_or_quality', a.condition_or_quality)
    into v_attrs from public.footwear_sku_attributes a where a.sku_id = p_sku_id;
  else
    v_attrs := '{}'::jsonb;
  end if;
  return app.sku_fingerprint(v_sku.identity_schema_version, v_sku.business_vertical::text,
    v_key, coalesce(v_attrs, '{}'::jsonb));
end
$$;
revoke all on function app.compute_sku_fingerprint(uuid) from public;

-- Concurrency-safe opaque unit scan code -----------------------------------------------
-- Non-sequential Crockford base32 (excludes I, L, O, U), unrelated to any
-- sequence or row count. The workspace-unique scan_sku constraint is the final
-- arbiter: on a collision the INSERT (in mint_serialized_item) retries with a
-- fresh code, so concurrent minting can never duplicate.
create function app.gen_scan_sku()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text := '';
  i integer;
begin
  for i in 1..7 loop
    v_code := v_code || substr(v_alpha, 1 + floor(random() * 32)::int, 1);
  end loop;
  return 'RV-' || v_code;
end
$$;
revoke all on function app.gen_scan_sku() from public;

-- Product registrar: find-or-create by workspace-unique canonical key ------------------
create function public.register_product(
  p_workspace_id uuid,
  p_business_vertical text,
  p_display_name text,
  p_product_canonical_key text,
  p_attrs jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_existing public.product_catalog%rowtype;
  v_id uuid;
  v_public text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  if p_business_vertical not in ('tcg', 'footwear', 'other') then
    raise exception 'unknown business vertical %', p_business_vertical using errcode = '22023';
  end if;

  select * into v_existing from public.product_catalog
  where workspace_id = p_workspace_id and product_canonical_key = p_product_canonical_key;
  if v_existing.id is not null then
    if v_existing.business_vertical::text <> p_business_vertical then
      raise exception 'product % already exists with a different vertical', p_product_canonical_key
        using errcode = '23514';
    end if;
    return jsonb_build_object('id', v_existing.id, 'public_id', v_existing.public_id, 'created', false);
  end if;

  v_public := app.mint_governed_public_id('RV-PROD');
  insert into public.product_catalog (
    workspace_id, public_id, business_vertical, display_name, product_canonical_key, created_by_process)
  values (p_workspace_id, v_public, p_business_vertical::public.inventory_vertical,
    p_display_name, p_product_canonical_key, 'inventory.identity')
  returning id into v_id;

  if p_business_vertical = 'tcg' then
    insert into public.tcg_product_attributes (
      product_id, workspace_id, set_name, card_number, featured_subject, language)
    values (v_id, p_workspace_id, p_attrs->>'set_name', p_attrs->>'card_number',
      p_attrs->>'featured_subject', p_attrs->>'language');
  elsif p_business_vertical = 'footwear' then
    insert into public.footwear_product_attributes (
      product_id, workspace_id, silhouette, colorway_name, style_code)
    values (v_id, p_workspace_id, p_attrs->>'silhouette', p_attrs->>'colorway_name', p_attrs->>'style_code');
  end if;

  return jsonb_build_object('id', v_id, 'public_id', v_public, 'created', true);
end
$$;
revoke all on function public.register_product(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.register_product(uuid, text, text, text, jsonb) to authenticated;

-- SKU registrar: find-or-create by active fingerprint within the id-schema version -----
create function public.register_sellable_sku(
  p_workspace_id uuid,
  p_product_id uuid,
  p_attrs jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_product public.product_catalog%rowtype;
  v_fingerprint text;
  v_existing public.sellable_skus%rowtype;
  v_id uuid;
  v_public text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  select * into v_product from public.product_catalog
  where id = p_product_id and workspace_id = p_workspace_id;
  if v_product.id is null then
    raise exception 'product not found in this workspace' using errcode = '23514';
  end if;

  v_fingerprint := app.sku_fingerprint(v_product.identity_schema_version,
    v_product.business_vertical::text, v_product.product_canonical_key, coalesce(p_attrs, '{}'::jsonb));

  select * into v_existing from public.sellable_skus
  where workspace_id = p_workspace_id
    and identity_schema_version = v_product.identity_schema_version
    and fingerprint = v_fingerprint
    and is_active;
  if v_existing.id is not null then
    if v_existing.product_id <> p_product_id then
      raise exception 'fingerprint collision across two products' using errcode = '23514';
    end if;
    return jsonb_build_object('id', v_existing.id, 'public_id', v_existing.public_id,
      'fingerprint', v_fingerprint, 'created', false);
  end if;

  v_public := app.mint_governed_public_id('RV-SKU');
  insert into public.sellable_skus (
    workspace_id, public_id, product_id, business_vertical, identity_schema_version,
    fingerprint, created_by_process)
  values (p_workspace_id, v_public, p_product_id, v_product.business_vertical,
    v_product.identity_schema_version, v_fingerprint, 'inventory.identity')
  returning id into v_id;

  if v_product.business_vertical = 'tcg' then
    insert into public.tcg_sku_attributes (
      sku_id, workspace_id, condition_or_quality, grading_company, numeric_grade,
      grade_designation, seal_or_packaging_condition, product_format)
    values (v_id, p_workspace_id, p_attrs->>'condition_or_quality', p_attrs->>'grading_company',
      p_attrs->>'numeric_grade', p_attrs->>'grade_designation',
      p_attrs->>'seal_or_packaging_condition', p_attrs->>'product_format');
  elsif v_product.business_vertical = 'footwear' then
    insert into public.footwear_sku_attributes (
      sku_id, workspace_id, shoe_size, apparel_size, color, condition_or_quality)
    values (v_id, p_workspace_id, p_attrs->>'shoe_size', p_attrs->>'apparel_size',
      p_attrs->>'color', p_attrs->>'condition_or_quality');
  end if;

  return jsonb_build_object('id', v_id, 'public_id', v_public, 'fingerprint', v_fingerprint, 'created', true);
end
$$;
revoke all on function public.register_sellable_sku(uuid, uuid, jsonb) from public, anon;
grant execute on function public.register_sellable_sku(uuid, uuid, jsonb) to authenticated;

-- Location registrar: find-or-create by workspace-unique code -------------------------
create function public.register_storage_location(
  p_workspace_id uuid,
  p_location_code text,
  p_parent_code text default null,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_existing public.storage_locations%rowtype;
  v_parent_id uuid;
  v_id uuid;
  v_public text;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);

  select * into v_existing from public.storage_locations
  where workspace_id = p_workspace_id and location_code = p_location_code;
  if v_existing.id is not null then
    return jsonb_build_object('id', v_existing.id, 'public_id', v_existing.public_id, 'created', false);
  end if;

  if p_parent_code is not null then
    select id into v_parent_id from public.storage_locations
    where workspace_id = p_workspace_id and location_code = p_parent_code;
    if v_parent_id is null then
      raise exception 'parent location % not found', p_parent_code using errcode = '23514';
    end if;
  end if;

  v_public := app.mint_governed_public_id('RV-LOC');
  insert into public.storage_locations (
    workspace_id, public_id, location_code, parent_id, display_name, created_by_process)
  values (p_workspace_id, v_public, p_location_code, v_parent_id, p_display_name, 'inventory.identity')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'public_id', v_public, 'created', true);
end
$$;
revoke all on function public.register_storage_location(uuid, text, text, text) from public, anon;
grant execute on function public.register_storage_location(uuid, text, text, text) to authenticated;

-- Retire a location (governed update; the code stays reserved forever) -----------------
create function public.retire_storage_location(p_workspace_id uuid, p_location_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  update public.storage_locations set retired_at = coalesce(retired_at, now()), updated_at = now()
  where workspace_id = p_workspace_id and location_code = p_location_code
  returning id into v_id;
  if v_id is null then
    raise exception 'location % not found', p_location_code using errcode = '23514';
  end if;
  return jsonb_build_object('id', v_id, 'retired', true);
end
$$;
revoke all on function public.retire_storage_location(uuid, text) from public, anon;
grant execute on function public.retire_storage_location(uuid, text) to authenticated;

-- Lot registrar: preserves the supplied public id; find-or-create idempotently ---------
create function public.stage_inventory_lot(
  p_workspace_id uuid,
  p_public_id text,
  p_sku_id uuid,
  p_tracking_mode text,
  p_quantity integer,
  p_location_code text default null,
  p_record_origin text default null,
  p_mapping_version text default '1.0.0',
  p_fingerprint_inputs jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_existing public.inventory_lots%rowtype;
  v_location_id uuid;
  v_id uuid;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  if not exists (select 1 from public.sellable_skus
                 where id = p_sku_id and workspace_id = p_workspace_id) then
    raise exception 'sku not found in this workspace' using errcode = '23514';
  end if;
  if p_location_code is not null then
    select id into v_location_id from public.storage_locations
    where workspace_id = p_workspace_id and location_code = p_location_code;
    if v_location_id is null then
      raise exception 'location % not found', p_location_code using errcode = '23514';
    end if;
  end if;

  select * into v_existing from public.inventory_lots
  where workspace_id = p_workspace_id and public_id = p_public_id;
  if v_existing.id is not null then
    -- Idempotent retry: identical content is a no-op; a changed fact conflicts.
    if v_existing.sku_id is distinct from p_sku_id
       or v_existing.tracking_mode::text is distinct from p_tracking_mode
       or v_existing.quantity is distinct from p_quantity
       or v_existing.location_id is distinct from v_location_id then
      raise exception 'lot % retry conflicts with stored content', p_public_id using errcode = '23514';
    end if;
    return jsonb_build_object('id', v_existing.id, 'public_id', v_existing.public_id, 'created', false);
  end if;

  insert into public.inventory_lots (
    workspace_id, public_id, sku_id, tracking_mode, quantity, location_id,
    record_origin, mapping_version, fingerprint_inputs, created_by_process)
  values (p_workspace_id, p_public_id, p_sku_id, p_tracking_mode::public.inventory_tracking_mode,
    p_quantity, v_location_id, p_record_origin, p_mapping_version, p_fingerprint_inputs, 'inventory.identity')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'public_id', p_public_id, 'created', true);
end
$$;
revoke all on function public.stage_inventory_lot(uuid, text, uuid, text, integer, text, text, text, jsonb)
  from public, anon;
grant execute on function public.stage_inventory_lot(uuid, text, uuid, text, integer, text, text, text, jsonb)
  to authenticated;

-- Serialized item minting: concurrency-safe opaque scan code ---------------------------
-- Retries on a scan_sku collision (the workspace-unique index is the arbiter);
-- certificate/serial duplicates fail closed via their partial-unique indexes.
create function public.mint_serialized_item(
  p_workspace_id uuid,
  p_lot_id uuid,
  p_grading_company text default null,
  p_certificate_number text default null,
  p_serial_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_lot public.inventory_lots%rowtype;
  v_public text;
  v_scan text;
  v_id uuid;
  v_attempt integer := 0;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  select * into v_lot from public.inventory_lots
  where id = p_lot_id and workspace_id = p_workspace_id;
  if v_lot.id is null then
    raise exception 'lot not found in this workspace' using errcode = '23514';
  end if;
  if v_lot.tracking_mode <> 'serialized' then
    raise exception 'only a serialized lot may hold serialized items' using errcode = '23514';
  end if;

  v_public := app.mint_governed_public_id('RV-ITEM');
  loop
    v_attempt := v_attempt + 1;
    v_scan := app.gen_scan_sku();
    begin
      insert into public.inventory_items (
        workspace_id, public_id, lot_id, sku_id, scan_sku, grading_company,
        certificate_number, serial_number, created_by_process)
      values (p_workspace_id, v_public, p_lot_id, v_lot.sku_id, v_scan, p_grading_company,
        p_certificate_number, p_serial_number, 'inventory.identity')
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- Distinguish a scan-code collision (retry) from a certificate/serial or
      -- public-id duplicate (fail closed).
      if v_attempt < 8 and exists (
        select 1 from public.inventory_items
        where workspace_id = p_workspace_id and scan_sku = v_scan
      ) and not exists (
        select 1 from public.inventory_items
        where workspace_id = p_workspace_id and public_id = v_public
      ) then
        continue;  -- pure scan-code collision: mint a fresh code and retry
      end if;
      raise;       -- certificate/serial/public-id duplicate, or retries exhausted
    end;
  end loop;

  return jsonb_build_object('id', v_id, 'public_id', v_public, 'scan_sku', v_scan);
end
$$;
revoke all on function public.mint_serialized_item(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.mint_serialized_item(uuid, uuid, text, text, text) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260721000400_inventory_identity_functions');
