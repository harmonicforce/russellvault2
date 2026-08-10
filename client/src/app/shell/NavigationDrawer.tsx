// The phone and tablet-portrait navigation drawer.
//
// SCOPE NOTE
//
// This is the SHELL's drawer, not a reusable overlay primitive. S1.6.3 owns the
// governed Dialog and Drawer primitives, and building a general focus-trap
// framework here would pre-empt that slice and leave two competing overlay
// systems to reconcile. What is implemented here is the accessible behaviour
// this one surface needs, and no claim is made that a reusable trap exists.
//
// Focus is moved INTO the drawer on open, CONTAINED while it is open, and
// returned to the trigger on close. The background is inert to pointer input
// (the backdrop covers it and the panel is above it), and the drawer is marked
// aria-modal so assistive technology treats the rest of the page as
// unavailable.
//
// S1.6.7 REPAIR — the containment was missing.
//
// This drawer shipped in S1.6.2 claiming `aria-modal="true"` while nothing
// actually held focus inside it, on the stated plan that S1.6.3 would own a
// reusable trap. S1.6.3 built that trap, and this surface was never migrated
// onto it. jsdom cannot detect the gap — it has no layout and no real tab
// order — so it survived every unit suite. A real browser walked out of the
// "modal" drawer into the page behind it on the seventeenth Tab, while
// assistive technology was still being told the rest of the page was inert.
//
// The fix reuses the design system's containment rather than growing a second
// copy of it here.

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { containTabWithin } from '../../design-system/overlays/useOverlayBehavior';

export interface NavigationDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Focus returns here on close, so the operator does not lose their place. */
  readonly returnFocusTo?: HTMLElement | null;
  readonly children: ReactNode;
}

export function NavigationDrawer({ open, onClose, returnFocusTo, children }: NavigationDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Move focus in on open, and back to the trigger on close. Without the
  // return step, dismissing the drawer drops focus to the document and the
  // keyboard operator restarts from the top of the page.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel).focus();
    return () => {
      if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus();
    };
  }, [open, returnFocusTo]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      {/*
        The backdrop dismisses on pointer, and is hidden from the accessibility
        tree on purpose. Exposing it as a second button named "Close navigation"
        would put two identically-named controls in the tree, so a screen-reader
        operator hears the same command twice with no way to tell them apart.
        Keyboard and AT users are served by the explicit close button and by
        Escape, which is the standard modal pattern.
      */}
      <div
        data-drawer-backdrop=""
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
            return;
          }
          if (panelRef.current) containTabWithin(panelRef.current, e);
        }}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-hidden border-r border-hairline bg-surface-1 shadow-overlay"
      >
        <div className="flex justify-end px-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
