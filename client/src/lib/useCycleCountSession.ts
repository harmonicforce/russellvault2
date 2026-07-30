// Loading one cycle count, and surviving what happens to it while the page is open.
//
// The session's canonical state lives in the database, never in component
// memory. Every reload re-reads status, round, frozen scope and observations, so
// refreshing the browser mid-count loses nothing. Local storage holds no count
// state at all — an operator's progress must not depend on which device they
// happened to be holding.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from './workspaceContext';
import { createCycleCountApi, type CycleCountApi, type SessionBundle } from './cycleCountApi';
import { canonicalPath, describeStatusChange, type CycleCountStatus } from './cycleCount';

export interface CycleCountSessionState {
  readonly api: CycleCountApi | null;
  readonly bundle: SessionBundle | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** Set when another operator moved the session on under us. */
  readonly statusChange: string | null;
  readonly dismissStatusChange: () => void;
  readonly reload: () => Promise<void>;
  readonly setError: (message: string | null) => void;
}

/**
 * @param expectedStatuses the statuses this route is allowed to render. A
 * session in any other status is sent to the page that belongs to it, so a
 * completed count can never land on a screen offering controls the database
 * would refuse.
 */
export function useCycleCountSession(
  sessionId: string | undefined,
  expectedStatuses: readonly CycleCountStatus[]
): CycleCountSessionState {
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();

  const api = useMemo(
    () => (workspace ? createCycleCountApi(client as never, workspace.id) : null),
    [client, workspace]
  );

  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusChange, setStatusChange] = useState<string | null>(null);
  const lastStatus = useRef<CycleCountStatus | null>(null);

  const reload = useCallback(async () => {
    if (!api || !sessionId) return;
    setLoading(true);
    try {
      const next = await api.getSession(sessionId);
      setBundle(next);
      setError(null);

      if (!next.found || !next.session) return;
      const status = next.session.status;

      // Announce a change somebody else made before moving the operator.
      if (lastStatus.current && lastStatus.current !== status) {
        setStatusChange(describeStatusChange(lastStatus.current, status));
      }
      lastStatus.current = status;

      if (!expectedStatuses.includes(status)) {
        navigate(canonicalPath(sessionId, status), { replace: true });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // expectedStatuses is a literal array at each call site; depending on its
    // identity would reload forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, sessionId, navigate]);

  useEffect(() => { void reload(); }, [reload]);

  return {
    api, bundle, loading, error, statusChange,
    dismissStatusChange: () => setStatusChange(null),
    reload, setError,
  };
}
