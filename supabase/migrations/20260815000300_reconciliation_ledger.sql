-- S3.1: governed, append-only historical reconciliation evidence ledger.
-- This migration creates evidence and its cutover-read gate only. It does not
-- connect to, compare, import from, or cut over any legacy source.

create type public.reconciliation_run_state as enum ('running','completed','failed');
create type public.reconciliation_verdict as enum ('matched_identical','matched_with_differences','source_only','target_only');
create type public.reconciliation_materiality as enum ('none','cosmetic','material','financial');
create type public.reconciliation_adjudication_state as enum ('open','accepted','corrected','rejected','deferred');

create function app.is_reconciliation_differences(p_value jsonb) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(p_value)='array' and not exists(
  select 1 from jsonb_array_elements(p_value) e
  where jsonb_typeof(e)<>'object' or not (e ? 'field' and e ? 'source' and e ? 'target') or jsonb_typeof(e->'field')<>'string'
 );
$$;
revoke all on function app.is_reconciliation_differences(jsonb) from public;

create table public.reconciliation_runs (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 public_id text not null check(public_id ~ '^RV-RECON-[A-Z0-9]{6,20}$'),
 domain text not null check(domain ~ '^[a-z][a-z0-9_.-]{1,63}$'),
 source_label text not null check(char_length(btrim(source_label)) between 1 and 400),
 source_sha256 text check(source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
 target_scope text not null check(char_length(btrim(target_scope)) between 1 and 400),
 comparison_key text not null check(char_length(btrim(comparison_key)) between 1 and 200),
 state public.reconciliation_run_state not null default 'running',
 started_at timestamptz not null default now(),
 completed_at timestamptz,
 l1_result jsonb not null default '{}'::jsonb check(jsonb_typeof(l1_result)='object'),
 tool_version text not null check(char_length(btrim(tool_version)) between 1 and 100),
 run_by uuid not null references auth.users(id) on delete restrict,
 actor_process text not null check(actor_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
 idempotency_key text not null check(char_length(idempotency_key) between 8 and 200),
 request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
 failure_note text check(failure_note is null or char_length(btrim(failure_note)) between 1 and 4000),
 created_at timestamptz not null default now(),
 unique(workspace_id,public_id), unique(workspace_id,idempotency_key), unique(id,workspace_id),
 check((state='running' and completed_at is null and failure_note is null) or
       (state='completed' and completed_at is not null and failure_note is null) or
       (state='failed' and completed_at is not null and failure_note is not null)),
 check(completed_at is null or completed_at>=started_at)
);

create table public.reconciliation_findings (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 public_id text not null check(public_id ~ '^RV-RECONF-[A-Z0-9]{6,20}$'),
 reconciliation_run_id uuid not null,
 comparison_key_value text not null check(char_length(comparison_key_value) between 1 and 1000),
 verdict public.reconciliation_verdict not null,
 field_differences jsonb not null default '[]'::jsonb check(app.is_reconciliation_differences(field_differences)),
 materiality public.reconciliation_materiality not null,
 evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object'),
 recorded_by uuid not null references auth.users(id) on delete restrict,
 actor_process text not null check(actor_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
 created_at timestamptz not null default now(),
 unique(workspace_id,public_id), unique(reconciliation_run_id,comparison_key_value), unique(id,workspace_id),
 foreign key(reconciliation_run_id,workspace_id) references public.reconciliation_runs(id,workspace_id) on delete restrict,
 check((verdict='matched_identical' and jsonb_array_length(field_differences)=0) or
       (verdict='matched_with_differences' and jsonb_array_length(field_differences)>0) or
       verdict in ('source_only','target_only'))
);

create table public.reconciliation_finding_adjudications (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete restrict,
 public_id text not null check(public_id ~ '^RV-RECONA-[A-Z0-9]{6,20}$'),
 reconciliation_finding_id uuid not null,
 state public.reconciliation_adjudication_state not null,
 note text,
 adjudicated_by uuid not null references auth.users(id) on delete restrict,
 adjudicated_at timestamptz not null default now(),
 idempotency_key text not null check(char_length(idempotency_key) between 8 and 200),
 request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
 actor_process text not null check(actor_process ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
 created_at timestamptz not null default now(),
 unique(workspace_id,public_id), unique(workspace_id,idempotency_key), unique(id,workspace_id),
 foreign key(reconciliation_finding_id,workspace_id) references public.reconciliation_findings(id,workspace_id) on delete restrict,
 check(note is null or char_length(btrim(note)) between 1 and 4000),
 check(state='open' or note is not null)
);

create index reconciliation_runs_workspace_domain_idx on public.reconciliation_runs(workspace_id,domain,started_at desc);
create index reconciliation_findings_run_idx on public.reconciliation_findings(reconciliation_run_id,materiality);
create index reconciliation_adjudications_finding_idx on public.reconciliation_finding_adjudications(reconciliation_finding_id,adjudicated_at desc,id desc);

create function app.guard_reconciliation_run_mutation() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'reconciliation evidence cannot be deleted' using errcode='42501'; end if;
 if coalesce(current_setting('app.governed_reconciliation_mutation',true),'') is distinct from 'on' then raise exception 'governed_write_required' using errcode='42501'; end if;
 if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.public_id is distinct from old.public_id
 or new.domain is distinct from old.domain or new.source_label is distinct from old.source_label or new.source_sha256 is distinct from old.source_sha256
 or new.target_scope is distinct from old.target_scope or new.comparison_key is distinct from old.comparison_key or new.started_at is distinct from old.started_at
 or new.tool_version is distinct from old.tool_version or new.run_by is distinct from old.run_by or new.actor_process is distinct from old.actor_process
 or new.idempotency_key is distinct from old.idempotency_key or new.request_fingerprint is distinct from old.request_fingerprint or new.created_at is distinct from old.created_at
 then raise exception 'reconciliation run identity is immutable' using errcode='23514'; end if;
 if old.state<>'running' or new.state='running' then raise exception 'invalid reconciliation run transition' using errcode='23514'; end if;
 return new;
end$$;
create trigger reconciliation_runs_guard before update or delete on public.reconciliation_runs for each row execute function app.guard_reconciliation_run_mutation();
create trigger reconciliation_findings_append_only before update or delete on public.reconciliation_findings for each row execute function app.forbid_update_delete();
create trigger reconciliation_adjudications_append_only before update or delete on public.reconciliation_finding_adjudications for each row execute function app.forbid_update_delete();
create trigger reconciliation_runs_no_truncate before truncate on public.reconciliation_runs for each statement execute function app.forbid_update_delete();
create trigger reconciliation_findings_no_truncate before truncate on public.reconciliation_findings for each statement execute function app.forbid_update_delete();
create trigger reconciliation_adjudications_no_truncate before truncate on public.reconciliation_finding_adjudications for each statement execute function app.forbid_update_delete();

alter table public.reconciliation_runs enable row level security;
alter table public.reconciliation_findings enable row level security;
alter table public.reconciliation_finding_adjudications enable row level security;
create policy reconciliation_runs_read on public.reconciliation_runs for select to authenticated using(app.member_role(workspace_id) is not null);
create policy reconciliation_findings_read on public.reconciliation_findings for select to authenticated using(app.member_role(workspace_id) is not null);
create policy reconciliation_adjudications_read on public.reconciliation_finding_adjudications for select to authenticated using(app.member_role(workspace_id) is not null);
revoke all on public.reconciliation_runs,public.reconciliation_findings,public.reconciliation_finding_adjudications from public,anon,authenticated,service_role;
grant select on public.reconciliation_runs,public.reconciliation_findings,public.reconciliation_finding_adjudications to authenticated;

create function public.begin_reconciliation_run(p_workspace_id uuid,p_domain text,p_source_label text,p_source_sha256 text,p_target_scope text,p_comparison_key text,p_tool_version text,p_actor_process text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid; x public.reconciliation_runs%rowtype; fp text; key text:=btrim(p_idempotency_key);
 normalized_domain text:=btrim(p_domain); normalized_source_label text:=btrim(p_source_label);
 normalized_source_sha256 text:=nullif(btrim(p_source_sha256),''); normalized_target_scope text:=btrim(p_target_scope);
 normalized_comparison_key text:=btrim(p_comparison_key); normalized_tool_version text:=btrim(p_tool_version);
 normalized_actor_process text:=btrim(p_actor_process);
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]);
 if key is null or char_length(key) not between 8 and 200 then raise exception 'invalid_request' using errcode='22023'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(normalized_domain,normalized_source_label,normalized_source_sha256,normalized_target_scope,normalized_comparison_key,normalized_tool_version,normalized_actor_process)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||key,0));
 select * into x from public.reconciliation_runs where workspace_id=p_workspace_id and idempotency_key=key;
 if x.id is not null then if x.request_fingerprint is distinct from fp then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('runPublicId',x.public_id,'state',x.state,'replayed',true); end if;
 insert into public.reconciliation_runs(workspace_id,public_id,domain,source_label,source_sha256,target_scope,comparison_key,tool_version,run_by,actor_process,idempotency_key,request_fingerprint)
 values(p_workspace_id,app.mint_governed_public_id('RV-RECON'),normalized_domain,normalized_source_label,normalized_source_sha256,normalized_target_scope,normalized_comparison_key,normalized_tool_version,u,normalized_actor_process,key,fp) returning * into x;
 return jsonb_build_object('runPublicId',x.public_id,'state',x.state,'replayed',false);
end$$;

create function public.record_reconciliation_finding(p_workspace_id uuid,p_run_public_id text,p_comparison_key_value text,p_verdict public.reconciliation_verdict,p_field_differences jsonb,p_materiality public.reconciliation_materiality,p_evidence jsonb default '{}'::jsonb,p_actor_process text default 'reconciliation.tool')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; r public.reconciliation_runs%rowtype; x public.reconciliation_findings%rowtype; begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]);
 select * into r from public.reconciliation_runs where workspace_id=p_workspace_id and public_id=p_run_public_id for update;
 if r.id is null then raise exception 'reconciliation_run_not_found' using errcode='P0002'; end if;
 if r.state<>'running' then raise exception 'reconciliation_run_not_running' using errcode='23514'; end if;
 if not app.is_reconciliation_differences(p_field_differences) or jsonb_typeof(p_evidence) is distinct from 'object' then raise exception 'invalid_json_shape' using errcode='22023'; end if;
 select * into x from public.reconciliation_findings where reconciliation_run_id=r.id and comparison_key_value=p_comparison_key_value;
 if x.id is not null then
  if x.verdict is distinct from p_verdict or x.field_differences is distinct from p_field_differences or x.materiality is distinct from p_materiality or x.evidence is distinct from p_evidence then raise exception 'finding_conflict' using errcode='23505'; end if;
  return jsonb_build_object('findingPublicId',x.public_id,'replayed',true);
 end if;
 insert into public.reconciliation_findings(workspace_id,public_id,reconciliation_run_id,comparison_key_value,verdict,field_differences,materiality,evidence,recorded_by,actor_process)
 values(p_workspace_id,app.mint_governed_public_id('RV-RECONF'),r.id,p_comparison_key_value,p_verdict,p_field_differences,p_materiality,p_evidence,u,p_actor_process) returning * into x;
 return jsonb_build_object('findingPublicId',x.public_id,'replayed',false);
