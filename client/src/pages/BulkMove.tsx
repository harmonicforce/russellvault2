// Move several records in one operation.
//
// The operator sees exactly what will move, from where, to where, BEFORE
// anything is written — and afterwards sees what actually happened to each
// record. A batch that half-succeeds says so, keeps the successful moves, and
// offers to retry only the failures.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, MapPin, Printer, RotateCcw, X,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createInventoryData, type RecordOverviewRow } from '../lib/inventoryData';
import { createLocationsTransport, type StorageLocation } from '../lib/locationsApi';
import { LabelPreview } from '../components/InventoryPanels';
import { labelForRecord, type LabelView } from '../lib/labels';
import {
  explainIneligible, planMove, recordsToRetry, runMovePlan, summarize,
  type Destination, type MovableRecord, type MoveResult,
} from '../lib/bulkMove';

interface NavState {
  records?: { kind: 'item' | 'lot'; id: string }[];
}

export default function BulkMove() {
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const requested = (location.state as NavState | null)?.records ?? [];

  const data = useMemo(
    () => (workspace ? createInventoryData(client as never, workspace.id) : null),
    [client, workspace]
  );
  const locationsTransport = useMemo(
    () => createLocationsTransport(client as never, () => workspace?.id ?? null),
    [client, workspace?.id]
  );

  const [records, setRecords] = useState<RecordOverviewRow[]>([]);
  const [locations, setLocations] = useState<readonly StorageLocation[]>([]);
  const [destinationId, setDestinationId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<MoveResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState<LabelView[] | null>(null);

  // Router state hands back a fresh array object every render, so the identity
  // of the selection has to come from its contents rather than the reference —
  // otherwise the load effect below re-runs forever.
  const idsKey = requested.map((r) => r.id).join(',');
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);

  // Re-read every selected record from the database rather than trusting what
  // the list page had in memory: a selection can be minutes old, and the
  // locations shown on the confirmation screen have to be the current ones.
  const load = useCallback(async () => {
    if (!data || ids.length === 0) { setLoading(false); return; }
    setLoading(true);
    try {
      const [rows, locs] = await Promise.all([
        data.recordsByIds(ids),
        locationsTransport.list(true).catch(() => [] as StorageLocation[]),
      ]);
      setRecords(rows);
      setLocations(locs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [data, ids, locationsTransport]);

  useEffect(() => { load(); }, [load]);

  const movable: MovableRecord[] = records.map((r) => ({
    record_kind: r.record_kind,
    record_id: r.record_id,
    record_public_id: r.record_public_id,
    product_display_name: r.product_display_name,
    tracking_mode: r.tracking_mode,
    quantity: r.quantity,
    location_id: r.location_id,
    location_code: r.location_code,
    location_display_name: r.location_display_name,
  }));

  const destination: Destination | null = useMemo(() => {
    const found = locations.find((l) => l.id === destinationId);
    if (!found) return null;
    return {
      id: found.id,
      location_code: found.location_code,
      display_name: found.display_name,
      retired_at: found.retired_at,
    };
  }, [locations, destinationId]);

  const plan = useMemo(() => planMove(movable, destination), [movable, destination]);

  const run = async (subset?: MovableRecord[]) => {
    if (!data) return;
    const target = subset ? planMove(subset, destination) : plan;
    if (target.blocker) return;
    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: target.moves.length });
    try {
      const out = await runMovePlan(
        target,
        { moveItem: data.moveItem, moveLot: data.moveLot },
        note.trim() || null,
        (done, total) => setProgress({ done, total })
      );
      setResults(out);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  if (!workspace || !data) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to move inventory.</div>;
  }

  const activeLocations = locations.filter((l) => !l.retired_at);
  const summary = results ? summarize(results) : null;
  const retryable = results ? recordsToRetry(results) : [];

  const locationName = (r: { location_display_name: string | null; location_code: string | null }) =>
    r.location_display_name || r.location_code || 'No location';

  return (
    <div className="max-w-3xl space-y-5 p-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <MapPin className="h-5 w-5 text-accent" /> Move selected records
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Each record moves through the same governed function a single move uses, and records its
          own movement history entry.
        </p>
      </header>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : records.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            No records were selected. Choose records in Current Inventory, then use Move selected.
          </p>
          <button
            onClick={() => navigate('/inventory/current')}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-on-accent"
          >
            Go to Current Inventory
          </button>
        </div>
      ) : (
        <>
          {!results && (
            <section className="space-y-3 rounded-lg border border-hairline bg-surface-1 p-4">
              <label className="block text-sm font-medium">
                Destination
                <select
                  className="mt-1 w-full rounded-lg border border-hairline bg-surface-1 px-2.5 py-2 text-sm"
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                  aria-label="Destination location"
                >
                  <option value="">Choose a location…</option>
                  {activeLocations.map((l) => (
                    <option key={l.id} value={l.id}>{l.display_name || l.location_code}</option>
                  ))}
                </select>
              </label>
              {/* Retired locations are absent from the list above; this states
                  the rule rather than leaving an empty dropdown unexplained. */}
              {activeLocations.length === 0 && (
                <p className="text-xs text-amber-600">
                  There are no active locations. Add one in Locations first.
                </p>
              )}
              <label className="block text-sm font-medium">
                Note (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-hairline bg-surface-1 px-2.5 py-2 text-sm"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why these are moving"
                />
              </label>
            </section>
          )}

          <section className="overflow-hidden rounded-lg border border-hairline">
            <table className="w-full text-sm">
              <thead className="bg-surface-1 text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Record</th>
                  <th className="px-3 py-2">From</th>
                  <th className="px-3 py-2">{results ? 'Result' : 'To'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {(results ?? plan.moves).map((entry) => {
                  const record = entry.record;
                  const outcome = 'outcome' in entry ? entry.outcome : null;
                  const planned = 'eligible' in entry ? entry : null;
                  return (
                    <tr key={record.record_id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{record.product_display_name}</div>
                        <div className="font-mono text-xs text-ink-muted">{record.record_public_id}</div>
                        <div className="text-xs text-ink-muted">
                          {record.record_kind === 'item'
                            ? 'Individual'
                            : `Quantity lot · ${record.quantity}`}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{locationName(record)}</td>
                      <td className="px-3 py-2">
                        {outcome ? (
                          outcome.state === 'moved' ? (
                            <span className="flex items-center gap-1 text-success">
                              <Check className="h-4 w-4" /> Moved
                            </span>
                          ) : outcome.state === 'skipped' ? (
                            <span className="text-xs text-ink-muted">
                              {explainIneligible(outcome.reason)}
                            </span>
                          ) : (
                            <span className="flex items-start gap-1 text-danger">
                              <X className="mt-0.5 h-4 w-4 shrink-0" />
                              <span className="text-xs">{outcome.message}</span>
                            </span>
                          )
                        ) : planned && !planned.eligible ? (
                          <span className="text-xs text-ink-muted">
                            {explainIneligible(planned.reason!)}
                          </span>
                        ) : (
                          <span className="text-ink-muted">
                            {destination
                              ? destination.display_name || destination.location_code
                              : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {summary && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                summary.failed > 0
                  ? 'border-amber-400 bg-amber-50 text-amber-900'
                  : 'border-success/40 bg-success/8'
              }`}
            >
              {summary.failed > 0 && <AlertTriangle className="mr-1 inline h-4 w-4" />}
              {summary.moved} moved
              {summary.failed > 0 && `, ${summary.failed} failed`}
              {summary.skipped > 0 && `, ${summary.skipped} skipped`}.
              {summary.failed > 0 && ' The records that moved stayed moved.'}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!results && (
              <button
                onClick={() => run()}
                disabled={running || plan.blocker !== null}
                title={plan.blocker ?? undefined}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
              >
                {running
                  ? `Moving ${progress?.done ?? 0} of ${progress?.total ?? 0}…`
                  : `Move ${plan.eligibleCount} record${plan.eligibleCount === 1 ? '' : 's'}`}
              </button>
            )}
            {results && retryable.length > 0 && (
              <button
                onClick={() => run(retryable)}
                disabled={running}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> Retry {retryable.length} failed
              </button>
            )}
            {summary && summary.moved > 0 && (
              <button
                onClick={() => setPrinting(
                  records
                    .filter((r) => results?.some(
                      (x) => x.record.record_id === r.record_id && x.outcome.state === 'moved'))
                    .map(labelForRecord)
                )}
                className="flex items-center gap-1.5 rounded-lg border border-hairline px-4 py-2 text-sm font-medium"
              >
                <Printer className="h-4 w-4" /> Print replacement labels
              </button>
            )}
            {results && (
              <button
                onClick={() => navigate('/inventory/current')}
                className="rounded-lg border border-hairline px-4 py-2 text-sm font-medium"
              >
                Done
              </button>
            )}
          </div>

          {plan.blocker && !results && (
            <p className="text-sm text-ink-muted">{plan.blocker}</p>
          )}
        </>
      )}

      {printing && <LabelPreview labels={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
