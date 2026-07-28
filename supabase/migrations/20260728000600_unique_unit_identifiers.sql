-- Stabilization — migration 6: a unique identifier can never be replicated
-- across the units of one intake group.
--
-- inventory_items already carries inventory_items_serial_uniq on
-- (workspace_id, serial_number), so a duplicated serial could never actually
-- be WRITTEN — the second unit's insert raised a unique violation and the
-- whole commit rolled back. The data was safe; the experience was not. An
-- operator who entered quantity 3 with one serial got an opaque 23505 at
-- commit time, after filling in everything, with nothing naming the cause.
--
-- This moves the refusal to the moment the draft is written, where it can be
-- reported as a readable blocker, and enforces it server-side so a malformed
-- client that bypasses the form cannot slip past either.
--
-- Implemented as a trigger rather than by rewriting app.intake_validate_group:
-- purely additive, and it cannot disturb the validated commit path.

create function app.intake_entry_unique_identifiers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A blank serial is a legitimate "not recorded" for most categories and is
  -- never treated as a duplicate of another blank.
  if new.serial_number is not null and btrim(new.serial_number) <> '' then
    if exists (
      select 1 from public.intake_entries e
      where e.group_id = new.group_id
        and e.id is distinct from new.id
        and e.serial_number is not null
        and btrim(e.serial_number) = btrim(new.serial_number)
    ) then
      raise exception
        'serial number % is already used by another unit in this group; each unit needs its own identifier',
        btrim(new.serial_number)
        using errcode = '23505';
    end if;
  end if;

  -- The same rule for certificates: two units of one group cannot share one
  -- certificate number, which would describe two objects with one identity.
  if new.certificate_number is not null and btrim(new.certificate_number) <> '' then
    if exists (
      select 1 from public.intake_entries e
      where e.group_id = new.group_id
        and e.id is distinct from new.id
        and e.certificate_number is not null
        and btrim(e.certificate_number) = btrim(new.certificate_number)
    ) then
      raise exception
        'certificate number % is already used by another unit in this group',
        btrim(new.certificate_number)
        using errcode = '23505';
    end if;
  end if;

  return new;
end
$$;

revoke all on function app.intake_entry_unique_identifiers() from public, anon;

create trigger intake_entries_unique_unit_identifiers
  before insert or update on public.intake_entries
  for each row execute function app.intake_entry_unique_identifiers();

insert into public.schema_migrations_log (migration_name)
values ('20260728000600_unique_unit_identifiers');
