-- S2.4 governed inventory cost basis.
-- FIFO is an accounting convention only; it does not assert physical movement.

create type public.inventory_cost_basis_subject_kind as enum ('lot', 'item');
create type public.inventory_cost_basis_method as enum (
  'fifo', 'source_observed_specific', 'deterministic_equal_attribution', 'unresolved'
);
create type public.inventory_cost_basis_state as enum ('current', 'superseded', 'unresolved');
create type public.inventory_cost_basis_event_kind as enum ('created', 'superseded');

create table public.inventory_cost_basis (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  public_id text not null default app.mint_governed_public_id('RV-ICB')
    check (public_id ~ '^RV-ICB-[A-Z0-9]{12}$'),
  recompute_id uuid not null,
  subject_kind public.inventory_cost_basis_subject_kind not null,
  inventory_lot_id uuid,
  inventory_item_id uuid,
  acquisition_line_item_id uuid not null,
  acquisition_receipt_line_inventory_link_id uuid not null,
  layer_seq integer not null check (layer_seq > 0),
  source_unit_ordinal integer not null check (source_unit_ordinal > 0),
  quantity integer not null default 1 check (quantity = 1),
  total_cost_minor bigint,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  basis_method public.inventory_cost_basis_method not null,
  state public.inventory_cost_basis_state not null,
  algorithm_version text not null check (algorithm_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  input_content_hash text not null check (input_content_hash ~ '^[0-9a-f]{64}$'),
  derived_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_recompute_id uuid,
  unique(id, workspace_id), unique(workspace_id, public_id),
  foreign key(inventory_lot_id,workspace_id) references public.inventory_lots(id,workspace_id) on delete restrict,
  foreign key(inventory_item_id,workspace_id) references public.inventory_items(id,workspace_id) on delete restrict,
  foreign key(acquisition_line_item_id,workspace_id) references public.acquisition_line_items(id,workspace_id) on delete restrict,
  foreign key(acquisition_receipt_line_inventory_link_id,workspace_id)
    references public.acquisition_receipt_line_inventory_links(id,workspace_id) on delete restrict,
  check ((subject_kind='lot' and inventory_lot_id is not null and inventory_item_id is null)
      or (subject_kind='item' and inventory_item_id is not null and inventory_lot_id is null)),
  check ((basis_method='unresolved') = (total_cost_minor is null)),
  check (state<>'unresolved' or basis_method='unresolved'),
  check ((state='superseded') = (superseded_at is not null and superseded_by_recompute_id is not null))
);
create unique index inventory_cost_basis_one_current_truth
  on public.inventory_cost_basis(workspace_id, acquisition_receipt_line_inventory_link_id,
    source_unit_ordinal, currency) where state in ('current','unresolved');
create index inventory_cost_basis_fifo_idx
  on public.inventory_cost_basis(workspace_id, inventory_lot_id, currency, layer_seq)
  where state in ('current','unresolved');

create table public.inventory_cost_basis_contributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  inventory_cost_basis_id uuid not null,
  acquisition_cost_component_id uuid not null,
  acquisition_cost_allocation_id uuid,
  acquisition_receipt_line_id uuid not null,
  acquisition_receipt_line_inventory_link_id uuid not null,
  amount_minor bigint not null,
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  component_type public.cost_component_type not null,
  created_at timestamptz not null default now(),
  unique(id,workspace_id),
  foreign key(inventory_cost_basis_id,workspace_id) references public.inventory_cost_basis(id,workspace_id) on delete restrict,
  foreign key(acquisition_cost_component_id,workspace_id) references public.acquisition_cost_components(id,workspace_id) on delete restrict,
  foreign key(acquisition_cost_allocation_id,workspace_id) references public.acquisition_cost_allocations(id,workspace_id) on delete restrict,
  foreign key(acquisition_receipt_line_id,workspace_id) references public.acquisition_receipt_lines(id,workspace_id) on delete restrict,
  foreign key(acquisition_receipt_line_inventory_link_id,workspace_id)
    references public.acquisition_receipt_line_inventory_links(id,workspace_id) on delete restrict,
  unique(inventory_cost_basis_id, acquisition_cost_component_id, acquisition_cost_allocation_id)
);

