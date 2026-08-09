// The unresolved governed operation coordinator.
//
// ONE UNRESOLVED CONSEQUENTIAL OPERATION AT A TIME.
//
// Payments, reversals, shipment creation, shipment transitions, exclusions and
// restorations each carry an idempotency key. When a response does not arrive,
// the SAFE recovery is to resend the EXACT same payload under the EXACT same
// key — the server will recognise the key and cannot record the operation
// twice. That guarantee only holds while exactly one such request is
// outstanding. Two unresolved keys mean two unknown outcomes and no way to tell
// which one the server took, so a failure is retained and blocks further
// coordinated work until it is resolved.
//
// The key is minted where the operator CONFIRMS the semantic operation, never
// inside the transport and never inside the retry. A key minted in transport
// would be a new key on every attempt, which is the exact opposite of what
// idempotency is for.
//
// A stale transition is the one exception and is NEVER retained: its expected
// status is already known to be wrong, so replaying it under the same key is
// meaningless. The detail is re-read and the operator must confirm a fresh
// transition, which mints a new key.
//
// ---------------------------------------------------------------------------
// WHAT AN UNCONFIRMED REQUEST ACTUALLY MEANS
//
// This module previously offered "Discard retry", and told the operator:
//
//     "Unconfirmed request discarded. Nothing was sent."
//
// That sentence was false, and it was false in the most expensive direction. A
// request whose response never arrived may have reached the governed backend,
// committed, and lost only its reply. Telling an owner that nothing was sent
// invites them to record the payment again — under a NEW idempotency key, which
// the server has no reason to collapse — and the vault ends up with two
// payments for one purchase.
//
// The action is therefore about the RETAINED RETRY, not about the request. An
// operator can stop retrying; they cannot un-send. Stopping re-reads the
// governed record first, and if that read fails the lock deliberately stays on:
// unlocking consequential work while the current state is unknown is how the
// duplicate gets written.

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AcquisitionDetailError } from '../../lib/acquisitionDetailApi';

export type OperationKind = 'payment' | 'reverse' | 'shipment' | 'transition' | 'exclude' | 'restore';

/**
 * A confirmed semantic operation, complete with the key it will always carry.
 *
 * `source` is carried for the source-qualified operations, because an
 * acquisition line's public ID is unique only within its source system.
 */
export interface Operation {
  readonly kind: OperationKind;
  readonly target: string;
  readonly source?: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
}

export const OPERATION_LABEL: Record<OperationKind, string> = {
  payment: 'Payment',
  reverse: 'Payment reversal',
  shipment: 'Shipment',
  transition: 'Shipment transition',
  exclude: 'Exclusion',
  restore: 'Restoration',
};

/**
 * What a CONFIRMED response proves, per operation.
 *
 * Bounded on purpose: one global "Saved." tells the operator that something
 * happened somewhere, which is not feedback. Each phrase names the record that
 * changed and claims nothing beyond the response.
 */
export const OPERATION_CONFIRMED: Record<OperationKind, string> = {
  payment: 'Payment recorded',
  reverse: 'Payment reversal recorded',
  shipment: 'Shipment created',
  transition: 'Shipment transition recorded',
  exclude: 'Eligibility decision confirmed',
  restore: 'Eligibility decision confirmed',
};

/** Minted once, where the operator confirms. Never in transport, never on retry. */
export const operationKey = (): string => crypto.randomUUID();

export type OutcomeTone = 'success' | 'warning' | 'information';

export interface Outcome {
  readonly tone: OutcomeTone;
  readonly text: string;
}

export interface GovernedOperationController {
  /** Confirm a new semantic operation. Refused while one is unresolved. */
  readonly submit: (operation: Operation) => void;
  /** Resend the retained operation byte-for-byte, under its original key. */
  readonly retry: () => void;
  /**
   * Stop retrying and re-read the governed record.
   *
   * Never claims the earlier request did or did not commit. Clears the retained
   * retry only when the authoritative re-read succeeded.
   */
  readonly stopRetrying: () => void;
  readonly failed: Operation | null;
  /** Recovery / blocking text shown inside the unresolved-operation notice. */
  readonly message: string;
  /** Feedback for everything that is NOT an unresolved operation. */
  readonly outcome: Outcome | null;
  readonly pending: boolean;
  /** The kind actually in flight, so a panel shows ITS OWN pending state. */
  readonly pendingKind: OperationKind | null;
  /** An authoritative re-read is running as part of stopping a retry. */
  readonly verifying: boolean;
  /** True while any coordinated mutation is refused. */
  readonly locked: boolean;
  /** Monotonic confirmation signal, so a panel can react to its own success. */
  readonly succeeded: { readonly seq: number; readonly kind: OperationKind | null };
}

