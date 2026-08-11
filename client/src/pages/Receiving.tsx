// The governed Receiving landing page — S2.3 Batch 1.
//
// A FIXED OPERATIONAL WORKFLOW, not a customizable Workbench. Receiving is done
// standing at a table with a box open; the layout is the same every time on
// purpose, because an operator should not have to find the controls.
//
// It answers, in order: what acquisitions can I receive, which receiving
// sessions are open, what has been submitted, what has been reconciled, and
// what was abandoned.
//
// WHAT IT DELIBERATELY DOES NOT CLAIM
//
// There is no "needs receiving" count. Nothing in the governed contract
// establishes that a delivery is expected — an order can be short-shipped,
// partially delivered on purpose, or cancelled at the source — so a number
// derived from "expected exceeds observed" would be a guess wearing the clothes
// of a fact. The page states receipt-lifecycle counts, which the database
// proved, and the expected/observed totals side by side so the operator can
// draw their own conclusion.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  CoverageNotice,
  DataTable,
  ResponsiveRecordList,
  hasValue,
  ready,
  type TruthState,
} from '../design-system';
import {
  createReceivingTransport,
  mintIdempotencyKey,
  receivingQueueKey,
  type DiscrepancyKind,
  type ReceivingQueueRow,
} from '../lib/receivingApi';
import { useWorkspace } from '../lib/workspaceContext';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { RECEIVING_COVERAGE, queueState } from './receiving/receivingTruth';
import { queueColumns, queueRecords, receiptPath } from './receiving/receivingPresentation';
import { OpenReceiptDialog } from './receiving/OpenReceiptDialog';
import { RaiseDiscrepancyDialog } from './receiving/RaiseDiscrepancyDialog';
import { mutationMessage } from './receiving/mutationMessages';

