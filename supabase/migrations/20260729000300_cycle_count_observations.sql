-- Cycle count — observations, and turning them into discrepancies.
--
-- An observation is EVIDENCE, never a mutation. Scanning a slab or typing a
-- shelf quantity records what a person saw; it does not move an item, change a
-- lot, or correct anything. Inventory only changes later, through the explicit
-- governed resolutions in the next migration.
--
-- Two rules do most of the work here:
--
--   * uncounted is not zero. A lot nobody looked at has no observation row at
--     all, which is a different fact from a lot someone counted and found
--     empty. Inferring zero from silence would manufacture shrinkage.
--   * a repeated scan is not a second sighting. Re-scanning the same unit in
--     the same round returns the original observation instead of creating
--     another, so a jittery scanner or a double tap cannot inflate a count.

create type public.cycle_count_item_observation_kind as enum (
  -- Found where the snapshot said it would be.
  'expected_found',
  -- Found in scope, but the snapshot expected it on a different shelf.
  'wrong_location',
  -- Found in scope and not in the snapshot at all.
  'unexpected_found'
);

create type public.cycle_count_discrepancy_kind as enum (
  'item_missing',
  'item_unexpected',
  'item_wrong_location',
  'lot_shortage',
  'lot_overage',
  'lot_uncounted'
);

create type public.cycle_count_discrepancy_status as enum (
  'open',
  'recount_requested',
  'resolved',
  'deferred'
);

-- Serialized observations -----------------------------------------------------
create table public.cycle_count_item_observations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  count_round integer not null default 1 check (count_round between 1 and 10),
  observation_kind public.cycle_count_item_observation_kind not null,
  -- Set when the scan matched a frozen snapshot row.
  expected_item_id uuid,
  -- The inventory unit the identifier resolved to. Always set: an identifier
  -- that resolves to nothing is rejected outright rather than stored as a
  -- vague sighting.
  item_id uuid not null,
  observed_location_id uuid not null,
  raw_identifier text not null check (char_length(btrim(raw_identifier)) between 1 and 200),
  note text check (note is null or char_length(note) <= 500),
  observed_by uuid not null references auth.users (id) on delete restrict,
  observed_at timestamptz not null default now(),
  -- Undo is a void, not a delete: the operator's mistake is part of the record.
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete restrict,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  unique (id, workspace_id),
  constraint cycle_count_item_obs_void_fields check (
    (voided_at is null) = (voided_by is null)
  ),
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions (id, workspace_id) on delete restrict,
  foreign key (item_id, workspace_id)
    references public.inventory_items (id, workspace_id) on delete restrict,
  foreign key (expected_item_id, workspace_id)
    references public.cycle_count_expected_items (id, workspace_id) on delete restrict,
  foreign key (observed_location_id, workspace_id)
    references public.storage_locations (id, workspace_id) on delete restrict
);
-- Idempotency, enforced by the database rather than by the caller: one live
-- sighting of a given unit per round.
create unique index cycle_count_item_obs_once_per_round
  on public.cycle_count_item_observations (session_id, count_round, item_id)
  where voided_at is null;
create index cycle_count_item_obs_session_idx
  on public.cycle_count_item_observations (session_id, observed_at desc);

-- Quantity-lot observations ----------------------------------------------------
create table public.cycle_count_lot_observations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  count_round integer not null default 1 check (count_round between 1 and 10),
  expected_lot_id uuid not null,
  lot_id uuid not null,
  observed_quantity integer not null check (observed_quantity >= 0),
  -- Copied from the snapshot so the variance stays reconstructible even if the
  -- lot changes afterwards.
  expected_quantity integer not null check (expected_quantity >= 0),
  variance integer not null,
  note text check (note is null or char_length(note) <= 500),
  observed_by uuid not null references auth.users (id) on delete restrict,
  observed_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete restrict,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  unique (id, workspace_id),
  constraint cycle_count_lot_obs_variance check (variance = observed_quantity - expected_quantity),
  constraint cycle_count_lot_obs_void_fields check (
    (voided_at is null) = (voided_by is null)
  ),
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions (id, workspace_id) on delete restrict,
  foreign key (lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict,
  foreign key (expected_lot_id, workspace_id)
    references public.cycle_count_expected_lots (id, workspace_id) on delete restrict
);
create unique index cycle_count_lot_obs_once_per_round
  on public.cycle_count_lot_observations (session_id, count_round, lot_id)
  where voided_at is null;