end$$;

create function app.finish_reconciliation_run(p_workspace_id uuid,p_run_public_id text,p_state public.reconciliation_run_state,p_l1_result jsonb,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare x public.reconciliation_runs%rowtype; begin
 perform app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]);
 if p_state not in ('completed','failed') or jsonb_typeof(p_l1_result) is distinct from 'object' or (p_state='failed' and nullif(btrim(p_note),'') is null) then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into x from public.reconciliation_runs where workspace_id=p_workspace_id and public_id=p_run_public_id for update;
 if x.id is null then raise exception 'reconciliation_run_not_found' using errcode='P0002'; end if;
 if x.state=p_state and x.l1_result=p_l1_result and x.failure_note is not distinct from (case when p_state='failed' then btrim(p_note) else null end) then return jsonb_build_object('runPublicId',x.public_id,'state',x.state,'replayed',true); end if;
 if x.state<>'running' then raise exception 'invalid_reconciliation_run_transition' using errcode='23514'; end if;
 perform set_config('app.governed_reconciliation_mutation','on',true);
 update public.reconciliation_runs set state=p_state,completed_at=now(),l1_result=p_l1_result,failure_note=case when p_state='failed' then btrim(p_note) else null end where id=x.id;
 perform set_config('app.governed_reconciliation_mutation','off',true);
 return jsonb_build_object('runPublicId',x.public_id,'state',p_state,'replayed',false);
