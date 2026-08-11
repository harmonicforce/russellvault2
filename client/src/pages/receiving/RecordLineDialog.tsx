import { useState } from 'react';
import { Alert, Button, Dialog, Field } from '../../design-system';
import type { ReceivingExpectedLine } from '../../lib/receivingApi';
import { UNKNOWN } from './receivingPresentation';

/**
 * Record what physically arrived for one acquisition line.
 *
 * THE OVERAGE RULE, ENFORCED BY OMISSION.
 *
 * There is no upper bound on this input and no warning that blocks submission.
 * An operator who counts eleven units against an expected three is reporting
 * physical truth, and a UI that refuses it forces them either to lie or to give
 * up and leave the arrival unrecorded. The expected quantity is shown beside
 * the field so the difference is obvious, and S2.2 owns what an overage may
 * become — that decision is not moved into a browser input's `max` attribute.
 *
 * The acquisition line is never typed. It is chosen from the receipt's own
 * order and addressed exactly as the governed function requires: source system
 * public id plus acquisition line public id.
 */
export function RecordLineDialog({
  line, open, onCancel, onConfirm, pending, error,
}: {
  readonly line: ReceivingExpectedLine;
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (input: { readonly quantityReceived: number; readonly note: string | null }) => void;
  readonly pending: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
}) {
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');

  const parsed = Number(quantity);
  const valid = quantity.trim() !== '' && Number.isSafeInteger(parsed) && parsed > 0;
  const overage = valid && parsed > line.expectedQuantity;

  return (
    <Dialog
      open={open}
      onDismiss={onCancel}
      title="Record what arrived"
      description="Records observed receiving evidence. It does not change the acquisition's expected quantity."
      dismissible={!pending}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid || pending}
            onClick={() => onConfirm({ quantityReceived: parsed, note: note.trim() || null })}
          >
            {pending ? 'Recording…' : 'Record observed quantity'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <dl className="grid gap-2 rounded-instrument border border-subtle bg-surface-inset px-3 py-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Acquisition line</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{line.title ?? UNKNOWN.title}</dd>
            <dd className="mt-0.5 break-all font-mono text-xs text-ink-secondary">
              {line.sourceSystemPublicId} · {line.acquisitionLinePublicId}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Expected quantity</dt>
            <dd className="mt-0.5 text-sm tabular-nums text-ink">{line.expectedQuantity}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
              Already received across sessions
            </dt>
            <dd className="mt-0.5 text-sm tabular-nums text-ink">{line.cumulativeReceivedQuantity}</dd>
          </div>
        </dl>

        <Field
          label="Observed quantity"
          required
          description="What you physically counted. Enter what is actually there, including more than expected."
        >
          {(props) => (
            <input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm tabular-nums text-ink"
            />
          )}
        </Field>

        {overage && (
          // Informational, never blocking. An overage is evidence, not an error.
          <Alert tone="warning" title="More than the acquisition expected">
            You are recording {parsed} against an expected {line.expectedQuantity}. That is a legitimate
            observation and will be recorded as what arrived. It does not change the acquisition, and it
            does not raise a discrepancy on its own.
          </Alert>
        )}

        <Field label="Line note" description="Optional. Recorded on the receipt line as evidence.">
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
