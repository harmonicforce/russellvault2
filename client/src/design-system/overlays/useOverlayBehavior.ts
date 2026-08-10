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
    (element) =>
      !element.hasAttribute('hidden') && !element.closest('[aria-hidden="true"]') && isTabbableRadio(element, panel),
  );
}

/**
 * Radio groups have ONE tab stop, not one per option.
 *
 * A browser gives the whole same-named group a single position in the tab
 * order — the checked option, or the first when none is checked — and reaches
 * the others with the arrow keys. A trap that counts every radio therefore
 * computes a "last focusable" the browser will never focus, so the wrap from
 * the end back to the start never fires and focus walks straight out of the
 * overlay.
 *
 * This is precisely what happened in the shell's navigation drawer: its three
 * theme radios inflated the list, and a real browser left the drawer on the
 * seventeenth Tab. jsdom could not reveal it, because jsdom does not implement
 * a tab order at all — every element there is simply "in the list".
 */
function isTabbableRadio(element: HTMLElement, panel: HTMLElement): boolean {
  if (!(element instanceof HTMLInputElement) || element.type !== 'radio') return true;
  // Matched by `name` property rather than a built selector, so a name needing
  // escaping cannot turn a correctness rule into a thrown exception.
  const group = [...panel.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
    (radio) => radio.name === element.name,
  );
  if (group.length === 0) return true;
  const checked = group.find((radio) => radio.checked);
  return checked ? checked === element : group[0] === element;
}

/**
 * Keep Tab inside a panel.
 *
 * Exported so the SHELL's navigation drawer can use the same implementation
 * rather than growing a second one. S1.6.2 shipped that drawer with
 * `aria-modal="true"` and no containment at all, deferring the trap to this
 * slice — and the shell was then never migrated onto it. jsdom could not catch
 * the gap, because it has no layout, no top layer and no real tab order; a real
 * browser walked straight out of the "modal" drawer into the page behind it on
 * the seventeenth Tab.
 *
 * Returns true when it handled the event.
 */
export function containTabWithin(panel: HTMLElement, event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== 'Tab') return false;

  const focusable = focusableWithin(panel);
  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus();
    return true;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  // Focus is somewhere the panel does not recognise — including the panel
  // itself moving forward, and any element outside it. Sending Tab onward from
  // there is how focus escapes a modal that has no browser-level containment.
  if (!panel.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  return false;
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

    const panel = panelRef.current;
    if (!panel) return;
    // One implementation, shared with the shell drawer.
    containTabWithin(panel, event);
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
