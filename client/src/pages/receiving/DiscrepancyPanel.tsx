import { Alert, Button } from '../../design-system';
import type { Discrepancy, Role } from '../../lib/receivingApi';
import {
  Count, DiscrepancyKindPill, DiscrepancyStatusPill, PublicId,
  DISCREPANCY_KIND_DESCRIPTION, instant,
} from './receivingPresentation';

/**
 * The receiving discrepancies region.
 *
 * A DEDICATED region, not a notice folded into something else. A discrepancy is
 * durable evidence about physical goods; burying it inside a generic banner
 * makes it look like a transient warning that will go away, which is the
 * opposite of what it is.
 *
 * Every discrepancy states its kind, status, scope, recorded quantities, detail
 * and resolution in WORDS. No fact here is carried by colour alone.
 *
 * TERMINAL CONTROLS ARE OWNER-ONLY. Resolve and write off are rendered only for
 * an owner, mirroring the `array['owner']` assertion S2.2 makes for those two
 * targets. Claiming is owner or operator. The server refuses regardless.
 */
export function DiscrepancyPanel({
  discrepancies, role, receiptStatus, onClaim, onResolve, onWriteOff, onRaise, busy,
}: {
  readonly discrepancies: readonly Discrepancy[];
  readonly role: Role | null;
  readonly receiptStatus: string;
  readonly onClaim: (discrepancy: Discrepancy) => void;
  readonly onResolve: (discrepancy: Discrepancy) => void;
  readonly onWriteOff: (discrepancy: Discrepancy) => void;
  readonly onRaise: (() => void) | null;
  readonly busy: boolean;
}) {
  const isOwner = role === 'owner';
  const canClaim = role === 'owner' || role === 'operator';

  return (
    <section
      aria-label="Receiving discrepancies"
      className="rounded-instrument border border-subtle bg-surface-raised"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-subtle px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
            Receiving discrepancies
          </h2>
          <p className="mt-1 text-xs text-ink-secondary">
            Durable evidence that what arrived did not match what was expected. Recording one does not
            change the acquisition, the shipment history, or the quantities already received.
          </p>
        </div>
        {onRaise && (
          <Button variant="secondary" size="small" onClick={onRaise} disabled={busy}>
            Record a discrepancy
          </Button>
        )}
      </div>

      <div className="grid gap-3 px-4 py-3">
        {discrepancies.length === 0 ? (
          <p className="text-sm text-ink-muted">
            The governed record contains no discrepancies for this acquisition order.
          </p>
        ) : (
          <ul className="grid gap-3">
            {discrepancies.map((discrepancy) => (
              <li
                key={discrepancy.discrepancyPublicId}
                className="rounded-instrument border border-subtle bg-surface-inset px-3 py-2"
                data-discrepancy={discrepancy.discrepancyPublicId}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <DiscrepancyKindPill kind={discrepancy.kind} />
                  <DiscrepancyStatusPill status={discrepancy.status} />
                  <PublicId>{discrepancy.discrepancyPublicId}</PublicId>
                </div>

                <p className="mt-1 text-xs text-ink-secondary">
                  {DISCREPANCY_KIND_DESCRIPTION[discrepancy.kind]}
                </p>

                <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  <Fact label="Scope">
                    {discrepancy.receiptLinePublicId
                      ? `Receipt line ${discrepancy.receiptLinePublicId}`
                      : discrepancy.receiptPublicId
                        ? `Receipt ${discrepancy.receiptPublicId}`
                        : `Acquisition order ${discrepancy.orderPublicId}`}
                  </Fact>
                  <Fact label="Recorded">{instant(discrepancy.createdAt)}</Fact>
                  {/* Quantities appear only where they were actually recorded.
                      A zero printed for an absent value would be a fabricated
                      figure wearing the same typeface as a real one. */}
                  {discrepancy.quantityExpected !== null && (
                    <Fact label="Expected quantity"><Count value={discrepancy.quantityExpected} /></Fact>
                  )}
                  {discrepancy.quantityObserved !== null && (
                    <Fact label="Observed quantity"><Count value={discrepancy.quantityObserved} /></Fact>
                  )}
                </dl>

                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{discrepancy.detail}</p>

                {(discrepancy.status === 'resolved' || discrepancy.status === 'written_off') && (
                  <div className="mt-2 rounded-instrument border border-subtle px-2 py-1.5">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
                      {discrepancy.status === 'resolved' ? 'Resolution' : 'Write-off'}
                    </p>
                    <p className="mt-0.5 break-words text-sm text-ink">
                      {discrepancy.resolutionNote ?? 'No resolution note recorded'}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-secondary">
                      Closed {instant(discrepancy.resolvedAt)}. The original evidence above is preserved
                      and was not rewritten.
                    </p>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  {discrepancy.status === 'open' && canClaim && (
                    <Button variant="secondary" size="small" disabled={busy}
                      onClick={() => onClaim(discrepancy)}>
                      Claim for review
                    </Button>
                  )}
                  {/* Terminal actions depend on the DISCREPANCY's own lifecycle,
                      not the receipt's: S2.2 lets an owner resolve a discrepancy
                      independently of whether the receipt has been reconciled. */}
                  {isOwner && (discrepancy.status === 'open' || discrepancy.status === 'claimed') && (
                    <>
                      <Button variant="secondary" size="small" disabled={busy}
                        onClick={() => onResolve(discrepancy)}>
                        Resolve
                      </Button>
                      <Button variant="secondary" size="small" disabled={busy}
                        onClick={() => onWriteOff(discrepancy)}>
                        Write off
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {receiptStatus === 'cancelled' && discrepancies.length > 0 && (
          <Alert tone="information" title="This receiving session was cancelled">
            The discrepancies above belong to the acquisition order and remain on record. Cancelling a
            receiving session did not remove them.
          </Alert>
        )}
      </div>
    </section>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}
