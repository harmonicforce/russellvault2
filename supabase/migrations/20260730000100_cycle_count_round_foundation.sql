-- Corrective, additive cycle-count round foundation.
--
-- Earlier migrations represented a recount with mutable discrepancy state and
-- an integer copied onto observations.  Those columns remain temporarily for
-- compatibility, but are no longer authoritative.  A persisted round is the
-- sole source of round number and lifecycle identity from this migration on.

create type public.cycle_count_round_type as enum ('initial', 'recount');
create type public.cycle_count_round_status as enum
  ('draft', 'counting', 'submitted', 'reviewed', 'closed', 'cancelled');
create type public.cycle_count_subject_type as enum ('item', 'lot');
create type public.cycle_count_round_result_classification as enum (
  'matched', 'missing', 'unexpected', 'wrong_location', 'shortage', 'overage',
  'uncounted', 'matched_after_recount', 'confirmed_after_recount',
  'changed_after_recount', 'unresolved_after_recount',
  'invalidated_by_post_snapshot_change'
);
create type public.cycle_count_post_snapshot_classification as enum (
  'none', 'correction_requested', 'correction_approved', 'record_superseded',
  'duplicate_voided', 'item_state_changed', 'quantity_changed', 'location_changed'
);

create table public.cycle_count_rounds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  session_id uuid not null,
  public_id text not null check (public_id ~ '^RV-CCR-[A-Z0-9]{6,20}$'),
  round_number integer not null check (round_number > 0),
  round_type public.cycle_count_round_type not null,
  status public.cycle_count_round_status not null default 'draft',
  parent_round_id uuid,
  reason text check (reason is null or char_length(reason) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  started_by uuid references auth.users(id) on delete restrict,
  started_at timestamptz,
  submitted_by uuid references auth.users(id) on delete restrict,
  submitted_at timestamptz,
  unique (id, workspace_id),
  unique (session_id, round_number),
  unique (workspace_id, public_id),
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions(id, workspace_id) on delete restrict,
  foreign key (parent_round_id, workspace_id)
    references public.cycle_count_rounds(id, workspace_id) on delete restrict,
  constraint cycle_count_round_number_type check (
    (round_number = 1 and round_type = 'initial') or
    (round_number > 1 and round_type = 'recount')
  ),
  constraint cycle_count_round_started_fields check (
    (status = 'draft' and started_at is null and started_by is null) or
    (status <> 'draft' and started_at is not null and started_by is not null)
  ),
  constraint cycle_count_round_submitted_fields check (
    (status in ('submitted','reviewed','closed') and submitted_at is not null and submitted_by is not null)
    or (status not in ('submitted','reviewed','closed') and submitted_at is null and submitted_by is null)
  )
);
create index cycle_count_rounds_session_idx
  on public.cycle_count_rounds(session_id, round_number desc);

create trigger cycle_count_rounds_identity_immutable
  before update on public.cycle_count_rounds
  for each row execute function app.forbid_column_change(
    'id', 'workspace_id', 'session_id', 'public_id', 'round_number',
    'round_type', 'parent_round_id', 'reason', 'created_by', 'created_at',
    'started_by', 'started_at'
  );
create trigger cycle_count_rounds_no_delete
  before delete on public.cycle_count_rounds
  for each row execute function app.forbid_update_delete();

create table public.cycle_count_round_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  session_id uuid not null,
  round_id uuid not null,
  from_status public.cycle_count_round_status,
  to_status public.cycle_count_round_status not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  occurred_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions(id, workspace_id) on delete restrict,
  foreign key (round_id, workspace_id)
    references public.cycle_count_rounds(id, workspace_id) on delete restrict
);
create trigger cycle_count_round_events_append_only
  before update or delete on public.cycle_count_round_lifecycle_events
  for each row execute function app.forbid_update_delete();

alter table public.cycle_count_sessions add column current_round_id uuid;

-- Give already-started unpublished sessions an explicit initial round without
-- rewriting their frozen snapshot or observations.
insert into public.cycle_count_rounds (
  id, workspace_id, session_id, public_id, round_number, round_type, status,
  created_by, created_at, started_by, started_at, submitted_by, submitted_at)
