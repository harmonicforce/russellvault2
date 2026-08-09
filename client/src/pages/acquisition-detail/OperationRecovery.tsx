import { Alert, Button } from '../../design-system';
import { OPERATION_LABEL, type Operation } from './operationModel';

/**
 * The unresolved governed operation notice.
 *
 * This is the only place on the page that speaks about a request whose outcome
 * is unknown, and every sentence in it has to survive the worst case: the
 * request DID reach the governed backend, DID commit, and lost its response.
 *
 * So it says four things and refuses to say a fifth:
 *
 *   1. which operation is unresolved;
 *   2. that the outcome is not known — not that it failed;
 *   3. that retrying is safe SPECIFICALLY because the same idempotency key is
 *      resent, so the governed backend cannot record the work twice;
 *   4. that no other consequential operation can start until this one resolves.
 *
 * What it will not say is "nothing was sent". Nobody on this page knows that,
 * and an operator who believes it will record the payment a second time under
 * a brand-new key that the server has no reason to collapse.
 *
 * The idempotency key itself is deliberately not rendered. It is machinery, not
 * evidence, and putting a UUID in front of an operator invites them to treat it
 * as something to quote, compare, or retype.
 */
export function OperationRecovery({
  failed,
  message,
  pending,
  verifying,
  onRetry,
  onStopRetrying,
}: {
  readonly failed: Operation;
  readonly message: string;
  readonly pending: boolean;
  readonly verifying: boolean;
  readonly onRetry: () => void;
  readonly onStopRetrying: () => void;
}) {
  const label = OPERATION_LABEL[failed.kind];
  const busy = pending || verifying;

  return (
    <Alert
      tone="critical"
      title={`${label} was not confirmed.`}
      action={
        <>
          <Button variant="primary" size="small" disabled={busy} onClick={onRetry}>
            Retry exact request
          </Button>
          <Button size="small" disabled={busy} onClick={onStopRetrying} aria-busy={verifying || undefined}>
            {verifying ? 'Verifying…' : 'Stop retrying and verify'}
          </Button>
        </>
      }
    >
      {message && <p>{message}</p>}

      <p className="mt-1">
        The request may have reached the governed record and committed without returning a response. Retrying resends
        the identical request under the same key, so the governed backend cannot record it twice — that is the safe
        recovery.
      </p>

      <p className="mt-1 text-xs text-ink-muted">
        No other payment, reversal, shipment, transition or eligibility decision can be started while this outcome is
        unresolved.
      </p>
    </Alert>
  );
}
