-- Listing Prep Command Center — migration 1: the governed model.
--
-- The operational layer between "this is in inventory" and "this is listed
-- somewhere". It deliberately does NOT publish to a marketplace and does NOT
-- move, reserve, or decrement stock: marking something listed records a fact
-- about the owner's workflow, not a change to inventory. Governed inventory
-- exit is a separate concern.
--
-- The central design claim is that readiness is EARNED, not inferred. A record
-- does not become listable because its columns stopped being null; it becomes
-- listable when a person has confirmed the category's preparation facts, the
-- required content exists, the photographs are there, and the stock is still
-- sellable. That is why `listing_prep_checks` exists as its own table.

create type public.listing_prep_status as enum (
  'not_started',
  'in_preparation',
  'blocked',
  'needs_review',
  'ready_to_list',
  'listed',
  -- Abandoned rather than finished. Terminal, and frees the subject so a new
  -- preparation can be started later.
  'cancelled'
);

create type public.listing_prep_priority as enum ('low', 'normal', 'high', 'urgent');

-- 'unknown' is the honest default. A preparation fact is never assumed from
-- absence of evidence; somebody says so, or it stays unknown.
create type public.listing_prep_check_state as enum ('unknown', 'confirmed', 'not_applicable');

-- What kind of work an outstanding requirement represents. This is what turns
-- a blocker into an instruction the owner can act on.
create type public.listing_prep_requirement_kind as enum (
  'identity', 'condition', 'measurements', 'package',
  'price', 'quantity', 'disclosure', 'accessories', 'functionality'
);

-- ---------------------------------------------------------------------------
-- The preparation record
-- ---------------------------------------------------------------------------

create table public.listing_prep (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null unique check (public_id ~ '^RV-LP-[A-Z0-9]{6,20}$'),

  -- Serialized stock prepares per Item; quantity-managed stock prepares per
  -- Lot. A serialized parent lot never gets its own record, so two records can
  -- never compete for the same physical units (enforced in start_listing_prep).
  subject_kind text not null check (subject_kind in ('item', 'lot')),
  item_id uuid references public.inventory_items (id) on delete restrict,
  lot_id uuid references public.inventory_lots (id) on delete restrict,

  status public.listing_prep_status not null default 'not_started',
  priority public.listing_prep_priority not null default 'normal',
  assigned_to uuid references auth.users (id),
  owner_notes text check (owner_notes is null or char_length(owner_notes) <= 4000),
  blocked_reason text check (blocked_reason is null or char_length(blocked_reason) <= 500),

  -- Listing content the owner writes. None of it is derived from inventory
  -- facts automatically: a marketplace claim must be written by a person.
  working_title text check (working_title is null or char_length(working_title) <= 200),
  condition_summary text check (condition_summary is null or char_length(condition_summary) <= 1000),
  description_notes text check (description_notes is null or char_length(description_notes) <= 8000),
  defects_disclosures text check (defects_disclosures is null or char_length(defects_disclosures) <= 4000),
  included_items text check (included_items is null or char_length(included_items) <= 2000),
  research_notes text check (research_notes is null or char_length(research_notes) <= 4000),
  listing_format text check (listing_format is null or listing_format in ('fixed_price', 'auction', 'accepts_offers')),

  -- Quantity is meaningful only for a quantity-managed lot.
  quantity_to_list integer check (quantity_to_list is null or quantity_to_list > 0),

  -- Money follows the repository convention: integer minor units plus an
  -- explicit currency. Never floating point.
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  asking_price_minor bigint check (asking_price_minor is null or asking_price_minor >= 0),
  minimum_price_minor bigint check (minimum_price_minor is null or minimum_price_minor >= 0),

  shipping_policy_ref text check (shipping_policy_ref is null or char_length(shipping_policy_ref) <= 120),
  return_policy_ref text check (return_policy_ref is null or char_length(return_policy_ref) <= 120),
  package_weight_grams integer check (package_weight_grams is null or package_weight_grams > 0),
  package_length_mm integer check (package_length_mm is null or package_length_mm > 0),
  package_width_mm integer check (package_width_mm is null or package_width_mm > 0),
  package_height_mm integer check (package_height_mm is null or package_height_mm > 0),

  -- Where it ended up, recorded by hand after the owner lists it elsewhere.
  listed_at timestamptz,
  external_listing_ref text check (external_listing_ref is null or char_length(external_listing_ref) <= 400),

  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint listing_prep_one_subject check (
    (subject_kind = 'item' and item_id is not null and lot_id is null)
    or (subject_kind = 'lot' and lot_id is not null and item_id is null)
  ),
  -- A price needs a currency to mean anything.
  constraint listing_prep_price_currency check (
    (asking_price_minor is null and minimum_price_minor is null) or currency is not null
  ),
  -- A floor above the asking price is a data-entry error, not a strategy.
  constraint listing_prep_price_floor check (
    asking_price_minor is null or minimum_price_minor is null
    or minimum_price_minor <= asking_price_minor
  ),
  constraint listing_prep_listed_coherence check (
    (status = 'listed') = (listed_at is not null)
  ),
  constraint listing_prep_blocked_coherence check (
    status <> 'blocked' or blocked_reason is not null
  )
);

