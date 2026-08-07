// Phase 3 import-review interface — STAGING / NON-AUTHORITATIVE.
//
// A thin view over ImportReviewController (lib/importReview.ts), which holds
// all the state and permission logic and is unit-tested there. This file is
// presentation only.
//
// Safe by default: when the Phase 3 flag or the shadow auth configuration is
// absent the controller reports 'unconfigured', this page renders an inert
// notice, and no request is ever made. The route is not even registered in that
// case (see App.tsx), so the legacy SQLite experience is unchanged.
//
// Viewer actions are visibly read-only: every mutating control is disabled when
// capabilities.readOnly is true. That is an affordance, not the boundary — the
// server re-checks the role and the database enforces it again.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileWarning, History, Info, Layers, ListChecks } from 'lucide-react';
import { createProvenanceTransport } from '../lib/provenanceApi';
import {
  ImportReviewController,
  type ImportReviewState,
} from '../lib/importReview';
import { STAGING_NOTICE, getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import type { WorkspaceRole } from '../lib/database.types';

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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</span>
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

export default function ImportReview() {
  const config = useMemo(
    () =>
      getProvenanceUiConfig(
        import.meta.env as unknown as Record<string, string | undefined>
      ),
    []
  );

  // One controller for the page's lifetime. Built with a transport that pulls
  // the caller's own access token from the shadow session on every request.
  const controller = useMemo(() => {
    if (!config) return new ImportReviewController(null, false);
    const client = createShadowClient(
      import.meta.env as unknown as Record<string, string | undefined>
    );
    const transport = createProvenanceTransport(async () => {
      const session = await (
        client as unknown as {
          auth: { getSession(): Promise<{ data: { session: { access_token?: string } | null } }> };
        }
      )?.auth.getSession();
      return session?.data?.session?.access_token ?? null;
    });
    return new ImportReviewController(transport, true);
  }, [config]);

  const [state, setState] = useState<ImportReviewState>(controller.getState());
  const [workspaceId, setWorkspaceId] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('operator');
  const [runLabel, setRunLabel] = useState('run-1');

  useEffect(() => controller.subscribe(setState), [controller]);

  const openWorkspace = useCallback(() => {
    if (workspaceId.trim()) void controller.open(workspaceId.trim(), role);
  }, [controller, workspaceId, role]);

  if (!config) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-lg font-semibold">Import Review</h1>
        <div className="flex items-start gap-2 rounded-lg border border-hairline bg-surface-1 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
          <div className="text-sm text-ink-secondary">
            The staging import-review interface is not configured in this
            environment, so it is unavailable. The Russell Vault application is
            unaffected.
          </div>
        </div>
      </div>
    );
  }

  const { capabilities: caps } = state;
  const disabled = caps.readOnly || state.busy;
  const idempotencyKey = controller.previewIdempotencyKey(runLabel);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Import Review</h1>
        {state.role && (
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">
            role: <span className="font-medium">{state.role}</span>
            {caps.readOnly && <span className="ml-1 text-amber-600">(read-only)</span>}
          </span>
        )}
      </div>

      <StagingBanner />

      {/* Workspace selection */}
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
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-muted">Your role there</span>
            <select
              className="rounded-lg border border-hairline bg-surface-0 px-2 py-1.5 text-xs"
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            >
              <option value="viewer">viewer</option>
              <option value="operator">operator</option>
              <option value="owner">owner</option>
            </select>
          </label>
          <button
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
            onClick={openWorkspace}
            disabled={state.busy || !workspaceId.trim()}
          >
            Open
          </button>
        </div>
        <p className="text-[11px] text-ink-muted">
          The role selected here only shapes this interface. The server verifies
          your token and re-checks your actual membership on every request.
        </p>
      </Section>

      {state.error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-600">
          <span>{state.error}</span>
          <button className="text-xs underline" onClick={() => controller.clearError()}>
            dismiss
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {/* Preview and commit */}
          <Section title="Import a repository fixture" icon={Layers}>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-ink-muted">Fixture</span>
                <select
                  className="rounded-lg border border-hairline bg-surface-0 px-2 py-1.5 text-xs"
                  value={state.selectedFixture ?? ''}
                  onChange={(e) => controller.selectFixture(e.target.value)}
                  disabled={disabled}
                >
                  {state.fixtures.map((f) => (
                    <option key={f.filename} value={f.filename}>
                      {f.filename}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-ink-muted">Source system</span>
                <select
                  className="rounded-lg border border-hairline bg-surface-0 px-2 py-1.5 text-xs"
                  value={state.selectedSourceSystemId ?? ''}
                  onChange={(e) => controller.selectSourceSystem(e.target.value)}
                  disabled={disabled}
                >
                  {state.sourceSystems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.public_id} — {s.instance_label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-ink-muted">Run label</span>
                <input
                  className="w-40 rounded-lg border border-hairline bg-surface-0 px-2 py-1.5 text-xs"
                  value={runLabel}
                  onChange={(e) => setRunLabel(e.target.value)}
                  disabled={disabled}
                />
              </label>
              <button
                className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                onClick={() => void controller.preview()}
                disabled={disabled}
              >
                Preview
              </button>
              <button
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-40"
                onClick={() => void controller.commit(runLabel)}
                disabled={disabled || !state.preview}
              >
                Commit
              </button>
            </div>

            {caps.readOnly && (
              <p className="text-[11px] text-amber-600">
                Your role is read-only here: preview and commit are disabled.
              </p>
            )}

            {state.preview && (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <Field label="Source object" value={state.preview.sourceLabel} />
                  <Field label="Parser version" value={state.preview.parserVersion} />
                  <Field label="Mapping version" value={state.preview.mappingVersion} />
                  <Field label="File SHA-256" value={state.preview.fileSha256} mono />
                  <Field label="Content SHA-256" value={state.preview.contentSha256} mono />
                  <Field label="Idempotency key" value={idempotencyKey ?? '—'} mono />
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    ['Source rows', state.preview.sourceRowCount],
                    ['Accepted rows', state.preview.acceptedRowCount],
                    ['Issue rows', state.preview.issueRowCount],
                    ['Candidates', state.preview.crosswalkCandidateCount],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-surface-2 p-3">
                      <div className="text-[11px] uppercase tracking-wide text-ink-muted">
                        {label}
                      </div>
                      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-ink-muted">
                  Declared source totals:{' '}
                  {Object.entries(state.preview.sourceTotals)
                    .map(([k, v]) => `${k}=${v}`)
                    .join('  ·  ')}
                </div>
              </>
            )}

            {state.lastCommit && (
              <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-700">
                Committed job {state.lastCommit.importJobId} — {state.lastCommit.sourceRows}{' '}
                raw rows, {state.lastCommit.issues} issue(s),{' '}
                {state.lastCommit.crosswalks} candidate(s),{' '}
                {state.lastCommit.externalIdentifiers} identifier(s)
                {state.lastCommit.resumed && ' (resumed an existing job)'}
              </div>
            )}
          </Section>

          {/* Stored import jobs */}
          <Section title="Import jobs" icon={ListChecks}>
            {state.jobs.length === 0 ? (
              <div className="text-sm text-ink-muted">No imports recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-ink-muted">
                    <tr className="text-left">
                      <th className="py-1">Source</th>
                      <th>Status</th>
                      <th>Rows</th>
                      <th>Accepted</th>
                      <th>Issues</th>
                      <th>Parser</th>
                      <th>Mapping</th>
                      <th>Content hash</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.jobs.map((j) => (
                      <tr key={j.id} className="border-t border-hairline">
                        <td className="py-1">{j.source_label}</td>
                        <td>{j.status}</td>
                        <td className="tabular-nums">{j.source_row_count}</td>
                        <td className="tabular-nums">{j.accepted_row_count}</td>
                        <td className="tabular-nums">{j.issue_row_count}</td>
                        <td>{j.parser_version}</td>
                        <td>{j.mapping_version}</td>
                        <td className="font-mono">{String(j.content_sha256).slice(0, 12)}…</td>
                        <td>
                          <button
                            className="underline"
                            onClick={() => void controller.openJob(j.id)}
                          >
                            open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Selected job: records and issues */}
          {state.selectedJob && (
            <Section title={`Job ${state.selectedJob.public_id} — stored raw records`} icon={FileWarning}>
              <div className="flex items-center gap-2 text-xs">
                <button
                  className="rounded border border-hairline px-2 py-1 disabled:opacity-40"
                  onClick={() => void controller.previousRecordPage()}
                  disabled={state.recordOffset === 0 || state.busy}
                >
                  previous
                </button>
                <span className="text-ink-muted">
                  {state.recordOffset + 1}–
                  {Math.min(state.recordOffset + state.recordPageSize, state.recordTotal)} of{' '}
                  {state.recordTotal}
                </span>
                <button
                  className="rounded border border-hairline px-2 py-1 disabled:opacity-40"
                  onClick={() => void controller.nextRecordPage()}
                  disabled={
                    state.recordOffset + state.recordPageSize >= state.recordTotal || state.busy
                  }
                >
                  next
                </button>
              </div>

              <div className="max-h-80 overflow-auto rounded-lg bg-surface-2 p-2">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-muted">
                    <tr className="text-left">
                      <th>#</th>
                      <th>Source key</th>
                      <th>Parse</th>
                      <th>Raw payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.records.map((r) => (
                      <tr key={r.id} className="border-t border-hairline align-top">
                        <td className="tabular-nums">{r.source_row_index}</td>
                        <td>{r.source_row_key ?? '—'}</td>
                        <td>{r.parse_status}</td>
                        <td className="font-mono break-all">
                          {JSON.stringify(r.raw_payload).slice(0, 160)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-xs font-medium">Data-quality issues</div>
              {state.issues.length === 0 ? (
                <div className="text-xs text-ink-muted">None recorded for this job.</div>
              ) : (
                <ul className="space-y-2">
                  {state.issues.map((i) => (
                    <li key={i.id} className="rounded-lg bg-surface-2 p-3 text-xs">
                      <div>
                        <span className="font-medium">{i.issue_type}</span> ({i.severity}) —{' '}
                        {i.message} · <span className="text-ink-muted">{i.status}</span>
                      </div>
                      <div className="mt-1 flex gap-2">
                        <button
                          className="rounded border border-hairline px-2 py-0.5 disabled:opacity-40"
                          onClick={() => void controller.resolveIssue(i.id, 'acknowledged')}
                          disabled={disabled || i.status !== 'open'}
                        >
                          acknowledge
                        </button>
                        <button
                          className="rounded border border-hairline px-2 py-0.5 disabled:opacity-40"
                          onClick={() => void controller.resolveIssue(i.id, 'resolved')}
                          disabled={
                            disabled || i.status === 'resolved' || i.status === 'wont_fix'
                          }
                        >
                          resolve
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* Crosswalks */}
          <Section title="Crosswalk candidates and history" icon={ListChecks}>
            <p className="text-[11px] text-ink-muted">
              Similar values are surfaced for human review and are never merged
              automatically. Confirmation, rejection, and supersession are
              governed actions recorded in the audit log.
            </p>
            {state.crosswalks.length === 0 ? (
              <div className="text-sm text-ink-muted">No crosswalks recorded.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-ink-muted">
                    <tr className="text-left">
                      <th className="py-1">Proposed entity</th>
                      <th>Method</th>
                      <th>Confidence</th>
                      <th>State</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.crosswalks.map((c) => (
                      <tr key={c.id} className="border-t border-hairline">
                        <td className="py-1">
                          {c.proposed_entity_type}: {c.proposed_entity_key}
                        </td>
                        <td>{c.match_method}</td>
                        <td className="tabular-nums">{c.confidence ?? '—'}</td>
                        <td>
                          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-600">
                            {c.review_state}
                          </span>
                        </td>
                        <td className="flex gap-2 py-1">
                          <button
                            className="rounded border border-hairline px-2 py-0.5 disabled:opacity-40"
                            onClick={() => void controller.confirmCrosswalk(c.id)}
                            disabled={disabled || c.review_state !== 'candidate'}
                          >
                            confirm
                          </button>
                          <button
                            className="rounded border border-hairline px-2 py-0.5 disabled:opacity-40"
                            onClick={() => void controller.rejectCrosswalk(c.id)}
                            disabled={disabled || c.review_state !== 'candidate'}
                          >
                            reject
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Audit history */}
          <Section title="Audit history (append-only)" icon={History}>
            {state.auditEvents.length === 0 ? (
              <div className="text-sm text-ink-muted">No audit events yet.</div>
            ) : (
              <ul className="space-y-1 text-xs">
                {state.auditEvents.map((e) => (
                  <li key={e.id} className="flex gap-3 border-b border-hairline pb-1">
                    <span className="tabular-nums text-ink-muted">#{e.event_seq}</span>
                    <span className="font-medium">{e.event_type}</span>
                    <span className="text-ink-muted">{e.subject_table}</span>
                    <span className="ml-auto text-ink-muted">{e.actor_process}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-ink-muted">
              These rows cannot be edited or deleted by any application role.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
