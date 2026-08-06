-- S1.4 acceptance completion: migration-ledger repair, proven detail root-row
-- cardinality, and truthful source-evidence naming.
--
-- Forward-only and additive. Migrations 00200, 00300, 00400, and 00500 are
-- merged history and are NOT edited here.
--
-- 1. Ledger repair. 20260806000500_acquisition_source_qualified_uuid_lookup
--    applied a physical migration without recording itself in
--    public.schema_migrations_log, so the ledger fell one entry behind the
--    migration directory. The backfill below is duplicate-safe so a database
--    that already carries the entry (a future re-ordering, or a hand repair)
--    is left untouched rather than failing the reset.
insert into public.schema_migrations_log (migration_name)
values ('20260806000500_acquisition_source_qualified_uuid_lookup')
on conflict (migration_name) do nothing;

-- 2. Exact detail root-row cardinality.
--
--    The merged implementation counted DISTINCT acquisition_line_item_id and
--    then closed the final query with an arbitrary LIMIT 1. Neither proves the
--    read model returns one root row. public.acquisition_line_overview LEFT
--    JOINs acquisition_lot_lines on state='active', so a line carrying two
--    active placements yields TWO overview rows while still counting ONE
--    distinct line id: the old check passed, `select * into v` then took an
--    arbitrary row, and LIMIT 1 silently picked an arbitrary lot. That is the
--    precise shape of a split-brain placement being reported as fact.
--
--    Counting overview ROWS closes it. supplier_aliases is unique on
--    (workspace_id, source_system_id, raw_handle) and every other join in the
--    view is to a primary key, so acquisition_lot_lines is the view's only
--    row multiplier: count(*) > 1 is exactly "more than one active placement".
--
--    The final query is one-row-safe because its cardinality is proven, not
--    because PostgreSQL was told to pick a row. It is driven from a literal
--    one-row source and every join is a LEFT JOIN to a unique key, so it
--    yields exactly one row by construction; INTO STRICT enforces that
--    reasoning at runtime and any violation raises acquisition_integrity_error
--    rather than returning an arbitrary answer.
--
--    Placement outcomes are therefore: zero active placements ->
--    'missing_active_placement' (the line is real but currently unplaced, so
--    no lot is invented); exactly one -> that exact lot; more than one ->
--    fail closed.
--
-- 3. Truthful source evidence. The response advertised
--    'acquisitionImportPublicIdentity', but the value is
--    public.import_jobs.public_id reached through
--    acquisition_import_jobs.source_import_job_id — the SOURCE import job, not
--    the acquisition import job. public.acquisition_import_jobs has no
--    governed public ID, and inventing one to keep the old name would be
--    fabricating an identity, so the field is renamed to what it actually is:
--    'sourceImportJobPublicId'. Likewise 'sourceRecordPublicIdentity' carried
--    public.source_records.source_row_key — a raw source row key, never an
--    RV-style governed public identity — and is renamed 'sourceRecordRowKey'.
create or replace function public.get_acquisition_line_detail_by_source(p_workspace_id uuid, p_source_system_public_id text, p_acquisition_line_public_id text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v public.acquisition_line_overview%rowtype; result jsonb; placement_rows integer;
begin
 perform app.assert_workspace_role(p_workspace_id,array['owner','operator','viewer']::public.workspace_role[]);

 -- Root-row cardinality over ROWS, never distinct line ids, and proven in the
 -- SAME statement that fetches the row. Counting first and selecting second
 -- would take two READ COMMITTED snapshots, so a placement written between
 -- them would let a non-strict SELECT INTO fall back to an arbitrary row --
 -- the very failure this replaces. INTO STRICT cannot do that.
 begin
  select * into strict v from public.acquisition_line_overview
   where workspace_id=p_workspace_id and source_system_public_id=p_source_system_public_id and acquisition_line_public_id=p_acquisition_line_public_id;
 exception
  -- Zero matches and a foreign workspace are indistinguishable to the caller.
  when no_data_found then return null;
  when too_many_rows then raise exception 'acquisition_integrity_error' using errcode='23514';
 end;

 -- Named, direct proof of the placement contract, independent of the view.
 select count(*) into placement_rows from public.acquisition_lot_lines
  where workspace_id=p_workspace_id and line_item_id=v.acquisition_line_item_id and state='active';
 if placement_rows>1 then raise exception 'acquisition_integrity_error' using errcode='23514'; end if;

 begin
  select jsonb_build_object(
   'coverage','governed_native_committed','historicalLegacyImported',false,
   'identity',jsonb_build_object('sourceSystemPublicId',v.source_system_public_id,'linePublicId',v.acquisition_line_public_id),
   'line',jsonb_build_object('publicId',v.acquisition_line_public_id,'quantity',v.quantity,'description',v.description,'referenceNumber',v.reference_number,'sourceDetail',v.source_detail,'createdAt',v.created_at,'businessVertical',v.business_vertical,'fullTitle',v.full_title,'deliveredItemTitle',v.delivered_item_title,'sellerNormalized',v.seller_normalized),
   'order',jsonb_build_object('publicId',v.acquisition_order_public_id,'sourceOrderReference',v.source_order_reference,'status',v.order_status,'sourceReportedStatus',v.source_reported_status,'sourceReportedTotalMinor',o.source_reported_total_minor,'currency',o.currency,'occurredAt',v.occurred_at,
     'channel',jsonb_build_object('publicId',ch.public_id,'name',ch.name),
     'supplier',jsonb_build_object('publicId',s.public_id,'displayName',s.display_name),
     'sourceSystem',jsonb_build_object('publicId',v.source_system_public_id,'kind',v.source_system_kind)),
   'placement',jsonb_build_object('lotPublicId',lot.public_id,'sequence',lot.sequence_no,'label',lot.label,'integrityState',case when lot.id is null then 'missing_active_placement' else 'current' end),
   'classification',case when c.id is null then null else jsonb_build_object('publicId',c.public_id,'optionKey',co.key,'optionLabel',co.label,'method',c.method,'confidence',c.confidence,'createdAt',c.created_at,'state',v.classification_state,'rulePublicId',r.public_id,'ruleLogicalKey',r.logical_key,'ruleVersion',c.rule_version) end,
   'classificationHistory',(select coalesce(jsonb_agg(jsonb_build_object('publicId',h.public_id,'optionKey',ho.key,'optionLabel',ho.label,'method',h.method,'confidence',h.confidence,'createdAt',h.created_at,'supersededAt',h.superseded_at,'ownerOverrideReason',h.evidence->>'owner_reason') order by h.created_at,h.id),'[]') from public.acquisition_line_classifications h join public.acquisition_classification_options ho on ho.id=h.classification_option_id and ho.workspace_id=h.workspace_id where h.workspace_id=p_workspace_id and h.acquisition_line_item_id=v.acquisition_line_item_id),
   'classificationOptions',(select coalesce(jsonb_agg(jsonb_build_object('key',x.key,'label',x.label) order by x.display_order,x.key),'[]') from public.acquisition_classification_options x where x.workspace_id=p_workspace_id and x.active),
   'payments',(select coalesce(jsonb_agg(jsonb_build_object('publicId',p.public_id,'paidAt',p.paid_at,'amountMinor',p.amount_minor,'currency',p.currency,'instrument',p.instrument,'externalReference',p.external_reference,'evidenceNote',p.evidence_note,'state',case when p.reversed_at is null then 'active' else 'reversed' end,'reversedAt',p.reversed_at,'reversalReason',p.reversal_reason,'reversalEvent',case when pr.id is null then null else jsonb_build_object('publicId',pr.public_id,'actorId',pr.reversed_by,'reversedAt',pr.reversed_at,'reason',pr.reason) end) order by p.paid_at,p.created_at),'[]') from public.acquisition_payments p left join public.acquisition_payment_reversals pr on pr.id=p.reversal_event_id and pr.workspace_id=p.workspace_id where p.workspace_id=p_workspace_id and p.acquisition_order_id=v.acquisition_order_id),
   'paymentSummary',(select jsonb_build_object('activeCount',count(*) filter(where p.reversed_at is null),'activeCurrencies',coalesce(jsonb_agg(distinct p.currency) filter(where p.reversed_at is null),'[]'),'mixedCurrencies',count(distinct p.currency) filter(where p.reversed_at is null)>1,'activeTotalMinor',case when count(distinct p.currency) filter(where p.reversed_at is null)=1 then sum(p.amount_minor) filter(where p.reversed_at is null) end,'sourceReportedTotalMinor',o.source_reported_total_minor,'differenceMinor',case when count(distinct p.currency) filter(where p.reversed_at is null)=1 and min(p.currency) filter(where p.reversed_at is null)=o.currency then o.source_reported_total_minor-sum(p.amount_minor) filter(where p.reversed_at is null) end) from public.acquisition_payments p where p.workspace_id=p_workspace_id and p.acquisition_order_id=v.acquisition_order_id),
   'shipments',(select coalesce(jsonb_agg(jsonb_build_object('publicId',sh.public_id,'carrier',sh.carrier,'trackingNumber',sh.tracking_number,'status',sh.status,'shippedAt',sh.shipped_at,'expectedAt',sh.expected_at,'receivedAt',sh.received_at,'shippingReferenceMinor',sh.shipping_cost_minor,'currency',sh.currency,'evidenceNote',sh.evidence_note,'transitionHistory',(select coalesce(jsonb_agg(jsonb_build_object('publicId',t.public_id,'fromStatus',t.from_status,'toStatus',t.to_status,'applied',t.applied,'receivedAt',t.received_at,'reason',t.reason,'actorId',t.transitioned_by,'createdAt',t.created_at) order by t.created_at,t.id),'[]') from public.acquisition_shipment_transitions t where t.workspace_id=sh.workspace_id and t.acquisition_shipment_id=sh.id),'allowedNextTransitions',case sh.status when 'expected' then '["in_transit","delivered","lost","cancelled"]'::jsonb when 'in_transit' then '["delivered","lost","cancelled"]'::jsonb when 'lost' then '["in_transit","delivered","cancelled"]'::jsonb else '[]'::jsonb end) order by sh.created_at),'[]') from public.acquisition_shipments sh where sh.workspace_id=p_workspace_id and sh.acquisition_order_id=v.acquisition_order_id),
   'sourceEvidence',jsonb_build_object(
     'sourceSystemPublicId',v.source_system_public_id,
     -- A raw source row key. Never presented as a governed RV public identity.
     'sourceRecordRowKey',(select sr.source_row_key from public.source_records sr where sr.id=v.source_record_id and sr.workspace_id=p_workspace_id),
     -- public.import_jobs.public_id: the SOURCE import job behind this
     -- acquisition import. acquisition_import_jobs has no governed public ID.
     'sourceImportJobPublicId',(select ij.public_id from public.import_jobs ij where ij.id=v.source_import_job_id and ij.workspace_id=p_workspace_id))
  ) into strict result
  -- One literal root row; every join below is a LEFT JOIN onto a unique key,
  -- so exactly one row is produced without an arbitrary LIMIT.
  from (select 1) as root(one)
  left join public.acquisition_orders o on o.id=v.acquisition_order_id and o.workspace_id=p_workspace_id
  left join public.channels ch on ch.id=o.channel_id and ch.workspace_id=o.workspace_id
  left join public.suppliers s on s.id=o.supplier_id and s.workspace_id=o.workspace_id
  left join public.acquisition_lot_lines ll on ll.line_item_id=v.acquisition_line_item_id and ll.workspace_id=p_workspace_id and ll.state='active'
  left join public.acquisition_lots lot on lot.id=ll.lot_id and lot.workspace_id=ll.workspace_id
  left join public.acquisition_line_classifications c on c.id=v.classification_id and c.workspace_id=p_workspace_id
  left join public.acquisition_classification_options co on co.id=c.classification_option_id and co.workspace_id=p_workspace_id
  left join public.classification_rules r on r.id=c.rule_id and r.workspace_id=p_workspace_id;
 exception
  -- The cardinality argument above is enforced, not assumed.
  when too_many_rows or no_data_found then raise exception 'acquisition_integrity_error' using errcode='23514';
 end;

 return result;
end $function$;

-- 4. The S1.4 mutation path could never succeed.
--
--    record_acquisition_payment, reverse_acquisition_payment,
--    create_acquisition_shipment, and transition_acquisition_shipment each
--    compute their idempotency fingerprint with an UNQUALIFIED digest(). All
--    four are SECURITY DEFINER with `SET search_path = ''`, and pgcrypto is not
--    installed in this database at all, so digest() resolves nowhere: every one
--    of those calls raises 42883 undefined_function the moment control reaches
--    the fingerprint assignment.
--
--    That assignment sits AFTER role, validation, and order-resolution checks,
--    so every fail-closed path returned before reaching it and looked healthy,
--    while every success path was dead. This is why S1.4 has no successful
--    payment, reversal, shipment, or transition lifecycle to point at: not an
--    untested feature, an unexecutable one. supabase/tests/61 now drives all
--    four to completion, which is what surfaced it.
--
--    These eight digest() calls are the only ones in the repository; every
--    other hash uses encode(sha256(convert_to(..., 'UTF8')), 'hex'), whose
--    sha256/convert_to/encode all live in pg_catalog and therefore resolve
--    under an empty search_path. The four functions are restored below at
--    their latest merged definitions — payment, reversal, and transition from
--    00300, shipment creation from 00400 — with the hash expression corrected
--    and NO other behavioral change. Fingerprints are recomputed the same way
--    on both write and replay, and no S1.4 payment or shipment row can exist
--    yet, so there is nothing to migrate.
create or replace function public.record_acquisition_payment(p_workspace_id uuid,p_acquisition_order_public_id text,p_paid_at timestamptz,p_amount_minor bigint,p_currency text,p_instrument text,p_external_reference text default null,p_source_record_id uuid default null,p_evidence_note text default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; o public.acquisition_orders%rowtype; x public.acquisition_payments%rowtype; fp text; ext text:=nullif(btrim(p_external_reference),''); note text:=nullif(btrim(p_evidence_note),''); key text:=btrim(coalesce(p_idempotency_key,'')); cur text:=upper(btrim(coalesce(p_currency,'')));
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]);
 if p_paid_at is null or p_amount_minor is null or p_amount_minor<=0 or char_length(key) not between 8 and 200 or char_length(coalesce(ext,''))>200 or char_length(coalesce(note,''))>1000 then raise exception 'invalid_request' using errcode='22023'; end if;
 if cur !~ '^[A-Z]{3}$' then raise exception 'invalid_currency' using errcode='22023'; end if;
 if p_instrument not in ('card','bank','balance','credit','cash','other') then raise exception 'invalid_instrument' using errcode='22023'; end if;
 select a.* into o from public.acquisition_orders a join public.acquisition_import_jobs j on j.id=a.acquisition_import_job_id and j.workspace_id=a.workspace_id and j.status='committed' where a.workspace_id=p_workspace_id and a.public_id=p_acquisition_order_public_id;
 if o.id is null then raise exception 'acquisition_not_found' using errcode='P0002'; end if;
 if p_source_record_id is not null and not exists(select 1 from public.source_records s where s.id=p_source_record_id and s.workspace_id=p_workspace_id) then raise exception 'invalid_source_evidence' using errcode='22023'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_object('order_id',o.id,'paid_at',p_paid_at,'amount_minor',p_amount_minor,'currency',cur,'instrument',p_instrument,'external_reference',ext,'source_record_id',p_source_record_id,'evidence_note',note)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||key,0)); select * into x from public.acquisition_payments where workspace_id=p_workspace_id and idempotency_key=key;
 if x.id is not null then if x.payload_fingerprint<>fp then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('paymentPublicId',x.public_id,'replayed',true); end if;
 begin insert into public.acquisition_payments(workspace_id,acquisition_order_id,paid_at,amount_minor,currency,instrument,external_reference,source_record_id,evidence_note,idempotency_key,payload_fingerprint,created_by) values(p_workspace_id,o.id,p_paid_at,p_amount_minor,cur,p_instrument::public.acquisition_payment_instrument,ext,p_source_record_id,note,key,fp,u) returning * into x;
 exception when unique_violation then if ext is not null and exists(select 1 from public.acquisition_payments p where p.workspace_id=p_workspace_id and lower(p.external_reference)=lower(ext) and p.reversed_at is null) then raise exception 'duplicate_external_reference' using errcode='23505'; end if; raise exception 'idempotency_conflict' using errcode='23505'; end;
 perform app.log_audit_event(p_workspace_id,'acquisition_payment_recorded','acquisition_payments',x.id,u,'acquisition.payment',null,p_source_record_id,null,jsonb_build_object('payment_public_id',x.public_id,'order_public_id',o.public_id,'amount_minor',p_amount_minor,'currency',cur));
 return jsonb_build_object('paymentPublicId',x.public_id,'replayed',false);
