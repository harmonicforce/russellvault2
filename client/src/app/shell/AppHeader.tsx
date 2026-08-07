// The compact application bar for phone and tablet-portrait viewports.
//
// Hidden from `lg` upward, where the sidebar is permanently visible and a top
// bar would only consume vertical space that governed record content needs.

import { forwardRef } from 'react';
import { Menu } from 'lucide-react';
import { BrandMark } from './BrandMark';

export interface AppHeaderProps {
  readonly navOpen: boolean;
  readonly onOpenNav: () => void;
}

export const AppHeader = forwardRef<HTMLButtonElement, AppHeaderProps>(function AppHeader(
  { navOpen, onOpenNav },
  triggerRef,
) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-hairline bg-surface-1 px-3 py-2 lg:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-haspopup="dialog"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-control border border-hairline text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      <BrandMark compact />
    </div>
  );
});
