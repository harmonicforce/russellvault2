// The corrections queue — everything reported as wrong, and what happened to it.
//
// Approving is deliberately not the same as fixing. An approved correction sits
// here saying "yes, this is wrong" until someone re-enters the record properly
// and retires the original, which is the only way a committed identity fact
// ever changes.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileWarning } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createInventoryData, type CorrectionRow, type CorrectionState } from '../lib/inventoryData';
import { CorrectionReviewCard } from '../components/CorrectionPanels';

const FILTERS: readonly { key: string; label: string; states: CorrectionState[] }[] = [
  { key: 'needs_attention', label: 'Needs attention', states: ['open', 'approved'] },
  { key: 'open', label: 'Open', states: ['open'] },
  { key: 'approved', label: 'Approved', states: ['approved'] },
  { key: 'resolved', label: 'Resolved', states: ['resolved'] },
  { key: 'rejected', label: 'Rejected', states: ['rejected'] },
  { key: 'all', label: 'All', states: [] },
];

export default function Corrections() {
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();

  const data = useMemo(
    () => (workspace ? createInventoryData(client as never, workspace.id) : null),
    [client, workspace]
  );

  const [filterKey, setFilterKey] = useState('needs_attention');
  const [rows, setRows] = useState<CorrectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!data) return;
    setLoading(true);
    setError(null);
    try {
      const filter = FILTERS.find((f) => f.key === filterKey)!;
      setRows(await data.listCorrections(filter.states.length ? filter.states : undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [data, filterKey]);

  useEffect(() => { load(); }, [load]);

  if (!workspace || !data) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to review corrections.</div>;
  }

  const decide = async (c: CorrectionRow, decision: 'approve' | 'reject', note: string) => {
    setBusyId(c.id);
    setError(null);
    try {
      await data.reviewCorrection({
        correctionId: c.id,
        decision,
        note: note.trim() || null,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-3xl space-y-4 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <FileWarning className="h-5 w-5 text-accent" /> Corrections
        </h1>
        <p className="mt-1 text-xs text-ink-muted">
          Problems reported against committed records in {workspace.name}. Nothing here has changed
          a record — committed facts are corrected by superseding, never by editing.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilterKey(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              filterKey === f.key ? 'bg-accent/12 text-accent-strong' : 'text-ink-secondary hover:bg-surface-2'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {filterKey === 'needs_attention'
            ? 'Nothing is waiting on a decision.'
            : 'No corrections match that filter.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <div key={c.id}>
              <CorrectionReviewCard
                correction={c}
                busy={busyId === c.id}
                onDecide={(decision, note) => decide(c, decision, note)}
              />
              <button
                onClick={() => navigate(c.subject_kind === 'item'
                  ? `/inventory/current/${c.subject_id}`
                  : `/inventory/lots/${c.subject_id}`)}
                className="mt-1 text-xs text-accent underline"
              >
                Open the record
              </button>
            </div>
          ))}
        </ul>
      )}
    </div>
  );
}
