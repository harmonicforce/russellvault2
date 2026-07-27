-- Phase 6A intake kernel — migration 1: draft/control-plane schema.
--
-- STAGING / NON-AUTHORITATIVE control plane. This layer is the reusable,
-- server-authoritative INTAKE DRAFT machine that Phase 6 surfaces (Quick Add,
-- Batch, Guided, scanner recovery) will share. It writes NOTHING to the legacy
-- SQLite system and creates NO second committed inventory truth.
--
-- Committed physical truth remains EXCLUSIVELY the Phase 5 identity core:
--   product_catalog, sellable_skus, inventory_lots, inventory_items,
--   storage_locations. Everything created here is a DRAFT or a CONTROL record —
--   a governed rule, a reference option, a candidate evidence link, an
--   immutable commit receipt, or an immutable transition-audit event.
--
-- NAMING. Phase 2 shipped a now-vestigial shadow foundation that already owns
-- the bare names sessions / intake_groups / items / field_registry /
-- field_rules / reference_lists / reference_options. Those tables are mutable,
-- non-append-only, and are NOT wired to the Phase 5 identity core; they are a
-- different (older) model. To keep the boundary unmistakable and avoid a second
-- committed truth, every table here carries an intake_ prefix and is a distinct
-- object from the Phase 2 tables. This kernel never reads or writes them.
--
-- There is NO pre-existing Supabase intake data to preserve or backfill: no
-- prior intake sessions, groups, entries, or committed-items table is claimed
-- or fabricated. The control plane is created from scratch.
--
-- Conventions inherited from Phases 2-5:
--   * internal identity is a UUID primary key; governed public business ids
--     (public_id) are separate, immutable, per-workspace columns;
--   * workspace_id is NOT NULL and references public.workspaces;
--   * UNIQUE (id, workspace_id) lets children carry composite foreign keys so
--     cross-workspace relationships are impossible at the constraint level;
--   * identity-bearing foreign keys are ON DELETE RESTRICT;
--   * governed config (registry / rules / reference options) is deterministic
--     seed data applied by migration; it is not per-workspace editable state.

-- Draft/control enums ------------------------------------------------------------------
-- The governed intake state machine. Invalid transitions fail closed in the
-- kernel; these are the ONLY states a group may hold.
create type public.intake_group_state as enum (
  'draft', 'ready_to_commit', 'committed', 'abandoned'
);

-- A session's lifecycle. A session is abandoned explicitly; it never silently
-- disappears.
create type public.intake_session_state as enum ('open', 'abandoned');

-- Source provenance posture of a draft. Facts are never invented: an intake
-- draft's source is EXPLICITLY unknown until a real state is asserted.
--   unknown  — no acquisition source asserted yet (the default; explicit).
--   candidate — a candidate acquisition line is attached as EVIDENCE only.
--   stated   — an operator explicitly stated a non-candidate source posture.
create type public.intake_source_state as enum ('unknown', 'candidate', 'stated');

-- The governed category shortcuts recognized in Phase 6A. Category drives the
-- business vertical and the serialization policy; it is not itself an identity.
create type public.intake_category as enum (
  'graded_tcg', 'raw_tcg', 'sealed_tcg', 'footwear', 'other'
);

-- The Phase 6A next-action vocabulary. Every successful commit returns exactly
-- one of these. Deliberately small: no Daily Workbench, listing-readiness, media
-- or movement workflow is modeled here.
create type public.intake_next_action as enum (
  'CONDITION_DETAILS_NEEDED',
  'LOCATION_ASSIGNMENT_NEEDED',
  'PHOTOS_NEEDED',
  'SOURCE_REVIEW_NEEDED',
  'READY_FOR_FUTURE_LISTING_PREP',
  'NO_IMMEDIATE_ACTION'
);

