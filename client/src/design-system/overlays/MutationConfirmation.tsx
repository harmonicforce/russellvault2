import type { ReactNode } from 'react';
import { Alert } from '../feedback/Alert';
import { Button } from '../controls/Button';
import { ReasonField } from '../controls/ReasonField';
import { Dialog, type DialogSize } from './Dialog';

/**
 * The shape of a governed mutation confirmation.
 *
 * Every governed mutation in Russell Vault asks the operator the same four
 * questions in the same order — what am I about to do, what will it do to the
 * records, what exactly am I doing it to, and why am I doing it — and until now
 * each surface answered them in its own layout, or skipped one. This composes
 * them once.
 *
 * WHAT IT DOES NOT KNOW
 *
 * Everything specific. It encodes no acquisition, payment, exclusion, shipment
 * or inventory rule. It does not decide whether a reason is required, what a
 * valid reason is, whether the action is destructive, or what the consequence
 * of confirming will be — every one of those arrives as a prop from the
 * workflow that understands the mutation. A confirmation dialog that decided
 * any of them would be a business rule living in the view layer, in the one
 * place nobody looks for business rules.
 *
 * The object facts are a SLOT, not a schema. The caller renders the immutable
 * identity and current values the operator needs in order to be sure they are
 * acting on the right record; this component never reads, derives or formats
 * them.
 */
export interface MutationConfirmationProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;

  /** What the operator is about to do, in plain language. */
  readonly title: string;
  /**
   * What confirming will do to the records. Plain language, caller-supplied —
   * this is the sentence that has to be true.
   */
  readonly consequence: string;

  /**
   * Immutable identity and current values for the object being acted on, so
   * the operator can verify they have the right record. Rendered as supplied.
   */
  readonly objectFacts?: ReactNode;

  readonly reason: {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly label?: string;
    readonly description?: string;
    /** The caller's own validation failure. Never computed here. */
    readonly error?: string;
    readonly required?: boolean;
    readonly maxLength?: number;
    readonly minLength?: number;
    readonly multiline?: boolean;
  };

  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** `destructive` renders critical semantics — never brand gold. */
  readonly confirmVariant?: 'primary' | 'destructive';
  /** The caller's own gate, e.g. "a reason has not been entered yet". */
  readonly confirmDisabled?: boolean;

  /** A mutation is in flight. Blocks incidental dismissal and re-submission. */
  readonly pending?: boolean;
  readonly pendingLabel?: string;

  /** A bounded, named failure from the attempted mutation. */
  readonly error?: { readonly code: string; readonly message: string } | null;

  readonly size?: DialogSize;
}

export function MutationConfirmation({
  open,
  onCancel,
  onConfirm,
  title,
  consequence,
  objectFacts,
  reason,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  confirmDisabled = false,
  pending = false,
  pendingLabel = 'Working…',
  error = null,
  size = 'standard',
}: MutationConfirmationProps) {
  return (
    <Dialog
      open={open}
      onDismiss={onCancel}
      title={title}
      description={consequence}
      size={size}
      // While a governed mutation is in flight, Escape and the backdrop stop
      // dismissing. Losing a half-typed reason to a stray keystroke is bad; not
      // knowing whether the submitted mutation committed is worse.
      dismissible={!pending}
    >
      <div className="grid gap-4">
        {objectFacts && (
          <div className="rounded-instrument border border-subtle bg-surface-inset p-3">{objectFacts}</div>
        )}

        <ReasonField
          value={reason.value}
          onChange={reason.onChange}
          label={reason.label}
          description={reason.description}
          error={reason.error}
          required={reason.required}
          maxLength={reason.maxLength}
          minLength={reason.minLength}
          multiline={reason.multiline}
          disabled={pending}
        />

        {error && (
          // Bounded: the named code and the operator-facing message, and no
          // claim about whether the mutation committed. A failed response is
          // not proof that nothing happened.
          <Alert tone="critical" title="The action could not be completed">
            <p>{error.message}</p>
            <p className="mt-1 text-xs text-ink-muted">Reference: {error.code}</p>
          </Alert>
        )}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          variant={confirmVariant}
          onClick={onConfirm}
          disabled={pending || confirmDisabled}
          aria-busy={pending || undefined}
        >
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
