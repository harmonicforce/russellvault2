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

-- THE canonical identity normalization contract, shared byte-for-byte with the
-- Node adapter (normalizeIdentityField in server/src/inventory/identity.ts):
--   1. Unicode NFC;
--   2. collapse every run of ASCII/POSIX whitespace to a single space;
--   3. trim a leading/trailing space (btrim of the single space left by step 2);
--   4. lowercase;
--   5. empty -> NULL (so an empty string and a "not stated" blank are one value).
-- Applied to every identity-driving Product and SKU field before hashing, so
-- case, whitespace, null-vs-empty, and NFC differences never fork an identity.
create function app.norm_identity(p text)
returns text language sql immutable
set search_path = ''
as $$
  select nullif(lower(btrim(regexp_replace(normalize(p, nfc), '[[:space:]]+', ' ', 'g'))), '')
$$;
revoke all on function app.norm_identity(text) from public;

-- Length-prefixed encoding of a NORMALIZED identity field.
create function app.dg_norm(p text)
returns text language sql immutable
set search_path = ''
as $$
  select app.dg_fld(app.norm_identity(p))
$$;
revoke all on function app.dg_norm(text) from public;

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
      || app.dg_norm(p_product_canonical_key)
      || case p_business_vertical
           when 'tcg' then
             'TCG'
             || app.dg_norm(p_attrs->>'condition_or_quality')
             || app.dg_norm(p_attrs->>'grading_company')
             || app.dg_norm(p_attrs->>'numeric_grade')
             || app.dg_norm(p_attrs->>'grade_designation')
             || app.dg_norm(p_attrs->>'seal_or_packaging_condition')
             || app.dg_norm(p_attrs->>'product_format')
           when 'footwear' then
             'FTW'
             || app.dg_norm(p_attrs->>'shoe_size')
             || app.dg_norm(p_attrs->>'apparel_size')
             || app.dg_norm(p_attrs->>'color')
             || app.dg_norm(p_attrs->>'condition_or_quality')
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