-- One live preparation per inventory subject. A listed or cancelled record is
-- terminal and does not block starting a fresh preparation later.
create unique index listing_prep_one_active_per_subject
  on public.listing_prep (coalesce(item_id, lot_id))
  where status not in ('listed', 'cancelled');

create index listing_prep_queue_idx
  on public.listing_prep (workspace_id, status, priority, created_at desc);
create index listing_prep_assignee_idx
  on public.listing_prep (workspace_id, assigned_to)
  where assigned_to is not null;
create index listing_prep_subject_idx
  on public.listing_prep (workspace_id, coalesce(item_id, lot_id));

create trigger listing_prep_touch_updated_at
  before update on public.listing_prep
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Category-aware requirement matrix
-- ---------------------------------------------------------------------------

-- Bounded reference data, one row per (category, requirement). Deliberately a
-- fixed matrix rather than an arbitrary key/value store: an unrestricted EAV
-- system would let the checklist drift into a second inventory model.
--
-- Photograph requirements are NOT restated here. They already live in
-- inventory_media_requirements and are consumed through the media readiness
-- function, so the two can never disagree about what a category needs.
create table public.listing_prep_requirements (
  subtype public.inventory_subtype not null,
  requirement_key text not null check (requirement_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(label) between 1 and 80),
  requirement_kind public.listing_prep_requirement_kind not null,
  is_required boolean not null default true,
  display_order integer not null default 0,
  primary key (subtype, requirement_key)
);

alter table public.listing_prep_requirements enable row level security;
revoke all on table public.listing_prep_requirements from public, anon, authenticated;
grant select on table public.listing_prep_requirements to authenticated;

create policy listing_prep_requirements_select on public.listing_prep_requirements
  for select to authenticated using (app.belongs_to_any_workspace());

insert into public.listing_prep_requirements
  (subtype, requirement_key, label, requirement_kind, is_required, display_order)
values
  -- A graded slab's condition IS its grade, so the work is verifying identity
  -- and that the holder itself is sound.
  ('graded_card', 'identity_verified',    'Identity verified against the slab', 'identity',  true, 1),
  ('graded_card', 'certificate_present',  'Certificate number recorded',        'identity',  true, 2),
  ('graded_card', 'slab_condition_review','Slab condition reviewed',            'condition', true, 3),
  ('graded_card', 'price_research',       'Price research completed',           'price',     true, 4),
  ('graded_card', 'shipping_package',     'Shipping package selected',          'package',   true, 5),

  ('raw_card', 'card_identity_reviewed',  'Card identity reviewed',             'identity',  true, 1),
  ('raw_card', 'card_number_confirmed',   'Card number confirmed',              'identity',  true, 2),
  ('raw_card', 'language_confirmed',      'Language confirmed',                 'identity',  false, 3),
  ('raw_card', 'condition_assessment',    'Condition assessed',                 'condition', true, 4),
  ('raw_card', 'defect_notes',            'Defects noted or ruled out',         'disclosure',true, 5),
  ('raw_card', 'shipping_protection',     'Shipping protection selected',       'package',   true, 6),

  ('sealed_tcg', 'product_identity',      'Product identity confirmed',         'identity',  true, 1),
  ('sealed_tcg', 'seal_condition',        'Seal and packaging condition checked','condition',true, 2),
  ('sealed_tcg', 'quantity_confirmed',    'Quantity to list confirmed',         'quantity',  true, 3),
  ('sealed_tcg', 'package_dimensions',    'Package dimensions and weight',      'package',   true, 4),

  ('footwear', 'product_identity',        'Brand and model confirmed',          'identity',  true, 1),
  ('footwear', 'size_confirmed',          'Size confirmed',                     'identity',  true, 2),
  ('footwear', 'condition_assessment',    'Condition assessed',                 'condition', true, 3),
  ('footwear', 'measurements',            'Measurements recorded',              'measurements', true, 4),
  ('footwear', 'defect_review',           'Flaws reviewed and disclosed',       'disclosure',true, 5),
  ('footwear', 'package_details',         'Package weight and dimensions',      'package',   true, 6),

  ('apparel', 'product_identity',         'Brand and item confirmed',           'identity',  true, 1),
  ('apparel', 'size_confirmed',           'Size confirmed',                     'identity',  true, 2),
  ('apparel', 'condition_assessment',     'Condition assessed',                 'condition', true, 3),
  ('apparel', 'measurements',             'Measurements recorded',              'measurements', true, 4),
  ('apparel', 'defect_review',            'Flaws reviewed and disclosed',       'disclosure',true, 5),
  ('apparel', 'package_details',          'Package weight and dimensions',      'package',   true, 6),

  -- Electronics carry the obligations a buyer actually cares about: does it
  -- work, is it unlocked, and what is in the box.
  ('electronics', 'model_identity',       'Model identity confirmed',           'identity',  true, 1),
  ('electronics', 'serial_recorded',      'Serial recorded for internal record','identity',  false, 2),
  ('electronics', 'functionality_test',   'Functionality tested',               'functionality', true, 3),
  ('electronics', 'reset_account_lock',   'Reset and account locks cleared',    'functionality', true, 4),
  ('electronics', 'included_accessories', 'Included accessories listed',        'accessories', true, 5),
  ('electronics', 'defect_notes',         'Defects noted or ruled out',         'disclosure',true, 6),
  ('electronics', 'package_details',      'Package weight and dimensions',      'package',   true, 7),

  ('other_collectible', 'product_identity',    'Item identity confirmed',       'identity',  true, 1),
  ('other_collectible', 'condition_assessment','Condition assessed',            'condition', true, 2),
  ('other_collectible', 'defect_notes',        'Defects noted or ruled out',    'disclosure',false, 3),
  ('other_collectible', 'package_details',     'Package weight and dimensions', 'package',   true, 4),

  -- An unclassified record cannot be prepared for sale until somebody says
  -- what it is. Requiring guessed angles or condition here would be fabricated
  -- policy, so the only requirement is classification itself.
  ('unclassified', 'classify_record', 'Classify this record first', 'identity', true, 1);

