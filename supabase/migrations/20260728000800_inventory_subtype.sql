-- Operational completion — the exact inventory subtype.
--
-- Intake already asks the operator which KIND of thing this is: Apparel and
-- Electronics are separate forms with separate fields. But once committed both
-- collapse into the broad `other` business vertical, and every downstream
-- surface -- filters, photo guidance, workbench routing, "add another like
-- this", listing templates -- loses the distinction the operator already made.
--
-- This adds a bounded, governed subtype. It is an ENUM, not free text and not
-- an EAV bag: a new subtype requires a migration, which is the point. The
-- value is DERIVED FROM FACTS THE OPERATOR ALREADY STORED, never guessed, and
-- persisted on the SKU at registration so it can be indexed and filtered.
--
-- Why the SKU and not the item or lot: subtype is an identity fact. "Graded
-- slab" versus "raw single" is exactly the grading_company/product_format
-- distinction that already drives the SKU fingerprint. Two units of the same
-- SKU can never be different subtypes, and because SKUs are append-only and
-- corrections are made by new row, a subtype can never drift from the facts
-- that produced it.
--
-- Where the facts do not identify a subtype we store `unclassified` and put
-- the record in a review queue. We do not guess. Misfiling apparel as
-- electronics is worse than admitting we do not know.

create type public.inventory_subtype as enum (
  'graded_card',
  'raw_card',
  'sealed_tcg',
  'footwear',
  'apparel',
  'electronics',
  'other_collectible',
  -- Not a category. A record whose stored facts do not identify one of the
  -- above, held for operator review.
  'unclassified'
);

-- The single source of truth for the derivation ------------------------------
-- Pure and IMMUTABLE: same facts in, same subtype out, forever. Both the
-- registrar and the backfill call this, so a newly committed record and a
-- historical one can never be classified by two different rules.
--
-- The literals matched here are written by the intake forms themselves
-- (`product_format` is set to 'Graded slab' by the graded-card form and
-- 'Raw card' by the raw-card form; `item_category` is set to 'Apparel' or
-- 'Electronics' by those two forms). They are matched case-insensitively and
-- whitespace-tolerantly, and anything unrecognized falls through to
-- `unclassified` rather than to a nearest guess.
create function app.subtype_from_facts(
  p_vertical public.inventory_vertical,
  p_item_category text,
  p_grading_company text,
  p_product_format text
)
returns public.inventory_subtype
language sql
immutable
set search_path = ''
as $$
  select case
    when p_vertical = 'tcg' then case
      -- A grading company is decisive: a slab is a slab even if someone also
      -- recorded a packaging format for it.
      when nullif(btrim(coalesce(p_grading_company, '')), '') is not null then 'graded_card'
      when lower(btrim(coalesce(p_product_format, ''))) = 'graded slab' then 'graded_card'
      when lower(btrim(coalesce(p_product_format, ''))) = 'raw card' then 'raw_card'
      -- Any other stated format on a TCG SKU is a sealed product format
      -- (booster box, ETB, tin...) chosen by the operator from the sealed form.
      when nullif(btrim(coalesce(p_product_format, '')), '') is not null then 'sealed_tcg'
      -- TCG with neither a grade nor a format predates the current forms.
      -- Raw single and sealed product are genuinely indistinguishable here.
      else 'unclassified'
    end
    when p_vertical = 'footwear' then 'footwear'
    when p_vertical = 'other' then case
      when lower(btrim(coalesce(p_item_category, ''))) = 'apparel' then 'apparel'
      when lower(btrim(coalesce(p_item_category, ''))) = 'electronics' then 'electronics'
      -- The Other Collectible form requires the operator to name the category
      -- ('Comic', 'Figure', 'Coin'...). A stated category we do not recognize
      -- as apparel or electronics is a collectible, which is what that form is.
      when nullif(btrim(coalesce(p_item_category, '')), '') is not null then 'other_collectible'
      else 'unclassified'
    end
    else 'unclassified'
  end::public.inventory_subtype;
$$;

revoke all on function app.subtype_from_facts(
  public.inventory_vertical, text, text, text) from public, anon;

