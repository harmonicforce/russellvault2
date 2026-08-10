// The governed receipt workspace — S2.3 Batch 1.
//
// A FIXED workflow surface: header, expected-vs-observed table, and the
// governed operations. The operator is standing at an open box; nothing here
// moves between visits.
//
// THE THREE FACTS ARE VISIBLY DIFFERENT THINGS
//
//   EXPECTED   what the acquisition said. Acquisition evidence. This page never
//              writes it, and no difference can cause it to be rewritten.
//   OBSERVED   what was counted into THIS receipt. Receiving evidence.
//   DIFFERENCE displayed for awareness, recorded nowhere. Batch 1 raises no
//              discrepancy; that is Batch 2's governed operation.
//
// RECEIPT IS NOT SHIPMENT. The shipment reference is rendered in its own panel,
// labelled as the carrier's transport state, and the page says in words that a
// carrier reporting delivered establishes nothing about what was counted.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  CoverageNotice,
  DataTable,
  MutationConfirmation,
  ResponsiveRecordList,
  hasValue,
  ready,
  type DataColumn,
  type ResponsiveRecord,
  type TruthState,
} from '../design-system';
import {
  createReceivingTransport,
  isStaleConflict,
  receivingQueueKey,
  receivingReceiptKey,
  type ReceivingExpectedLine,

} from '../lib/receivingApi';
import { useWorkspace } from '../lib/workspaceContext';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { RECEIVING_COVERAGE, receiptState } from './receiving/receivingTruth';
import {
  Count, DifferencePill, PublicId, ReceiptStatusPill, UNKNOWN,
  instant, sellerText, shipmentSummary,
} from './receiving/receivingPresentation';
import { RecordLineDialog } from './receiving/RecordLineDialog';
import { SubmitReceiptDialog } from './receiving/SubmitReceiptDialog';
import { mutationMessage } from './receiving/mutationMessages';

type Operation =
  | { readonly kind: 'record'; readonly line: ReceivingExpectedLine }
  | { readonly kind: 'correct'; readonly line: ReceivingExpectedLine }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'submit' };

