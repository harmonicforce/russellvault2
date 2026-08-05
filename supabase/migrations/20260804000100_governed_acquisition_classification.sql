-- S1.1 governed acquisition classification schema and legacy-classifier seed data.

create table public.acquisition_classification_options (
  id uuid primary key default gen_random_uuid(),
  public_id text not null default app.mint_governed_public_id('RV-ACOPT') check (public_id ~ '^RV-ACOPT-[A-Z0-9]{12}$'),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text not null check (btrim(label) = label and char_length(label) between 1 and 80),
  description text check (description is null or char_length(description) <= 1000),
  display_order integer not null check (display_order >= 0),
  active boolean not null default true,
  origin text not null check (origin in ('system_default','owner_created')),
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  unique (workspace_id, key),
  constraint acquisition_classification_options_actor_origin check (
    (origin = 'system_default' and created_by is null) or (origin = 'owner_created' and created_by is not null)
  )
);
create unique index acquisition_classification_options_label_ci_uidx on public.acquisition_classification_options (workspace_id, lower(label));
create index acquisition_classification_options_active_order_idx on public.acquisition_classification_options (workspace_id, active, display_order);

create table public.classification_rules (
  id uuid primary key default gen_random_uuid(),
  public_id text not null default app.mint_governed_public_id('RV-CRULE') check (public_id ~ '^RV-CRULE-[A-Z0-9]{12}$'),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  logical_key text not null check (logical_key ~ '^[a-z][a-z0-9_.:-]{1,120}$'),
  rule_family text not null check (rule_family in ('business_vertical_mapping','delivered_item_pattern','full_title_pattern','strong_mystery_pattern','seller_specialization','explicit_evidence')),
  matcher_kind text not null check (matcher_kind in ('exact','regex','evidence_set')),
  match_field text not null check (match_field in ('business_vertical','delivered_item_title','full_title','seller_normalized','acquisition_line_id')),
  pattern text check (pattern is null or (char_length(pattern) between 1 and 2000 and pattern !~* ';|--|/\*|\*/')), 
  pattern_flags text check (pattern_flags is null or pattern_flags ~ '^[imsx]*$'),
  exact_value text check (exact_value is null or char_length(exact_value) between 1 and 500),
  target_classification_option_id uuid not null,
  precedence integer not null check (precedence >= 0),
  version integer not null check (version > 0),
  status text not null check (status in ('active','retired','superseded')),
  rationale text not null check (char_length(btrim(rationale)) between 1 and 2000),
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{1,120}$'),
  authored_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  supersedes_rule_id uuid,
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  unique (workspace_id, logical_key, version),
  foreign key (target_classification_option_id, workspace_id) references public.acquisition_classification_options (id, workspace_id) on delete cascade,
  foreign key (supersedes_rule_id, workspace_id) references public.classification_rules (id, workspace_id) on delete cascade,
  constraint classification_rules_matcher_payload check (
    (matcher_kind = 'regex' and pattern is not null and exact_value is null)
    or (matcher_kind = 'exact' and exact_value is not null and pattern is null and pattern_flags is null)
    or (matcher_kind = 'evidence_set' and exact_value is null and pattern is null and pattern_flags is null)
  ),
  constraint classification_rules_no_self_supersede check (supersedes_rule_id is null or supersedes_rule_id <> id)
);
create unique index classification_rules_one_active_logical_uidx on public.classification_rules (workspace_id, logical_key) where status = 'active';
create index classification_rules_active_precedence_idx on public.classification_rules (workspace_id, status, precedence, logical_key);
create index classification_rules_seller_lookup_idx on public.classification_rules (workspace_id, exact_value) where rule_family = 'seller_specialization' and status = 'active';

