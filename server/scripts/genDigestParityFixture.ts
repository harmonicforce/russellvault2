// Generator for supabase/tests/15_acquisition_digest_parity.sql.
//
// Proves the Node planDigest (server/src/acquisition/planDigest.ts) and the
// PostgreSQL app.compute_acquisition_plan_digest agree byte-for-byte on the
// EXACT 2,149-line Whatnot driver plan. The Node side computes the plan's
// planSha256 over deterministic provenance UUIDs; the generated pgTAP file
// seeds those same UUIDs, stages the identical plan through the real staged-
// import RPCs, then asserts the database recomputes the identical digest and
// commits. Regenerate with:
//
//   npx tsx server/scripts/genDigestParityFixture.ts
//
// The .sql it writes is committed and runs in BOTH db:test tiers (the psql
// shim and the Docker-local Supabase stack via pg_prove).

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImportPlan } from '../src/provenance/adapter.js';
import { buildAcquisitionPlan, type CommittedSourceRow } from '../src/acquisition/adapter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(ROOT, 'supabase', 'tests', '15_acquisition_digest_parity.sql');

// Deterministic provenance UUIDs — the same bytes the Node digest hashes and
// the SQL seeds. Postgres renders uuid::text lowercase with dashes; these match.
function srUuid(i: number): string {
  return `77770000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
}
function extUuid(i: number): string {
  return `88880000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
}

// SQL string literal (single-quote escaped).
function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
// SQL literal for a nullable text.
function qn(s: string | null): string {
  return s === null ? 'null' : q(s);
}