export interface GovernedOperationOptions {
  readonly run: (operation: Operation) => Promise<unknown>;
  /**
   * Re-read the authoritative record.
   *
   * Returns whether the re-read actually succeeded. That boolean is the whole
   * reason this is not `Promise<void>`: a refresh that silently failed would
   * leave the page rendering a stale record while telling the operator it had
   * been refreshed, which is the same class of lie this module exists to fix.
   */
  readonly refresh: () => Promise<boolean>;
}

export function useGovernedOperation({ run, refresh }: GovernedOperationOptions): GovernedOperationController {
  const [failed, setFailed] = useState<Operation | null>(null);
  const [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [succeeded, setSucceeded] = useState<{ seq: number; kind: OperationKind | null }>({ seq: 0, kind: null });

  const mutation = useMutation({
    mutationFn: run,
    onSuccess: async (_data, operation) => {
      setFailed(null);
      setMessage('');
      setSucceeded((s) => ({ seq: s.seq + 1, kind: operation.kind }));

      const refreshed = await refresh();
      setOutcome(
        refreshed
          ? { tone: 'success', text: `${OPERATION_CONFIRMED[operation.kind]} and the governed detail was re-read.` }
          : {
              // The mutation response is authoritative; the re-read is not
              // available. Rendering this as plain success would present a
              // record we could not confirm as though we had confirmed it.
              tone: 'warning',
              text: `${OPERATION_CONFIRMED[operation.kind]}. The governed record could not be verified afterwards, so what is shown below may not reflect the confirmed change.`,
            },
      );
    },
    onError: (error: AcquisitionDetailError, operation) => {
      const staleTransition = error.code === 'stale_status';
      setFailed(staleTransition ? null : operation);

      if (staleTransition) {
        setMessage('');
        setOutcome({
          tone: 'warning',
          text: 'Shipment changed elsewhere. Review the refreshed status and confirm a new transition.',
        });
      } else {
        setOutcome(null);
        // The notice's own title already names the operation and says it was
        // not confirmed. Restating that here just makes the sentence the
        // operator actually needs — what to do about it — harder to find.
        setMessage(`Reference: ${error.code}.`);
      }

      void refresh();
    },
  });

  const busy = mutation.isPending || verifying;

  return {
    submit: (operation) => {
      if (failed) {
        setMessage(
          `Resolve the unconfirmed ${OPERATION_LABEL[failed.kind].toLowerCase()} first — retry it, or stop retrying and verify, before starting another.`,
        );
        return;
      }
      // A second semantic operation while one is in flight would leave two
      // unresolved idempotency keys with no way to tell which the server took.
      if (busy) return;
      mutation.mutate(operation);
    },

    retry: () => {
      // The retained object itself, so the payload, the target, the source
      // qualification and above all the KEY are byte-for-byte the originals.
      if (failed && !busy) mutation.mutate(failed);
    },

    stopRetrying: () => {
      if (!failed || busy) return;
      const kind = failed.kind;
      const label = OPERATION_LABEL[kind].toLowerCase();

      setVerifying(true);
      void refresh().then((verified) => {
        setVerifying(false);

        if (!verified) {
          // Do NOT unlock. The earlier outcome is unknown AND the current state
          // could not be established, which is the worst moment to let a
          // replacement operation be written under a fresh key.
          setMessage(
            `Verification failed: the ${label} outcome remains unknown and the current record could not be confirmed. No replacement operation can be started until the governed detail can be read again.`,
          );
          return;
        }

        setFailed(null);
        setMessage('');
        setOutcome({
          tone: 'warning',
          text: `Stopped retrying the ${label}. Whether that request reached the governed record is still unknown — it may have committed without returning a response. The detail below has been re-read from the governed record; inspect it before submitting a replacement.`,
        });
      });
    },

    failed,
    message,
    outcome,
    pending: mutation.isPending,
    pendingKind: mutation.isPending ? (mutation.variables?.kind ?? null) : null,
    verifying,
    locked: failed !== null,
    succeeded,
  };
}
