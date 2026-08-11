import { Alert, Button, Dialog } from '../../design-system';
import type { ReceivingReceiptDetail } from '../../lib/receivingApi';
import { UNKNOWN, instant } from './receivingPresentation';

/**
 * Owner reconciliation.
 *
 * WHY THIS IS A `Dialog` AND NOT A `MutationConfirmation`.
 *
 * `MutationConfirmation` always renders a required reason field, and
 * `reconcile_acquisition_receipt` accepts no reason at all. Collecting one here
 * would discard it while leaving the owner believing it had been recorded
 * against the receipt. Unlink, correction, cancellation and discrepancy
 * resolution all DO take a governed reason and use `MutationConfirmation`
 * unchanged; this one is confirmed with the same rigour and without inventing a
 * field the governed contract has nowhere to put.
 *
 * WHAT IT SHOWS.
 *
 * The ACTUAL current state, per line, from the complete governed read: observed,
 * linked, and the difference. Not one "Ready" badge — a single green light
 * computed from partial data is exactly the kind of confident summary that
 * makes an owner accept evidence they have not seen.
 *
 * Blockers are stated BEFORE the press. The server remains authoritative and
 * will refuse anyway; this exists so the refusal is not the first time the owner
 * learns why.
 */
export function ReconcileDialog({
  detail, open, onCancel, onConfirm, pending, error,
}: {
  readonly detail: ReceivingReceiptDetail;
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly pending: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
}) {
  const readiness = detail.reconciliation;
  const recorded = detail.lines.filter((line) => line.observed !== null);
  const blocked =
    readiness.linesNeedingLinks.length > 0 || readiness.overageLinesMissingEvidence.length > 0;

  return (
    <Dialog
      open={open}
      onDismiss={onCancel}
      title="Reconcile this receipt"
      description="Owner acceptance of this receiving evidence. The receipt becomes terminal."
      dismissible={!pending}
      size="wide"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={pending}>
            {pending ? 'Reconciling…' : 'Reconcile receipt'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <dl className="grid gap-2 rounded-instrument border border-subtle bg-surface-inset px-3 py-2 sm:grid-cols-3">
          <Fact label="Receipt">{detail.receipt.publicId}</Fact>
          <Fact label="Goods arrived">{instant(detail.receipt.receivedAt, UNKNOWN.receivedAt)}</Fact>
          <Fact label="Receipt lines">{recorded.length}</Fact>
        </dl>

        <div className="overflow-x-auto rounded-instrument border border-subtle">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Observed and linked quantities for each receipt line</caption>
            <thead>
              <tr className="border-b border-subtle bg-surface-raised">
                <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Acquisition line</th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Observed</th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Linked</th>
                <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Difference</th>
              </tr>
            </thead>
            <tbody>
              {recorded.map((line) => {
                const observed = line.observed?.quantityReceived ?? 0;
                const difference = observed - line.linkedQuantity;
                return (
                  <tr key={line.acquisitionLinePublicId} className="border-b border-subtle last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{line.acquisitionLinePublicId}</td>
                    <td className="px-3 py-2 tabular-nums">{observed}</td>
                    <td className="px-3 py-2 tabular-nums">{line.linkedQuantity}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {difference === 0 ? 'None' : `${difference} not linked`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <dl className="grid gap-2 rounded-instrument border border-subtle px-3 py-2 sm:grid-cols-3">
          <Fact label="Open discrepancies">{readiness.openDiscrepancyCount}</Fact>
          <Fact label="Claimed discrepancies">{readiness.claimedDiscrepancyCount}</Fact>
          <Fact label="Closed discrepancies">{readiness.terminalDiscrepancyCount}</Fact>
        </dl>

        {readiness.linesNeedingLinks.length > 0 && (
          <Alert tone="warning" title="Some receipt lines are not fully linked to inventory">
            <ul className="list-disc pl-5">
              {readiness.linesNeedingLinks.map((line) => (
                <li key={line.acquisitionLinePublicId}>
                  {line.acquisitionLinePublicId}: {line.observed} observed, only {line.linked} linked.
                </li>
              ))}
            </ul>
            The governed contract requires every receipt line's linked quantity to equal its observed
            quantity before reconciliation.
          </Alert>
        )}

        {readiness.overageLinesMissingEvidence.length > 0 && (
          <Alert tone="warning" title="An overage has no Over shipped discrepancy">
            <ul className="list-disc pl-5">
              {readiness.overageLinesMissingEvidence.map((line) => (
                <li key={line.acquisitionLinePublicId}>
                  {line.acquisitionLinePublicId}: {line.cumulativeReceived} received against{' '}
                  {line.expected} expected.
                </li>
              ))}
            </ul>
            Observed receiving exceeds the acquisition quantity. Record an Over shipped discrepancy
            before owner reconciliation — no other kind satisfies this requirement, and it is not
            created automatically.
          </Alert>
        )}

        <div className="rounded-instrument border border-subtle bg-surface-inset px-3 py-2 text-sm">
          <p className="text-ink">Reconciling this receipt means:</p>
          <ul className="mt-1 list-disc pl-5 text-ink-secondary">
            <li>you accept this receiving evidence as the owner;</li>
            <li>the receipt becomes terminal and can no longer be changed;</li>
            <li>its inventory provenance links become immutable.</li>
          </ul>
          <p className="mt-2 text-ink">It does NOT mean:</p>
          <ul className="mt-1 list-disc pl-5 text-ink-secondary">
            <li>the acquisition source evidence was rewritten;</li>
            <li>the shipment history was rewritten;</li>
            <li>a cost basis has been calculated;</li>
            <li>the item is listed or sold.</li>
          </ul>
        </div>

        {blocked && (
          <Alert tone="information" title="The governed contract decides">
            The blockers above are read from the current governed record. The database re-checks them and
            will refuse if they still hold when you confirm.
          </Alert>
        )}

        {error && (
          <Alert tone="critical" title="The governed receiving service refused this reconciliation">
            {error.message}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{label}</dt>
      <dd className="mt-0.5 break-all text-sm tabular-nums text-ink">{children}</dd>
    </div>
  );
}
