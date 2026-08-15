-- S2.4.1: terminal, history-preserving withdrawal for unconfirmed allocations.
alter type public.cost_allocation_state add value if not exists 'withdrawn';

insert into public.schema_migrations_log(migration_name)
values ('20260815000100_cost_allocation_withdrawn_state');
