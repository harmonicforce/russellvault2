// Deterministic governed data for the browser gate.
//
// Every identifier, timestamp and amount here is FIXED. Nothing is derived from
// `Date.now()`, `crypto.randomUUID()`, or a counter that depends on test order,
// because a screenshot baseline that contains a live clock is a baseline that
// fails tomorrow for reasons nobody can review.
//
// This data is shaped to the transports the real pages already use. It is not a
// second implementation of any business rule: it is a recorded answer, and the
// application does all of the interpreting.

import type { AcquisitionFacets, AcquisitionLine } from '../../src/lib/acquisitionLinesApi';
import type { AcquisitionDetail } from '../../src/lib/acquisitionDetailApi';

export const SOURCE_SYSTEM = 'RV-SRC-WHATNOT';

/** A stable instant used wherever a "recent" timestamp is needed. */
export const FIXED_NOW = '2026-08-01T10:00:00.000Z';

const SELLERS = ['CardHaven', 'Northgate Cards', 'Vault Supply Co'] as const;
const VERTICALS = ['Pokémon / TCG', 'Sealed Product'] as const;

/**
 * 137 governed lines — deliberately more than two pages of 50, so pagination is
 * exercised against a real multi-page total rather than a contrived one.
 *
 * Rows 1 and 2 are pinned to the three states an operator must be able to tell
 * apart at a glance: a normally classified line, an excluded line, and an
 * unclassified one.
 */
export const TOTAL_LINES = 137;

function pad(n: number): string {
  return String(n).padStart(4, '0');
}

export function makeLine(index: number): AcquisitionLine {
  // Deterministic day-of-month from the index, so occurred_at is stable and
  // sortable without ever reading a clock.
  const day = String((index % 28) + 1).padStart(2, '0');
  const excluded = index === 2;
  const unclassified = index === 3;

  return {
    source_system_public_id: SOURCE_SYSTEM,
    acquisition_line_public_id: `RV-ALIN-${pad(index)}`,
    full_title: unclassified
      ? 'Unmarked bulk box'
      : `Scarlet & Violet 151 Booster Bundle ${pad(index)}`,
    delivered_item_title: `151 bundle ${pad(index)}`,
    seller_normalized: SELLERS[index % SELLERS.length],
    business_vertical: VERTICALS[index % VERTICALS.length],
    quantity: (index % 4) + 1,
    occurred_at: `2026-08-${day}T10:00:00.000Z`,
    created_at: `2026-08-${day}T11:00:00.000Z`,
    source_order_reference: `WN-2026-08-${pad(index)}`,
    classification_key: unclassified ? null : 'sealed',
    classification_label: unclassified ? null : 'Sealed product',
    classification_method: unclassified ? null : index % 5 === 0 ? 'owner_override' : 'rule',
    classification_state: unclassified ? 'unclassified' : index % 7 === 0 ? 'needs_review' : 'classified',
    exclusion_state: excluded ? 'excluded' : 'included',
    current_exclusion_public_id: excluded ? 'RV-AEXCL-0002' : null,
    current_exclusion_reason: excluded ? 'food and candy, not resale inventory' : null,
    excluded_at: excluded ? '2026-08-03T00:00:00.000Z' : null,
  };
}

export const ALL_LINES: AcquisitionLine[] = Array.from({ length: TOTAL_LINES }, (_, i) => makeLine(i + 1));

export const FACETS: AcquisitionFacets = {
  classificationOptions: [
    { key: 'sealed', label: 'Sealed product', count: 118 },
    { key: 'slab', label: 'Graded slab', count: 12 },
    { key: 'single', label: 'Raw single', count: 6 },
  ],
  unclassified: 1,
  methods: [
    { value: 'rule', count: 108 },
    { value: 'owner_override', count: 28 },
  ],
  states: [
    { value: 'classified', count: 117 },
    { value: 'needs_review', count: 19 },
    { value: 'unclassified', count: 1 },
  ],
  exclusionStates: [
    { value: 'included', count: 136 },
    { value: 'excluded', count: 1 },
  ],
  sellers: SELLERS.map((value, i) => ({ value, count: 46 - i })),
  businessVerticals: VERTICALS.map((value, i) => ({ value, count: 69 - i })),
};

/** The line the detail scenarios address. Source-qualified, always. */
export const DETAIL_LINE = 'RV-ALIN-0001';

