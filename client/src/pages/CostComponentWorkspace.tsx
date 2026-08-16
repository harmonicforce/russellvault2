// One governed cost component, and everything that can be done to it — S2.5
// Batch 1.
//
// THE THREE FACTS THIS PAGE KEEPS APART, ALWAYS
//
//   THE AMOUNT      What the source charged. Never recomputed here, never
//                   adjusted to make a split come out even, and never shown as
//                   zero when it was never reported.
//   THE PROPOSAL    Durable `candidate` rows. Real, reviewable, and NOT a cost
//                   basis. The page says so in words every time it shows them.
//   THE BASIS       Confirmed rows. Only `confirm_cost_allocation` creates
//                   these, and only after the database has independently
//                   verified conservation.
//
// A UI that let those three blur together would let an owner believe a cost had
// been attributed when only a proposal existed — which is exactly the moment
// inventory gets priced against a basis that was never established.
//
// THE RECOVERY MODEL
//
// Proposing is the one operation with no governed replay AND no way to undo a
// partial success. `cost/proposalCreation.ts` owns that logic; this page
// supplies the authoritative re-read and renders what it decided.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  CoverageNotice,
  DependencyState,
  EmptyState,
  LoadingState,
  isIndeterminate,
  MutationConfirmation,
  hasValue,
} from '../design-system';
import {
  costComponentKey,
  createCostTransport,
  type AllocationMethod,
  type AllocationPreview,
  type BasisRecomputeOutcome,
  type CostComponentDetail,
} from '../lib/costApi';
import { useWorkspace } from '../lib/workspaceContext';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { COST_COVERAGE, costComponentState } from './cost/costTruth';
import { costMessage } from './cost/costMessages';
import {
  AllocationStatePill,
  AmountValue,
  ALLOCATION_STATE_DESCRIPTION,
  ComponentTypePill,
  Count,
  MinorAmount,
  PublicId,
  UNKNOWN,
  WORKFLOW_DESCRIPTION,
  WorkflowPill,
  instant,
  methodLabel,
  scopeText,
} from './cost/costPresentation';
import { AllocationEditor } from './cost/AllocationEditor';
import { BasisImpactPanel } from './cost/BasisImpactPanel';
import {
  beginSubmit,
  beginVerify,
  outcomeUnknown,
  proposalAllowed,
  proposalMessage,
  submitFailed,
  verificationFailed,
  verify,
  type ProposalIntent,
  type ProposalPhase,
} from './cost/proposalCreation';
import { toMinor } from './cost/costMoney';
import {
  beginSubmit as beginWithdrawSubmit,
  beginVerify as beginWithdrawVerify,
  candidateIdentities,
  outcomeUnknown as withdrawalOutcomeUnknown,
  submitFailed as withdrawSubmitFailed,
  verificationFailed as withdrawVerificationFailed,
  verify as verifyWithdrawal,
  withdrawalAllowed,
  withdrawalMessage,
  type WithdrawalIntent,
  type WithdrawalPhase,
} from './cost/withdrawalCreation';