-- Governed field registry ---------------------------------------------------------------
-- WORKSPACE-INDEPENDENT governed configuration (seeded by migration 4). Each
-- field maps into a Phase 5 typed Product or SKU attribute (or an entry-level
-- serialized fact); this is NOT an EAV identity bag. `maps_to` names the exact
-- governed target column so identity-driving facts always land in typed Phase 5
-- storage. `is_factual` marks a fact that must NEVER be defaulted (source, cost,
-- condition, grade, grading company, certificate, defects, marketplace status).
create table public.intake_field_registry (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique check (field_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (char_length(label) between 1 and 200),
  -- Which draft container the field is written into.
  scope text not null check (scope in ('product', 'sku', 'entry', 'group')),
  -- The canonical attribute key inside the scope's draft bag (product_attrs /
  -- sku_attrs / entry_attrs). For identity fields this equals the final segment
  -- of maps_to; for non-identity governed fields it is a standalone bag key.
  -- The authoritative evaluator resolves every value by attr_key, never by an
  -- ungoverned free key.
  attr_key text not null check (attr_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- NULL vertical = applies to every vertical.
  business_vertical public.inventory_vertical,
  data_type text not null check (data_type in ('text', 'integer', 'boolean', 'reference')),
  -- The reference list a 'reference' field draws its allowed values from.
  reference_list_key text,
  -- The Phase 5 typed target this identity fact maps into (schema.table.column),
  -- or NULL for non-identity workflow fields.
  maps_to text check (maps_to is null or maps_to ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+$'),
  is_identity_driving boolean not null default false,
  -- A factual fact that must never be given a fabricated default value.
  is_factual boolean not null default false,
  created_at timestamptz not null default now(),
  check ((data_type = 'reference') = (reference_list_key is not null)),
  -- An identity-driving field must map into a typed Phase 5 column and its
  -- attr_key must be that column's name (no EAV identity).
  check (not is_identity_driving or (maps_to is not null and attr_key = split_part(maps_to, '.', 3)))
);

-- Reference lists / options (governed allowed values) -----------------------------------
create table public.intake_reference_lists (
  list_key text primary key check (list_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (char_length(label) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.intake_reference_options (
  id uuid primary key default gen_random_uuid(),
  list_key text not null references public.intake_reference_lists (list_key) on delete restrict,
  option_value text not null check (char_length(option_value) between 1 and 200),
  label text not null check (char_length(label) between 1 and 200),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (list_key, option_value)
);

-- Deterministic field rules -------------------------------------------------------------
-- Governed, deterministic, server-authoritative. A rule binds a registry field
-- to a category, declaring applicability, requiredness, whether it blocks
-- commit, and an optional cross-field JSON condition. The client may preview
-- these; it must not maintain a competing engine. `rule_version` is the applied
-- rule-set version recorded on every commit receipt.
create table public.intake_field_rules (
  id uuid primary key default gen_random_uuid(),
  category public.intake_category not null,
  field_key text not null references public.intake_field_registry (field_key) on delete restrict,
  applicability text not null default 'always' check (applicability in ('always', 'conditional')),
  is_required boolean not null default false,
  is_commit_blocker boolean not null default false,
  -- Optional structured cross-field condition, e.g.
  --   {"when_field":"tracking_mode","equals":"serialized"}.
  condition jsonb not null default '{}'::jsonb,
  rule_version text not null default 'INTAKE_RULES_1'
    check (rule_version ~ '^INTAKE_RULES_[0-9]+$'),
  created_at timestamptz not null default now(),
  unique (category, field_key),
  constraint intake_field_rules_condition_is_object check (jsonb_typeof(condition) = 'object')
);

-- Intake sessions ----------------------------------------------------------------------
create table public.intake_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-ISESS-[A-Z0-9]{6,20}$'),
  label text check (label is null or char_length(label) <= 200),
  state public.intake_session_state not null default 'open',
  opened_by uuid not null references auth.users (id),
  opened_at timestamptz not null default now(),
  abandoned_by uuid references auth.users (id),
  abandoned_at timestamptz,
  abandon_reason text check (abandon_reason is null or char_length(abandon_reason) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, public_id),
  unique (id, workspace_id),
  constraint intake_sessions_abandon_attributed
    check ((state = 'abandoned') = (abandoned_by is not null and abandoned_at is not null))
);
create index intake_sessions_workspace_idx on public.intake_sessions (workspace_id);

-- Intake draft groups (the committable grain) ------------------------------------------
-- One draft group commits to exactly one canonical Product + Sellable SKU +
-- Inventory Lot result (plus optional serialized Inventory Items). `version` is
-- the optimistic-concurrency token, bumped on every draft edit; commit is
-- refused if the caller's expected version is stale. The committed_* columns are
-- written once at commit and frozen thereafter (append-only migration 2).
create table public.intake_draft_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  session_id uuid not null,
  public_id text not null check (public_id ~ '^RV-IG-[A-Z0-9]{6,20}$'),
  state public.intake_group_state not null default 'draft',
  version integer not null default 1 check (version >= 1),
  category public.intake_category not null,
  business_vertical public.inventory_vertical not null,
  display_name text not null check (char_length(display_name) between 1 and 300),
  -- Governed typed attribute drafts. Keys are validated against the field
  -- registry at write and re-validated at commit, then mapped into Phase 5 typed
  -- columns via the identity registrars. These are DRAFT payloads, never a
  -- second committed identity store.
  product_attrs jsonb not null default '{}'::jsonb,
  sku_attrs jsonb not null default '{}'::jsonb,
  quantity integer not null check (quantity between 1 and 100000),
  tracking_mode public.inventory_tracking_mode not null default 'lot_managed',
  -- How many serialized children a commit will mint (0 for a pure lot).
  serialized_child_count integer not null default 0 check (serialized_child_count >= 0),
  source_state public.intake_source_state not null default 'unknown',
  -- Governed, explicit source evidence explaining a STATED source. Must carry a
  -- governed source_kind when source_state = 'stated' (validated in the kernel
  -- against a reference list); the bare word "stated" can never bypass review.
  -- For 'candidate' the acquisition-line links are the evidence; for 'unknown'
  -- it stays empty. Financially inert.
  source_evidence jsonb not null default '{}'::jsonb,
  -- Explicit, never-defaulted factual condition. NULL means "not stated".
  condition_state text check (condition_state is null or char_length(condition_state) <= 120),
  -- Optional location assignment (a Phase 5 storage-location code).
  location_code text check (location_code is null or char_length(location_code) <= 120),
  -- Workflow policy flags (safe to default false: these configure WORKFLOW, not
  -- factual product state). Any true value forces serialization.
  owner_tagged boolean not null default false,
  unique_condition boolean not null default false,
  requires_item_media boolean not null default false,
  -- Premium / security-sensitive unit: forces serialization per the approved
  -- hybrid policy.
  security_sensitive boolean not null default false,
  -- Set once at commit; immutable thereafter.
  applied_rule_version text check (applied_rule_version is null
    or applied_rule_version ~ '^INTAKE_RULES_[0-9]+$'),
  next_action public.intake_next_action,
  committed_product_id uuid,
  committed_sku_id uuid,
  committed_lot_id uuid,
  committed_at timestamptz,
  committed_by uuid references auth.users (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, public_id),
  unique (id, workspace_id),
  foreign key (session_id, workspace_id)
    references public.intake_sessions (id, workspace_id) on delete restrict,
  foreign key (committed_product_id, workspace_id)
    references public.product_catalog (id, workspace_id) on delete restrict,
  foreign key (committed_sku_id, workspace_id)
    references public.sellable_skus (id, workspace_id) on delete restrict,
  foreign key (committed_lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict,
  constraint intake_draft_groups_attrs_are_objects
    check (jsonb_typeof(product_attrs) = 'object' and jsonb_typeof(sku_attrs) = 'object'
      and jsonb_typeof(source_evidence) = 'object'),
  -- A stated source must carry governed, explicit evidence (a source_kind); a
  -- non-stated source carries none. The kernel additionally validates the
  -- source_kind value against a governed reference list.
  constraint intake_draft_groups_stated_has_evidence check (
    (source_state = 'stated') = (jsonb_typeof(source_evidence->'source_kind') = 'string')
  ),
  -- A committed group must carry its resulting identity + governance stamps; a
  -- non-committed group must not (no partial or fabricated committed linkage).
  constraint intake_draft_groups_committed_linked check (
    (state = 'committed') = (committed_product_id is not null
      and committed_sku_id is not null and committed_lot_id is not null
      and committed_at is not null and committed_by is not null
      and applied_rule_version is not null and next_action is not null)
  ),
  -- Serialized policy coherence: a serialized commit mints >= 1 child; a
  -- lot-managed group mints none.
  constraint intake_draft_groups_serial_coherent check (
    (tracking_mode = 'serialized' and serialized_child_count between 1 and quantity)
    or (tracking_mode = 'lot_managed' and serialized_child_count = 0)
  )
);
create index intake_draft_groups_workspace_idx on public.intake_draft_groups (workspace_id);
create index intake_draft_groups_session_idx on public.intake_draft_groups (session_id);
create index intake_draft_groups_state_idx on public.intake_draft_groups (workspace_id, state);

-- Intake entries (per serialized-unit draft evidence) -----------------------------------
-- One row per serialized unit a group will mint. A lot-managed group has zero
-- entries. Each entry carries the per-unit governed facts (grading company,
-- grade, certificate, serial); all are explicit and never defaulted. On commit,
-- committed_item_id is written once and frozen.
create table public.intake_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  group_id uuid not null,
  public_id text not null check (public_id ~ '^RV-IE-[A-Z0-9]{6,20}$'),
  entry_index integer not null check (entry_index between 1 and 100000),
  grading_company text check (grading_company is null or char_length(grading_company) <= 60),
  numeric_grade text check (numeric_grade is null or char_length(numeric_grade) <= 20),
  grade_designation text check (grade_designation is null or char_length(grade_designation) <= 60),
  certificate_number text check (certificate_number is null or char_length(certificate_number) <= 120),
  serial_number text check (serial_number is null or char_length(serial_number) <= 120),
  entry_attrs jsonb not null default '{}'::jsonb,
  committed_item_id uuid,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, public_id),
  unique (id, workspace_id),
  -- Lets a candidate link carry a composite FK proving its entry belongs to the
  -- SAME group as the link (an entry cannot be cross-linked into another group).
  unique (id, group_id),
  unique (workspace_id, group_id, entry_index),
  foreign key (group_id, workspace_id)
    references public.intake_draft_groups (id, workspace_id) on delete restrict,
  foreign key (committed_item_id, workspace_id)
    references public.inventory_items (id, workspace_id) on delete restrict,
  constraint intake_entries_attrs_is_object check (jsonb_typeof(entry_attrs) = 'object'),
  constraint intake_entries_certificate_requires_company
    check (certificate_number is null
           or (grading_company is not null and btrim(grading_company) <> ''))
);
create index intake_entries_workspace_idx on public.intake_entries (workspace_id);
create index intake_entries_group_idx on public.intake_entries (group_id);

-- Candidate acquisition evidence --------------------------------------------------------
-- A draft may reference a canonical acquisition line as CANDIDATE EVIDENCE only.
-- This table has ZERO financial columns by construction: it cannot allocate
-- quantity or cents, alter an acquisition balance, establish landed cost,
-- confirm cost basis, or affect profit. Those are Phase 7. It records only who
-- proposed the link, with what confidence, and its review posture. It is
-- attachable/removable ONLY while the group is a draft (enforced in migration 4).
create table public.intake_candidate_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  group_id uuid not null,
  entry_id uuid,
  acquisition_line_item_id uuid not null,
  evidence jsonb not null default '{}'::jsonb,
  confidence text not null default 'low' check (confidence in ('low', 'medium', 'high')),
  source_state text not null default 'observed'
    check (source_state in ('observed', 'asserted', 'imported')),
  review_state text not null default 'unreviewed'
    check (review_state in ('unreviewed', 'accepted', 'rejected')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- At most one candidate link per (group, acquisition line): a draft cannot
  -- attach the same acquisition line twice.
  unique (workspace_id, group_id, acquisition_line_item_id),
  foreign key (group_id, workspace_id)
    references public.intake_draft_groups (id, workspace_id) on delete restrict,
  foreign key (entry_id, workspace_id)
    references public.intake_entries (id, workspace_id) on delete restrict,
  -- A candidate's entry (when present) must belong to the SAME group as the
  -- link. Enforced structurally by a composite FK into intake_entries (id, group_id).
  foreign key (entry_id, group_id)
    references public.intake_entries (id, group_id) on delete restrict,
  foreign key (acquisition_line_item_id, workspace_id)
    references public.acquisition_line_items (id, workspace_id) on delete restrict,
  constraint intake_candidate_links_evidence_is_object check (jsonb_typeof(evidence) = 'object')
);
create index intake_candidate_links_workspace_idx on public.intake_candidate_links (workspace_id);
create index intake_candidate_links_group_idx on public.intake_candidate_links (group_id);
create index intake_candidate_links_line_idx on public.intake_candidate_links (acquisition_line_item_id);

-- Immutable commit receipt / idempotency ------------------------------------------------
-- One row per governed commit ATTEMPT, keyed by the client idempotency key. The
-- content_hash is a deterministic digest of the exact committed draft snapshot.
-- Repeated submission with the same key + identical content returns this same
-- immutable receipt; the same key with changed content fails closed. Fully
-- append-only (migration 2).
create table public.intake_commit_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  session_id uuid not null,
  group_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('committed', 'conflict')),
  receipt jsonb not null,
  applied_rule_version text not null check (applied_rule_version ~ '^INTAKE_RULES_[0-9]+$'),
  next_action public.intake_next_action not null,
  actor_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- The idempotency arbiter: one committed receipt per (group, key).
  unique (workspace_id, group_id, idempotency_key),
  foreign key (session_id, workspace_id)
    references public.intake_sessions (id, workspace_id) on delete restrict,
  foreign key (group_id, workspace_id)
    references public.intake_draft_groups (id, workspace_id) on delete restrict,
  constraint intake_commit_attempts_receipt_is_object check (jsonb_typeof(receipt) = 'object')
);
create index intake_commit_attempts_workspace_idx on public.intake_commit_attempts (workspace_id);
create index intake_commit_attempts_group_idx on public.intake_commit_attempts (group_id);

