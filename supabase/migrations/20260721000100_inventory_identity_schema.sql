-- Phase 5 product / SKU / lot / item / location identity core — migration 1: schema.
--
-- STAGING / NON-AUTHORITATIVE, same posture as Phases 3–4. The legacy SQLite
-- system remains the sole authoritative deployed inventory. This layer models
-- the approved identity hierarchy only; it implements NO intake, mutation,
-- movement, listing, sale, reconciliation, or cost-allocation workflow.
--
--   product_catalog       -- the general product identity (RV-PROD).
--     → sellable_skus     -- one exact interchangeable sellable configuration
--                            (RV-SKU), with a versioned deterministic identity
--                            fingerprint that is unique among ACTIVE SKUs.
--         → inventory_lots        -- the lot grain (existing RV-C / RV-S ids
--                                   are preserved verbatim); each lot references
--                                   exactly one sellable SKU.
--             → inventory_items   -- an OPTIONAL serialized child (RV-ITEM),
--                                   each with an opaque Crockford scan SKU.
--   storage_locations     -- an acyclic location hierarchy (RV-LOC).
--   inventory_location_balances -- a READ-ONLY projection scaffold (a view),
--                            never a competing writable location truth.
--
-- Identity-driving attributes live in governed typed columns or in per-vertical
-- SUBTYPE tables (tcg_* / footwear_*), never in an EAV bag or ungoverned JSON.
-- Subtype rows carry the parent's business_vertical in a composite foreign key
-- so a TCG subtype can only attach to a TCG product/SKU and vice-versa.
--
-- Conventions inherited from Phases 2–4:
--   * internal identity is a UUID primary key; governed public business ids
--     (public_id) are separate, immutable, per-workspace columns;
--   * workspace_id is NOT NULL and references public.workspaces;
--   * UNIQUE (id, workspace_id) lets children carry composite foreign keys so
--     cross-workspace relationships are impossible at the constraint level;
--   * identity-bearing foreign keys are ON DELETE RESTRICT.

-- Verticals and tracking mode ----------------------------------------------------------
create type public.inventory_vertical as enum ('tcg', 'footwear', 'other');
create type public.inventory_tracking_mode as enum ('lot_managed', 'serialized');

-- Product catalog ----------------------------------------------------------------------
-- The general product. Identity-driving product facts live in the per-vertical
-- subtype tables; product_canonical_key is a deterministic, workspace-unique
-- natural key so the same product is found-or-created, never duplicated.
create table public.product_catalog (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-PROD-[A-Z0-9]{6,20}$'),
  business_vertical public.inventory_vertical not null,
  display_name text not null check (char_length(display_name) between 1 and 300),
  product_canonical_key text not null check (char_length(product_canonical_key) between 1 and 600),
  identity_schema_version text not null default 'IDSKU1' check (identity_schema_version ~ '^IDSKU[0-9]+$'),
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (id, workspace_id, business_vertical),
  unique (workspace_id, public_id),
  unique (workspace_id, product_canonical_key)
);
create index product_catalog_workspace_idx on public.product_catalog (workspace_id);

-- Sellable SKU -------------------------------------------------------------------------
-- One exact interchangeable sellable configuration of a product. The fingerprint
-- is the SHA-256 of a canonical, versioned serialization of the SKU's identity-
-- driving typed columns + subtype attributes (see app.compute_sku_fingerprint).
-- Among ACTIVE skus it is unique within its identity-schema version.
create table public.sellable_skus (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-SKU-[A-Z0-9]{6,20}$'),
  product_id uuid not null,
  business_vertical public.inventory_vertical not null,
  identity_schema_version text not null default 'IDSKU1' check (identity_schema_version ~ '^IDSKU[0-9]+$'),
  -- 64-hex SHA-256 of the canonical identity serialization. Written once by the
  -- governed registrar (app.register_sellable_sku); immutable thereafter.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default true,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (id, workspace_id, business_vertical),
  unique (workspace_id, public_id),
  foreign key (product_id, workspace_id, business_vertical)
    references public.product_catalog (id, workspace_id, business_vertical) on delete restrict
);
create index sellable_skus_workspace_idx on public.sellable_skus (workspace_id);
create index sellable_skus_product_idx on public.sellable_skus (product_id);
-- Active fingerprint uniqueness, scoped to the identity-schema version.
create unique index sellable_skus_active_fingerprint_uniq
  on public.sellable_skus (workspace_id, identity_schema_version, fingerprint)
  where is_active;

