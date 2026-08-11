import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StatusPill, type DataColumn, type ResponsiveRecord, type StatusTone } from '../../design-system';
import type {
  DiscrepancyKind,
  DiscrepancyStatus,
  ReceiptStatus,
  ReceivingQueueRow,
  ReceivingShipment,
  ReceivingWorkflowState,
} from '../../lib/receivingApi';

/**
 * The receiving domain adapter.
 *
 * THE DESIGN SYSTEM MUST NOT LEARN WHAT A RECEIPT IS.
 *
 * `StatusPill` renders a tone and a word; it does not know that a cancelled
 * receiving session is different from a submitted one, or that a carrier
 * saying "delivered" proves nothing about what was counted. Everything
 * requiring that knowledge is decided here and handed over as values.
 *
 * Nothing in this file fetches, mutates, or decides a receiving rule.
 */

export function receiptPath(receiptPublicId: string): string {
  return `/receiving/${encodeURIComponent(receiptPublicId)}`;
}

/** Bounded unknowns, so an absent value is never an ambiguous blank cell. */
export const UNKNOWN = {
  seller: 'No seller recorded',
  reference: 'No source order reference',
  title: 'Untitled acquisition line',
  carrier: 'No carrier recorded',
  tracking: 'No tracking number recorded',
  receipt: 'No receipt opened yet',
  receivedAt: 'No arrival time recorded',
} as const;

const RECEIPT_TONE: Record<ReceiptStatus, StatusTone> = {
  open: 'information',
  submitted: 'success',
  reconciled: 'success',
  cancelled: 'serious',
};

export function receiptStatusLabel(status: ReceiptStatus): string {
  return status;
}

export function ReceiptStatusPill({ status }: { readonly status: ReceiptStatus }) {
  return <StatusPill tone={RECEIPT_TONE[status]}>{receiptStatusLabel(status)}</StatusPill>;
}

/**
 * The workflow vocabulary, in the operator's words.
 *
 * Each label states a RECEIPT-LIFECYCLE fact the database proved. None of them
 * claims an order "needs receiving": nothing in the governed contract
 * establishes that a delivery is expected, and a label that guessed would send
 * an operator looking for a box that was never coming.
 */
export const WORKFLOW_LABEL: Record<ReceivingWorkflowState, string> = {
  not_started: 'No receiving session yet',
  receiving_in_progress: 'Receiving in progress',
  submitted_pending_review: 'Submitted, awaiting review',
  reconciled: 'Reconciled',
  cancelled_only: 'Last session cancelled',
};

const WORKFLOW_TONE: Record<ReceivingWorkflowState, StatusTone> = {
  not_started: 'neutral',
  receiving_in_progress: 'information',
  submitted_pending_review: 'success',
  reconciled: 'success',
  cancelled_only: 'serious',
};

export function WorkflowPill({ state }: { readonly state: ReceivingWorkflowState }) {
  return <StatusPill tone={WORKFLOW_TONE[state]}>{WORKFLOW_LABEL[state]}</StatusPill>;
}

/** An instant, or a word saying there is none. Never a blank. */
export function instant(iso: string | null | undefined, absent = 'Not recorded'): string {
  if (!iso) return absent;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : absent;
}

/** A governed public identity. Monospaced and breakable so it wraps on a phone. */
export function PublicId({ children }: { readonly children: ReactNode }) {
  return <span className="break-all font-mono text-xs text-ink-secondary">{children}</span>;
}

/** A count, in the same visual rhythm as the counts beside it. */
export function Count({ value }: { readonly value: number }) {
  return <span className="tabular-nums">{value}</span>;
}

export function sellerText(row: { readonly sellers: readonly string[] }): string {
  if (row.sellers.length === 0) return UNKNOWN.seller;
  return row.sellers.join(', ');
}

/**
 * How an expected/observed pair reads.
 *
 * An overage is NOT an error and is deliberately not toned as one: more units
 * physically arrived than the acquisition recorded, which is legitimate
 * evidence the discrepancy model exists to carry. It is called out so the
 * operator notices it, and never clamped, hidden, or refused.
 */
export type DifferenceKind = 'match' | 'short' | 'over' | 'nothing_recorded';

export function differenceKind(expected: number, observed: number | null): DifferenceKind {
  if (observed === null) return 'nothing_recorded';
  if (observed === expected) return 'match';
  return observed > expected ? 'over' : 'short';
}

export const DIFFERENCE_LABEL: Record<DifferenceKind, string> = {
  match: 'Matches expected',
  short: 'Fewer than expected',
  over: 'More than expected',
  nothing_recorded: 'Nothing recorded yet',
};