create index cycle_count_lot_obs_session_idx
  on public.cycle_count_lot_observations (session_id, observed_at desc);

-- Discrepancies ------------------------------------------------------------------
create table public.cycle_count_discrepancies (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  public_id text not null check (public_id ~ '^RV-CCD-[A-Z0-9]{6,20}$'),
  discrepancy_kind public.cycle_count_discrepancy_kind not null,
  status public.cycle_count_discrepancy_status not null default 'open',
  -- Exactly one subject.
  expected_item_id uuid,
  expected_lot_id uuid,
  item_id uuid,
  lot_id uuid,
  expected_quantity integer,
  observed_quantity integer,
  expected_location_id uuid,
  observed_location_id uuid,
  detected_at timestamptz not null default now(),
  recount_requested_at timestamptz,
  recount_requested_by uuid references auth.users (id) on delete restrict,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete restrict,
  deferral_reason text check (deferral_reason is null or char_length(deferral_reason) <= 1000),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  constraint cycle_count_discrepancy_subject check (
    (expected_item_id is not null or expected_lot_id is not null or item_id is not null)
  ),
  constraint cycle_count_discrepancy_deferred_reason check (
    status <> 'deferred'
      or nullif(btrim(coalesce(deferral_reason, '')), '') is not null
  ),
  foreign key (session_id, workspace_id)
    references public.cycle_count_sessions (id, workspace_id) on delete restrict,
  foreign key (expected_item_id, workspace_id)
    references public.cycle_count_expected_items (id, workspace_id) on delete restrict,
  foreign key (expected_lot_id, workspace_id)
    references public.cycle_count_expected_lots (id, workspace_id) on delete restrict,
  foreign key (item_id, workspace_id)
    references public.inventory_items (id, workspace_id) on delete restrict,
  foreign key (lot_id, workspace_id)
    references public.inventory_lots (id, workspace_id) on delete restrict
);
create index cycle_count_discrepancies_session_idx
  on public.cycle_count_discrepancies (session_id, status, discrepancy_kind);
-- One discrepancy per subject per session: recalculating on a second submission
-- must not duplicate the queue.
create unique index cycle_count_discrepancies_item_once
  on public.cycle_count_discrepancies (session_id, discrepancy_kind, item_id)
  where item_id is not null;
create unique index cycle_count_discrepancies_lot_once
  on public.cycle_count_discrepancies (session_id, discrepancy_kind, lot_id)
  where lot_id is not null;

create trigger cycle_count_discrepancies_frozen
  before update on public.cycle_count_discrepancies
  for each row execute function app.forbid_column_change(
    'id', 'session_id', 'workspace_id', 'public_id', 'discrepancy_kind',
    'expected_item_id', 'expected_lot_id', 'item_id', 'lot_id',
    'expected_quantity', 'observed_quantity', 'detected_at'
  );
create trigger cycle_count_discrepancies_no_delete
  before delete on public.cycle_count_discrepancies
  for each row execute function app.forbid_update_delete();

-- Security -------------------------------------------------------------------------
alter table public.cycle_count_item_observations enable row level security;
alter table public.cycle_count_lot_observations enable row level security;
alter table public.cycle_count_discrepancies enable row level security;

revoke all on table
  public.cycle_count_item_observations, public.cycle_count_lot_observations,
  public.cycle_count_discrepancies
  from public, anon, authenticated;
grant select on table
  public.cycle_count_item_observations, public.cycle_count_lot_observations,
  public.cycle_count_discrepancies
  to authenticated;

create policy cycle_count_item_obs_select on public.cycle_count_item_observations
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy cycle_count_lot_obs_select on public.cycle_count_lot_observations
  for select to authenticated using (app.member_role(workspace_id) is not null);