-- TCG subtype attributes ---------------------------------------------------------------
-- Product-level (set / number / subject / language) vs SKU-level (condition /
-- grading). business_vertical is pinned to 'tcg' and joined to the parent so a
-- TCG subtype can only ever attach to a TCG product / SKU.
create table public.tcg_product_attributes (
  product_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  business_vertical public.inventory_vertical not null default 'tcg'
    check (business_vertical = 'tcg'),
  set_name text check (set_name is null or char_length(set_name) <= 200),
  card_number text check (card_number is null or char_length(card_number) <= 60),
  featured_subject text check (featured_subject is null or char_length(featured_subject) <= 200),
  language text check (language is null or char_length(language) <= 60),
  foreign key (product_id, workspace_id, business_vertical)
    references public.product_catalog (id, workspace_id, business_vertical) on delete restrict
);

create table public.tcg_sku_attributes (
  sku_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  business_vertical public.inventory_vertical not null default 'tcg'
    check (business_vertical = 'tcg'),
  condition_or_quality text check (condition_or_quality is null or char_length(condition_or_quality) <= 120),
  grading_company text check (grading_company is null or char_length(grading_company) <= 60),
  numeric_grade text check (numeric_grade is null or char_length(numeric_grade) <= 20),
  grade_designation text check (grade_designation is null or char_length(grade_designation) <= 60),
  seal_or_packaging_condition text check (seal_or_packaging_condition is null or char_length(seal_or_packaging_condition) <= 120),
  product_format text check (product_format is null or char_length(product_format) <= 60),
  foreign key (sku_id, workspace_id, business_vertical)
    references public.sellable_skus (id, workspace_id, business_vertical) on delete restrict
);

-- Footwear subtype attributes ----------------------------------------------------------
create table public.footwear_product_attributes (
  product_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  business_vertical public.inventory_vertical not null default 'footwear'
    check (business_vertical = 'footwear'),
  silhouette text check (silhouette is null or char_length(silhouette) <= 200),
  colorway_name text check (colorway_name is null or char_length(colorway_name) <= 200),
  style_code text check (style_code is null or char_length(style_code) <= 120),
  foreign key (product_id, workspace_id, business_vertical)
    references public.product_catalog (id, workspace_id, business_vertical) on delete restrict
);

create table public.footwear_sku_attributes (
  sku_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  business_vertical public.inventory_vertical not null default 'footwear'
    check (business_vertical = 'footwear'),
  shoe_size text check (shoe_size is null or char_length(shoe_size) <= 30),
  apparel_size text check (apparel_size is null or char_length(apparel_size) <= 30),
  color text check (color is null or char_length(color) <= 60),
  condition_or_quality text check (condition_or_quality is null or char_length(condition_or_quality) <= 120),
  foreign key (sku_id, workspace_id, business_vertical)
    references public.sellable_skus (id, workspace_id, business_vertical) on delete restrict
);

-- Storage locations --------------------------------------------------------------------
-- An acyclic hierarchy. location_code is workspace-unique; retired rows are kept
-- (never deleted), so a retired code can never be reused. Self-parenting and
-- indirect cycles are rejected by app.enforce_location_acyclic (migration 2).
create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-LOC-[A-Z0-9]{6,20}$'),
  location_code text not null check (char_length(location_code) between 1 and 120),
  parent_id uuid,
  display_name text check (display_name is null or char_length(display_name) <= 200),
  retired_at timestamptz,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  unique (workspace_id, location_code),
  constraint storage_locations_no_self_parent check (parent_id is null or parent_id <> id),
  foreign key (parent_id, workspace_id)
    references public.storage_locations (id, workspace_id) on delete restrict
);
create index storage_locations_workspace_idx on public.storage_locations (workspace_id);
create index storage_locations_parent_idx on public.storage_locations (parent_id);

