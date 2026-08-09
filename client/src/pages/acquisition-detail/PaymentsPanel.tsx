import { useState } from 'react';
import { Button, Field, MutationConfirmation, StatusPill } from '../../design-system';
import { parseMinorUnits, validLocalDate, type AcquisitionDetail, type Payment, type Role } from '../../lib/acquisitionDetailApi';
import { Count, Fact, FactGrid, Money, Panel, PublicId, instant } from './detailPresentation';
import { operationKey, type Operation } from './operationModel';

const CONTROL = 'w-full rounded-control border border-subtle bg-surface-base px-3 py-2 text-sm text-ink';
const INSTRUMENTS = ['card', 'bank', 'balance', 'credit', 'cash', 'other'] as const;

/**
 * Recorded payment truth for this acquisition order.
 *
 * MONEY IS NEVER A BARE NUMBER HERE.
 *
 * Every amount is currency-qualified, arrives as integer minor units, and is
 * only converted to decimal for display. The two figures an operator most wants
 * — a total, and the difference against what the source reported — are shown
 * ONLY when they are meaningful:
 *
 *   - mixed currencies produce NO combined total, because there is no exchange
 *     rate here and inventing one would fabricate a financial fact;
 *   - a difference is shown only when both sides are in the same currency, so
 *     nothing on this page ever subtracts EUR from USD;
 *   - an absent total reads as "no active recorded total", never as 0. A
 *     confident zero is the one wrong answer an operator will act on without
 *     checking.
 */
