import { useState } from 'react';
import { Alert, Button, Dialog, Field, ReasonField } from '../../design-system';
import {
  parseMinorUnits,
  validLocalDate,
  type AcquisitionDetail,
  type Role,
  type Shipment,
  type ShipmentStatus,
} from '../../lib/acquisitionDetailApi';
import {
  Fact,
  FactGrid,
  History,
  HistoryEntry,
  Money,
  Panel,
  PublicId,
  ShipmentStatusPill,
  UNKNOWN,
  instant,
  shipmentStatusLabel,
} from './detailPresentation';
import { operationKey, type Operation } from './operationModel';

const CONTROL = 'w-full rounded-control border border-subtle bg-surface-base px-3 py-2 text-sm text-ink';
const EVIDENCE_REQUIRED: readonly ShipmentStatus[] = ['lost', 'cancelled'];

/**
 * Inbound shipments for this acquisition order.
 *
 * THE DISTINCTION THIS PANEL EXISTS TO PROTECT
 *
 * `delivered` is a CARRIER-REPORTED arrival at an explicitly recorded time. It
 * is not a claim that anything was opened, counted, matched against the order,
 * or taken into governed inventory. Receiving is a separate domain with its own
 * evidence, and an operator who reads "delivered" as "received" will believe
 * stock exists that nobody has ever laid eyes on. The sentence saying so stays
 * visible on the panel rather than living in a tooltip.
 *
 * The transition graph is the SERVER'S. Only `allowedNextTransitions` is
 * offered, and nothing here reconstructs which status may follow which — a
 * client-side copy of that rule would be a second, quietly diverging source of
 * truth for a governed lifecycle.
 */
