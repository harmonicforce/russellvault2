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

export interface BrowserInventoryLink {
  inventoryLinkPublicId: string;
  receiptLinePublicId: string;
  quantityLinked: number;
  subjectKind: 'lot' | 'item';
  inventoryLotPublicId: string | null;
  inventoryItemPublicId: string | null;
  productDisplayName: string | null;
  skuPublicId: string | null;
  conditionOrQuality: string | null;
  locationDisplayName: string | null;
  serialNumber: string | null;
}

export interface BrowserDiscrepancy {
  discrepancyPublicId: string;
  kind: string;
  status: 'open' | 'claimed' | 'resolved' | 'written_off';
  orderPublicId: string;
  receiptPublicId: string | null;
  receiptLinePublicId: string | null;
  acquisitionLinePublicId: string | null;
  quantityExpected: number | null;
  quantityObserved: number | null;
  detail: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** Governed subjects the picker may offer. Tracking mode is inventory's. */
export const INVENTORY_SUBJECTS = [
  {
    subjectKind: 'lot' as const, publicId: 'RV-ILOT-000001', trackingMode: 'lot_managed',
    productDisplayName: 'Bulk commons box', skuPublicId: 'RV-SKU-000001',
    conditionOrQuality: 'played', locationDisplayName: 'Shelf A1',
    lotQuantity: 40, serialNumber: null, gradingCompany: null,
    certificateNumber: null, parentLotPublicId: null,
  },
  {
    subjectKind: 'item' as const, publicId: 'RV-IITM-000001', trackingMode: 'serialized',
    productDisplayName: 'Graded slab, first edition', skuPublicId: 'RV-SKU-000002',
    conditionOrQuality: 'mint', locationDisplayName: 'Vault',
    lotQuantity: null, serialNumber: 'SER-000001', gradingCompany: 'PSA',
    certificateNumber: '11112222', parentLotPublicId: 'RV-ILOT-000002',
  },
  {
    subjectKind: 'item' as const, publicId: 'RV-IITM-000002', trackingMode: 'serialized',
    productDisplayName: 'Graded slab, first edition', skuPublicId: 'RV-SKU-000002',
    conditionOrQuality: 'mint', locationDisplayName: 'Vault',
    lotQuantity: null, serialNumber: 'SER-000002', gradingCompany: 'PSA',
    certificateNumber: '33334444', parentLotPublicId: 'RV-ILOT-000002',
  },
];

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
  links: BrowserInventoryLink[] = [];
  discrepancies: BrowserDiscrepancy[] = [];
  private nextLineId = 3;
  private nextLinkId = 0;
  private nextDiscrepancyId = 0;

  reset(): void {
    this.status = 'open';
    this.lines = baseLines();
    this.links = [];
    this.discrepancies = [];
    this.nextLineId = 3;
    this.nextLinkId = 0;
    this.nextDiscrepancyId = 0;
  }

  linksFor(receiptLinePublicId: string): BrowserInventoryLink[] {
    return this.links.filter((link) => link.receiptLinePublicId === receiptLinePublicId);
  }

  linkedQuantity(receiptLinePublicId: string): number {
    return this.linksFor(receiptLinePublicId).reduce((sum, link) => sum + link.quantityLinked, 0);
  }

  link(receiptLinePublicId: string, body: Record<string, unknown>) {
    const lot = (body.inventoryLotPublicId as string | undefined) ?? null;
    const item = (body.inventoryItemPublicId as string | undefined) ?? null;
    const quantity = item ? 1 : Number(body.quantity ?? 1);
    const line = this.lines.find((l) => l.observed?.receiptLinePublicId === receiptLinePublicId);
    const observed = line?.observed?.quantityReceived ?? 0;
    // Conservation, exactly as the database enforces it.
    if (this.linkedQuantity(receiptLinePublicId) + quantity > observed) {
      return { error: 'inventory_link_over_capacity' as const };
    }
    const subject = INVENTORY_SUBJECTS.find((s) => s.publicId === (item ?? lot));
    this.nextLinkId += 1;
    const created: BrowserInventoryLink = {
      inventoryLinkPublicId: `RV-ARIL-${String(this.nextLinkId).padStart(6, '0')}`,
      receiptLinePublicId,
      quantityLinked: quantity,
      subjectKind: item ? 'item' : 'lot',
      inventoryLotPublicId: lot,
      inventoryItemPublicId: item,
      productDisplayName: subject?.productDisplayName ?? null,
      skuPublicId: subject?.skuPublicId ?? null,
      conditionOrQuality: subject?.conditionOrQuality ?? null,
      locationDisplayName: subject?.locationDisplayName ?? null,
      serialNumber: subject?.serialNumber ?? null,
    };
    this.links.push(created);
    return { inventoryLinkPublicId: created.inventoryLinkPublicId, replayed: false };
  }

