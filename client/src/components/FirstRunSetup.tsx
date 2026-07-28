// First-run setup: shown once, right after a workspace is created, before the
// rest of the app is available. Collects the (already-known) workspace name
// for confirmation, an optional SKU prefix, and at least one storage
// location. Completion is saved on the workspace itself (setup_completed_at)
// so a returning user never sees this again.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, Vault } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createLocationsTransport, type StorageLocation } from '../lib/locationsApi';
import { LocationCreateForm } from './LocationCreateForm';

export default function FirstRunSetup() {
  const { workspace, client, getAccessToken, refresh, signOut } = useWorkspace();
  const [skuPrefix, setSkuPrefix] = useState(workspace?.skuPrefix ?? 'RV-N-');
  const [locations, setLocations] = useState<readonly StorageLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transport = useMemo(
    () => createLocationsTransport(getAccessToken, () => workspace?.id ?? null),
    [getAccessToken, workspace?.id]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingLocations(true);
    transport
      .list()
      .then((rows) => {
        if (!cancelled) setLocations(rows);
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLocations(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transport]);

  if (!workspace) return null;

  const canFinish = locations.length > 0;
  const isOwner = workspace.role === 'owner';

  const finishSetup = (e: FormEvent) => {
    e.preventDefault();
    if (!canFinish) return;
    setFinishing(true);
    setError(null);
    const trimmedPrefix = skuPrefix.trim() || 'RV-N-';
    const updateClient = client as unknown as {
      from(table: 'workspaces'): {
        update(row: { sku_prefix: string; setup_completed_at: string }): {
          eq(column: 'id', value: string): Promise<{ error: { message: string } | null }>;
        };
      };
    };
    updateClient
      .from('workspaces')
      .update({ sku_prefix: trimmedPrefix, setup_completed_at: new Date().toISOString() })
      .eq('id', workspace.id)
      .then(({ error: updateError }) => {
        if (updateError) throw new Error(updateError.message);
        return refresh();
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setFinishing(false));
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-lg space-y-5 rounded-lg border border-hairline bg-surface-1 p-6">
        <header className="flex items-center gap-2">
          <Vault className="h-5 w-5 text-accent" />
          <div>
            <h1 className="text-lg font-semibold">Set up {workspace.name}</h1>
            <p className="text-xs text-ink-muted">A couple of quick things before you start adding inventory.</p>
          </div>
        </header>

        {!isOwner ? (
          <div className="rounded border border-hairline bg-surface-0 p-3 text-sm text-ink-muted">
            {workspace.name} hasn't finished setup yet. Ask the workspace owner to complete first-run setup, or
            <button type="button" onClick={signOut} className="ml-1 underline">
              sign out
            </button>
            .
          </div>
        ) : (
          <form onSubmit={finishSetup} className="space-y-5">
            <label className="block text-sm">
              <span className="text-ink-muted">SKU prefix (optional)</span>
              <input
                className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 font-mono text-sm"
                value={skuPrefix}
                onChange={(e) => setSkuPrefix(e.target.value)}
                aria-label="SKU prefix"
              />
              <span className="mt-1 block text-xs text-ink-muted">
                Used as the prefix for automatically generated SKUs. The default shown works fine if you're not sure.
              </span>
            </label>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Add your first storage location</h2>
              <p className="text-xs text-ink-muted">
                A location is anywhere inventory physically lives — a shelf, a bin, a room. You can add more later.
              </p>
              {loadingLocations ? (
                <p className="text-xs text-ink-muted">Loading…</p>
              ) : locations.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {locations.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 rounded border border-hairline bg-surface-0 px-2 py-1.5">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="font-medium">{l.display_name || l.location_code}</span>
                      {l.display_name && <span className="text-xs text-ink-muted">({l.location_code})</span>}
                    </li>
                  ))}
                </ul>
              ) : null}
              <LocationCreateForm
                transport={transport}
                parentOptions={locations}
                onCreated={(loc) => setLocations((prev) => [...prev, loc])}
                compact
              />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={signOut} className="text-xs text-ink-muted underline">
                Sign out
              </button>
              <button
                type="submit"
                disabled={!canFinish || finishing}
                title={canFinish ? undefined : 'Add at least one storage location to continue'}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {finishing ? 'Finishing…' : 'Finish setup'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
