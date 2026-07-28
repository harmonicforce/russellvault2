-- Multi-category intake — migration 1: typed identity attributes for the
-- `other` vertical, plus the extra governed fields the new category forms
-- collect.
--
-- Why this is additive rather than a rewrite: the Product/SKU/Lot/Item
-- hierarchy, its fingerprint contract, and every governed function stay
-- exactly as they are. What is missing today is that the `other` vertical has
-- no typed attribute tables, so:
--   * app.intake_product_canonical_key collapses every `other` product to
--     'other|<display name>' — two different brands of the same-named item
--     would be forced into one product; and
--   * register_sellable_sku computes a fingerprint FROM the caller's attrs
--     while compute_sku_fingerprint recomputes it from '{}' — so any `other`
--     SKU carrying attributes could never survive the "stored attributes
--     still recompute to the fingerprint" check on a concurrent retry.
-- Adding the typed tables closes both. A small fixed column set — not an
-- open EAV bag — keeps identity governed.
--
-- Safe to apply: product_catalog, sellable_skus, inventory_lots and
-- inventory_items are all empty on this project, so no stored fingerprint or
-- canonical key changes meaning underneath existing rows.

-- Typed identity attributes for the `other` vertical -------------------------
create table public.other_product_attributes (
  product_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  business_vertical public.inventory_vertical not null default 'other'
    check (business_vertical = 'other'),
  brand text check (brand is null or char_length(brand) <= 120),
  product_line text check (product_line is null or char_length(product_line) <= 160),
  item_category text check (item_category is null or char_length(item_category) <= 80),
  model_number text check (model_number is null or char_length(model_number) <= 120),
  foreign key (product_id, workspace_id, business_vertical)
    references public.product_catalog (id, workspace_id, business_vertical) on delete restrict
);

create table public.other_sku_attributes (
  sku_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  business_vertical public.inventory_vertical not null default 'other'
    check (business_vertical = 'other'),
  size_label text check (size_label is null or char_length(size_label) <= 60),
  color text check (color is null or char_length(color) <= 60),
  condition_or_quality text check (condition_or_quality is null or char_length(condition_or_quality) <= 120),
  variant_label text check (variant_label is null or char_length(variant_label) <= 120),
  foreign key (sku_id, workspace_id, business_vertical)
    references public.sellable_skus (id, workspace_id, business_vertical) on delete restrict
);

-- Identity rows are append-only, exactly like the tcg/footwear equivalents.
create trigger other_product_attributes_append_only
  before update or delete on public.other_product_attributes
  for each row execute function app.forbid_update_delete();

create trigger other_sku_attributes_append_only
  before update or delete on public.other_sku_attributes
  for each row execute function app.forbid_update_delete();

alter table public.other_product_attributes enable row level security;
alter table public.other_sku_attributes enable row level security;

revoke all on table public.other_product_attributes, public.other_sku_attributes
  from public, anon, authenticated;
grant select on table public.other_product_attributes, public.other_sku_attributes to authenticated;

create policy other_product_attributes_select on public.other_product_attributes
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy other_sku_attributes_select on public.other_sku_attributes
  for select to authenticated using (app.member_role(workspace_id) is not null);

-- Extra governed columns the new category forms collect ---------------------
-- Printing/variant distinguishes a 1st Edition from an Unlimited copy of the
-- same card; it is SKU-scoped so it participates in the fingerprint without
-- changing any product canonical key.
alter table public.tcg_sku_attributes
  add column variant_or_printing text
    check (variant_or_printing is null or char_length(variant_or_printing) <= 120);

-- Size system ("US", "EU", "UK") and box status are both genuinely
-- SKU-defining for footwear: a US 10 is not an EU 10.
alter table public.footwear_sku_attributes
  add column size_system text check (size_system is null or char_length(size_system) <= 30),
  add column box_status text check (box_status is null or char_length(box_status) <= 60);

-- Canonical key: `other` products are identified by their real facts --------
create or replace function app.intake_product_canonical_key(
  p_vertical text, p_display_name text, p_product_attrs jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_vertical
    when 'tcg' then
      'tcg|' || coalesce(app.norm_identity(p_product_attrs->>'featured_subject'),
                         app.norm_identity(p_display_name), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'set_name'), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'card_number'), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'language'), '')
    when 'footwear' then
      'footwear|' || coalesce(app.norm_identity(p_product_attrs->>'silhouette'),
                              app.norm_identity(p_display_name), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'colorway_name'), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'style_code'), '')
    else
      'other|' || coalesce(app.norm_identity(p_display_name), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'brand'), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'product_line'), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'item_category'), '')
        || '|' || coalesce(app.norm_identity(p_product_attrs->>'model_number'), '')
  end
