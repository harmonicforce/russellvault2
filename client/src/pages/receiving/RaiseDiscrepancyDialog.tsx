import { useState } from 'react';
import { Alert, Button, Dialog, Field } from '../../design-system';
import {
  DISCREPANCY_KINDS,
  type DiscrepancyKind,
  type ReceivingExpectedLine,
} from '../../lib/receivingApi';
import type { DiscrepancyIntent } from './discrepancyCreation';
import {
  DISCREPANCY_KIND_DESCRIPTION,
  DISCREPANCY_KIND_LABEL,
  UNKNOWN,
} from './receivingPresentation';

/**
 * Record durable receiving evidence that what arrived did not match what was
 * expected.
 *
 * THE KIND COMES FROM THE CLOSED SERVER VOCABULARY. Seven kinds, all rendered
 * as words with an explanation of what each one asserts. There is no free-text
 * kind and no "other".
 *
 * TARGETING IS FROM WHAT IS ALREADY ON SCREEN. The order, receipt and receipt
 * line are supplied by the caller from the record the operator is looking at.
 * Nobody types a governed public identity.
 *
 * NO MONETARY FIELDS. `raise_acquisition_discrepancy` persists no expected or
 * actual value and no currency, so a `price_mismatch` collects none. Offering
 * money inputs whose contents the governed function discards would teach the
 * operator their figures were recorded when they were not; the detail carries
 * the account instead.
 */
export function RaiseDiscrepancyDialog({
  orderPublicId, receiptPublicId, line, open, onCancel, onConfirm, pending, error, allowedKinds,
}: {
  readonly orderPublicId: string;
  readonly receiptPublicId: string | null;
  /** Null for an order-level report such as `never_arrived`. */
  readonly line: ReceivingExpectedLine | null;
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (intent: DiscrepancyIntent) => void;
  readonly pending: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
  /** Narrowed for order-level reporting, where a line-scoped kind makes no sense. */
  readonly allowedKinds?: readonly DiscrepancyKind[];
}) {
  const kinds = allowedKinds ?? DISCREPANCY_KINDS;
  const [kind, setKind] = useState<DiscrepancyKind>(kinds[0]);
  const [detail, setDetail] = useState('');
  // Prefilled from the ACTUAL acquisition and receipt evidence, and reviewable
  // before confirmation. Once recorded they are immutable governed evidence.
  const [expected, setExpected] = useState(
    line ? String(line.expectedQuantity) : '');
  const [observed, setObserved] = useState(
    line?.observed ? String(line.observed.quantityReceived) : '');

  const asQuantity = (value: string): number | null => {
    if (value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  };
  const expectedValid = expected.trim() === '' || asQuantity(expected) !== null;
  const observedValid = observed.trim() === '' || asQuantity(observed) !== null;
  const valid = detail.trim().length > 0 && expectedValid && observedValid;

  return (
    <Dialog
      open={open}
      onDismiss={onCancel}
      title="Record a discrepancy"
      description="Records durable receiving evidence. It does not edit the original acquisition record."
      dismissible={!pending}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid || pending}
            onClick={() =>
              onConfirm({
                orderPublicId,
                receiptPublicId,
                receiptLinePublicId: line?.observed?.receiptLinePublicId ?? null,
                kind,
                quantityExpected: asQuantity(expected),
                quantityObserved: asQuantity(observed),
                detail: detail.trim(),
              })
            }
          >
            {pending ? 'Recording…' : 'Record discrepancy'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <dl className="grid gap-2 rounded-instrument border border-subtle bg-surface-inset px-3 py-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Acquisition order</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-ink">{orderPublicId}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Receipt</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-ink">
              {receiptPublicId ?? 'No receipt — this concerns the order itself'}
            </dd>
          </div>
          {line && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Acquisition line</dt>
              <dd className="mt-0.5 break-words text-sm text-ink">{line.title ?? UNKNOWN.title}</dd>
              <dd className="mt-0.5 break-all font-mono text-xs text-ink-secondary">
                {line.acquisitionLinePublicId}
              </dd>
            </div>
          )}
        </dl>

        <Field label="What kind of discrepancy is this?" required>
          {(props) => (
            <select
              {...props}
              value={kind}
              onChange={(event) => setKind(event.target.value as DiscrepancyKind)}
              className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm text-ink"
            >
              {kinds.map((option) => (
                <option key={option} value={option}>
                  {DISCREPANCY_KIND_LABEL[option]} — {DISCREPANCY_KIND_DESCRIPTION[option]}
                </option>
              ))}
            </select>
          )}
        </Field>

        {kind === 'price_mismatch' && (
          <Alert tone="information" title="Amounts are described, not recorded as figures">
            The governed discrepancy record holds no monetary fields, so no amount entered here would be
            stored. Describe the amounts in the detail below; the acquisition's own payment evidence
            remains the record of what was charged.
          </Alert>
        )}

        {line && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Expected quantity"
              description="Prefilled from the acquisition. Review it before confirming — it becomes immutable evidence."
            >
              {(props) => (
                <input
                  {...props}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={expected}
                  onChange={(event) => setExpected(event.target.value)}
                  className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm tabular-nums text-ink"
                />
              )}
            </Field>
            <Field
              label="Observed quantity"
              description="Prefilled from this receipt's observation."
            >
              {(props) => (
                <input
                  {...props}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={observed}
                  onChange={(event) => setObserved(event.target.value)}
                  className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm tabular-nums text-ink"
                />
              )}
            </Field>
          </div>
        )}

        <Field
          label="What did you observe?"
          required
          description="Required. This becomes durable receiving evidence. It does not edit the acquisition record, the shipment history, or the quantities already recorded."
        >
          {(props) => (
            <textarea
              {...props}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={2000}
              rows={3}
              className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm text-ink"
            />
          )}
        </Field>

        {error && (
          <Alert tone="critical" title="The governed receiving service refused this record">
            {error.message}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
