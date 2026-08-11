// The S2.3 receiving transport contract.
//
// WHY THIS MODULE EXISTS SEPARATELY FROM THE ROUTE
//
// S2.2 already owns every receiving RULE. Nothing here decides whether a
// receipt may be submitted, whether a line belongs to an order, or whether a
// correction is allowed — those live in governed SECURITY DEFINER functions and
// are re-proved by the database on every call. What is missing is TRANSPORT:
// the governed tables are readable, but nothing assembles them into an answer a
// receiving operator can act on.
//
// That assembly is pure, so it lives here and is tested directly rather than
// through HTTP. The route module below it does I/O and nothing else.
//
// THE THREE FACTS, KEPT APART
//
//   EXPECTED   acquisition_line_items.quantity — acquisition/import evidence.
//   OBSERVED   acquisition_receipt_lines.quantity_received — receiving evidence.
//   DIFFERENCE never written here. Batch 1 may DISPLAY expected-minus-observed
//              for operator awareness; it creates no discrepancy record, and it
//              never rewrites EXPECTED because OBSERVED disagreed.
//
// RECEIPT IS NOT SHIPMENT. A receipt may REFERENCE a governed shipment
// identity. It copies no carrier, no tracking number, and no transport status,
// and a carrier's `delivered` establishes nothing about what physically
// arrived. The two are carried in separate fields all the way to the browser so
// the UI cannot accidentally present one as the other.
//
// NO INTERNAL UUID LEAVES THIS MODULE. Internal ids arrive as join keys —
// that is what they are for — and every assembled payload is built from
// governed RV-* public identities only. `containsInternalId` exists so a test
// can prove it rather than a reviewer having to trust it.

/** The governed receipt lifecycle, verbatim from acquisition_receipt_status. */
export type ReceiptStatus = 'open' | 'submitted' | 'reconciled' | 'cancelled';

export const RECEIPT_STATUSES: readonly ReceiptStatus[] = [
  'open', 'submitted', 'reconciled', 'cancelled',
];

/**
 * Where an ORDER stands in the receiving workflow.
 *
 * Every value here is a fold over authoritative receipt statuses the database
 * returned. There is deliberately no "needs receiving" state: nothing in the
 * governed contract establishes that an order is EXPECTING a delivery, and
 * inventing one from "expected quantity exceeds observed" would be a guess
 * presented as a fact — an order can be legitimately short-shipped, partially
 * delivered on purpose, or cancelled at the source.
 *
 * So this states only what is provable: whether a receiving session is open,
 * whether one has been submitted, whether one has been reconciled, and whether
 * the only sessions that ever existed were abandoned.
 */
export type ReceivingWorkflowState =
  | 'not_started'
  | 'receiving_in_progress'
  | 'submitted_pending_review'
  | 'reconciled'
  | 'cancelled_only';

/**
 * The approved discrepancy taxonomy, verbatim from
 * `public.acquisition_discrepancy_kind`. CLOSED: the transport refuses anything
 * outside it rather than letting an unknown value reach the enum cast, so an
 * invented kind fails here with a bounded code instead of as a raw database
 * error the operator cannot act on.
 */
export type DiscrepancyKind =
  | 'short_shipped' | 'over_shipped' | 'damaged' | 'wrong_item'
  | 'not_as_described' | 'price_mismatch' | 'never_arrived';

export const DISCREPANCY_KINDS: readonly DiscrepancyKind[] = [
  'short_shipped', 'over_shipped', 'damaged', 'wrong_item',
  'not_as_described', 'price_mismatch', 'never_arrived',
];

export type DiscrepancyStatus = 'open' | 'claimed' | 'resolved' | 'written_off';

export const DISCREPANCY_STATUSES: readonly DiscrepancyStatus[] = [
  'open', 'claimed', 'resolved', 'written_off',
];

/**
 * The transitions only an OWNER may perform.
 *
 * S2.2 asserts this itself; the transport refuses first so an operator gets an
 * honest refusal without a pointless round trip, and the database still decides.
 */
export const OWNER_ONLY_DISCREPANCY_TARGETS: readonly DiscrepancyStatus[] = ['resolved', 'written_off'];

// --- raw governed row shapes -------------------------------------------------
// These mirror the columns the route selects. They carry internal ids because
// they are the join keys; nothing below copies one into an output payload.

export interface AcquisitionLineRow {
  readonly acquisition_line_item_id: string;
  readonly acquisition_line_public_id: string;
  readonly source_system_public_id: string;
  readonly quantity: number;
  readonly description: string | null;
  readonly full_title: string | null;
  readonly delivered_item_title: string | null;
  readonly seller_normalized: string | null;
  readonly exclusion_state: 'included' | 'excluded';
  /** NULL when the line has no active lot placement, so it belongs to no order. */
  readonly acquisition_order_id: string | null;
  readonly acquisition_order_public_id: string | null;
  readonly source_order_reference: string | null;
  readonly order_status: string | null;
  readonly occurred_at: string | null;
}

