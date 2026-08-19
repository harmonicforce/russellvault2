-- Fail closed when the governed acquisition mutation GUCs are unset.
create or replace function app.guard_acquisition_event_rows()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.governed_acquisition_mutation', true), '') <> 'on' then
    raise exception 'governed_write_required' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;

create or replace function app.guard_acquisition_line_exclusion_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'append_only_violation' using errcode = '55000';
  end if;
  if coalesce(current_setting('app.governed_acquisition_exclusion_mutation', true), '') <> 'on'
    or new.id <> old.id or new.workspace_id <> old.workspace_id or new.public_id <> old.public_id
    or new.acquisition_line_item_id <> old.acquisition_line_item_id or new.decision_state <> old.decision_state
    or new.reason <> old.reason or new.idempotency_key <> old.idempotency_key or new.payload_fingerprint <> old.payload_fingerprint
    or new.created_by <> old.created_by or new.created_at <> old.created_at or old.superseded_at is not null
    or new.superseded_at is null or new.superseded_by_exclusion_id is null or new.supersedes_exclusion_id is distinct from old.supersedes_exclusion_id
  then
    raise exception 'append_only_violation' using errcode = '55000';
  end if;
  return new;
end
$$;

insert into public.schema_migrations_log(migration_name)
values ('20260819000200_null_safe_acquisition_mutation_guards');