create table public.inventory_cost_basis_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  recompute_id uuid not null,
  inventory_cost_basis_id uuid,
  event_kind public.inventory_cost_basis_event_kind not null,
  algorithm_version text not null,
  input_content_hash text not null check(input_content_hash ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(id,workspace_id),
  foreign key(inventory_cost_basis_id,workspace_id) references public.inventory_cost_basis(id,workspace_id) on delete restrict
);
create unique index inventory_cost_basis_one_run_event
  on public.inventory_cost_basis_events(workspace_id,recompute_id)
  where inventory_cost_basis_id is null;

alter table public.inventory_cost_basis enable row level security;
alter table public.inventory_cost_basis_contributions enable row level security;
alter table public.inventory_cost_basis_events enable row level security;
create policy inventory_cost_basis_member_read on public.inventory_cost_basis for select to authenticated using(app.member_role(workspace_id) is not null);
create policy inventory_cost_basis_contributions_member_read on public.inventory_cost_basis_contributions for select to authenticated using(app.member_role(workspace_id) is not null);
create policy inventory_cost_basis_events_member_read on public.inventory_cost_basis_events for select to authenticated using(app.member_role(workspace_id) is not null);
revoke all on public.inventory_cost_basis, public.inventory_cost_basis_contributions, public.inventory_cost_basis_events from public,anon,authenticated;
grant select on public.inventory_cost_basis, public.inventory_cost_basis_contributions, public.inventory_cost_basis_events to authenticated;

create function app.guard_inventory_cost_basis_rows() returns trigger language plpgsql set search_path='' as $$
begin
 if current_setting('app.governed_cost_basis_mutation',true) <> 'on' then
   raise exception 'inventory_cost_basis_is_derived' using errcode='55000';
 end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
create trigger inventory_cost_basis_guard before insert or update or delete on public.inventory_cost_basis for each row execute function app.guard_inventory_cost_basis_rows();
create trigger inventory_cost_basis_contributions_guard before insert or update or delete on public.inventory_cost_basis_contributions for each row execute function app.guard_inventory_cost_basis_rows();
create trigger inventory_cost_basis_events_guard before insert or update or delete on public.inventory_cost_basis_events for each row execute function app.guard_inventory_cost_basis_rows();
create trigger inventory_cost_basis_no_truncate before truncate on public.inventory_cost_basis execute function app.forbid_update_delete();
create trigger inventory_cost_basis_contributions_no_truncate before truncate on public.inventory_cost_basis_contributions execute function app.forbid_update_delete();
create trigger inventory_cost_basis_events_no_truncate before truncate on public.inventory_cost_basis_events execute function app.forbid_update_delete();