create table public.acquisition_line_classifications (
  id uuid primary key default gen_random_uuid(),
  public_id text not null default app.mint_governed_public_id('RV-ACLS') check (public_id ~ '^RV-ACLS-[A-Z0-9]{12}$'),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  acquisition_line_item_id uuid not null,
  classification_option_id uuid not null,
  method text not null check (method in ('rule','owner_override','seller_specialization','explicit_evidence')),
  rule_id uuid,
  rule_version integer check (rule_version is null or rule_version > 0),
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  system_provenance text check (system_provenance is null or system_provenance ~ '^[a-z][a-z0-9_.:-]{1,120}$'),
  created_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  supersedes_classification_id uuid,
  superseded_at timestamptz,
  unique (id, workspace_id),
  unique (workspace_id, public_id),
  foreign key (acquisition_line_item_id, workspace_id) references public.acquisition_line_items (id, workspace_id) on delete restrict,
  foreign key (classification_option_id, workspace_id) references public.acquisition_classification_options (id, workspace_id) on delete cascade,
  foreign key (rule_id, workspace_id) references public.classification_rules (id, workspace_id) on delete restrict,
  foreign key (supersedes_classification_id, workspace_id) references public.acquisition_line_classifications (id, workspace_id) on delete cascade,
  constraint acquisition_line_classifications_no_self_supersede check (supersedes_classification_id is null or supersedes_classification_id <> id),
  constraint acquisition_line_classifications_method_actor check (
    (method = 'owner_override' and created_by is not null and system_provenance is null and rule_id is null and rule_version is null)
    or (method in ('rule','seller_specialization','explicit_evidence') and system_provenance is not null)
  ),
  constraint acquisition_line_classifications_rule_presence check (
    (method in ('rule','seller_specialization','explicit_evidence') and rule_id is not null and rule_version is not null)
    or (method = 'owner_override' and rule_id is null and rule_version is null)
  )
);
create unique index acquisition_line_classifications_one_current_uidx on public.acquisition_line_classifications (workspace_id, acquisition_line_item_id) where superseded_at is null;
create unique index acquisition_line_classifications_one_successor_uidx on public.acquisition_line_classifications (workspace_id, supersedes_classification_id) where supersedes_classification_id is not null;
create index acquisition_line_classifications_history_idx on public.acquisition_line_classifications (workspace_id, acquisition_line_item_id, created_at desc);

create function app.classification_rule_target_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rule_version integer;
  v_rule_target_option_id uuid;
begin
  if new.rule_id is null then
    return new;
  end if;

  select r.version, r.target_classification_option_id
    into v_rule_version, v_rule_target_option_id
  from public.classification_rules r
  where r.id = new.rule_id
    and r.workspace_id = new.workspace_id;

  -- Foreign-workspace or missing rule references should reach the composite FK
  -- and fail with 23503 instead of being masked as semantic mismatches.
  if not found then
    return new;
  end if;

  -- Foreign-workspace or missing option references should likewise reach the
  -- option composite FK and fail with 23503.
  if not exists (
    select 1
    from public.acquisition_classification_options o
    where o.id = new.classification_option_id
      and o.workspace_id = new.workspace_id
  ) then
    return new;
  end if;

  if v_rule_version is distinct from new.rule_version
     or v_rule_target_option_id is distinct from new.classification_option_id then
    raise exception 'classification rule target/version mismatch'
      using errcode = '23514';
  end if;

  return new;
end $$;
create trigger acquisition_line_classifications_rule_match before insert or update on public.acquisition_line_classifications for each row execute function app.classification_rule_target_matches();

create function app.prevent_classification_rule_mutation() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then
   if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then return old; end if;
   raise exception 'classification rules are append-only' using errcode='2F000';
 end if;
 if row(old.logical_key,old.rule_family,old.matcher_kind,old.match_field,old.pattern,old.pattern_flags,old.exact_value,old.target_classification_option_id,old.precedence,old.version,old.rationale,old.source,old.authored_by,old.created_at,old.supersedes_rule_id) is distinct from row(new.logical_key,new.rule_family,new.matcher_kind,new.match_field,new.pattern,new.pattern_flags,new.exact_value,new.target_classification_option_id,new.precedence,new.version,new.rationale,new.source,new.authored_by,new.created_at,new.supersedes_rule_id) then raise exception 'classification rule semantic fields are immutable' using errcode='2F000'; end if;
 return new;
end $$;
create trigger classification_rules_append_only before update or delete on public.classification_rules for each row execute function app.prevent_classification_rule_mutation();

create function app.prevent_acquisition_classification_mutation() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then
   if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then return old; end if;
   raise exception 'acquisition classifications are append-only' using errcode='2F000';
 end if;
 if row(old.workspace_id,old.acquisition_line_item_id,old.classification_option_id,old.method,old.rule_id,old.rule_version,old.confidence,old.evidence,old.system_provenance,old.created_by,old.created_at,old.supersedes_classification_id) is distinct from row(new.workspace_id,new.acquisition_line_item_id,new.classification_option_id,new.method,new.rule_id,new.rule_version,new.confidence,new.evidence,new.system_provenance,new.created_by,new.created_at,new.supersedes_classification_id) then raise exception 'acquisition classification fields are immutable' using errcode='2F000'; end if;
 if old.superseded_at is not null or new.superseded_at is null then raise exception 'classification superseded_at may only be set once' using errcode='2F000'; end if;
 return new;
