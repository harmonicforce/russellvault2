-- Supabase environment shim for plain local PostgreSQL.
--
-- Applied ONLY by scripts/db/reset.mjs, and ONLY when the target database has
-- no `auth` schema (i.e. it is a plain PostgreSQL instance, not a local
-- Supabase stack). It recreates the minimal surface the migrations and tests
-- depend on: the anon / authenticated / service_role roles, auth.users,
-- auth.uid(), auth.role(), and a minimal private storage schema.
--
-- This file is NOT a migration. It must never be applied to a real Supabase
-- project, where all of these objects already exist and are managed by the
-- platform.

-- Roles ----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- auth schema ----------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique,
  created_at timestamptz not null default now()
);

-- Mirrors Supabase's auth.uid(): resolves the calling user from JWT claim
-- settings. Tests impersonate users by setting request.jwt.claim.sub /
-- request.jwt.claims and switching to the anon/authenticated role.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  )
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- storage schema (minimal shim of Supabase Storage tables) -------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

-- Mirrors Supabase's storage.foldername(): all path segments except the last.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1 : array_upper(string_to_array(name, '/'), 1) - 1]
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
-- Table-level DML grants mirror the Supabase storage defaults; row access is
-- still governed entirely by the RLS policies in the migrations.
grant select on storage.buckets to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
