// Active workspace, caller role, identity, switching, and sign out.
//
// Every fact here comes from WorkspaceContext. The shell holds no workspace
// state of its own and never infers the active workspace from the URL — a
// route is a place the operator navigated to, not a statement about which
// workspace is authoritative. It also reads no business table directly.

import { useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { IconButton } from '../../design-system';
import { useWorkspace } from '../../lib/workspaceContext';

export function WorkspaceArea() {
  const { workspace, workspaces, selectWorkspace, signOut, email } = useWorkspace();
  const [switching, setSwitching] = useState(false);

  if (!workspace) return null;

  const canSwitch = workspaces.length > 1;

  return (
    <div className="border-b border-hairline px-4 py-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {canSwitch && switching ? (
            <select
              autoFocus
              aria-label="Active workspace"
              className="w-full rounded-control border border-hairline bg-surface-0 px-1.5 py-1 text-xs text-ink"
              value={workspace.id}
              onChange={(e) => {
                selectWorkspace(e.target.value);
                setSwitching(false);
              }}
              onBlur={() => setSwitching(false)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => canSwitch && setSwitching(true)}
              className="flex items-center gap-1 truncate font-semibold text-ink"
              title={canSwitch ? 'Switch workspace' : undefined}
              aria-label={canSwitch ? `Switch workspace, currently ${workspace.name}` : undefined}
            >
              <span className="truncate">{workspace.name}</span>
              {canSwitch && <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />}
            </button>
          )}
          <div className="mt-0.5 capitalize text-ink-muted">
            {workspace.role}{email ? ` · ${email}` : ''}
          </div>
        </div>
        {/*
          S1.6.7 REPAIR — this was a bare `p-1.5` button and measured 28x28 in a
          real browser, well under a usable touch target for the one control
          that ends the session. `IconButton` already owns the 44x44 minimum and
          the accessible-name requirement, so the fix is to use the primitive
          rather than to hand-tune padding here a second time.
        */}
        <IconButton label="Sign out" tooltip="Sign out" onClick={signOut} className="shrink-0">
          <LogOut className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