create function public.recompute_inventory_cost_basis(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_hash text; v_recompute uuid:=gen_random_uuid(); v_count integer; v_version constant text:='1.0.0';
begin
 if v_user is null then raise exception 'authentication required' using errcode='42501'; end if;
 if app.member_role(p_workspace_id) not in ('owner','operator') then raise exception 'insufficient role for this operation' using errcode='42501'; end if;
 -- One lock covers hash observation, supersession and replacement. Competing
 -- callers therefore cannot publish two current truths.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':inventory-cost-basis',0));

 select encode(sha256(coalesce(jsonb_agg(x.payload order by x.sort_key)::text,'[]')::bytea),'hex') into v_hash
 from (
   select 'R|'||r.id::text sort_key, jsonb_build_array('receipt',r.id,r.status,r.received_at,rl.id,rl.quantity_received,k.id,k.inventory_lot_id,k.inventory_item_id,k.quantity_linked) payload
   from public.acquisition_receipts r join public.acquisition_receipt_lines rl on rl.acquisition_receipt_id=r.id
   join public.acquisition_receipt_line_inventory_links k on k.acquisition_receipt_line_id=rl.id
   where r.workspace_id=p_workspace_id and r.status='reconciled'
   union all
   select 'C|'||c.id::text, jsonb_build_array('cost',c.id,c.line_item_id,c.component_type,c.amount_state,c.amount_minor,c.currency,c.attribution_state,c.reversed_at)
   from public.acquisition_cost_components c where c.workspace_id=p_workspace_id
   union all
   select 'A|'||a.id::text, jsonb_build_array('allocation',a.id,a.cost_component_id,a.line_item_id,a.amount_minor,a.state,a.reversed_at)
   from public.acquisition_cost_allocations a where a.workspace_id=p_workspace_id
   union all
   select 'L|'||ali.id::text, jsonb_build_array('line',ali.id,ali.quantity,ali.source_detail)
   from public.acquisition_line_items ali where ali.workspace_id=p_workspace_id
 ) x;
 v_hash:=coalesce(v_hash,encode(sha256('[]'::bytea),'hex'));
 if exists(select 1 from public.inventory_cost_basis_events where workspace_id=p_workspace_id and inventory_cost_basis_id is null and algorithm_version=v_version and input_content_hash=v_hash) then
   return jsonb_build_object('recomputed',false,'algorithmVersion',v_version,'contentHash',v_hash,
     'basisRows',(select count(*) from public.inventory_cost_basis where workspace_id=p_workspace_id and state in ('current','unresolved')));
 end if;

 drop table if exists pg_temp._icb_unit_contrib, pg_temp._icb_costs, pg_temp._icb_units;
 create temporary table _icb_units on commit drop as
 with links as (
  select r.received_at,r.id receipt_id,rl.id receipt_line_id,rl.acquisition_line_item_id,k.id link_id,
    k.inventory_lot_id,k.inventory_item_id,k.quantity_linked,
    coalesce(sum(k.quantity_linked) over(partition by rl.acquisition_line_item_id order by r.received_at,r.id,
      coalesce(i.public_id,l.public_id),k.id rows between unbounded preceding and 1 preceding),0) prior_units
  from public.acquisition_receipts r join public.acquisition_receipt_lines rl on rl.acquisition_receipt_id=r.id
  join public.acquisition_receipt_line_inventory_links k on k.acquisition_receipt_line_id=rl.id
  left join public.inventory_items i on i.id=k.inventory_item_id
  left join public.inventory_lots l on l.id=k.inventory_lot_id
  where r.workspace_id=p_workspace_id and r.status='reconciled'
 ), expanded as (
  select x.*,g unit_in_link,
    prior_units + g source_ord
  from links x cross join lateral generate_series(1,x.quantity_linked) g
 )
 select e.*,ali.quantity expected_quantity from expanded e join public.acquisition_line_items ali on ali.id=e.acquisition_line_item_id;

 create temporary table _icb_costs on commit drop as
 select c.id component_id, null::uuid allocation_id,c.line_item_id,c.component_type,c.currency,c.amount_minor,
   case when c.component_type='item_price' and jsonb_typeof(ali.source_detail->'specific_unit_costs_minor')='array'
     and jsonb_array_length(ali.source_detail->'specific_unit_costs_minor')=ali.quantity
     and (select sum(value::bigint) from jsonb_array_elements_text(ali.source_detail->'specific_unit_costs_minor'))=c.amount_minor
   then ali.source_detail->'specific_unit_costs_minor' end specific_costs
 from public.acquisition_cost_components c join public.acquisition_line_items ali on ali.id=c.line_item_id
 where c.workspace_id=p_workspace_id and c.line_item_id is not null and c.attribution_state='direct'
   and c.amount_state in ('known','documented_free') and c.reversed_at is null
 union all
 select c.id,a.id,a.line_item_id,c.component_type,c.currency,a.amount_minor,null::jsonb
 from public.acquisition_cost_components c join public.acquisition_cost_allocations a on a.cost_component_id=c.id
 where c.workspace_id=p_workspace_id and c.attribution_state='allocated' and c.amount_state in ('known','documented_free')
   and c.reversed_at is null and a.state='confirmed' and a.reversed_at is null;

 create temporary table _icb_unit_contrib on commit drop as
 select u.*,c.component_id,c.allocation_id,c.component_type,c.currency,
   (case when c.component_type='discount' then -1 else 1 end) *
   case when c.specific_costs is not null and u.inventory_item_id is not null
     then (c.specific_costs->>((u.source_ord-1)::integer))::bigint
     else ((c.amount_minor/u.expected_quantity) + case when u.source_ord <= (c.amount_minor%u.expected_quantity) then 1 else 0 end) end amount_minor,
   (c.specific_costs is not null and u.inventory_item_id is not null) source_specific
 from _icb_units u join _icb_costs c on c.line_item_id=u.acquisition_line_item_id
 where u.source_ord<=u.expected_quantity;

 perform set_config('app.governed_cost_basis_mutation','on',true);
 update public.inventory_cost_basis set state='superseded',superseded_at=now(),superseded_by_recompute_id=v_recompute
 where workspace_id=p_workspace_id and state in ('current','unresolved');
 insert into public.inventory_cost_basis_events(workspace_id,recompute_id,inventory_cost_basis_id,event_kind,algorithm_version,input_content_hash,actor_user_id)
 select p_workspace_id,v_recompute,b.id,'superseded',v_version,v_hash,v_user from public.inventory_cost_basis b
 where b.workspace_id=p_workspace_id and b.superseded_by_recompute_id=v_recompute;

 insert into public.inventory_cost_basis(workspace_id,recompute_id,subject_kind,inventory_lot_id,inventory_item_id,
   acquisition_line_item_id,acquisition_receipt_line_inventory_link_id,layer_seq,source_unit_ordinal,total_cost_minor,currency,basis_method,state,algorithm_version,input_content_hash)
 select p_workspace_id,v_recompute,case when u.inventory_item_id is null then 'lot'::public.inventory_cost_basis_subject_kind else 'item' end,
   u.inventory_lot_id,u.inventory_item_id,u.acquisition_line_item_id,u.link_id,
   row_number() over(partition by coalesce(u.inventory_item_id,u.inventory_lot_id),currencies.currency order by u.received_at,u.receipt_id,u.link_id,u.unit_in_link),
   u.source_ord,case when u.source_ord>u.expected_quantity then null else sum(c.amount_minor) end,currencies.currency,
   case when u.source_ord>u.expected_quantity then 'unresolved'::public.inventory_cost_basis_method
        when u.inventory_item_id is null then 'fifo'::public.inventory_cost_basis_method
        when bool_or(coalesce(c.source_specific,false)) then 'source_observed_specific'::public.inventory_cost_basis_method
        else 'deterministic_equal_attribution'::public.inventory_cost_basis_method end,
   case when u.source_ord>u.expected_quantity then 'unresolved'::public.inventory_cost_basis_state else 'current'::public.inventory_cost_basis_state end,
   v_version,v_hash
 from _icb_units u join (select distinct line_item_id,currency from _icb_costs) currencies on currencies.line_item_id=u.acquisition_line_item_id
 left join _icb_unit_contrib c on c.link_id=u.link_id and c.unit_in_link=u.unit_in_link and c.currency=currencies.currency
 group by u.inventory_lot_id,u.inventory_item_id,u.acquisition_line_item_id,u.link_id,u.source_ord,u.expected_quantity,u.received_at,u.receipt_id,u.unit_in_link,currencies.currency;

 insert into public.inventory_cost_basis_contributions(workspace_id,inventory_cost_basis_id,acquisition_cost_component_id,
   acquisition_cost_allocation_id,acquisition_receipt_line_id,acquisition_receipt_line_inventory_link_id,amount_minor,currency,component_type)
 select p_workspace_id,b.id,c.component_id,c.allocation_id,c.receipt_line_id,c.link_id,c.amount_minor,c.currency,c.component_type
 from _icb_unit_contrib c join public.inventory_cost_basis b on b.recompute_id=v_recompute and b.workspace_id=p_workspace_id
  and b.acquisition_receipt_line_inventory_link_id=c.link_id and b.source_unit_ordinal=c.source_ord and b.currency=c.currency;
 insert into public.inventory_cost_basis_events(workspace_id,recompute_id,inventory_cost_basis_id,event_kind,algorithm_version,input_content_hash,actor_user_id)
 select p_workspace_id,v_recompute,b.id,'created',v_version,v_hash,v_user from public.inventory_cost_basis b where b.recompute_id=v_recompute;
 insert into public.inventory_cost_basis_events(workspace_id,recompute_id,event_kind,algorithm_version,input_content_hash,actor_user_id)
 values(p_workspace_id,v_recompute,'created',v_version,v_hash,v_user);
 select count(*) into v_count from public.inventory_cost_basis where recompute_id=v_recompute;
 perform set_config('app.governed_cost_basis_mutation','off',true);
 return jsonb_build_object('recomputed',true,'recomputeId',v_recompute,'algorithmVersion',v_version,'contentHash',v_hash,'basisRows',v_count);
