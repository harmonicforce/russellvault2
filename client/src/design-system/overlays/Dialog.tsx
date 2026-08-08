import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../controls/IconButton';
import { supportsModalDialog, useOverlayBehavior } from './useOverlayBehavior';

/**
 * The governed modal dialog.
 *
 * NATIVE SEMANTICS WHERE PRACTICAL
 *
 * The panel is a real `<dialog>`. In a browser it is opened with `showModal()`,
 * which puts it in the top layer, makes the rest of the document inert, and
 * supplies `::backdrop` — behaviour no amount of `z-index` reproduces
 * faithfully. No UI framework is added to obtain it.
 *
 * Where `showModal()` does not exist the element still carries the dialog role
 * and an accessible name; the component then renders its own backdrop and
 * relies on the shared focus trap. The semantics survive the platform gap, and
 * the real-browser proof of top-layer behaviour belongs to S1.6.7.
 *
 * WHAT THE CALLER OWNS
 *
 * Everything with meaning. Dialog does not know what is being confirmed,
 * whether it is dangerous, or what a pending mutation implies. It renders the
 * title, the content and the footer it is given, and reports dismissal.
 *
 * MOTION
 *
 * Entrance transitions are `motion-safe:` only, so an operator who asked the OS
 * for reduced motion gets the state change with no animation at all rather than
 * a shortened one.
 */

export type DialogSize = 'compact' | 'standard' | 'wide';

const SIZE: Record<DialogSize, string> = {
  compact: 'sm:max-w-md',
  standard: 'sm:max-w-xl',
  wide: 'sm:max-w-3xl',
};

export interface DialogProps {
  readonly open: boolean;
  /** Escape, the backdrop, and the close control all route here. */
  readonly onDismiss: () => void;
  /** The accessible name. Required — an unnamed dialog is an unnamed region. */
  readonly title: string;
  /** A sentence describing the dialog, wired as its accessible description. */
  readonly description?: string;
  readonly children: ReactNode;
  /** Confirm/cancel controls. The caller owns which is which. */
  readonly footer?: ReactNode;
  /**
   * Whether an INCIDENTAL gesture may close the dialog. Set false while a
   * governed mutation is in flight, so a stray Escape or a misplaced tap on the
   * backdrop cannot discard a half-finished confirmation.
   *
   * The explicit close control stays available: blocking accidental dismissal
   * must not become trapping the operator inside an overlay. `closeDisabled` is
   * the separate, deliberate opt-in for that.
   */
  readonly dismissible?: boolean;
  /** Disables the explicit close control as well. Use sparingly. */
  readonly closeDisabled?: boolean;
  readonly closeLabel?: string;
  readonly size?: DialogSize;
  readonly className?: string;
}

export function Dialog({
  open,
  onDismiss,
  title,
  description,
  children,
  footer,
  dismissible = true,
  closeDisabled = false,
  closeLabel = 'Close',
  size = 'standard',
  className = '',
}: DialogProps) {
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const { onKeyDown } = useOverlayBehavior({ open, onDismiss, dismissible, panelRef });
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  // Drive the native element. `showModal()` is what makes the background inert
  // and the dialog top-layer; the `open` attribute alone does neither, which is
  // why the fallback path renders a backdrop of its own rather than pretending.
  useEffect(() => {
    const element = panelRef.current;
    if (!element || !supportsModalDialog()) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  if (!open) return null;

  const native = supportsModalDialog();

  return (
    <>
      {/* Rendered only where the platform will not supply ::backdrop. Hidden
          from assistive technology: a second control named "Close" in the tree
          is indistinguishable from the real one. */}
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
        data-overlay="dialog"
        // Stated in both paths. A native modal implies it, and the fallback
        // would not be modal to assistive technology without it.
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        // Focus falls back to the panel, so it can never escape to the document
        // behind the overlay.
        tabIndex={-1}
        open={native ? undefined : true}
        onKeyDown={onKeyDown}
        onCancel={(event) => {
          // The platform's own Escape path, prevented so dismissal is decided
          // in exactly one place — the keydown handler — rather than in two
          // that can disagree about whether the dialog is dismissible.
          event.preventDefault();
        }}
        onClick={(event) => {
          // A native modal reports a backdrop click as a click on the dialog
          // element itself, so this is the backdrop test in the native path.
          if (native && event.target === panelRef.current && dismissible) onDismiss();
        }}
        className={`z-50 m-auto w-full max-w-[calc(100vw-2rem)] rounded-dialog border border-subtle bg-surface-raised p-0 text-ink shadow-overlay backdrop:bg-black/40 motion-safe:transition-opacity motion-safe:duration-overlay motion-safe:ease-standard ${SIZE[size]} ${className}`}
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-subtle px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-ink">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-ink-secondary">
                  {description}
                </p>
              )}
            </div>
            {/* IconButton carries the 44x44 minimum target, so the principal
                controls stay usable on a tablet held in a stockroom. */}
            <IconButton label={closeLabel} disabled={closeDisabled} onClick={onDismiss}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-subtle px-5 py-4">{footer}</div>
          )}
        </div>
      </dialog>
    </>
  );
}
