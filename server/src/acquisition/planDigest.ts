// Deterministic acquisition-plan digest — the Node half of a contract that the
// database reproduces byte-for-byte (app.compute_acquisition_plan_digest).
//
// The digest is SHA-256 of a CANONICAL TEXT built with length-prefixed fields,
// so there is no escaping or delimiter ambiguity and the exact same bytes can be
// produced from staged database rows. Every field the frozen plan must cover is
// included; sections are sorted by a stable key so insertion order is irrelevant.
//
// Field encoder f():   null -> "~";  text -> "<utf8-byte-length>:<text>"
// Integers are rendered as their canonical decimal string, then f().
// source_detail is encoded as "{" + keyCount, then for each key (bytewise
// order) f(key) f(JSON.stringify(value)) — matching Postgres jsonb value::text.

import { createHash } from 'node:crypto';
import type { AcquisitionPlan } from './adapter.js';
import type { JsonValue } from '../provenance/hash.js';

export const ACQUISITION_PLAN_DIGEST_VERSION = 'ACQPLAN1';

function f(x: string | null): string {
  if (x === null) return '~';
  return `${Buffer.byteLength(x, 'utf8')}:${x}`;
}

function fi(n: number | null): string {
  return n === null ? '~' : f(String(n));
}

function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function encodeSourceDetail(sd: Record<string, JsonValue>): string {
  const keys = Object.keys(sd).sort(byteCompare);
  let out = `{${keys.length}`;
  for (const k of keys) out += f(k) + f(JSON.stringify(sd[k]));
  return out;
}

/** The canonical text. Exposed for the fixed-vector parity test. */
export function acquisitionPlanCanonical(plan: AcquisitionPlan): string {
  const parts: string[] = [ACQUISITION_PLAN_DIGEST_VERSION, f(plan.mappingVersion)];

  // Orders, sorted by source order reference.
  const orders = [...plan.orders].sort((a, b) =>
    byteCompare(a.sourceOrderReference, b.sourceOrderReference)
  );
  parts.push('ORD', fi(orders.length));
  for (const o of orders) {
    parts.push(
      f(o.sourceOrderReference),
      f(o.sellerRawHandle),
      f(o.orderStatus),
      f(o.sourceReportedStatus)
    );
  }

  // Lots, sorted by (order ref, sequence). Also gives each order's lot sequence.
  const lots = [...plan.lots].sort(
    (a, b) =>
      byteCompare(a.sourceOrderReference, b.sourceOrderReference) || a.sequenceNo - b.sequenceNo
  );
  const lotSeqByOrder = new Map<string, number>();
  for (const l of lots) if (!lotSeqByOrder.has(l.sourceOrderReference)) lotSeqByOrder.set(l.sourceOrderReference, l.sequenceNo);
  parts.push('LOT', fi(lots.length));
  for (const l of lots) {
    parts.push(f(l.sourceOrderReference), fi(l.sequenceNo), f(l.label));
  }

  // Line items, sorted by public id, with their intended active lot placement.
  const lines = [...plan.lineItems].sort((a, b) => byteCompare(a.publicId, b.publicId));
  parts.push('LIN', fi(lines.length));
  for (const li of lines) {
    const placementSeq = lotSeqByOrder.get(li.sourceOrderReference) ?? 1;
    parts.push(
      f(li.publicId),
      f(li.sourceOrderReference),
      fi(li.quantity),
      f(li.description),
      f(li.referenceNumber),
      encodeSourceDetail(li.sourceDetail),
      f(li.sourceRecordId),
      f(li.externalIdentifierId),
      fi(placementSeq)
    );
  }

  // Cost components, sorted by (scope key, type, source record). The base plan's
  // components are all line-scoped, so scope kind is "line" and key is the line
  // public id; the database includes lot/order-scoped ones too if any exist.
  const components = plan.costComponents
    .map((c) => ({ ...c, scopeKind: 'line', scopeKey: c.lineItemPublicId }))
    .sort(
      (a, b) =>
        byteCompare(a.scopeKey, b.scopeKey) ||
        byteCompare(a.componentType, b.componentType) ||
        byteCompare(a.sourceRecordId ?? '', b.sourceRecordId ?? '')
    );
  parts.push('CMP', fi(components.length));
  for (const c of components) {
    parts.push(
      f(c.scopeKind),
      f(c.scopeKey),
      f(c.componentType),
      f(c.amountState),
      fi(c.amountMinor),
      f(c.currency),
      f(c.evidenceNote),
      f(c.sourceRecordId)
    );
  }

  // The six expected reconciliation counts.
  parts.push(
    'EXP',
    fi(plan.expectedOrders),
    fi(plan.expectedLots),
    fi(plan.expectedLineItems),
    fi(plan.expectedCostComponents),
    fi(plan.expectedUnresolvedSupplierCandidates),
    fi(plan.expectedUnresolvedCostComponents)
  );

  return parts.join('');
}

export function acquisitionPlanSha256(plan: AcquisitionPlan): string {
  return createHash('sha256')
    .update(Buffer.from(acquisitionPlanCanonical(plan), 'utf8'))
    .digest('hex');
}