const DIFFERENCE_TONE: Record<DifferenceKind, StatusTone> = {
  match: 'success',
  short: 'warning',
  over: 'warning',
  nothing_recorded: 'neutral',
};

/**
 * The expected-minus-observed presentation.
 *
 * This DISPLAYS a difference for operator awareness. It records nothing: no
 * discrepancy row is created here, and EXPECTED is never rewritten because
 * OBSERVED disagreed with it.
 */
export function DifferencePill({
  expected, observed,
}: { readonly expected: number; readonly observed: number | null }) {
  const kind = differenceKind(expected, observed);
  const magnitude = observed === null ? null : Math.abs(observed - expected);
  return (
    <StatusPill tone={DIFFERENCE_TONE[kind]}>
      {DIFFERENCE_LABEL[kind]}
      {magnitude ? ` by ${magnitude}` : ''}
    </StatusPill>
  );
}

/** A shipment reference, written so it can never be read as receipt truth. */
export function shipmentSummary(shipment: ReceivingShipment): string {
  const carrier = shipment.carrier ?? UNKNOWN.carrier;
  const tracking = shipment.trackingNumber ?? UNKNOWN.tracking;
  return `${shipment.publicId} — ${carrier}, ${tracking} (carrier status: ${shipment.status})`;
}

// --- the queue table ---------------------------------------------------------

export function queueColumns(): DataColumn<ReceivingQueueRow>[] {
  return [
    {
      key: 'order',
      header: 'Acquisition order',
      render: (row) => (
        <div className="grid gap-0.5">
          <PublicId>{row.orderPublicId}</PublicId>
          <span className="text-sm text-ink">{row.sourceOrderReference ?? UNKNOWN.reference}</span>
        </div>
      ),
    },
    { key: 'seller', header: 'Seller', render: (row) => sellerText(row) },
    {
      key: 'occurred',
      header: 'Acquired',
      render: (row) => instant(row.occurredAt, 'No acquisition date recorded'),
    },
    {
      key: 'expected',
      header: 'Expected',
      // EXPECTED is acquisition evidence. The header says "Expected" and not
      // "Quantity" because an unlabelled number beside an observed one is the
      // single easiest way to confuse the two facts.
      render: (row) => (
        <span className="whitespace-nowrap">
          <Count value={row.expectedQuantityTotal} /> across{' '}
          <Count value={row.receivableLineCount} /> lines
        </span>
      ),
    },
    {
      key: 'observed',
      header: 'Observed',
      render: (row) => <Count value={row.observedQuantityTotal} />,
    },
    { key: 'workflow', header: 'Receiving', render: (row) => <WorkflowPill state={row.workflowState} /> },
    {
      key: 'receipt',
      header: 'Receipt',
      render: (row) =>
        row.openReceiptPublicId ? (
          <Link className="underline" to={receiptPath(row.openReceiptPublicId)}>
            {row.openReceiptPublicId}
          </Link>
        ) : (
          <span className="text-ink-muted">{UNKNOWN.receipt}</span>
        ),
    },
  ];
}

/**
 * The same rows as records, for narrow screens.
 *
 * ONE model, TWO renderings — never two independently maintained lists. The
 * columns above and the records here are built from the same `ReceivingQueueRow`
 * so a phone and a desktop cannot disagree about what a row says.
 */
export function queueRecords(
  rows: readonly ReceivingQueueRow[],
  renderActions?: (row: ReceivingQueueRow) => ReactNode,
): ResponsiveRecord[] {
  return rows.map((row) => ({
    key: row.orderPublicId,
    identity: row.sourceOrderReference ?? UNKNOWN.reference,
    subheading: <PublicId>{row.orderPublicId}</PublicId>,
    status: { label: WORKFLOW_LABEL[row.workflowState], tone: WORKFLOW_TONE[row.workflowState] },
    primaryFields: [
      { label: 'Seller', value: sellerText(row) },
      {
        label: 'Expected',
        value: `${row.expectedQuantityTotal} across ${row.receivableLineCount} lines`,
        numeric: true,
      },
      { label: 'Observed', value: String(row.observedQuantityTotal), numeric: true },
    ],
    secondaryFields: [
      { label: 'Acquired', value: instant(row.occurredAt, 'No acquisition date recorded') },
      {
        label: 'Receipt',
        value: row.openReceiptPublicId ? (
          <Link className="underline" to={receiptPath(row.openReceiptPublicId)}>
            {row.openReceiptPublicId}
          </Link>
        ) : (
          UNKNOWN.receipt
        ),
      },
    ],
    actions: renderActions?.(row),
  }));
}

// --- Batch 2: provenance and discrepancy vocabulary --------------------------