end$$;
create function public.complete_reconciliation_run(p_workspace_id uuid,p_run_public_id text,p_l1_result jsonb) returns jsonb language sql security definer set search_path='' as $$select app.finish_reconciliation_run($1,$2,'completed', $3,null)$$;
create function public.fail_reconciliation_run(p_workspace_id uuid,p_run_public_id text,p_l1_result jsonb,p_failure_note text) returns jsonb language sql security definer set search_path='' as $$select app.finish_reconciliation_run($1,$2,'failed',$3,$4)$$;

create function public.adjudicate_reconciliation_finding(p_workspace_id uuid,p_finding_public_id text,p_state public.reconciliation_adjudication_state,p_note text,p_idempotency_key text,p_actor_process text default 'reconciliation.review')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid; f public.reconciliation_findings%rowtype; x public.reconciliation_finding_adjudications%rowtype;
 fp text; key text:=btrim(p_idempotency_key); normalized_note text:=nullif(btrim(p_note),'');
 normalized_actor_process text:=btrim(p_actor_process);
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner']::public.workspace_role[]);
 if key is null or char_length(key) not between 8 and 200 or (p_state<>'open' and normalized_note is null) then raise exception 'invalid_request' using errcode='22023'; end if;
 select * into f from public.reconciliation_findings where workspace_id=p_workspace_id and public_id=p_finding_public_id;
 if f.id is null then raise exception 'reconciliation_finding_not_found' using errcode='P0002'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_array(f.id,p_state,normalized_note,normalized_actor_process)::text,'UTF8')),'hex'); perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||key,0));
 select * into x from public.reconciliation_finding_adjudications where workspace_id=p_workspace_id and idempotency_key=key;
 if x.id is not null then if x.request_fingerprint is distinct from fp then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('adjudicationPublicId',x.public_id,'state',x.state,'replayed',true); end if;
 insert into public.reconciliation_finding_adjudications(workspace_id,public_id,reconciliation_finding_id,state,note,adjudicated_by,idempotency_key,request_fingerprint,actor_process)
 values(p_workspace_id,app.mint_governed_public_id('RV-RECONA'),f.id,p_state,normalized_note,u,key,fp,normalized_actor_process) returning * into x;
 return jsonb_build_object('adjudicationPublicId',x.public_id,'state',x.state,'replayed',false);
