import { useState } from 'react';
import { Alert, Button, Dialog, Field } from '../../design-system';
import type { ReceivingQueueRow } from '../../lib/receivingApi';
import { UNKNOWN, instant, sellerText, shipmentSummary } from './receivingPresentation';

/**
 * Open a governed receiving session against one acquisition order.
 *
 * WHY `receivedAt` IS REQUIRED HERE
 *
 * The governed contract sets a receipt's arrival time at open time and never
 * afterwards — no S2.2 function updates it — while `submit` refuses a receipt
 * whose arrival time is null. A receipt opened without one can therefore never
 * be filed; it can only be cancelled. Asking for it at the door is the honest
 * option. The alternative is letting an operator count an entire pallet into a
 * receipt that was already unsubmittable.
 *
 * WHY THE SHIPMENT IS A CHOICE AND NEVER A TEXT BOX
 *
 * A receipt may REFERENCE a shipment, and the governed function accepts only a
 * shipment belonging to this same order. Free text would let an operator type a
 * governed identity from another order and receive a refusal they cannot act
 * on, so the only options offered are the order's own shipments plus the
 * explicit no-shipment path the contract allows.
 */
export function OpenReceiptDialog({
  order, open, onCancel, onConfirm, pending, error,
}: {
  readonly order: ReceivingQueueRow;
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (input: {
    readonly shipmentPublicId: string | null;
    readonly receivedAt: string;
    readonly note: string | null;
  }) => void;
  readonly pending: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
}) {
  const [shipmentPublicId, setShipmentPublicId] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [note, setNote] = useState('');

  const parsed = receivedAt ? new Date(receivedAt) : null;
  const receivedAtValid = parsed !== null && Number.isFinite(parsed.getTime());

  return (
    <Dialog
      open={open}
      onDismiss={onCancel}
      title="Open a receiving session"
      description="Records that goods physically arrived against this acquisition order. It does not create inventory."
      dismissible={!pending}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!receivedAtValid || pending}
            onClick={() =>
              onConfirm({
                shipmentPublicId: shipmentPublicId || null,
                receivedAt: (parsed as Date).toISOString(),
                note: note.trim() || null,
              })
            }
          >
            {pending ? 'Opening…' : 'Open receiving session'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <dl className="grid gap-2 rounded-instrument border border-subtle bg-surface-inset px-3 py-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Acquisition order</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-ink">{order.orderPublicId}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Source order reference</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{order.sourceOrderReference ?? UNKNOWN.reference}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Seller</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{sellerText(order)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Acquired</dt>
            <dd className="mt-0.5 text-sm text-ink">{instant(order.occurredAt, 'No acquisition date recorded')}</dd>
          </div>
        </dl>

        <Field
          label="When did the goods arrive?"
          required
          description="Required. A receipt's arrival time is set when the session opens and cannot be changed afterwards, and a receipt without one can never be submitted."
        >
          {(props) => (
            <input
              {...props}
              type="datetime-local"
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
              className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm text-ink"
            />
          )}
        </Field>

        <Field
          label="Associated shipment"
          description="Optional. A receipt may reference a governed shipment, but it never copies the carrier's status: a carrier reporting delivered does not establish what was counted."
        >
          {(props) => (
            <select
              {...props}
              value={shipmentPublicId}
              onChange={(event) => setShipmentPublicId(event.target.value)}
              className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">No shipment record for this delivery</option>
              {order.shipments.map((shipment) => (
                <option key={shipment.publicId} value={shipment.publicId}>
                  {shipmentSummary(shipment)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Receiving note" description="Optional. Recorded on the receipt as evidence.">
          {(props) => (
            <textarea
              {...props}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              rows={2}
              className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm text-ink"
            />
          )}
        </Field>

        {error && (
          <Alert tone="critical" title="The governed receiving service refused this request">
            {error.message}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