end $$;

create or replace function public.reverse_acquisition_payment(p_workspace_id uuid,p_payment_public_id text,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; x public.acquisition_payments%rowtype; e public.acquisition_payment_reversals%rowtype; reason text:=btrim(coalesce(p_reason,'')); key text:=btrim(coalesce(p_idempotency_key,'')); fp text;
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner']::public.workspace_role[]); if char_length(reason) not between 1 and 500 or char_length(key) not between 8 and 200 then raise exception 'invalid_request' using errcode='22023'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_object('payment_public_id',btrim(p_payment_public_id),'reason',reason)::text,'UTF8')),'hex'); perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||key,0));
 select * into e from public.acquisition_payment_reversals where workspace_id=p_workspace_id and idempotency_key=key; if e.id is not null then if e.payload_fingerprint<>fp then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('paymentPublicId',p_payment_public_id,'reversalPublicId',e.public_id,'replayed',true,'state','reversed'); end if;
 select * into x from public.acquisition_payments where workspace_id=p_workspace_id and public_id=p_payment_public_id for update; if x.id is null then raise exception 'payment_not_found' using errcode='P0002'; end if; if x.reversed_at is not null then raise exception 'already_reversed' using errcode='23505'; end if;
 insert into public.acquisition_payment_reversals(workspace_id,acquisition_payment_id,reason,idempotency_key,payload_fingerprint,reversed_by) values(p_workspace_id,x.id,reason,key,fp,u) returning * into e;
 perform set_config('app.governed_acquisition_mutation','on',true); update public.acquisition_payments set reversed_at=e.reversed_at,reversed_by=u,reversal_reason=reason,reversal_idempotency_key=key,reversal_event_id=e.id where id=x.id;
 perform app.log_audit_event(p_workspace_id,'acquisition_payment_reversed','acquisition_payments',x.id,u,'acquisition.payment',null,x.source_record_id,null,jsonb_build_object('payment_public_id',x.public_id,'reversal_public_id',e.public_id,'reason',reason));
 return jsonb_build_object('paymentPublicId',x.public_id,'reversalPublicId',e.public_id,'replayed',false,'state','reversed');
end $$;

create or replace function public.create_acquisition_shipment(p_workspace_id uuid, p_acquisition_order_public_id text, p_carrier text default null, p_tracking_number text default null, p_shipped_at timestamptz default null, p_expected_at timestamptz default null, p_status text default 'expected', p_shipping_cost_minor bigint default null, p_currency text default null, p_source_record_id uuid default null, p_evidence_note text default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; o public.acquisition_orders%rowtype; x public.acquisition_shipments%rowtype; car text:=nullif(btrim(p_carrier),''); track text:=nullif(btrim(p_tracking_number),''); normalized_car text:=nullif(lower(btrim(p_carrier)),''); normalized_track text:=nullif(lower(regexp_replace(btrim(p_tracking_number),'[[:space:]-]','','g')),''); note text:=nullif(btrim(p_evidence_note),''); key text:=btrim(coalesce(p_idempotency_key,'')); cur text:=nullif(upper(btrim(p_currency)),''); fp text; recv timestamptz;
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]); if p_status not in ('expected','in_transit') then raise exception 'invalid_initial_status' using errcode='22023'; end if; if char_length(key) not between 8 and 200 or char_length(coalesce(car,''))>100 or char_length(coalesce(track,''))>200 or char_length(coalesce(note,''))>1000 then raise exception 'invalid_request' using errcode='22023'; end if;
 if p_shipping_cost_minor is not null and p_shipping_cost_minor<0 then raise exception 'invalid_shipping_reference_amount' using errcode='22023'; end if; if (p_shipping_cost_minor is null)<>(cur is null) or (cur is not null and cur !~ '^[A-Z]{3}$') then raise exception 'invalid_currency' using errcode='22023'; end if; if p_expected_at is not null and p_shipped_at is not null and p_expected_at<p_shipped_at then raise exception 'invalid_request' using errcode='22023'; end if;
 select a.* into o from public.acquisition_orders a join public.acquisition_import_jobs j on j.id=a.acquisition_import_job_id and j.workspace_id=a.workspace_id and j.status='committed' where a.workspace_id=p_workspace_id and a.public_id=p_acquisition_order_public_id; if o.id is null then raise exception 'acquisition_not_found' using errcode='P0002'; end if;
 if p_source_record_id is not null and not exists(select 1 from public.source_records s where s.id=p_source_record_id and s.workspace_id=p_workspace_id) then raise exception 'invalid_source_evidence' using errcode='22023'; end if;
 recv:=null; fp:=encode(sha256(convert_to(jsonb_build_object('order_id',o.id,'carrier',normalized_car,'tracking_number',normalized_track,'shipped_at',p_shipped_at,'expected_at',p_expected_at,'status',p_status,'shipping_cost_minor',p_shipping_cost_minor,'currency',cur,'source_record_id',p_source_record_id,'evidence_note',note)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||key,0)); select * into x from public.acquisition_shipments where workspace_id=p_workspace_id and create_idempotency_key=key; if x.id is not null then if x.create_fingerprint<>fp then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('shipmentPublicId',x.public_id,'status',x.status,'replayed',true); end if;
 begin insert into public.acquisition_shipments(workspace_id,acquisition_order_id,carrier,tracking_number,shipped_at,expected_at,received_at,status,shipping_cost_minor,currency,source_record_id,evidence_note,create_idempotency_key,create_fingerprint,created_by) values(p_workspace_id,o.id,car,track,p_shipped_at,p_expected_at,recv,p_status::public.acquisition_shipment_status,p_shipping_cost_minor,cur,p_source_record_id,note,key,fp,u) returning * into x; exception when unique_violation then if car is not null and track is not null and exists(select 1 from public.acquisition_shipments s where s.workspace_id=p_workspace_id and lower(btrim(s.carrier))=normalized_car and lower(regexp_replace(btrim(s.tracking_number),'[[:space:]-]','','g'))=normalized_track) then raise exception 'duplicate_tracking' using errcode='23505'; end if; raise exception 'idempotency_conflict' using errcode='23505'; end;
 perform app.log_audit_event(p_workspace_id,'acquisition_shipment_created','acquisition_shipments',x.id,u,'acquisition.shipment',null,p_source_record_id,null,jsonb_build_object('shipment_public_id',x.public_id,'order_public_id',o.public_id,'status',x.status)); return jsonb_build_object('shipmentPublicId',x.public_id,'status',x.status,'replayed',false);
end $$;

create or replace function public.transition_acquisition_shipment(p_workspace_id uuid,p_shipment_public_id text,p_expected_status text,p_new_status text,p_received_at timestamptz default null,p_reason text default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; x public.acquisition_shipments%rowtype; e public.acquisition_shipment_transitions%rowtype; reason text:=nullif(btrim(p_reason),''); key text:=btrim(coalesce(p_idempotency_key,'')); fp text; allowed boolean; recv timestamptz;
begin
 u:=app.assert_workspace_role(p_workspace_id,array['owner','operator']::public.workspace_role[]); if char_length(key) not between 8 and 200 then raise exception 'invalid_request' using errcode='22023'; end if; if p_expected_status not in ('expected','in_transit','delivered','lost','cancelled') or p_new_status not in ('expected','in_transit','delivered','lost','cancelled') then raise exception 'invalid_transition' using errcode='22023'; end if;
 recv:=case when p_new_status='delivered' then p_received_at else null end; if p_new_status='delivered' and recv is null then raise exception 'invalid_request' using errcode='22023'; end if; if p_new_status in ('lost','cancelled') and reason is null then raise exception 'invalid_request' using errcode='22023'; end if;
 fp:=encode(sha256(convert_to(jsonb_build_object('shipment_public_id',btrim(p_shipment_public_id),'expected_status',p_expected_status,'new_status',p_new_status,'received_at',recv,'reason',reason)::text,'UTF8')),'hex'); perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||key,0));
 select * into e from public.acquisition_shipment_transitions where workspace_id=p_workspace_id and idempotency_key=key; if e.id is not null then if e.payload_fingerprint<>fp then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('shipmentPublicId',p_shipment_public_id,'transitionPublicId',e.public_id,'status',e.to_status,'applied',e.applied,'replayed',true); end if;
 select * into x from public.acquisition_shipments where workspace_id=p_workspace_id and public_id=p_shipment_public_id for update; if x.id is null then raise exception 'shipment_not_found' using errcode='P0002'; end if; if x.status::text<>p_expected_status then raise exception 'stale_status' using errcode='40001'; end if;
 if p_new_status=p_expected_status then insert into public.acquisition_shipment_transitions(workspace_id,acquisition_shipment_id,from_status,to_status,applied,received_at,reason,idempotency_key,payload_fingerprint,transitioned_by) values(p_workspace_id,x.id,x.status,x.status,false,case when x.status='delivered' then x.received_at else null end,reason,key,fp,u) returning * into e; return jsonb_build_object('shipmentPublicId',x.public_id,'transitionPublicId',e.public_id,'status',x.status,'applied',false,'replayed',false); end if;
 allowed := (p_expected_status='expected' and p_new_status in ('in_transit','delivered','lost','cancelled')) or (p_expected_status='in_transit' and p_new_status in ('delivered','lost','cancelled')) or (p_expected_status='lost' and p_new_status in ('in_transit','delivered','cancelled')); if not allowed then raise exception 'invalid_transition' using errcode='22023'; end if;
 insert into public.acquisition_shipment_transitions(workspace_id,acquisition_shipment_id,from_status,to_status,applied,received_at,reason,idempotency_key,payload_fingerprint,transitioned_by) values(p_workspace_id,x.id,x.status,p_new_status::public.acquisition_shipment_status,true,recv,reason,key,fp,u) returning * into e;
 perform set_config('app.governed_acquisition_mutation','on',true); update public.acquisition_shipments set status=p_new_status::public.acquisition_shipment_status,received_at=recv,transition_reason=reason,transition_idempotency_key=null,transition_fingerprint=null,updated_at=now() where id=x.id returning * into x;
 perform app.log_audit_event(p_workspace_id,'acquisition_shipment_transitioned','acquisition_shipments',x.id,u,'acquisition.shipment',null,x.source_record_id,null,jsonb_build_object('shipment_public_id',x.public_id,'transition_public_id',e.public_id,'old_status',p_expected_status,'new_status',x.status,'reason',reason)); return jsonb_build_object('shipmentPublicId',x.public_id,'transitionPublicId',e.public_id,'status',x.status,'applied',true,'replayed',false);
end $$;

insert into public.schema_migrations_log (migration_name)
values ('20260806000600_acquisition_s1_4_acceptance_completion')
on conflict (migration_name) do nothing;