export interface ReceiptRow {
  readonly id: string;
  readonly public_id: string;
  readonly acquisition_order_id: string;
  readonly acquisition_shipment_id: string | null;
  readonly status: ReceiptStatus;
  readonly received_at: string | null;
  readonly note: string | null;
  readonly created_at: string;
}

export interface ReceiptLineRow {
  readonly id: string;
  readonly public_id: string;
  readonly acquisition_receipt_id: string;
  readonly acquisition_line_item_id: string;
  readonly quantity_received: number;
  readonly note: string | null;
}

export interface InventoryLinkRow {
  readonly id: string;
  readonly public_id: string;
  readonly acquisition_receipt_line_id: string;
  readonly inventory_lot_id: string | null;
  readonly inventory_item_id: string | null;
  readonly quantity_linked: number;
}

export interface DiscrepancyRow {
  readonly public_id: string;
  readonly acquisition_order_id: string;
  readonly acquisition_receipt_id: string | null;
  readonly acquisition_receipt_line_id: string | null;
  readonly acquisition_line_item_id: string | null;
  readonly kind: DiscrepancyKind;
  readonly status: DiscrepancyStatus;
  readonly quantity_expected: number | null;
  readonly quantity_observed: number | null;
  readonly detail: string;
  readonly resolution_note: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
}

/** A governed lot, as the subject picker needs to recognise it. */
export interface InventoryLotRow {
  readonly lot_public_id: string;
  readonly tracking_mode: string;
  readonly quantity: number;
  readonly lot_state: string;
  readonly product_display_name: string | null;
  readonly sku_public_id: string | null;
  readonly condition_or_quality: string | null;
  readonly location_display_name: string | null;
}

/** A governed serialized item, as the subject picker needs to recognise it. */
export interface InventoryItemRow {
  readonly item_public_id: string;
  readonly lot_public_id: string;
  readonly tracking_mode: string;
  readonly item_state: string;
  readonly scan_sku: string | null;
  readonly serial_number: string | null;
  readonly grading_company: string | null;
  readonly certificate_number: string | null;
  readonly product_display_name: string | null;
  readonly sku_public_id: string | null;
  readonly condition_or_quality: string | null;
  readonly location_display_name: string | null;
}

export interface ShipmentRow {
  readonly id: string;
  readonly public_id: string;
  readonly acquisition_order_id: string;
  readonly carrier: string | null;
  readonly tracking_number: string | null;
  readonly status: string;
  readonly expected_at: string | null;
  readonly received_at: string | null;
}

// --- assembled payloads ------------------------------------------------------

/** A governed shipment, presented as a REFERENCE and never as receipt truth. */
export interface ReceivingShipment {
  readonly publicId: string;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  /** Transport status. Says nothing about what physically arrived. */
  readonly status: string;
  readonly expectedAt: string | null;
  /** The CARRIER's received_at, not a receipt's. Named so it cannot be confused. */
  readonly carrierReceivedAt: string | null;
}

export interface ReceivingReceiptSummary {
  readonly publicId: string;
  readonly status: ReceiptStatus;
  readonly receivedAt: string | null;
  readonly shipmentPublicId: string | null;
  readonly recordedLineCount: number;
  readonly observedQuantityTotal: number;
  readonly createdAt: string;
}

export interface ReceivingQueueRow {
  readonly orderPublicId: string;
  readonly sourceOrderReference: string | null;
  readonly sellers: readonly string[];
  readonly orderStatus: string | null;
  readonly occurredAt: string | null;
  /** Acquisition lines eligible for receiving (excluded lines are not). */
  readonly receivableLineCount: number;
  /** EXPECTED. Acquisition evidence. Never rewritten by receiving. */
  readonly expectedQuantityTotal: number;
  /**
   * OBSERVED across every non-cancelled receipt for this order. A cancelled
   * session's evidence is preserved as history but is not a live observation,
   * which is why it is excluded here and said so in the UI.
   */
  readonly observedQuantityTotal: number;
  readonly workflowState: ReceivingWorkflowState;
  readonly openReceiptPublicId: string | null;
  readonly receipts: readonly ReceivingReceiptSummary[];
  readonly shipments: readonly ReceivingShipment[];
}

/**
 * One governed provenance link between receiving evidence and inventory.
 *
 * Exactly one subject: a lot-managed lot OR a serialized item, never both. The
 * subject's identity is carried as a public id plus enough recognisable product
 * detail for an operator to confirm they are looking at the right thing —
 * `RV-ILOT-…` alone is not recognition.
 */
