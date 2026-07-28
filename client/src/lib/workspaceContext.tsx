// The active-workspace layer. One shared place that knows which workspace is
// selected, its display name, and the caller's role in it — every page reads
// this instead of asking the operator to type a workspace id.
//
// Selection persists locally (so a refresh keeps the same workspace) but is
// always revalidated against the caller's CURRENT memberships: a stored id
// that no longer applies (removed, or the workspace itself gone) silently
// falls back to another available workspace rather than surfacing a raw id
// or a dead selection.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, WorkspaceRole } from './database.types';
import type { Membership } from './authShell';

const STORAGE_KEY = 'rv.activeWorkspaceId';

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly role: WorkspaceRole;
  readonly skuPrefix: string;
  readonly setupCompletedAt: string | null;
}

export interface WorkspaceContextValue {
  readonly loading: boolean;
  readonly error: string | null;
  readonly email: string | null;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly workspace: WorkspaceSummary | null;
  readonly client: SupabaseClient<Database>;
  /** The signed-in user's id — needed when a row records who uploaded it. */
  readonly userId: string | null;
  getAccessToken(): Promise<string | null>;
  selectWorkspace(id: string): void;
  refresh(): Promise<void>;
  signOut(): void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStoredId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable (private mode, etc.) — selection just won't persist */
  }
}

export function WorkspaceProvider({
  client,
  email,
  userId = null,
  memberships,
  onSignOut,
  children,
}: {
  client: SupabaseClient<Database>;
  email: string | null;
  userId?: string | null;
  memberships: readonly Membership[];
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => readStoredId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const membershipsKey = memberships.map((m) => `${m.workspace_id}:${m.role}`).sort().join(',');
  const roleByWorkspace = useMemo(() => {
    const map = new Map<string, WorkspaceRole>();
    for (const m of memberships) map.set(m.workspace_id, m.role);
    return map;
  }, [membershipsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const ids = memberships.map((m) => m.workspace_id);
    if (ids.length === 0) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = (await client
        .from('workspaces')
        .select('id, name, sku_prefix, setup_completed_at')
        .in('id', ids)) as unknown as {
        data: { id: string; name: string; sku_prefix: string; setup_completed_at: string | null }[] | null;
        error: { message: string } | null;
      };
      if (qErr) throw new Error(qErr.message);
      const rows: WorkspaceSummary[] = (data ?? [])
        .map((w) => ({
          id: w.id,
          name: w.name,
          skuPrefix: w.sku_prefix,
          setupCompletedAt: w.setup_completed_at,
          role: roleByWorkspace.get(w.id) ?? 'viewer',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setWorkspaces(rows);
    } catch (e) {
      setError((e as Error).message);
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, membershipsKey, roleByWorkspace]);

  useEffect(() => {
    load();
  }, [load]);

  // Revalidate the active selection against what actually loaded. A stale
  // stored id (removed membership, deleted workspace) falls back to the
  // first available workspace; an empty list clears the selection entirely.
  const revalidated = useRef(false);
  useEffect(() => {
    if (loading) return;
    const stillValid = selectedId && workspaces.some((w) => w.id === selectedId);
    if (stillValid) {
      revalidated.current = true;
      return;
    }
    const fallback = workspaces.length > 0 ? workspaces[0].id : null;
    setSelectedId(fallback);
    writeStoredId(fallback);
    revalidated.current = true;
  }, [loading, workspaces, selectedId]);

  const selectWorkspace = useCallback((id: string) => {
    setSelectedId(id);
    writeStoredId(id);
  }, []);

  const workspace = useMemo(
    () => workspaces.find((w) => w.id === selectedId) ?? null,
    [workspaces, selectedId]
  );

  const getAccessToken = useCallback(async () => {
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  }, [client]);

  const value: WorkspaceContextValue = {
    loading,
    error,
    email,
    workspaces,
    workspace,
    client,
    userId,
    getAccessToken,
    selectWorkspace,
    refresh: load,
    signOut: onSignOut,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** Throws outside a WorkspaceProvider — every gated page expects one. */
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