  unlink(inventoryLinkPublicId: string) {
    const before = this.links.length;
    this.links = this.links.filter((link) => link.inventoryLinkPublicId !== inventoryLinkPublicId);
    if (this.links.length === before) return { error: 'inventory_link_not_found' as const };
    return { inventoryLinkPublicId, unlinked: true, replayed: false };
  }

  raise(body: Record<string, unknown>) {
    this.nextDiscrepancyId += 1;
    const created: BrowserDiscrepancy = {
      discrepancyPublicId: `RV-ADISC-${String(this.nextDiscrepancyId).padStart(6, '0')}`,
      kind: String(body.kind),
      status: 'open',
      orderPublicId: RECEIVING_ORDER,
      receiptPublicId: (body.receiptPublicId as string | null) ?? null,
      receiptLinePublicId: (body.receiptLinePublicId as string | null) ?? null,
      acquisitionLinePublicId: null,
      quantityExpected: (body.quantityExpected as number | null) ?? null,
      quantityObserved: (body.quantityObserved as number | null) ?? null,
      detail: String(body.detail),
      resolutionNote: null,
      resolvedAt: null,
      createdAt: '2026-08-01T12:00:00.000Z',
    };
    this.discrepancies.push(created);
    return { discrepancyPublicId: created.discrepancyPublicId, status: created.status };
  }

  transitionDiscrepancy(publicId: string, target: BrowserDiscrepancy['status'], note: string | null) {
    const found = this.discrepancies.find((d) => d.discrepancyPublicId === publicId);
    if (!found) return { error: 'discrepancy_not_found' as const };
    found.status = target;
    if (target === 'resolved' || target === 'written_off') {
      found.resolutionNote = note;
      found.resolvedAt = '2026-08-01T13:00:00.000Z';
    }
    return { discrepancyPublicId: publicId, status: target, replayed: false };
  }

  /** Mirrors the governed reconciliation preconditions. */
  reconcile() {
    const recorded = this.lines.filter((line) => line.observed);
    for (const line of recorded) {
      if (this.linkedQuantity(line.observed!.receiptLinePublicId) !== line.observed!.quantityReceived) {
        return { error: 'inventory_link_incomplete' as const };
      }
      const overage = line.cumulativeReceivedQuantity > line.expectedQuantity;
      const hasEvidence = this.discrepancies.some(
        (d) => d.kind === 'over_shipped' && d.receiptLinePublicId === line.observed!.receiptLinePublicId,
      );
      if (overage && !hasEvidence) return { error: 'inventory_link_incomplete' as const };
    }
    this.status = 'reconciled';
    return { receiptPublicId: RECEIPT_PUBLIC_ID, status: 'reconciled', replayed: false };
  }

  private readiness() {
    const recorded = this.lines.filter((line) => line.observed);
    const linesNeedingLinks = recorded
      .filter((line) => this.linkedQuantity(line.observed!.receiptLinePublicId) !== line.observed!.quantityReceived)
      .map((line) => ({
        acquisitionLinePublicId: line.acquisitionLinePublicId,
        observed: line.observed!.quantityReceived,
        linked: this.linkedQuantity(line.observed!.receiptLinePublicId),
      }));
    const overageLinesMissingEvidence = recorded
      .filter((line) => line.cumulativeReceivedQuantity > line.expectedQuantity)
      .filter((line) => !this.discrepancies.some(
        (d) => d.kind === 'over_shipped' && d.receiptLinePublicId === line.observed!.receiptLinePublicId))
      .map((line) => ({
        acquisitionLinePublicId: line.acquisitionLinePublicId,
        expected: line.expectedQuantity,
        cumulativeReceived: line.cumulativeReceivedQuantity,
      }));
    return {
      receiptStatus: this.status,
      linesFullyLinked: linesNeedingLinks.length === 0 && recorded.length > 0,
      linesNeedingLinks,
      overageLinesMissingEvidence,
      openDiscrepancyCount: this.discrepancies.filter((d) => d.status === 'open').length,
      claimedDiscrepancyCount: this.discrepancies.filter((d) => d.status === 'claimed').length,
      terminalDiscrepancyCount: this.discrepancies.filter(
        (d) => d.status === 'resolved' || d.status === 'written_off').length,
    };
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
      lines: this.lines.map((line) => {
        const receiptLineId = line.observed?.receiptLinePublicId;
        const links = receiptLineId ? this.linksFor(receiptLineId) : [];
        const linked = links.reduce((sum, link) => sum + link.quantityLinked, 0);
        return {
          ...line,
          links,
          linkedQuantity: linked,
          unlinkedQuantity: Math.max(0, (line.observed?.quantityReceived ?? 0) - linked),
        };
      }),
      shipments: [SHIPMENT],
      discrepancies: this.discrepancies,
      reconciliation: this.readiness(),
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
