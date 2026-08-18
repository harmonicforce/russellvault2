-- S3.1.1: make adjudication chronology authoritative and deterministic.
-- Timestamps remain evidence. They are not used to break ties or select the
-- current adjudication.

alter table public.reconciliation_finding_adjudications
 add column adjudication_ordinal bigint,
 add column ordering_ambiguity text;

-- A legacy history can be ordered truthfully only when its timestamps are
-- distinct within the finding. If a timestamp ties, mark the whole history as
-- ambiguous rather than manufacturing chronology from random UUIDs.
alter table public.reconciliation_finding_adjudications disable trigger reconciliation_adjudications_append_only;

with distinguishable as (
 select reconciliation_finding_id
 from public.reconciliation_finding_adjudications
 group by reconciliation_finding_id
 having count(*) = count(distinct adjudicated_at)
), ordered as (
 select a.id,
        row_number() over (
          partition by a.reconciliation_finding_id
          order by a.adjudicated_at
        )::bigint as ordinal
 from public.reconciliation_finding_adjudications a
 join distinguishable d on d.reconciliation_finding_id = a.reconciliation_finding_id
)
update public.reconciliation_finding_adjudications a
set adjudication_ordinal = o.ordinal
from ordered o
where o.id = a.id;

update public.reconciliation_finding_adjudications
set ordering_ambiguity = 'legacy_timestamp_tie'
where adjudication_ordinal is null;

alter table public.reconciliation_finding_adjudications enable trigger reconciliation_adjudications_append_only;

alter table public.reconciliation_finding_adjudications
 add constraint reconciliation_adjudication_order_representation_check check (
  (adjudication_ordinal is not null and adjudication_ordinal > 0 and ordering_ambiguity is null)
  or
  (adjudication_ordinal is null and ordering_ambiguity = 'legacy_timestamp_tie')
 );

create unique index reconciliation_adjudications_finding_ordinal_uidx
 on public.reconciliation_finding_adjudications(reconciliation_finding_id, adjudication_ordinal)
 where adjudication_ordinal is not null;

drop index public.reconciliation_adjudications_finding_idx;
create index reconciliation_adjudications_finding_idx
 on public.reconciliation_finding_adjudications(reconciliation_finding_id, adjudication_ordinal desc)
 where adjudication_ordinal is not null;

comment on column public.reconciliation_finding_adjudications.adjudication_ordinal is
 'Authoritative append order within a finding; assigned while the finding row is locked.';
comment on column public.reconciliation_finding_adjudications.ordering_ambiguity is
 'Fail-closed marker for legacy histories whose timestamp evidence cannot establish chronology.';

create or replace function public.adjudicate_reconciliation_finding(p_workspace_id uuid,p_finding_public_id text,p_state public.reconciliation_adjudication_state,p_note text,p_idempotency_key text,p_actor_process text default 'reconciliation.review')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid; f public.reconciliation_findings%rowtype; x public.reconciliation_finding_adjudications%rowtype;
 fp text; key text:=btrim(p_idempotency_key); normalized_note text:=nullif(btrim(p_note),'');
 normalized_actor_process text:=btrim(p_actor_process); next_ordinal bigint;
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner']::public.workspace_role[]);
 if key is null or char_length(key) not between 8 and 200 or (p_state<>'open' and normalized_note is null) then raise exception 'invalid_request' using errcode='22023'; end if;

 -- This canonical row lock serializes all event assignment for one finding,
 -- including adjudications issued by concurrent sessions.
 select * into f from public.reconciliation_findings where workspace_id=p_workspace_id and public_id=p_finding_public_id for update;
 if f.id is null then raise exception 'reconciliation_finding_not_found' using errcode='P0002'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(f.id,p_state,normalized_note,normalized_actor_process)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||key,0));
 select * into x from public.reconciliation_finding_adjudications where workspace_id=p_workspace_id and idempotency_key=key;
 if x.id is not null then
  if x.request_fingerprint is distinct from fp then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('adjudicationPublicId',x.public_id,'state',x.state,'ordinal',x.adjudication_ordinal,'replayed',true);
 end if;
 if exists(select 1 from public.reconciliation_finding_adjudications a where a.reconciliation_finding_id=f.id and a.ordering_ambiguity is not null) then
  raise exception 'reconciliation_adjudication_history_ambiguous' using errcode='23514';
 end if;
 select coalesce(max(a.adjudication_ordinal),0)+1 into next_ordinal
 from public.reconciliation_finding_adjudications a where a.reconciliation_finding_id=f.id;
 insert into public.reconciliation_finding_adjudications(workspace_id,public_id,reconciliation_finding_id,state,note,adjudicated_by,idempotency_key,request_fingerprint,actor_process,adjudication_ordinal)
 values(p_workspace_id,app.mint_governed_public_id('RV-RECONA'),f.id,p_state,normalized_note,u,key,fp,normalized_actor_process,next_ordinal) returning * into x;
 return jsonb_build_object('adjudicationPublicId',x.public_id,'state',x.state,'ordinal',x.adjudication_ordinal,'replayed',false);
end$$;

create or replace function public.reconciliation_cutover_eligibility(p_workspace_id uuid,p_run_public_id text default null,p_domain text default null)
returns table(run_public_id text,domain text,eligible boolean,blocking_finding_count bigint,reason text) language plpgsql stable security definer set search_path='' as $$
begin
 perform app.assert_workspace_role(p_workspace_id,array['owner','operator','viewer']::public.workspace_role[]);
 if (p_run_public_id is null)=(p_domain is null) then raise exception 'provide exactly one run or domain' using errcode='22023'; end if;
 return query with chosen as (
  select r.* from public.reconciliation_runs r where r.workspace_id=p_workspace_id and
   (r.public_id=p_run_public_id or (p_run_public_id is null and r.domain=p_domain))
  order by case when p_run_public_id is not null then 0 else 1 end,r.started_at desc,r.id desc limit 1
 ), current_review as (
  select f.id,f.materiality,
   case
    when exists(select 1 from public.reconciliation_finding_adjudications a where a.reconciliation_finding_id=f.id and a.ordering_ambiguity is not null)
     then 'open'::public.reconciliation_adjudication_state
    else coalesce((select a.state from public.reconciliation_finding_adjudications a where a.reconciliation_finding_id=f.id order by a.adjudication_ordinal desc limit 1),'open'::public.reconciliation_adjudication_state)
   end review_state
  from public.reconciliation_findings f join chosen r on r.id=f.reconciliation_run_id
 ), blockers as (select count(*)::bigint n from current_review where materiality in ('material','financial') and review_state in ('open','deferred'))
 select r.public_id,r.domain,(r.state='completed' and b.n=0),b.n,case when r.state<>'completed' then 'run_not_completed' when b.n>0 then 'blocking_findings' else 'eligible' end from chosen r cross join blockers b
 union all
 select p_run_public_id,p_domain,false,0::bigint,'run_not_found' where not exists(select 1 from chosen);
end$$;

insert into public.schema_migrations_log(migration_name) values('20260818000100_deterministic_reconciliation_adjudication_order');