export function ShipmentsPanel({
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
  const [transitioning, setTransitioning] = useState<{ shipment: Shipment; next: ShipmentStatus } | null>(null);
  const [receivedAt, setReceivedAt] = useState('');
  const [transitionReason, setTransitionReason] = useState('');
  const [transitionValidation, setTransitionValidation] = useState('');
  const [validation, setValidation] = useState('');

  const canOperate = role === 'owner' || role === 'operator';

  const confirmTransition = () => {
    if (!transitioning) return;
    const { shipment, next } = transitioning;
    const received = next === 'delivered' ? validLocalDate(receivedAt) : null;
    const reason = transitionReason.trim() || null;

    if ((next === 'delivered' && !received) || (EVIDENCE_REQUIRED.includes(next) && !reason)) {
      setTransitionValidation('Provide the required transition evidence.');
      return;
    }

    setTransitionValidation('');
    submit({
      kind: 'transition',
      target: shipment.publicId,
      payload: {
        // Compare-and-set: the status this transition believes it is leaving.
        // The server rejects it as `stale_status` if the shipment moved
        // elsewhere, which is exactly the check that stops two operators
        // driving one shipment past each other.
        expectedStatus: shipment.status,
        newStatus: next,
        receivedAt: received,
        reason,
      },
      idempotencyKey: operationKey(),
    });
    setTransitioning(null);
  };

  return (
    <Panel
      title="Inbound shipments"
      description="Delivered means carrier-reported arrival at the explicitly recorded received time. It does not mean the shipment has been physically reconciled, counted into inventory, or that governed receiving is complete."
    >
      {detail.shipments.length === 0 ? (
        <p className="text-sm text-ink-muted">No inbound shipments recorded.</p>
      ) : (
        <ul className="grid gap-3">
          {detail.shipments.map((shipment) => (
            <li key={shipment.publicId} className="rounded-instrument border border-subtle bg-surface-inset p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ShipmentStatusPill status={shipment.status} />
                  <span className="text-sm text-ink">{shipment.carrier ?? UNKNOWN.carrier}</span>
                  {/* Tracking numbers are long and space-separated; they must
                      wrap rather than force the panel sideways on a phone. */}
                  <span className="break-all font-mono text-xs text-ink-secondary">
                    {shipment.trackingNumber ?? UNKNOWN.tracking}
                  </span>
                </div>

                {canOperate && shipment.allowedNextTransitions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {shipment.allowedNextTransitions.map((next) => (
                      <Button
                        key={next}
                        size="small"
                        disabled={pending || locked}
                        onClick={() => {
                          setReceivedAt('');
                          setTransitionReason('');
                          setTransitionValidation('');
                          setTransitioning({ shipment, next });
                        }}
                      >
                        {shipmentStatusLabel(next)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              <FactGrid columns={3}>
                <Fact label="Shipment">
                  <PublicId>{shipment.publicId}</PublicId>
                </Fact>
                <Fact label="Shipped">{instant(shipment.shippedAt)}</Fact>
                <Fact label="Expected">{instant(shipment.expectedAt)}</Fact>
                <Fact label="Received" hint="Carrier-reported arrival time. Not a receiving record.">
                  {instant(shipment.receivedAt)}
                </Fact>
                <Fact label="Shipping reference">
                  {shipment.shippingReferenceMinor !== null && shipment.currency ? (
                    <Money minor={shipment.shippingReferenceMinor} currency={shipment.currency} />
                  ) : (
                    'No shipping reference recorded'
                  )}
                </Fact>
                <Fact label="Evidence note">{shipment.evidenceNote ?? 'No evidence note recorded'}</Fact>
              </FactGrid>

              <History
                title="Transition history"
                emptyLabel="No shipment transitions recorded."
                count={shipment.transitionHistory.length}
              >
                {shipment.transitionHistory.map((transition) => (
                  <HistoryEntry key={transition.publicId}>
                    {transition.fromStatus} → {transition.toStatus}
                    {/* The arrow carries the direction visually; this carries it
                        for anyone who is not looking at it. */}
                    <span className="sr-only">
                      {' '}
                      (changed from {shipmentStatusLabel(transition.fromStatus)} to{' '}
                      {shipmentStatusLabel(transition.toStatus)})
                    </span>
                    {transition.applied ? '' : ' (no change)'} · {instant(transition.createdAt)}
                    {transition.reason ? ` · ${transition.reason}` : ''}
                    {transition.receivedAt ? ` · received ${instant(transition.receivedAt)}` : ''}
                  </HistoryEntry>
                ))}
              </History>
            </li>
          ))}
        </ul>
      )}

      {canOperate && (
        <form
          aria-label="Create shipment"
          className="grid gap-3 rounded-instrument border border-subtle p-3 sm:grid-cols-2 xl:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const shippedRaw = String(form.get('shippedAt'));
            const expectedRaw = String(form.get('expectedAt'));
            const shippedAt = shippedRaw ? validLocalDate(shippedRaw) : null;
            const expectedAt = expectedRaw ? validLocalDate(expectedRaw) : null;
            const shippingRaw = String(form.get('shippingAmount')).trim();
            const shippingCostMinor = shippingRaw ? parseMinorUnits(shippingRaw) : null;

            if ((shippedRaw && !shippedAt) || (expectedRaw && !expectedAt) || (shippingRaw && shippingCostMinor === null)) {
              setValidation('Enter valid shipment dates and reference amount.');
              return;
            }
            setValidation('');
            submit({
              kind: 'shipment',
              target: detail.order.publicId,
              payload: {
                carrier: form.get('carrier') || null,
                trackingNumber: form.get('tracking') || null,
                status: form.get('status'),
                shippedAt,
                expectedAt,
                shippingCostMinor,
                // A currency without an amount is noise, not evidence.
                currency: shippingRaw ? String(form.get('currency')).trim().toUpperCase() : null,
                evidenceNote: form.get('note') || null,
              },
              idempotencyKey: operationKey(),
            });
          }}
        >
          <Field label="Carrier">
            {(control) => <input {...control} name="carrier" maxLength={100} className={CONTROL} />}
          </Field>

          <Field label="Tracking number">
            {(control) => <input {...control} name="tracking" maxLength={200} className={CONTROL} />}
          </Field>

          <Field label="Initial shipment status">
            {(control) => (
              // `delivered` is deliberately absent: a shipment cannot be created
              // already delivered, because delivery requires an explicitly
              // recorded arrival time that a creation form does not collect.
              <select {...control} name="status" className={CONTROL}>
                <option value="expected">expected</option>
                <option value="in_transit">in transit</option>
              </select>
            )}
          </Field>

          <Field label="Shipped date and time">
            {(control) => <input {...control} name="shippedAt" type="datetime-local" className={CONTROL} />}
          </Field>

          <Field label="Expected date and time">
            {(control) => <input {...control} name="expectedAt" type="datetime-local" className={CONTROL} />}
          </Field>

          <Field label="Shipping reference amount">
            {(control) => <input {...control} name="shippingAmount" inputMode="decimal" className={CONTROL} />}
          </Field>

          <Field label="Shipping currency">
            {(control) => <input {...control} name="currency" defaultValue="USD" maxLength={3} className={CONTROL} />}
          </Field>

          <Field label="Shipment evidence note">
            {(control) => <input {...control} name="note" maxLength={1000} className={CONTROL} />}
          </Field>

          <div className="sm:col-span-2 xl:col-span-3">
            <Button type="submit" variant="primary" disabled={pending || locked}>
              Create shipment
            </Button>
            {validation && (
              <p role="alert" className="mt-2 text-sm font-medium text-critical">
                {validation}
              </p>
            )}
          </div>
        </form>
      )}

      {transitioning && (
        <Dialog
          open
          onDismiss={() => setTransitioning(null)}
          title="Confirm shipment transition"
          description={`Moving this shipment from ${shipmentStatusLabel(transitioning.shipment.status)} to ${shipmentStatusLabel(transitioning.next)}.`}
          dismissible={!pending}
          footer={
            <>
              <Button onClick={() => setTransitioning(null)} disabled={pending}>
                Cancel
              </Button>
              <Button variant="primary" onClick={confirmTransition} disabled={pending || locked}>
                Confirm transition
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Fact label="Shipment">
                <PublicId>{transitioning.shipment.publicId}</PublicId>
              </Fact>
              <Fact label="Carrier">{transitioning.shipment.carrier ?? UNKNOWN.carrier}</Fact>
              <Fact label="Current status">{shipmentStatusLabel(transitioning.shipment.status)}</Fact>
              <Fact label="New status">{shipmentStatusLabel(transitioning.next)}</Fact>
            </dl>

            {transitioning.next === 'delivered' && (
              <>
                <Field label="Actual received time">
                  {(control) => (
                    <input
                      {...control}
                      type="datetime-local"
                      autoFocus
                      value={receivedAt}
                      onChange={(event) => setReceivedAt(event.target.value)}
                      className={CONTROL}
                    />
                  )}
                </Field>
                <p className="text-xs text-ink-muted">
                  Records when the carrier reported arrival. It does not record that the shipment has been checked in
                  against the order.
                </p>
              </>
            )}

            {EVIDENCE_REQUIRED.includes(transitioning.next) && (
              <ReasonField
                label="Transition reason"
                description="Recorded against this transition and kept in append-only history."
                value={transitionReason}
                onChange={setTransitionReason}
                rows={2}
              />
            )}

            {transitionValidation && (
              <Alert tone="critical">
                <p>{transitionValidation}</p>
              </Alert>
            )}
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
