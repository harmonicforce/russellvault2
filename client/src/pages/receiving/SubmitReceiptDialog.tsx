import { Alert, Button, Dialog } from '../../design-system';
import type { ReceivingReceiptDetail } from '../../lib/receivingApi';
import { UNKNOWN, differenceKind, instant } from './receivingPresentation';

/**
 * The submission confirmation.
 *
 * WHY THIS IS A `Dialog` AND NOT A `MutationConfirmation`
 *
 * `MutationConfirmation` always renders a required reason field, and the
 * governed `submit_acquisition_receipt` function accepts no reason at all. A
 * reason box here would collect an explanation, discard it, and leave the
 * operator believing it had been recorded on the receipt. Correction and
 * cancellation both DO take a governed reason and use `MutationConfirmation`
 * unchanged; submission is confirmed with the same rigour and without inventing
 * a field the governed contract has nowhere to put.
 *
 * WHAT THE COPY HAS TO GET RIGHT
 *
 * Submission is the moment an operator is most likely to believe the work is
 * finished. It is not. It freezes observed quantities and moves the receipt to
 * review; it creates no inventory, resolves no discrepancy, completes no owner
 * reconciliation, and establishes no cost basis. Those are separate governed
 * operations that have not run. So the dialog states both halves — what this
 * does and what it does NOT do — and the copy is deliberately unceremonious.
 */
export function SubmitReceiptDialog({
  detail, open, onCancel, onConfirm, pending, error,
}: {
  readonly detail: ReceivingReceiptDetail;
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly pending: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
}) {
  const recorded = detail.lines.filter((line) => line.observed !== null);
  const differences = recorded.filter(
    (line) => differenceKind(line.expectedQuantity, line.observed?.quantityReceived ?? null) !== 'match',
  );
  const notRecorded = detail.lines.filter(
    (line) => line.observed === null && line.exclusionState === 'included',
  );
  const shipment = detail.receipt.shipmentPublicId;

  return (
    <Dialog
      open={open}
      onDismiss={onCancel}
      title="Submit this receipt"
      description="Freezes the observed quantities on this receipt and moves it to submitted review."
      dismissible={!pending}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={pending}>
            {pending ? 'Submitting…' : 'Submit receipt'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <dl className="grid gap-2 rounded-instrument border border-subtle bg-surface-inset px-3 py-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Receipt</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-ink">{detail.receipt.publicId}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Arrived</dt>
            <dd className="mt-0.5 text-sm text-ink">{instant(detail.receipt.receivedAt, UNKNOWN.receivedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Recorded lines</dt>
            <dd className="mt-0.5 text-sm tabular-nums text-ink">{recorded.length}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Associated shipment</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-ink">
              {shipment ?? 'No shipment referenced'}
            </dd>
          </div>
        </dl>

        <div className="rounded-instrument border border-subtle px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Observed quantities being frozen
          </h3>
          {recorded.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">
              Nothing has been recorded on this receipt yet. The governed contract refuses a submission
              with no receipt lines.
            </p>
          ) : (
            <ul className="mt-1 grid gap-1">
              {recorded.map((line) => (
                <li key={line.acquisitionLinePublicId} className="text-sm leading-snug text-ink-secondary">
                  <span className="font-mono text-xs">{line.acquisitionLinePublicId}</span>
                  {' — observed '}
                  <span className="tabular-nums text-ink">{line.observed?.quantityReceived}</span>
                  {' against expected '}
                  <span className="tabular-nums">{line.expectedQuantity}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {differences.length > 0 && (
          <Alert tone="warning" title="Observed quantities differ from expected on some lines">
            {differences.length} of {recorded.length} recorded lines differ from the acquisition's expected
            quantity. That difference is preserved as receiving evidence. Submitting does not resolve it,
            and it does not change the acquisition.
          </Alert>
        )}

        {notRecorded.length > 0 && (
          <Alert tone="warning" title="Some acquisition lines have nothing recorded">
            {notRecorded.length} receivable lines on this order have no observation on this receipt. If
            they did not arrive in this delivery that is expected; if they did, record them before
            submitting, because observed quantities cannot be corrected afterwards.
          </Alert>
        )}

        <div className="rounded-instrument border border-subtle bg-surface-inset px-3 py-2 text-sm">
          <p className="text-ink">Submitting this receipt:</p>
          <ul className="mt-1 list-disc pl-5 text-ink-secondary">
            <li>freezes the observed quantities recorded above;</li>
            <li>moves the receipt to submitted review;</li>
            <li>makes governed inventory linking possible as a separate, later step.</li>
          </ul>
          <p className="mt-2 text-ink">Submitting does NOT:</p>
          <ul className="mt-1 list-disc pl-5 text-ink-secondary">
            <li>create any inventory;</li>
            <li>mean every discrepancy has been resolved;</li>
            <li>mean owner reconciliation is complete;</li>
            <li>establish a cost basis.</li>
          </ul>
        </div>

        {error && (
          <Alert tone="critical" title="The governed receiving service refused this submission">
            {error.message}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
