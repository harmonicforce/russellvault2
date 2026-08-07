// The application composition root.
//
// This file used to own the shell, four navigation arrays, the workspace
// header, the first-run gate, mobile drawer state, and every route
// declaration. Those are now separate concerns under `src/app/`:
//
//   app/navigation  what is ADVERTISED  (one typed model, both surfaces)
//   app/routing     what is MOUNTED     (routes, first-run gate)
//   app/shell       the chrome around it
//   app/theme       the browser ThemeStore adapter
//
// What remains here is composition: resolve configuration once, choose the
// storage adapter, and put the routes inside the shell.

import { AppShell } from './app/shell/AppShell';
import { AppRoutes } from './app/routing/AppRoutes';
import { FirstRunGate } from './app/routing/FirstRunGate';
import { createDefaultThemeStore } from './app/theme/browserThemeStore';
import AuthShell from './components/AuthShell';
import { resolveAppConfig, type EnvLike } from './lib/appConfig';

// One source of configuration truth for the whole shell.
//
// `governed` mounts the governed routes and navigation. `legacy-only` mounts
// the legacy application, which the System Truth Region labels as
// non-authoritative so it is never mistaken for governed operation.
// `misconfigured` never gets this far: AuthShell fails closed before any route
// renders, rather than quietly serving the unauthenticated legacy app because
// one variable was dropped.
const APP_CONFIG = resolveAppConfig(import.meta.env as unknown as EnvLike);
const PROVENANCE_ENABLED = APP_CONFIG.mode === 'governed';

// Created once. The theme is device-local and deliberately not scoped to a
// user here: the store is built before AuthShell resolves a session, and
// reaching into auth state to name a storage key would couple presentation to
// business state for no operator-visible gain.
const THEME_STORE = createDefaultThemeStore();

export default function App() {
  return (
    <AuthShell>
      <AppShell config={APP_CONFIG} themeStore={THEME_STORE}>
        {PROVENANCE_ENABLED ? (
          <FirstRunGate>
            <AppRoutes provenanceEnabled={PROVENANCE_ENABLED} />
          </FirstRunGate>
        ) : (
          <AppRoutes provenanceEnabled={PROVENANCE_ENABLED} />
        )}
      </AppShell>
    </AuthShell>
  );
}
