import { Field } from './Field';

/**
 * The reason a governed mutation was made.
 *
 * Russell Vault's history rules require actor, timestamp, reason and
 * before/after state on corrections, adjustments, resolutions and voids. The
 * reason is the only one of those the operator supplies, and it has repeatedly
 * been collected through `window.prompt()` — an unlabelled, unvalidatable,
 * unstyled control that cannot show an error, cannot be described, cannot be
 * required, and cannot be reached by assistive technology in any useful way.
 * This is its replacement, and there is no browser prompt anywhere in it.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not validate. Whether four characters is enough, whether a reason is
 * required for THIS action, and what a good reason looks like are all business
 * rules belonging to the workflow that understands the mutation. The caller
 * passes `error` when its own rule fails; the field wires it accessibly and
 * says nothing about why.
 *
 * It also never rewrites what the operator typed. `onChange` receives the raw
 * value, and the exact string the operator sees is the exact string the caller
 * gets — trimming or normalising here would mean the recorded reason and the
 * displayed reason could differ.
 */
export interface ReasonFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label?: string;
  /** Guidance on what belongs here. Wired as the accessible description. */
  readonly description?: string;
  /** Caller-decided failure. Its presence is what marks the field invalid. */
  readonly error?: string;
  readonly required?: boolean;
  /** Caller-supplied character bound. Not a rule this component invents. */
  readonly maxLength?: number;
  readonly minLength?: number;
  /** A short single-line reason where a paragraph would be noise. */
  readonly multiline?: boolean;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

const CONTROL = [
  'w-full rounded-control border border-subtle bg-surface-base px-3 py-2 text-sm text-ink',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
  'disabled:cursor-not-allowed disabled:opacity-55',
].join(' ');

export function ReasonField({
  value,
  onChange,
  label = 'Reason',
  description,
  error,
  required,
  maxLength,
  minLength,
  multiline = true,
  rows = 3,
  placeholder,
  disabled,
  className = '',
}: ReasonFieldProps) {
  return (
    <Field label={label} description={description} error={error} required={required} className={className}>
      {(control) =>
        multiline ? (
          <>
            <textarea
              {...control}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              rows={rows}
              maxLength={maxLength}
              minLength={minLength}
              placeholder={placeholder}
              disabled={disabled}
              className={CONTROL}
            />
            {maxLength !== undefined && <CharacterCount used={value.length} maxLength={maxLength} />}
          </>
        ) : (
          <>
            <input
              {...control}
              type="text"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              maxLength={maxLength}
              minLength={minLength}
              placeholder={placeholder}
              disabled={disabled}
              className={CONTROL}
            />
            {maxLength !== undefined && <CharacterCount used={value.length} maxLength={maxLength} />}
          </>
        )
      }
    </Field>
  );
}

/**
 * A polite live region rather than a silent counter: an operator who hits the
 * limit mid-sentence otherwise finds out only because typing stops working.
 */
function CharacterCount({ used, maxLength }: { readonly used: number; readonly maxLength: number }) {
  return (
    <p role="status" className="text-xs tabular-nums text-ink-muted">
      {used} of {maxLength} characters
    </p>
  );
}
