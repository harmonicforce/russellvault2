import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  Alert,
  CoverageNotice,
  DependencyState,
  EmptyState,
  LoadingState,
  StaleState,
  StatusPill,
  hasValue,
  isIndeterminate,
} from '../design-system';
import {
  AcquisitionDetailError,
  acquisitionDetailKey,
  createAcquisitionDetailTransport,
  type AcquisitionDetail as Detail,
  type Role,
} from '../lib/acquisitionDetailApi';
import { useWorkspace } from '../lib/workspaceContext';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { ACQUISITION_COVERAGE, detailState } from './acquisition-detail/detailTruth';
import { PublicId, headlineTitle } from './acquisition-detail/detailPresentation';
import { useGovernedOperation } from './acquisition-detail/operationModel';
import { OperationRecovery } from './acquisition-detail/OperationRecovery';
import { AcquisitionOverview } from './acquisition-detail/AcquisitionOverview';
import { ClassificationPanel } from './acquisition-detail/ClassificationPanel';
import { EligibilityPanel } from './acquisition-detail/EligibilityPanel';
import { PaymentsPanel } from './acquisition-detail/PaymentsPanel';
import { ShipmentsPanel } from './acquisition-detail/ShipmentsPanel';
import { SourceEvidencePanel } from './acquisition-detail/SourceEvidencePanel';

/**
 * The governed acquisition detail — the canonical transactional reference.
 *
 * THIS SURFACE IS FIXED, AND THAT IS A DESIGN DECISION, NOT AN OMISSION.
 *
 * There is no Customize control, no widget, no drag handle, no layout store and
 * no Workbench embedding here, and none should be added. An operator may
 * customise their PERSPECTIVE — which is what the Workbench is for — but never
 * the structure of a consequential transaction. A payment form the operator
 * could move, resize, or accidentally remove is a payment form whose absence
 * looks the same as a payment that was never owed.
 *
 * The page composes; the panels own their domains; the transport and the
 * governed semantics live in exactly one place each.
 */

/**
 * Where "Back to acquisitions" actually goes.
 *
 * S1.6.5 made the acquisitions list URL the canonical carrier of list state, so
 * returning to the operator's EXACT filtered, sorted, paged list is a real
 * capability rather than a courtesy. It is honoured only when the router handed
 * us an in-app acquisitions URL: a `from` that is anything else is not
 * repaired, rewritten or guessed at — it falls back to the plain list, because
 * a manufactured return URL is a fabricated fact about where the operator was.
 */
export function returnTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  if (typeof from !== 'string') return '/acquisitions';
  if (from !== '/acquisitions' && !from.startsWith('/acquisitions?')) return '/acquisitions';
  return from;
}

