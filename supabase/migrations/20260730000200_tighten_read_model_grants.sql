-- Tighten the client grants on the cycle-count read models.
--
-- Found by verifying the live project after applying the cycle-count
-- migrations, not by reading the code: `authenticated` held INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES and TRIGGER on both cycle-count views.
--
-- The cause is a difference between environments rather than a mistake in the
-- view definitions. A hosted Supabase project ships with
--   alter default privileges in schema public grant all on tables to authenticated
-- so every table AND VIEW created afterwards starts with the full set. The
-- cycle-count migrations wrote `revoke all ... from public, anon` for the views
-- and then granted select to authenticated — which never removes what the
-- default privileges had already handed over. The plain-PostgreSQL shim has no
-- such default privileges, so the same SQL produced a correctly locked-down
-- view locally and a loose one on the live project. That is exactly the kind of
-- drift that only appears when the live grants are actually inspected.
--
-- The exposure was latent rather than active: both views are non-auto-updatable
-- (one is full of scalar subqueries, the other is a UNION ALL), so PostgreSQL
-- refuses DML against them regardless of privilege, and neither has an
-- INSTEAD OF trigger. Nothing could have been written through them. It is
-- corrected anyway — a grant that only fails because of a second, unrelated
-- property of the object is not a boundary anyone should rely on.
--
-- Written so it is safe on both environments and idempotent on re-run.

revoke all on table public.cycle_count_session_overview
  from public, anon, authenticated;
grant select on table public.cycle_count_session_overview to authenticated;

revoke all on table public.cycle_count_post_snapshot_activity
  from public, anon, authenticated;
grant select on table public.cycle_count_post_snapshot_activity to authenticated;

-- The base tables are re-asserted for the same reason. Their own migrations do
-- revoke from authenticated explicitly, so this changes nothing today; it means
-- a future default-privileges change cannot quietly widen them either.
revoke insert, update, delete, truncate, references, trigger on table
  public.cycle_count_sessions,
  public.cycle_count_scope_locations,
  public.cycle_count_expected_items,
  public.cycle_count_expected_lots,
  public.cycle_count_item_observations,
  public.cycle_count_lot_observations,
  public.cycle_count_discrepancies,
  public.cycle_count_resolutions,
  public.inventory_loss_events
  from public, anon, authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260730000200_tighten_read_model_grants');