end$$;

create function public.reconciliation_cutover_eligibility(p_workspace_id uuid,p_run_public_id text default null,p_domain text default null)
returns table(run_public_id text,domain text,eligible boolean,blocking_finding_count bigint,reason text) language plpgsql stable security definer set search_path='' as $$
begin
 perform app.assert_workspace_role(p_workspace_id,array['owner','operator','viewer']::public.workspace_role[]);
 if (p_run_public_id is null)=(p_domain is null) then raise exception 'provide exactly one run or domain' using errcode='22023'; end if;
 return query with chosen as (
  select r.* from public.reconciliation_runs r where r.workspace_id=p_workspace_id and
   (r.public_id=p_run_public_id or (p_run_public_id is null and r.domain=p_domain))
  order by case when p_run_public_id is not null then 0 else 1 end,r.started_at desc,r.id desc limit 1
 ), current_review as (
  select f.id,f.materiality,coalesce((select a.state from public.reconciliation_finding_adjudications a where a.reconciliation_finding_id=f.id order by a.adjudicated_at desc,a.id desc limit 1),'open'::public.reconciliation_adjudication_state) review_state
  from public.reconciliation_findings f join chosen r on r.id=f.reconciliation_run_id
 ), blockers as (select count(*)::bigint n from current_review where materiality in ('material','financial') and review_state in ('open','deferred'))
 select r.public_id,r.domain,(r.state='completed' and b.n=0),b.n,case when r.state<>'completed' then 'run_not_completed' when b.n>0 then 'blocking_findings' else 'eligible' end from chosen r cross join blockers b
 union all
 select p_run_public_id,p_domain,false,0::bigint,'run_not_found' where not exists(select 1 from chosen);
end$$;

revoke all on function app.guard_reconciliation_run_mutation(),app.finish_reconciliation_run(uuid,text,public.reconciliation_run_state,jsonb,text) from public,anon,authenticated;
revoke all on function public.begin_reconciliation_run(uuid,text,text,text,text,text,text,text,text),public.record_reconciliation_finding(uuid,text,text,public.reconciliation_verdict,jsonb,public.reconciliation_materiality,jsonb,text),public.complete_reconciliation_run(uuid,text,jsonb),public.fail_reconciliation_run(uuid,text,jsonb,text),public.adjudicate_reconciliation_finding(uuid,text,public.reconciliation_adjudication_state,text,text,text),public.reconciliation_cutover_eligibility(uuid,text,text) from public,anon;
grant execute on function public.begin_reconciliation_run(uuid,text,text,text,text,text,text,text,text),public.record_reconciliation_finding(uuid,text,text,public.reconciliation_verdict,jsonb,public.reconciliation_materiality,jsonb,text),public.complete_reconciliation_run(uuid,text,jsonb),public.fail_reconciliation_run(uuid,text,jsonb,text),public.adjudicate_reconciliation_finding(uuid,text,public.reconciliation_adjudication_state,text,text,text),public.reconciliation_cutover_eligibility(uuid,text,text) to authenticated;

insert into public.schema_migrations_log(migration_name) values('20260815000300_reconciliation_ledger');
