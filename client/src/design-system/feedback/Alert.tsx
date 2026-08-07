import type { ReactNode } from 'react';

/**
 * A bounded message about the state of the system.
 *
 * The component owns PRESENTATION and accessible semantics. It does not decide
 * severity: whether a situation is `warning` or `critical` is domain
 * knowledge, and an Alert that inferred it would be making business judgements
 * in the view layer.
 *
 * A critical alert gets critical colour and an assertive live region — not
 * extra decoration. Raising the stakes must not mean raising the ornament,
 * because decoration is exactly what makes a serious message easy to dismiss.
 */
export type AlertTone = 'information' | 'success' | 'warning' | 'serious' | 'critical';

export interface AlertProps {
  readonly tone?: AlertTone;
  /** Short summary line. Optional; body alone is valid. */
  readonly title?: string;
  readonly children: ReactNode;
  /** Recovery affordance, e.g. a retry control. */
  readonly action?: ReactNode;
  readonly className?: string;
}

const TONE: Record<AlertTone, string> = {
  information: 'border-information/40 bg-information/8 text-ink',
  success: 'border-success/40 bg-success/8 text-ink',
  warning: 'border-warning/40 bg-warning/8 text-ink',
  serious: 'border-serious/40 bg-serious/8 text-ink',
  critical: 'border-critical/50 bg-critical/8 text-ink',
};

const TITLE_TONE: Record<AlertTone, string> = {
  information: 'text-information',
  success: 'text-success',
  warning: 'text-warning',
  serious: 'text-serious',
  critical: 'text-critical',
};

export function Alert({ tone = 'information', title, children, action, className = '' }: AlertProps) {
  // Serious and critical interrupt; the rest report. `alert` implies an
  // assertive live region, so it is reserved for what genuinely warrants
  // cutting across whatever the operator is reading.
  const interrupting = tone === 'critical' || tone === 'serious';

  return (
    <div
      role={interrupting ? 'alert' : 'status'}
      data-tone={tone}
      className={`rounded-instrument border p-3 text-sm ${TONE[tone]} ${className}`}
    >
      {title && <p className={`font-semibold ${TITLE_TONE[tone]}`}>{title}</p>}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
      {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