-- Immutable transition / audit log ------------------------------------------------------
-- The intake control plane's own append-only audit trail. Phase 3's
-- public.audit_events is deliberately NOT reused: its event_type CHECK and its
-- import/source/crosswalk foreign keys are scoped to the provenance domain, and
-- widening that governed Phase 3 table to carry intake events would blur two
-- separately-governed audit surfaces. Every intake state transition, edit,
-- candidate change, commit, conflict, failure, and abandon records actor,
-- timestamp, workspace, prior state, resulting state, and a structured reason.
create table public.intake_transition_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  event_seq bigint generated always as identity,
  session_id uuid,
  group_id uuid,
  event_type text not null check (event_type in (
    'session_created', 'session_abandoned',
    'group_created', 'group_updated', 'entry_updated',
    'candidate_attached', 'candidate_removed',
    'state_transition', 'commit', 'commit_conflict', 'commit_failed', 'abandon'
  )),
  prior_state text,
  resulting_state text,
  actor_user_id uuid references auth.users (id),
  actor_process text not null check (actor_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  reason jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  constraint intake_transition_events_reason_is_object check (jsonb_typeof(reason) = 'object')
);
create index intake_transition_events_workspace_idx
  on public.intake_transition_events (workspace_id, event_seq desc);
create index intake_transition_events_group_idx on public.intake_transition_events (group_id);

-- updated_at maintenance for the mutable DRAFT tables only. The receipt and the
-- transition log are append-only and carry no updated_at.
create trigger intake_sessions_touch_updated_at
  before update on public.intake_sessions
  for each row execute function app.touch_updated_at();
create trigger intake_draft_groups_touch_updated_at
  before update on public.intake_draft_groups
  for each row execute function app.touch_updated_at();
create trigger intake_entries_touch_updated_at
  before update on public.intake_entries
  for each row execute function app.touch_updated_at();
create trigger intake_candidate_links_touch_updated_at
  before update on public.intake_candidate_links
  for each row execute function app.touch_updated_at();

-- Sequence backing newly-minted intake lot public ids (RV-I-<digits>), which
-- must match inventory_lots' digit-only public_id shape. A sequence guarantees
-- uniqueness without a hot per-workspace counter row.
create sequence app.intake_lot_public_seq;
revoke all on sequence app.intake_lot_public_seq from public;

insert into public.schema_migrations_log (migration_name)
values ('20260722000100_intake_kernel_schema');
