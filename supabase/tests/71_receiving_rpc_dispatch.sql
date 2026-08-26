-- The receiving RPC DISPATCH contract (ESC-002).
--
-- This file exists because of a specific, instructive gap: the S2 pgTAP suite
-- proved the receiving state machine correct while three of its entry points
-- were unreachable by the application. Those tests call the functions
-- POSITIONALLY from SQL, where a parameter with no name is perfectly legal, so
-- nothing in a 2,673-assertion suite could see that PostgREST — which resolves
-- an RPC by matching a JSON body's keys to parameter NAMES — had no way to call
-- them at all.
--
-- The lesson generalises beyond these three functions: a governed function's
-- SQL semantics and its transport dispatchability are separate properties, and
-- proving the first says nothing about the second. So this file asserts the
-- dispatch contract directly against the catalog, for EVERY governed public
-- receiving RPC rather than only the three that were broken — a fourth one
-- declared without names later would fail here rather than reaching production.
--
-- The end-to-end proof that PostgREST actually resolves and executes these
-- functions lives in the transport suite, which speaks HTTP. This file proves
-- the database-side precondition that makes that possible, and proves the
-- repair changed nothing else about the three functions.
begin;
create extension if not exists pgtap;
select plan(27);

-- The governed receiving RPCs the server calls through PostgREST.
create function pg_temp.receiving_rpcs() returns table(fn text) language sql immutable as $$
  values ('open_acquisition_receipt'),('record_acquisition_receipt_line'),
         ('correct_acquisition_receipt_line'),('submit_acquisition_receipt'),
         ('cancel_acquisition_receipt'),('reconcile_acquisition_receipt'),
         ('link_acquisition_receipt_inventory'),('raise_acquisition_discrepancy'),
         ('transition_acquisition_discrepancy')
$$;

-- 1. EVERY governed receiving RPC is namable by PostgREST -------------------
-- proargnames NULL, a short array, or an empty-string entry all defeat
-- name-based dispatch, so each is rejected independently.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in (select fn from pg_temp.receiving_rpcs())
     and (p.proargnames is null or cardinality(p.proargnames) <> p.pronargs or '' = any(p.proargnames))),
  0,
  'every governed receiving RPC names all of its parameters, so PostgREST can dispatch by name'
);

-- 2. The three repaired functions, named exactly as their callers send ------
select is(
  (select array_to_string(proargnames,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='submit_acquisition_receipt'),
  'p_workspace_id,p_receipt_public_id',
  'submit_acquisition_receipt exposes the names server/src/routes/receiving.ts sends'
);
select is(
  (select array_to_string(proargnames,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='cancel_acquisition_receipt'),
  'p_workspace_id,p_receipt_public_id,p_reason',
  'cancel_acquisition_receipt exposes the names server/src/routes/receiving.ts sends'
);
select is(
  (select array_to_string(proargnames,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='reconcile_acquisition_receipt'),
  'p_workspace_id,p_receipt_public_id',
  'reconcile_acquisition_receipt exposes the names server/src/routes/receiving.ts sends'
);

-- 3. Exactly one overload each: PostgREST has an unambiguous target --------
-- Two overloads reachable by the same JSON body is a 300 Multiple Choices at
-- the transport, which would be a different outage wearing the same clothes.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=f.fn),
  1,
  format('public.%s has exactly one overload, so RPC dispatch is unambiguous', f.fn)
) from pg_temp.receiving_rpcs() f;

-- 4. The repair preserved every non-interface property ---------------------
-- Asserted as the exact tuple the pre-repair catalog reported, so a future
-- edit that quietly relaxes SECURITY DEFINER, the empty search_path, the
-- volatility, or the return type fails here.
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s',
                 p.prosecdef, p.provolatile, p.proparallel, p.proisstrict, p.proleakproof,
                 array_to_string(p.proconfig,','), pg_get_function_result(p.oid))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=f.fn),
  't|v|u|f|f|search_path=""|jsonb',
  format('public.%s kept SECURITY DEFINER, volatility, strictness, empty search_path and jsonb result', f.fn)
) from (values ('submit_acquisition_receipt'),('cancel_acquisition_receipt'),('reconcile_acquisition_receipt')) f(fn);

-- 5. EXECUTE is still granted to authenticated, and to nobody wider --------
-- A DROP-and-recreate repair would have silently dropped these grants; a
-- careless re-GRANT could have widened them to PUBLIC or anon. Neither happened.
select ok(
  has_function_privilege('authenticated', format('public.%s(%s)', f.fn, f.args)::text, 'EXECUTE'),
  format('authenticated may execute public.%s', f.fn)
) from (values ('submit_acquisition_receipt','uuid,text'),
               ('cancel_acquisition_receipt','uuid,text,text'),
               ('reconcile_acquisition_receipt','uuid,text')) f(fn,args);

select ok(
  not has_function_privilege('anon', format('public.%s(%s)', f.fn, f.args)::text, 'EXECUTE'),
  format('anon may NOT execute public.%s', f.fn)
) from (values ('submit_acquisition_receipt','uuid,text'),
               ('cancel_acquisition_receipt','uuid,text,text'),
               ('reconcile_acquisition_receipt','uuid,text')) f(fn,args);

select ok(
  not (coalesce(array_to_string(p.proacl,' '),'') like '%=X/%' and coalesce(array_to_string(p.proacl,' '),'') ~ '(^| )=X/'),
  format('public.%s does not grant EXECUTE to PUBLIC', p.proname)
) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('submit_acquisition_receipt','cancel_acquisition_receipt','reconcile_acquisition_receipt');

-- 6. The delegate is untouched --------------------------------------------
-- The repair moved the membrane, not the domain. app.transition_receipt still
-- owns every state-transition rule, and it is still not directly reachable.
select is(
  (select array_to_string(proargnames,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='app' and p.proname='transition_receipt'),
  'p_workspace_id,p_receipt_public_id,p_action,p_reason',
  'app.transition_receipt is unchanged: it still owns the receiving state transitions'
);
select ok(
  not has_function_privilege('authenticated','app.transition_receipt(uuid,text,text,text)','EXECUTE'),
  'app.transition_receipt is still not directly executable by authenticated callers'
);

select * from finish();
rollback;
