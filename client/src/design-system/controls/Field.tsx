import { useId, type ReactNode } from 'react';

/**
 * Field wires a control to its label, description, and error.
 *
 * It owns the ACCESSIBLE WIRING and nothing else. It deliberately does not
 * validate: validation is domain knowledge, it belongs with the workflow that
 * understands the rule, and a Field that decided what "invalid" meant would
 * quietly become a second place where business rules live.
 *
 * The control is supplied through a render prop so the caller keeps ownership
 * of the input while Field supplies the ids that must match.
 */
export interface FieldProps {
  readonly label: string;
  readonly description?: string;
  /** Present means invalid. The caller decides what invalid means. */
  readonly error?: string;
  readonly required?: boolean;
  readonly children: (props: {
    readonly id: string;
    readonly 'aria-describedby': string | undefined;
    readonly 'aria-invalid': boolean | undefined;
    readonly required: boolean | undefined;
  }) => ReactNode;
  readonly className?: string;
}

export function Field({ label, description, error, required, children, className = '' }: FieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  // Both are referenced when both exist, so an operator using a screen reader
  // hears the guidance AND the failure rather than one replacing the other.
  const describedBy = [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`grid gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="text-critical" aria-hidden="true">
            {' '}
            *
          </span>
        )}
        {/* The asterisk is decorative; `required` on the control is what
            actually announces the requirement. */}
        {required && <span className="sr-only"> (required)</span>}
      </label>

      {description && (
        <p id={descriptionId} className="text-xs text-ink-muted">
          {description}
        </p>
      )}

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        required: required || undefined,
      })}

      {error && (
        // role="alert" so a failure that appears after submission is announced
        // rather than sitting silently below the control.
        <p id={errorId} role="alert" className="text-xs font-medium text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
