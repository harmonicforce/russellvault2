-- The cutover gate must give the SAME answer twice about the same evidence.
--
-- WHY THIS FILE EXISTS SEPARATELY FROM 68.
--
-- `68_reconciliation_ledger.sql` proves the gate's semantics: what blocks, what
-- clears, what fails closed. It caught the ordering defect only as a side
-- effect — tests 42 and 43 went red about half the time — and a test that fails
-- half the time reads as an infrastructure problem, which is exactly how this
-- one survived a merge to main.
--
-- These assertions name the property directly, so a regression says "ordering is
-- non-deterministic" instead of "the cutover gate is inexplicably flaky".
--
-- THE DEFECT THEY PIN. `adjudicated_at` and `started_at` both default to `now()`,
-- which is TRANSACTION time and therefore equal for every row one transaction
-- writes. The tiebreak used to be `id desc` on a `gen_random_uuid()` key, so
-- "the latest row" was drawn at random: an owner who deferred a finding and then
-- accepted it got the deferral back roughly half the time, and a completed run
-- with every blocker accepted was refused cutover on superseded evidence.
--
-- Every assertion below writes its rows inside ONE transaction on purpose. That
-- is the case the timestamps cannot separate, it is what the pgTAP harness does
-- naturally, and it is what a batch adjudication does in production.

begin;
create extension if not exists pgtap;
select plan(10);

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true);
 execute 'set local role authenticated';
end$$;

insert into auth.users(id,email) values ('70000000-0000-4000-8000-000000000101','ordering-owner@example.test');
insert into public.workspaces(id,name,created_by) values ('70000000-1000-4000-8000-000000000101','Ordering determinism','70000000-0000-4000-8000-000000000101');
select pg_temp.as_user('70000000-0000-4000-8000-000000000101');

-- --- the columns that make ordering decidable at all -------------------------

select has_column('public','reconciliation_finding_adjudications','seq',
 'adjudications carry a monotonic sequence');
select has_column('public','reconciliation_runs','seq',
 'runs carry a monotonic sequence');
select col_type_is('public','reconciliation_finding_adjudications','seq','bigint',
 'the adjudication sequence is a bigint, not a random identifier');

create temporary table ord_ids(k text primary key, v text);

insert into ord_ids values('run',(public.begin_reconciliation_run(
 '70000000-1000-4000-8000-000000000101','inventory','ordering-export.json',null,
 'governed inventory','inventory_lot_id','1.0.0','reconciliation.test','ordering-run-0001')->>'runPublicId'));

insert into ord_ids values('finding',(public.record_reconciliation_finding(
 '70000000-1000-4000-8000-000000000101',(select v from ord_ids where k='run'),'blocking-key',
 'source_only','[]'::jsonb,'financial','{"orderingProbe":true}'::jsonb,'reconciliation.test')->>'findingPublicId'));

select is((public.complete_reconciliation_run('70000000-1000-4000-8000-000000000101',
 (select v from ord_ids where k='run'),'{"source":{"rows":1},"target":{"rows":0}}')->>'state'),'completed',
 'the run completes, so only adjudication can decide eligibility');

-- --- two adjudications, one transaction, opposite meanings -------------------

select is((select eligible from public.reconciliation_cutover_eligibility(
 '70000000-1000-4000-8000-000000000101',(select v from ord_ids where k='run'),null)),false,
 'an unadjudicated financial finding blocks');

select is((public.adjudicate_reconciliation_finding('70000000-1000-4000-8000-000000000101',
 (select v from ord_ids where k='finding'),'deferred','owner deferred first','ordering-adj-0001')->>'state'),
 'deferred','the finding is deferred first');

select is((public.adjudicate_reconciliation_finding('70000000-1000-4000-8000-000000000101',
 (select v from ord_ids where k='finding'),'accepted','owner accepted second','ordering-adj-0002')->>'state'),
 'accepted','and accepted second, in the same transaction');

-- THE ASSERTION THIS FILE IS FOR. Both rows share `adjudicated_at` exactly, so
-- nothing but `seq` can decide which one is current. Under the old `id desc`
-- tiebreak this returned the deferral about half the time.
select is((select count(distinct adjudicated_at)::int
 from public.reconciliation_finding_adjudications
 where reconciliation_finding_id=(select id from public.reconciliation_findings
                                  where public_id=(select v from ord_ids where k='finding'))),1,
 'both adjudications share one transaction timestamp, so the tiebreak alone decides');

select is((select eligible from public.reconciliation_cutover_eligibility(
 '70000000-1000-4000-8000-000000000101',(select v from ord_ids where k='run'),null)),true,
 'the LATER acceptance is current, so the run is eligible');

-- Repeated identically because the failure mode was a coin flip: a single call
-- can agree with the correct answer by luck. Asking the same question twice and
-- getting one answer is the property that was actually missing.
select is((select count(distinct eligible)::int from (
  select eligible from public.reconciliation_cutover_eligibility(
   '70000000-1000-4000-8000-000000000101',(select v from ord_ids where k='run'),null)
  union all
  select eligible from public.reconciliation_cutover_eligibility(
   '70000000-1000-4000-8000-000000000101',null,'inventory')
 ) answers),1,
 'the run gate and the domain gate agree, and neither varies between reads');

select * from finish();
rollback;
