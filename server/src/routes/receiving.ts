// S2.3 Batch 1 — governed receiving transport.
//
// WHAT THIS ROUTER IS
//
// Transport, and only transport. S2.2 owns receiving semantics in governed
// SECURITY DEFINER functions; every mutation below is a thin call into one of
// them, with the arguments the function declares. No receiving rule is
// reimplemented in TypeScript, because a rule that exists in two places
// eventually disagrees with itself, and the copy in the weaker position is the
// one that silently wins.
//
// AUTHORIZATION, unchanged from the rest of the governed API:
//   * availability — the whole router 404s unless the governed surface is
//     configured, so a deployment without it does not advertise that it exists;
//   * authentication — a caller bearer token, verified by Supabase itself;
//   * authorization — reads and writes run through a Supabase client bound to
//     THAT caller's JWT. RLS and the governed functions are the single
//     authorization model. The server holds no service-role key, so it can
//     never do more than the calling user can.
//
// `requireOperator` (owner or operator) guards every mutation, which mirrors
// the `array['owner','operator']` role assertion inside each S2.2 function. The
// gate here is a fast, honest refusal; the database's is the one that counts,
// and it still runs. A viewer is refused twice and can bypass neither.
//
// READS ARE ASSEMBLED, NOT INVENTED. There is no governed receiving read
// function, and Batch 1 explicitly must not add SQL. Every read below is a
// SELECT on a governed, RLS-enforced surface the caller may already read; the
// joining is presentation assembly and lives in ../receiving/contract.ts.

import { Router } from 'express';
import { requireMember, requireOperator, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import {
  buildQueue,
  buildReceiptDetail,
  classifyReceivingError,
  type AcquisitionLineRow,
  type ReceiptLineRow,
  type ReceiptRow,
  type ShipmentRow,
} from '../receiving/contract.js';

const router = Router();

router.use((_req, res, next) => {
  if (!isProvenanceEnabled(process.env)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  next();
});

/**
 * The read ceiling for one queue assembly.
 *
 * Assembly happens in this process, so the read has to be bounded. When a bound
 * is reached the response says so with `complete: false` and the UI renders the
 * S1.6 `partial` state — a truthful "this is some of it" rather than a silent
 * short list that reads exactly like a complete one.
 */
const MAX_ASSEMBLY_ROWS = 2000;

class ReceivingError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

function caller(req: AuthedRequest) {
  if (!req.caller) throw new ReceivingError('dependency_failed', 500);
  return req.caller;
}

function asyncRoute(
  handler: (req: AuthedRequest, res: import('express').Response) => Promise<void>,
) {
  return (
    req: AuthedRequest,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => { handler(req, res).catch(next); };
}

/** A governed public identity arriving as a path parameter. Shape only. */
function publicId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
    throw new ReceivingError('invalid_request', 400);
  }
  return value.trim();
}

function requiredText(value: unknown, min = 1, max = 500): string {
  if (typeof value !== 'string') throw new ReceivingError('invalid_request', 400);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new ReceivingError('invalid_request', 400);
  return trimmed;
}

function optionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  return requiredText(value, 1, max);
}

/**
 * A positive integer quantity.
 *
 * Deliberately NOT bounded above by the expected quantity. An overage is
 * physical truth: more units arrived than the acquisition said. Refusing to
 * transmit it would make the operator either lie or give up, and S2.2 already
 * decides what an overage may become.
 */
function quantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ReceivingError('invalid_request', 400);
  }
  return value;
}

function isoInstant(value: unknown, required: boolean): string | null {
  if (value == null || value === '') {
    if (required) throw new ReceivingError('invalid_request', 400);
    return null;
  }
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ReceivingError('invalid_request', 400);
  }
  return new Date(value).toISOString();
}

function idempotencyKey(value: unknown): string {
  return requiredText(value, 8, 200);
}

function fail(error: unknown): never {
  const { code, status } = classifyReceivingError(error);
  throw new ReceivingError(code, status);
}

// --- governed reads ----------------------------------------------------------

type Supa = ReturnType<typeof caller>['client'];

const LINE_COLUMNS =
  'acquisition_line_item_id,acquisition_line_public_id,source_system_public_id,quantity,' +
  'description,full_title,delivered_item_title,seller_normalized,exclusion_state,' +
  'acquisition_order_id,acquisition_order_public_id,source_order_reference,order_status,occurred_at';