export interface ReceivingInventoryLink {
  readonly inventoryLinkPublicId: string;
  readonly receiptLinePublicId: string;
  readonly quantityLinked: number;
  readonly subjectKind: 'lot' | 'item';
  readonly inventoryLotPublicId: string | null;
  readonly inventoryItemPublicId: string | null;
  /** Recognition detail, from the governed inventory read models. */
  readonly productDisplayName: string | null;
  readonly skuPublicId: string | null;
  readonly conditionOrQuality: string | null;
  readonly locationDisplayName: string | null;
  readonly serialNumber: string | null;
}

/** A governed discrepancy: durable evidence, never a repair. */
export interface ReceivingDiscrepancy {
  readonly discrepancyPublicId: string;
  readonly kind: DiscrepancyKind;
  readonly status: DiscrepancyStatus;
  readonly orderPublicId: string;
  readonly receiptPublicId: string | null;
  readonly receiptLinePublicId: string | null;
  readonly acquisitionLinePublicId: string | null;
  readonly quantityExpected: number | null;
  readonly quantityObserved: number | null;
  readonly detail: string;
  readonly resolutionNote: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

/**
 * A governed inventory subject an operator may link receiving evidence to.
 *
 * `trackingMode` comes from the DATABASE, never from an operator's choice. The
 * picker offers what inventory actually is; it does not let someone declare a
 * quantity-managed lot to be a serialized item, which is a claim S2.2 would
 * reject anyway and which the UI must not invite.
 */
export interface InventorySubjectCandidate {
  readonly subjectKind: 'lot' | 'item';
  readonly publicId: string;
  readonly trackingMode: string;
  readonly productDisplayName: string | null;
  readonly skuPublicId: string | null;
  readonly conditionOrQuality: string | null;
  readonly locationDisplayName: string | null;
  /** Lot-managed only: how many units the lot itself holds. */
  readonly lotQuantity: number | null;
  /** Serialized only. */
  readonly serialNumber: string | null;
  readonly gradingCompany: string | null;
  readonly certificateNumber: string | null;
  readonly parentLotPublicId: string | null;
}

/** One acquisition line as receiving sees it: expected, observed, and history. */
export interface ReceivingExpectedLine {
  readonly sourceSystemPublicId: string;
  readonly acquisitionLinePublicId: string;
  readonly title: string | null;
  readonly expectedQuantity: number;
  readonly exclusionState: 'included' | 'excluded';
  /** This receipt's observation, or null when nothing has been recorded yet. */
  readonly observed: {
    readonly receiptLinePublicId: string;
    readonly quantityReceived: number;
    readonly note: string | null;
  } | null;
  /**
   * Everything observed for this acquisition line across all non-cancelled
   * receipts, including this one. Genuinely derivable from governed rows, so it
   * is stated rather than omitted.
   */
  readonly cumulativeReceivedQuantity: number;
  /**
   * Governed provenance links for THIS receipt's observation of this line.
   *
   * Empty is a real answer, not a gap: nothing has been attributed yet.
   */
  readonly links: readonly ReceivingInventoryLink[];
  /**
   * How much of the observed quantity already has an inventory subject.
   *
   * Stated as its own field rather than left for the browser to sum, so the
   * page cannot disagree with the database about what has been attributed.
   */
  readonly linkedQuantity: number;
  /**
   * Observed minus linked. NOT "missing inventory" — it is the amount that
   * still needs a subject chosen, which is a different sentence entirely.
   */
  readonly unlinkedQuantity: number;
}

export interface ReceivingReceiptDetail {
  readonly receipt: {
    readonly publicId: string;
    readonly status: ReceiptStatus;
    readonly receivedAt: string | null;
    readonly note: string | null;
    readonly shipmentPublicId: string | null;
    readonly createdAt: string;
  };
  readonly order: {
    readonly publicId: string;
    readonly sourceOrderReference: string | null;
    readonly sellers: readonly string[];
    readonly orderStatus: string | null;
    readonly occurredAt: string | null;
  };
  readonly lines: readonly ReceivingExpectedLine[];
  readonly shipments: readonly ReceivingShipment[];
  /** Every discrepancy recorded against this ORDER, not merely this receipt. */
  readonly discrepancies: readonly ReceivingDiscrepancy[];
  /** What the governed contract would refuse reconciliation for, right now. */
  readonly reconciliation: ReconciliationReadiness;
}

/**
 * What currently stands between this receipt and owner reconciliation.
 *
 * This is NOT a reimplementation of the reconciliation rule. S2.2 decides, and
 * its refusal is authoritative. This exists so the owner is not invited to
 * press a button that can only fail, and so the reason is legible BEFORE the
 * press rather than as a bounded error code afterwards.
 *
 * It is deliberately a list of named blockers rather than one "Ready" badge:
 * a single green light computed from partial data is exactly the kind of
 * confident summary this program refuses to show.
 */
export interface ReconciliationReadiness {
  readonly receiptStatus: ReceiptStatus;
  readonly linesFullyLinked: boolean;
  readonly linesNeedingLinks: readonly {
    readonly acquisitionLinePublicId: string;
    readonly observed: number;
    readonly linked: number;
  }[];
  /**
   * Lines whose CUMULATIVE received quantity exceeds the acquisition's expected
   * quantity and therefore require explicit `over_shipped` evidence before
   * S2.2 will reconcile.
   */
  readonly overageLinesMissingEvidence: readonly {
    readonly acquisitionLinePublicId: string;
    readonly expected: number;
    readonly cumulativeReceived: number;
  }[];
  readonly openDiscrepancyCount: number;
  readonly claimedDiscrepancyCount: number;
  readonly terminalDiscrepancyCount: number;
}

// --- derivation --------------------------------------------------------------

/**
 * The workflow state of one order, from its receipts alone.
 *
 * Precedence is deliberate: an open session is the operator's live work and
 * outranks any history beside it. Only when nothing is open does the most
 * advanced completed session describe the order.
 */
export function workflowStateOf(statuses: readonly ReceiptStatus[]): ReceivingWorkflowState {
  if (statuses.length === 0) return 'not_started';
  if (statuses.includes('open')) return 'receiving_in_progress';
  if (statuses.includes('submitted')) return 'submitted_pending_review';
  if (statuses.includes('reconciled')) return 'reconciled';
  return 'cancelled_only';
}

/**
 * A receipt line counts toward observed truth unless its session was abandoned.
 *
 * Cancellation preserves evidence — the rows are never deleted — but an
 * abandoned session is not a claim about what is currently held, so summing it
 * into a live total would overstate what arrived.
 */
function countsAsObserved(status: ReceiptStatus): boolean {
  return status !== 'cancelled';
}

function titleOf(line: AcquisitionLineRow): string | null {
  return line.full_title ?? line.delivered_item_title ?? line.description ?? null;
}

function shipmentOf(row: ShipmentRow): ReceivingShipment {
  return {
    publicId: row.public_id,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    status: row.status,
    expectedAt: row.expected_at,
    carrierReceivedAt: row.received_at,
  };
}

function uniqueSellers(lines: readonly AcquisitionLineRow[]): string[] {
  const seen = new Set<string>();
  for (const line of lines) if (line.seller_normalized) seen.add(line.seller_normalized);
  return [...seen].sort();
}

/**
 * Build the receiving queue.
 *
 * Only orders that actually have a receivable acquisition line appear. A line
 * with no active lot placement has no order in the governed read surface at
 * all, and S2.2 refuses to receive it — advertising such an order as receiving
 * work would send the operator to a dialog that can only fail.
 */
export function buildQueue(input: {
  readonly lines: readonly AcquisitionLineRow[];
  readonly receipts: readonly ReceiptRow[];
  readonly receiptLines: readonly ReceiptLineRow[];
  readonly shipments: readonly ShipmentRow[];
}): ReceivingQueueRow[] {
  const linesByOrder = new Map<string, AcquisitionLineRow[]>();
  for (const line of input.lines) {
    if (!line.acquisition_order_id || !line.acquisition_order_public_id) continue;
    const bucket = linesByOrder.get(line.acquisition_order_id);
    if (bucket) bucket.push(line);
    else linesByOrder.set(line.acquisition_order_id, [line]);
  }

  const receiptById = new Map(input.receipts.map((receipt) => [receipt.id, receipt]));
  const receiptLinesByReceipt = new Map<string, ReceiptLineRow[]>();
  for (const line of input.receiptLines) {
    const bucket = receiptLinesByReceipt.get(line.acquisition_receipt_id);
    if (bucket) bucket.push(line);
    else receiptLinesByReceipt.set(line.acquisition_receipt_id, [line]);
  }

  const receiptsByOrder = new Map<string, ReceiptRow[]>();
  for (const receipt of input.receipts) {
    const bucket = receiptsByOrder.get(receipt.acquisition_order_id);
    if (bucket) bucket.push(receipt);
    else receiptsByOrder.set(receipt.acquisition_order_id, [receipt]);
  }

  const shipmentsByOrder = new Map<string, ShipmentRow[]>();
  for (const shipment of input.shipments) {
    const bucket = shipmentsByOrder.get(shipment.acquisition_order_id);
    if (bucket) bucket.push(shipment);
    else shipmentsByOrder.set(shipment.acquisition_order_id, [shipment]);
  }

  const shipmentPublicIdById = new Map(input.shipments.map((s) => [s.id, s.public_id]));

  const rows: ReceivingQueueRow[] = [];
  for (const [orderId, orderLines] of linesByOrder) {
    const receivable = orderLines.filter((line) => line.exclusion_state === 'included');
    const receipts = (receiptsByOrder.get(orderId) ?? [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.public_id.localeCompare(b.public_id));

    const summaries: ReceivingReceiptSummary[] = receipts.map((receipt) => {
      const recorded = receiptLinesByReceipt.get(receipt.id) ?? [];
      return {
        publicId: receipt.public_id,
        status: receipt.status,
        receivedAt: receipt.received_at,
        shipmentPublicId: receipt.acquisition_shipment_id
          ? shipmentPublicIdById.get(receipt.acquisition_shipment_id) ?? null
          : null,
        recordedLineCount: recorded.length,
        observedQuantityTotal: recorded.reduce((sum, line) => sum + line.quantity_received, 0),
        createdAt: receipt.created_at,
      };
    });

    let observedQuantityTotal = 0;
    for (const line of input.receiptLines) {
      const receipt = receiptById.get(line.acquisition_receipt_id);
      if (!receipt || receipt.acquisition_order_id !== orderId) continue;
      if (countsAsObserved(receipt.status)) observedQuantityTotal += line.quantity_received;
    }

    const first = orderLines[0];
    rows.push({
      orderPublicId: first.acquisition_order_public_id as string,
      sourceOrderReference: first.source_order_reference,
      sellers: uniqueSellers(orderLines),
      orderStatus: first.order_status,
      occurredAt: first.occurred_at,
      receivableLineCount: receivable.length,
      expectedQuantityTotal: receivable.reduce((sum, line) => sum + line.quantity, 0),
      observedQuantityTotal,
      workflowState: workflowStateOf(receipts.map((receipt) => receipt.status)),
      openReceiptPublicId: receipts.find((receipt) => receipt.status === 'open')?.public_id ?? null,
      receipts: summaries,
      shipments: (shipmentsByOrder.get(orderId) ?? [])
        .map(shipmentOf)
        .sort((a, b) => a.publicId.localeCompare(b.publicId)),
    });
  }

  // Newest acquisition first, with a stable public-id tiebreak so the same data
  // always produces the same page and a screenshot baseline means something.
  return rows.sort(
    (a, b) =>
      (b.occurredAt ?? '').localeCompare(a.occurredAt ?? '') ||
      a.orderPublicId.localeCompare(b.orderPublicId),
  );
}

/**
 * Build one receipt's workspace view.
 *
 * EVERY receivable acquisition line of the order is returned, not just the ones
 * already recorded. A receiving operator's central question is "what should be
 * in this box that I have not yet counted", and a table that only lists what
 * has already been entered cannot answer it.
 */
export function buildReceiptDetail(input: {
  readonly receipt: ReceiptRow;
  readonly orderLines: readonly AcquisitionLineRow[];
  readonly receiptsForOrder: readonly ReceiptRow[];
  readonly receiptLinesForOrder: readonly ReceiptLineRow[];
  readonly shipments: readonly ShipmentRow[];
  readonly inventoryLinks?: readonly InventoryLinkRow[];
  readonly lots?: readonly InventoryLotRow[];
  readonly items?: readonly InventoryItemRow[];
  /** Keyed by internal id, since the link rows carry internal subject ids. */
  readonly lotPublicIdById?: ReadonlyMap<string, string>;
  readonly itemPublicIdById?: ReadonlyMap<string, string>;
  readonly discrepancies?: readonly DiscrepancyRow[];
}): ReceivingReceiptDetail {
  const receiptById = new Map(input.receiptsForOrder.map((receipt) => [receipt.id, receipt]));
  const shipmentPublicIdById = new Map(input.shipments.map((s) => [s.id, s.public_id]));
  const lotByPublicId = new Map((input.lots ?? []).map((lot) => [lot.lot_public_id, lot]));
  const itemByPublicId = new Map((input.items ?? []).map((item) => [item.item_public_id, item]));

  // Links, grouped by the receipt line they attribute. Only links belonging to
  // THIS receipt's lines are ever attached to a line below.
  const linksByReceiptLineId = new Map<string, InventoryLinkRow[]>();
  for (const link of input.inventoryLinks ?? []) {
    const bucket = linksByReceiptLineId.get(link.acquisition_receipt_line_id);
    if (bucket) bucket.push(link);
    else linksByReceiptLineId.set(link.acquisition_receipt_line_id, [link]);
  }

  const observedHere = new Map<string, ReceiptLineRow>();
  const cumulative = new Map<string, number>();
  for (const line of input.receiptLinesForOrder) {
    const receipt = receiptById.get(line.acquisition_receipt_id);
    if (!receipt) continue;
    if (line.acquisition_receipt_id === input.receipt.id) {
      observedHere.set(line.acquisition_line_item_id, line);
    }
    if (countsAsObserved(receipt.status)) {
      cumulative.set(
        line.acquisition_line_item_id,
        (cumulative.get(line.acquisition_line_item_id) ?? 0) + line.quantity_received,
      );
    }
  }

  const lines: ReceivingExpectedLine[] = input.orderLines
    .slice()
    .sort((a, b) => a.acquisition_line_public_id.localeCompare(b.acquisition_line_public_id))
    .map((line) => {
      const here = observedHere.get(line.acquisition_line_item_id) ?? null;
      const linkRows = here ? linksByReceiptLineId.get(here.id) ?? [] : [];
      const links: ReceivingInventoryLink[] = linkRows
        .map((row) => {
          const lotPublicId = row.inventory_lot_id
            ? input.lotPublicIdById?.get(row.inventory_lot_id) ?? null
            : null;
          const itemPublicId = row.inventory_item_id
            ? input.itemPublicIdById?.get(row.inventory_item_id) ?? null
            : null;
          const lot = lotPublicId ? lotByPublicId.get(lotPublicId) : undefined;
          const item = itemPublicId ? itemByPublicId.get(itemPublicId) : undefined;
          return {
            inventoryLinkPublicId: row.public_id,
            receiptLinePublicId: here!.public_id,
            quantityLinked: row.quantity_linked,
            // Derived from WHICH column the database populated, never from a
            // caller's claim about what kind of thing this is.
            subjectKind: (row.inventory_item_id ? 'item' : 'lot') as 'lot' | 'item',
            inventoryLotPublicId: lotPublicId,
            inventoryItemPublicId: itemPublicId,
            productDisplayName: item?.product_display_name ?? lot?.product_display_name ?? null,
            skuPublicId: item?.sku_public_id ?? lot?.sku_public_id ?? null,
            conditionOrQuality: item?.condition_or_quality ?? lot?.condition_or_quality ?? null,
            locationDisplayName: item?.location_display_name ?? lot?.location_display_name ?? null,
            serialNumber: item?.serial_number ?? null,
          };
        })
        .sort((a, b) => a.inventoryLinkPublicId.localeCompare(b.inventoryLinkPublicId));

      const observedHereQuantity = here?.quantity_received ?? 0;
      const linkedQuantity = links.reduce((sum, link) => sum + link.quantityLinked, 0);
      return {
        sourceSystemPublicId: line.source_system_public_id,
        acquisitionLinePublicId: line.acquisition_line_public_id,
        title: titleOf(line),
        expectedQuantity: line.quantity,
        exclusionState: line.exclusion_state,
        observed: here
          ? { receiptLinePublicId: here.public_id, quantityReceived: here.quantity_received, note: here.note }
          : null,
        cumulativeReceivedQuantity: cumulative.get(line.acquisition_line_item_id) ?? 0,
        links,
        linkedQuantity,
        // Never negative. The database enforces conservation; if a read ever
        // arrived inconsistent, reporting a negative remainder would be a
        // nonsense number presented with the same confidence as a real one.
        unlinkedQuantity: Math.max(0, observedHereQuantity - linkedQuantity),
      };
    });

  // --- discrepancies, addressed by public identity only --------------------
  const receiptPublicIdById = new Map(input.receiptsForOrder.map((r) => [r.id, r.public_id]));
  const receiptLinePublicIdById = new Map(input.receiptLinesForOrder.map((l) => [l.id, l.public_id]));
  const acquisitionLinePublicIdById = new Map(
    input.orderLines.map((l) => [l.acquisition_line_item_id, l.acquisition_line_public_id]),
  );

  const discrepancies: ReceivingDiscrepancy[] = (input.discrepancies ?? [])
    .map((row) => ({
      discrepancyPublicId: row.public_id,
      kind: row.kind,
      status: row.status,
      orderPublicId: first0(input.orderLines),
      receiptPublicId: row.acquisition_receipt_id
        ? receiptPublicIdById.get(row.acquisition_receipt_id) ?? null
        : null,
      receiptLinePublicId: row.acquisition_receipt_line_id
        ? receiptLinePublicIdById.get(row.acquisition_receipt_line_id) ?? null
        : null,
      acquisitionLinePublicId: row.acquisition_line_item_id
        ? acquisitionLinePublicIdById.get(row.acquisition_line_item_id) ?? null
        : null,
      quantityExpected: row.quantity_expected,
      quantityObserved: row.quantity_observed,
      detail: row.detail,
      resolutionNote: row.resolution_note,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      // No actor field. `created_by` and `resolved_by` are auth.users UUIDs and
      // there is no governed public representation of a person in this system,
      // so surfacing them would be exposing an internal identifier in the one
      // place it is most tempting to.
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.discrepancyPublicId.localeCompare(b.discrepancyPublicId));

  const first = input.orderLines[0];
  return {
    receipt: {
      publicId: input.receipt.public_id,
      status: input.receipt.status,
      receivedAt: input.receipt.received_at,
      note: input.receipt.note,
      shipmentPublicId: input.receipt.acquisition_shipment_id
        ? shipmentPublicIdById.get(input.receipt.acquisition_shipment_id) ?? null
        : null,
      createdAt: input.receipt.created_at,
    },
    order: {
      publicId: first?.acquisition_order_public_id ?? '',
      sourceOrderReference: first?.source_order_reference ?? null,
      sellers: uniqueSellers(input.orderLines),
      orderStatus: first?.order_status ?? null,
      occurredAt: first?.occurred_at ?? null,
    },
    lines,
    shipments: input.shipments.map(shipmentOf).sort((a, b) => a.publicId.localeCompare(b.publicId)),
    discrepancies,
    reconciliation: reconciliationReadiness(input.receipt.status, lines, discrepancies),
  };
}

function first0(lines: readonly AcquisitionLineRow[]): string {
  return lines[0]?.acquisition_order_public_id ?? '';
}

/**
 * Name what would currently block owner reconciliation.
 *
 * NOT a client-side rule engine and not a decision: S2.2 owns the rule and its
 * refusal is authoritative. This mirrors the two conditions the governed
 * function actually checks so the owner can see WHY before pressing, instead of
 * meeting a bounded error code afterwards.
 *
 * Both conditions are taken verbatim from `app.transition_receipt`:
 *   1. every receipt line's linked total must EQUAL its observed quantity;
 *   2. a line whose cumulative received quantity exceeds the acquisition's
 *      expected quantity requires an `over_shipped` discrepancy on that line.
 *
 * Note what is NOT a blocker: an open or claimed discrepancy of any other kind.
 * S2.2 does not require discrepancies to be resolved before reconciliation, and
 * inventing that requirement here would block an owner the database would have
 * allowed. The counts are reported so the owner can see them and decide.
 */
export function reconciliationReadiness(
  receiptStatus: ReceiptStatus,
  lines: readonly ReceivingExpectedLine[],
  discrepancies: readonly ReceivingDiscrepancy[],
): ReconciliationReadiness {
  const recorded = lines.filter((line) => line.observed !== null);

  const linesNeedingLinks = recorded
    .filter((line) => line.linkedQuantity !== (line.observed?.quantityReceived ?? 0))
    .map((line) => ({
      acquisitionLinePublicId: line.acquisitionLinePublicId,
      observed: line.observed?.quantityReceived ?? 0,
      linked: line.linkedQuantity,
    }));

  const overShippedLineIds = new Set(
    discrepancies
      .filter((d) => d.kind === 'over_shipped' && d.receiptLinePublicId)
      .map((d) => d.receiptLinePublicId as string),
  );

  const overageLinesMissingEvidence = recorded
    .filter((line) => line.cumulativeReceivedQuantity > line.expectedQuantity)
    .filter((line) => !overShippedLineIds.has(line.observed!.receiptLinePublicId))
    .map((line) => ({
      acquisitionLinePublicId: line.acquisitionLinePublicId,
      expected: line.expectedQuantity,
      cumulativeReceived: line.cumulativeReceivedQuantity,
    }));

  return {
    receiptStatus,
    linesFullyLinked: linesNeedingLinks.length === 0 && recorded.length > 0,
    linesNeedingLinks,
    overageLinesMissingEvidence,
    openDiscrepancyCount: discrepancies.filter((d) => d.status === 'open').length,
    claimedDiscrepancyCount: discrepancies.filter((d) => d.status === 'claimed').length,
    terminalDiscrepancyCount: discrepancies.filter(
      (d) => d.status === 'resolved' || d.status === 'written_off',
    ).length,
  };
}

/**
 * Turn governed inventory read-model rows into pickable subjects.
 *
 * `trackingMode` is copied from the database and never inferred. Only subjects
 * S2.2 would actually accept are offered: a lot must be `lot_managed` and
 * active, an item must live under a `serialized` lot and be active. Offering a
 * subject the governed function will refuse is an invitation to a dead end.
 */
export function buildInventorySubjects(input: {
  readonly lots: readonly InventoryLotRow[];
  readonly items: readonly InventoryItemRow[];
}): InventorySubjectCandidate[] {
  const lots: InventorySubjectCandidate[] = input.lots
    .filter((lot) => lot.tracking_mode === 'lot_managed' && lot.lot_state === 'active')
    .map((lot) => ({
      subjectKind: 'lot' as const,
      publicId: lot.lot_public_id,
      trackingMode: lot.tracking_mode,
      productDisplayName: lot.product_display_name,
      skuPublicId: lot.sku_public_id,
      conditionOrQuality: lot.condition_or_quality,
      locationDisplayName: lot.location_display_name,
      lotQuantity: lot.quantity,
      serialNumber: null,
      gradingCompany: null,
      certificateNumber: null,
      parentLotPublicId: null,
    }));

  const items: InventorySubjectCandidate[] = input.items
    .filter((item) => item.tracking_mode === 'serialized' && item.item_state === 'active')
    .map((item) => ({
      subjectKind: 'item' as const,
      publicId: item.item_public_id,
      trackingMode: item.tracking_mode,
      productDisplayName: item.product_display_name,
      skuPublicId: item.sku_public_id,
      conditionOrQuality: item.condition_or_quality,
      locationDisplayName: item.location_display_name,
      lotQuantity: null,
      serialNumber: item.serial_number ?? item.scan_sku,
      gradingCompany: item.grading_company,
      certificateNumber: item.certificate_number,
      parentLotPublicId: item.lot_public_id,
    }));

  return [...lots, ...items].sort(
    (a, b) => a.subjectKind.localeCompare(b.subjectKind) || a.publicId.localeCompare(b.publicId),
  );
}

/** Is this a kind the governed enum actually accepts? */
export function isDiscrepancyKind(value: unknown): value is DiscrepancyKind {
  return typeof value === 'string' && (DISCREPANCY_KINDS as readonly string[]).includes(value);
}

export function isDiscrepancyStatus(value: unknown): value is DiscrepancyStatus {
  return typeof value === 'string' && (DISCREPANCY_STATUSES as readonly string[]).includes(value);
}

// --- the bounded governed refusal vocabulary ---------------------------------

/**
 * Every refusal S2.2 can raise through a Batch 1 path, and the HTTP status that
 * preserves its meaning.
 *
 * The mapping is stated as data so a test can assert the whole table. A
 * semantic refusal must never arrive at the browser as a generic 500: "this
 * receipt is no longer open" and "the database is down" require completely
 * different actions from the operator, and only one of them is worth retrying.
 */
export const RECEIVING_ERROR_STATUS: Readonly<Record<string, number>> = {
  invalid_request: 400,
  acquisition_not_found: 404,
  receipt_not_found: 404,
  receipt_line_not_found: 404,
  unauthorized_workspace: 403,
  governed_write_required: 403,
  receipt_not_open: 409,
  receipt_not_submitted: 409,
  inventory_link_over_capacity: 409,
  inventory_link_incomplete: 409,
  inventory_link_not_found: 404,
  inventory_link_immutable: 409,
  inventory_subject_not_found: 404,
  discrepancy_not_found: 404,
  discrepancy_evidence_immutable: 409,
  invalid_transition: 409,
  receipt_terminal: 409,
  receipt_line_conflict: 409,
  idempotency_conflict: 409,
  acquisition_line_not_in_receipt_order: 409,
  acquisition_line_excluded: 409,
  acquisition_integrity_error: 409,
};

/**
 * The refusals that mean "the value you were shown is no longer the value the
 * database holds". The client must re-read and require a fresh confirmation
 * rather than resending, which is why they are named rather than left for the
 * UI to pattern-match on a status code.
 */
export const RECEIVING_STALE_CODES: readonly string[] = ['receipt_line_conflict', 'idempotency_conflict'];

export interface ReceivingFailure {
  readonly code: string;
  readonly status: number;
}

/**
 * Classify a PostgREST/pgplsql error into the bounded vocabulary.
 *
 * Longest match first: `receipt_not_found` is a substring of nothing here, but
 * `receipt_line_not_found` contains `not_found` and `receipt_line_conflict`
 * shares a prefix with `receipt_line_not_found`. Sorting by length stops a
 * shorter code claiming a longer one's message.
 */
export function classifyReceivingError(error: unknown): ReceivingFailure {
  const message = String((error as { message?: string } | null)?.message ?? '');
  const codes = Object.keys(RECEIVING_ERROR_STATUS).sort((a, b) => b.length - a.length);
  for (const code of codes) {
    if (message.includes(code)) return { code, status: RECEIVING_ERROR_STATUS[code] };
  }
  // A deployment missing the S2.2 migration is a CONFIGURATION answer, not a
  // failure of this request, and the operator's next step is different.
  if (/function .* does not exist|schema cache|could not find the function/i.test(message)) {
    return { code: 'receiving_contract_missing', status: 503 };
  }
  // Never the database's own sentence. The original is logged server-side.
  return { code: 'dependency_failed', status: 502 };
}

/**
 * Does this payload contain something shaped like an internal identifier?
 *
 * Used by the route tests to prove the no-UUID rule over whole responses rather
 * than field by field, so a field added later is covered without anyone
 * remembering to extend an allow-list.
 */
export function containsInternalId(payload: unknown): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(JSON.stringify(payload) ?? '');
}
