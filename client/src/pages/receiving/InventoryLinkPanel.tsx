import { Alert, Button } from '../../design-system';
import type { InventoryLink, ReceivingExpectedLine, Role } from '../../lib/receivingApi';
import {
  Count, PublicId, SubjectKindPill, UNKNOWN, linkProgressText, subjectSummary,
} from './receivingPresentation';

/**
 * Inventory provenance for a SUBMITTED receipt.
 *
 * Rendered only while the receipt is submitted, because that is the only stage
 * at which S2.2 accepts a new link or an unlink: an open receipt has no links,
 * and a reconciled one has immutable ones.
 *
 * THE FOUR NUMBERS ARE FOUR DIFFERENT FACTS.
 *
 *   Expected   what the acquisition recorded.
 *   Observed   what was counted into this receipt.
 *   Linked     how much of that observation has an inventory subject.
 *   Remaining  observed minus linked.
 *
 * The remainder is never called "missing inventory". Nothing is missing — a
 * subject has not been chosen yet, which is a different sentence and a
 * different next action.
 */
export function InventoryLinkPanel({
  lines, role, receiptStatus, onLink, onUnlink, busy,
}: {
  readonly lines: readonly ReceivingExpectedLine[];
  readonly role: Role | null;
  readonly receiptStatus: string;
  readonly onLink: (line: ReceivingExpectedLine) => void;
  readonly onUnlink: (link: InventoryLink) => void;
  readonly busy: boolean;
}) {
  const canLink = (role === 'owner' || role === 'operator') && receiptStatus === 'submitted';
  const recorded = lines.filter((line) => line.observed !== null);

  return (
    <section
      aria-label="Inventory provenance"
      className="rounded-instrument border border-subtle bg-surface-raised"
    >
      <div className="border-b border-subtle px-4 py-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
          Inventory provenance
        </h2>
        <p className="mt-1 text-xs text-ink-secondary">
          Attributes what physically arrived to governed inventory subjects that already exist.
          Linking creates no inventory, and it does not change the acquisition or the shipment record.
        </p>
      </div>

      <div className="grid gap-3 px-4 py-3">
        {recorded.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing has been recorded on this receipt, so there is nothing to attribute.
          </p>
        ) : (
          recorded.map((line) => (
            <div
              key={line.acquisitionLinePublicId}
              className="rounded-instrument border border-subtle bg-surface-inset px-3 py-2"
              data-link-line={line.acquisitionLinePublicId}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm text-ink">{line.title ?? UNKNOWN.title}</p>
                  <PublicId>{line.acquisitionLinePublicId}</PublicId>
                </div>
                {canLink && line.unlinkedQuantity > 0 && (
                  <Button variant="secondary" size="small" disabled={busy} onClick={() => onLink(line)}>
                    Link inventory
                  </Button>
                )}
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                <Fact label="Expected"><Count value={line.expectedQuantity} /></Fact>
                <Fact label="Observed"><Count value={line.observed?.quantityReceived ?? 0} /></Fact>
                <Fact label="Linked"><Count value={line.linkedQuantity} /></Fact>
                <Fact label="Still needs a subject"><Count value={line.unlinkedQuantity} /></Fact>
              </dl>

              <p className="mt-1 text-sm text-ink-secondary" data-link-progress={line.acquisitionLinePublicId}>
                {linkProgressText(line.observed?.quantityReceived ?? 0, line.linkedQuantity)}
              </p>

              {line.links.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  No inventory subject has been attributed to this line yet.
                </p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {line.links.map((link) => (
                    <li
                      key={link.inventoryLinkPublicId}
                      className="rounded-instrument border border-subtle bg-surface px-2 py-1.5"
                      data-inventory-link={link.inventoryLinkPublicId}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <SubjectKindPill kind={link.subjectKind} />
                        <span className="text-sm tabular-nums text-ink">
                          {link.quantityLinked} unit{link.quantityLinked === 1 ? '' : 's'}
                        </span>
                        <PublicId>{link.inventoryLinkPublicId}</PublicId>
                      </div>
                      <p className="mt-0.5 break-words text-sm text-ink-secondary">
                        {subjectSummary({
                          subjectKind: link.subjectKind,
                          publicId: link.inventoryItemPublicId ?? link.inventoryLotPublicId ?? '',
                          productDisplayName: link.productDisplayName,
                          conditionOrQuality: link.conditionOrQuality,
                          serialNumber: link.serialNumber,
                          locationDisplayName: link.locationDisplayName,
                        })}
                      </p>
                      {canLink && (
                        <Button
                          className="mt-1"
                          variant="secondary"
                          size="small"
                          disabled={busy}
                          onClick={() => onUnlink(link)}
                        >
                          Remove link
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}

        {receiptStatus === 'reconciled' && (
          <Alert tone="information" title="This provenance is now immutable">
            The owner reconciled this receipt, so its inventory provenance links are terminal and can no
            longer be removed. The inventory itself is unaffected by that.
          </Alert>
        )}

        {receiptStatus === 'open' && (
          <Alert tone="information" title="Inventory linking begins after submission">
            An open receiving session records what arrived. Attributing it to inventory becomes possible
            once the receipt is submitted and its observed quantities are frozen.
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
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}
