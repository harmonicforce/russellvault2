-- Phase 2 shadow foundation — migration 4: database functions.
--
-- All public entry points are SECURITY DEFINER with a fixed empty search_path
-- (every reference schema-qualified), perform authentication and
-- workspace-membership authorization internally, validate their inputs, and
-- are executable only by the authenticated role — never by anon or PUBLIC.
-- None of them can act across workspaces: every row they touch is resolved
-- through the caller's membership.

-- Internal authorization helper ----------------------------------------------
-- Returns the caller's user id after verifying authentication, membership in
-- the workspace, and that the caller's role is one of p_allowed. Raises the
-- same error for "workspace missing" and "not a member" so callers cannot
-- probe for foreign workspace ids.
create function app.assert_workspace_role(
  p_workspace_id uuid,
  p_allowed public.workspace_role[]
)
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
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_workspace_id is null then
    raise exception 'workspace id is required' using errcode = '22023';
  end if;

  select m.role into v_role
  from public.workspace_members m
  where m.workspace_id = p_workspace_id
    and m.user_id = v_uid;

  if v_role is null then
    raise exception 'workspace not found or not authorized' using errcode = '42501';
  end if;
  if not (v_role = any (p_allowed)) then
    raise exception 'insufficient role for this operation' using errcode = '42501';
  end if;

  return v_uid;
end
$$;

revoke all on function app.assert_workspace_role(uuid, public.workspace_role[]) from public;