-- Resolve the subtype for an ALREADY-WRITTEN sku, from its stored rows.
create function app.subtype_for_sku(p_sku_id uuid)
returns public.inventory_subtype
language sql
stable
set search_path = ''
as $$
  select app.subtype_from_facts(
    sk.business_vertical,
    opa.item_category,
    tsa.grading_company,
    coalesce(tsa.product_format, osa.variant_label))
  from public.sellable_skus sk
  left join public.tcg_sku_attributes tsa on tsa.sku_id = sk.id
  left join public.other_sku_attributes osa on osa.sku_id = sk.id
  left join public.other_product_attributes opa on opa.product_id = sk.product_id
  where sk.id = p_sku_id;
$$;

revoke all on function app.subtype_for_sku(uuid) from public, anon;

-- The stored column --------------------------------------------------------
alter table public.sellable_skus
  add column inventory_subtype public.inventory_subtype not null default 'unclassified';

-- Backfill -------------------------------------------------------------------
-- sellable_skus is blanket append-only (app.forbid_update_delete refuses every
-- UPDATE, for every caller including the owner). That guarantee is what makes
-- a committed identity trustworthy, so this migration does not weaken it: the
-- trigger is disabled for the duration of this one classification write and
-- re-enabled in the same transaction. No identity column is touched -- this
-- writes a derived classification of facts that are themselves unchanged.
alter table public.sellable_skus disable trigger sellable_skus_append_only;

update public.sellable_skus sk
set inventory_subtype = app.subtype_from_facts(
      sk.business_vertical,
      (select a.item_category from public.other_product_attributes a
         where a.product_id = sk.product_id),
      (select a.grading_company from public.tcg_sku_attributes a
         where a.sku_id = sk.id),
      (select a.product_format from public.tcg_sku_attributes a
         where a.sku_id = sk.id));

alter table public.sellable_skus enable trigger sellable_skus_append_only;

-- Frozen once written. A subtype is a classification of immutable identity
-- facts, so it is immutable too: a record classified wrongly is corrected the
-- same way every other identity error is -- by a new, superseding record.
create trigger sellable_skus_subtype_frozen
  before update on public.sellable_skus
  for each row execute function app.forbid_column_change('inventory_subtype');

create index sellable_skus_subtype_idx
  on public.sellable_skus (workspace_id, inventory_subtype);

-- Write it at registration ---------------------------------------------------
-- Same signature, same behavior, one added column. The product's subtype
-- attributes are already committed by the time this runs (the product is
-- registered first), so `item_category` is readable here; the TCG facts come
-- straight from the caller's attrs, which are the same values inserted into
-- tcg_sku_attributes three statements later.
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
  v_subtype public.inventory_subtype;
begin
  v_uid := app.require_inventory_writer(p_workspace_id);
  select * into v_product from public.product_catalog
  where id = p_product_id and workspace_id = p_workspace_id;
  if v_product.id is null then
    raise exception 'product not found in this workspace' using errcode = '23514';
  end if;

  v_fingerprint := app.sku_fingerprint(v_product.identity_schema_version,
    v_product.business_vertical::text, v_product.product_canonical_key, coalesce(p_attrs, '{}'::jsonb));

  v_subtype := app.subtype_from_facts(
    v_product.business_vertical,
    (select a.item_category from public.other_product_attributes a
       where a.product_id = p_product_id),
    app.norm_identity(p_attrs->>'grading_company'),
    app.norm_identity(p_attrs->>'product_format'));

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
        'fingerprint', v_fingerprint, 'subtype', v_existing.inventory_subtype,
        'created', false);
    end if;

    begin
      v_public := app.mint_governed_public_id('RV-SKU');
      insert into public.sellable_skus (
        workspace_id, public_id, product_id, business_vertical, identity_schema_version,
        fingerprint, inventory_subtype, created_by_process)
      values (p_workspace_id, v_public, p_product_id, v_product.business_vertical,
        v_product.identity_schema_version, v_fingerprint, v_subtype, 'inventory.identity')
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
        'subtype', v_subtype, 'created', true);
    exception when unique_violation then
      -- A concurrent transaction won this fingerprint; loop to re-read/compare.
    end;
  end loop;
end
$$;

revoke all on function public.register_sellable_sku(uuid, uuid, jsonb) from public, anon;
grant execute on function public.register_sellable_sku(uuid, uuid, jsonb) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260728000800_inventory_subtype');