export default function Receiving() {
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

  const enabled = Boolean(workspace);
  const queue = useQuery({
    queryKey: receivingQueueKey(workspace?.id),
    queryFn: () => api.queue(workspace!.id),
    enabled,
  });

  const rowsTruth = queueState(queue, enabled);
  const rows = hasValue(rowsTruth) ? rowsTruth.value : [];

  // Capability comes from the SERVER's answer about this caller, never from a
  // client-side guess. Absent an answer, no mutation control is offered.
  const role = queue.data?.role ?? null;
  const canReceive = role === 'owner' || role === 'operator';

  const [opening, setOpening] = useState<ReceivingQueueRow | null>(null);
  /**
   * Reporting that NOTHING arrived.
   *
   * `never_arrived` is raised from the ORDER, with no receipt at all. Opening a
   * receipt merely to report an absence would record an arrival that did not
   * happen, so this path deliberately never creates one.
   */
  const [reporting, setReporting] = useState<ReceivingQueueRow | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [outcome, setOutcome] = useState<string>('');

  // Minted once per confirmed intent, and REUSED if the same confirmation is
  // retried. A key minted per attempt would make every retry a new receiving
  // session, which is the exact duplicate the key exists to prevent.
  const [operationKey, setOperationKey] = useState<string | null>(null);

  const startOpening = (order: ReceivingQueueRow) => {
    setOpening(order);
    setFailure(null);
    setOperationKey(mintIdempotencyKey());
  };

  const confirmOpen = async (input: {
    shipmentPublicId: string | null;
    receivedAt: string;
    note: string | null;
  }) => {
    if (!opening || !workspace || !operationKey) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await api.openReceipt(workspace.id, opening.orderPublicId, {
        ...input,
        idempotencyKey: operationKey,
      });
      setOpening(null);
      setOperationKey(null);
      setOutcome(
        result.replayed
          ? `Receiving session ${result.receiptPublicId} was already open for this order; it was not opened twice.`
          : `Opened receiving session ${result.receiptPublicId}.`,
      );
      // Authoritative refresh. Nothing about the new receipt is assumed.
      await queryClient.invalidateQueries({ queryKey: receivingQueueKey(workspace.id) });
    } catch (error) {
      setFailure(mutationMessage(error));
    } finally {
      setPending(false);
    }
  };

  // One action definition, rendered by both the table and the record list, so
  // a phone and a desktop cannot offer different receiving capabilities.
  const reportAction = (row: ReceivingQueueRow) =>
    canReceive ? (
      <Button
        variant="secondary"
        size="small"
        onClick={() => { setReporting(row); setFailure(null); }}
      >
        Nothing arrived
      </Button>
    ) : null;

  const rowAction = (row: ReceivingQueueRow) => {
    if (!canReceive) return null;
    return row.openReceiptPublicId ? (
      <Link
        className="inline-flex min-h-11 items-center rounded-control border border-strong px-3 text-sm text-ink underline-offset-2 hover:bg-surface-inset"
        to={receiptPath(row.openReceiptPublicId)}
      >
        Continue receiving
      </Link>
    ) : (
      <Button variant="secondary" size="small" onClick={() => startOpening(row)}>
        Open receipt
      </Button>
    );
  };

  /**
   * Record an order-level discrepancy.
   *
   * The landing page holds no authoritative discrepancy list to verify against,
   * so a failure here reports the unknown outcome plainly and sends the
   * operator to the governed record rather than offering a retry that could
   * duplicate durable evidence.
   */
  const reportNothingArrived = async (intent: {
    readonly kind: DiscrepancyKind;
    readonly detail: string;
    readonly quantityExpected: number | null;
    readonly quantityObserved: number | null;
  }) => {
    if (!reporting || !workspace) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await api.raiseDiscrepancy(workspace.id, reporting.orderPublicId, {
        receiptPublicId: null,
        receiptLinePublicId: null,
        kind: intent.kind,
        quantityExpected: intent.quantityExpected,
        quantityObserved: intent.quantityObserved,
        detail: intent.detail,
      });
      setReporting(null);
      setOutcome(
        `Recorded discrepancy ${result.discrepancyPublicId} against ${reporting.orderPublicId}. `
        + 'No receipt was created, because nothing arrived.',
      );
      await queryClient.invalidateQueries({ queryKey: receivingQueueKey(workspace.id) });
    } catch (error) {
      // Recording a discrepancy has no governed replay, so this does NOT offer
      // a retry. It says the outcome is unknown and where to check.
      setFailure({
        code: mutationMessage(error).code,
        message:
          'The discrepancy request did not return a usable answer, so whether it was recorded is unknown. '
          + 'Recording a discrepancy has no governed replay, so trying again could create a second record '
          + 'of the same problem. Open the acquisition order to see what is on record before reporting again.',
      });
    } finally {
      setPending(false);
    }
  };

  const columns = useMemo(
    () =>
      canReceive
        ? [
            ...queueColumns(),
            { key: 'action', header: 'Action', render: rowAction },
            { key: 'report', header: 'Report', render: reportAction },
          ]
        : queueColumns(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canReceive],
  );
  const records = useMemo(
    () => queueRecords(rows, (row) => (
      <div className="flex flex-wrap gap-2">{rowAction(row)}{reportAction(row)}</div>
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, canReceive],
  );

  // Counts are stated only from an answer that actually arrived. While the
  // queue is loading or failed there is no count, and the header says nothing
  // rather than saying zero.
  const counts = hasValue(rowsTruth)
    ? {
        orders: rows.length,
        open: rows.filter((row) => row.workflowState === 'receiving_in_progress').length,
        submitted: rows.filter((row) => row.workflowState === 'submitted_pending_review').length,
        reconciled: rows.filter((row) => row.workflowState === 'reconciled').length,
        cancelled: rows.filter((row) => row.workflowState === 'cancelled_only').length,
      }
    : null;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold text-ink">Receiving</h1>
        <p className="max-w-3xl text-sm text-ink-secondary">
          Record what physically arrived against a governed acquisition order. Receiving evidence is
          separate from the acquisition's expected quantities and from the carrier's transport status,
          and recording it here does not create inventory.
        </p>
        {counts ? (
          <p className="text-sm text-ink-secondary" data-receiving-counts>
            {counts.orders.toLocaleString()} receivable acquisition orders · {counts.open.toLocaleString()} open
            sessions · {counts.submitted.toLocaleString()} submitted · {counts.reconciled.toLocaleString()}{' '}
            reconciled · {counts.cancelled.toLocaleString()} last cancelled
          </p>
        ) : (
          <p className="text-sm text-ink-muted" data-receiving-counts>
            Receiving counts are unavailable until the governed queue can be read.
          </p>
        )}
        <CoverageNotice coverage={RECEIVING_COVERAGE} timeBasis="current" />
      </header>

      {outcome && (
        <Alert tone="success" title="Receiving session updated">
          {outcome}
        </Alert>
      )}

      {failure && !opening && (
        <Alert tone="critical" title="The governed receiving service refused this request">
          {failure.message}
        </Alert>
      )}

      <DataTable
        caption="Governed acquisition orders and their receiving sessions"
        columns={columns}
        state={rowsTruth}
        rowKey={(row) => row.orderPublicId}
        empty={{
          title: 'There is no receiving work in this workspace.',
          description:
            'The governed backend answered and returned no acquisition orders that can be received.',
        }}
        onRetry={() => void queue.refetch()}
        // Seven columns is a sideways scroll on a tablet in portrait, so the
        // table hands over to records at `lg`, matching Acquisitions.
        responsiveBreakpoint="lg"
        responsive={
          <ResponsiveRecordList
            label="Governed acquisition orders and their receiving sessions"
            state={hasValue(rowsTruth) ? ready(records) : (rowsTruth as TruthState<never>)}
            empty={{ title: 'There is no receiving work in this workspace.' }}
            onRetry={() => void queue.refetch()}
            onRefresh={() => void queue.refetch()}
          />
        }
      />

      {reporting && (
        <RaiseDiscrepancyDialog
          orderPublicId={reporting.orderPublicId}
          // No receipt, deliberately. Nothing arrived, so no arrival exists.
          receiptPublicId={null}
          line={null}
          // Only the kinds that make sense with no receipt and no line.
          allowedKinds={['never_arrived', 'short_shipped']}
          open
          onCancel={() => { setReporting(null); setFailure(null); }}
          pending={pending}
          error={failure}
          onConfirm={(intent) => void reportNothingArrived(intent)}
        />
      )}

      {opening && (
        <OpenReceiptDialog
          order={opening}
          open
          onCancel={() => {
            setOpening(null);
            setOperationKey(null);
            setFailure(null);
          }}
          onConfirm={(input) => void confirmOpen(input)}
          pending={pending}
          error={failure}
        />
      )}
    </div>
  );
}
