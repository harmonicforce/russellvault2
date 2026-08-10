// Recorded governed receiving contract shapes for the browser gate.
//
// These mirror what `/api/receiving/queue` and `/api/receiving/receipts/:id`
// actually return, field for field. That precision is not pedantry: the S1.6.7
// harness was briefly wrong about the operations-dashboard shape, the page
// crashed on a field the fixture had invented, and the crash looked exactly
// like an application defect. A fixture that does not match the server tests
// the fixture.
//
// The receipt here is STATEFUL on purpose. Recording, correcting, cancelling
// and submitting mutate it, so the browser suite proves the real workflow —
// press, governed refresh, changed page — rather than proving that a static
// payload renders.

export interface BrowserReceivingLine {
  sourceSystemPublicId: string;
  acquisitionLinePublicId: string;
  title: string | null;
  expectedQuantity: number;
  exclusionState: 'included' | 'excluded';
  observed: { receiptLinePublicId: string; quantityReceived: number; note: string | null } | null;
  cumulativeReceivedQuantity: number;
}

export type BrowserReceiptStatus = 'open' | 'submitted' | 'reconciled' | 'cancelled';

export const RECEIVING_SOURCE_SYSTEM = 'RV-SRC-WHATNOT';
export const RECEIVING_ORDER = 'RV-ACQ-000001';
export const RECEIPT_PUBLIC_ID = 'RV-ARCPT-000001';

const SHIPMENT = {
  publicId: 'RV-ASHP-000001',
  carrier: 'UPS',
  trackingNumber: '1Z999AA10123456784',
  status: 'delivered',
  expectedAt: '2026-07-30T00:00:00.000Z',
  carrierReceivedAt: '2026-07-31T00:00:00.000Z',
};

function baseLines(): BrowserReceivingLine[] {
  return [
    {
      sourceSystemPublicId: RECEIVING_SOURCE_SYSTEM,
      acquisitionLinePublicId: 'RV-ALIN-0001',
      title: 'Sealed booster box, first edition',
      expectedQuantity: 3,
      exclusionState: 'included',
      observed: null,
      cumulativeReceivedQuantity: 0,
    },
    {
      sourceSystemPublicId: RECEIVING_SOURCE_SYSTEM,
      acquisitionLinePublicId: 'RV-ALIN-0002',
      title: 'Graded slab lot',
      expectedQuantity: 2,
      exclusionState: 'included',
      // An OVERAGE, present from the start so the visual baselines carry it and
      // a regression that clamps observed to expected changes a screenshot.
      observed: { receiptLinePublicId: 'RV-ARL-000002', quantityReceived: 5, note: null },
      cumulativeReceivedQuantity: 5,
    },
    {
      sourceSystemPublicId: RECEIVING_SOURCE_SYSTEM,
      acquisitionLinePublicId: 'RV-ALIN-0003',
      title: 'Excluded promo lot',
      expectedQuantity: 4,
      exclusionState: 'excluded',
      observed: null,
      cumulativeReceivedQuantity: 0,
    },
  ];
}

/** The mutable receiving world one browser test operates on. */
export class ReceivingWorld {
  status: BrowserReceiptStatus = 'open';
  lines: BrowserReceivingLine[] = baseLines();
  private nextLineId = 3;

  reset(): void {
    this.status = 'open';
    this.lines = baseLines();
    this.nextLineId = 3;
  }

  private observedTotal(): number {
    if (this.status === 'cancelled') return 0;
    return this.lines.reduce((sum, line) => sum + (line.observed?.quantityReceived ?? 0), 0);
  }

  private workflowState(): string {
    if (this.status === 'open') return 'receiving_in_progress';
    if (this.status === 'submitted') return 'submitted_pending_review';
    if (this.status === 'reconciled') return 'reconciled';
    return 'cancelled_only';
  }

  queue(role: string, complete = true) {
    return {
      coverage: 'governed_native_committed',
      historicalLegacyImported: false,
      complete,
      role,
      rows: [
        {
          orderPublicId: RECEIVING_ORDER,
          sourceOrderReference: 'WN-2026-000123',
          sellers: ['cardvault'],
          orderStatus: 'completed',
          occurredAt: '2026-07-20T00:00:00.000Z',
          receivableLineCount: 2,
          expectedQuantityTotal: 5,
          observedQuantityTotal: this.observedTotal(),
          workflowState: this.workflowState(),
          openReceiptPublicId: this.status === 'open' ? RECEIPT_PUBLIC_ID : null,
          receipts: [
            {
              publicId: RECEIPT_PUBLIC_ID,
              status: this.status,
              receivedAt: '2026-07-31T09:00:00.000Z',
              shipmentPublicId: SHIPMENT.publicId,
              recordedLineCount: this.lines.filter((line) => line.observed).length,
              observedQuantityTotal: this.observedTotal(),
              createdAt: '2026-07-31T08:00:00.000Z',
            },
          ],
          shipments: [SHIPMENT],
        },
        {
          orderPublicId: 'RV-ACQ-000002',
          sourceOrderReference: 'WN-2026-000124',
          sellers: ['thecardshop'],
          orderStatus: 'completed',
          occurredAt: '2026-07-18T00:00:00.000Z',
          receivableLineCount: 1,
          expectedQuantityTotal: 1,
          observedQuantityTotal: 0,
          workflowState: 'not_started',
          openReceiptPublicId: null,
          receipts: [],
          shipments: [],
        },
      ],
    };
  }

  receipt(role: string) {
    return {
      coverage: 'governed_native_committed',
      historicalLegacyImported: false,
      role,
      receipt: {
        publicId: RECEIPT_PUBLIC_ID,
        status: this.status,
        receivedAt: '2026-07-31T09:00:00.000Z',
        note: 'Two boxes, one pallet label',
        shipmentPublicId: SHIPMENT.publicId,
        createdAt: '2026-07-31T08:00:00.000Z',
      },
      order: {
        publicId: RECEIVING_ORDER,
        sourceOrderReference: 'WN-2026-000123',
        sellers: ['cardvault'],
        orderStatus: 'completed',
        occurredAt: '2026-07-20T00:00:00.000Z',
      },
      lines: this.lines,
      shipments: [SHIPMENT],
    };
  }

  recordLine(acquisitionLinePublicId: string, quantityReceived: number) {
    const line = this.lines.find((l) => l.acquisitionLinePublicId === acquisitionLinePublicId);
    if (!line) return null;
    this.nextLineId += 1;
    const receiptLinePublicId = `RV-ARL-${String(this.nextLineId).padStart(6, '0')}`;
    line.observed = { receiptLinePublicId, quantityReceived, note: null };
    line.cumulativeReceivedQuantity = quantityReceived;
    return { receiptLinePublicId, quantityReceived, replayed: false };
  }

  correctLine(receiptLinePublicId: string, desiredQuantity: number) {
    const line = this.lines.find((l) => l.observed?.receiptLinePublicId === receiptLinePublicId);
    if (!line?.observed) return null;
    line.observed = { ...line.observed, quantityReceived: desiredQuantity };
    line.cumulativeReceivedQuantity = desiredQuantity;
    return { receiptLinePublicId, quantityReceived: desiredQuantity, replayed: false };
  }

  transition(status: BrowserReceiptStatus) {
    this.status = status;
    return { receiptPublicId: RECEIPT_PUBLIC_ID, status, replayed: false };
  }
}