async function readRows<T>(
  build: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const { data, error } = await build();
  if (error) fail(error);
  return (data ?? []) as T[];
}

async function readAcquisitionLines(client: Supa, workspaceId: string, orderId?: string) {
  return readRows<AcquisitionLineRow>(() => {
    const query = client
      .from('acquisition_line_overview')
      .select(LINE_COLUMNS)
      .eq('workspace_id', workspaceId);
    return (orderId ? query.eq('acquisition_order_id', orderId) : query).limit(MAX_ASSEMBLY_ROWS);
  });
}

async function readReceipts(client: Supa, workspaceId: string, orderId?: string) {
  return readRows<ReceiptRow>(() => {
    const query = client
      .from('acquisition_receipts')
      .select('id,public_id,acquisition_order_id,acquisition_shipment_id,status,received_at,note,created_at')
      .eq('workspace_id', workspaceId);
    return (orderId ? query.eq('acquisition_order_id', orderId) : query).limit(MAX_ASSEMBLY_ROWS);
  });
}

async function readReceiptLines(client: Supa, workspaceId: string, receiptIds?: readonly string[]) {
  if (receiptIds && receiptIds.length === 0) return [];
  return readRows<ReceiptLineRow>(() => {
    const query = client
      .from('acquisition_receipt_lines')
      .select('id,public_id,acquisition_receipt_id,acquisition_line_item_id,quantity_received,note')
      .eq('workspace_id', workspaceId);
    return (receiptIds ? query.in('acquisition_receipt_id', receiptIds) : query).limit(MAX_ASSEMBLY_ROWS);
  });
}

async function readShipments(client: Supa, workspaceId: string, orderId?: string) {
  return readRows<ShipmentRow>(() => {
    const query = client
      .from('acquisition_shipments')
      .select('id,public_id,acquisition_order_id,carrier,tracking_number,status,expected_at,received_at')
      .eq('workspace_id', workspaceId);
    return (orderId ? query.eq('acquisition_order_id', orderId) : query).limit(MAX_ASSEMBLY_ROWS);
  });
}

// --- A. the receiving queue --------------------------------------------------

router.get('/queue', requireMember, asyncRoute(async (req, res) => {
  const { workspaceId, client, role } = caller(req);
  const [lines, receipts, shipments] = await Promise.all([
    readAcquisitionLines(client, workspaceId),
    readReceipts(client, workspaceId),
    readShipments(client, workspaceId),
  ]);
  const receiptLines = await readReceiptLines(client, workspaceId);

  // Truthful completeness. If any read hit its ceiling the answer is a subset,
  // and saying so is the difference between "there is no more receiving work"
  // and "we stopped looking".
  const complete =
    lines.length < MAX_ASSEMBLY_ROWS &&
    receipts.length < MAX_ASSEMBLY_ROWS &&
    receiptLines.length < MAX_ASSEMBLY_ROWS &&
    shipments.length < MAX_ASSEMBLY_ROWS;

  res.json({
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    complete,
    role,
    rows: buildQueue({ lines, receipts, receiptLines, shipments }),
  });
}));

// --- B. one receipt's workspace ----------------------------------------------

router.get('/receipts/:receiptPublicId', requireMember, asyncRoute(async (req, res) => {
  const { workspaceId, client, role } = caller(req);
  const wanted = publicId(req.params.receiptPublicId);

  const found = await readRows<ReceiptRow>(() =>
    client
      .from('acquisition_receipts')
      .select('id,public_id,acquisition_order_id,acquisition_shipment_id,status,received_at,note,created_at')
      .eq('workspace_id', workspaceId)
      .eq('public_id', wanted)
      .limit(1));

  // No row is indistinguishable from a foreign workspace, deliberately: RLS
  // already returned nothing, and saying "exists but not yours" would be a
  // disclosure this surface has no reason to make.
  const receipt = found[0];
  if (!receipt) throw new ReceivingError('receipt_not_found', 404);

  const orderId = receipt.acquisition_order_id;
  const [orderLines, receiptsForOrder, shipments] = await Promise.all([
    readAcquisitionLines(client, workspaceId, orderId),
    readReceipts(client, workspaceId, orderId),
    readShipments(client, workspaceId, orderId),
  ]);
  const receiptLinesForOrder = await readReceiptLines(
    client, workspaceId, receiptsForOrder.map((row) => row.id));

  res.json({
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    role,
    ...buildReceiptDetail({ receipt, orderLines, receiptsForOrder, receiptLinesForOrder, shipments }),
  });
}));

