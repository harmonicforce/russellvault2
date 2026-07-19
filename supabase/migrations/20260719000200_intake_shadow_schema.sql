-- Phase 2 shadow foundation — migration 2: intake/configuration shadow schema.
--
-- Newly created in Phase 2; there is no pre-existing PostgreSQL data to
-- preserve or backfill. Deliberately excludes acquisition, purchase,
-- cost-basis, listing, sales, and all other commerce-domain schema.
--
-- Conventions applied to every workspace-scoped table:
--   * internal identity is a UUID primary key; the public business identifier
--     (public_id / sku / *_key / code) is a separate column, unique per
--     workspace — public business IDs remain canonical, UUIDs are internal;
--   * workspace_id is NOT NULL and references public.workspaces;
--   * a UNIQUE (id, workspace_id) key lets children carry composite foreign
--     keys that make cross-workspace relationships impossible at the
--     constraint level, not just at the policy level;
--   * business foreign keys are ON DELETE RESTRICT so evidence rows cannot be
--     removed by cascade.

-- Sessions -------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  label text check (label is null or char_length(label) <= 200),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, public_id),
  unique (id, workspace_id),
  check (closed_at is null or closed_at >= opened_at)
);

create index sessions_workspace_idx on public.sessions (workspace_id);

-- Intake groups --------------------------------------------------------------
create table public.intake_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  session_id uuid not null,
  public_id text not null check (public_id ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  label text not null check (char_length(label) between 1 and 200),
  quantity_expected integer not null check (quantity_expected between 1 and 10000),
  status text not null default 'pending' check (status in ('pending', 'expanded', 'cancelled')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, public_id),
  unique (id, workspace_id),
  -- Composite FK: a group can only belong to a session in the same workspace.
  foreign key (session_id, workspace_id)
    references public.sessions (id, workspace_id) on delete restrict
);

create index intake_groups_workspace_idx on public.intake_groups (workspace_id);
create index intake_groups_session_idx on public.intake_groups (session_id);

-- Items ----------------------------------------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  session_id uuid not null,
  intake_group_id uuid,
  -- Public business identifier (minted SKU, e.g. RV-N-000001).
  sku text not null check (sku ~ '^[A-Z][A-Z0-9-]{2,31}$'),
  name text check (name is null or char_length(name) <= 300),
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, sku),
  unique (id, workspace_id),
  foreign key (session_id, workspace_id)
    references public.sessions (id, workspace_id) on delete restrict,
  foreign key (intake_group_id, workspace_id)
    references public.intake_groups (id, workspace_id) on delete restrict
);

create index items_workspace_idx on public.items (workspace_id);
create index items_session_idx on public.items (session_id);
create index items_group_idx on public.items (intake_group_id);

-- Photos ---------------------------------------------------------------------
-- Private evidence. storage_path must live inside the owning workspace's and
-- item's folder: <workspace_id>/<item_id>/<filename>. Enforced here as CHECK
-- constraints and again by the storage policies in migration 5.
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  item_id uuid not null,
  storage_path text not null,
  kind text not null default 'photo' check (kind in ('photo', 'evidence')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, storage_path),
  unique (id, workspace_id),
  foreign key (item_id, workspace_id)
    references public.items (id, workspace_id) on delete restrict,
  constraint photos_path_in_workspace check (split_part(storage_path, '/', 1) = workspace_id::text),
  constraint photos_path_in_item check (split_part(storage_path, '/', 2) = item_id::text),
  constraint photos_path_filename check (
    split_part(storage_path, '/', 3) ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    and split_part(storage_path, '/', 4) = ''
  )
);

create index photos_workspace_idx on public.photos (workspace_id);
create index photos_item_idx on public.photos (item_id);

-- Photo requirements (configuration) -----------------------------------------
create table public.photo_requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (char_length(label) between 1 and 200),
  min_count integer not null default 1 check (min_count between 0 and 20),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code),
  unique (id, workspace_id)
);

create index photo_requirements_workspace_idx on public.photo_requirements (workspace_id);

-- Reference lists and options (configuration) --------------------------------
create table public.reference_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  list_key text not null check (list_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (char_length(label) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, list_key),
  unique (id, workspace_id)
);

create index reference_lists_workspace_idx on public.reference_lists (workspace_id);

create table public.reference_options (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  list_id uuid not null,
  value text not null check (char_length(value) between 1 and 200),
  label text not null check (char_length(label) between 1 and 200),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, list_id, value),
  unique (id, workspace_id),
  foreign key (list_id, workspace_id)
    references public.reference_lists (id, workspace_id) on delete cascade
);

create index reference_options_workspace_idx on public.reference_options (workspace_id);
create index reference_options_list_idx on public.reference_options (list_id);

-- Field registry and rules (configuration) -----------------------------------
create table public.field_registry (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null check (char_length(label) between 1 and 200),
  data_type text not null check (data_type in ('text', 'number', 'boolean', 'date', 'reference')),
  reference_list_id uuid,
  is_custom boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, field_key),
  unique (id, workspace_id),
  foreign key (reference_list_id, workspace_id)
    references public.reference_lists (id, workspace_id) on delete restrict,
  check ((data_type = 'reference') = (reference_list_id is not null))
);

create index field_registry_workspace_idx on public.field_registry (workspace_id);

create table public.field_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  field_id uuid not null,
  rule_type text not null check (rule_type in ('required', 'regex', 'min', 'max', 'allowed_values')),
  rule_config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, field_id, rule_type),
  unique (id, workspace_id),
  foreign key (field_id, workspace_id)
    references public.field_registry (id, workspace_id) on delete cascade
);

create index field_rules_workspace_idx on public.field_rules (workspace_id);
create index field_rules_field_idx on public.field_rules (field_id);

-- updated_at triggers ---------------------------------------------------------
create trigger sessions_touch_updated_at
  before update on public.sessions
  for each row execute function app.touch_updated_at();
create trigger intake_groups_touch_updated_at
  before update on public.intake_groups
  for each row execute function app.touch_updated_at();
create trigger items_touch_updated_at
  before update on public.items
  for each row execute function app.touch_updated_at();
create trigger photos_touch_updated_at
  before update on public.photos
  for each row execute function app.touch_updated_at();
create trigger photo_requirements_touch_updated_at
  before update on public.photo_requirements
  for each row execute function app.touch_updated_at();
create trigger reference_lists_touch_updated_at
  before update on public.reference_lists
  for each row execute function app.touch_updated_at();
create trigger reference_options_touch_updated_at
  before update on public.reference_options
  for each row execute function app.touch_updated_at();
create trigger field_registry_touch_updated_at
  before update on public.field_registry
  for each row execute function app.touch_updated_at();
create trigger field_rules_touch_updated_at
  before update on public.field_rules
  for each row execute function app.touch_updated_at();

insert into public.schema_migrations_log (migration_name)
values ('20260719000200_intake_shadow_schema');
