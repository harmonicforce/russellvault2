// The persistent sidebar, from `lg` (1024px) upward.
//
// RESPONSIVE WIDTH
//
// Tablet landscape (1024–1279) gets a narrower rail than desktop. The old shell
// docked a fixed 240px at every size above `lg`, which on an iPad in landscape
// left governed record content noticeably short of width for no navigational
// benefit — the labels fit comfortably in less. Desktop (`xl`, 1280+) restores
// the roomier width where the viewport can afford it.
//
// The sidebar's job at every size is to stay out of the way of the record.

import type { ReactNode } from 'react';

export function AppSidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="hidden w-52 shrink-0 flex-col overflow-hidden border-r border-hairline bg-surface-1 lg:flex xl:w-60">
      {children}
    </aside>
  );
}
