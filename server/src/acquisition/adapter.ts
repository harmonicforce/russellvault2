// Deterministic acquisition-mapping adapter (Phase 4).
//
// Consumes ALREADY-COMMITTED Phase 3 provenance — the source_records of a
// committed import job — and produces an ACQUISITION PLAN: the orders, lots,
// line items and cost components that those raw rows normalize into. It is a
// pure function of its input rows plus the mapping version, so the same
// committed job always yields the same plan.
//
// PROVENANCE IS NEVER BYPASSED. Every planned row carries the id of the
// source_record it came from (and, where present, the external identifier), so
// the acquisition hierarchy stays traceable back to the exact raw evidence. The
// adapter creates no second raw-import subsystem: it reads what Phase 3 already
// committed and maps it.
//
// IDENTITY IS PRESERVED, NOT REMINTED. A Whatnot line's own WN-A id becomes the
// acquisition line item's public_id verbatim. Seller handles are carried as RAW
// handles for the database to turn into per-handle supplier aliases; the adapter
// never merges two spellings, even when they normalize together.
//
// MONEY IS EXACT. Amounts become bigint minor units via decimalToMinor. A
// source-reported total of 0 with no evidence of a genuine free item is NOT
// recorded as a zero cost: it becomes an explicit 'unknown' cost, because zero
// must never stand in for missing or undocumented cost.
//
// This module performs NO database access and NO network access.

import { canonicalHash, type JsonValue } from '../provenance/hash.js';
import { normalizeName } from '../provenance/parsers.js';
import { decimalToMinor, MoneyError } from './money.js';

export const ACQUISITION_PROCESS = 'acquisition.fixture_adapter';
export const ACQUISITION_MAPPING_VERSION = '1.0.0';
/** The single explicit ISO currency for the Whatnot source system. */
export const WHATNOT_CURRENCY = 'USD';

export type OrderStatus = 'open' | 'completed' | 'cancelled' | 'refunded' | 'unknown';
export type CostComponentType = 'item_price' | 'shipping' | 'tax' | 'fee' | 'discount' | 'other';
export type CostAmountState = 'known' | 'documented_free' | 'unknown';

/** One committed Phase 3 source record, as read back from the database. */
export interface CommittedSourceRow {
  readonly sourceRecordId: string;
  readonly externalIdentifierId: string | null;
  readonly sourceRowIndex: number;
  readonly rawPayload: JsonValue;
}

export interface PlannedOrder {
  readonly sourceOrderReference: string;
  readonly sellerRawHandle: string;
  readonly firstSourceRecordId: string;
  readonly orderStatus: OrderStatus;
  readonly sourceReportedStatus: string;
  readonly sourceReportedTotalMinor: number | null;
  readonly currency: string;
  readonly occurredAt: string | null;
}

export interface PlannedLot {
  readonly sourceOrderReference: string;
  readonly sequenceNo: number;
  readonly label: string | null;
}

export interface PlannedLineItem {
  readonly publicId: string;
  readonly sourceOrderReference: string;
  readonly sourceRecordId: string;
  readonly externalIdentifierId: string | null;
  readonly quantity: number;
  readonly description: string | null;
  readonly referenceNumber: string | null;
  readonly sourceDetail: Record<string, JsonValue>;
}

export interface PlannedCostComponent {
  readonly lineItemPublicId: string;
  readonly componentType: CostComponentType;
  readonly amountState: CostAmountState;
  readonly amountMinor: number | null;
  readonly currency: string;
  readonly evidenceNote: string | null;
  readonly sourceRecordId: string;
}

/**
 * A recorded, visible gap between what the source reported for an order and what
 * the normalized cost components sum to. Kept EXPLICIT, never forced to balance.
 */
export interface AcquisitionDiscrepancy {
  readonly sourceOrderReference: string;
  readonly sourceReportedTotalMinor: number | null;
  readonly normalizedKnownComponentMinor: number;
  readonly unknownComponentCount: number;
  readonly differenceMinor: number | null;
  readonly kind: 'total_mismatch' | 'unknown_component' | 'no_source_total';
}