/**
 * The discrepancy taxonomy, in the operator's words.
 *
 * Every kind gets a LABEL. Colour never carries the meaning: a tone is an
 * accent on a word, and an operator who cannot distinguish the tones still
 * reads exactly the same fact.
 */
export const DISCREPANCY_KIND_LABEL: Record<DiscrepancyKind, string> = {
  short_shipped: 'Short shipped',
  over_shipped: 'Over shipped',
  damaged: 'Damaged',
  wrong_item: 'Wrong item',
  not_as_described: 'Not as described',
  price_mismatch: 'Price mismatch',
  never_arrived: 'Never arrived',
};

/** What each kind actually asserts, so the picker is not seven bare words. */
export const DISCREPANCY_KIND_DESCRIPTION: Record<DiscrepancyKind, string> = {
  short_shipped: 'Fewer units arrived than the acquisition recorded.',
  over_shipped: 'More units arrived than the acquisition recorded.',
  damaged: 'Units arrived damaged.',
  wrong_item: 'Something other than the acquired item arrived.',
  not_as_described: 'What arrived does not match how it was described.',
  price_mismatch: 'The amount charged does not match the acquisition evidence.',
  never_arrived: 'Nothing arrived for this acquisition.',
};

export const DISCREPANCY_STATUS_LABEL: Record<DiscrepancyStatus, string> = {
  open: 'Open',
  claimed: 'Claimed for review',
  resolved: 'Resolved',
  written_off: 'Written off',
};

const DISCREPANCY_STATUS_TONE: Record<DiscrepancyStatus, StatusTone> = {
  open: 'warning',
  claimed: 'information',
  resolved: 'success',
  written_off: 'neutral',
};

export function DiscrepancyStatusPill({ status }: { readonly status: DiscrepancyStatus }) {
  return <StatusPill tone={DISCREPANCY_STATUS_TONE[status]}>{DISCREPANCY_STATUS_LABEL[status]}</StatusPill>;
}

/** The kind, always as words. `neutral` because a kind is not a severity. */
export function DiscrepancyKindPill({ kind }: { readonly kind: DiscrepancyKind }) {
  return <StatusPill tone="neutral">{DISCREPANCY_KIND_LABEL[kind]}</StatusPill>;
}

/**
 * How an inventory subject reads.
 *
 * A governed public id alone is an identifier, not recognition. An operator
 * confirming they attributed the right thing needs the product, and for a
 * serialized item the serial that distinguishes it from its siblings.
 */
export function subjectSummary(subject: {
  readonly subjectKind: 'lot' | 'item';
  readonly publicId: string;
  readonly productDisplayName: string | null;
  readonly conditionOrQuality?: string | null;
  readonly serialNumber?: string | null;
  readonly lotQuantity?: number | null;
  readonly locationDisplayName?: string | null;
}): string {
  const parts = [subject.publicId, subject.productDisplayName ?? 'No product name recorded'];
  if (subject.subjectKind === 'item' && subject.serialNumber) parts.push(`serial ${subject.serialNumber}`);
  if (subject.subjectKind === 'lot' && subject.lotQuantity != null) parts.push(`lot holds ${subject.lotQuantity}`);
  if (subject.conditionOrQuality) parts.push(subject.conditionOrQuality);
  if (subject.locationDisplayName) parts.push(subject.locationDisplayName);
  return parts.join(' · ');
}

/** Tracking mode in words. Never an operator's declaration. */
export const TRACKING_MODE_LABEL: Record<string, string> = {
  lot_managed: 'Lot-managed',
  serialized: 'Serialized',
};

export function trackingModeText(mode: string): string {
  return TRACKING_MODE_LABEL[mode] ?? mode;
}

export function SubjectKindPill({ kind }: { readonly kind: 'lot' | 'item' }) {
  return (
    <StatusPill tone={kind === 'item' ? 'information' : 'neutral'}>
      {kind === 'item' ? 'Serialized item' : 'Lot-managed lot'}
    </StatusPill>
  );
}

/**
 * The linking sentence.
 *
 * Says what the numbers MEAN rather than leaving three bare figures side by
 * side. An unlinked remainder is "still needs an inventory subject", never
 * "missing inventory" — nothing is missing; a subject has not been chosen yet.
 */
export function linkProgressText(observed: number, linked: number): string {
  const remaining = Math.max(0, observed - linked);
  if (observed === 0) return 'Nothing recorded on this receipt line yet.';
  if (remaining === 0) return `${observed} received, all ${linked} linked to inventory.`;
  return `${observed} received, ${linked} linked, ${remaining} still needs an inventory subject.`;
}
