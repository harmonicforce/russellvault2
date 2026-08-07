import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type { LocationsTransport, StorageLocation } from '../lib/locationsApi';

/** Shared "create a storage location" form: code + optional display name +
 * optional parent. Used by first-run setup, the Locations page, and Quick
 * Add's inline "create location" path so the three surfaces never drift. */
export function LocationCreateForm({
  transport,
  parentOptions,
  onCreated,
  compact = false,
}: {
  transport: LocationsTransport;
  parentOptions: readonly StorageLocation[];
  onCreated: (location: StorageLocation) => void;
  compact?: boolean;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parentCode, setParentCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError('A location code is required.');
      return;
    }
    setBusy(true);
    setError(null);
    transport
      .create(trimmedCode, name.trim() || null, parentCode || null)
      .then((loc) => {
        setCode('');
        setName('');
        setParentCode('');
        onCreated(loc);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className={compact ? 'flex flex-wrap gap-2' : 'grid gap-2 sm:grid-cols-2'}>
        <label className="block text-sm">
          <span className="text-ink-muted">Location code</span>
          <input
            className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 text-sm"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. SHELF-A1"
            aria-label="Location code"
          />
        </label>
        <label className="block text-sm">
          <span className="text-ink-muted">Display name (optional)</span>
          <input
            className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Shelf A, Bin 1"
            aria-label="Location display name"
          />
        </label>
      </div>
      {parentOptions.length > 0 && (
        <label className="block text-sm">
          <span className="text-ink-muted">Parent location (optional)</span>
          <select
            className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 text-sm"
            value={parentCode}
            onChange={(e) => setParentCode(e.target.value)}
            aria-label="Parent location"
          >
            <option value="">No parent — top level</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.location_code}>
                {p.display_name || p.location_code}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Add location
      </button>
    </form>
  );
}