-- The persisted, NORMALIZED identity of a SKU, as governed provenance for a lot.
-- Computed from the stored identity rows (never trusted from caller JSON) so a
-- lot's fingerprint_inputs are a deterministic function of its SKU.
create function app.sku_identity_jsonb(p_sku_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sku public.sellable_skus%rowtype;
  v_key text;
  v_attrs jsonb;
  v_norm jsonb := '{}'::jsonb;
  k text;
begin
  select * into v_sku from public.sellable_skus where id = p_sku_id;
  if v_sku.id is null then
    raise exception 'sellable sku not found' using errcode = '42501';
  end if;
  select product_canonical_key into v_key from public.product_catalog where id = v_sku.product_id;
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
  end if;
  -- Normalize every value through the shared contract for stable provenance.
  for k in select jsonb_object_keys(coalesce(v_attrs, '{}'::jsonb)) loop
    v_norm := v_norm || jsonb_build_object(k, app.norm_identity(v_attrs->>k));
  end loop;
  return jsonb_build_object(
    'identity_schema_version', v_sku.identity_schema_version,
    'business_vertical', v_sku.business_vertical::text,
    'product_canonical_key', app.norm_identity(v_key),
    'fingerprint', v_sku.fingerprint,
    'attrs', v_norm);
end
$$;
revoke all on function app.sku_identity_jsonb(uuid) from public;

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
-- Content-idempotent AND concurrency-safe: the unique (workspace, canonical key)
-- constraint is the arbiter. On any collision the winning row is re-read and its
-- governed content (vertical, display_name, and the stored subtype attributes,
-- all under the shared normalization contract) is compared; identical resumes,
-- changed conflicts. Nothing is silently suppressed.
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
  v_key text;
  v_vertical public.inventory_vertical;
  v_attr_conflict boolean;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  if p_business_vertical not in ('tcg', 'footwear', 'other') then
    raise exception 'unknown business vertical %', p_business_vertical using errcode = '22023';
  end if;
  v_vertical := p_business_vertical::public.inventory_vertical;
  v_key := app.norm_identity(p_product_canonical_key);
  if v_key is null then
    raise exception 'product canonical key is required' using errcode = '22023';
  end if;

  loop
    select * into v_existing from public.product_catalog
    where workspace_id = p_workspace_id and product_canonical_key = v_key;
    if v_existing.id is not null then
      v_attr_conflict := false;
      if v_vertical = 'tcg' then
        select exists (select 1 from public.tcg_product_attributes a where a.product_id = v_existing.id
          and (a.set_name is distinct from app.norm_identity(p_attrs->>'set_name')
            or a.card_number is distinct from app.norm_identity(p_attrs->>'card_number')
            or a.featured_subject is distinct from app.norm_identity(p_attrs->>'featured_subject')
            or a.language is distinct from app.norm_identity(p_attrs->>'language')))
          into v_attr_conflict;
      elsif v_vertical = 'footwear' then
        select exists (select 1 from public.footwear_product_attributes a where a.product_id = v_existing.id
          and (a.silhouette is distinct from app.norm_identity(p_attrs->>'silhouette')
            or a.colorway_name is distinct from app.norm_identity(p_attrs->>'colorway_name')
            or a.style_code is distinct from app.norm_identity(p_attrs->>'style_code')))
          into v_attr_conflict;
      end if;
      if v_existing.business_vertical <> v_vertical
         or app.norm_identity(v_existing.display_name) is distinct from app.norm_identity(p_display_name)
         or v_attr_conflict then
        raise exception 'product % retry conflicts with stored content', v_key using errcode = '23514';
      end if;
      return jsonb_build_object('id', v_existing.id, 'public_id', v_existing.public_id, 'created', false);
    end if;

    begin
      v_public := app.mint_governed_public_id('RV-PROD');
      insert into public.product_catalog (
        workspace_id, public_id, business_vertical, display_name, product_canonical_key, created_by_process)
      values (p_workspace_id, v_public, v_vertical, p_display_name, v_key, 'inventory.identity')
      returning id into v_id;
      if v_vertical = 'tcg' then
        insert into public.tcg_product_attributes (
          product_id, workspace_id, set_name, card_number, featured_subject, language)
        values (v_id, p_workspace_id, app.norm_identity(p_attrs->>'set_name'),
          app.norm_identity(p_attrs->>'card_number'), app.norm_identity(p_attrs->>'featured_subject'),
          app.norm_identity(p_attrs->>'language'));
      elsif v_vertical = 'footwear' then
        insert into public.footwear_product_attributes (
          product_id, workspace_id, silhouette, colorway_name, style_code)
        values (v_id, p_workspace_id, app.norm_identity(p_attrs->>'silhouette'),
          app.norm_identity(p_attrs->>'colorway_name'), app.norm_identity(p_attrs->>'style_code'));
      end if;
      return jsonb_build_object('id', v_id, 'public_id', v_public, 'created', true);
    exception when unique_violation then
      -- A concurrent transaction won the insert of this key; loop to re-read and
      -- compare its content rather than suppressing the violation.
    end;
  end loop;
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

  -- The active-fingerprint unique index is the concurrency arbiter. On a
  -- collision the winning SKU is re-read and compared: same product resumes,
  -- cross-product reuse fails closed, and its stored attributes must recompute
  -- to the same fingerprint.
  loop
    select * into v_existing from public.sellable_skus
    where workspace_id = p_workspace_id
      and identity_schema_version = v_product.identity_schema_version
      and fingerprint = v_fingerprint
      and is_active;
    if v_existing.id is not null then
      if v_existing.product_id <> p_product_id then
        raise exception 'fingerprint reuse across two products' using errcode = '23514';
      end if;
      if app.compute_sku_fingerprint(v_existing.id) is distinct from v_fingerprint then
        raise exception 'stored SKU attributes no longer recompute to the fingerprint'
          using errcode = 'check_violation';
      end if;
      return jsonb_build_object('id', v_existing.id, 'public_id', v_existing.public_id,
        'fingerprint', v_fingerprint, 'created', false);
    end if;

    begin
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
        values (v_id, p_workspace_id, app.norm_identity(p_attrs->>'condition_or_quality'),
          app.norm_identity(p_attrs->>'grading_company'), app.norm_identity(p_attrs->>'numeric_grade'),
          app.norm_identity(p_attrs->>'grade_designation'),
          app.norm_identity(p_attrs->>'seal_or_packaging_condition'),
          app.norm_identity(p_attrs->>'product_format'));
      elsif v_product.business_vertical = 'footwear' then
        insert into public.footwear_sku_attributes (
          sku_id, workspace_id, shoe_size, apparel_size, color, condition_or_quality)
        values (v_id, p_workspace_id, app.norm_identity(p_attrs->>'shoe_size'),
          app.norm_identity(p_attrs->>'apparel_size'), app.norm_identity(p_attrs->>'color'),
          app.norm_identity(p_attrs->>'condition_or_quality'));
      end if;
      return jsonb_build_object('id', v_id, 'public_id', v_public, 'fingerprint', v_fingerprint,
        'created', true);
    exception when unique_violation then
      -- A concurrent transaction won this fingerprint; loop to re-read/compare.
    end;
  end loop;
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

  if p_parent_code is not null then
    select id into v_parent_id from public.storage_locations
    where workspace_id = p_workspace_id and location_code = p_parent_code;
    if v_parent_id is null then
      raise exception 'parent location % not found', p_parent_code using errcode = '23514';
    end if;
  end if;

  -- The workspace-unique location_code is the arbiter. On a collision the winning
  -- row is re-read and its parent + display_name compared; identical resumes, a
  -- changed hierarchy or label conflicts (never a false success).
  loop
    select * into v_existing from public.storage_locations
    where workspace_id = p_workspace_id and location_code = p_location_code;
    if v_existing.id is not null then
      if v_existing.parent_id is distinct from v_parent_id
         or app.norm_identity(v_existing.display_name) is distinct from app.norm_identity(p_display_name) then
        raise exception 'location % retry conflicts with stored hierarchy or label', p_location_code
          using errcode = '23514';
      end if;
      return jsonb_build_object('id', v_existing.id, 'public_id', v_existing.public_id, 'created', false);
    end if;

    begin
      v_public := app.mint_governed_public_id('RV-LOC');
      insert into public.storage_locations (
        workspace_id, public_id, location_code, parent_id, display_name, created_by_process)
      values (p_workspace_id, v_public, p_location_code, v_parent_id, p_display_name, 'inventory.identity')
      returning id into v_id;
      return jsonb_build_object('id', v_id, 'public_id', v_public, 'created', true);
    exception when unique_violation then
      -- A concurrent transaction won this code; loop to re-read and compare.
    end;
  end loop;
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
  v_fp_inputs jsonb;
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
  -- Fingerprint inputs are DERIVED from the persisted SKU identity, never trusted
  -- from caller JSON, so they are a deterministic function of the lot's SKU. A
  -- changed SKU (and therefore a changed fingerprint input) conflicts below.
  v_fp_inputs := app.sku_identity_jsonb(p_sku_id);

  loop
    select * into v_existing from public.inventory_lots
    where workspace_id = p_workspace_id and public_id = p_public_id;
    if v_existing.id is not null then
      -- Idempotent retry compares EVERY governed fact, including record_origin,
      -- mapping_version, and the derived fingerprint inputs.
      if v_existing.sku_id is distinct from p_sku_id
         or v_existing.tracking_mode::text is distinct from p_tracking_mode
         or v_existing.quantity is distinct from p_quantity
         or v_existing.location_id is distinct from v_location_id
         or v_existing.record_origin is distinct from p_record_origin
         or v_existing.mapping_version is distinct from p_mapping_version
         or v_existing.fingerprint_inputs is distinct from v_fp_inputs then
        raise exception 'lot % retry conflicts with stored content', p_public_id using errcode = '23514';
      end if;
      return jsonb_build_object('id', v_existing.id, 'public_id', v_existing.public_id, 'created', false);
    end if;

    begin
      insert into public.inventory_lots (
        workspace_id, public_id, sku_id, tracking_mode, quantity, location_id,
        record_origin, mapping_version, fingerprint_inputs, created_by_process)
      values (p_workspace_id, p_public_id, p_sku_id, p_tracking_mode::public.inventory_tracking_mode,
        p_quantity, v_location_id, p_record_origin, p_mapping_version, v_fp_inputs, 'inventory.identity')
      returning id into v_id;
      return jsonb_build_object('id', v_id, 'public_id', p_public_id, 'created', true);
    exception when unique_violation then
      -- A concurrent transaction won this public id; loop to re-read and compare.
    end;
  end loop;
end
$$;
revoke all on function public.stage_inventory_lot(uuid, text, uuid, text, integer, text, text, text, jsonb)
  from public, anon;
grant execute on function public.stage_inventory_lot(uuid, text, uuid, text, integer, text, text, text, jsonb)
  to authenticated;

-- Serialized item minting: capacity-bounded, concurrency-safe -------------------------
-- Capacity: the number of serialized children never exceeds the lot's quantity.
-- The lot row is locked FOR UPDATE so concurrent final-capacity mints serialize —
-- the loser blocks, then re-reads the now-full count and is refused. A child
-- count below quantity is allowed (staged identity creation need not be
-- complete). A lot_managed lot may hold no serialized children.
-- Certificate scope: a certificate requires a non-blank grading company; a
-- duplicate (workspace, grading company, certificate) fails closed via the
-- partial-unique index; the same certificate under a different grading company
-- is a distinct identity and is allowed. Scan codes retry on collision.
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
  v_child_count integer;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  -- Lock the lot row so capacity decisions serialize across concurrent mints.
  select * into v_lot from public.inventory_lots
  where id = p_lot_id and workspace_id = p_workspace_id
  for update;
  if v_lot.id is null then
    raise exception 'lot not found in this workspace' using errcode = '23514';
  end if;
  if v_lot.tracking_mode <> 'serialized' then
    raise exception 'only a serialized lot may hold serialized items' using errcode = '23514';
  end if;

  -- Certificate scope: a certificate cannot exist without a grading company.
  if p_certificate_number is not null and (p_grading_company is null or btrim(p_grading_company) = '') then
    raise exception 'a certificate number requires a grading company' using errcode = '23514';
  end if;

  -- Capacity: never exceed the lot quantity (child count may be below it).
  select count(*)::integer into v_child_count
  from public.inventory_items where lot_id = p_lot_id;
  if v_child_count >= v_lot.quantity then
    raise exception 'serialized lot % is at capacity (% of % units)',
      v_lot.public_id, v_child_count, v_lot.quantity using errcode = '23514';
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
