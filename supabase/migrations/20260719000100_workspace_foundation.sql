-- Phase 2 shadow foundation — migration 1: workspaces and membership.
--
-- Newly created in Phase 2. No earlier PostgreSQL/Supabase schema existed in
-- this repository; nothing here migrates, hardens, or preserves pre-existing
-- database objects. The shadow database is local-only and non-authoritative.

-- Migration bookkeeping ------------------------------------------------------
create table public.schema_migrations_log (
  id bigint generated always as identity primary key,
  migration_name text not null unique,
  applied_at timestamptz not null default now()
);

alter table public.schema_migrations_log enable row level security;
-- No policies: only the database owner / service_role may read or write.
revoke all on table public.schema_migrations_log from public, anon, authenticated;

-- Roles ----------------------------------------------------------------------
create type public.workspace_role as enum ('owner', 'operator', 'viewer');

-- Internal helper schema -----------------------------------------------------
-- Holds privileged helpers used by RLS policies and triggers. Nothing in this
-- schema is callable by anon; authenticated only gets the specific helpers
-- that policies evaluate.
create schema app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

-- Workspaces -----------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  -- Public business identifiers stay canonical: SKUs minted in this workspace
  -- use this prefix + a 6-digit counter (matches the legacy RV-N-000001 shape).
  sku_prefix text not null default 'RV-N-' check (sku_prefix ~ '^[A-Z][A-Z0-9-]{0,15}$'),
  last_sku_number bigint not null default 0 check (last_sku_number >= 0),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

-- Membership helper ----------------------------------------------------------
-- SECURITY DEFINER so RLS policies on workspace_members itself can call it
-- without recursing. Fixed empty search_path; every reference is qualified.
create function app.member_role(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = p_workspace_id
    and m.user_id = auth.uid()
$$;

revoke all on function app.member_role(uuid) from public;
grant execute on function app.member_role(uuid) to authenticated;

-- updated_at maintenance -----------------------------------------------------
create function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function app.touch_updated_at() from public;

create trigger workspaces_touch_updated_at
  before update on public.workspaces
  for each row execute function app.touch_updated_at();

create trigger workspace_members_touch_updated_at
  before update on public.workspace_members
  for each row execute function app.touch_updated_at();

-- Workspace bootstrap --------------------------------------------------------
-- Creating a workspace automatically makes its creator the first owner, so a
-- workspace can never exist without an owner and no broad INSERT policy on
-- workspace_members is needed for bootstrap.
create function app.add_workspace_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end
$$;

revoke all on function app.add_workspace_creator_as_owner() from public;

create trigger workspaces_add_creator_as_owner
  after insert on public.workspaces
  for each row execute function app.add_workspace_creator_as_owner();

-- Last-owner protection ------------------------------------------------------
-- A workspace must always retain at least one owner; demoting or removing the
-- final owner is refused.
create function app.ensure_owner_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- When the workspace row itself is already gone, this delete is the ON
  -- DELETE CASCADE from deleting the workspace — nothing left to protect.
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return coalesce(new, old);
  end if;
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.workspace_id <> old.workspace_id) then
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = old.workspace_id
        and m.role = 'owner'
        and m.id <> old.id
    ) then
      raise exception 'workspace must retain at least one owner'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end
$$;

revoke all on function app.ensure_owner_remains() from public;

create trigger workspace_members_ensure_owner_remains
  before update or delete on public.workspace_members
  for each row execute function app.ensure_owner_remains();

-- Row-level security ---------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- Explicitly no access for anon: business data is never anonymous-readable.
revoke all on table public.workspaces from public, anon;
revoke all on table public.workspace_members from public, anon;
grant select, insert, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_members to authenticated;

-- workspaces: members read; any authenticated user may create a workspace for
-- themselves; only owners administer or delete it.
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (app.member_role(id) is not null);

create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy workspaces_update on public.workspaces
  for update to authenticated
  using (app.member_role(id) = 'owner')
  with check (app.member_role(id) = 'owner');

create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using (app.member_role(id) = 'owner');

-- workspace_members: members see their workspace roster; only owners manage it.
create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (app.member_role(workspace_id) is not null);

create policy workspace_members_insert on public.workspace_members
  for insert to authenticated
  with check (app.member_role(workspace_id) = 'owner');

create policy workspace_members_update on public.workspace_members
  for update to authenticated
  using (app.member_role(workspace_id) = 'owner')
  with check (app.member_role(workspace_id) = 'owner');

create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (app.member_role(workspace_id) = 'owner');

insert into public.schema_migrations_log (migration_name)
values ('20260719000100_workspace_foundation');
