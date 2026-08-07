import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Variants carry INTENT, not colour.
 *
 * `destructive` is its own variant rather than "primary but red" because the
 * decision to destroy is a different decision, and it renders in critical
 * semantics — never in brand gold. Gold is structure; it must never be the
 * signal that something is about to be lost.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';
export type ButtonSize = 'medium' | 'small';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly children: ReactNode;
  /** Escape hatch for layout only — never for colour. */
  readonly className?: string;
}

const VARIANT: Record<ButtonVariant, string> = {
  // Brand fill with its PAIRED foreground. The dark theme's gold is bright, so
  // on-accent resolves to dark ink there rather than white.
  primary: 'bg-accent text-on-accent hover:opacity-90',
  secondary: 'border border-strong bg-surface-raised text-ink hover:bg-surface-inset',
  quiet: 'text-ink-secondary hover:bg-surface-inset hover:text-ink',
  destructive: 'bg-critical text-white hover:opacity-90',
};

const SIZE: Record<ButtonSize, string> = {
  // min-h keeps a comfortable target even when a caller passes tight padding.
  medium: 'min-h-11 px-4 py-2 text-sm',
  small: 'min-h-9 px-3 py-1.5 text-sm',
};

const BASE = [
  'inline-flex items-center justify-center gap-2',
  'rounded-control font-semibold',
  'transition-[background-color,opacity,color] duration-control ease-standard',
  // Focus must be visible for keyboard operators and must not rely on the
  // browser default, which disappears against several of our surfaces.
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
  // A disabled control still reads as text; it just cannot be actioned.
  'disabled:cursor-not-allowed disabled:opacity-55',
].join(' ');

/**
 * The house button.
 *
 * `type` is always explicit: an unset button inside a form submits it, which
 * has repeatedly meant "the cancel button saved the record". Callers may
 * override it, but they cannot forget it.
 */
export function Button({
  variant = 'secondary',
  size = 'medium',
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} data-variant={variant} className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
