-- S3.1 repair: make "the latest row wins" a deterministic fact.
--
-- THE DEFECT
--
-- `reconciliation_cutover_eligibility` decides two things by picking the newest
-- row out of an append-only history:
--
--   * which run a domain gate is about — `order by started_at desc, id desc`;
--   * what the current review state of a finding is —
--     `order by adjudicated_at desc, id desc`.
--
-- Both timestamps default to `now()`, which is TRANSACTION time and therefore
-- identical for every row written by one transaction. The tiebreak then decides,
-- and the tiebreak was `id desc` on a `gen_random_uuid()` primary key. A random
-- identifier orders randomly, so when an owner adjudicates a finding twice in
-- one transaction — deferring it, then accepting it — which adjudication counts
-- as current was a coin flip.
--
-- That is not a flaky test. It is the cutover gate giving two different answers
-- to the same question about the same evidence, and it fails in the direction
-- that matters: roughly half the time an accepted finding still reads as
-- blocking, and the run is refused cutover on the strength of a superseded
-- deferral. `68_reconciliation_ledger.sql` caught it as tests 42 and 43.
--
-- THE REPAIR
--
-- Give both tables a strictly monotonic `seq`, assigned by an identity sequence
-- in insertion order, and tiebreak on it. Insertion order IS history order for
-- an append-only ledger — nothing here is ever updated or deleted — so `seq`
-- says exactly what the random uuid could not: which row was recorded later.
--
-- The timestamp stays the PRIMARY sort. `seq` only breaks ties, so ordering
-- across transactions still follows real time, and `seq` settles the one case
-- time cannot: rows sharing a transaction.
--
-- ADDITIVE AND FORWARD-ONLY. The S3.1 migration is not rewritten. A column is
-- added, two indexes are replaced, and one read-only function is redefined.

alter table public.reconciliation_runs
  add column seq bigint not null generated always as identity;

alter table public.reconciliation_finding_adjudications
  add column seq bigint not null generated always as identity;

comment on column public.reconciliation_runs.seq is
  'Monotonic insertion order. Breaks started_at ties, which are guaranteed '
  'whenever two runs begin in one transaction, because started_at is now() and '
  'now() is transaction time. Never used as an identity; public_id is identity.';
comment on column public.reconciliation_finding_adjudications.seq is
  'Monotonic insertion order, and the only deterministic answer to "which '
  'adjudication is current" when an owner adjudicates twice in one transaction. '
  'The table is append-only, so insertion order is history order.';

-- The supporting indexes have to sort the way the queries now sort, or the
-- planner reads them and then re-sorts, which is the silent kind of regression.
drop index if exists public.reconciliation_runs_workspace_domain_idx;
create index reconciliation_runs_workspace_domain_idx
  on public.reconciliation_runs(workspace_id, domain, started_at desc, seq desc);

drop index if exists public.reconciliation_adjudications_finding_idx;
create index reconciliation_adjudications_finding_idx
  on public.reconciliation_finding_adjudications(
    reconciliation_finding_id, adjudicated_at desc, seq desc);

-- Redefined for the ordering ONLY. The gate's semantics are unchanged: it still
-- fails closed on a run that is not completed, still counts `open` and
-- `deferred` material or financial findings as blocking, and still returns one
-- explicit `run_not_found` row rather than an empty result.
create or replace function public.reconciliation_cutover_eligibility(
  p_workspace_id uuid, p_run_public_id text default null, p_domain text default null)
returns table(run_public_id text, domain text, eligible boolean,
              blocking_finding_count bigint, reason text)
language plpgsql stable security definer set search_path='' as $$
begin
 perform app.assert_workspace_role(p_workspace_id,array['owner','operator','viewer']::public.workspace_role[]);
 if (p_run_public_id is null)=(p_domain is null) then raise exception 'provide exactly one run or domain' using errcode='22023'; end if;
 return query with chosen as (
  select r.* from public.reconciliation_runs r where r.workspace_id=p_workspace_id and
   (r.public_id=p_run_public_id or (p_run_public_id is null and r.domain=p_domain))
  order by case when p_run_public_id is not null then 0 else 1 end,r.started_at desc,r.seq desc limit 1
 ), current_review as (
  select f.id,f.materiality,coalesce((select a.state from public.reconciliation_finding_adjudications a where a.reconciliation_finding_id=f.id order by a.adjudicated_at desc,a.seq desc limit 1),'open'::public.reconciliation_adjudication_state) review_state
  from public.reconciliation_findings f join chosen r on r.id=f.reconciliation_run_id
 ), blockers as (select count(*)::bigint n from current_review where materiality in ('material','financial') and review_state in ('open','deferred'))
 select r.public_id,r.domain,(r.state='completed' and b.n=0),b.n,case when r.state<>'completed' then 'run_not_completed' when b.n>0 then 'blocking_findings' else 'eligible' end from chosen r cross join blockers b
 union all
 select p_run_public_id,p_domain,false,0::bigint,'run_not_found' where not exists(select 1 from chosen);
end$$;

revoke all on function public.reconciliation_cutover_eligibility(uuid,text,text) from public,anon;
grant execute on function public.reconciliation_cutover_eligibility(uuid,text,text) to authenticated;

insert into public.schema_migrations_log(migration_name)
values('20260819000100_reconciliation_deterministic_ordering');