-- ---------------------------------------------------------------------------
-- Owner-confirmed preparation facts
-- ---------------------------------------------------------------------------

create table public.listing_prep_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  prep_id uuid not null references public.listing_prep (id) on delete cascade,
  requirement_key text not null check (requirement_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  state public.listing_prep_check_state not null default 'unknown',
  note text check (note is null or char_length(note) <= 1000),
  confirmed_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (prep_id, requirement_key),
  -- A confirmation without an author is not a confirmation.
  constraint listing_prep_checks_actor check (state = 'unknown' or confirmed_by is not null)
);

create index listing_prep_checks_prep_idx on public.listing_prep_checks (prep_id);

-- ---------------------------------------------------------------------------
-- Append-only history
-- ---------------------------------------------------------------------------

create table public.listing_prep_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  prep_id uuid not null references public.listing_prep (id) on delete restrict,
  event_type text not null check (event_type in
    ('started', 'status_changed', 'content_changed', 'check_changed', 'assigned',
     'priority_changed', 'blocked', 'unblocked', 'listed', 'reopened',
     'readiness_invalidated', 'preset_applied')),
  from_status public.listing_prep_status,
  to_status public.listing_prep_status,
  actor_id uuid not null references auth.users (id),
  reason text check (reason is null or char_length(reason) <= 500),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index listing_prep_events_prep_idx
  on public.listing_prep_events (prep_id, created_at desc);

create trigger listing_prep_events_append_only
  before update or delete on public.listing_prep_events
  for each row execute function app.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Package presets
-- ---------------------------------------------------------------------------

-- Named shipping defaults so the bulk "apply a package preset" action has
-- something real to apply, instead of retyping the same box every time.
create table public.listing_package_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  package_weight_grams integer check (package_weight_grams is null or package_weight_grams > 0),
  package_length_mm integer check (package_length_mm is null or package_length_mm > 0),
  package_width_mm integer check (package_width_mm is null or package_width_mm > 0),
  package_height_mm integer check (package_height_mm is null or package_height_mm > 0),
  shipping_policy_ref text check (shipping_policy_ref is null or char_length(shipping_policy_ref) <= 120),
  return_policy_ref text check (return_policy_ref is null or char_length(return_policy_ref) <= 120),
  retired_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index listing_package_presets_name_unique
  on public.listing_package_presets (workspace_id, lower(name))
  where retired_at is null;

create trigger listing_package_presets_touch_updated_at
  before update on public.listing_package_presets
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- Members read; nobody writes directly. Every mutation goes through a governed
-- SECURITY DEFINER function, so the lifecycle and its history cannot be
-- bypassed by a client with a table grant.
alter table public.listing_prep enable row level security;
alter table public.listing_prep_checks enable row level security;
alter table public.listing_prep_events enable row level security;
alter table public.listing_package_presets enable row level security;

revoke all on table public.listing_prep from public, anon, authenticated;
revoke all on table public.listing_prep_checks from public, anon, authenticated;
revoke all on table public.listing_prep_events from public, anon, authenticated;
revoke all on table public.listing_package_presets from public, anon, authenticated;

grant select on table public.listing_prep to authenticated;
grant select on table public.listing_prep_checks to authenticated;
grant select on table public.listing_prep_events to authenticated;
grant select on table public.listing_package_presets to authenticated;

create policy listing_prep_select on public.listing_prep
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy listing_prep_checks_select on public.listing_prep_checks
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy listing_prep_events_select on public.listing_prep_events
  for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy listing_package_presets_select on public.listing_package_presets
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

insert into public.schema_migrations_log (migration_name)
values ('20260801000500_listing_prep_schema');
