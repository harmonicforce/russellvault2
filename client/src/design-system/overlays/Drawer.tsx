import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../controls/IconButton';
import { supportsModalDialog, useOverlayBehavior } from './useOverlayBehavior';

/**
 * The governed edge drawer.
 *
 * This is the evolution of `client/src/components/Drawer.tsx`, which had the
 * shape of a drawer and none of the contract: no dialog role, no accessible
 * name, no Escape, no focus entry, no focus containment, no focus restoration,
 * and a backdrop exposed to assistive technology as an unnamed clickable div.
 * That component now delegates here, so its existing consumers gain the
 * behaviour without a migration.
 *
 * It shares its focus, Escape and dismissal machinery with `Dialog` — the same
 * hook, the same rules — because two overlays that behave differently under the
 * keyboard are two things for an operator to learn.
 *
 * NOT THE SHELL DRAWER. `app/shell/NavigationDrawer` is chrome with its own
 * navigation-close behaviour and is deliberately left alone; destabilising the
 * S1.6.2 shell to share code with a record panel would trade a real risk for a
 * cosmetic saving.
 */

export type DrawerSize = 'compact' | 'standard' | 'wide';

const SIZE: Record<DrawerSize, string> = {
  // Full width on a phone, bounded from `sm` upward: an edge panel pinned to
  // 480px on a 390px viewport is a panel with its content cut off.
  compact: 'sm:max-w-md',
  standard: 'sm:max-w-xl',
  wide: 'sm:max-w-3xl',
};

export interface DrawerProps {
  readonly open: boolean;
  readonly onDismiss: () => void;
  /** The accessible name. Required. */
  readonly title: ReactNode;
  /**
   * The accessible name as text, when `title` is rich content. Required in
   * that case — an accessible name has to be a string.
   */
  readonly titleText?: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /** Whether Escape and the backdrop may dismiss. See `Dialog.dismissible`. */
  readonly dismissible?: boolean;
  readonly closeDisabled?: boolean;
  readonly closeLabel?: string;
  readonly size?: DrawerSize;
  /** Which edge the panel enters from. */
  readonly side?: 'right' | 'left';
  /** Layout escape hatch for consumers pinned to an existing width. */
  readonly widthClassName?: string;
  readonly className?: string;
}

export function Drawer({
  open,
  onDismiss,
  title,
  titleText,
  description,
  children,
  footer,
  dismissible = true,
  closeDisabled = false,
  closeLabel = 'Close',
  size = 'standard',
  side = 'right',
  widthClassName,
  className = '',
}: DrawerProps) {
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const { onKeyDown } = useOverlayBehavior({ open, onDismiss, dismissible, panelRef });
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  useEffect(() => {
    const element = panelRef.current;
    if (!element || !supportsModalDialog()) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  if (!open) return null;

  const native = supportsModalDialog();
  const edge = side === 'right' ? 'ml-auto mr-0' : 'mr-auto ml-0';

  return (
    <>
      {!native && (
        <div
          data-overlay-backdrop=""
          aria-hidden="true"
          onClick={() => dismissible && onDismiss()}
          className="fixed inset-0 z-40 bg-black/40"
        />
      )}
      <dialog
        ref={panelRef}
        data-overlay="drawer"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        open={native ? undefined : true}
        onKeyDown={onKeyDown}
        onCancel={(event) => event.preventDefault()}
        onClick={(event) => {
          if (native && event.target === panelRef.current && dismissible) onDismiss();
        }}
        className={`z-50 h-dvh max-h-dvh w-full ${widthClassName ?? SIZE[size]} ${edge} my-0 max-w-full border-subtle bg-surface-raised p-0 text-ink shadow-overlay backdrop:bg-black/40 motion-safe:transition-transform motion-safe:duration-overlay motion-safe:ease-standard ${
          side === 'right' ? 'border-l' : 'border-r'
        } ${className}`}
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-subtle px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-ink break-words">
                {/* When the visible title is rich content it cannot be the
                    accessible name, so the caller supplies the text and it is
                    what assistive technology reads. */}
                {titleText ? <span className="sr-only">{titleText}</span> : null}
                <span aria-hidden={titleText ? 'true' : undefined}>{title}</span>
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-ink-secondary">
                  {description}
                </p>
              )}
            </div>
            <IconButton label={closeLabel} disabled={closeDisabled} onClick={onDismiss}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>

          {/* The body scrolls, not the page behind it. */}
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-subtle px-5 py-4">
              {footer}
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
