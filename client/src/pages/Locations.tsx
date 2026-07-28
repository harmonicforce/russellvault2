// Storage Locations — create, rename, and retire the physical places
// inventory lives. Human labels only; no workspace or location UUID is ever
// shown. Not a warehouse-management system: no drag-and-drop, no maps, no
// bulk import.

import { useEffect, useMemo, useState } from 'react';
import { Archive, MapPin, Search } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createLocationsTransport, type StorageLocation } from '../lib/locationsApi';
import { LocationCreateForm } from '../components/LocationCreateForm';

function locationLabel(l: StorageLocation): string {
  return l.display_name || l.location_code;
}

export default function Locations() {
  const { workspace, getAccessToken } = useWorkspace();
  const transport = useMemo(
    () => createLocationsTransport(getAccessToken, () => workspace?.id ?? null),
    [getAccessToken, workspace?.id]
  );

  const [active, setActive] = useState<readonly StorageLocation[]>([]);
  const [retired, setRetired] = useState<readonly StorageLocation[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [showRetired, setShowRetired] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([transport.list(false), transport.list(true), transport.referenceCounts()])
      .then(([activeRows, allRows, refCounts]) => {
        setActive(activeRows);
        setRetired(allRows.filter((l) => l.retired_at !== null));
        setCounts(refCounts);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (workspace) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  if (!workspace) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to manage locations.</div>;
  }

  const filtered = (showRetired ? retired : active).filter((l) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return locationLabel(l).toLowerCase().includes(q) || l.location_code.toLowerCase().includes(q);
  });

  const parentName = (l: StorageLocation): string | null => {
    if (!l.parent_id) return null;
    const parent = active.find((p) => p.id === l.parent_id) ?? retired.find((p) => p.id === l.parent_id);
    return parent ? locationLabel(parent) : null;
  };

  const retireLocation = (l: StorageLocation) => {
    if (!window.confirm(`Retire "${locationLabel(l)}"? It will stop appearing as an option for new inventory.`)) {
      return;
    }
    setBusyCode(l.location_code);
    transport
      .retire(l.location_code)
      .then(load)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusyCode(null));
  };

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <MapPin className="h-5 w-5 text-accent" /> Storage Locations
        </h1>
        <p className="mt-1 text-xs text-ink-muted">
          Everywhere inventory can live in {workspace.name} — shelves, bins, rooms. Add as many as you need.
        </p>
      </header>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-3 text-sm font-semibold">Add a location</h2>
        <LocationCreateForm transport={transport} parentOptions={active} onCreated={load} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRetired(false)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${!showRetired ? 'bg-accent/12 text-accent-strong' : 'text-ink-secondary hover:bg-surface-2'}`}
            >
              Active ({active.length})
            </button>
            <button
              type="button"
              onClick={() => setShowRetired(true)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${showRetired ? 'bg-accent/12 text-accent-strong' : 'text-ink-secondary hover:bg-surface-2'}`}
            >
              Retired ({retired.length})
            </button>
          </div>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
            <input
              className="rounded border border-hairline bg-surface-0 py-1.5 pl-7 pr-2 text-sm"
              placeholder="Search locations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search locations"
            />
          </label>
        </div>

        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {showRetired ? 'No retired locations.' : 'No locations yet — add one above.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full text-sm">
              <thead className="bg-surface-1 text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Parent location</th>
                  <th className="px-3 py-2">Items</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filtered.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-medium">{locationLabel(l)}</td>
                    <td className="px-3 py-2 text-ink-muted">{l.location_code}</td>
                    <td className="px-3 py-2 text-ink-muted">{parentName(l) ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-muted">{counts[l.id] ?? 0}</td>
                    <td className="px-3 py-2 text-right">
                      {!showRetired && (
                        <button
                          type="button"
                          onClick={() => retireLocation(l)}
                          disabled={busyCode === l.location_code}
                          className="inline-flex items-center gap-1 rounded border border-hairline px-2 py-1 text-xs font-medium text-ink-secondary hover:bg-surface-2 disabled:opacity-50"
                        >
                          <Archive className="h-3 w-3" /> Retire
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