select gen_random_uuid(), s.workspace_id, s.id,
       'RV-CCR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
       legacy.round_number,
       case when legacy.round_number=1 then 'initial' else 'recount' end::public.cycle_count_round_type,
       case when legacy.round_number < legacy.latest_round then
         case when s.status='completed' then 'closed' else 'submitted' end::public.cycle_count_round_status
       else case s.status
         when 'in_progress' then 'counting'::public.cycle_count_round_status
         when 'review' then 'submitted'::public.cycle_count_round_status
         when 'completed' then 'closed'::public.cycle_count_round_status
         else 'cancelled'::public.cycle_count_round_status
       end end,
       s.created_by, s.created_at,
       coalesce(s.started_by, s.created_by), coalesce(s.started_at, s.created_at),
       case when legacy.round_number < legacy.latest_round or s.status in ('review','completed')
         then coalesce(s.submitted_by, s.started_by, s.created_by) end,
       case when legacy.round_number < legacy.latest_round or s.status in ('review','completed')
         then coalesce(s.submitted_at, s.updated_at, s.started_at, s.created_at) end
from public.cycle_count_sessions s
cross join lateral (
  select n as round_number, greatest(1,coalesce((
    select max(x.count_round) from (
      select count_round from public.cycle_count_item_observations where session_id=s.id
      union all select count_round from public.cycle_count_lot_observations where session_id=s.id
    ) x),1)) as latest_round
  from generate_series(1,greatest(1,coalesce((
    select max(x.count_round) from (
      select count_round from public.cycle_count_item_observations where session_id=s.id
      union all select count_round from public.cycle_count_lot_observations where session_id=s.id
    ) x),1))) n
) legacy
where s.status <> 'draft';

update public.cycle_count_sessions s
set current_round_id = r.id
from public.cycle_count_rounds r
where r.session_id = s.id and r.round_number = (
  select max(latest.round_number) from public.cycle_count_rounds latest where latest.session_id=s.id
);

alter table public.cycle_count_sessions
  add constraint cycle_count_sessions_current_round_fk
  foreign key (current_round_id, workspace_id)
  references public.cycle_count_rounds(id, workspace_id) on delete restrict;

alter table public.cycle_count_item_observations add column round_id uuid;
alter table public.cycle_count_lot_observations add column round_id uuid;
update public.cycle_count_item_observations o set round_id = r.id
from public.cycle_count_rounds r where r.session_id = o.session_id and r.round_number = o.count_round;
update public.cycle_count_lot_observations o set round_id = r.id
from public.cycle_count_rounds r where r.session_id = o.session_id and r.round_number = o.count_round;
alter table public.cycle_count_item_observations
  add constraint cycle_count_item_observations_round_fk foreign key (round_id, workspace_id)
  references public.cycle_count_rounds(id, workspace_id) on delete restrict;
alter table public.cycle_count_lot_observations
  add constraint cycle_count_lot_observations_round_fk foreign key (round_id, workspace_id)
  references public.cycle_count_rounds(id, workspace_id) on delete restrict;

drop index public.cycle_count_item_obs_once_per_round;
drop index public.cycle_count_lot_obs_once_per_round;
create unique index cycle_count_item_obs_once_per_explicit_round
  on public.cycle_count_item_observations(round_id, item_id) where voided_at is null;
create unique index cycle_count_lot_obs_once_per_explicit_round
  on public.cycle_count_lot_observations(round_id, lot_id) where voided_at is null;

create table public.cycle_count_recount_selections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  session_id uuid not null,
  discrepancy_id uuid not null,
  selected_by uuid not null references auth.users(id) on delete restrict,
  selected_at timestamptz not null default now(),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  assigned_round_id uuid,
  unique (session_id, discrepancy_id),
  unique (id, workspace_id),
  foreign key (session_id, workspace_id) references public.cycle_count_sessions(id, workspace_id),
  foreign key (discrepancy_id, workspace_id) references public.cycle_count_discrepancies(id, workspace_id),
  foreign key (assigned_round_id, workspace_id) references public.cycle_count_rounds(id, workspace_id)
);