/** Two or more distinct raw handles that normalize together — never merged. */
export interface SupplierCandidate {
  readonly normalizedHandle: string;
  readonly rawHandles: readonly string[];
}

export interface AcquisitionPlan {
  readonly sourceLabel: string;
  readonly mappingVersion: string;
  /**
   * Deterministic digest of the COMPLETE normalized plan (orders + statuses,
   * supplier raw handles, lots, line public ids + quantities + descriptions +
   * source details, provenance identifiers, cost-component type/state/amount/
   * currency/evidence/scope, and every expected reconciliation count). With the
   * mapping version it freezes the plan identity: a changed mapping — even one
   * with the same number of lines — yields a different digest and is refused as
   * a changed-content retry.
   */
  readonly planSha256: string;
  readonly currency: string;
  readonly orders: readonly PlannedOrder[];
  readonly lots: readonly PlannedLot[];
  readonly lineItems: readonly PlannedLineItem[];
  readonly costComponents: readonly PlannedCostComponent[];
  readonly discrepancies: readonly AcquisitionDiscrepancy[];
  readonly supplierCandidates: readonly SupplierCandidate[];
  // Finalize contract — every count explicit, even when zero.
  readonly expectedOrders: number;
  readonly expectedLots: number;
  readonly expectedLineItems: number;
  readonly expectedCostComponents: number;
  readonly expectedUnresolvedSupplierCandidates: number;
  readonly expectedUnresolvedCostComponents: number;
  // Reconciliation figures for the report/UI.
  readonly distinctSellerHandleCount: number;
  readonly sourceReportedTotalMinor: number;
  readonly normalizedKnownComponentMinor: number;
  readonly knownComponentCount: number;
  readonly documentedFreeComponentCount: number;
  readonly unknownComponentCount: number;
}

export class AcquisitionMappingError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

function asObject(raw: JsonValue): Record<string, JsonValue> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AcquisitionMappingError('source record payload is not a JSON object');
  }
  return raw as Record<string, JsonValue>;
}

function readText(row: Record<string, JsonValue>, field: string): string | null {
  const v = row[field];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return String(v);
  return v;
}

function readRequiredText(row: Record<string, JsonValue>, field: string): string {
  const v = readText(row, field);
  if (v === null) {
    throw new AcquisitionMappingError(`source row is missing required field ${field}`);
  }
  return v;
}

function mapOrderStatus(raw: string | null): OrderStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'completed':
      return 'completed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'open':
    case 'pending':
      return 'open';
    default:
      // An unrecognized source status is recorded as 'unknown', NEVER guessed.
      return 'unknown';
  }
}

function readQuantity(row: Record<string, JsonValue>): number {
  const v = row['quantity_purchased'];
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AcquisitionMappingError(
      `quantity_purchased must be a positive integer, got ${JSON.stringify(v)}`
    );
  }
  return n;
}

export interface BuildAcquisitionPlanOptions {
  readonly sourceLabel: string;
  readonly currency?: string;
}

/**
 * Build the acquisition plan from a committed job's source records.
 *
 * The Whatnot fixture is one order per row, so each order gets exactly one lot
 * (the order/show/package grouping layer, degenerate here but modeled honestly)
 * and one line item. The structure supports N lines per lot; the fixture simply
 * never exercises N>1.
 */