export default function CostComponentWorkspace() {
  const { componentPublicId = '' } = useParams();
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();

  const api = useMemo(
    () =>
      createCostTransport(
        tokenProviderFromClient(
          createShadowClient(import.meta.env as unknown as Record<string, string | undefined>),
        ),
      ),
    [],
  );

  const enabled = Boolean(workspace) && componentPublicId !== '';
  const query = useQuery({
    queryKey: costComponentKey(workspace?.id, componentPublicId),
    queryFn: () => api.component(workspace!.id, componentPublicId),
    enabled,
  });

  const truth = costComponentState(query, enabled);
  const view = hasValue(truth) ? truth.value : null;
  const component = view?.component ?? null;

  // Capability comes from the SERVER's answer about this caller, never from a
  // client-side guess. Absent an answer, no mutation control is offered.
  const role = view?.role ?? null;
  const canAllocate = role === 'owner' || role === 'operator';

  const [editorOpen, setEditorOpen] = useState(false);
  const [preview, setPreview] = useState<AllocationPreview | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [outcome, setOutcome] = useState('');
  const [proposal, setProposal] = useState<ProposalPhase>({ phase: 'idle' });

  const [confirming, setConfirming] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reversalReason, setReversalReason] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState('');
  const [withdrawal, setWithdrawal] = useState<WithdrawalPhase>({ phase: 'idle' });
  /**
   * How the derived basis refresh went, kept SEPARATE from `outcome`.
   *
   * The allocation change and the basis refresh are two governed operations,
   * and the whole point is that the second one failing does not make the first
   * one a failure. Two pieces of state, two sentences, never one blended claim.
   */
  const [basisRecompute, setBasisRecompute] = useState<BasisRecomputeOutcome | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: costComponentKey(workspace?.id, componentPublicId) });

  // --- proposing ------------------------------------------------------------

  const runPreview = async (input: {
    method: AllocationMethod;
    lines: readonly { sourceSystemPublicId: string; acquisitionLinePublicId: string }[];
  }) => {
    if (!workspace) return;
    setPreviewPending(true);
    setFailure(null);
    try {
      setPreview(await api.previewAllocation(workspace.id, componentPublicId, input));
    } catch (error) {
      setPreview(null);
      setFailure(costMessage(error));
    } finally {
      setPreviewPending(false);
    }
  };

  const confirmProposal = async (input: {
    method: AllocationMethod;
    allocations: readonly {
      sourceSystemPublicId: string;
      acquisitionLinePublicId: string;
      amountMinor: string;
    }[];
  }) => {
    if (!workspace) return;
    const intent: ProposalIntent = {
      componentPublicId,
      method: input.method,
      lines: input.allocations,
    };
    setProposal(beginSubmit(intent));
    setPending(true);
    setFailure(null);
    try {
      const result = await api.propose(workspace.id, componentPublicId, input);
      setProposal({ phase: 'idle' });
      setEditorOpen(false);
      setPreview(null);
      setOutcome(
        `A split of ${result.proposed} lines was proposed for ${result.componentPublicId}. It is `
        + 'recorded and reviewable, and it is NOT yet a cost basis — confirming it is what makes it '
        + 'one.',
      );
      await refresh();
    } catch (error) {
      const message = costMessage(error);
      setFailure(message);
      // A refusal the DATABASE named is proof the request arrived and was
      // rejected, so nothing was written and the outcome is not unknown. Only a
      // response we cannot interpret leaves it genuinely undecided.
      const refused = provesRefusal(message.code);
      setProposal(refused ? { phase: 'idle' } : submitFailed(intent));

      // THE EDITOR CLOSES WHEN THE OUTCOME IS UNKNOWN, and stays open when the
      // contract refused.
      //
      // A refusal is something the owner can fix in place — adjust the amounts,
      // pick another method — so the dialog they are working in stays put.
      //
      // An unknown outcome is not fixable in place. Proposing is locked, so the
      // dialog has nothing left to do, and the only action available is the
      // verification in the recovery banner underneath it. Leaving a modal open
      // over the one control that matters would trap the owner in front of a
      // dialog whose primary button can never succeed. The browser gate caught
      // exactly that: the click landed on the dialog's backdrop, every time.
      if (!refused) {
        setEditorOpen(false);
        setPreview(null);
      }
    } finally {
      setPending(false);
    }
  };

  const runVerification = async () => {
    if (!workspace) return;
    const verifying = beginVerify(proposal);
    setProposal(verifying);
    try {
      const fresh = await api.component(workspace.id, componentPublicId);
      queryClient.setQueryData(costComponentKey(workspace.id, componentPublicId), fresh);
      setProposal(verify(verifying, fresh.component));
    } catch {
      // A failed verification is NOT an absence. Proposing stays locked.
      setProposal(verificationFailed(verifying));
    }
  };

  // --- confirming and reversing --------------------------------------------

  /**
   * The total sent to `confirm_cost_allocation` is the one on THIS SCREEN.
   *
   * The governed function treats it as a count contract: it refuses if the
   * candidates do not sum to it. Recomputing it from a fresh read would make
   * the contract check itself and always pass, which would defeat the entire
   * point of having one.
   */
  const displayedCandidateTotal = component?.candidateTotalMinor ?? '';

  const runConfirm = async () => {
    if (!workspace) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await api.confirm(workspace.id, componentPublicId, displayedCandidateTotal);
      setConfirming(false);
      setOutcome(
        `${result.confirmed} allocations were confirmed for ${result.componentPublicId}. These amounts `
        + 'are now the governed cost basis for the lines they name.',
      );
      setBasisRecompute(result.basisRecompute);
      await refresh();
    } catch (error) {
      setFailure(costMessage(error));
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const runReverse = async () => {
    if (!workspace || reversalReason.trim() === '') return;
    setPending(true);
    setFailure(null);
    try {
      const result = await api.reverse(workspace.id, componentPublicId, reversalReason.trim());
      setReversing(false);
      setReversalReason('');
      setOutcome(
        `${result.reversed} confirmed allocations were reversed for ${result.componentPublicId}. The `
        + 'rows were kept as history with their original review attribution; nothing was deleted, and '
        + 'the component is unresolved again.',
      );
      setBasisRecompute(result.basisRecompute);
      await refresh();
    } catch (error) {
      setFailure(costMessage(error));
    } finally {
      setPending(false);
    }
  };

  // --- withdrawing ----------------------------------------------------------

  /**
   * Withdraw the pending proposal.
   *
   * The intent retains the EXACT allocation identities on screen, because
   * `confirm` and `withdraw` both empty the candidate set and only the
   * per-row outcome can tell them apart afterwards.
   */
  const runWithdraw = async () => {
    if (!workspace || !component || withdrawalReason.trim() === '') return;
    const intent: WithdrawalIntent = {
      componentPublicId,
      candidatePublicIds: candidateIdentities(component),
      reason: withdrawalReason.trim(),
    };
    setWithdrawal(beginWithdrawSubmit(intent));
    setPending(true);
    setFailure(null);
    try {
      const result = await api.withdraw(workspace.id, componentPublicId, intent.reason);
      setWithdrawal({ phase: 'idle' });
      setWithdrawing(false);
      setWithdrawalReason('');
      setOutcome(
        `${result.withdrawn} proposed allocations were withdrawn for ${result.componentPublicId}. They `
        + 'were NOT deleted — the amounts and method remain on record as history — and a corrected '
        + 'split can now be proposed.',
      );
      setBasisRecompute(result.basisRecompute);
      await refresh();
    } catch (error) {
      const message = costMessage(error);
      setFailure(message);
      const refused = provesRefusal(message.code);
      setWithdrawal(refused ? { phase: 'idle' } : withdrawSubmitFailed(intent));
      if (!refused) setWithdrawing(false);
      await refresh();
    } finally {
      setPending(false);
    }
  };

  const runWithdrawalVerification = async () => {
    if (!workspace) return;
    const verifying = beginWithdrawVerify(withdrawal);
    setWithdrawal(verifying);
    try {
      const fresh = await api.component(workspace.id, componentPublicId);
      queryClient.setQueryData(costComponentKey(workspace.id, componentPublicId), fresh);
      setWithdrawal(verifyWithdrawal(verifying, fresh.component));
    } catch {
      // A failed verification is NOT an absence. Withdrawing stays locked.
      setWithdrawal(withdrawVerificationFailed(verifying));
    }
  };

  // --- rendering ------------------------------------------------------------

  if (truth.kind === 'loading') {
    return <LoadingState label="Reading the governed cost component…" />;
  }
  if (truth.kind === 'empty') {
    return (
      <EmptyState
        title="No such cost component"
        description={
          'The governed record contains no cost component with this identity in this workspace. This is '
          + 'an answer from the database, not a failure to look.'
        }
      />
    );
  }
  if (!component) {
    /*
     * Narrowed by the TYPE, not by a cast.
     *
     * An earlier version asserted `truth as Exclude<typeof truth, {kind:'ready'}>`,
     * which is unsound: `partial` and `stale` both carry a value and are not
     * indeterminate, so the assertion would have handed `DependencyState` a
     * state it cannot describe. `isIndeterminate` is the design system's own
     * predicate and narrows honestly; anything else reaching here has no value
     * and no failure to report, which only `loading` can be — and that is
     * already handled above.
     */
    if (isIndeterminate(truth)) {
      return <DependencyState state={truth} onRetry={() => void refresh()} />;
    }
    return <LoadingState label="Reading the governed cost component…" />;
  }

  const candidates = component.allocations.filter((row) => row.state === 'candidate');
  const confirmed = component.allocations.filter((row) => row.state === 'confirmed');
  const canPropose = canAllocate
    && component.workflowState === 'awaiting_proposal'
    && proposalAllowed(proposal);
  const canConfirm = canAllocate
    && component.workflowState === 'proposed_awaiting_confirmation'
    && toMinor(displayedCandidateTotal) !== null;
  const withdrawnRows = component.allocations.filter((row) => row.state === 'withdrawn');
  const canReverse = canAllocate && component.workflowState === 'allocated';
  const canWithdraw = canAllocate
    && component.workflowState === 'proposed_awaiting_confirmation'
    && withdrawalAllowed(withdrawal);

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <nav aria-label="Breadcrumb">
        <Link className="text-sm underline" to="/cost">← All cost components</Link>
      </nav>

      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ComponentTypePill type={component.componentType} />
          <WorkflowPill state={component.workflowState} />
          <PublicId>{component.componentPublicId}</PublicId>
        </div>
        <h1 className="font-display text-xl font-semibold text-ink">
          <AmountValue amount={component.amount} />
        </h1>
        <p className="max-w-prose text-sm text-ink-secondary">
          {WORKFLOW_DESCRIPTION[component.workflowState]}
        </p>
      </header>

      <CoverageNotice coverage={COST_COVERAGE} />

      {truth.kind === 'stale' && (
        <Alert tone="warning" title="This may no longer be current">
          {truth.label}{' '}
          <Button variant="secondary" size="small" onClick={() => refresh()}>Re-read</Button>
        </Alert>
      )}

      {outcome && (
        <Alert tone="success" title="Recorded">{outcome}</Alert>
      )}

      {/*
        THE DERIVED BASIS REFRESH, REPORTED AS ITS OWN OPERATION.

        Deliberately a SEPARATE alert from `outcome` above. The allocation
        change and the basis refresh are two governed operations against two
        different tables, and the second one failing does not retract the first.
        Blending them into one sentence is exactly how an owner ends up being
        told their allocation failed when it did not — and then retrying it, and
        being refused, and concluding nothing ever happened.
      */}
      {basisRecompute && (
        <Alert
          tone={basisRecompute.status === 'failed' ? 'warning' : 'information'}
          title={
            basisRecompute.status === 'failed'
              ? 'The allocation change is recorded; the derived basis was not refreshed'
              : 'Derived inventory cost basis'
          }
        >
          {basisRecompute.status === 'failed' ? (
            <>
              The allocation change above IS recorded in the governed record. What did not happen is
              the recompute of the derived inventory cost basis, so the basis shown below may not yet
              reflect it. Retrying is safe — the governed recompute is deterministic and does nothing
              when its inputs have not changed.{' '}
              <span className="font-mono text-xs">({basisRecompute.code})</span>
            </>
          ) : basisRecompute.status === 'refreshed' ? (
            <>
              The derived inventory cost basis was recomputed by algorithm{' '}
              {basisRecompute.algorithmVersion} and now covers {basisRecompute.basisRows} basis rows.
            </>
          ) : (
            <>
              The governed inputs to the cost basis had not changed, so the existing derivation
              (algorithm {basisRecompute.algorithmVersion}, {basisRecompute.basisRows} basis rows)
              still stands. Nothing needed recomputing.
            </>
          )}
        </Alert>
      )}

      {/*
        A refusal is shown where the action was taken, and in exactly one place.
        While the split editor is open it owns the message — repeating it on the
        page behind the modal would put the same sentence on screen twice and
        leave a stale copy sitting there after the dialog closes.

        It is also suppressed while a proposal's outcome is unknown: the
        recovery banner below says the same thing and says more, and two alerts
        making overlapping claims about one event is how an operator ends up
        reading the weaker one.
      */}
      {failure && !editorOpen && !outcomeUnknown(proposal) && !withdrawalOutcomeUnknown(withdrawal) && (
        <Alert tone="critical" title="The governed cost contract refused this">
          {failure.message} <span className="font-mono text-xs">({failure.code})</span>
        </Alert>
      )}

      {/*
        The verify-first recovery banner. It appears the moment an outcome
        becomes unknown and stays until the governed record answers.
      */}
      {proposal.phase !== 'idle' && proposal.phase !== 'submitting' && (
        <Alert
          tone={proposal.phase === 'absent' ? 'information' : 'critical'}
          title={PROPOSAL_TITLE[proposal.phase]}
        >
          <p>{proposalMessage(proposal)}</p>
          {(proposal.phase === 'unknown' || proposal.phase === 'unverified') && (
            <p className="mt-2">
              <Button variant="secondary" size="small" onClick={runVerification}>
                Check what is on record
              </Button>
            </p>
          )}
        </Alert>
      )}

      {/* The withdrawal recovery banner. Same discipline, different evidence. */}
      {withdrawal.phase !== 'idle' && withdrawal.phase !== 'submitting' && (
        <Alert
          tone={withdrawal.phase === 'absent' ? 'information' : 'critical'}
          title={WITHDRAWAL_TITLE[withdrawal.phase]}
        >
          <p>{withdrawalMessage(withdrawal)}</p>
          {(withdrawal.phase === 'unknown' || withdrawal.phase === 'unverified') && (
            <p className="mt-2">
              <Button variant="secondary" size="small" onClick={runWithdrawalVerification}>
                Check what is on record
              </Button>
            </p>
          )}
        </Alert>
      )}

      <section
        aria-label="Cost component facts"
        className="rounded-instrument border border-subtle bg-surface-raised px-4 py-3"
      >
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <Fact label="Applies to">{scopeText(component)}</Fact>
          <Fact label="Acquisition order">
            {component.order
              ? `${component.order.publicId} — ${component.order.sourceOrderReference ?? UNKNOWN.reference}`
              : UNKNOWN.order}
          </Fact>
          <Fact label="Acquired">{instant(component.order?.occurredAt, UNKNOWN.occurred)}</Fact>
          <Fact label="Recorded">{instant(component.createdAt)}</Fact>
          <Fact label="Evidence note">{component.evidenceNote ?? UNKNOWN.note}</Fact>
          <Fact label="Allocation rows">
            <Count value={component.candidateCount} /> proposed,{' '}
            <Count value={component.confirmedCount} /> confirmed
          </Fact>
        </dl>
      </section>

      {/* --- the proposal, if there is one ----------------------------------- */}

      <section
        aria-label="Proposed split"
        className="rounded-instrument border border-subtle bg-surface-raised"
      >
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-subtle px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
              Proposed split
            </h2>
            <p className="mt-1 max-w-prose text-xs text-ink-secondary">
              A proposal is durable and reviewable, and it is NOT a cost basis. It can be confirmed,
              which makes it one, or withdrawn — a separate governed act with its own reason and audit
              trail. Withdrawing is not a deletion: the amounts stay on record as history below.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canPropose && (
              <Button
                variant="primary"
                size="small"
                onClick={() => { setEditorOpen(true); setPreview(null); setFailure(null); }}
                disabled={pending}
              >
                Propose a split
              </Button>
            )}
            {canWithdraw && (
              <Button
                variant="secondary"
                size="small"
                onClick={() => { setWithdrawing(true); setFailure(null); }}
                disabled={pending}
              >
                Withdraw this proposal
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 px-4 py-3">
          {candidates.length === 0 ? (
            <p className="text-sm text-ink-muted">
              The governed record contains no proposed split for this component.
            </p>
          ) : (
            <>
              <AllocationList
                rows={candidates}
                currency={component.amount.currency}
              />
              <div
                className="rounded-instrument border border-subtle bg-surface-inset px-3 py-2"
                data-candidate-total
              >
                <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
                  Proposed total
                </p>
                <p className="mt-0.5 text-sm text-ink">
                  {toMinor(component.candidateTotalMinor) === null ? (
                    'The proposed total could not be read exactly, so it is not shown.'
                  ) : (
                    <>
                      <MinorAmount
                        minor={component.candidateTotalMinor}
                        currency={component.amount.currency}
                      />
                      {' — '}
                      {conservationLine(component)}
                    </>
                  )}
                </p>
              </div>
              {canConfirm && (
                <div>
                  <Button variant="primary" size="small" disabled={pending}
                    onClick={() => { setConfirming(true); setFailure(null); }}>
                    Confirm this split as the cost basis
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* --- the confirmed basis -------------------------------------------- */}

      <section
        aria-label="Confirmed cost basis"
        className="rounded-instrument border border-subtle bg-surface-raised"
      >
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-subtle px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
              Confirmed cost basis
            </h2>
            <p className="mt-1 max-w-prose text-xs text-ink-secondary">
              Confirmed amounts ARE the governed cost basis for the lines they name. Reversing keeps
              them on record as history rather than deleting them.
            </p>
          </div>
          {canReverse && (
            <Button variant="secondary" size="small" disabled={pending}
              onClick={() => { setReversing(true); setFailure(null); }}>
              Reverse this allocation
            </Button>
          )}
        </div>
        <div className="grid gap-3 px-4 py-3">
          {confirmed.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No confirmed allocation exists for this component, so it is not a cost basis for any
              acquisition line.
            </p>
          ) : (
            <AllocationList rows={confirmed} currency={component.amount.currency} />
          )}
        </div>
      </section>

      {/* --- the derived basis, beside the evidence and never merged into it -- */}

      <BasisImpactPanel impact={view?.basisImpact ?? { derived: false, lines: [] }}
        basisMethods={view?.basisMethods ?? []} />

      {/* --- history --------------------------------------------------------- */}

      {withdrawnRows.length > 0 && (
        <section
          aria-label="Withdrawn proposals"
          className="rounded-instrument border border-subtle bg-surface-raised"
        >
          <div className="border-b border-subtle px-4 py-3">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
              Withdrawn proposals
            </h2>
            <p className="mt-1 max-w-prose text-xs text-ink-secondary">
              Proposals that were withdrawn before ever being confirmed, so they never became a cost
              basis. They were NOT deleted: the amounts and method are exactly as proposed, and the
              governed contract will not move these rows again.
            </p>
          </div>
          <div className="px-4 py-3">
            <AllocationList rows={withdrawnRows} currency={component.amount.currency} />
          </div>
        </section>
      )}

      {component.allocations.some((row) => row.state === 'reversed') && (
        <section
          aria-label="Reversed allocations"
          className="rounded-instrument border border-subtle bg-surface-raised"
        >
          <div className="border-b border-subtle px-4 py-3">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
              Reversed allocations
            </h2>
            <p className="mt-1 max-w-prose text-xs text-ink-secondary">
              Retracted, and preserved. Reversal never deletes a row or rewrites its original review
              attribution.
            </p>
          </div>
          <div className="px-4 py-3">
            <AllocationList
              rows={component.allocations.filter((row) => row.state === 'reversed')}
              currency={component.amount.currency}
            />
          </div>
        </section>
      )}

      {/* --- overlays -------------------------------------------------------- */}

      {editorOpen && (
        <AllocationEditor
          open={editorOpen}
          componentPublicId={component.componentPublicId}
          amount={component.amount}
          scopeLines={component.scopeLines}
          methods={view?.methods ?? []}
          onCancel={() => { setEditorOpen(false); setPreview(null); }}
          onPreview={runPreview}
          onConfirm={confirmProposal}
          preview={preview}
          previewPending={previewPending}
          pending={pending}
          error={failure}
          locked={!proposalAllowed(proposal)}
        />
      )}

      <MutationConfirmation
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={runConfirm}
        title="Confirm this split as the cost basis"
        consequence={
          'This makes the proposed amounts the governed cost basis for the acquisition lines they name. '
          + 'The database independently verifies that they add up to this component’s own amount and '
          + 'refuses if they do not. It can be reversed afterwards, which preserves these rows as '
          + 'history rather than deleting them.'
        }
        objectFacts={
          <dl className="grid gap-1">
            <Fact label="Cost component">{component.componentPublicId}</Fact>
            <Fact label="Component amount"><AmountValue amount={component.amount} /></Fact>
            <Fact label="Proposed total, as shown on this screen">
              <MinorAmount
                minor={component.candidateTotalMinor}
                currency={component.amount.currency}
              />
            </Fact>
            <Fact label="Lines"><Count value={candidates.length} /></Fact>
          </dl>
        }
        // The governed function records no reason for a confirmation, so none
        // is collected. Asking for one and discarding it would be theatre.
        reason={{ value: '', onChange: () => {}, required: false, label: 'No reason is recorded for a confirmation' }}
        confirmLabel={pending ? 'Confirming…' : 'Confirm the cost basis'}
        confirmDisabled={pending}
        pending={pending}
      />

      <MutationConfirmation
        open={reversing}
        onCancel={() => { setReversing(false); setReversalReason(''); }}
        onConfirm={runReverse}
        title="Reverse this confirmed allocation"
        consequence={
          'This retracts the cost basis for every line in the confirmed split and returns the component '
          + 'to unresolved, so a corrected split can be proposed. Nothing is deleted: the reversed rows '
          + 'stay on record, timestamped, with their original review attribution intact. The reason you '
          + 'give becomes governed audit history.'
        }
        objectFacts={
          <dl className="grid gap-1">
            <Fact label="Cost component">{component.componentPublicId}</Fact>
            <Fact label="Confirmed rows"><Count value={confirmed.length} /></Fact>
          </dl>
        }
        reason={{
          value: reversalReason,
          onChange: setReversalReason,
          required: true,
          label: 'Why is this allocation being reversed?',
          description: 'Recorded as governed audit history. A cost basis retracted with no account of why is not evidence.',
          multiline: true,
          maxLength: 500,
        }}
        confirmLabel={pending ? 'Reversing…' : 'Reverse the allocation'}
        confirmVariant="destructive"
        confirmDisabled={pending || reversalReason.trim() === ''}
        pending={pending}
      />

      <MutationConfirmation
        open={withdrawing}
        onCancel={() => { setWithdrawing(false); setWithdrawalReason(''); }}
        onConfirm={runWithdraw}
        title="Withdraw this proposed split"
        consequence={
          'This retracts the pending proposal so a corrected split can be proposed. It is NOT a '
          + 'deletion: the proposed amounts and method stay on record as withdrawn history, and the '
          + 'governed contract will not move those rows again. The proposal never became a cost basis, '
          + 'so no cost basis is being retracted here. The reason you give becomes governed audit '
          + 'history.'
        }
        objectFacts={
          <dl className="grid gap-1">
            <Fact label="Cost component">{component.componentPublicId}</Fact>
            <Fact label="Proposed rows to withdraw"><Count value={candidates.length} /></Fact>
            <Fact label="Proposed total, as shown on this screen">
              <MinorAmount
                minor={component.candidateTotalMinor}
                currency={component.amount.currency}
              />
            </Fact>
          </dl>
        }
        reason={{
          value: withdrawalReason,
          onChange: setWithdrawalReason,
          required: true,
          label: 'Why is this proposal being withdrawn?',
          description:
            'Recorded as governed audit history. The governed function refuses a blank reason, and so '
            + 'does this screen.',
          multiline: true,
          maxLength: 500,
        }}
        confirmLabel={pending ? 'Withdrawing…' : 'Withdraw the proposal'}
        confirmVariant="destructive"
        confirmDisabled={pending || withdrawalReason.trim() === ''}
        pending={pending}
      />
    </div>
  );
}

const WITHDRAWAL_TITLE: Record<string, string> = {
  unknown: 'It is unknown whether the proposal was withdrawn',
  verifying: 'Checking the governed record',
  committed: 'The proposal was withdrawn',
  confirmed_instead: 'The proposal was CONFIRMED, not withdrawn',
  absent: 'The proposal was not withdrawn',
  inconclusive: 'What happened cannot be attributed from the record',
  unverified: 'It is still unknown whether the proposal was withdrawn',
};

const PROPOSAL_TITLE: Record<string, string> = {
  unknown: 'It is unknown whether the split was recorded',
  verifying: 'Checking the governed record',
  committed: 'The split did reach the database',
  foreign: 'A pending proposal exists, but it is not yours',
  absent: 'The split was not recorded',
  superseded: 'This component moved on while the outcome was unknown',
  unverified: 'It is still unknown whether the split was recorded',
};

/**
 * Refusals that PROVE the governed contract rejected the request.
 *
 * These arrived as an answer from the database, so nothing was written and the
 * outcome is not in doubt. Everything else — a network failure, a 5xx, a body
 * we could not interpret — leaves it genuinely unknown, and the verify-first
 * path takes over.
 */
function provesRefusal(code: string): boolean {
  return [
    'invalid_request',
    'proposal_would_not_conserve',
    'line_outside_component_scope',
    'acquisition_line_not_found',
    'ambiguous_acquisition_line',
    'amount_not_known',
    'component_directly_attributed',
    'component_reversed',
    'unauthorized_workspace',
    'cost_component_not_found',
    'batch_too_large',
    'duplicate_line_in_proposal',
    'no_value_basis',
    'no_weight_basis',
    'no_lines_in_scope',
    'method_not_computable',
    // Withdrawal refusals. Each is the database answering, so nothing was
    // written and the outcome is not in doubt.
    'nothing_to_withdraw',
    'allocation_terminal',
  ].includes(code);
}

/** How the proposed total stands against the component's own amount. */
function conservationLine(component: CostComponentDetail): string {
  const delta = component.conservationDeltaMinor;
  if (delta === null) return 'there is no known component amount to conserve against.';
  const parsed = toMinor(delta);
  if (parsed === null) return 'the difference could not be computed exactly.';
  if (parsed === 0n) return 'this matches the component amount exactly.';
  const magnitude = parsed < 0n ? -parsed : parsed;
  return magnitude <= 1n
    ? 'within the one-minor-unit tolerance the governed contract allows.'
    : `this does NOT match the component amount, and the governed contract will refuse to confirm it.`;
}

function AllocationList({
  rows, currency,
}: {
  readonly rows: readonly CostComponentDetail['allocations'][number][];
  readonly currency: string;
}) {
  return (
    <ul className="grid gap-2">
      {rows.map((row) => (
        <li
          key={row.allocationPublicId}
          className="rounded-instrument border border-subtle bg-surface-inset px-3 py-2"
          data-allocation={row.allocationPublicId}
        >
          <div className="flex flex-wrap items-center gap-2">
            <AllocationStatePill state={row.state} />
            <PublicId>{row.allocationPublicId}</PublicId>
          </div>
          <p className="mt-1 text-xs text-ink-secondary">
            {ALLOCATION_STATE_DESCRIPTION[row.state]}
          </p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <Fact label="Acquisition line">
              {row.acquisitionLinePublicId
                ? `${row.sourceSystemPublicId ?? ''} · ${row.acquisitionLinePublicId}`
                : UNKNOWN.line}
            </Fact>
            <Fact label="Amount">
              <MinorAmount minor={row.amountMinor} currency={currency} />
            </Fact>
            <Fact label="Method">{methodLabel(row.method)}</Fact>
            <Fact label="Reviewed">
              {row.state === 'candidate'
                ? 'Not reviewed — a proposal is not a cost basis'
                : instant(row.reviewedAt)}
            </Fact>
            {row.reversedAt !== null && (
              <Fact label="Reversed">{instant(row.reversedAt)}</Fact>
            )}
          </dl>
        </li>
      ))}
    </ul>
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
