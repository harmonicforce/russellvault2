import type { ReactNode } from 'react';

/**
 * A compact status marker.
 *
 * Two rules are enforced by the API rather than left to discipline:
 *
 * 1. The label is REQUIRED. Colour is never the sole carrier of meaning, so a
 *    pill always says what it means in words. A colour-blind operator, a
 *    greyscale print, and a screen reader all get the same answer.
 * 2. There is no brand tone. Gold is structure, not status — a pill can never
 *    say "warning" in gold.
 *
 * A pill is one of the few places the pill radius is correct; the application
 * is otherwise deliberately not pill-heavy.
 */
export type StatusTone = 'neutral' | 'success' | 'information' | 'warning' | 'serious' | 'critical';

export interface StatusPillProps {
  readonly tone?: StatusTone;
  /** The visible words. Required — a pill is never colour alone. */
  readonly children: ReactNode;
  /** Optional leading glyph. Decorative; the label carries the meaning. */
  readonly icon?: ReactNode;
  readonly className?: string;
}

const TONE: Record<StatusTone, string> = {
  neutral: 'border-subtle bg-surface-inset text-ink-secondary',
  success: 'border-success/40 bg-success/10 text-success',
  information: 'border-information/40 bg-information/10 text-information',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  serious: 'border-serious/40 bg-serious/10 text-serious',
  critical: 'border-critical/40 bg-critical/10 text-critical',
};

export function StatusPill({ tone = 'neutral', children, icon, className = '' }: StatusPillProps) {
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]} ${className}`}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