export function buildAcquisitionPlan(
  rows: readonly CommittedSourceRow[],
  options: BuildAcquisitionPlanOptions
): AcquisitionPlan {
  const currency = options.currency ?? WHATNOT_CURRENCY;
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AcquisitionMappingError(`currency must be an ISO-4217 code, got ${currency}`);
  }

  const orders: PlannedOrder[] = [];
  const lots: PlannedLot[] = [];
  const lineItems: PlannedLineItem[] = [];
  const costComponents: PlannedCostComponent[] = [];
  const discrepancies: AcquisitionDiscrepancy[] = [];

  const orderSeen = new Map<string, PlannedOrder>();
  const publicIdSeen = new Set<string>();
  const rawHandles = new Set<string>();
  const normalizedToRaw = new Map<string, Set<string>>();

  let knownComponentCount = 0;
  let documentedFreeComponentCount = 0;
  let unknownComponentCount = 0;
  let sourceReportedTotalMinor = 0;
  let normalizedKnownComponentMinor = 0;

  // Deterministic order: by source row index, exactly as committed.
  const ordered = [...rows].sort((a, b) => a.sourceRowIndex - b.sourceRowIndex);

  for (const row of ordered) {
    const payload = asObject(row.rawPayload);

    const orderRef = readRequiredText(payload, 'order_id');
    const seller = readRequiredText(payload, 'seller');
    const publicId = readRequiredText(payload, 'acquisition_line_id');
    const quantity = readQuantity(payload);
    const rawStatus = readText(payload, 'order_status');
    const occurredAt = readText(payload, 'processed_date');

    if (publicIdSeen.has(publicId)) {
      // Every WN-A id is unique; a repeat means a corrupted source and is
      // refused rather than silently deduplicated.
      throw new AcquisitionMappingError(`duplicate line item public id ${publicId}`);
    }
    publicIdSeen.add(publicId);

    rawHandles.add(seller);
    const norm = normalizeName(seller);
    const bucket = normalizedToRaw.get(norm);
    if (bucket) bucket.add(seller);
    else normalizedToRaw.set(norm, new Set([seller]));

    // Money: exact minor units from the decimal string; a real sub-cent value
    // would throw rather than round.
    let totalMinor: number;
    try {
      totalMinor = decimalToMinor(payload['total_paid'] as number | string);
    } catch (err) {
      if (err instanceof MoneyError) {
        throw new AcquisitionMappingError(
          `order ${orderRef}: ${err.message}`
        );
      }
      throw err;
    }

    // One order per distinct reference (1:1 in this fixture; guarded anyway).
    if (!orderSeen.has(orderRef)) {
      const order: PlannedOrder = {
        sourceOrderReference: orderRef,
        sellerRawHandle: seller,
        firstSourceRecordId: row.sourceRecordId,
        orderStatus: mapOrderStatus(rawStatus),
        sourceReportedStatus: rawStatus ?? '',
        sourceReportedTotalMinor: totalMinor,
        currency,
        occurredAt,
      };
      orders.push(order);
      orderSeen.set(orderRef, order);
      lots.push({ sourceOrderReference: orderRef, sequenceNo: 1, label: null });
      sourceReportedTotalMinor += totalMinor;
    }

    lineItems.push({
      publicId,
      sourceOrderReference: orderRef,
      sourceRecordId: row.sourceRecordId,
      externalIdentifierId: row.externalIdentifierId,
      quantity,
      description: readText(payload, 'product_name'),
      referenceNumber: readText(payload, 'reference_number'),
      sourceDetail: {
        seller_raw_handle: seller,
        source_order_status: rawStatus,
        unit_cost: payload['unit_cost'] ?? null,
        business_vertical: payload['business_vertical'] ?? null,
        source_file: payload['source_file'] ?? null,
      },
    });

    // The item-price cost component. A reported 0 with no gratis evidence is
    // 'unknown' (amount NULL), never a fabricated zero cost.
    if (totalMinor > 0) {
      costComponents.push({
        lineItemPublicId: publicId,
        componentType: 'item_price',
        amountState: 'known',
        amountMinor: totalMinor,
        currency,
        evidenceNote: null,
        sourceRecordId: row.sourceRecordId,
      });
      knownComponentCount += 1;
      normalizedKnownComponentMinor += totalMinor;
    } else {
      costComponents.push({
        lineItemPublicId: publicId,
        componentType: 'item_price',
        amountState: 'unknown',
        amountMinor: null,
        currency,
        evidenceNote:
          'source reported a paid total of 0 with no documentation of a genuine free ' +
          'item; recorded as unknown pending owner review, not as a zero cost',
        sourceRecordId: row.sourceRecordId,
      });
      unknownComponentCount += 1;
      discrepancies.push({
        sourceOrderReference: orderRef,
        sourceReportedTotalMinor: totalMinor,
        normalizedKnownComponentMinor: 0,
        unknownComponentCount: 1,
        differenceMinor: null,
        kind: 'unknown_component',
      });
    }
  }

  const supplierCandidates: SupplierCandidate[] = [];
  for (const [norm, set] of normalizedToRaw) {
    if (set.size > 1) {
      supplierCandidates.push({
        normalizedHandle: norm,
        rawHandles: [...set].sort(),
      });
    }
  }
  supplierCandidates.sort((a, b) => a.normalizedHandle.localeCompare(b.normalizedHandle));

  // Canonical serialization of every persisted mapping fact, in the plan's own
  // deterministic order, hashed to freeze the plan identity.
  const canonicalPlan: JsonValue = {
    mappingVersion: ACQUISITION_MAPPING_VERSION,
    currency,
    orders: orders.map((o) => [
      o.sourceOrderReference,
      o.sellerRawHandle,
      o.firstSourceRecordId,
      o.orderStatus,
      o.sourceReportedStatus,
      o.sourceReportedTotalMinor,
      o.currency,
      o.occurredAt,
    ]),
    lots: lots.map((l) => [l.sourceOrderReference, l.sequenceNo, l.label]),
    lineItems: lineItems.map((li) => [
      li.publicId,
      li.sourceOrderReference,
      li.sourceRecordId,
      li.externalIdentifierId,
      li.quantity,
      li.description,
      li.referenceNumber,
      li.sourceDetail,
    ]),
    costComponents: costComponents.map((c) => [
      c.lineItemPublicId,
      c.componentType,
      c.amountState,
      c.amountMinor,
      c.currency,
      c.evidenceNote,
      c.sourceRecordId,
    ]),
    expected: [
      orders.length,
      lots.length,
      lineItems.length,
      costComponents.length,
      supplierCandidates.length,
      0,
    ],
  } as unknown as JsonValue;

  return {
    sourceLabel: options.sourceLabel,
    mappingVersion: ACQUISITION_MAPPING_VERSION,
    planSha256: canonicalHash(canonicalPlan),
    currency,
    orders,
    lots,
    lineItems,
    costComponents,
    discrepancies,
    supplierCandidates,
    expectedOrders: orders.length,
    expectedLots: lots.length,
    expectedLineItems: lineItems.length,
    expectedCostComponents: costComponents.length,
    expectedUnresolvedSupplierCandidates: supplierCandidates.length,
    // The base import creates only line-scoped ('direct') components; a shared,
    // not-yet-allocated ('unresolved') component only arises from later governed
    // cost entry, never from this deterministic mapping.
    expectedUnresolvedCostComponents: 0,
    distinctSellerHandleCount: rawHandles.size,
    sourceReportedTotalMinor,
    normalizedKnownComponentMinor,
    knownComponentCount,
    documentedFreeComponentCount,
    unknownComponentCount,
  };
}

/** Compact, UI/report-friendly summary that omits the per-row arrays. */
export function summarizeAcquisitionPlan(plan: AcquisitionPlan) {
  return {
    sourceLabel: plan.sourceLabel,
    mappingVersion: plan.mappingVersion,
    currency: plan.currency,
    orders: plan.expectedOrders,
    lots: plan.expectedLots,
    lineItems: plan.expectedLineItems,
    costComponents: plan.expectedCostComponents,
    unresolvedSupplierCandidates: plan.expectedUnresolvedSupplierCandidates,
    unresolvedCostComponents: plan.expectedUnresolvedCostComponents,
    distinctSellerHandles: plan.distinctSellerHandleCount,
    sourceReportedTotalMinor: plan.sourceReportedTotalMinor,
    normalizedKnownComponentMinor: plan.normalizedKnownComponentMinor,
    knownComponents: plan.knownComponentCount,
    documentedFreeComponents: plan.documentedFreeComponentCount,
    unknownComponents: plan.unknownComponentCount,
    discrepancies: plan.discrepancies.length,
    staging: true as const,
    authoritative: false as const,
  };
}