function main(): void {
  const provenance = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
  const rows: CommittedSourceRow[] = provenance.records.map((r) => ({
    sourceRecordId: srUuid(r.sourceRowIndex),
    externalIdentifierId: r.sourceRowKey ? extUuid(r.sourceRowIndex) : null,
    sourceRowIndex: r.sourceRowIndex,
    rawPayload: r.rawPayload,
  }));
  const plan = buildAcquisitionPlan(rows, { sourceLabel: 'whatnot_purchases.json' });

  const digest = plan.planSha256;
  const nOrders = plan.expectedOrders;
  const nLots = plan.expectedLots;
  const nLines = plan.expectedLineItems;
  const nComps = plan.expectedCostComponents;
  const nCand = plan.expectedUnresolvedSupplierCandidates;
  const nUcost = plan.expectedUnresolvedCostComponents;

  // Index the 1:1 order and component by their line.
  const orderByRef = new Map(plan.orders.map((o) => [o.sourceOrderReference, o]));
  const compByPublic = new Map(plan.costComponents.map((c) => [c.lineItemPublicId, c]));

  // source_records / external_identifiers rows, keyed to the deterministic UUIDs.
  const srValues: string[] = [];
  const extValues: string[] = [];
  const planLineValues: string[] = [];

  for (const li of plan.lineItems) {
    const o = orderByRef.get(li.sourceOrderReference);
    if (!o) throw new Error(`no order for ${li.sourceOrderReference}`);
    const c = compByPublic.get(li.publicId);
    if (!c) throw new Error(`no component for ${li.publicId}`);
    const idx = provenance.records.find((r) =>
      (r.rawPayload as Record<string, unknown>)['acquisition_line_id'] === li.publicId
    );
    if (!idx) throw new Error(`no source record for ${li.publicId}`);
    const i = idx.sourceRowIndex;
    const srId = srUuid(i);
    const extId = li.externalIdentifierId ? extUuid(i) : null;
    const payload = q(JSON.stringify(idx.rawPayload));

    srValues.push(
      `(${q(srId)},'aaaa0000-0000-4000-8000-000000000001',` +
        `'66660000-0000-4000-8000-000000000001',${i},${q(li.publicId)},` +
        `${payload}::jsonb,${q(createHash('sha256').update('r' + i).digest('hex'))},` +
        `'parsed','{}'::jsonb,'1.0.0','1.0.0','provenance.import')`
    );
    if (extId) {
      extValues.push(
        `(${q(extId)},'aaaa0000-0000-4000-8000-000000000001',` +
          `'55550000-0000-4000-8000-000000000001','fixture.whatnot_purchases','source_row_key',` +
          `${q(li.publicId)},${q(srId)},'provenance.import')`
      );
    }

    // plan_lines carries every per-line fact the staging RPCs need, plus the
    // order and component facts (1:1 in this fixture).
    planLineValues.push(
      `(${q(li.publicId)},${q(o.sourceOrderReference)},${q(o.sellerRawHandle)},` +
        `${q(o.orderStatus)},${q(o.sourceReportedStatus)},` +
        `${o.sourceReportedTotalMinor === null ? 'null' : o.sourceReportedTotalMinor},` +
        `${qn(o.currency)},${qn(o.occurredAt)},` +
        `${q(srId)},${qn(extId)},${li.quantity},${qn(li.description)},${qn(li.referenceNumber)},` +
        `${q(JSON.stringify(li.sourceDetail))}::jsonb,` +
        `${q(c.amountState)},${c.amountMinor === null ? 'null' : c.amountMinor},${qn(c.evidenceNote)})`
    );
  }

  const sql = `-- Phase 4 acquisition digest parity — GENERATED by
-- server/scripts/genDigestParityFixture.ts. DO NOT EDIT BY HAND; regenerate.
--
-- Proves the Node planDigest and app.compute_acquisition_plan_digest agree
-- byte-for-byte on the EXACT ${nLines}-line Whatnot driver plan. The Node plan
-- (planSha256 below) is computed over the same deterministic provenance UUIDs
-- this file seeds; the plan is staged through the real staged-import RPCs; the
-- database then recomputes the digest from the staged rows and must produce the
-- identical value, and the job commits under it. Runs in BOTH db:test tiers.
begin;
create extension if not exists pgtap;
select plan(4);

create function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create temp table ids (k text primary key, v uuid);
grant all on table ids to public;
create function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ids values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v;
$$;
create function pg_temp.get(p_k text) returns uuid language sql stable as $$
  select v from ids where k = p_k;
$$;

-- Fixture scaffolding ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('a2222222-2222-2222-2222-222222222222', 'operator@example.test');
insert into public.workspaces (id, name, created_by) values
  ('aaaa0000-0000-4000-8000-000000000001', 'WS A', 'a1111111-1111-1111-1111-111111111111');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('aaaa0000-0000-4000-8000-000000000001', 'a2222222-2222-2222-2222-222222222222', 'operator');
insert into public.source_systems (id, workspace_id, public_id, kind, instance_label, created_by)
values
  ('55550000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
   'REPO', 'repository_fixture', 'seed fixtures', 'a1111111-1111-1111-1111-111111111111');
insert into public.import_jobs (
  id, workspace_id, public_id, source_system_id, source_label, file_sha256,
  content_sha256, parser_version, mapping_version, idempotency_key, mode,
  source_row_count, actor_user_id, actor_process
) values
  ('66660000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000001',
   'JOB1', '55550000-0000-4000-8000-000000000001', 'whatnot_purchases.json',
   repeat('a', 64), repeat('a', 64), '1.0.0', '1.0.0', 'idem-parity-000001', 'commit',
   ${nLines}, 'a1111111-1111-1111-1111-111111111111', 'provenance.import');

-- Committed provenance the acquisition plan cites: ${nLines} source_records and
-- their source-row-key external identifiers, all under JOB1's source system.
insert into public.source_records (
  id, workspace_id, import_job_id, source_row_index, source_row_key, raw_payload,
  normalized_hash, parse_status, parser_output, parser_version, mapping_version,
  created_by_process
) values
${srValues.join(',\n')};

insert into public.external_identifiers (
  id, workspace_id, source_system_id, scope, identifier_type, identifier_value,
  source_record_id, created_by_process
) values
${extValues.join(',\n')};

update public.import_jobs set status = 'committed', completed_at = now(),
  accepted_row_count = source_row_count, issue_row_count = 0
where id = '66660000-0000-4000-8000-000000000001';

-- The frozen plan facts, one row per line (order and component are 1:1 here).
create temp table plan_lines (
  public_id text, order_ref text, seller text, order_status text,
  source_reported_status text, total_minor bigint, currency text,
  occurred_at text, source_record_id uuid,
  external_identifier_id uuid, quantity integer, description text,
  reference_number text, source_detail jsonb, amount_state text,
  amount_minor bigint, evidence_note text
);
grant all on table plan_lines to public;
insert into plan_lines values
${planLineValues.join(',\n')};

-- Owner registers the channel; operator opens the job under the FROZEN digest. --------
select pg_temp.login('a1111111-1111-1111-1111-111111111111');
select pg_temp.put('channel',
  (public.register_channel('aaaa0000-0000-4000-8000-000000000001', 'Whatnot', 'marketplace')->>'id')::uuid);
select pg_temp.logout();
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select pg_temp.put('job', (public.begin_acquisition_import_job(
  'aaaa0000-0000-4000-8000-000000000001', pg_temp.get('channel'),
  '66660000-0000-4000-8000-000000000001', 'acq-key-parity-1', ${nLines},
  '1.0.0', ${q(digest)})->>'id')::uuid);

-- Stage the entire plan through the real RPCs, in the RPCs' own <=500-row
-- batches (exactly as the commit driver does), driven by a batch loop.
do $body$
declare
  v_job uuid := (select v from ids where k = 'job');
  v_batch int := 500;
  v_off int;
begin
  -- 2. Orders (also find-or-creates each seller's supplier alias).
  for v_off in 0 .. (select count(*) from plan_lines) / v_batch loop
    perform public.stage_acquisition_orders(v_job, coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_order_reference', order_ref, 'seller_raw_handle', seller,
        'first_source_record_id', source_record_id, 'order_status', order_status,
        'source_reported_status', source_reported_status,
        'source_reported_total_minor', total_minor, 'currency', currency,
        'occurred_at', occurred_at))
      from (select * from plan_lines order by order_ref
            offset v_off * v_batch limit v_batch) b), '[]'::jsonb));
  end loop;

  -- 3. Lots, one per order.
  for v_off in 0 .. (select count(*) from public.acquisition_orders
                     where acquisition_import_job_id = v_job) / v_batch loop
    perform public.stage_acquisition_lots(v_job, coalesce((
      select jsonb_agg(jsonb_build_object('order_id', id, 'sequence_no', 1))
      from (select id from public.acquisition_orders
            where acquisition_import_job_id = v_job order by id
            offset v_off * v_batch limit v_batch) b), '[]'::jsonb));
  end loop;

  -- 4. Line items + their active lot placement.
  for v_off in 0 .. (select count(*) from plan_lines) / v_batch loop
    perform public.stage_acquisition_line_items(v_job, coalesce((
      select jsonb_agg(jsonb_build_object(
        'public_id', pl.public_id, 'lot_id', lt.id, 'source_record_id', pl.source_record_id,
        'external_identifier_id', pl.external_identifier_id, 'quantity', pl.quantity,
        'description', pl.description, 'reference_number', pl.reference_number,
        'source_detail', pl.source_detail))
      from (select * from plan_lines order by public_id
            offset v_off * v_batch limit v_batch) pl
      join public.acquisition_orders o
        on o.acquisition_import_job_id = v_job and o.source_order_reference = pl.order_ref
      join public.acquisition_lots lt on lt.order_id = o.id), '[]'::jsonb));
  end loop;

  -- 5. Cost components.
  for v_off in 0 .. (select count(*) from plan_lines) / v_batch loop
    perform public.stage_acquisition_cost_components(v_job, coalesce((
      select jsonb_agg(jsonb_build_object(
        'line_item_id', li.id, 'component_type', 'item_price', 'amount_state', pl.amount_state,
        'amount_minor', pl.amount_minor, 'currency', 'USD', 'evidence_note', pl.evidence_note,
        'source_record_id', pl.source_record_id))
      from (select * from plan_lines order by public_id
            offset v_off * v_batch limit v_batch) pl
      join public.acquisition_line_items li
        on li.acquisition_import_job_id = v_job and li.public_id = pl.public_id), '[]'::jsonb));
  end loop;
end
$body$;

-- Reconciliation: the staged counts are exactly the plan's expected counts.
select is((select count(*)::int from public.acquisition_line_items
  where acquisition_import_job_id = pg_temp.get('job')), ${nLines},
  'all ${nLines} lines staged');

-- THE PARITY PROOF: the database recomputes the identical digest from the
-- staged rows that the Node adapter froze at begin time. compute_* is an
-- internal helper (revoked from callers), so read it as the test superuser.
select pg_temp.logout();
select is(app.compute_acquisition_plan_digest(pg_temp.get('job')),
  ${q(digest)},
  'PostgreSQL recomputes the exact Node planSha256 for the ${nLines}-line plan');

-- And the job commits under that digest (finalize re-verifies it internally).
select pg_temp.login('a2222222-2222-2222-2222-222222222222');
select is((select (public.finalize_acquisition_import_job(pg_temp.get('job'),
  'acq-key-parity-1', ${nOrders}, ${nLots}, ${nLines}, ${nComps}, ${nCand}, ${nUcost}))->>'status'),
  'committed', 'the ${nLines}-line plan finalizes under its recomputed digest');
select pg_temp.logout();

select is((select status::text from public.acquisition_import_jobs where id = pg_temp.get('job')),
  'committed', 'the job is committed');
select * from finish();
rollback;
`;

  writeFileSync(OUT, sql);
  process.stdout.write(
    `wrote ${OUT}\n  digest=${digest}\n  orders=${nOrders} lots=${nLots} lines=${nLines} ` +
      `components=${nComps} candidates=${nCand} unresolved_cost=${nUcost}\n`
  );
}

main();