-- Internal SKU counter --------------------------------------------------------
-- No authorization of its own (and no grants): callable only via the definer
-- entry points below, which authorize first. Row-locks the workspace counter,
-- so concurrent mints serialize and never collide.
create function app.next_sku(p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_next bigint;
begin
  update public.workspaces
  set last_sku_number = last_sku_number + 1,
      updated_at = now()
  where id = p_workspace_id
  returning sku_prefix, last_sku_number into v_prefix, v_next;

  if not found then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;

  return v_prefix || lpad(v_next::text, 6, '0');
end
$$;

revoke all on function app.next_sku(uuid) from public;

-- mint_sku ---------------------------------------------------------------------
-- Mints the next public SKU for the caller's workspace. Owner/operator only.
create function public.mint_sku(p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_workspace_role(p_workspace_id, array['owner', 'operator']::public.workspace_role[]);
  return app.next_sku(p_workspace_id);
end
$$;

revoke all on function public.mint_sku(uuid) from public, anon;
grant execute on function public.mint_sku(uuid) to authenticated;

-- expand_intake_group ----------------------------------------------------------
-- Expands a pending intake group into quantity_expected draft items, minting a
-- SKU for each. Owner/operator only, and only within the caller's workspace.
-- Authorization is part of the row lookup itself: the membership predicate is
-- evaluated in the WHERE clause, so a row that the caller is not authorized
-- for is never returned — and FOR UPDATE only locks rows that satisfy the
-- WHERE clause, so an unauthorized caller never locks (or even reads into a
-- variable) another workspace's row. Nonexistent and unauthorized groups
-- produce byte-identical errors. Transaction-safe: for authorized callers the
-- group row is locked, so concurrent expansion attempts serialize and the
-- second one fails on the status check.
create function public.expand_intake_group(p_group_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public.intake_groups%rowtype;
  v_session_status text;
  v_ids uuid[] := '{}';
  v_id uuid;
  i integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_group_id is null then
    raise exception 'intake group id is required' using errcode = '22023';
  end if;

  select g.* into v_group
  from public.intake_groups g
  where g.id = p_group_id
    and exists (
      select 1
      from public.workspace_members m
      where m.workspace_id = g.workspace_id
        and m.user_id = v_uid
        and m.role in ('owner', 'operator')
    )
  for update of g;

  if not found then
    raise exception 'intake group not found or not authorized' using errcode = '42501';
  end if;

  if v_group.status <> 'pending' then
    raise exception 'intake group % is not pending (status: %)', v_group.public_id, v_group.status
      using errcode = '55000';
  end if;

  select s.status into v_session_status
  from public.sessions s
  where s.id = v_group.session_id;
  if v_session_status <> 'open' then
    raise exception 'session for intake group % is not open', v_group.public_id
      using errcode = '55000';
  end if;

  for i in 1..v_group.quantity_expected loop
    insert into public.items (workspace_id, session_id, intake_group_id, sku, name, status, created_by)
    values (
      v_group.workspace_id,
      v_group.session_id,
      v_group.id,
      app.next_sku(v_group.workspace_id),
      v_group.label || ' #' || i,
      'draft',
      v_uid
    )
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  update public.intake_groups
  set status = 'expanded', updated_at = now()
  where id = v_group.id;

  return v_ids;
end
$$;

revoke all on function public.expand_intake_group(uuid) from public, anon;
grant execute on function public.expand_intake_group(uuid) to authenticated;

-- delete_intake_group_safe -----------------------------------------------------
-- Deletes an intake group only when no items reference it. Owner/operator
-- only, within the caller's workspace. Never cascades to evidence. Same
-- authorize-in-the-lookup construction as expand_intake_group: the membership
-- predicate is part of the WHERE clause, so an unauthorized caller never
-- reads or locks a foreign row, and nonexistent/unauthorized are identical.
create function public.delete_intake_group_safe(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group public.intake_groups%rowtype;
  v_item_count bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_group_id is null then
    raise exception 'intake group id is required' using errcode = '22023';
  end if;

  select g.* into v_group
  from public.intake_groups g
  where g.id = p_group_id
    and exists (
      select 1
      from public.workspace_members m
      where m.workspace_id = g.workspace_id
        and m.user_id = v_uid
        and m.role in ('owner', 'operator')
    )
  for update of g;

  if not found then
    raise exception 'intake group not found or not authorized' using errcode = '42501';
  end if;

  select count(*) into v_item_count
  from public.items i
  where i.intake_group_id = v_group.id;

  if v_item_count > 0 then
    raise exception 'refusing to delete intake group %: % item(s) reference it', v_group.public_id, v_item_count
      using errcode = '55000';
  end if;

  delete from public.intake_groups where id = v_group.id;
end
$$;

revoke all on function public.delete_intake_group_safe(uuid) from public, anon;
grant execute on function public.delete_intake_group_safe(uuid) to authenticated;

-- create_custom_field ----------------------------------------------------------
-- Registers a custom field in the workspace's field registry. Configuration
-- administration, so owner-only. Validates the key, label, and data type; a
-- reference field must point at a reference list in the same workspace.
create function public.create_custom_field(
  p_workspace_id uuid,
  p_field_key text,
  p_label text,
  p_data_type text,
  p_reference_list_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.assert_workspace_role(p_workspace_id, array['owner']::public.workspace_role[]);

  if p_field_key is null or p_field_key !~ '^[a-z][a-z0-9_]{1,62}$' then
    raise exception 'invalid field key (expected lower_snake_case, 2-63 chars)' using errcode = '22023';
  end if;
  if p_label is null or char_length(p_label) not between 1 and 200 then
    raise exception 'invalid field label (1-200 characters)' using errcode = '22023';
  end if;
  if p_data_type is null or p_data_type not in ('text', 'number', 'boolean', 'date', 'reference') then
    raise exception 'invalid data type (text, number, boolean, date, reference)' using errcode = '22023';
  end if;

  if p_data_type = 'reference' then
    if p_reference_list_id is null then
      raise exception 'reference fields require a reference list' using errcode = '22023';
    end if;
    -- The list must exist in the SAME workspace; a foreign list id is treated
    -- as nonexistent.
    if not exists (
      select 1 from public.reference_lists l
      where l.id = p_reference_list_id
        and l.workspace_id = p_workspace_id
    ) then
      raise exception 'reference list not found in this workspace' using errcode = '22023';
    end if;
  elsif p_reference_list_id is not null then
    raise exception 'only reference fields may set a reference list' using errcode = '22023';
  end if;

  begin
    insert into public.field_registry (workspace_id, field_key, label, data_type, reference_list_id, is_custom)
    values (p_workspace_id, p_field_key, p_label, p_data_type, p_reference_list_id, true)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'field key % already exists in this workspace', p_field_key using errcode = '23505';
  end;

  return v_id;
end
$$;

revoke all on function public.create_custom_field(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.create_custom_field(uuid, text, text, text, uuid) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260719000400_intake_functions');
