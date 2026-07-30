// The permanent record of a finished count.
//
// Read only, and unmistakably so. Everything that went into the result is here:
// the frozen scope and snapshot, every round of observations including the ones
// that were voided, the discrepancies, the activity that happened after the
// snapshot, and every resolution attempt — the failures as well as the ones that
// worked. Deferrals are shown prominently, because a count completed with
// outstanding work is a different thing from a count that was finished.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive } from 'lucide-react';
import { useCycleCountSession } from '../lib/useCycleCountSession';
import type { AuditRecord } from '../lib/cycleCountApi';
import { ACTION_LABEL, groupDiscrepancies, LOSS_SHORT } from '../lib/cycleCount';
import {
  BlindChip, CycleStatusChip, DiscrepancyCard, ErrorNote, LoadingNote, ObservationFeedPanel,
  TerminalBanner,
} from '../components/CycleCountPanels';

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-hairline bg-surface-1">
      <div className="border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold">
          {title}{count !== undefined && <span className="font-normal text-ink-muted"> ({count})</span>}
        </h2>
      </div>
      {children}
    </section>
  );
}

export default function CycleCountAudit() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { api, bundle, loading, error, setError } =
    useCycleCountSession(sessionId, ['completed', 'cancelled']);

  const [record, setRecord] = useState<AuditRecord | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(true);

  const loadRecord = useCallback(async () => {
    if (!api || !sessionId) return;
    setLoadingRecord(true);
    try {
      setRecord(await api.auditRecord(sessionId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingRecord(false);
    }
  }, [api, sessionId, setError]);

  useEffect(() => { if (bundle?.found) void loadRecord(); }, [bundle?.found, loadRecord]);

  if (loading && !bundle) return <div className="p-6"><LoadingNote what="the audit record" /></div>;

  if (bundle && !bundle.found) {
    return (
      <div className="max-w-xl space-y-3 p-6">
        <p className="text-sm font-medium">That cycle count is not in this workspace.</p>
        <Link to="/cycle-counts" className="inline-block text-sm text-accent underline">
          Back to cycle counts
        </Link>
      </div>
    );
  }

  const session = bundle?.session;
  if (!session) return <div className="p-6"><ErrorNote message={error} /></div>;

  const deferred = (record?.discrepancies ?? []).filter((d) => d.status === 'deferred');
  const groups = groupDiscrepancies(record?.discrepancies ?? []);
  const summary = session.completion_summary as Record<string, unknown> | null;

  return (
    <div className="max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/cycle-counts" className="text-xs text-accent underline">Cycle counts</Link>
          <span className="text-xs text-ink-muted">/</span>
          <span className="font-mono text-sm font-medium">{session.public_id}</span>
          <CycleStatusChip status={session.status} />
          <BlindChip blind={session.blind_count} />
        </div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Archive className="h-5 w-5 text-accent" aria-hidden /> Count record — {session.root_location_code}
        </h1>
      </header>

      <TerminalBanner status={session.status} reason={session.cancellation_reason} />

      {/* A completion carrying deferrals says so at the top, not in a footnote. */}
      {deferred.length > 0 && (
        <div className="rounded-lg border border-warning/60 bg-warning/10 px-4 py-3">
          <p className="text-sm font-semibold text-[#8a5a00] dark:text-warning">
            Completed with {deferred.length} deferred discrepancy(s) — follow-up work remains.
          </p>
          {session.completion_note && (
            <p className="mt-1 text-xs text-ink-secondary">Reason given: {session.completion_note}</p>
          )}
          <ul className="mt-2 space-y-1 text-xs">
            {deferred.map((d) => (
              <li key={d.discrepancy_id}>
                <span className="font-mono">{d.public_id}</span> · {d.subject_display_name}
                {d.deferral_reason && <> — {d.deferral_reason}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorNote message={error} />

      <Section title="Session">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-xs sm:grid-cols-3">
          <div><dt className="text-ink-muted">Created</dt><dd>{session.created_at}</dd></div>
          <div><dt className="text-ink-muted">Created by</dt><dd>{session.created_by_email ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Started</dt><dd>{session.started_at ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Started by</dt><dd>{session.started_by_email ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Snapshot frozen</dt><dd>{session.snapshot_frozen_at ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Submitted</dt><dd>{session.submitted_at ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Submitted by</dt><dd>{session.submitted_by_email ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Completed</dt><dd>{session.completed_at ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Completed by</dt><dd>{session.completed_by_email ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Cancelled</dt><dd>{session.cancelled_at ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Cancelled by</dt><dd>{session.cancelled_by_email ?? '—'}</dd></div>
          <div><dt className="text-ink-muted">Blind count</dt><dd>{session.blind_count ? 'Yes' : 'No'}</dd></div>
          <div>
            <dt className="text-ink-muted">Scope</dt>
            <dd>{session.include_descendants ? 'Location and descendants' : 'Single location'}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Filters</dt>
            <dd>{[session.subtype_filter, session.vertical_filter].filter(Boolean).join(' · ') || 'none'}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Frozen locations</dt>
            <dd>{(bundle?.scope ?? []).map((s) => s.location_code).join(', ') || '—'}</dd>
          </div>
        </dl>
        {session.notes && <p className="border-t border-hairline px-4 py-3 text-xs text-ink-secondary">{session.notes}</p>}
      </Section>

      {summary && (
        <Section title="Final summary from the database">
          <pre className="overflow-x-auto px-4 py-3 text-xs">{JSON.stringify(summary, null, 2)}</pre>
        </Section>
      )}

      {loadingRecord ? (
        <LoadingNote what="the audit record" />
      ) : (
        <>
          <Section title="Frozen expected units" count={record?.expected_items?.length ?? 0}>
            {(record?.expected_items ?? []).length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">This count covered no serialized units.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {(record?.expected_items ?? []).map((e) => (
                  <li key={e.item_public_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => navigate(`/inventory/current/${e.item_id}`)}
                      className="min-w-0 text-left"
                    >
                      <span className="font-medium">{e.display_name}</span>
                      <span className="ml-2 font-mono text-ink-muted">{e.item_public_id}</span>
                    </button>
                    <span className="text-ink-secondary">
                      {e.expected_location_code}
                      {e.item_state === 'lost' && <span className="ml-2 text-danger">{LOSS_SHORT}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Frozen expected lots" count={record?.expected_lots?.length ?? 0}>
            {(record?.expected_lots ?? []).length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">This count covered no quantity lots.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {(record?.expected_lots ?? []).map((e) => (
                  <li key={e.lot_public_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => navigate(`/inventory/lots/${e.lot_id}`)}
                      className="min-w-0 text-left"
                    >
                      <span className="font-medium">{e.display_name}</span>
                      <span className="ml-2 font-mono text-ink-muted">{e.lot_public_id}</span>
                    </button>
                    <span className="tabular-nums text-ink-secondary">
                      {e.expected_location_code} · expected {e.expected_quantity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <ObservationFeedPanel rows={record?.observations ?? []} readOnly />

          {(record?.discrepancies ?? []).length > 0 && (
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.key}>
                  <h2 className="mb-2 text-sm font-semibold">
                    {group.label} <span className="font-normal text-ink-muted">({group.rows.length})</span>
                  </h2>
                  <ul className="space-y-3">
                    {group.rows.map((row) => (
                      <DiscrepancyCard
                        key={row.discrepancy_id}
                        row={row}
                        busy={false}
                        readOnly
                        onResolve={async () => {}}
                        onRecount={async () => {}}
                        onOpenRecord={(r) => navigate(
                          r.subject_kind === 'item' && r.item_id
                            ? `/inventory/current/${r.item_id}`
                            : r.lot_id ? `/inventory/lots/${r.lot_id}` : '/inventory/current'
                        )}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <Section title="Governed operations applied" count={record?.resolutions?.length ?? 0}>
            {(record?.resolutions ?? []).length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">No resolution was recorded.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {(record?.resolutions ?? []).map((r) => (
                  <li key={r.resolution_id} className="px-4 py-2.5 text-xs">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-ink-muted">{r.discrepancy_public_id}</span>
                      <span className="font-medium">{ACTION_LABEL[r.action] ?? r.action}</span>
                      <span className={r.succeeded ? 'text-good' : 'text-danger'}>
                        {r.succeeded ? 'applied' : 'failed'}
                      </span>
                      <span className="text-ink-muted">{r.resolved_at}</span>
                      {r.resolved_by_email && <span className="text-ink-muted">{r.resolved_by_email}</span>}
                    </div>
                    {r.note && <div className="text-ink-secondary">{r.note}</div>}
                    {!r.succeeded && r.failure_detail && (
                      <div className="font-mono text-[11px] text-danger">{r.failure_detail}</div>
                    )}
                    <div className="mt-0.5 flex flex-wrap gap-3 text-ink-muted">
                      {r.movement_id && <span>movement recorded</span>}
                      {r.adjustment_id && <span>quantity adjustment recorded</span>}
                      {r.action === 'routed_to_intake' && <span>Intake follow-up outstanding</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {(record?.loss_events ?? []).length > 0 && (
            <Section title="Units written off during this count" count={record?.loss_events?.length ?? 0}>
              <ul className="divide-y divide-hairline">
                {(record?.loss_events ?? []).map((l) => (
                  <li key={l.loss_public_id} className="px-4 py-2.5 text-xs">
                    <button
                      type="button"
                      onClick={() => navigate(`/inventory/current/${l.item_id}`)}
                      className="font-mono text-accent underline"
                    >
                      {l.item_public_id}
                    </button>
                    <span className="ml-2">{LOSS_SHORT}</span>
                    <span className="ml-2 text-ink-muted">{l.recorded_at}</span>
                    {l.recorded_by_email && <span className="ml-2 text-ink-muted">{l.recorded_by_email}</span>}
                    <div className="text-ink-secondary">{l.reason}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {record?.row_limit !== undefined && (
            <p className="text-xs text-ink-muted">
              Lists on this page are capped at {record.row_limit} rows each.
            </p>
          )}
        </>
      )}
    </div>
  );
}
