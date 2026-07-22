// Phase 4 acquisition plan-digest tests.
//
// The digest is a byte-for-byte contract shared with PostgreSQL
// (app.compute_acquisition_plan_digest). These tests pin the Node half:
//   1. A FIXED TEST VECTOR — a tiny, human-auditable plan whose canonical text
//      and SHA-256 are asserted literally, so any change to the encoding is
//      caught here and read directly.
//   2. The EXACT 2,149-line driver plan's digest, computed over the same
//      deterministic provenance UUIDs that supabase/tests/15_acquisition_digest
//      _parity.sql seeds — the two must agree, which is what proves the Node and
//      PostgreSQL canonicalizations are identical end-to-end.
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { buildImportPlan } from '../provenance/adapter.js';
import { buildAcquisitionPlan, type AcquisitionPlan, type CommittedSourceRow } from './adapter.js';
import { acquisitionPlanCanonical, acquisitionPlanSha256 } from './planDigest.js';

describe('the fixed digest vector', () => {
  const plan: AcquisitionPlan = {
    sourceLabel: 'fixed',
    mappingVersion: '1.0.0',
    planSha256: '',
    currency: 'USD',
    orders: [
      {
        sourceOrderReference: 'ORD-A',
        sellerRawHandle: 'acme',
        firstSourceRecordId: 'rec-1',
        orderStatus: 'completed',
        sourceReportedStatus: 'completed',
        sourceReportedTotalMinor: 1000,
        currency: 'USD',
        occurredAt: '2026-01-06 00:00:00',
      },
    ],
    lots: [{ sourceOrderReference: 'ORD-A', sequenceNo: 1, label: null }],
    lineItems: [
      {
        publicId: 'WN-A-000100',
        sourceOrderReference: 'ORD-A',
        sourceRecordId: 'rec-1',
        externalIdentifierId: 'ext-1',
        quantity: 1,
        description: 'Widget',
        referenceNumber: null,
        sourceDetail: { seller_raw_handle: 'acme', source_file: null, unit_cost: 3 },
      },
    ],
    costComponents: [
      {
        lineItemPublicId: 'WN-A-000100',
        componentType: 'item_price',
        amountState: 'known',
        amountMinor: 1000,
        currency: 'USD',
        evidenceNote: null,
        sourceRecordId: 'rec-1',
      },
    ],
    discrepancies: [],
    supplierCandidates: [],
    expectedOrders: 1,
    expectedLots: 1,
    expectedLineItems: 1,
    expectedCostComponents: 1,
    expectedUnresolvedSupplierCandidates: 0,
    expectedUnresolvedCostComponents: 0,
    distinctSellerHandleCount: 1,
    sourceReportedTotalMinor: 1000,
    normalizedKnownComponentMinor: 1000,
    knownComponentCount: 1,
    documentedFreeComponentCount: 0,
    unknownComponentCount: 0,
  };

  // Length-prefixed fields (<byte-length>:<text>, null -> ~), sections in stable
  // key order, source_detail keys bytewise-sorted with JSON.stringify values.
  const CANON =
    'ACQPLAN15:1.0.0ORD1:15:ORD-A4:acme5:rec-19:completed9:completed4:10003:USD' +
    '24:2026-01-06T00:00:00.000ZLOT1:15:ORD-A1:1~' +
    'LIN1:111:WN-A-0001005:ORD-A1:16:Widget~{317:seller_raw_handle6:"acme"' +
    '11:source_file4:null9:unit_cost1:35:rec-15:ext-11:1' +
    'CMP1:14:line11:WN-A-00010010:item_price5:known4:10003:USD~5:rec-1' +
    'EXP1:11:11:11:11:01:0';
  const SHA = 'eb3626902187f4f9553b1268fb0018eab33c1442a4c353c22373f147ef41f742';

  it('serializes to the exact canonical text', () => {
    expect(acquisitionPlanCanonical(plan)).toBe(CANON);
  });

  it('hashes to the exact SHA-256', () => {
    expect(acquisitionPlanSha256(plan)).toBe(SHA);
    // The digest is literally SHA-256 of the canonical UTF-8 bytes.
    expect(createHash('sha256').update(Buffer.from(CANON, 'utf8')).digest('hex')).toBe(SHA);
  });
});

describe('the exact 2,149-line driver plan digest (PostgreSQL parity anchor)', () => {
  // Same deterministic provenance UUIDs the SQL parity fixture seeds.
  const srUuid = (i: number): string => `77770000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
  const extUuid = (i: number): string => `88880000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;

  const provenance = buildImportPlan({ filename: 'whatnot_purchases.json', mode: 'preview' });
  const rows: CommittedSourceRow[] = provenance.records.map((r) => ({
    sourceRecordId: srUuid(r.sourceRowIndex),
    externalIdentifierId: r.sourceRowKey ? extUuid(r.sourceRowIndex) : null,
    sourceRowIndex: r.sourceRowIndex,
    rawPayload: r.rawPayload,
  }));
  const plan = buildAcquisitionPlan(rows, { sourceLabel: 'whatnot_purchases.json' });

  it('locks the digest PostgreSQL must reproduce byte-for-byte', () => {
    expect(plan.expectedLineItems).toBe(2149);
    // If this value changes, regenerate supabase/tests/15_acquisition_digest_
    // parity.sql (server/scripts/genDigestParityFixture.ts) so both tiers agree.
    expect(plan.planSha256).toBe(
      '82f162b83076f92a478eea632589496e6d0dbad223fdfbbb1f86a66180e590ea'
    );
  });
});
