// Daily Workbench — "what inventory work needs attention now?"
//
// Every queue is derived from real stored facts (current location, media
// records, open intake sessions), never from a guess about what the operator
// probably meant to do.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ClipboardList, FileWarning, HelpCircle, ListChecks, MapPin, PackagePlus, Tags } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createInventoryData } from '../lib/inventoryData';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import {
  READINESS_LABELS, createListingPrepTransport, type PrepSummary,
} from '../lib/listingPrepApi';
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
  count: number | null;
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
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{count ?? '—'}</span>
      </div>
      <p className="mb-3 text-xs text-ink-muted">{explanation}</p>
      {rows.length === 0 && count === 0 ? (
        <p className="text-sm text-ink-muted">Nothing waiting here.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Use the link below to review this queue.</p>
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
      {onViewAll && count !== null && count > 0 && (
        <button type="button" onClick={onViewAll} className="mt-2 text-xs text-accent-strong underline">
          {count > rows.length ? `View all ${count} in inventory` : 'View in inventory'}
        </button>
      )}
    </section>
  );
}

export default function Workbench() {
  const { workspace, client } = useWorkspace();
  const workspaceId = workspace?.id ?? null;
  const navigate = useNavigate();
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );
  const data = useMemo(
    () => (workspaceId ? createInventoryData(client as never, workspaceId) : null),
    [client, workspaceId]
  );
  const intake = useMemo(() => {
    if (!config) return null;
    const shadow = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createIntakeTransport(tokenProviderFromClient(shadow));
  }, [config]);

  const listingPrepTransport = useMemo(
    () => createListingPrepTransport(tokenProviderFromClient(client), () => workspaceId),
    [client, workspaceId]
  );

  const [counts, setCounts] = useState({ needsLocation: 0, needsPhotos: 0, total: 0 });
  const [opsCounts, setOpsCounts] = useState({
    unclassified: 0, needsConditionDetails: 0, zeroQuantity: 0,
  });
  const [unclassified, setUnclassified] = useState<QueueRow[]>([]);
  const [needsCondition, setNeedsCondition] = useState<QueueRow[]>([]);
  const [openCorrections, setOpenCorrections] = useState<number | null>(null);
  const [needsLocation, setNeedsLocation] = useState<QueueRow[]>([]);
  const [needsPhotos, setNeedsPhotos] = useState<QueueRow[]>([]);
  const [openSessions, setOpenSessions] = useState<readonly IntakeSessionListItem[]>([]);
  const [openSessionCount, setOpenSessionCount] = useState(0);
  const [prepSummary, setPrepSummary] = useState<PrepSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState(false);
  const [intakeError, setIntakeError] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!data || !workspaceId) return;
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    setCorrectionError(false);
    // A disabled/unconfigured intake transport is an unavailable data source,
    // not evidence that the workspace has zero open sessions.
    setIntakeError(!intake);
    setCounts({ needsLocation: 0, needsPhotos: 0, total: 0 });
    setOpsCounts({ unclassified: 0, needsConditionDetails: 0, zeroQuantity: 0 });
    setNeedsLocation([]); setNeedsPhotos([]); setUnclassified([]); setNeedsCondition([]);
    setOpenCorrections(null); setOpenSessions([]); setOpenSessionCount(0); setPrepSummary(null);
    try {
      const [c, loc, photos, ops, unclassifiedRows, conditionRows] = await Promise.all([
        data.workQueueCounts(),
        data.workQueue('needs_location'),
        data.workQueue('needs_photos'),
        data.operationsQueueCounts(),
        data.operationsQueueRows('unclassified'),
        data.operationsQueueRows('needs_condition_details'),
      ]);
      if (activeRequest !== requestId.current) return;
      setCounts(c);
      setNeedsLocation(loc);
      setNeedsPhotos(photos);
      setOpsCounts(ops);
      // The record stream and the work queue name their columns differently;
      // this is the one place that difference is reconciled.
      const asQueueRow = (r: {
        record_kind: 'item' | 'lot'; record_id: string;
        record_public_id: string; product_display_name: string; created_at: string;
      }): QueueRow => ({
        subject_kind: r.record_kind,
        subject_id: r.record_id,
        subject_public_id: r.record_public_id,
        display_name: r.product_display_name,
        created_at: r.created_at,
      });
      setUnclassified(unclassifiedRows.map(asQueueRow));
      setNeedsCondition(conditionRows.map(asQueueRow));
      const [corrections, prep, sessions] = await Promise.allSettled([
        data.openCorrectionCount(),
        listingPrepTransport.summary(),
        intake ? intake.listSessions(workspaceId, 10, 0, 'open') : Promise.resolve(null),
      ]);
      if (activeRequest !== requestId.current) return;
      if (corrections.status === 'fulfilled') setOpenCorrections(corrections.value);
      else setCorrectionError(true);
      if (prep.status === 'fulfilled') setPrepSummary(prep.value);
      if (sessions.status === 'fulfilled' && sessions.value) {
        setOpenSessions(sessions.value.sessions);
        setOpenSessionCount(sessions.value.total);
      } else if (intake) setIntakeError(true);
    } catch (e) {
      if (activeRequest === requestId.current) setError((e as Error).message);
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }, [data, workspaceId, intake, listingPrepTransport]);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

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
          explanation="Inventory with no recorded photos yet. Required-angle readiness and photo issues are tracked separately in Photo Issues."
          rows={needsPhotos}
          actionLabel="Add photos"
          onOpen={open}
          onViewAll={() => navigate('/inventory/current?needsPhotos=1')}
        />
        <QueueCard
          icon={<HelpCircle className="h-4 w-4 text-accent" />}
          title="Unclassified category"
          count={opsCounts.unclassified}
          explanation="Records whose stored facts do not identify an exact category. Nothing was guessed — these need an operator to say what they are."
          rows={unclassified}
          actionLabel="Review"
          onOpen={open}
          onViewAll={() => navigate('/inventory/current?subtype=unclassified')}
        />
        <QueueCard
          icon={<ClipboardList className="h-4 w-4 text-accent" />}
          title="Needs condition details"
          count={opsCounts.needsConditionDetails}
          explanation="No condition or grade recorded. These cannot be listed honestly until someone assesses them."
          rows={needsCondition}
          actionLabel="Add details"
          onOpen={open}
          onViewAll={() => navigate('/inventory/current?needsConditionDetails=1')}
        />
        <QueueCard
          icon={<FileWarning className="h-4 w-4 text-accent" />}
          title="Open corrections"
          count={openCorrections}
          explanation="Problems reported against committed records, waiting on a decision or on a corrected record to replace them."
          rows={[]}
          actionLabel="Review"
          onOpen={() => navigate('/corrections')}
          onViewAll={() => navigate('/corrections')}
        />
        {correctionError && <p role="alert" className="text-sm text-danger">Open corrections could not be read just now; no zero has been substituted.</p>}

        <ListingPrepCard summary={prepSummary} onOpen={(query) => navigate(`/listing-prep${query}`)} />

        <section className="rounded-lg border border-hairline bg-surface-1 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="h-4 w-4 text-accent" /> Open intake sessions
            </h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{intakeError ? '—' : openSessionCount}</span>
          </div>
          <p className="mb-3 text-xs text-ink-muted">Sessions you started but have not finished.</p>
          {intakeError ? (
            <p role="alert" className="text-sm text-danger">Open intake sessions could not be read just now.</p>
          ) : openSessions.length === 0 ? (
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

/**
 * Listing preparation, as counts with a link into the feature. The Workbench
 * points at work; it does not reproduce the queue, so nothing here paginates
 * or filters — that is what /listing-prep is for.
 */
function ListingPrepCard({
  summary, onOpen,
}: {
  summary: PrepSummary | null;
  onOpen: (query: string) => void;
}) {
  const ready = summary?.by_readiness.ready ?? 0;
  const rows: Array<[string, number, string]> = summary
    ? [
        ['Ready to list', summary.by_status.ready_to_list ?? 0, '?tab=ready'],
        ['Waiting on your review', summary.by_readiness.needs_owner_review ?? 0, '?readiness=needs_owner_review'],
        [READINESS_LABELS.needs_photos, summary.by_readiness.needs_photos ?? 0, '?readiness=needs_photos'],
        [READINESS_LABELS.blocked, summary.by_readiness.blocked ?? 0, '?readiness=blocked'],
        ['Not started', summary.never_started, '?tab=queue'],
      ]
    : [];

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Tags className="h-4 w-4 text-accent" /> Listing preparation
        </h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{ready}</span>
      </div>
      {!summary ? (
        <p className="text-sm text-ink-muted">Listing preparation could not be read just now.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map(([label, count, query]) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => onOpen(query)}
                className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-sm hover:bg-surface-2"
              >
                <span>{label}</span>
                <span className="font-semibold">{count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
