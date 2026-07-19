// Phase 3 import-review interface — STAGING / NON-AUTHORITATIVE.
//
// Renders the deterministic import plan for a repository fixture: hashes,
// source/accepted/issue counts, declared source totals, parser and mapping
// versions, malformed rows with their errors, similarity candidates, crosswalk
// state, and audit history.
//
// Safe by default: when the Phase 3 flag or the shadow auth configuration is
// absent, this page renders an inert notice and issues NO requests at all. The
// route is not even registered in that case (see App.tsx), so the legacy
// SQLite experience is unchanged.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileWarning, Hash, Info, Layers } from 'lucide-react';
import {
  listFixtures,
  previewCrosswalks,
  previewImport,
  previewIssues,
  previewRecords,
  type FixtureSummary,
  type ImportPlanSummary,
} from '../lib/provenanceApi';
import {
  STAGING_NOTICE,
  isProvenanceUiEnabled,
} from '../lib/provenanceConfig';

type Records = Awaited<ReturnType<typeof previewRecords>>;
type Issues = Awaited<ReturnType<typeof previewIssues>>;
type Crosswalks = Awaited<ReturnType<typeof previewCrosswalks>>;

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

export default function ImportReview() {
  const enabled = useMemo(
    () => isProvenanceUiEnabled(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );

  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [plan, setPlan] = useState<ImportPlanSummary | null>(null);
  const [records, setRecords] = useState<Records | null>(null);
  const [issues, setIssues] = useState<Issues | null>(null);
  const [crosswalks, setCrosswalks] = useState<Crosswalks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Inert when unconfigured: this effect never runs, so no request is made.
  useEffect(() => {
    if (!enabled) return;
    listFixtures()
      .then((r) => {
        setFixtures(r.fixtures);
        if (r.fixtures.length > 0) setSelected(r.fixtures[0].filename);
      })
      .catch((e: Error) => setError(e.message));
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !selected) return;
    setLoading(true);
    setError(null);
    Promise.all([
      previewImport(selected),
      previewRecords(selected, 25, 0),
      previewIssues(selected),
      previewCrosswalks(selected),
    ])
      .then(([p, r, i, c]) => {
        setPlan(p);
        setRecords(r);
        setIssues(i);
        setCrosswalks(c);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [enabled, selected]);

  if (!enabled) {
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

  const malformed = records?.records.filter((r) => r.parseStatus === 'malformed') ?? [];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Import Review</h1>
        <select
          className="rounded-lg border border-hairline bg-surface-1 px-3 py-1.5 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {fixtures.map((f) => (
            <option key={f.filename} value={f.filename}>
              {f.filename}
            </option>
          ))}
        </select>
      </div>

      <StagingBanner />

      {error && (
        <div className="rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading && <div className="text-sm text-ink-muted">Computing import plan…</div>}

      {plan && !loading && (
        <>
          {/* Job header: label, hashes, versions, status */}
          <section className="rounded-xl border border-hairline bg-surface-1 p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Layers className="h-4 w-4 text-accent" />
              Import job — <span className="font-normal text-ink-muted">preview (uncommitted)</span>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Source object" value={plan.sourceLabel} />
              <Field label="Parser version" value={plan.parserVersion} />
              <Field label="Mapping version" value={plan.mappingVersion} />
              <Field label="File SHA-256" value={plan.fileSha256} mono />
              <Field label="Content SHA-256" value={plan.contentSha256} mono />
              <Field label="Status" value="preview — nothing committed" />
            </div>
          </section>

          {/* Reconciliation counts */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Source rows', plan.sourceRowCount],
              ['Accepted rows', plan.acceptedRowCount],
              ['Issue rows', plan.issueRowCount],
              ['Candidates', plan.crosswalkCandidateCount],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-hairline bg-surface-1 p-4">
                <div className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </section>

          {/* Declared source totals */}
          <section className="rounded-xl border border-hairline bg-surface-1 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Hash className="h-4 w-4 text-accent" /> Declared source totals
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
              {Object.entries(plan.sourceTotals).map(([k, v]) => (
                <Field key={k} label={k} value={String(v)} />
              ))}
            </div>
          </section>

          {/* Malformed rows and errors */}
          <section className="rounded-xl border border-hairline bg-surface-1 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileWarning className="h-4 w-4 text-accent" /> Malformed rows
            </div>
            {malformed.length === 0 ? (
              <div className="mt-2 text-sm text-ink-muted">
                No malformed rows in the first {records?.records.length ?? 0} of{' '}
                {records?.total ?? 0} rows.
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {malformed.map((r) => (
                  <li key={r.sourceRowIndex} className="rounded-lg bg-surface-2 p-3 text-xs">
                    <div className="font-medium">
                      Row {r.sourceRowIndex} — {r.sourceRowKey ?? 'no source key'}
                    </div>
                    <ul className="mt-1 list-disc pl-5 text-ink-secondary">
                      {r.errors.map((e, idx) => (
                        <li key={idx}>
                          <span className="font-mono">{e.field}</span>: {e.message}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-1 text-ink-muted">
                      The exact raw payload is retained on the immutable source record.
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Duplicate / similarity candidates */}
          <section className="rounded-xl border border-hairline bg-surface-1 p-4">
            <div className="text-sm font-medium">Duplicate and similarity candidates</div>
            <div className="mt-1 text-xs text-ink-muted">
              Similar values are surfaced for human review and are never merged
              automatically. Every candidate below is unreviewed.
            </div>
            {(issues?.issues.length ?? 0) === 0 && (crosswalks?.total ?? 0) === 0 ? (
              <div className="mt-2 text-sm text-ink-muted">None detected.</div>
            ) : (
              <>
                <ul className="mt-3 space-y-2">
                  {issues?.issues.map((i, idx) => (
                    <li key={idx} className="rounded-lg bg-surface-2 p-3 text-xs">
                      <span className="font-medium">{i.issueType}</span> ({i.severity}) —{' '}
                      {i.message}
                    </li>
                  ))}
                </ul>
                <table className="mt-3 w-full text-xs">
                  <thead className="text-ink-muted">
                    <tr className="text-left">
                      <th className="py-1">Row</th>
                      <th>Proposed entity</th>
                      <th>Method</th>
                      <th>Confidence</th>
                      <th>Crosswalk state</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crosswalks?.crosswalks.map((c, idx) => (
                      <tr key={idx} className="border-t border-hairline">
                        <td className="py-1 tabular-nums">{c.sourceRowIndex}</td>
                        <td>
                          {c.proposedEntityType}: {c.proposedEntityKey}
                        </td>
                        <td>{c.matchMethod}</td>
                        <td className="tabular-nums">{c.confidence}</td>
                        <td>
                          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-600">
                            {c.reviewState}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          {/* Audit history */}
          <section className="rounded-xl border border-hairline bg-surface-1 p-4">
            <div className="text-sm font-medium">Audit history</div>
            <div className="mt-1 text-xs text-ink-muted">
              A preview performs no state change, so it appends no audit event.
              Committing an import records an append-only <code>import_committed</code>{' '}
              event, and every review, rejection, supersession, and issue
              resolution appends its own immutable event.
            </div>
          </section>
        </>
      )}
    </div>
  );
}
