// Phase 4 acquisition-review interface — STAGING / NON-AUTHORITATIVE.
//
// A thin view over AcquisitionReviewController (lib/acquisitionReview.ts), which
// holds the state and permission logic and is unit-tested there. This file is
// presentation only.
//
// Safe by default: when the shadow configuration is absent the controller
// reports 'unconfigured', this page renders an inert notice, and no request is
// ever made. The route is not even registered in that case (see App.tsx), so
// the legacy SQLite experience is unchanged.
//
// Viewer actions are visibly read-only: the governed preview control is disabled
// for viewers. That is an affordance, not the boundary — the server re-checks
// the role and the database enforces it again.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, History, Info, Layers, ListChecks, Users } from 'lucide-react';
import { createAcquisitionTransport } from '../lib/acquisitionApi';
import {
  AcquisitionReviewController,
  formatDetailValue,
  type AcquisitionReviewState,
} from '../lib/acquisitionReview';
import { STAGING_NOTICE, getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import { money } from '../lib/format';

function StagingBanner() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      <div className="text-xs leading-relaxed text-ink-secondary">
        <span className="font-semibold text-amber-600">STAGING — NOT AUTHORITATIVE.</span>{' '}
        {STAGING_NOTICE}
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Layers;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface-1 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-accent" />
        {title}
        <span className="ml-auto rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
          Staging
        </span>
      </div>
      {children}
    </section>
  );
}