create table public.cycle_count_round_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  session_id uuid not null,
  round_id uuid not null,
  subject_type public.cycle_count_subject_type not null,
  expected_item_id uuid,
  expected_lot_id uuid,
  item_id uuid,
  lot_id uuid,
  item_observation_id uuid,
  lot_observation_id uuid,
  expected_present boolean,
  expected_location_id uuid,
  observed_location_id uuid,
  expected_quantity integer,
  observed_quantity integer,
  computed_variance integer,
  classification public.cycle_count_round_result_classification not null,
  post_snapshot_classification public.cycle_count_post_snapshot_classification not null default 'none',
  evaluation_version integer not null default 1,
  evaluated_at timestamptz not null default now(),
  predecessor_result_id uuid,
  unique (id, workspace_id),
  foreign key (session_id, workspace_id) references public.cycle_count_sessions(id, workspace_id),
  foreign key (round_id, workspace_id) references public.cycle_count_rounds(id, workspace_id),
  foreign key (predecessor_result_id, workspace_id) references public.cycle_count_round_results(id, workspace_id),
  constraint cycle_count_round_result_subject check (
    (subject_type = 'item' and item_id is not null and lot_id is null) or
    (subject_type = 'lot' and lot_id is not null and item_id is null)
  ),
  constraint cycle_count_round_result_observation check (
    not (item_observation_id is not null and lot_observation_id is not null)
  ),
  constraint cycle_count_round_result_variance check (
    computed_variance is null or computed_variance = observed_quantity - expected_quantity
  )
);
create unique index cycle_count_round_results_item_once
  on public.cycle_count_round_results(round_id, item_id) where item_id is not null;
create unique index cycle_count_round_results_lot_once
  on public.cycle_count_round_results(round_id, lot_id) where lot_id is not null;
create trigger cycle_count_round_results_append_only
  before update or delete on public.cycle_count_round_results
  for each row execute function app.forbid_update_delete();

alter table public.cycle_count_discrepancies
  add column round_result_id uuid,
  add column superseded_by_discrepancy_id uuid,
  add column recount_outcome public.cycle_count_round_result_classification;
alter table public.cycle_count_discrepancies
  add constraint cycle_count_discrepancies_round_result_fk
    foreign key (round_result_id, workspace_id) references public.cycle_count_round_results(id, workspace_id),
  add constraint cycle_count_discrepancies_successor_fk
    foreign key (superseded_by_discrepancy_id, workspace_id)
    references public.cycle_count_discrepancies(id, workspace_id);
drop index public.cycle_count_discrepancies_item_once;
drop index public.cycle_count_discrepancies_lot_once;
create unique index cycle_count_discrepancies_result_once
  on public.cycle_count_discrepancies(round_result_id) where round_result_id is not null;

-- Expected answers are never a direct authenticated read.  Review is exposed
-- only by lifecycle- and role-aware SECURITY DEFINER functions in the next
-- checkpoint.  RLS is defense in depth, not the blindness boundary by itself.
drop policy if exists cycle_count_expected_items_select on public.cycle_count_expected_items;
drop policy if exists cycle_count_expected_lots_select on public.cycle_count_expected_lots;
drop policy if exists cycle_count_discrepancies_select on public.cycle_count_discrepancies;
revoke all on table public.cycle_count_expected_items, public.cycle_count_expected_lots,
  public.cycle_count_discrepancies
  from public, anon, authenticated;

alter table public.cycle_count_rounds enable row level security;
alter table public.cycle_count_round_lifecycle_events enable row level security;
alter table public.cycle_count_recount_selections enable row level security;
alter table public.cycle_count_round_results enable row level security;
revoke all on table public.cycle_count_rounds, public.cycle_count_round_lifecycle_events,
  public.cycle_count_recount_selections, public.cycle_count_round_results
  from public, anon, authenticated;
grant select on table public.cycle_count_rounds, public.cycle_count_round_lifecycle_events
  to authenticated;
create policy cycle_count_rounds_select on public.cycle_count_rounds for select to authenticated
  using (app.member_role(workspace_id) is not null);
create policy cycle_count_round_events_select on public.cycle_count_round_lifecycle_events
  for select to authenticated using (app.member_role(workspace_id) is not null);

-- Prevent future objects from accidentally restoring direct API access.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

insert into public.schema_migrations_log(migration_name)
values ('20260730000100_cycle_count_round_foundation');
