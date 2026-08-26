-- Receiving RPC Dispatch Repair — ESC-002.
--
-- THE DEFECT
--
-- 20260808000100_s2_receiving_functions.sql declared three of its governed
-- receiving wrappers with a bare type list and no parameter names:
--
--   create function public.submit_acquisition_receipt(uuid,text) ...
--   create function public.cancel_acquisition_receipt(uuid,text,text) ...
--   create function public.reconcile_acquisition_receipt(uuid,text) ...
--
-- Every other function in that file names its parameters (p_workspace_id,
-- p_receipt_public_id, ...). These three did not, so pg_proc.proargnames is
-- NULL for them.
--
-- PostgREST resolves a JSON-body RPC by matching the body's keys to parameter
-- NAMES. A function with no parameter names has nothing to match, and its only
-- remaining calling convention — a single unnamed json/jsonb parameter — does
-- not apply to (uuid,text) or (uuid,text,text). So all three were unreachable
-- through the transport the application actually uses, and answered:
--
--   PGRST202 / HTTP 404
--   "Could not find the function public.submit_acquisition_receipt
--    (p_receipt_public_id, p_workspace_id) in the schema cache"
--
-- WHY THE EXISTING TESTS DID NOT CATCH IT
--
-- The pgTAP suite calls these functions POSITIONALLY from SQL, where unnamed
-- parameters are perfectly legal. The database semantics were never broken —
-- only the dispatch membrane was. The defect was invisible until Work Order 4
-- generated the database contract from the catalog and the three functions came
-- back absent, because the generator omits what PostgREST cannot call.
--
-- THE REPAIR, AND WHY IT IS THIS SHAPE
--
-- CREATE OR REPLACE FUNCTION rejects RENAMING an existing input parameter, but
-- it explicitly permits ADDING a name to a parameter that had none. That is
-- exactly this case, so no DROP is required. This matters:
--
--   * the function identity (schema, name, argument types) is unchanged, so
--     nothing that references it has to be found and rebuilt;
--   * the ACL survives — EXECUTE stays granted to `authenticated` and to no one
--     else, with no re-GRANT that could widen or narrow it by accident;
--   * ownership, SECURITY DEFINER, volatility, strictness, parallel safety and
--     `search_path=''` all survive untouched;
--   * there is no window in which the governed function does not exist, and no
--     CASCADE that could silently remove a dependent.
--
-- The bodies keep their positional $1/$2/$3 references rather than switching to
-- the new names. Both forms are legal in a SQL-language function and mean the
-- same thing; keeping the original text makes this migration provably an
-- INTERFACE change and nothing else.
--
-- The names are not invented to satisfy the generator. They are the names the
-- delegate app.transition_receipt(p_workspace_id, p_receipt_public_id, p_action,
-- p_reason) already uses, the names every sibling in the S2 receiving migration
-- already uses, and the names server/src/routes/receiving.ts is already sending.

create or replace function public.submit_acquisition_receipt(p_workspace_id uuid, p_receipt_public_id text)
returns jsonb language sql security definer set search_path='' as $$select app.transition_receipt($1,$2,'submit')$$;

create or replace function public.cancel_acquisition_receipt(p_workspace_id uuid, p_receipt_public_id text, p_reason text)
returns jsonb language sql security definer set search_path='' as $$select app.transition_receipt($1,$2,'cancel',$3)$$;

create or replace function public.reconcile_acquisition_receipt(p_workspace_id uuid, p_receipt_public_id text)
returns jsonb language sql security definer set search_path='' as $$select app.transition_receipt($1,$2,'reconcile')$$;

-- Self-verification, inside the same transaction as the repair.
--
-- A migration whose whole purpose is "these parameters now have names" must not
-- be able to report success while leaving one of them unnamed. This asserts the
-- postcondition against the catalog rather than trusting the DDL above, so a
-- partially applied or silently altered state fails the migration instead of
-- shipping a function the transport still cannot reach.
do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('submit_acquisition_receipt','cancel_acquisition_receipt','reconcile_acquisition_receipt')
    and (p.proargnames is null or cardinality(p.proargnames) <> p.pronargs or '' = any(p.proargnames));
  if bad is not null then
    raise exception 'receiving RPC dispatch repair incomplete: unnamed parameters remain on %', bad
      using errcode = '55000';
  end if;
end $$;