end $$;
create trigger acquisition_line_classifications_append_only before update or delete on public.acquisition_line_classifications for each row execute function app.prevent_acquisition_classification_mutation();

create function app.seed_acquisition_classification_defaults(p_workspace_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_key text; begin
  insert into public.acquisition_classification_options (workspace_id,key,label,description,display_order,active,origin)
  select p_workspace_id, k, l, d, ord, true, 'system_default'
  from (values ('slab','Slab','Graded/slabbed card classification',10),('single','Single','Single-card classification',20),('sealed','Sealed','Sealed TCG product classification',30),('sneakers','Sneakers','Footwear classification',40),('apparel','Apparel','Apparel classification',50),('accessories','Accessories','Accessories classification',60),('electronics','Electronics','Electronics classification',70),('collectibles','Collectibles','Collectibles and games classification',80),('other','Other','Other or personal classification',90),('unreviewed','Unreviewed','Owner review required',100)) v(k,l,d,ord)
  on conflict (workspace_id,key) do nothing;
  for v_key in select k from (values ('slab'),('single'),('sealed'),('sneakers'),('apparel'),('accessories'),('electronics'),('collectibles'),('other'),('unreviewed')) v(k) loop
    if not exists (select 1 from public.acquisition_classification_options o where o.workspace_id=p_workspace_id and o.key=v_key and o.origin='system_default') then
      raise exception 'classification option key % already exists without system_default origin', v_key using errcode='23505';
    end if;
  end loop;

  insert into public.classification_rules (workspace_id,logical_key,rule_family,matcher_kind,match_field,pattern,pattern_flags,exact_value,target_classification_option_id,precedence,version,status,rationale,source)
  select p_workspace_id, logical_key, family, kind, field, pattern, flags, exact_value, o.id, precedence, 5, 'active', rationale, 'legacy_classifier_v5'
  from (values
    ('business_vertical:sneakers_footwear','business_vertical_mapping','exact','business_vertical',null,null,'Sneakers / footwear','sneakers',100,'Legacy non-card vertical mapping.'),
    ('business_vertical:apparel','business_vertical_mapping','exact','business_vertical',null,null,'Apparel','apparel',110,'Legacy non-card vertical mapping.'),
    ('business_vertical:accessories','business_vertical_mapping','exact','business_vertical',null,null,'Accessories','accessories',120,'Legacy non-card vertical mapping.'),
    ('business_vertical:electronics','business_vertical_mapping','exact','business_vertical',null,null,'Electronics','electronics',130,'Legacy non-card vertical mapping.'),
    ('business_vertical:other_collectibles_games','business_vertical_mapping','exact','business_vertical',null,null,'Other collectibles / games','collectibles',140,'Legacy non-card vertical mapping.'),
    ('business_vertical:other_personal','business_vertical_mapping','exact','business_vertical',null,null,'Other / personal','other',150,'Legacy non-card vertical mapping.'),
    ('business_vertical:unclassified_review','business_vertical_mapping','exact','business_vertical',null,null,'Unclassified / review','unreviewed',160,'Legacy non-card vertical mapping.'),
    ('business_vertical:food_consumables','business_vertical_mapping','exact','business_vertical',null,null,'Food / consumables','other',170,'Legacy non-card vertical mapping.'),
    ('explicit_evidence:legacy_sealed_line_ids','explicit_evidence','evidence_set','acquisition_line_id',null,null,null,'sealed',10,'Legacy sealedLineIds explicit evidence placeholder; S1.2 wires governed evidence.'),
    ('delivered_item:slab_word','delivered_item_pattern','regex','delivered_item_title','\bslabs?\b','i',null,'slab',200,'Delivered item concrete slab signal copied from legacy classifier.'),
    ('delivered_item:grader','delivered_item_pattern','regex','delivered_item_title','\b(psa|bgs|cgc|sgc|tag|ace|hga|gma)\s*\.?\s*(?:10|9\.5|9|8\.5|8|7|6|5|4|3|2|1|black|gold|pristine|gem)\b','i',null,'slab',210,'Delivered item grader signal copied from legacy classifier.'),
    ('delivered_item:sealed','delivered_item_pattern','regex','delivered_item_title','booster pack|booster box|booster bundle|\bboosters?\b|\betbs?\b|elite trainer|\bupc\b|ultra[- ]premium|build\s*(&|and)\s*battle|\bsealed\b|sleeved|\btin\b|blister|collection box|premium collection|\bpacks?\b|\bbundle\b','i',null,'sealed',220,'Delivered item sealed-product signal copied from legacy classifier.'),
    ('delivered_item:single','delivered_item_pattern','regex','delivered_item_title','\bsingles?\b|\bnm-?lp\b|\bnm\b|near mint|\bjumbo\b','i',null,'single',230,'Delivered item single-card signal copied from legacy classifier.'),
    ('strong_mystery:title','strong_mystery_pattern','regex','full_title','mystery|wheel|\bspin\b|\brazz\b|raffle|jackpot','i',null,'unreviewed',300,'Strong mystery/gambling terms copied from legacy classifier.'),
    ('full_title:slab_word','full_title_pattern','regex','full_title','\bslabs?\b','i',null,'slab',400,'Full-title slab fallback copied from legacy classifier.'),
    ('full_title:grader','full_title_pattern','regex','full_title','\b(psa|bgs|cgc|sgc|tag|ace|hga|gma)\s*\.?\s*(?:10|9\.5|9|8\.5|8|7|6|5|4|3|2|1|black|gold|pristine|gem)\b','i',null,'slab',410,'Full-title grader fallback copied from legacy classifier.'),
    ('full_title:sealed','full_title_pattern','regex','full_title','booster pack|booster box|booster bundle|\bboosters?\b|\betbs?\b|elite trainer|\bupc\b|ultra[- ]premium|build\s*(&|and)\s*battle|\bsealed\b|sleeved|\btin\b|blister|collection box|premium collection|\bpacks?\b|\bbundle\b','i',null,'sealed',420,'Full-title sealed-product fallback copied from legacy classifier.'),
    ('full_title:single','full_title_pattern','regex','full_title','\bsingles?\b|\bnm-?lp\b|\bnm\b|near mint|\bjumbo\b','i',null,'single',430,'Full-title single-card fallback copied from legacy classifier.'),
    ('seller:topshelfcollects','seller_specialization','exact','seller_normalized',null,null,'topshelfcollects','single',900,'Owner-confirmed fallback specialization; must not override a more specific product signal.'),
    ('seller:loosepacks','seller_specialization','exact','seller_normalized',null,null,'loosepacks','sealed',910,'Owner-confirmed fallback specialization; must not override a more specific product signal.'),
    ('seller:findsfordays','seller_specialization','exact','seller_normalized',null,null,'findsfordays','single',920,'Owner-confirmed fallback specialization; must not override a more specific product signal.')
  ) r(logical_key,family,kind,field,pattern,flags,exact_value,target_key,precedence,rationale)
  join public.acquisition_classification_options o on o.workspace_id=p_workspace_id and o.key=r.target_key
  on conflict (workspace_id, logical_key, version) do nothing;
end $$;
revoke all on function app.seed_acquisition_classification_defaults(uuid) from public;

select app.seed_acquisition_classification_defaults(id) from public.workspaces;

create function app.seed_acquisition_classification_defaults_for_workspace() returns trigger language plpgsql security definer set search_path='' as $$ begin perform app.seed_acquisition_classification_defaults(new.id); return new; end $$;
revoke all on function app.seed_acquisition_classification_defaults_for_workspace() from public;
create trigger workspaces_seed_acquisition_classification_defaults after insert on public.workspaces for each row execute function app.seed_acquisition_classification_defaults_for_workspace();

alter table public.acquisition_classification_options enable row level security;
alter table public.classification_rules enable row level security;
alter table public.acquisition_line_classifications enable row level security;
revoke all on table public.acquisition_classification_options, public.classification_rules, public.acquisition_line_classifications from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname='service_role') then execute 'revoke all on table public.acquisition_classification_options, public.classification_rules, public.acquisition_line_classifications from service_role'; end if; end $$;
grant select on table public.acquisition_classification_options, public.classification_rules, public.acquisition_line_classifications to authenticated;
create policy acquisition_classification_options_select on public.acquisition_classification_options for select to authenticated using (app.member_role(workspace_id) is not null);
create policy classification_rules_select on public.classification_rules for select to authenticated using (app.member_role(workspace_id) is not null);
create policy acquisition_line_classifications_select on public.acquisition_line_classifications for select to authenticated using (app.member_role(workspace_id) is not null);

insert into public.schema_migrations_log (migration_name) values ('20260804000100_governed_acquisition_classification');