// --- mutations: every one a direct call into the governed S2.2 function ------

async function rpc(client: Supa, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn as never, args as never);
  if (error) fail(error);
  if (!data) throw new ReceivingError('dependency_failed', 502);
  return data;
}

/**
 * Open a receiving session.
 *
 * `receivedAt` is REQUIRED here even though the column is nullable, and that is
 * a deliberate transport decision rather than a reimplemented rule. S2.2 sets
 * received_at only at open time — no governed function updates it afterwards —
 * while `submit` refuses a receipt whose received_at is null. A receipt opened
 * without one is therefore permanently unsubmittable and can only ever be
 * cancelled. Refusing it at the door is the honest option; the alternative is
 * letting an operator do a full count into a receipt that can never be filed.
 */
router.post('/orders/:orderPublicId/receipts', requireOperator, asyncRoute(async (req, res) => {
  const { workspaceId, client } = caller(req);
  res.json(await rpc(client, 'open_acquisition_receipt', {
    p_workspace_id: workspaceId,
    p_acquisition_order_public_id: publicId(req.params.orderPublicId),
    p_shipment_public_id: optionalText(req.body?.shipmentPublicId, 200),
    p_received_at: isoInstant(req.body?.receivedAt, true),
    p_note: optionalText(req.body?.note, 1000),
    p_idempotency_key: idempotencyKey(req.body?.idempotencyKey),
  }));
}));

router.post('/receipts/:receiptPublicId/lines', requireOperator, asyncRoute(async (req, res) => {
  const { workspaceId, client } = caller(req);
  res.json(await rpc(client, 'record_acquisition_receipt_line', {
    p_workspace_id: workspaceId,
    p_receipt_public_id: publicId(req.params.receiptPublicId),
    p_source_system_public_id: requiredText(req.body?.sourceSystemPublicId, 1, 200),
    p_acquisition_line_public_id: requiredText(req.body?.acquisitionLinePublicId, 1, 200),
    p_quantity: quantity(req.body?.quantityReceived),
    p_note: optionalText(req.body?.note, 1000),
  }));
}));

/**
 * Correct an observed quantity on an OPEN receipt.
 *
 * `expectedQuantity` is the compare-and-set the governed function requires: it
 * is the value the operator was actually looking at when they decided. If the
 * stored value has moved since, S2.2 raises `receipt_line_conflict` and this
 * route passes that refusal through as a 409 rather than overwriting. The
 * client re-reads and asks again — a stale correction must never win silently.
 */
router.post('/receipt-lines/:receiptLinePublicId/correct', requireOperator, asyncRoute(async (req, res) => {
  const { workspaceId, client } = caller(req);
  res.json(await rpc(client, 'correct_acquisition_receipt_line', {
    p_workspace_id: workspaceId,
    p_receipt_line_public_id: publicId(req.params.receiptLinePublicId),
    p_expected_quantity: quantity(req.body?.expectedQuantity),
    p_desired_quantity: quantity(req.body?.desiredQuantity),
    p_reason: requiredText(req.body?.reason, 1, 500),
  }));
}));

router.post('/receipts/:receiptPublicId/cancel', requireOperator, asyncRoute(async (req, res) => {
  const { workspaceId, client } = caller(req);
  res.json(await rpc(client, 'cancel_acquisition_receipt', {
    p_workspace_id: workspaceId,
    p_receipt_public_id: publicId(req.params.receiptPublicId),
    p_reason: requiredText(req.body?.reason, 1, 500),
  }));
}));

/**
 * Submit. Freezes observed quantities and moves the receipt to review.
 *
 * It does NOT create inventory, resolve a discrepancy, complete owner
 * reconciliation, or establish cost basis. Those are governed by separate S2.2
 * functions this router deliberately does not expose in Batch 1.
 */
router.post('/receipts/:receiptPublicId/submit', requireOperator, asyncRoute(async (req, res) => {
  const { workspaceId, client } = caller(req);
  res.json(await rpc(client, 'submit_acquisition_receipt', {
    p_workspace_id: workspaceId,
    p_receipt_public_id: publicId(req.params.receiptPublicId),
  }));
}));

router.use((
  err: unknown,
  _req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) => {
  if (err instanceof ReceivingError) {
    res.status(err.status).json({ error: err.code });
    return;
  }
  next(err);
});

export default router;
