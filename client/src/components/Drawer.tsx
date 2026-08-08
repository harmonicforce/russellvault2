import type { ReactNode } from 'react';
import { Drawer as GovernedDrawer } from '../design-system';

/**
 * COMPATIBILITY WRAPPER for the pre-S1.6 Drawer.
 *
 * The previous implementation was a `div` with a `z-index`: no dialog role, no
 * accessible name, no Escape, no focus entry, no focus containment, no focus
 * restoration, and a backdrop exposed to assistive technology as an unnamed
 * clickable element. Its four consumers (Sales, Inventory, Purchases, Listings)
 * keep the same props — `open`, `onClose`, `title`, `children`, `width` — and
 * gain the governed overlay contract without being migrated.
 *
 * `width` was a Tailwind class string (`max-w-xl`), so it is forwarded through
 * the governed Drawer's layout escape hatch rather than being reinterpreted as
 * a semantic size. Guessing which semantic size a caller meant would silently
 * change four pages' geometry.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 'max-w-xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  return (
    <GovernedDrawer
      open={open}
      onDismiss={onClose}
      title={title}
      // The legacy prop is a ReactNode, so a string accessible name cannot be
      // derived from it in general. A plain string title is used directly; rich
      // content falls back to a generic but honest region name.
      titleText={typeof title === 'string' ? title : 'Record details'}
      widthClassName={width}
    >
      {children}
    </GovernedDrawer>
  );
}