export function makeDetail(over: Partial<AcquisitionDetail> = {}): AcquisitionDetail {
  return {
    coverage: 'governed_native_committed',
    historicalLegacyImported: false,
    identity: { sourceSystemPublicId: SOURCE_SYSTEM, linePublicId: DETAIL_LINE },
    line: {
      publicId: DETAIL_LINE,
      quantity: 2,
      description: 'Sealed bundle from the 1 August live',
      referenceNumber: 'W-88231',
      createdAt: '2026-08-01T11:00:00.000Z',
      businessVertical: 'Pokémon / TCG',
      fullTitle: 'Scarlet & Violet 151 Booster Bundle',
      deliveredItemTitle: '151 bundle',
      sellerNormalized: 'cardhaven',
    },
    order: {
      publicId: 'RV-ACQ-3F8P2X',
      sourceOrderReference: 'WN-2026-08-4412',
      status: 'received',
      sourceReportedStatus: 'delivered',
      sourceReportedTotalMinor: 12999,
      currency: 'USD',
      occurredAt: FIXED_NOW,
      channel: { publicId: 'RV-CH-LIVE', name: 'Whatnot Live' },
      supplier: { publicId: 'RV-SUP-CARDHAVEN', displayName: 'CardHaven' },
      sourceSystem: { publicId: SOURCE_SYSTEM, kind: 'whatnot' },
    },
    placement: {
      lotPublicId: 'RV-ALOT-B4N1',
      sequence: 3,
      label: 'Aug 1 Whatnot haul',
      integrityState: 'current',
    },
    classification: {
      publicId: 'RV-ACL-0002',
      optionKey: 'sealed',
      optionLabel: 'Sealed product',
      method: 'owner_override',
      confidence: 1,
      createdAt: '2026-08-02T00:00:00.000Z',
      state: 'classified',
    },
    classificationHistory: [
      {
        publicId: 'RV-ACL-0001',
        optionKey: 'single',
        optionLabel: 'Raw single',
        method: 'system_fallback',
        confidence: 0.2,
        createdAt: '2026-08-01T12:00:00.000Z',
        supersededAt: '2026-08-02T00:00:00.000Z',
        ownerOverrideReason: null,
      },
      {
        publicId: 'RV-ACL-0002',
        optionKey: 'sealed',
        optionLabel: 'Sealed product',
        method: 'owner_override',
        confidence: 1,
        createdAt: '2026-08-02T00:00:00.000Z',
        supersededAt: null,
        ownerOverrideReason: 'owner confirmed factory seal on the stream replay',
      },
    ],
    classificationOptions: [
      { key: 'sealed', label: 'Sealed product' },
      { key: 'slab', label: 'Graded slab' },
      { key: 'single', label: 'Raw single' },
    ],
    exclusion: { state: 'included', current: null, history: [] },
    payments: [
      {
        publicId: 'RV-APAY-9X2K',
        paidAt: '2026-08-01T10:05:00.000Z',
        amountMinor: 12999,
        currency: 'USD',
        instrument: 'card',
        externalReference: 'ch_3PqRvault',
        evidenceNote: 'Whatnot receipt screenshot on file',
        state: 'active',
        reversedAt: null,
        reversalReason: null,
        reversalEvent: null,
      },
    ],
    paymentSummary: {
      activeCount: 1,
      activeCurrencies: ['USD'],
      mixedCurrencies: false,
      activeTotalMinor: 12999,
      sourceReportedTotalMinor: 12999,
      differenceMinor: 0,
    },
    shipments: [
      {
        publicId: 'RV-ASHIP-Q7',
        carrier: 'USPS Ground Advantage',
        trackingNumber: '9400 1112 2233 3444 5566 77',
        status: 'in_transit',
        shippedAt: '2026-08-02T00:00:00.000Z',
        expectedAt: '2026-08-06T00:00:00.000Z',
        receivedAt: null,
        shippingReferenceMinor: 699,
        currency: 'USD',
        evidenceNote: null,
        transitionHistory: [
          {
            publicId: 'RV-ASTRAN-0001',
            fromStatus: 'expected',
            toStatus: 'in_transit',
            applied: true,
            receivedAt: null,
            reason: null,
            actorId: 'operator',
            createdAt: '2026-08-02T00:00:00.000Z',
          },
        ],
        allowedNextTransitions: ['delivered', 'lost', 'cancelled'],
      },
    ],
    sourceEvidence: {
      sourceSystemPublicId: SOURCE_SYSTEM,
      sourceRecordRowKey: 'whatnot:order:4412:line:1',
      sourceImportJobPublicId: 'IMP-2026-08-01-A',
    },
    ...over,
  } as AcquisitionDetail;
}

/** Two active currencies: the page must refuse to produce a combined total. */
export function mixedCurrencyDetail(): AcquisitionDetail {
  const base = makeDetail();
  return makeDetail({
    payments: [
      base.payments[0],
      {
        ...base.payments[0],
        publicId: 'RV-APAY-7B4L',
        amountMinor: 4500,
        currency: 'EUR',
        externalReference: 'ch_9LmNvault',
      },
    ],
    paymentSummary: {
      activeCount: 2,
      activeCurrencies: ['USD', 'EUR'],
      mixedCurrencies: true,
      activeTotalMinor: null,
      sourceReportedTotalMinor: 12999,
      differenceMinor: null,
    },
  });
}

/** No payment has been recorded. The page must not render a fabricated zero. */
export function noPaymentDetail(): AcquisitionDetail {
  return makeDetail({
    payments: [],
    paymentSummary: {
      activeCount: 0,
      activeCurrencies: [],
      mixedCurrencies: false,
      activeTotalMinor: null,
      sourceReportedTotalMinor: 12999,
      differenceMinor: null,
    },
  });
}

/** The governed placement chain is broken for this line. */
export function missingPlacementDetail(): AcquisitionDetail {
  return makeDetail({
    placement: { lotPublicId: null, sequence: null, label: null, integrityState: 'missing_active_placement' },
  });
}

/** An excluded line, with the decision history that justifies it. */
export function excludedDetail(): AcquisitionDetail {
  const decision = {
    publicId: 'RV-AEXCL-0002',
    state: 'excluded' as const,
    reason: 'food and candy, not resale inventory',
    actorId: 'operator',
    createdAt: '2026-08-03T00:00:00.000Z',
    supersededAt: null,
  };
  return makeDetail({ exclusion: { state: 'excluded', current: decision, history: [decision] } });
}
