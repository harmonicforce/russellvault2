-- Phase 6A intake kernel — migration 2: append-only immutability + terminal freeze.
--
-- The commit receipt and the transition-audit log are FULLY append-only. The
-- governed config (registry, rules, reference lists/options) is seed-once
-- immutable. Draft records are editable ONLY while their group is a draft; once
-- a group reaches a terminal state (committed or abandoned) it and its entries
-- and candidate links are frozen, so a committed group's identity, quantity,
-- serialization policy, serialized children, source evidence, location, and
-- resulting Product/SKU/Lot/Item relationships can never silently change.
-- Corrections after commit must go through a later governed correction or
-- supersession path (a future phase), never an in-place mutation here.

-- Fully append-only: receipts and the audit log ----------------------------------------
create trigger intake_commit_attempts_append_only
  before update or delete on public.intake_commit_attempts
  for each row execute function app.forbid_update_delete();
create trigger intake_commit_attempts_append_only_truncate
  before truncate on public.intake_commit_attempts
  for each statement execute function app.forbid_update_delete();

create trigger intake_transition_events_append_only
  before update or delete on public.intake_transition_events
  for each row execute function app.forbid_update_delete();
create trigger intake_transition_events_append_only_truncate
  before truncate on public.intake_transition_events
  for each statement execute function app.forbid_update_delete();

-- Seed-once immutable governed config ---------------------------------------------------
create trigger intake_field_registry_append_only
  before update or delete on public.intake_field_registry
  for each row execute function app.forbid_update_delete();
create trigger intake_field_rules_append_only
  before update or delete on public.intake_field_rules
  for each row execute function app.forbid_update_delete();
create trigger intake_reference_lists_append_only
  before update or delete on public.intake_reference_lists
  for each row execute function app.forbid_update_delete();
create trigger intake_reference_options_append_only
  before update or delete on public.intake_reference_options
  for each row execute function app.forbid_update_delete();

-- Intake sessions: identity columns frozen; state/abandon fields governed --------------
create trigger intake_sessions_identity_immutable
  before update on public.intake_sessions
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'opened_by', 'opened_at', 'created_at'
  );
create trigger intake_sessions_no_delete
  before delete on public.intake_sessions
  for each row execute function app.forbid_update_delete();
create trigger intake_sessions_no_truncate
  before truncate on public.intake_sessions
  for each statement execute function app.forbid_update_delete();

-- Draft groups: never deletable (abandon, don't delete); identity columns frozen;
-- terminal groups frozen entirely. ----------------------------------------------------
create trigger intake_draft_groups_identity_immutable
  before update on public.intake_draft_groups
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'session_id', 'created_by', 'created_at'
  );

-- Freeze a group once it is terminal: no UPDATE may touch a committed/abandoned
-- group, and no DELETE is ever permitted. The single governed transition update
-- (draft/ready_to_commit -> committed|abandoned) is allowed because OLD.state is
-- not yet terminal when it runs.
create function app.intake_freeze_terminal_group()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'intake draft groups are never deleted; abandon the group instead'
      using errcode = 'insufficient_privilege';
  end if;
  if old.state in ('committed', 'abandoned') then
    raise exception 'intake group % is % and is frozen; use a governed correction path',
      old.public_id, old.state using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
revoke all on function app.intake_freeze_terminal_group() from public;

create trigger intake_draft_groups_freeze_terminal
  before update or delete on public.intake_draft_groups
  for each row execute function app.intake_freeze_terminal_group();
create trigger intake_draft_groups_no_truncate
  before truncate on public.intake_draft_groups
  for each statement execute function app.forbid_update_delete();

-- Entries and candidate links: editable only while the parent group is a draft.
create function app.intake_forbid_when_group_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := coalesce(new.group_id, old.group_id);
  v_workspace_id uuid := coalesce(new.workspace_id, old.workspace_id);
  v_state public.intake_group_state;
begin
  select state into v_state from public.intake_draft_groups
  where id = v_group_id and workspace_id = v_workspace_id;
  if v_state in ('committed', 'abandoned') then
    raise exception '% on % is refused: parent intake group is %',
      tg_op, tg_table_name, v_state using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end
$$;
revoke all on function app.intake_forbid_when_group_terminal() from public;

create trigger intake_entries_identity_immutable
  before update on public.intake_entries
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'public_id', 'group_id', 'entry_index', 'created_by', 'created_at'
  );
create trigger intake_entries_guard_terminal
  before update or delete on public.intake_entries
  for each row execute function app.intake_forbid_when_group_terminal();
create trigger intake_entries_no_truncate
  before truncate on public.intake_entries
  for each statement execute function app.forbid_update_delete();

create trigger intake_candidate_links_guard_terminal
  before insert or update or delete on public.intake_candidate_links
  for each row execute function app.intake_forbid_when_group_terminal();
create trigger intake_candidate_links_no_truncate
  before truncate on public.intake_candidate_links
  for each statement execute function app.forbid_update_delete();

insert into public.schema_migrations_log (migration_name)
values ('20260722000200_intake_kernel_append_only');
