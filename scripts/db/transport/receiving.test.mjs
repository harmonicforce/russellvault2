// The governed receiving RPCs, proved through the membrane the server uses.
//
// Every act in this file is an HTTP POST to real PostgREST with a NAMED JSON
// body. Nothing is called positionally, and nothing is mocked, because the
// defect this suite was written for (ESC-002) was invisible to every positional
// and mocked test in the repository: three functions declared with unnamed
// parameters kept perfect SQL semantics while being unreachable by the app.
//
// Durable state is read back with psql rather than through the same API that
// wrote it, so "the mutation happened" is a claim about the database rather
// than a claim the API makes about itself.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolveConfig, mintToken, rpc } from './client.mjs';

const WORKSPACE_A = '71000000-1000-4000-8000-000000000001';
const WORKSPACE_B = '71000000-1000-4000-8000-000000000002';
const OWNER_A = '71000000-0000-4000-8000-000000000001';
const OPERATOR_A = '71000000-0000-4000-8000-000000000002';
const VIEWER_A = '71000000-0000-4000-8000-000000000003';
const OWNER_B = '71000000-0000-4000-8000-000000000004';

const ORDER = 'RV-ACQ-71A001';
const SHIPMENT = 'RV-ASHIP-71A001';
const SOURCE_SYSTEM = 'SRC-71-A';
const LOT = 'RV-C-720001';

// `open_acquisition_receipt` is idempotent on its key, so a fixed key would
// make a second run replay the FIRST run's finished receipts instead of opening
// new ones. The suite expects a freshly reset database, and this makes a dirty
// one fail loudly rather than silently testing the wrong receipts.
const RUN = `t71-${Date.now().toString(36)}`;

let config;
let ownerToken;
let operatorToken;
let viewerToken;
let foreignOwnerToken;

/** Durable-state probe. Reads the database directly, never the API under test. */
function sql(query) {
  return execFileSync('psql', [config.dbUrl, '-X', '-A', '-t', '-c', query], {
    encoding: 'utf8',
  }).trim();
}

const call = (fn, body, token) => rpc(config, { fn, body, token });

/** Open a receipt and record one line on it, all through the transport. */
async function openReceiptWithLine(label, line, quantity) {
  const opened = await call('open_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A,
    p_acquisition_order_public_id: ORDER,
    p_shipment_public_id: SHIPMENT,
    p_received_at: '2026-08-26T10:00:00Z',
    p_note: 'transport fixture',
    p_idempotency_key: `${RUN}-${label}`,
  }, operatorToken);
  assert.equal(opened.status, 200, `open failed: ${JSON.stringify(opened.body)}`);
  const receiptPublicId = opened.body.receiptPublicId;

  const recorded = await call('record_acquisition_receipt_line', {
    p_workspace_id: WORKSPACE_A,
    p_receipt_public_id: receiptPublicId,
    p_source_system_public_id: SOURCE_SYSTEM,
    p_acquisition_line_public_id: line,
    p_quantity: quantity,
    p_note: 'counted on the dock',
  }, operatorToken);
  assert.equal(recorded.status, 200, `record failed: ${JSON.stringify(recorded.body)}`);
  return { receiptPublicId, receiptLinePublicId: recorded.body.receiptLinePublicId };
}

before(() => {
  config = resolveConfig();
  assert.ok(config.apiUrl || config.restBase, 'transport suite needs an API url or REST base');
  assert.ok(config.jwtSecret, 'transport suite needs the stack JWT secret');
  ownerToken = mintToken(config.jwtSecret, OWNER_A);
  operatorToken = mintToken(config.jwtSecret, OPERATOR_A);
  viewerToken = mintToken(config.jwtSecret, VIEWER_A);
  foreignOwnerToken = mintToken(config.jwtSecret, OWNER_B);
});

// --- Resolution: the exact property ESC-002 violated ------------------------