end$$;
revoke all on function public.recompute_inventory_cost_basis(uuid) from public,anon;
grant execute on function public.recompute_inventory_cost_basis(uuid) to authenticated;

create view public.inventory_cost_basis_current with (security_invoker=true) as
select b.*,l.public_id inventory_lot_public_id,i.public_id inventory_item_public_id
from public.inventory_cost_basis b left join public.inventory_lots l on l.id=b.inventory_lot_id
left join public.inventory_items i on i.id=b.inventory_item_id where b.state in ('current','unresolved');
grant select on public.inventory_cost_basis_current to authenticated;

create view public.unresolved_inventory_cost_basis with (security_invoker=true) as
select ali.workspace_id,ali.id acquisition_line_item_id,ali.public_id acquisition_line_public_id,
 ali.quantity expected_quantity,
 coalesce(sum(rl.quantity_received) filter(where r.status='reconciled'),0)::bigint reconciled_quantity,
 greatest(ali.quantity-coalesce(sum(rl.quantity_received) filter(where r.status='reconciled'),0),0)::bigint pending_expected_quantity,
 greatest(coalesce(sum(rl.quantity_received) filter(where r.status='reconciled'),0)-ali.quantity,0)::bigint overage_quantity,
 exists(select 1 from public.acquisition_cost_components c where c.line_item_id=ali.id and c.reversed_at is null and (c.amount_state='unknown' or c.attribution_state='unresolved')) has_unresolved_cost_evidence
from public.acquisition_line_items ali left join public.acquisition_receipt_lines rl on rl.acquisition_line_item_id=ali.id
left join public.acquisition_receipts r on r.id=rl.acquisition_receipt_id
group by ali.workspace_id,ali.id,ali.public_id,ali.quantity
having greatest(ali.quantity-coalesce(sum(rl.quantity_received) filter(where r.status='reconciled'),0),0)>0
 or greatest(coalesce(sum(rl.quantity_received) filter(where r.status='reconciled'),0)-ali.quantity,0)>0
 or exists(select 1 from public.acquisition_cost_components c where c.line_item_id=ali.id and c.reversed_at is null and (c.amount_state='unknown' or c.attribution_state='unresolved'));
grant select on public.unresolved_inventory_cost_basis to authenticated;

insert into public.schema_migrations_log(migration_name) values('20260812000100_governed_inventory_cost_basis');