$$;

-- Fingerprint sources: every vertical now reads its own typed table, so a
-- stored SKU always recomputes to the fingerprint it was created with.
create or replace function app.compute_sku_fingerprint(p_sku_id uuid)
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
      'seal_or_packaging_condition', a.seal_or_packaging_condition,
      'product_format', a.product_format, 'variant_or_printing', a.variant_or_printing)
    into v_attrs from public.tcg_sku_attributes a where a.sku_id = p_sku_id;
  elsif v_sku.business_vertical = 'footwear' then
    select jsonb_build_object(
      'shoe_size', a.shoe_size, 'apparel_size', a.apparel_size, 'color', a.color,
      'condition_or_quality', a.condition_or_quality, 'size_system', a.size_system,
      'box_status', a.box_status)
    into v_attrs from public.footwear_sku_attributes a where a.sku_id = p_sku_id;
  else
    select jsonb_build_object(
      'size_label', a.size_label, 'color', a.color,
      'condition_or_quality', a.condition_or_quality, 'variant_label', a.variant_label)
    into v_attrs from public.other_sku_attributes a where a.sku_id = p_sku_id;
  end if;
  return app.sku_fingerprint(v_sku.identity_schema_version, v_sku.business_vertical::text,
    v_key, coalesce(v_attrs, '{}'::jsonb));
end
$$;

create or replace function app.sku_identity_jsonb(p_sku_id uuid)
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
      'seal_or_packaging_condition', a.seal_or_packaging_condition,
      'product_format', a.product_format, 'variant_or_printing', a.variant_or_printing)
    into v_attrs from public.tcg_sku_attributes a where a.sku_id = p_sku_id;
  elsif v_sku.business_vertical = 'footwear' then
    select jsonb_build_object(
      'shoe_size', a.shoe_size, 'apparel_size', a.apparel_size, 'color', a.color,
      'condition_or_quality', a.condition_or_quality, 'size_system', a.size_system,
      'box_status', a.box_status)
    into v_attrs from public.footwear_sku_attributes a where a.sku_id = p_sku_id;
  else
    select jsonb_build_object(
      'size_label', a.size_label, 'color', a.color,
      'condition_or_quality', a.condition_or_quality, 'variant_label', a.variant_label)
    into v_attrs from public.other_sku_attributes a where a.sku_id = p_sku_id;
  end if;
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

