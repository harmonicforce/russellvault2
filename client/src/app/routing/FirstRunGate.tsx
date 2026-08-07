// Blocks routed content behind first-run setup until the active workspace has
// completed it. Moved out of App.tsx with its behaviour unchanged.
//
// It wraps the ROUTES, not the shell. The operator still sees navigation, the
// workspace area, and the System Truth Region while setup is outstanding —
// which is what lets them switch workspace or read a dependency warning
// instead of being trapped on a setup screen with no context.

import type { ReactNode } from 'react';
import FirstRunSetup from '../../components/FirstRunSetup';
import { useWorkspace } from '../../lib/workspaceContext';

export function FirstRunGate({ children }: { children: ReactNode }) {
  const { workspace, loading } = useWorkspace();
  if (loading) return <div className="p-6 text-sm text-ink-muted">Loading workspace…</div>;
  if (workspace && workspace.setupCompletedAt === null) return <FirstRunSetup />;
  return <>{children}</>;
}