export default function ReceiptWorkspace() {
  const { receiptPublicId = '' } = useParams();
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();

  const api = useMemo(
    () =>
      createReceivingTransport(
        tokenProviderFromClient(
          createShadowClient(import.meta.env as unknown as Record<string, string | undefined>),
        ),
      ),
    [],
  );

  const enabled = Boolean(workspace) && receiptPublicId !== '';
  const query = useQuery({
    queryKey: receivingReceiptKey(workspace?.id, receiptPublicId),
    queryFn: () => api.receipt(workspace!.id, receiptPublicId),
    enabled,
  });

  const truth = receiptState(query, Boolean(workspace));
  const detail = hasValue(truth) ? truth.value : null;

  const role = query.data?.role ?? null;
  const canReceive = role === 'owner' || role === 'operator';
  const isOpen = detail?.receipt.status === 'open';

  const [operation, setOperation] = useState<Operation | null>(null);
  const [reason, setReason] = useState('');
  const [desired, setDesired] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [outcome, setOutcome] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);

  const close = () => {
    setOperation(null);
    setReason('');
    setDesired('');
    setFailure(null);
  };

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: receivingReceiptKey(workspace?.id, receiptPublicId) });
    await queryClient.invalidateQueries({ queryKey: receivingQueueKey(workspace?.id) });
  };

  /**
   * Run one governed operation.
   *
   * A stale-value refusal is handled differently from every other failure: the
   * receipt is re-read and the confirmation stays open showing the CURRENT
   * value, so the operator decides again against what the database actually
   * holds. Nothing is resent automatically, and no stale value ever wins.
   */
  const run = async (operate: () => Promise<string>) => {
    if (!workspace) return;
    setPending(true);
    setFailure(null);
    try {
      const message = await operate();
      close();
      setOutcome({ tone: 'success', text: message });
      await refresh();
    } catch (error) {
      if (isStaleConflict(error)) {
        await refresh();
        setFailure(mutationMessage(error));
      } else {
        setFailure(mutationMessage(error));
      }
    } finally {
      setPending(false);
    }
  };

  // Stable across renders when the detail has not changed, so the memoized
  // column and record derivations below are not rebuilt on every paint.
  const lines = useMemo<readonly ReceivingExpectedLine[]>(() => detail?.lines ?? [], [detail]);
  const recordedCount = lines.filter((line) => line.observed !== null).length;

  const columns: DataColumn<ReceivingExpectedLine>[] = useMemo(
    () => [
      {
        key: 'line',
        header: 'Acquisition line',
        render: (line) => (
          <div className="grid gap-0.5">
            <span className="text-sm text-ink">{line.title ?? UNKNOWN.title}</span>
            <PublicId>
              {line.sourceSystemPublicId} · {line.acquisitionLinePublicId}
            </PublicId>
          </div>
        ),
      },
      {
        key: 'expected',
        header: 'Expected',
        render: (line) => <Count value={line.expectedQuantity} />,
      },
      {
        key: 'observed',
        header: 'Observed here',
        render: (line) =>
          line.observed ? (
            <Count value={line.observed.quantityReceived} />
          ) : (
            <span className="text-ink-muted">Nothing recorded</span>
          ),
      },
      {
        key: 'cumulative',
        header: 'Received across sessions',
        render: (line) => <Count value={line.cumulativeReceivedQuantity} />,
      },
      {
        key: 'difference',
        header: 'Difference',
        render: (line) => (
          <DifferencePill
            expected={line.expectedQuantity}
            observed={line.observed?.quantityReceived ?? null}
          />
        ),
      },
      ...(canReceive && isOpen
        ? [
            {
              key: 'action',
              header: 'Action',
              render: (line: ReceivingExpectedLine) =>
                line.exclusionState === 'excluded' ? (
                  <span className="text-xs text-ink-muted">Excluded from downstream workflows</span>
                ) : line.observed ? (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                      setOperation({ kind: 'correct', line });
                      setDesired(String(line.observed?.quantityReceived ?? ''));
                      setReason('');
                      setFailure(null);
                    }}
                  >
                    Correct
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                      setOperation({ kind: 'record', line });
                      setFailure(null);
                    }}
                  >
                    Record
                  </Button>
                ),
            } as DataColumn<ReceivingExpectedLine>,
          ]
        : []),
    ],
    [canReceive, isOpen],
  );

  const records: ResponsiveRecord[] = useMemo(
    () =>
      lines.map((line) => ({
        key: line.acquisitionLinePublicId,
        identity: line.title ?? UNKNOWN.title,
        subheading: (
          <PublicId>
            {line.sourceSystemPublicId} · {line.acquisitionLinePublicId}
          </PublicId>
        ),
        primaryFields: [
          { label: 'Expected', value: String(line.expectedQuantity), numeric: true },
          {
            label: 'Observed here',
            value: line.observed ? String(line.observed.quantityReceived) : 'Nothing recorded',
            numeric: true,
          },
          {
            label: 'Received across sessions',
            value: String(line.cumulativeReceivedQuantity),
            numeric: true,
          },
        ],
        secondaryFields: [
          {
            label: 'Difference',
            value: (
              <DifferencePill
                expected={line.expectedQuantity}
                observed={line.observed?.quantityReceived ?? null}
              />
            ),
          },
        ],
        actions:
          canReceive && isOpen && line.exclusionState === 'included' ? (
            line.observed ? (
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  setOperation({ kind: 'correct', line });
                  setDesired(String(line.observed?.quantityReceived ?? ''));
                  setReason('');
                  setFailure(null);
                }}
              >
                Correct
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  setOperation({ kind: 'record', line });
                  setFailure(null);
                }}
              >
                Record
              </Button>
            )
          ) : null,
      })),
    [lines, canReceive, isOpen],
  );

  return (
    <div className="space-y-5 p-4 md:p-6">
      <Link className="text-sm text-accent-strong underline underline-offset-2" to="/receiving">
        Back to receiving
      </Link>

      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold text-ink">
          Receipt {detail?.receipt.publicId ?? receiptPublicId}
        </h1>
        <CoverageNotice coverage={RECEIVING_COVERAGE} timeBasis="current" />
      </header>

      {truth.kind === 'stale' && (
        <Alert tone="warning" title="This receipt could not be re-read">
          {truth.label} Use refresh before acting on what is shown.
        </Alert>
      )}

      {outcome && (
        <Alert tone={outcome.tone === 'success' ? 'success' : 'warning'} title="Receiving updated">
          {outcome.text}
        </Alert>
      )}

      {failure && !operation && (
        <Alert tone="critical" title="The governed receiving service refused this request">
          {failure.message}
        </Alert>
      )}

      {detail && (
        <>
          <section
            aria-label="Receipt"
            className="rounded-instrument border border-subtle bg-surface-raised"
          >
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-subtle px-4 py-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
                Receipt
              </h2>
              <ReceiptStatusPill status={detail.receipt.status} />
            </div>
            <dl className="grid gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-2 xl:grid-cols-3">
              <Fact label="Receipt identity"><PublicId>{detail.receipt.publicId}</PublicId></Fact>
              <Fact label="Acquisition order">
                <PublicId>{detail.order.publicId}</PublicId>
              </Fact>
              <Fact label="Source order reference">
                {detail.order.sourceOrderReference ?? UNKNOWN.reference}
              </Fact>
              <Fact label="Seller">{sellerText(detail.order)}</Fact>
              <Fact label="Goods arrived">
                {instant(detail.receipt.receivedAt, UNKNOWN.receivedAt)}
              </Fact>
              <Fact label="Session opened">{instant(detail.receipt.createdAt)}</Fact>
              <Fact label="Receiving note">{detail.receipt.note ?? 'No note recorded'}</Fact>
              <Fact label="Recorded lines"><Count value={recordedCount} /></Fact>
            </dl>
          </section>

          <section
            aria-label="Associated shipment"
            className="rounded-instrument border border-subtle bg-surface-raised"
          >
            <div className="border-b border-subtle px-4 py-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
                Associated shipment
              </h2>
              <p className="mt-1 text-xs text-ink-secondary">
                A shipment records transport. A carrier reporting delivered does not establish that
                quantities were verified, that this receipt was submitted, or that inventory exists.
              </p>
            </div>
            <div className="px-4 py-3 text-sm text-ink">
              {detail.receipt.shipmentPublicId ? (
                <PublicId>
                  {shipmentSummary(
                    detail.shipments.find((s) => s.publicId === detail.receipt.shipmentPublicId) ?? {
                      publicId: detail.receipt.shipmentPublicId,
                      carrier: null, trackingNumber: null, status: 'unknown',
                      expectedAt: null, carrierReceivedAt: null,
                    },
                  )}
                </PublicId>
              ) : (
                <span className="text-ink-muted">
                  This receipt references no shipment record. That is a supported case, not a gap.
                </span>
              )}
            </div>
          </section>
        </>
      )}

      <DataTable
        caption="Expected acquisition quantities and observed receiving evidence"
        columns={columns}
        state={
          hasValue(truth) ? ready(lines) : (truth as unknown as TruthState<readonly ReceivingExpectedLine[]>)
        }
        rowKey={(line) => line.acquisitionLinePublicId}
        empty={{
          title: 'This receipt has no receivable acquisition lines.',
          description: 'The governed backend answered and returned no lines for this order.',
        }}
        onRetry={() => void query.refetch()}
        responsiveBreakpoint="lg"
        responsive={
          <ResponsiveRecordList
            label="Expected acquisition quantities and observed receiving evidence"
            state={
              hasValue(truth) ? ready(records) : (truth as unknown as TruthState<readonly ResponsiveRecord[]>)
            }
            empty={{ title: 'This receipt has no receivable acquisition lines.' }}
            onRetry={() => void query.refetch()}
            onRefresh={() => void query.refetch()}
          />
        }
      />

      {detail && canReceive && isOpen && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => { setOperation({ kind: 'submit' }); setFailure(null); }}>
            Submit receipt
          </Button>
          <Button
            variant="destructive"
            onClick={() => { setOperation({ kind: 'cancel' }); setReason(''); setFailure(null); }}
          >
            Cancel receiving session
          </Button>
        </div>
      )}

      {detail && !isOpen && (
        <Alert tone="information" title={`This receipt is ${detail.receipt.status}`}>
          {detail.receipt.status === 'submitted'
            ? 'Observed quantities are frozen and the receipt is awaiting review. It has not created inventory, and owner reconciliation has not run.'
            : detail.receipt.status === 'cancelled'
              ? 'This receiving session was abandoned. Its evidence is preserved as history and was not deleted, and it does not count toward what is currently held.'
              : 'This receipt has been reconciled by the owner and is a closed record.'}
        </Alert>
      )}

      {operation?.kind === 'record' && (
        <RecordLineDialog
          line={operation.line}
          open
          onCancel={close}
          pending={pending}
          error={failure}
          onConfirm={(input) =>
            void run(async () => {
              const result = await api.recordLine(workspace!.id, receiptPublicId, {
                sourceSystemPublicId: operation.line.sourceSystemPublicId,
                acquisitionLinePublicId: operation.line.acquisitionLinePublicId,
                quantityReceived: input.quantityReceived,
                note: input.note,
              });
              return result.replayed
                ? `That observation was already recorded as ${result.receiptLinePublicId}; it was not recorded twice.`
                : `Recorded ${result.quantityReceived} against ${operation.line.acquisitionLinePublicId}.`;
            })
          }
        />
      )}

      {operation?.kind === 'correct' && (
        <MutationConfirmation
          open
          onCancel={close}
          title="Correct the observed quantity"
          consequence={
            'This replaces the observed quantity on this receipt line and records your reason as governed '
            + 'history. It does not change the acquisition\'s expected quantity, and it does not create a discrepancy.'
          }
          objectFacts={
            <dl className="grid gap-2 sm:grid-cols-2">
              <Fact label="Receipt line">
                <PublicId>{operation.line.observed?.receiptLinePublicId}</PublicId>
              </Fact>
              <Fact label="Acquisition line">
                <PublicId>{operation.line.acquisitionLinePublicId}</PublicId>
              </Fact>
              <Fact label="Expected quantity">
                <Count value={operation.line.expectedQuantity} />
              </Fact>
              <Fact label="Currently observed">
                <Count value={operation.line.observed?.quantityReceived ?? 0} />
              </Fact>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium uppercase tracking-wide text-ink-secondary" htmlFor="corrected-quantity">
                  Corrected observed quantity
                </label>
                <input
                  id="corrected-quantity"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={desired}
                  onChange={(event) => setDesired(event.target.value)}
                  className="mt-1 w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm tabular-nums text-ink"
                />
              </div>
            </dl>
          }
          reason={{
            value: reason,
            onChange: setReason,
            label: 'Why is this being corrected?',
            description: 'Required. Recorded as governed history against this receipt line.',
            required: true,
            minLength: 1,
            maxLength: 500,
            multiline: true,
          }}
          confirmLabel="Correct observed quantity"
          pendingLabel="Correct observed quantity"
          confirmDisabled={
            reason.trim().length === 0
            || !Number.isSafeInteger(Number(desired))
            || Number(desired) <= 0
          }
          pending={pending}
          error={failure}
          onConfirm={() =>
            void run(async () => {
              const result = await api.correctLine(
                workspace!.id,
                operation.line.observed!.receiptLinePublicId,
                {
                  // The compare-and-set value is the one the operator was
                  // LOOKING AT. If the database has moved since, it refuses.
                  expectedQuantity: operation.line.observed!.quantityReceived,
                  desiredQuantity: Number(desired),
                  reason: reason.trim(),
                },
              );
              return result.replayed
                ? 'That correction had already been applied; it was not applied twice.'
                : `Corrected the observed quantity to ${result.quantityReceived}.`;
            })
          }
        />
      )}

      {operation?.kind === 'cancel' && detail && (
        <MutationConfirmation
          open
          onCancel={close}
          title="Cancel this receiving session"
          consequence={
            'This abandons the open receiving session. The evidence already recorded on it is PRESERVED as '
            + 'history and is not deleted, but it stops counting toward what is currently held, and the '
            + 'receipt becomes a closed record that can no longer be changed or submitted.'
          }
          objectFacts={
            <dl className="grid gap-2 sm:grid-cols-2">
              <Fact label="Receipt"><PublicId>{detail.receipt.publicId}</PublicId></Fact>
              <Fact label="Acquisition order"><PublicId>{detail.order.publicId}</PublicId></Fact>
              <Fact label="Recorded lines"><Count value={recordedCount} /></Fact>
              <Fact label="Goods arrived">
                {instant(detail.receipt.receivedAt, UNKNOWN.receivedAt)}
              </Fact>
            </dl>
          }
          reason={{
            value: reason,
            onChange: setReason,
            label: 'Why is this session being cancelled?',
            description: 'Required. Recorded as governed history against this receipt.',
            required: true,
            minLength: 1,
            maxLength: 500,
            multiline: true,
          }}
          confirmLabel="Cancel receiving session"
          pendingLabel="Cancel receiving session"
          cancelLabel="Keep receiving"
          confirmVariant="destructive"
          confirmDisabled={reason.trim().length === 0}
          pending={pending}
          error={failure}
          onConfirm={() =>
            void run(async () => {
              const result = await api.cancelReceipt(workspace!.id, receiptPublicId, reason.trim());
              return result.replayed
                ? 'This receiving session was already cancelled; it was not cancelled twice.'
                : 'Cancelled the receiving session. Its recorded evidence is preserved as history.';
            })
          }
        />
      )}

      {operation?.kind === 'submit' && detail && (
        <SubmitReceiptDialog
          detail={detail}
          open
          onCancel={close}
          pending={pending}
          error={failure}
          onConfirm={() =>
            void run(async () => {
              const result = await api.submitReceipt(workspace!.id, receiptPublicId);
              return result.replayed
                ? 'This receipt had already been submitted; it was not submitted twice.'
                : 'Submitted the receipt. Observed quantities are frozen and it is awaiting review. No inventory was created.';
            })
          }
        />
      )}
    </div>
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