test('PostgREST resolves all three repaired RPCs by name', async () => {
  // Before the repair each of these answered PGRST202 — "no matches were found
  // in the schema cache". After it, they resolve, execute, and report that the
  // named receipt does not exist.
  //
  // The discriminator is the ERROR CODE, not the HTTP status. Both outcomes are
  // 404: PostgREST returns 404 for an unresolvable function AND for a function
  // that raised P0002 (no_data_found), which is exactly what the governed
  // `receipt_not_found` raise produces. Asserting on status alone would have
  // called the broken and the repaired states identical.
  // Each call carries a token that the function's own role rule accepts, so a
  // refusal at the role gate cannot be mistaken for a resolution failure:
  // reconcile is owner-only, submit and cancel accept an operator.
  const cases = [
    ['submit_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: 'RV-ARCPT-NOTREAL0001' }, () => operatorToken],
    ['reconcile_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: 'RV-ARCPT-NOTREAL0001' }, () => ownerToken],
    ['cancel_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: 'RV-ARCPT-NOTREAL0001', p_reason: 'x' }, () => operatorToken],
  ];
  for (const [fn, body, token] of cases) {
    const result = await call(fn, body, token());
    assert.notEqual(result.body?.code, 'PGRST202', `${fn} is still unresolvable by name`);
    // It resolved, authenticated, authorized, and ran its body far enough to
    // look the receipt up and not find it.
    assert.equal(result.body?.code, 'P0002', `${fn}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body?.message, 'receipt_not_found', `${fn}: ${JSON.stringify(result.body)}`);
  }
});

// --- Submit -----------------------------------------------------------------

test('submit moves the receipt to submitted and the database agrees', async () => {
  const { receiptPublicId } = await openReceiptWithLine('submit-1', 'LINE-71-A1', 5);

  const submitted = await call('submit_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A,
    p_receipt_public_id: receiptPublicId,
  }, operatorToken);

  assert.equal(submitted.status, 200);
  assert.deepEqual(Object.keys(submitted.body).sort(), ['receiptPublicId', 'replayed', 'status']);
  assert.equal(submitted.body.status, 'submitted');
  assert.equal(submitted.body.replayed, false);
  assert.equal(
    sql(`select status from public.acquisition_receipts where public_id='${receiptPublicId}'`),
    'submitted',
    'the durable receipt status changed, not just the response',
  );
  assert.equal(
    sql(`select count(*) from public.audit_events where event_type='acquisition_receipt_submitted'
         and detail->>'receipt_public_id'='${receiptPublicId}'`),
    '1',
    'submit wrote exactly one audit event',
  );
});

test('submit is idempotent: a repeated call replays instead of re-transitioning', async () => {
  const { receiptPublicId } = await openReceiptWithLine('submit-2', 'LINE-71-A2', 4);
  const first = await call('submit_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: receiptPublicId }, operatorToken);
  const second = await call('submit_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: receiptPublicId }, operatorToken);

  assert.equal(first.body.replayed, false);
  assert.equal(second.status, 200);
  assert.equal(second.body.replayed, true, 'the second submit replayed');
  assert.equal(second.body.status, 'submitted');
  assert.equal(
    sql(`select count(*) from public.audit_events where event_type='acquisition_receipt_submitted'
         and detail->>'receipt_public_id'='${receiptPublicId}'`),
    '1',
    'the replay did not write a second audit event',
  );
});

test('concurrent submits of one receipt still produce exactly one transition', async () => {
  const { receiptPublicId } = await openReceiptWithLine('submit-3', 'LINE-71-A3', 3);
  const body = { p_workspace_id: WORKSPACE_A, p_receipt_public_id: receiptPublicId };

  const results = await Promise.all([
    call('submit_acquisition_receipt', body, operatorToken),
    call('submit_acquisition_receipt', body, operatorToken),
    call('submit_acquisition_receipt', body, operatorToken),
  ]);

  // `for update` inside app.transition_receipt serialises them; whichever wins
  // applies and the rest replay. What must never happen is two applied
  // transitions or two audit rows.
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.body)));
  assert.equal(results.filter((r) => r.body.replayed === false).length, 1, 'exactly one call applied');
  assert.equal(
    sql(`select count(*) from public.audit_events where event_type='acquisition_receipt_submitted'
         and detail->>'receipt_public_id'='${receiptPublicId}'`),
    '1',
    'concurrency produced exactly one audit event',
  );
});

// --- Cancel -----------------------------------------------------------------

test('cancel records the reason and moves the receipt to cancelled', async () => {
  const { receiptPublicId } = await openReceiptWithLine('cancel-1', 'LINE-71-A1', 1);

  const cancelled = await call('cancel_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A,
    p_receipt_public_id: receiptPublicId,
    p_reason: 'pallet refused at the dock',
  }, operatorToken);

  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal(cancelled.body.replayed, false);
  assert.equal(sql(`select status from public.acquisition_receipts where public_id='${receiptPublicId}'`), 'cancelled');
  assert.equal(
    sql(`select detail->>'reason' from public.audit_events where event_type='acquisition_receipt_cancelled'
         and detail->>'receipt_public_id'='${receiptPublicId}'`),
    'pallet refused at the dock',
    'the reason reached the audit record through the named p_reason argument',
  );
});

test('cancel still enforces its reason-length domain rule', async () => {
  const { receiptPublicId } = await openReceiptWithLine('cancel-2', 'LINE-71-A1', 1);
  const blank = await call('cancel_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A,
    p_receipt_public_id: receiptPublicId,
    p_reason: '   ',
  }, operatorToken);

  assert.equal(blank.body.code, '22023', JSON.stringify(blank.body));
  assert.equal(blank.body.message, 'invalid_request');
  assert.equal(
    sql(`select status from public.acquisition_receipts where public_id='${receiptPublicId}'`),
    'open',
    'a refused cancel left the receipt open',
  );
});

// --- Reconcile --------------------------------------------------------------

test('reconcile completes an exactly-linked receipt for an owner', async () => {
  const { receiptPublicId, receiptLinePublicId } = await openReceiptWithLine('recon-1', 'LINE-71-A1', 2);
  await call('submit_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: receiptPublicId }, operatorToken);
  const linked = await call('link_acquisition_receipt_inventory', {
    p_workspace_id: WORKSPACE_A,
    p_receipt_line_public_id: receiptLinePublicId,
    p_inventory_lot_public_id: LOT,
    p_inventory_item_public_id: null,
    p_quantity: 2,
  }, operatorToken);
  assert.equal(linked.status, 200, JSON.stringify(linked.body));

  const reconciled = await call('reconcile_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A,
    p_receipt_public_id: receiptPublicId,
  }, ownerToken);

  assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body));
  assert.equal(reconciled.body.status, 'reconciled');
  assert.equal(sql(`select status from public.acquisition_receipts where public_id='${receiptPublicId}'`), 'reconciled');
});

test('reconcile still refuses a receipt that was never submitted', async () => {
  const { receiptPublicId } = await openReceiptWithLine('recon-2', 'LINE-71-A2', 1);
  const result = await call('reconcile_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A,
    p_receipt_public_id: receiptPublicId,
  }, ownerToken);

  assert.equal(result.body.code, '55000', JSON.stringify(result.body));
  assert.equal(result.body.message, 'receipt_not_submitted');
  assert.equal(sql(`select status from public.acquisition_receipts where public_id='${receiptPublicId}'`), 'open');
});

// --- Authorization ----------------------------------------------------------

test('an operator may not reconcile: reconcile is owner-only', async () => {
  const { receiptPublicId } = await openReceiptWithLine('authz-1', 'LINE-71-A2', 1);
  await call('submit_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: receiptPublicId }, operatorToken);

  const result = await call('reconcile_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A, p_receipt_public_id: receiptPublicId,
  }, operatorToken);

  assert.equal(result.status, 403, JSON.stringify(result.body));
  assert.equal(result.body.code, '42501');
  assert.equal(sql(`select status from public.acquisition_receipts where public_id='${receiptPublicId}'`), 'submitted');
});

test('a viewer may not submit or cancel', async () => {
  const { receiptPublicId } = await openReceiptWithLine('authz-2', 'LINE-71-A2', 1);
  for (const [fn, extra] of [['submit_acquisition_receipt', {}], ['cancel_acquisition_receipt', { p_reason: 'nope' }]]) {
    const result = await call(fn, { p_workspace_id: WORKSPACE_A, p_receipt_public_id: receiptPublicId, ...extra }, viewerToken);
    assert.equal(result.status, 403, `${fn}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.code, '42501');
  }
  assert.equal(sql(`select status from public.acquisition_receipts where public_id='${receiptPublicId}'`), 'open');
});

test('an anonymous caller cannot execute the repaired functions at all', async () => {
  // EXECUTE is granted to `authenticated` and to nobody else. The repair had to
  // preserve that: a DROP-and-recreate would have dropped the grant, and a
  // careless re-GRANT could have widened it to PUBLIC.
  for (const [fn, body] of [
    ['submit_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: 'RV-ARCPT-NOTREAL0001' }],
    ['cancel_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: 'RV-ARCPT-NOTREAL0001', p_reason: 'x' }],
    ['reconcile_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: 'RV-ARCPT-NOTREAL0001' }],
  ]) {
    const result = await call(fn, body, undefined);
    assert.ok(result.status === 401 || result.status === 403, `${fn} allowed an anonymous caller: ${result.status}`);
    assert.notEqual(result.body?.message, 'receipt_not_found', `${fn} executed for an anonymous caller`);
  }
});

test('a foreign workspace owner cannot act on this workspace', async () => {
  const { receiptPublicId } = await openReceiptWithLine('authz-3', 'LINE-71-A2', 1);
  await call('submit_acquisition_receipt', { p_workspace_id: WORKSPACE_A, p_receipt_public_id: receiptPublicId }, operatorToken);

  // Owner of workspace B naming workspace A. Owning *a* workspace grants
  // nothing in another one; membership is resolved for the token's own subject.
  const result = await call('reconcile_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A, p_receipt_public_id: receiptPublicId,
  }, foreignOwnerToken);

  assert.equal(result.status, 403, JSON.stringify(result.body));
  assert.equal(result.body.code, '42501');
  assert.equal(sql(`select status from public.acquisition_receipts where public_id='${receiptPublicId}'`), 'submitted');
});

test('naming a foreign workspace with a valid token of that workspace still cannot reach this receipt', async () => {
  const { receiptPublicId } = await openReceiptWithLine('authz-4', 'LINE-71-A2', 1);
  // Owner B is genuinely authorized in workspace B, so this passes the role
  // assertion and then fails to find a receipt — proving the lookup is scoped
  // by workspace and cannot reach across it.
  const result = await call('cancel_acquisition_receipt', {
    p_workspace_id: WORKSPACE_B, p_receipt_public_id: receiptPublicId, p_reason: 'cross-workspace attempt',
  }, foreignOwnerToken);

  assert.equal(result.body.message, 'receipt_not_found', JSON.stringify(result.body));
  assert.equal(sql(`select status from public.acquisition_receipts where public_id='${receiptPublicId}'`), 'open');
});

// --- Argument contract ------------------------------------------------------

test('a missing required argument is refused by PostgREST, not defaulted', async () => {
  const result = await call('cancel_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A, p_receipt_public_id: 'RV-ARCPT-NOTREAL0001',
  }, operatorToken);
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'PGRST202');
});

test('a misspelled argument name is refused, never silently ignored', async () => {
  const result = await call('submit_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A, p_receipt_publicid: 'RV-ARCPT-NOTREAL0001',
  }, operatorToken);
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'PGRST202');
});

test('an unknown extra argument is refused', async () => {
  const result = await call('submit_acquisition_receipt', {
    p_workspace_id: WORKSPACE_A, p_receipt_public_id: 'RV-ARCPT-NOTREAL0001', p_not_a_parameter: 1,
  }, operatorToken);
  assert.equal(result.status, 404);
  assert.equal(result.body.code, 'PGRST202');
});

test('a wrongly typed argument is refused by the database', async () => {
  const result = await call('submit_acquisition_receipt', {
    p_workspace_id: 'definitely-not-a-uuid', p_receipt_public_id: 'RV-ARCPT-NOTREAL0001',
  }, operatorToken);
  assert.equal(result.status, 400, JSON.stringify(result.body));
  assert.equal(result.body.code, '22P02');
});
