-- Cycle count — a serialized unit that is physically gone.
--
-- inventory_item_state already distinguishes `superseded` (this record was
-- wrong and a corrected one replaced it) from `void` (this record should never
-- have existed, e.g. a duplicate). Neither describes shrinkage: the record was
-- right, the object was real, and it is not on the shelf any more.
--
-- Recording that as `void` would be a lie in the audit trail -- it would claim
-- the unit never existed -- and would make genuine loss indistinguishable from
-- a data-entry duplicate when someone later asks what happened to the stock.
--
-- `lost` is its own terminal, non-countable state. Like the others it never
-- deletes the row: the unit keeps its certificate, serial, scan SKU, photos and
-- movement history, and simply stops being physical stock.
--
-- This is deliberately alone in its own migration. Postgres will not let a new
-- enum value be USED in the same transaction that adds it, and the Supabase CLI
-- applies each migration file inside a transaction, so the value has to be
-- committed here before 20260729000300 can reference it.
alter type public.inventory_item_state add value if not exists 'lost';

insert into public.schema_migrations_log (migration_name)
values ('20260729000100_inventory_item_lost_state');
