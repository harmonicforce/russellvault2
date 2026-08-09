import { Alert, StatusPill } from '../../design-system';
import type { AcquisitionDetail } from '../../lib/acquisitionDetailApi';
import { Count, Fact, FactGrid, Panel, PublicId, UNKNOWN, headlineTitle, instant } from './detailPresentation';

/**
 * What was acquired, from whom, under which order.
 *
 * Read-only. The overview holds no control at all — every consequential action
 * on this page lives in the panel that owns the decision, so an operator
 * scanning identity is never one stray click from a governed mutation.
 */
export function AcquisitionOverview({ detail }: { readonly detail: AcquisitionDetail }) {
  const { line, order } = detail;
  const headline = headlineTitle(line);

  return (
    <Panel title="Overview">
      <FactGrid columns={3}>
        {/* The page heading already carries the title. This row appears only
            when the delivered title is a DIFFERENT fact — repeating the heading
            verbatim adds nothing and makes the one case where the two disagree
            harder to notice. */}
        {line.deliveredItemTitle && line.deliveredItemTitle !== headline && (
          <Fact label="Delivered item title">{line.deliveredItemTitle}</Fact>
        )}
        <Fact label="Quantity">
          <Count value={line.quantity} />
        </Fact>

        <Fact label="Seller">{order.supplier.displayName || line.sellerNormalized || UNKNOWN.seller}</Fact>
        <Fact label="Business vertical">{line.businessVertical ?? UNKNOWN.vertical}</Fact>
        <Fact label="Line reference">{line.referenceNumber ?? UNKNOWN.reference}</Fact>

        <Fact label="Acquisition line">
          <PublicId>{line.publicId}</PublicId>
        </Fact>
        <Fact label="Acquisition order">
          <PublicId>{order.publicId}</PublicId>
        </Fact>
        <Fact label="Source order reference">{order.sourceOrderReference}</Fact>

        <Fact label="Governed order status">
          <StatusPill>{order.status}</StatusPill>
        </Fact>
        <Fact
          label="Source-reported status"
          hint="Reported by the source system, not established by the governed record."
        >
          {order.sourceReportedStatus ?? 'No source-reported status'}
        </Fact>
        <Fact label="Currency">{order.currency ?? 'No order currency recorded'}</Fact>

        <Fact label="Occurred">{instant(order.occurredAt, 'No occurred date recorded')}</Fact>
        <Fact label="Line created">{instant(line.createdAt)}</Fact>
        <Fact label="Channel">{order.channel.name}</Fact>
      </FactGrid>

      <PlacementIntegrity placement={detail.placement} />
    </Panel>
  );
}

/**
 * Where the line currently sits in the governed Product → SKU → Lot → Item
 * model, and whether that placement is intact.
 *
 * `missing_active_placement` is an INTEGRITY problem, not a blank field, so it
 * is never rendered as one more empty row among the metadata. No lot is
 * invented to fill the gap, and nothing here implies the line is ready for
 * downstream work — a missing active placement means precisely that the
 * governed chain is broken.
 */
function PlacementIntegrity({ placement }: { readonly placement: AcquisitionDetail['placement'] }) {
  if (placement.integrityState === 'missing_active_placement') {
    return (
      <Alert tone="serious" title="No active lot placement">
        <p>
          This acquisition line has no active governed lot placement. The governed placement chain is incomplete for
          this line.
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          No lot is shown because none is recorded. Downstream readiness must not be assumed for this line.
        </p>
      </Alert>
    );
  }

  return (
    <FactGrid columns={3}>
      <Fact label="Active lot">
        {placement.lotPublicId ? <PublicId>{placement.lotPublicId}</PublicId> : 'No lot recorded'}
      </Fact>
      <Fact label="Lot label">{placement.label ?? 'No lot label recorded'}</Fact>
      <Fact label="Lot sequence">
        {placement.sequence === null ? 'No sequence recorded' : <Count value={placement.sequence} />}
      </Fact>
    </FactGrid>
  );
}
