// The governed application shell.
//
// The shell is fixed infrastructure. It communicates application identity, the
// active workspace, navigation, user context, theme preference, system-level
// truth, and the boundary of page content. It calculates no business fact, and
// it reads no governed table — every fact it shows comes from WorkspaceContext
// or from the health surface the System Truth Region already owned.
//
// RESPONSIVE ARCHITECTURE
//
//   phone            <640    compact bar + drawer, one content column
//   tablet portrait  640–1023 compact bar + drawer, comfortable density
//   tablet landscape 1024–1279 persistent narrow rail (lg)
//   desktop          1280–1535 persistent full sidebar (xl)
//   wide             1536+    same sidebar; the route decides its own width
//
// The shell fixes its own geometry only. It does not impose a maximum width on
// route content — how a record uses the space it is given belongs to the page,
// and stretching a detail view across a 1600px monitor because the monitor
// exists is a page-level decision that S1.6.5 and S1.6.6 will make.

import { useRef, useState, type ReactNode } from 'react';
import type { AppConfigState } from '../../lib/appConfig';
import type { ThemeStore } from '../../lib/theme';
import { buildNavigation } from '../navigation/navigationModel';
import { useThemePreference } from '../theme/useThemePreference';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { NavigationDrawer } from './NavigationDrawer';
import { ShellNavigationContent } from './ShellNavigationContent';
import { SystemTruthRegion } from './SystemTruthRegion';

export interface AppShellProps {
  readonly config: AppConfigState;
  /** Injected so tests and the browser supply their own persistence. */
  readonly themeStore: ThemeStore;
  /** Routed content. The shell never knows what page is showing. */
  readonly children: ReactNode;
}

export function AppShell({ config, themeStore, children }: AppShellProps) {
  const provenanceEnabled = config.mode === 'governed';
  const model = buildNavigation(config.mode);
  const [navOpen, setNavOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [preference, chooseTheme] = useThemePreference(themeStore);

  return (
    <div data-shell-root="" className="flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-ink">
      {/*
        Outside the routed subtree, so navigating cannot unmount it and no page
        — or any future arrangeable surface — can suppress it.
      */}
      <SystemTruthRegion provenanceEnabled={provenanceEnabled} appMode={config.mode} />

      <AppHeader ref={triggerRef} navOpen={navOpen} onOpenNav={() => setNavOpen(true)} />

      <NavigationDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        returnFocusTo={triggerRef.current}
      >
        <ShellNavigationContent
          model={model}
          showWorkspace={provenanceEnabled}
          preference={preference}
          onThemeChange={chooseTheme}
          themeIdPrefix="drawer-theme"
          onNavigate={() => setNavOpen(false)}
        />
      </NavigationDrawer>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar>
          <ShellNavigationContent
            model={model}
            showWorkspace={provenanceEnabled}
            preference={preference}
            onThemeChange={chooseTheme}
            themeIdPrefix="sidebar-theme"
          />
        </AppSidebar>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
