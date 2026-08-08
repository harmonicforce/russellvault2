import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

/**
 * The accessibility behaviour every governed modal overlay owes its operator.
 *
 * S1.6.2 deliberately did NOT build this. The shell's navigation drawer moves
 * focus in and returns it out, and its own comment says a general focus trap is
 * S1.6.3's job so the application does not end up with two competing overlay
 * systems. This is that job, and Dialog and Drawer both use it — which is the
 * point: one implementation, one set of behaviours, one place a defect gets
 * fixed.
 *
 * WHY A TRAP IS WRITTEN HERE AT ALL
 *
 * A browser's native modal `<dialog>` already contains focus. jsdom implements
 * neither `showModal()` nor the top layer, so a native-only implementation
 * would be unprovable in the test suite and would silently do nothing in the
 * fallback path. The trap below works identically in both, and the real-browser
 * geometry proof still belongs to S1.6.7.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Deliberately does NOT filter on `offsetParent` or computed geometry. jsdom
 * performs no layout, so every element there reports as unlaid-out and a
 * geometry-based filter would return an empty list and silently disable the
 * whole trap in the test environment — the classic case of a guard that passes
 * because it never ran. `hidden` and `aria-hidden` are declarative and mean the
 * same thing in both environments.
 */
function focusableWithin(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute('hidden') && !element.closest('[aria-hidden="true"]'),
  );
}

export interface OverlayBehaviorOptions {
  readonly open: boolean;
  /** Escape and backdrop route here. Never called when not dismissible. */
  readonly onDismiss: () => void;
  /**
   * Whether an incidental gesture may close the overlay. A caller sets this
   * false while a governed mutation is in flight, so a stray Escape cannot
   * discard a confirmation the operator is halfway through.
   */
  readonly dismissible: boolean;
  readonly panelRef: RefObject<HTMLElement | null>;
}

export interface OverlayBehavior {
  /** Attach to the panel. Handles Escape and Tab containment. */
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function useOverlayBehavior({ open, onDismiss, dismissible, panelRef }: OverlayBehaviorOptions): OverlayBehavior {
  // Held in a ref rather than state: restoring focus must not depend on a
  // render having happened, and the element must survive the close animation.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    if (panel) {
      const [first] = focusableWithin(panel);
      // The panel itself is the fallback so focus never escapes to the
      // document body, from which a keyboard operator restarts at the top of
      // the page behind the overlay they just opened.
      (first ?? panel).focus();
    }

    return () => {
      const target = returnFocusTo.current;
      // `document.contains` because the trigger may have been unmounted by the
      // very action that closed the overlay.
      if (target && document.contains(target)) target.focus();
    };
  }, [open, panelRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      // Always prevented, dismissible or not. A native modal dialog would
      // otherwise close itself through its own `cancel` behaviour and bypass
      // the caller's decision entirely.
      event.preventDefault();
      event.stopPropagation();
      if (dismissible) onDismiss();
      return;
    }

    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = focusableWithin(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { onKeyDown };
}

/**
 * Whether the platform can put a `<dialog>` in the top layer.
 *
 * When it can, the browser owns background inertness and the `::backdrop`
 * pseudo-element. When it cannot — jsdom, and any browser old enough to matter
 * — the overlay renders its own backdrop and marks itself `aria-modal`, so the
 * semantics survive even where the platform behaviour does not.
 */
export function supportsModalDialog(): boolean {
  return typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function';
}