-- Registrars persist the new typed attributes ------------------------------
create or replace function public.register_product(
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
      else
        select exists (select 1 from public.other_product_attributes a where a.product_id = v_existing.id
          and (a.brand is distinct from app.norm_identity(p_attrs->>'brand')
            or a.product_line is distinct from app.norm_identity(p_attrs->>'product_line')
            or a.item_category is distinct from app.norm_identity(p_attrs->>'item_category')
            or a.model_number is distinct from app.norm_identity(p_attrs->>'model_number')))
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
      else
        insert into public.other_product_attributes (
          product_id, workspace_id, brand, product_line, item_category, model_number)
        values (v_id, p_workspace_id, app.norm_identity(p_attrs->>'brand'),
          app.norm_identity(p_attrs->>'product_line'), app.norm_identity(p_attrs->>'item_category'),
          app.norm_identity(p_attrs->>'model_number'));
      end if;
      return jsonb_build_object('id', v_id, 'public_id', v_public, 'created', true);
    exception when unique_violation then
      -- A concurrent transaction won this canonical key; loop to re-read/compare.
    end;
  end loop;
end
$$;

revoke all on function public.register_product(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.register_product(uuid, text, text, text, jsonb) to authenticated;

create or replace function public.register_sellable_sku(
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
          grade_designation, seal_or_packaging_condition, product_format, variant_or_printing)
        values (v_id, p_workspace_id, app.norm_identity(p_attrs->>'condition_or_quality'),
          app.norm_identity(p_attrs->>'grading_company'), app.norm_identity(p_attrs->>'numeric_grade'),
          app.norm_identity(p_attrs->>'grade_designation'),
          app.norm_identity(p_attrs->>'seal_or_packaging_condition'),
          app.norm_identity(p_attrs->>'product_format'),
          app.norm_identity(p_attrs->>'variant_or_printing'));
      elsif v_product.business_vertical = 'footwear' then
        insert into public.footwear_sku_attributes (
          sku_id, workspace_id, shoe_size, apparel_size, color, condition_or_quality,
          size_system, box_status)
        values (v_id, p_workspace_id, app.norm_identity(p_attrs->>'shoe_size'),
          app.norm_identity(p_attrs->>'apparel_size'), app.norm_identity(p_attrs->>'color'),
          app.norm_identity(p_attrs->>'condition_or_quality'),
          app.norm_identity(p_attrs->>'size_system'), app.norm_identity(p_attrs->>'box_status'));
      else
        insert into public.other_sku_attributes (
          sku_id, workspace_id, size_label, color, condition_or_quality, variant_label)
        values (v_id, p_workspace_id, app.norm_identity(p_attrs->>'size_label'),
          app.norm_identity(p_attrs->>'color'), app.norm_identity(p_attrs->>'condition_or_quality'),
          app.norm_identity(p_attrs->>'variant_label'));
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

-- Governed field registry for the new category forms -----------------------
-- Every attribute the new forms send must be registered here or
-- app.intake_assert_governed_attrs rejects it. Identity-driving fields carry
-- a maps_to target in the typed columns above; is_factual marks facts that
-- must never be given a fabricated default.
insert into public.intake_field_registry
  (field_key, label, scope, attr_key, business_vertical, data_type, reference_list_key, maps_to,
   is_identity_driving, is_factual) values
  -- TCG printing / variant
  ('tcg_variant_or_printing', 'Variant or printing', 'sku', 'variant_or_printing', 'tcg', 'text', null,
    'public.tcg_sku_attributes.variant_or_printing', true, true),
  -- Footwear sizing system and box status
  ('footwear_size_system', 'Size system', 'sku', 'size_system', 'footwear', 'text', null,
    'public.footwear_sku_attributes.size_system', true, false),
  ('footwear_box_status', 'Box status', 'sku', 'box_status', 'footwear', 'text', null,
    'public.footwear_sku_attributes.box_status', true, true),
  ('footwear_apparel_size', 'Apparel size', 'sku', 'apparel_size', 'footwear', 'text', null,
    'public.footwear_sku_attributes.apparel_size', true, false),
  -- Generic `other` vertical product identity (apparel, electronics, collectibles)
  ('other_brand', 'Brand or manufacturer', 'product', 'brand', 'other', 'text', null,
    'public.other_product_attributes.brand', true, true),
  ('other_product_line', 'Model or product line', 'product', 'product_line', 'other', 'text', null,
    'public.other_product_attributes.product_line', true, true),
  ('other_item_category', 'Item category', 'product', 'item_category', 'other', 'text', null,
    'public.other_product_attributes.item_category', true, false),
  ('other_model_number', 'Model number', 'product', 'model_number', 'other', 'text', null,
    'public.other_product_attributes.model_number', true, true),
  -- Generic `other` vertical SKU identity
  ('other_size_label', 'Size', 'sku', 'size_label', 'other', 'text', null,
    'public.other_sku_attributes.size_label', true, true),
  ('other_color', 'Color', 'sku', 'color', 'other', 'text', null,
    'public.other_sku_attributes.color', true, true),
  ('other_condition_or_quality', 'Condition', 'sku', 'condition_or_quality', 'other', 'text', null,
    'public.other_sku_attributes.condition_or_quality', true, true),
  ('other_variant_label', 'Variant', 'sku', 'variant_label', 'other', 'text', null,
    'public.other_sku_attributes.variant_label', true, true),
  -- Entry-level generic notes bag (non-identity, governed, no maps_to)
  ('other_included_accessories', 'Included accessories', 'entry', 'included_accessories', 'other',
    'text', null, null, false, true),
  ('other_operator_note', 'Notes', 'entry', 'operator_note', 'other', 'text', null, null, false, true),
  ('tcg_operator_note', 'Notes', 'entry', 'operator_note', 'tcg', 'text', null, null, false, true),
  ('footwear_operator_note', 'Notes', 'entry', 'operator_note', 'footwear', 'text', null, null, false, true);

-- Commit blockers for the new categories. Only genuine facts are required:
-- footwear already requires size; electronics/apparel/collectibles require a
-- name-bearing brand or category so an `other` product is never anonymous.
insert into public.intake_field_rules
  (category, field_key, applicability, is_required, is_commit_blocker, condition) values
  ('other', 'other_brand', 'always', false, false, '{}'),
  ('other', 'other_item_category', 'always', false, false, '{}'),
  ('other', 'other_condition_or_quality', 'always', false, false, '{}'),
  ('raw_tcg', 'tcg_set_name', 'always', false, false, '{}'),
  ('sealed_tcg', 'tcg_set_name', 'always', false, false, '{}'),
  ('footwear', 'footwear_style_code', 'always', false, false, '{}');

insert into public.schema_migrations_log (migration_name)
values ('20260728000200_multi_category_identity');
