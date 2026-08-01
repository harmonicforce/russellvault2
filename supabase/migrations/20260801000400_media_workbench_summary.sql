-- Media and Photography Hardening — migration 4: workbench summary.
--
-- The Workbench previously asked one question about photographs ("has this
-- record got any?"). Readiness answers a more useful one, but the Workbench
-- needs it as a bounded aggregate rather than a row per inventory record.

create or replace function public.get_media_readiness_summary(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare v_counts jsonb;
begin
  if app.member_role(p_workspace_id) is null then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(readiness_status, subject_count), '{}'::jsonb)
    into v_counts
    from (
      select readiness_status, count(*)::int as subject_count
        from public.inventory_media_readiness
       where workspace_id = p_workspace_id
       group by readiness_status
    ) grouped;

  return jsonb_build_object(
    'counts', v_counts,
    'open_issue_count', (select count(*)::int from public.inventory_media_issues
                          where workspace_id = p_workspace_id and state = 'open'));
end
$$;

revoke all on function public.get_media_readiness_summary(uuid) from public, anon;
grant execute on function public.get_media_readiness_summary(uuid) to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260801000400_media_workbench_summary');
