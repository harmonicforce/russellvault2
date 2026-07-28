// Daily Workbench — "what inventory work needs attention now?"
//
// Every queue is derived from real stored facts (current location, media
// records, open intake sessions), never from a guess about what the operator
// probably meant to do.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ClipboardList, ListChecks, MapPin, PackagePlus } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createInventoryData } from '../lib/inventoryData';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import { createIntakeTransport, type IntakeSessionListItem } from '../lib/intakeApi';
import { tokenProviderFromClient } from '../lib/tokenProvider';

interface QueueRow {
  subject_kind: 'item' | 'lot';
  subject_id: string;
  subject_public_id: string;
  display_name: string;
  created_at: string;
}

function QueueCard({
  icon, title, count, explanation, rows, actionLabel, onOpen, onViewAll,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  explanation: string;
  rows: readonly QueueRow[];
  actionLabel: string;
  onOpen: (row: QueueRow) => void;
  onViewAll?: () => void;
}) {
  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">{icon} {title}</h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{count}</span>
      </div>
      <p className="mb-3 text-xs text-ink-muted">{explanation}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing waiting here.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={`${r.subject_kind}-${r.subject_id}`}>
              <button
                type="button"
                onClick={() => onOpen(r)}
                className="flex w-full items-center justify-between gap-2 rounded border border-hairline px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                <span className="min-w-0 truncate">{r.display_name}</span>
                <span className="shrink-0 text-xs text-accent-strong">{actionLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {onViewAll && count > 0 && (
        <button type="button" onClick={onViewAll} className="mt-2 text-xs text-accent-strong underline">
          {count > rows.length ? `View all ${count} in inventory` : 'View in inventory'}
        </button>
      )}
    </section>
  );
}

export default function Workbench() {
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );
  const data = useMemo(
    () => (workspace ? createInventoryData(client as never, workspace.id) : null),
    [client, workspace]
  );
  const intake = useMemo(() => {
    if (!config) return null;
    const shadow = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createIntakeTransport(tokenProviderFromClient(shadow));
  }, [config]);

  const [counts, setCounts] = useState({ needsLocation: 0, needsPhotos: 0, total: 0 });
  const [needsLocation, setNeedsLocation] = useState<QueueRow[]>([]);
  const [needsPhotos, setNeedsPhotos] = useState<QueueRow[]>([]);
  const [openSessions, setOpenSessions] = useState<readonly IntakeSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!data || !workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [c, loc, photos] = await Promise.all([
        data.workQueueCounts(),
        data.workQueue('needs_location'),
        data.workQueue('needs_photos'),
      ]);
      setCounts(c);
      setNeedsLocation(loc);
      setNeedsPhotos(photos);
      if (intake) {
        const page = await intake.listSessions(workspace.id, 10, 0);
        setOpenSessions(page.sessions.filter((s) => s.state === 'open'));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [data, workspace, intake]);

  useEffect(() => { load(); }, [load]);

  if (!workspace || !data) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to see today's work.</div>;
  }

  const open = (r: QueueRow) =>
    navigate(r.subject_kind === 'item' ? `/inventory/current/${r.subject_id}` : `/inventory/lots/${r.subject_id}`);

  return (
    <div className="max-w-5xl space-y-5 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="h-5 w-5 text-accent" /> Daily Workbench
        </h1>
        <p className="mt-1 text-xs text-ink-muted">
          What needs attention in {workspace.name} right now.
        </p>
      </header>

      {error && <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>}
      {loading && <p className="text-sm text-ink-muted">Loading…</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <QueueCard
          icon={<MapPin className="h-4 w-4 text-accent" />}
          title="Needs location"
          count={counts.needsLocation}
          explanation="Inventory with no active storage location, or whose location was retired."
          rows={needsLocation}
          actionLabel="Choose location"
          onOpen={open}
          // The same predicate the count came from, applied in the database:
          // this opens exactly the records counted above, not a page of them.
          onViewAll={() => navigate('/inventory/current?needsLocation=1')}
        />
        <QueueCard
          icon={<Camera className="h-4 w-4 text-accent" />}
          title="Needs photos"
          count={counts.needsPhotos}
          explanation="Inventory with no photos yet."
          rows={needsPhotos}
          actionLabel="Add photos"
          onOpen={open}
          onViewAll={() => navigate('/inventory/current?needsPhotos=1')}
        />

        <section className="rounded-lg border border-hairline bg-surface-1 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="h-4 w-4 text-accent" /> Open intake sessions
            </h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{openSessions.length}</span>
          </div>
          <p className="mb-3 text-xs text-ink-muted">Sessions you started but have not finished.</p>
          {openSessions.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing waiting here.</p>
          ) : (
            <ul className="space-y-1">
              {openSessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => navigate('/quick-add', { state: { resumeSessionId: s.id } })}
                    className="flex w-full items-center justify-between gap-2 rounded border border-hairline px-3 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    <span className="min-w-0 truncate">{s.label || 'Untitled session'}</span>
                    <span className="shrink-0 text-xs text-accent-strong">Resume</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-hairline bg-surface-1 p-4">
          <h2 className="mb-3 text-sm font-semibold">Quick actions</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => navigate('/quick-add')}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
            >
              <PackagePlus className="h-4 w-4" /> Add inventory
            </button>
            <button
              onClick={() => navigate('/scan')}
              className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
            >
              Scan or find
            </button>
            <button
              onClick={() => navigate('/inventory/current')}
              className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
            >
              View inventory
            </button>
            <button
              onClick={() => navigate('/locations')}
              className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
            >
              Manage locations
            </button>
          </div>
          <p className="mt-3 text-xs text-ink-muted">{counts.total} inventory records in this workspace.</p>
        </section>
      </div>
    </div>
  );
}