export default function AcquisitionDetail() {
  const { sourceSystemPublicId = '', linePublicId = '' } = useParams();
  const location = useLocation();
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();

  const api = useMemo(
    () =>
      createAcquisitionDetailTransport(
        tokenProviderFromClient(createShadowClient(import.meta.env as unknown as Record<string, string | undefined>)),
      ),
    [],
  );

  // Source-qualified in the key as well as in the request: an acquisition line
  // public ID is unique only WITHIN its source system, so a cache keyed on the
  // line alone would serve one source's record for another's address.
  const query = useQuery({
    queryKey: acquisitionDetailKey(workspace?.id ?? '', sourceSystemPublicId, linePublicId),
    queryFn: () => api.detail(workspace!.id, sourceSystemPublicId, linePublicId),
    enabled: Boolean(workspace && sourceSystemPublicId && linePublicId),
    placeholderData: undefined,
  });

  /**
   * Re-read the authoritative record, and report whether that actually worked.
   *
   * The boolean is load-bearing. A refresh that failed silently would leave the
   * page showing a pre-mutation record while telling the operator it had been
   * refreshed, and it would let the recovery flow unlock consequential work on
   * a state nobody has confirmed.
   */
  const refresh = async (): Promise<boolean> => {
    try {
      const [detailResult] = await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ['acquisition-lines', workspace?.id] }),
        queryClient.invalidateQueries({ queryKey: ['acquisition-facets', workspace?.id] }),
      ]);
      return !detailResult.isError && detailResult.data !== undefined;
    } catch {
      return false;
    }
  };

  const action = useGovernedOperation({
    run: async (operation) => {
      if (!workspace || !query.data) throw new AcquisitionDetailError('invalid_request', 400);
      const body = { ...operation.payload, idempotencyKey: operation.idempotencyKey };

      switch (operation.kind) {
        case 'payment':
          return api.recordPayment(workspace.id, operation.target, body);
        case 'reverse':
          return api.reversePayment(
            workspace.id,
            operation.target,
            String(operation.payload.reason),
            operation.idempotencyKey,
          );
        case 'shipment':
          return api.createShipment(workspace.id, operation.target, body);
        case 'exclude':
          return api.exclude(
            workspace.id,
            String(operation.source),
            operation.target,
            String(operation.payload.reason),
            operation.idempotencyKey,
          );
        case 'restore':
          return api.restore(
            workspace.id,
            String(operation.source),
            operation.target,
            String(operation.payload.reason),
            operation.idempotencyKey,
          );
        case 'transition':
          return api.transitionShipment(workspace.id, operation.target, body);
      }
    },
    refresh,
  });

  const truth = detailState(query, Boolean(workspace));
  const back = returnTarget(location.state);

  const shell = (children: React.ReactNode, detail?: Detail) => (
    <main className="mx-auto grid max-w-[110rem] gap-4 p-4 md:p-6">
      <nav>
        <Link
          to={back}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent-strong underline underline-offset-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to acquisitions
        </Link>
      </nav>
      {detail && <PageHeader detail={detail} />}
      {children}
    </main>
  );

  if (truth.kind === 'loading') {
    return shell(<LoadingState label="Loading governed acquisition detail…" />);
  }

  if (truth.kind === 'empty') {
    // A 404 is an authoritative answer, not a failure: the governed backend
    // looked and there is no such line. It reads differently from "we could not
    // find out" on purpose, because only one of them is worth retrying.
    return shell(
      <EmptyState
        title="Acquisition line not found"
        description={`No governed acquisition line is recorded at ${sourceSystemPublicId} / ${linePublicId} in this workspace.`}
      />,
    );
  }

  if (isIndeterminate(truth)) {
    return shell(
      <DependencyState
        state={truth}
        // A retry re-reads the SAME source-qualified address. It is not offered
        // for `unauthorized`, where repeating the request cannot change the
        // answer.
        onRetry={() => void query.refetch()}
        retryLabel="Try again"
      />,
    );
  }

  if (!hasValue(truth) || !workspace) return null;
  const detail = truth.value;
  const role = workspace.role as Role;

  return shell(
    <>
      {truth.kind === 'stale' && (
        <StaleState
          label={truth.label}
          lastRefreshedAt={truth.lastRefreshedAt}
          canRefresh={truth.canRefresh}
          onRefresh={() => void query.refetch()}
        />
      )}

      {/* Exactly one region speaks about mutation outcomes. While an operation
          is unresolved the recovery notice IS the message, so the operator is
          never reading two different accounts of the same request. */}
      {action.failed ? (
        <OperationRecovery
          failed={action.failed}
          message={action.message}
          pending={action.pending}
          verifying={action.verifying}
          onRetry={action.retry}
          onStopRetrying={action.stopRetrying}
        />
      ) : (
        action.outcome && (
          <Alert tone={action.outcome.tone}>
            <p>{action.outcome.text}</p>
          </Alert>
        )
      )}

      <section aria-label="Governed coverage" className="grid gap-2">
        <CoverageNotice coverage={ACQUISITION_COVERAGE} timeBasis="current" />
        <p className="text-xs text-ink-muted">
          Governed and legacy counts or totals must not be added together. Recorded payments may be incomplete before
          reconciliation. Source evidence is retained separately, and nothing on this page implies that record-level
          historical reconciliation has been performed.
        </p>
      </section>

      <AcquisitionOverview detail={detail} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ClassificationPanel
          detail={detail}
          role={role}
          classify={async () => {
            await api.classify(workspace.id, sourceSystemPublicId, linePublicId);
            await refresh();
          }}
          override={async (optionKey, reason) => {
            await api.override(workspace.id, sourceSystemPublicId, linePublicId, optionKey, reason);
            await refresh();
          }}
        />

        <EligibilityPanel
          detail={detail}
          role={role}
          // THIS panel's own pending state, never an unrelated payment's.
          pending={action.pendingKind === 'exclude' || action.pendingKind === 'restore'}
          locked={action.locked}
          succeeded={action.succeeded}
          submit={action.submit}
        />
      </div>

      <PaymentsPanel detail={detail} role={role} pending={action.pending} locked={action.locked} submit={action.submit} />

      <ShipmentsPanel detail={detail} role={role} pending={action.pending} locked={action.locked} submit={action.submit} />

      <SourceEvidencePanel detail={detail} />
    </>,
    detail,
  );
}

/**
 * The strongest identity this line has, and the status an operator needs before
 * reading anything else.
 *
 * Deliberately not a marketing header: one line of identity, one line of
 * addressing, and the two statuses that change what the rest of the page means.
 */
function PageHeader({ detail }: { readonly detail: Detail }) {
  const excluded = detail.exclusion?.state === 'excluded';

  return (
    <header className="grid gap-2">
      <h1 className="font-display text-2xl font-semibold text-ink md:text-3xl">
        {headlineTitle(detail.line)}
      </h1>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <PublicId>{detail.identity.sourceSystemPublicId}</PublicId>
        <span aria-hidden="true" className="text-ink-muted">
          /
        </span>
        <PublicId>{detail.identity.linePublicId}</PublicId>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={detail.classification ? 'information' : 'neutral'}>
          {detail.classification?.optionLabel ?? 'Unclassified'}
        </StatusPill>
        {/* Only rendered when it is true, and phrased in full so it can never be
            confused with the eligibility panel's own current-state marker. */}
        {excluded && <StatusPill tone="serious">Excluded from downstream workflows</StatusPill>}
      </div>
    </header>
  );
}