export default function AcquisitionReview() {
  const config = useMemo(
    () =>
      getProvenanceUiConfig(
        import.meta.env as unknown as Record<string, string | undefined>
      ),
    []
  );

  const controller = useMemo(() => {
    if (!config) return new AcquisitionReviewController(null, false);
    const client = createShadowClient(
      import.meta.env as unknown as Record<string, string | undefined>
    );
    const transport = createAcquisitionTransport(async () => {
      const session = await (
        client as unknown as {
          auth: { getSession(): Promise<{ data: { session: { access_token?: string } | null } }> };
        }
      )?.auth.getSession();
      return session?.data?.session?.access_token ?? null;
    });
    return new AcquisitionReviewController(transport, true);
  }, [config]);

  const [state, setState] = useState<AcquisitionReviewState>(controller.getState());
  const [workspaceId, setWorkspaceId] = useState('');
  const [sourceJobId, setSourceJobId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [commitKey, setCommitKey] = useState('');

  useEffect(() => controller.subscribe(setState), [controller]);

  const openWorkspace = useCallback(() => {
    // No role is sent: the server resolves the caller's ACTUAL role.
    if (workspaceId.trim()) void controller.open(workspaceId.trim());
  }, [controller, workspaceId]);

  const onSourceJobChange = useCallback(
    (value: string) => {
      setSourceJobId(value);
      // Changing the source job invalidates any existing preview, which
      // disables the commit control until a fresh preview succeeds.
      controller.clearPreview();
    },
    [controller]
  );

  const runPreview = useCallback(() => {
    if (sourceJobId.trim()) void controller.runPreview(sourceJobId.trim());
  }, [controller, sourceJobId]);

  const runCommit = useCallback(() => {
    if (sourceJobId.trim() && channelId.trim() && commitKey.trim()) {
      void controller.runCommit({
        sourceImportJobId: sourceJobId.trim(),
        channelId: channelId.trim(),
        idempotencyKey: commitKey.trim(),
      });
    }
  }, [controller, sourceJobId, channelId, commitKey]);

  if (!config || state.status === 'unconfigured') {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-lg font-semibold">Acquisition Review</h1>
        <div className="flex items-start gap-2 rounded-lg border border-hairline bg-surface-1 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
          <div className="text-sm text-ink-secondary">
            The staging acquisition-review interface is not configured in this
            environment, so it is unavailable. The Russell Vault application is
            unaffected.
          </div>
        </div>
      </div>
    );
  }

  const caps = state.capabilities;
  const p = state.preview;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Acquisition Review</h1>
        {state.role && (
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">
            role: <span className="font-medium">{state.role}</span>
            {caps.readOnly && <span className="ml-1 text-amber-600">(read-only)</span>}
          </span>
        )}
      </div>

      <StagingBanner />

      <Section title="Workspace" icon={ListChecks}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-muted">Workspace ID</span>
            <input
              className="w-80 rounded-lg border border-hairline bg-surface-0 px-2 py-1.5 font-mono text-xs"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <button
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
            onClick={openWorkspace}
            disabled={state.status === 'loading' || !workspaceId.trim()}
          >
            Open
          </button>
        </div>
        <p className="text-[11px] text-ink-muted">
          Your capabilities are determined by your ACTUAL workspace role, which the
          server resolves from your token — there is no role selector, and nothing
          in this interface can grant a viewer operator or owner powers.
        </p>
      </Section>

      {state.error && (
        <div className="rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-3 text-xs text-red-600">
          {state.error}
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {/* Governed preview (operator/owner) */}
          <Section title="Map a committed source import" icon={Layers}>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-ink-muted">Committed Phase 3 import job id</span>
                <input
                  className="w-96 rounded-lg border border-hairline bg-surface-0 px-2 py-1.5 font-mono text-xs"
                  value={sourceJobId}
                  onChange={(e) => onSourceJobChange(e.target.value)}
                  placeholder="the source import_job to map"
                />
              </label>
              <button
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
                onClick={runPreview}
                disabled={caps.readOnly || !sourceJobId.trim()}
                title={caps.readOnly ? 'previewing requires operator or owner' : undefined}
              >
                Preview mapping
              </button>
            </div>
            {p && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
                <Stat label="Orders" value={String(p.orders)} />
                <Stat label="Lots" value={String(p.lots)} />
                <Stat label="Line items" value={String(p.lineItems)} />
                <Stat label="Cost components" value={String(p.costComponents)} />
                <Stat label="Source-reported total" value={money(p.sourceReportedTotalMinor / 100)} />
                <Stat
                  label="Normalized known total"
                  value={money(p.normalizedKnownComponentMinor / 100)}
                />
                <Stat label="Known / Unknown costs" value={`${p.knownComponents} / ${p.unknownComponents}`} />
                <Stat label="Documented-free costs" value={String(p.documentedFreeComponents)} />
                <Stat label="Discrepancies" value={String(p.discrepancies)} />
                <Stat
                  label="Unresolved supplier candidates"
                  value={String(p.unresolvedSupplierCandidates)}
                />
                <Stat
                  label="Unresolved (unallocated) costs"
                  value={String(p.unresolvedCostComponents)}
                />
                <Stat label="Distinct seller handles" value={String(p.distinctSellerHandles)} />
              </div>
            )}

            {/* Governed commit — operators/owners only. Viewers see no control. */}
            {caps.canRunWorkflow ? (
              <div className="mt-3 space-y-2 rounded-lg border border-hairline bg-surface-0 p-3">
                <div className="text-xs font-medium">Commit this mapping</div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-ink-muted">Channel</span>
                    <select
                      className="rounded-lg border border-hairline bg-surface-0 px-2 py-1.5 text-xs"
                      value={channelId}
                      onChange={(e) => setChannelId(e.target.value)}
                    >
                      <option value="">select a channel…</option>
                      {state.channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.public_id})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-ink-muted">Idempotency key</span>
                    <input
                      className="w-56 rounded-lg border border-hairline bg-surface-0 px-2 py-1.5 font-mono text-xs"
                      value={commitKey}
                      onChange={(e) => setCommitKey(e.target.value)}
                      placeholder="a stable key for safe resume"
                    />
                  </label>
                  <button
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
                    onClick={runCommit}
                    disabled={
                      !sourceJobId.trim() ||
                      !channelId.trim() ||
                      !commitKey.trim() ||
                      state.previewedSourceJobId !== sourceJobId.trim()
                    }
                    title={
                      state.previewedSourceJobId !== sourceJobId.trim()
                        ? 'preview this source job before committing'
                        : undefined
                    }
                  >
                    Commit mapping
                  </button>
                </div>
                {state.previewedSourceJobId !== sourceJobId.trim() && (
                  <div className="text-[11px] text-amber-600">
                    Preview the source job before committing — the commit uses the exact
                    previewed source job.
                  </div>
                )}
                {state.commitOutcome && (
                  <div className="text-xs text-ink-secondary">
                    Committed job {state.commitOutcome.importJobId}:{' '}
                    {state.commitOutcome.orders} orders, {state.commitOutcome.lineItems} lines
                    {state.commitOutcome.resumed ? ' (resumed)' : ''}.
                  </div>
                )}
                <p className="text-[11px] text-ink-muted">
                  Re-running with the same key safely resumes an interrupted commit; the
                  server and database re-check your role and enforce every governed rule.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-ink-muted">
                Viewers are read-only. Committing a mapping requires an operator or owner.
              </p>
            )}
          </Section>

          {/* Orders: source beside normalized */}
          <Section title={`Acquisition orders (${state.totalOrders})`} icon={ListChecks}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="text-ink-muted">
                  <tr className="text-left">
                    <th className="py-1 pr-3">Public ID</th>
                    <th className="py-1 pr-3">Source order ref</th>
                    <th className="py-1 pr-3">Supplier</th>
                    <th className="py-1 pr-3">Status (norm / source)</th>
                    <th className="py-1 pr-3">Source total</th>
                    <th className="py-1 pr-3">Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {state.orders.map((o) => (
                    <tr
                      key={o.id}
                      className="cursor-pointer border-t border-hairline hover:bg-surface-2"
                      onClick={() => void controller.openOrder(o.id)}
                    >
                      <td className="py-1 pr-3 font-mono">{o.public_id}</td>
                      <td className="py-1 pr-3 font-mono">{o.source_order_reference}</td>
                      <td className="py-1 pr-3 font-mono">{o.suppliers?.public_id ?? o.supplier_id}</td>
                      <td className="py-1 pr-3">
                        {o.order_status}
                        <span className="text-ink-muted"> / {o.source_reported_status}</span>
                      </td>
                      <td className="py-1 pr-3">
                        {o.source_reported_total_minor === null
                          ? '—'
                          : money(o.source_reported_total_minor / 100)}
                      </td>
                      <td className="py-1 pr-3">{o.currency}</td>
                    </tr>
                  ))}
                  {state.orders.length === 0 && (
                    <tr>
                      <td className="py-2 text-ink-muted" colSpan={6}>
                        No acquisition orders yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Selected order detail: source vs normalized, all scopes, allocations */}
          {state.orderDetail && (
            <Section title="Order detail" icon={Layers}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
                <Stat
                  label="Source-reported total"
                  value={
                    detailNumber(state.orderDetail.discrepancy.sourceReportedTotalMinor) === null
                      ? '—'
                      : money(
                          detailNumber(state.orderDetail.discrepancy.sourceReportedTotalMinor)! / 100
                        )
                  }
                />
                <Stat
                  label="Normalized known total"
                  value={money(
                    (detailNumber(state.orderDetail.discrepancy.normalizedKnownComponentMinor) ?? 0) /
                      100
                  )}
                />
                <Stat
                  label="Difference"
                  value={
                    detailNumber(state.orderDetail.discrepancy.differenceMinor) === null
                      ? '—'
                      : money(detailNumber(state.orderDetail.discrepancy.differenceMinor)! / 100)
                  }
                />
                <Stat
                  label="Unknown / unresolved costs"
                  value={`${detailNumber(state.orderDetail.discrepancy.unknownComponentCount) ?? 0} / ${
                    detailNumber(state.orderDetail.discrepancy.unresolvedComponentCount) ?? 0
                  }`}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                <DetailList title={`Lots (${state.orderDetail.lots.length})`} rows={state.orderDetail.lots} keys={['public_id', 'sequence_no', 'label']} />
                <DetailList title={`Line items — source vs normalized (${state.orderDetail.lines.length})`} rows={state.orderDetail.lines} keys={['public_id', 'quantity', 'description', 'source_detail', 'source_record_id', 'external_identifier_id']} />
                <DetailList title={`Active placements (${state.orderDetail.activePlacements.length})`} rows={state.orderDetail.activePlacements} keys={['line_item_id', 'lot_id', 'sequence_no', 'state']} />
                <DetailList title={`Historical placements (${state.orderDetail.historicalPlacements.length})`} rows={state.orderDetail.historicalPlacements} keys={['line_item_id', 'lot_id', 'state', 'superseded_by_id']} />
                <DetailList title={`Current cost components (${state.orderDetail.currentComponents.length})`} rows={state.orderDetail.currentComponents} keys={['component_type', 'line_item_id', 'lot_id', 'order_id', 'amount_state', 'amount_minor', 'currency', 'attribution_state', 'evidence_note', 'source_record_id']} />
                <DetailList title={`Reversed cost components (${state.orderDetail.historicalComponents.length})`} rows={state.orderDetail.historicalComponents} keys={['component_type', 'amount_state', 'amount_minor', 'reversed_at', 'reversed_by_id']} />
                <DetailList title={`Current allocations (${state.orderDetail.currentAllocations.length})`} rows={state.orderDetail.currentAllocations} keys={['line_item_id', 'method', 'amount_minor', 'state', 'reviewed_by', 'reviewed_at']} />
                <DetailList title={`Reversed allocations (${state.orderDetail.reversedAllocations.length})`} rows={state.orderDetail.reversedAllocations} keys={['line_item_id', 'method', 'amount_minor', 'state', 'reversed_at']} />
                <DetailList title={`Audit history (${state.orderDetail.auditEvents.length})`} rows={state.orderDetail.auditEvents} keys={['event_seq', 'event_type', 'entity_table']} />
              </div>
            </Section>
          )}

          {/* Unresolved supplier candidates — never auto-merged */}
          <Section title={`Unresolved supplier candidates (${state.candidates.length})`} icon={Users}>
            {state.candidates.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No unresolved candidates. Similar handles are never auto-merged; any
                that normalize together appear here for a human to adjudicate.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {state.candidates.map((c) => (
                  <li
                    key={`${c.sourceSystemId}|${c.normalizedHandle}`}
                    className="flex flex-wrap gap-2"
                  >
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      src {c.sourceSystemId}
                    </span>
                    <span className="font-mono text-ink-muted">{c.normalizedHandle}</span>
                    <span>→</span>
                    {c.rawHandles.map((h) => (
                      <span key={h} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">
                        {h}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Audit history */}
          <Section title="Audit history" icon={History}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="text-ink-muted">
                  <tr className="text-left">
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">Event</th>
                    <th className="py-1 pr-3">Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {state.auditEvents.slice(0, 30).map((e, i) => (
                    <tr key={String(e.id ?? i)} className="border-t border-hairline">
                      <td className="py-1 pr-3 font-mono">{String(e.event_seq ?? '')}</td>
                      <td className="py-1 pr-3">{String(e.event_type ?? '')}</td>
                      <td className="py-1 pr-3 font-mono">{String(e.entity_table ?? '')}</td>
                    </tr>
                  ))}
                  {state.auditEvents.length === 0 && (
                    <tr>
                      <td className="py-2 text-ink-muted" colSpan={3}>
                        No audit events yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function detailNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

// A compact read-only listing of a set of rows, showing a few named columns.
function DetailList({
  title,
  rows,
  keys,
}: {
  title: string;
  rows: ReadonlyArray<Record<string, unknown>>;
  keys: string[];
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-0 p-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-ink-muted">none</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.slice(0, 25).map((r, i) => (
            <li key={String(r.id ?? i)} className="font-mono break-all">
              {keys.map((k) => `${k}=${formatDetailValue(r[k])}`).join('  ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
