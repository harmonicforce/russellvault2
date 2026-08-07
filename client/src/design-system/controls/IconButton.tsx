import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * An icon-only control.
 *
 * `label` is REQUIRED by the type, not merely encouraged: an icon button with
 * no accessible name is an unlabelled button to a screen reader, and there is
 * no sensible fallback we could invent from a glyph. The API makes the
 * omission a compile error rather than an audit finding later.
 *
 * A tooltip may supplement the name. It may never replace it — tooltips do not
 * exist for touch or for assistive technology.
 */
export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label' | 'children'> {
  /** The accessible name. Required. */
  readonly label: string;
  readonly children: ReactNode;
  /** Optional visible tooltip; supplements `label`, never replaces it. */
  readonly tooltip?: string;
  readonly className?: string;
}

const BASE = [
  'inline-flex items-center justify-center',
  // 44x44 is the practical minimum comfortable target, so the control keeps a
  // usable hit area no matter how small the glyph inside it is.
  'min-h-11 min-w-11 rounded-control',
  'text-ink-secondary hover:bg-surface-inset hover:text-ink',
  'transition-[background-color,color] duration-control ease-standard',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
  'disabled:cursor-not-allowed disabled:opacity-55',
].join(' ');

export function IconButton({ label, tooltip, type = 'button', className = '', children, ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={tooltip} className={`${BASE} ${className}`} {...rest}>
      {/* The glyph itself is decorative: the accessible name is on the button. */}
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </button>
  );
}