-- Inventory lots -----------------------------------------------------------------------
-- The lot grain. Existing RV-C / RV-S public ids are preserved verbatim (the
-- public_id is supplied, not minted). Every lot references exactly one SKU.
create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-[A-Z]{1,6}-[0-9]{4,10}$'),
  sku_id uuid not null,
  tracking_mode public.inventory_tracking_mode not null default 'lot_managed',
  quantity integer not null check (quantity >= 0),
  location_id uuid,
  record_origin text check (record_origin is null or char_length(record_origin) <= 120),
  mapping_version text not null default '1.0.0' check (mapping_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  -- Provenance of the deterministic mapping: the exact fields that fed the SKU
  -- fingerprint. Recorded for audit; NOT an identity source and never read for
  -- uniqueness (the fingerprint on sellable_skus is the identity).
  fingerprint_inputs jsonb,
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (id, workspace_id, tracking_mode),
  unique (id, workspace_id, sku_id),
  unique (workspace_id, public_id),
  foreign key (sku_id, workspace_id)
    references public.sellable_skus (id, workspace_id) on delete restrict,
  foreign key (location_id, workspace_id)
    references public.storage_locations (id, workspace_id) on delete restrict
);
create index inventory_lots_workspace_idx on public.inventory_lots (workspace_id);
create index inventory_lots_sku_idx on public.inventory_lots (sku_id);
create index inventory_lots_location_idx on public.inventory_lots (location_id);

-- Inventory items (serialized children) ------------------------------------------------
-- One row per serialized unit. Opaque Crockford scan_sku is minted before any
-- media binding, is workspace-unique and immutable. Certificate and serial
-- identities use scoped partial uniqueness and fail closed on duplicates.
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-ITEM-[A-Z0-9]{6,20}$'),
  lot_id uuid not null,
  -- Denormalized SKU for identity queries; a composite FK forces it to equal the
  -- lot's SKU, so a serialized child can never drift to a different SKU.
  sku_id uuid not null,
  -- Opaque, non-sequential Crockford unit scan code, e.g. RV-7K3F9Q2.
  scan_sku text not null check (scan_sku ~ '^RV-[0-9A-HJKMNP-TV-Z]{7,12}$'),
  grading_company text check (grading_company is null or char_length(grading_company) <= 60),
  certificate_number text check (certificate_number is null or char_length(certificate_number) <= 120),
  serial_number text check (serial_number is null or char_length(serial_number) <= 120),
  -- Certificate scope: a certificate identity is only meaningful with its
  -- grading company, so a non-null certificate requires a non-blank company.
  -- Uniqueness is then scoped to (workspace, grading company, certificate).
  constraint inventory_items_certificate_requires_company
    check (certificate_number is null or (grading_company is not null and btrim(grading_company) <> '')),
  created_by_process text not null check (created_by_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  unique (workspace_id, scan_sku),
  foreign key (lot_id, workspace_id, sku_id)
    references public.inventory_lots (id, workspace_id, sku_id) on delete restrict
);
create index inventory_items_workspace_idx on public.inventory_items (workspace_id);
create index inventory_items_lot_idx on public.inventory_items (lot_id);
create index inventory_items_sku_idx on public.inventory_items (sku_id);
-- Scoped partial uniqueness — a certificate (per grading company) and a serial
-- number are each unique within the workspace when present. Duplicates fail closed.
create unique index inventory_items_certificate_uniq
  on public.inventory_items (workspace_id, grading_company, certificate_number)
  where certificate_number is not null;
create unique index inventory_items_serial_uniq
  on public.inventory_items (workspace_id, serial_number)
  where serial_number is not null;

-- Read-only projection scaffold --------------------------------------------------------
-- Current on-hand quantity per (workspace, location, sku), split by tracking
-- mode, projected directly from the lots and their serialized children. This is
-- a VIEW, not a table: there is exactly one writable inventory truth (the lots
-- and items), and no RECEIVE / MOVE / count / variance / adjustment event
-- authority is created anywhere in Phase 5.
create view public.inventory_location_balances as
  select
    l.workspace_id,
    l.location_id,
    l.sku_id,
    sum(case when l.tracking_mode = 'lot_managed' then l.quantity else 0 end)::bigint
      as lot_managed_quantity,
    count(distinct l.id)::bigint as lot_count,
    count(it.id)::bigint as serialized_unit_count
  from public.inventory_lots l
  left join public.inventory_items it on it.lot_id = l.id
  group by l.workspace_id, l.location_id, l.sku_id;

insert into public.schema_migrations_log (migration_name)
values ('20260721000100_inventory_identity_schema');