create policy cycle_count_discrepancies_select on public.cycle_count_discrepancies
  for select to authenticated using (app.member_role(workspace_id) is not null);

-- The current counting round for a session.
create function app.cycle_count_current_round(p_session_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce((select max(count_round) from public.cycle_count_item_observations
               where session_id = p_session_id), 1),
    coalesce((select max(count_round) from public.cycle_count_lot_observations
               where session_id = p_session_id), 1),
    coalesce((select 1 + count(distinct id)::int from public.cycle_count_discrepancies
               where session_id = p_session_id and status = 'recount_requested'), 1)
  );
$$;

revoke all on function app.cycle_count_current_round(uuid) from public, anon;

-- Observe a serialized unit ----------------------------------------------------------
-- Exact identifiers only, in confidence order, and an ambiguous match is a
-- refusal rather than a guess: picking one of two candidate slabs would put a
-- false sighting into the evidence.
create function public.observe_cycle_count_item(
  p_workspace_id uuid,
  p_session_id uuid,
  p_identifier text,
  p_observed_location_code text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_s public.cycle_count_sessions%rowtype;
  v_round integer;
  v_needle text := btrim(coalesce(p_identifier, ''));
  v_location uuid;
  v_matches int;
  v_item public.inventory_items%rowtype;
  v_expected public.cycle_count_expected_items%rowtype;
  v_existing public.cycle_count_item_observations%rowtype;
  v_kind public.cycle_count_item_observation_kind;
  v_id uuid;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);

  if v_needle = '' then
    raise exception 'scan or type an identifier' using errcode = '23514';
  end if;

  select * into v_s from public.cycle_count_sessions
  where id = p_session_id and workspace_id = p_workspace_id;
  if v_s.id is null then
    raise exception 'cycle count not found in this workspace' using errcode = '23514';
  end if;
  if v_s.status <> 'in_progress' then
    raise exception 'this cycle count is % and is not accepting observations', v_s.status
      using errcode = '23514';
  end if;

  -- The location must be one this count actually froze into its scope.
  select l.id into v_location
  from public.storage_locations l
  join public.cycle_count_scope_locations sc
    on sc.location_id = l.id and sc.session_id = p_session_id
  where l.workspace_id = p_workspace_id and l.location_code = p_observed_location_code;
  if v_location is null then
    raise exception 'location % is not part of this count''s scope', p_observed_location_code
      using errcode = '23514';
  end if;

  -- Resolve the identifier across every exact key a unit can carry.
  select count(*)::int into v_matches
  from public.inventory_items i
  where i.workspace_id = p_workspace_id
    and (i.public_id = v_needle or i.scan_sku = v_needle
         or i.certificate_number = v_needle or i.serial_number = v_needle);

  if v_matches = 0 then
    return jsonb_build_object('outcome', 'not_found', 'identifier', v_needle);
  end if;
  if v_matches > 1 then
    -- Two units answer to this identifier. Recording either one would be a
    -- fabricated sighting, so the operator has to choose.
    return jsonb_build_object('outcome', 'ambiguous', 'identifier', v_needle,
      'match_count', v_matches);
  end if;

  select * into v_item from public.inventory_items i
  where i.workspace_id = p_workspace_id
    and (i.public_id = v_needle or i.scan_sku = v_needle
         or i.certificate_number = v_needle or i.serial_number = v_needle);

  v_round := app.cycle_count_current_round(p_session_id);

  -- Idempotency: a repeat scan reports the original sighting.
  select * into v_existing from public.cycle_count_item_observations
  where session_id = p_session_id and count_round = v_round
    and item_id = v_item.id and voided_at is null;
  if v_existing.id is not null then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'observation_id', v_existing.id,
      'item_public_id', v_item.public_id,
      'first_observed_at', v_existing.observed_at,
      'observation_kind', v_existing.observation_kind);
  end if;

  if v_item.item_state <> 'active' then
    return jsonb_build_object('outcome', 'inactive_record',
      'item_public_id', v_item.public_id, 'item_state', v_item.item_state);
  end if;

  select * into v_expected from public.cycle_count_expected_items
  where session_id = p_session_id and item_id = v_item.id;

  if v_expected.id is null then
    v_kind := 'unexpected_found';
  elsif v_expected.expected_location_id = v_location then
    v_kind := 'expected_found';
  else
    v_kind := 'wrong_location';
  end if;

  insert into public.cycle_count_item_observations (
    session_id, workspace_id, count_round, observation_kind, expected_item_id,
    item_id, observed_location_id, raw_identifier, note, observed_by)
  values (p_session_id, p_workspace_id, v_round, v_kind, v_expected.id,
    v_item.id, v_location, v_needle, nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_id;

  return jsonb_build_object(
    'outcome', v_kind::text,
    'observation_id', v_id,
    'item_id', v_item.id,
    'item_public_id', v_item.public_id,
    'count_round', v_round,
    'expected_location_code', v_expected.expected_location_code);
end
$$;

revoke all on function public.observe_cycle_count_item(uuid, uuid, text, text, text)
  from public, anon;
grant execute on function public.observe_cycle_count_item(uuid, uuid, text, text, text)
  to authenticated;

-- Observe a quantity lot --------------------------------------------------------------
create function public.observe_cycle_count_lot(
  p_workspace_id uuid,
  p_session_id uuid,
  p_lot_public_id text,
  p_observed_quantity integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_s public.cycle_count_sessions%rowtype;
  v_round integer;
  v_expected public.cycle_count_expected_lots%rowtype;
  v_existing public.cycle_count_lot_observations%rowtype;
  v_id uuid;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);

  if p_observed_quantity is null or p_observed_quantity < 0 then
    raise exception 'enter the number of units counted (zero is allowed, blank is not)'
      using errcode = '23514';
  end if;

  select * into v_s from public.cycle_count_sessions
  where id = p_session_id and workspace_id = p_workspace_id;
  if v_s.id is null then
    raise exception 'cycle count not found in this workspace' using errcode = '23514';
  end if;
  if v_s.status <> 'in_progress' then
    raise exception 'this cycle count is % and is not accepting observations', v_s.status
      using errcode = '23514';
  end if;

  select * into v_expected from public.cycle_count_expected_lots
  where session_id = p_session_id and lot_public_id = p_lot_public_id;
  if v_expected.id is null then
    raise exception 'lot % is not part of this count''s frozen snapshot', p_lot_public_id
      using errcode = '23514';
  end if;

  v_round := app.cycle_count_current_round(p_session_id);

  select * into v_existing from public.cycle_count_lot_observations
  where session_id = p_session_id and count_round = v_round
    and lot_id = v_expected.lot_id and voided_at is null;
  if v_existing.id is not null then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'observation_id', v_existing.id,
      'observed_quantity', v_existing.observed_quantity,
      'first_observed_at', v_existing.observed_at);
  end if;

  insert into public.cycle_count_lot_observations (
    session_id, workspace_id, count_round, expected_lot_id, lot_id,
    observed_quantity, expected_quantity, variance, note, observed_by)
  values (p_session_id, p_workspace_id, v_round, v_expected.id, v_expected.lot_id,
    p_observed_quantity, v_expected.expected_quantity,
    p_observed_quantity - v_expected.expected_quantity,
    nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_id;

  return jsonb_build_object(
    'outcome', 'counted',
    'observation_id', v_id,
    'lot_public_id', p_lot_public_id,
    'observed_quantity', p_observed_quantity,
    'count_round', v_round,
    -- Withheld during a blind count: the whole point is that the counter does
    -- not learn the expected number until review.
    'variance', case when v_s.blind_count then null
                     else p_observed_quantity - v_expected.expected_quantity end);
end
$$;

revoke all on function public.observe_cycle_count_lot(uuid, uuid, text, integer, text)
  from public, anon;
grant execute on function public.observe_cycle_count_lot(uuid, uuid, text, integer, text)
  to authenticated;

-- Undo ----------------------------------------------------------------------------------
-- Voids the observation instead of deleting it: an operator correcting a
-- mis-scan is itself part of what happened during the count.
create function public.void_cycle_count_observation(
  p_workspace_id uuid,
  p_observation_id uuid,
  p_subject_kind text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_session uuid;
  v_status public.cycle_count_status;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);
  if p_subject_kind not in ('item', 'lot') then
    raise exception 'an item or a lot observation is voided' using errcode = '23514';
  end if;

  if p_subject_kind = 'item' then
    select session_id into v_session from public.cycle_count_item_observations
    where id = p_observation_id and workspace_id = p_workspace_id and voided_at is null
    for update;
  else
    select session_id into v_session from public.cycle_count_lot_observations
    where id = p_observation_id and workspace_id = p_workspace_id and voided_at is null
    for update;
  end if;
  if v_session is null then
    raise exception 'observation not found, or already undone' using errcode = '23514';
  end if;

  select status into v_status from public.cycle_count_sessions where id = v_session;
  if v_status <> 'in_progress' then
    raise exception 'observations can only be undone while the count is in progress (this one is %)',
      v_status using errcode = '23514';
  end if;

  if p_subject_kind = 'item' then
    update public.cycle_count_item_observations
    set voided_at = now(), voided_by = v_uid,
        void_reason = nullif(btrim(coalesce(p_reason, '')), '')
    where id = p_observation_id;
  else
    update public.cycle_count_lot_observations
    set voided_at = now(), voided_by = v_uid,
        void_reason = nullif(btrim(coalesce(p_reason, '')), '')
    where id = p_observation_id;
  end if;

  return jsonb_build_object('outcome', 'voided', 'observation_id', p_observation_id);
end
$$;

revoke all on function public.void_cycle_count_observation(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.void_cycle_count_observation(uuid, uuid, text, text)
  to authenticated;

-- Submit for review ------------------------------------------------------------------------
-- Turns evidence into a discrepancy queue. Uncounted records are NOT silently
-- converted: the caller is told how many there are and must confirm explicitly
-- that they should become discrepancies.
create function public.submit_cycle_count_for_review(
  p_workspace_id uuid,
  p_session_id uuid,
  p_confirm_uncounted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_s public.cycle_count_sessions%rowtype;
  v_round integer;
  v_uncounted_items int;
  v_uncounted_lots int;
  v_created int := 0;
begin
  v_uid := app.cycle_count_require_counter(p_workspace_id);

  select * into v_s from public.cycle_count_sessions
  where id = p_session_id and workspace_id = p_workspace_id
  for update;
  if v_s.id is null then
    raise exception 'cycle count not found in this workspace' using errcode = '23514';
  end if;
  if v_s.status <> 'in_progress' then
    raise exception 'only an in-progress cycle count can be submitted (this one is %)', v_s.status
      using errcode = '23514';
  end if;

  v_round := app.cycle_count_current_round(p_session_id);

  select count(*)::int into v_uncounted_items
  from public.cycle_count_expected_items e
  where e.session_id = p_session_id
    and not exists (select 1 from public.cycle_count_item_observations o
                    where o.session_id = p_session_id and o.item_id = e.item_id
                      and o.voided_at is null);

  select count(*)::int into v_uncounted_lots
  from public.cycle_count_expected_lots e
  where e.session_id = p_session_id
    and not exists (select 1 from public.cycle_count_lot_observations o
                    where o.session_id = p_session_id and o.lot_id = e.lot_id
                      and o.voided_at is null);

  if (v_uncounted_items > 0 or v_uncounted_lots > 0) and not coalesce(p_confirm_uncounted, false) then
    return jsonb_build_object(
      'outcome', 'confirmation_required',
      'uncounted_item_count', v_uncounted_items,
      'uncounted_lot_count', v_uncounted_lots,
      'message', 'Uncounted records will become discrepancies. Confirm to continue.');
  end if;

  -- Expected but never seen.
  insert into public.cycle_count_discrepancies (
    session_id, workspace_id, public_id, discrepancy_kind, expected_item_id,
    item_id, expected_location_id)
  select p_session_id, p_workspace_id, app.mint_governed_public_id('RV-CCD'),
         'item_missing', e.id, e.item_id, e.expected_location_id
  from public.cycle_count_expected_items e
  where e.session_id = p_session_id
    and not exists (select 1 from public.cycle_count_item_observations o
                    where o.session_id = p_session_id and o.item_id = e.item_id
                      and o.voided_at is null)
  on conflict do nothing;

  -- Found where it should not be.
  insert into public.cycle_count_discrepancies (
    session_id, workspace_id, public_id, discrepancy_kind, expected_item_id,
    item_id, expected_location_id, observed_location_id)
  select distinct on (o.item_id)
         p_session_id, p_workspace_id, app.mint_governed_public_id('RV-CCD'),
         'item_wrong_location', o.expected_item_id, o.item_id,
         e.expected_location_id, o.observed_location_id
  from public.cycle_count_item_observations o
  join public.cycle_count_expected_items e on e.id = o.expected_item_id
  where o.session_id = p_session_id and o.voided_at is null
    and o.observation_kind = 'wrong_location'
  order by o.item_id, o.observed_at desc
  on conflict do nothing;

  -- Found in scope but absent from the snapshot.
  insert into public.cycle_count_discrepancies (
    session_id, workspace_id, public_id, discrepancy_kind, item_id, observed_location_id)
  select distinct on (o.item_id)
         p_session_id, p_workspace_id, app.mint_governed_public_id('RV-CCD'),
         'item_unexpected', o.item_id, o.observed_location_id
  from public.cycle_count_item_observations o
  where o.session_id = p_session_id and o.voided_at is null
    and o.observation_kind = 'unexpected_found'
  order by o.item_id, o.observed_at desc
  on conflict do nothing;

  -- Quantity variances, from the newest live observation per lot.
  insert into public.cycle_count_discrepancies (
    session_id, workspace_id, public_id, discrepancy_kind, expected_lot_id, lot_id,
    expected_quantity, observed_quantity, expected_location_id)
  select distinct on (o.lot_id)
         p_session_id, p_workspace_id, app.mint_governed_public_id('RV-CCD'),
         (case when o.variance < 0 then 'lot_shortage' else 'lot_overage' end)
           ::public.cycle_count_discrepancy_kind,
         o.expected_lot_id, o.lot_id, o.expected_quantity, o.observed_quantity,
         e.expected_location_id
  from public.cycle_count_lot_observations o
  join public.cycle_count_expected_lots e on e.id = o.expected_lot_id
  where o.session_id = p_session_id and o.voided_at is null and o.variance <> 0
  order by o.lot_id, o.observed_at desc
  on conflict do nothing;

  -- A lot nobody counted is its own kind of open question -- deliberately not
  -- a shortage, because nobody looked.
  insert into public.cycle_count_discrepancies (
    session_id, workspace_id, public_id, discrepancy_kind, expected_lot_id, lot_id,
    expected_quantity, expected_location_id)
  select p_session_id, p_workspace_id, app.mint_governed_public_id('RV-CCD'),
         'lot_uncounted', e.id, e.lot_id, e.expected_quantity, e.expected_location_id
  from public.cycle_count_expected_lots e
  where e.session_id = p_session_id
    and not exists (select 1 from public.cycle_count_lot_observations o
                    where o.session_id = p_session_id and o.lot_id = e.lot_id
                      and o.voided_at is null)
  on conflict do nothing;

  select count(*)::int into v_created
  from public.cycle_count_discrepancies where session_id = p_session_id;

  update public.cycle_count_sessions
  set status = 'review', submitted_at = now(), submitted_by = v_uid, updated_at = now()
  where id = p_session_id;

  return jsonb_build_object(
    'outcome', 'submitted',
    'session_id', p_session_id,
    'count_round', v_round,
    'discrepancy_count', v_created,
    'uncounted_item_count', v_uncounted_items,
    'uncounted_lot_count', v_uncounted_lots);
end
$$;

revoke all on function public.submit_cycle_count_for_review(uuid, uuid, boolean)
  from public, anon;
grant execute on function public.submit_cycle_count_for_review(uuid, uuid, boolean)
  to authenticated;

insert into public.schema_migrations_log (migration_name)
values ('20260729000300_cycle_count_observations');