export function PaymentsPanel({
  detail,
  role,
  pending,
  locked,
  submit,
}: {
  readonly detail: AcquisitionDetail;
  readonly role: Role;
  readonly pending: boolean;
  readonly locked: boolean;
  readonly submit: (operation: Operation) => void;
}) {
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalValidation, setReversalValidation] = useState('');
  const [validation, setValidation] = useState('');

  const canOperate = role === 'owner' || role === 'operator';
  const summary = detail.paymentSummary;
  const comparable = !summary.mixedCurrencies && summary.differenceMinor !== null && detail.order.currency !== null;

  return (
    <Panel title="Financial">
      <FactGrid columns={2}>
        <Fact label="Active payments">
          <Count value={summary.activeCount} />
        </Fact>

        <Fact label="Recorded active total">
          {summary.mixedCurrencies ? (
            'Mixed currencies — no combined total'
          ) : summary.activeTotalMinor === null ? (
            'No active recorded total'
          ) : (
            <Money minor={summary.activeTotalMinor} currency={summary.activeCurrencies[0]} />
          )}
        </Fact>

        <Fact
          label="Source-reported total"
          hint="Reported by the source system, not established by the governed record."
        >
          {summary.sourceReportedTotalMinor !== null && detail.order.currency ? (
            <Money minor={summary.sourceReportedTotalMinor} currency={detail.order.currency} />
          ) : (
            'No source-reported total'
          )}
        </Fact>

        {/* Rendered only when both sides are in the same currency. Subtracting
            across currencies would be a fabricated number wearing a real
            currency symbol. */}
        {comparable && (
          <Fact label="Payment difference">
            <Money minor={summary.differenceMinor as number} currency={detail.order.currency as string} />
          </Fact>
        )}
      </FactGrid>

      {detail.payments.length === 0 ? (
        <p className="text-sm text-ink-muted">No payments have been recorded.</p>
      ) : (
        <ul className="grid gap-2">
          {detail.payments.map((payment) => (
            <li key={payment.publicId} className="rounded-instrument border border-subtle bg-surface-inset p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Money minor={payment.amountMinor} currency={payment.currency} />
                  <StatusPill tone={payment.state === 'reversed' ? 'serious' : 'success'}>{payment.state}</StatusPill>
                  <span className="text-sm text-ink-secondary">{payment.instrument}</span>
                </div>

                {role === 'owner' && payment.state === 'active' && (
                  <Button
                    size="small"
                    disabled={pending || locked}
                    onClick={() => {
                      setReversalReason('');
                      setReversalValidation('');
                      setReversing(payment);
                    }}
                  >
                    Reverse (preserve history)
                  </Button>
                )}
              </div>

              <FactGrid columns={3}>
                <Fact label="Payment">
                  <PublicId>{payment.publicId}</PublicId>
                </Fact>
                <Fact label="Paid">{instant(payment.paidAt)}</Fact>
                <Fact label="External reference">{payment.externalReference ?? 'No external reference'}</Fact>
              </FactGrid>

              {payment.evidenceNote && (
                <p className="mt-2 text-sm text-ink-secondary">Evidence note: {payment.evidenceNote}</p>
              )}

              {payment.reversalEvent && (
                <div className="mt-2 rounded-instrument border border-subtle bg-surface-raised px-3 py-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Reversal history</h3>
                  {/* The reason stands alone: it is the evidence, and burying
                      it in a run-on line with the timestamp makes it skimmable
                      past. */}
                  <p className="mt-1 text-sm text-ink">{payment.reversalEvent.reason}</p>
                  <p className="text-xs text-ink-muted">
                    {instant(payment.reversalEvent.reversedAt)} · actor {payment.reversalEvent.actorId}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canOperate && (
        <form
          aria-label="Record payment"
          className="grid gap-3 rounded-instrument border border-subtle p-3 sm:grid-cols-2 xl:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const amountMinor = parseMinorUnits(String(form.get('amount')));
            const paidAt = validLocalDate(String(form.get('paidAt')));
            if (amountMinor === null || paidAt === null) {
              setValidation('Enter a valid amount and payment date.');
              return;
            }
            setValidation('');
            submit({
              kind: 'payment',
              target: detail.order.publicId,
              payload: {
                amountMinor,
                currency: String(form.get('currency')).trim().toUpperCase(),
                paidAt,
                instrument: form.get('instrument'),
                externalReference: form.get('externalReference') || null,
                evidenceNote: form.get('evidenceNote') || null,
              },
              idempotencyKey: operationKey(),
            });
          }}
        >
          <Field label="Payment amount" required>
            {(control) => <input {...control} name="amount" inputMode="decimal" placeholder="0.00" className={CONTROL} />}
          </Field>

          <Field label="Payment currency" required>
            {(control) => <input {...control} name="currency" defaultValue="USD" maxLength={3} className={CONTROL} />}
          </Field>

          <Field label="Payment date and time" required>
            {(control) => <input {...control} name="paidAt" type="datetime-local" className={CONTROL} />}
          </Field>

          <Field label="Payment instrument">
            {(control) => (
              <select {...control} name="instrument" className={CONTROL}>
                {INSTRUMENTS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            )}
          </Field>

          <Field label="External reference">
            {(control) => <input {...control} name="externalReference" maxLength={200} className={CONTROL} />}
          </Field>

          <Field label="Payment evidence note">
            {(control) => <input {...control} name="evidenceNote" maxLength={1000} className={CONTROL} />}
          </Field>

          <div className="sm:col-span-2 xl:col-span-3">
            <Button type="submit" variant="primary" disabled={pending || locked}>
              Add payment
            </Button>
            {validation && (
              <p role="alert" className="mt-2 text-sm font-medium text-critical">
                {validation}
              </p>
            )}
          </div>
        </form>
      )}

      {reversing && (
        <MutationConfirmation
          open
          onCancel={() => setReversing(null)}
          onConfirm={() => {
            const reason = reversalReason.trim();
            if (!reason) {
              setReversalValidation('A reversal reason is required.');
              return;
            }
            setReversalValidation('');
            submit({
              kind: 'reverse',
              target: reversing.publicId,
              payload: { reason },
              idempotencyKey: operationKey(),
            });
            setReversing(null);
          }}
          title="Reverse payment"
          consequence="Reversing records a governed reversal against this payment. The payment and its evidence are preserved — this is not a deletion — and the reversal is recorded with actor, time and reason in append-only history."
          objectFacts={
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Fact label="Payment">
                <PublicId>{reversing.publicId}</PublicId>
              </Fact>
              <Fact label="Amount">
                <Money minor={reversing.amountMinor} currency={reversing.currency} />
              </Fact>
              <Fact label="Instrument">{reversing.instrument}</Fact>
              <Fact label="Paid">{instant(reversing.paidAt)}</Fact>
            </dl>
          }
          reason={{
            value: reversalReason,
            onChange: setReversalReason,
            label: 'Reversal reason',
            description: 'Recorded against the reversal event and kept in append-only history.',
            error: reversalValidation || undefined,
            required: true,
            maxLength: 500,
          }}
          confirmLabel="Confirm reversal"
          pendingLabel="Confirm reversal"
          confirmVariant="destructive"
          pending={pending}
          confirmDisabled={locked}
        />
      )}
    </Panel>
  );
}
