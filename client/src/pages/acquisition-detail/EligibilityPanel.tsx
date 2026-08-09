import { useEffect, useState } from 'react';
import { Button, MutationConfirmation, StatusPill } from '../../design-system';
import type { AcquisitionDetail, Role } from '../../lib/acquisitionDetailApi';
import { Fact, FactGrid, History, HistoryEntry, Panel, PublicId, headlineTitle, instant } from './detailPresentation';
import { operationKey, type Operation, type OperationKind } from './operationModel';

/**
 * Whether this acquisition line may be used downstream.
 *
 * This is a consequential governed decision, so it goes through the shared
 * confirmation: what is about to happen, what it will do to the records, which
 * record exactly, whether it can be undone, and why. The reason is required and
 * is collected in a real labelled field — never a browser prompt.
 *
 * The truth the confirmation has to carry, because operators have read
 * "Excluded" as "deleted" before: exclusion stops downstream receiving and cost
 * use, and it does NOT remove, rewrite, or hide the source acquisition
 * evidence. The line stays on this page, its payments stay, its shipments stay,
 * and both decisions stay in append-only history.
 *
 * Status is never carried by colour alone — the pill says the word.
 */
export function EligibilityPanel({
  detail,
  role,
  pending,
  locked,
  succeeded,
  submit,
}: {
  readonly detail: AcquisitionDetail;
  readonly role: Role;
  readonly pending: boolean;
  readonly locked: boolean;
  readonly succeeded: { readonly seq: number; readonly kind: OperationKind | null };
  readonly submit: (operation: Operation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');

  const exclusion = detail.exclusion ?? { state: 'included' as const, current: null, history: [] };
  const excluded = exclusion.state === 'excluded';
  const actionLabel = excluded ? 'Restore downstream eligibility' : 'Exclude from downstream workflows';

  // Close on THIS panel's own confirmed operation, never on any success. A
  // confirmed payment must not close a half-typed eligibility decision.
  useEffect(() => {
    if (succeeded.kind === 'exclude' || succeeded.kind === 'restore') {
      setOpen(false);
      setReason('');
      setValidation('');
    }
  }, [succeeded.seq, succeeded.kind]);

  const confirm = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setValidation('A reason is required.');
      return;
    }
    setValidation('');
    submit({
      kind: excluded ? 'restore' : 'exclude',
      target: detail.identity.linePublicId,
      // Source-qualified: a line public ID is unique only within its source
      // system, so the target alone would address the wrong record.
      source: detail.identity.sourceSystemPublicId,
      payload: { reason: trimmed },
      // Minted exactly once, here, when the owner confirms. Never inside the
      // API call, never inside Retry, never on a rerender — a Retry has to
      // resend THIS key.
      idempotencyKey: operationKey(),
    });
  };

  return (
    <Panel
      title="Downstream eligibility"
      actions={
        role === 'owner' ? (
          <Button
            variant={excluded ? 'primary' : 'secondary'}
            size="small"
            disabled={pending || locked}
            onClick={() => {
              setValidation('');
              setOpen(true);
            }}
          >
            {actionLabel}
          </Button>
        ) : undefined
      }
    >
      <FactGrid columns={2}>
        <Fact label="Current decision">
          <StatusPill tone={excluded ? 'serious' : 'success'}>{excluded ? 'Excluded' : 'Included'}</StatusPill>
        </Fact>
        <Fact label="Reason">
          {exclusion.current ? `Current reason: ${exclusion.current.reason}` : 'No current eligibility reason'}
        </Fact>
      </FactGrid>

      <p className="text-sm text-ink-secondary">
        Exclusion prevents downstream receiving and cost use. The source acquisition evidence remains preserved and is
        never deleted or rewritten by an eligibility decision.
      </p>

      <History
        title="Decision history"
        emptyLabel="No explicit eligibility decisions."
        count={exclusion.history.length}
      >
        {exclusion.history.map((entry) => (
          // Deliberately a full phrase rather than a bare "Excluded": the
          // current decision above is the one that says that word, and a
          // history row must not be mistakable for the live state.
          <HistoryEntry key={entry.publicId}>
            {entry.state === 'excluded' ? 'Excluded from downstream workflows' : 'Restored to downstream workflows'} ·{' '}
            {entry.reason} · {instant(entry.createdAt)} · actor {entry.actorId}
            {entry.supersededAt ? ' · superseded' : ''}
          </HistoryEntry>
        ))}
      </History>

      {role === 'owner' && (
        <MutationConfirmation
          open={open}
          onCancel={() => {
            setOpen(false);
            setReason('');
            setValidation('');
          }}
          onConfirm={confirm}
          title={actionLabel}
          consequence={
            excluded
              ? 'Restoring returns this acquisition line to downstream eligibility under the current governed contract. The earlier exclusion decision stays in history. This decision is reversible.'
              : 'Excluding stops this acquisition line being used in downstream receiving and cost workflows. It does not delete or rewrite the source acquisition evidence. This decision is reversible by an owner, and both decisions stay in history.'
          }
          objectFacts={
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Fact label="Acquisition line">
                <PublicId>{detail.identity.linePublicId}</PublicId>
              </Fact>
              <Fact label="Source system">
                <PublicId>{detail.identity.sourceSystemPublicId}</PublicId>
              </Fact>
              <Fact label="Title">{headlineTitle(detail.line)}</Fact>
              <Fact label="Current decision">{excluded ? 'Excluded' : 'Included'}</Fact>
            </dl>
          }
          reason={{
            value: reason,
            onChange: setReason,
            label: 'Eligibility decision reason',
            description: 'Recorded against this decision and kept in append-only history.',
            error: validation || undefined,
            required: true,
            maxLength: 500,
          }}
          confirmVariant={excluded ? 'primary' : 'destructive'}
          pending={pending}
          // The label stays constant while the mutation is in flight; the
          // pending state is carried by `disabled` and `aria-busy`. A control
          // whose NAME changes mid-operation is one an operator — or an
          // assistive technology — can lose track of.
          pendingLabel="Confirm"
          confirmDisabled={locked}
        />
      )}
    </Panel>
  );
}
