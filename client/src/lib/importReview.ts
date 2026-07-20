// Import-review controller for the Phase 3 staging interface.
//
// Framework-agnostic on purpose, matching the Phase 2 auth shell: every state
// transition and permission decision is a plain function or a method on this
// controller, so the whole review flow — commit, duplicate refusal, failure,
// review actions, audit history — is unit-testable without a DOM. The React
// page in pages/ImportReview.tsx is a thin view over this.
//
// Two rules this file encodes and the tests pin:
//   * VIEWERS ARE VISIBLY READ-ONLY. capabilitiesFor() denies every mutating
//     action for a viewer, so the view can disable the controls rather than
//     letting a user click something that will fail.
//   * OPERATOR ACTIONS FAIL CLOSED. Capability checks here are a UX
//     affordance, never the security boundary. Every action still goes to the
//     server, which authenticates the caller and re-checks the role, and then
//     to the database, which enforces it again through RLS and the governed
//     RPCs. If any layer disagrees, the action is refused.

import type {
  AuditEventRow,
  CrosswalkState,
  DataQualityIssueRow,
  DataQualityStatus,
  ImportJobRow,
  SourceCrosswalkRow,
  SourceRecordRow,
  WorkspaceRole,
} from './database.types';

export interface Capabilities {
  readonly canPreview: boolean;
  readonly canCommit: boolean;
  readonly canReviewCrosswalks: boolean;
  readonly canResolveIssues: boolean;
  readonly canRegisterSourceSystem: boolean;
  /** True when the caller may change nothing at all. */
  readonly readOnly: boolean;
}

export function capabilitiesFor(role: WorkspaceRole | null): Capabilities {
  const isOperator = role === 'owner' || role === 'operator';
  return {
    canPreview: isOperator,
    canCommit: isOperator,
    canReviewCrosswalks: isOperator,
    canResolveIssues: isOperator,
    canRegisterSourceSystem: role === 'owner',
    readOnly: !isOperator,
  };
}

// A commit must carry an idempotency key, and the SAME key must be reusable to
// resume an interrupted upload. The key is derived from the things that define
// the import's identity plus a caller-supplied run label, so retrying the same
// run produces the same key while a deliberate re-import does not.
export function makeIdempotencyKey(
  sourceLabel: string,
  contentSha256: string,
  runLabel: string
): string {
  const slug = sourceLabel.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 24);
  return `${slug}-${contentSha256.slice(0, 12)}-${runLabel}`.slice(0, 200);
}

export interface FixtureSummary {
  filename: string;
  shape: string;
  description: string;
}

export interface SourceSystemSummary {
  id: string;
  public_id: string;
  kind: string;
  instance_label: string;
  active: boolean;
}

export interface PreviewSummary {
  sourceLabel: string;
  fileSha256: string;
  contentSha256: string;
  parserVersion: string;
  mappingVersion: string;
  sourceRowCount: number;
  acceptedRowCount: number;
  issueRowCount: number;
  sourceTotals: Record<string, number>;
  crosswalkCandidateCount: number;
  issueCount: number;
}

export interface CommitOutcome {
  importJobId: string;
  status: 'committed';
  sourceRows: number;
  acceptedRows: number;
  issueRows: number;
  issues: number;
  crosswalks: number;
  externalIdentifiers: number;
  resumed: boolean;
}

// Everything the controller needs from the network. Implemented for real in
// provenanceApi.ts and faked in tests.
export interface ProvenanceTransport {
  listFixtures(workspaceId: string): Promise<FixtureSummary[]>;
  listSourceSystems(workspaceId: string): Promise<SourceSystemSummary[]>;
  preview(workspaceId: string, filename: string): Promise<PreviewSummary>;
  commit(
    workspaceId: string,
    input: { filename: string; sourceSystemId: string; idempotencyKey: string }
  ): Promise<CommitOutcome>;
  listJobs(workspaceId: string): Promise<ImportJobRow[]>;
  getJob(workspaceId: string, jobId: string): Promise<ImportJobRow>;
  listRecords(
    workspaceId: string,
    jobId: string,
    limit: number,
    offset: number
  ): Promise<{ total: number; records: SourceRecordRow[] }>;
  listIssues(workspaceId: string, jobId: string): Promise<DataQualityIssueRow[]>;
  listCrosswalks(
    workspaceId: string,
    states: CrosswalkState[]
  ): Promise<SourceCrosswalkRow[]>;
  listAuditEvents(workspaceId: string): Promise<AuditEventRow[]>;
  confirmCrosswalk(workspaceId: string, id: string, note?: string): Promise<void>;
  rejectCrosswalk(workspaceId: string, id: string, note?: string): Promise<void>;
  supersedeCrosswalk(
    workspaceId: string,
    id: string,
    replacementId: string,
    note?: string
  ): Promise<void>;
  resolveIssue(
    workspaceId: string,
    id: string,
    status: DataQualityStatus,
    note?: string
  ): Promise<void>;
}

export interface ImportReviewState {
  readonly status: 'unconfigured' | 'idle' | 'loading' | 'ready' | 'error';
  readonly workspaceId: string | null;
  readonly role: WorkspaceRole | null;
  readonly capabilities: Capabilities;
  readonly fixtures: FixtureSummary[];
  readonly sourceSystems: SourceSystemSummary[];
  readonly selectedFixture: string | null;
  readonly selectedSourceSystemId: string | null;
  readonly preview: PreviewSummary | null;
  readonly jobs: ImportJobRow[];
  readonly selectedJob: ImportJobRow | null;
  readonly records: SourceRecordRow[];
  readonly recordTotal: number;
  readonly recordOffset: number;
  readonly recordPageSize: number;
  readonly issues: DataQualityIssueRow[];
  readonly crosswalks: SourceCrosswalkRow[];
  readonly auditEvents: AuditEventRow[];
  readonly lastCommit: CommitOutcome | null;
  readonly error: string | null;
  readonly busy: boolean;
}

const EMPTY: ImportReviewState = {
  status: 'unconfigured',
  workspaceId: null,
  role: null,
  capabilities: capabilitiesFor(null),
  fixtures: [],
  sourceSystems: [],
  selectedFixture: null,
  selectedSourceSystemId: null,
  preview: null,
  jobs: [],
  selectedJob: null,
  records: [],
  recordTotal: 0,
  recordOffset: 0,
  recordPageSize: 25,
  issues: [],
  crosswalks: [],
  auditEvents: [],
  lastCommit: null,
  error: null,
  busy: false,
};

export class ImportReviewController {
  private state: ImportReviewState = EMPTY;
  private listeners = new Set<(s: ImportReviewState) => void>();

  private readonly transport: ProvenanceTransport | null;
  private readonly configured: boolean;

  constructor(transport: ProvenanceTransport | null, configured: boolean) {
    this.transport = transport;
    this.configured = configured;
    if (configured) this.state = { ...EMPTY, status: 'idle' };
  }

  getState(): ImportReviewState {
    return this.state;
  }

  subscribe(listener: (s: ImportReviewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<ImportReviewState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private requireTransport(): ProvenanceTransport {
    if (!this.configured || !this.transport) {
      throw new Error('the staging import-review interface is not configured');
    }
    return this.transport;
  }

  private requireWorkspace(): string {
    const ws = this.state.workspaceId;
    if (!ws) throw new Error('select a workspace first');
    return ws;
  }

  // Runs an action with busy/error bookkeeping. Errors are captured into state
  // rather than thrown, so the view always has something to render.
  private async run<T>(fn: () => Promise<T>): Promise<T | null> {
    this.set({ busy: true, error: null });
    try {
      const result = await fn();
      this.set({ busy: false });
      return result;
    } catch (err) {
      this.set({ busy: false, error: (err as Error).message, status: 'error' });
      return null;
    }
  }

  /** Enter a workspace with the role the caller actually holds there. */
  async open(workspaceId: string, role: WorkspaceRole): Promise<void> {
    if (!this.configured) return;
    this.set({
      workspaceId,
      role,
      capabilities: capabilitiesFor(role),
      status: 'loading',
      error: null,
    });

    await this.run(async () => {
      const t = this.requireTransport();
      const [fixtures, sourceSystems, jobs, crosswalks, auditEvents] = await Promise.all([
        t.listFixtures(workspaceId),
        t.listSourceSystems(workspaceId),
        t.listJobs(workspaceId),
        t.listCrosswalks(workspaceId, ['candidate', 'rejected', 'superseded']),
        t.listAuditEvents(workspaceId),
      ]);
      this.set({
        status: 'ready',
        fixtures,
        sourceSystems,
        jobs,
        crosswalks,
        auditEvents,
        selectedFixture: fixtures[0]?.filename ?? null,
        selectedSourceSystemId:
          sourceSystems.find((s) => s.active)?.id ?? sourceSystems[0]?.id ?? null,
      });
      return null;
    });
  }

  selectFixture(filename: string) {
    this.set({ selectedFixture: filename, preview: null });
  }

  selectSourceSystem(id: string) {
    this.set({ selectedSourceSystemId: id });
  }

  async preview(): Promise<PreviewSummary | null> {
    if (!this.state.capabilities.canPreview) {
      this.set({ error: 'your role cannot preview an import' });
      return null;
    }
    const filename = this.state.selectedFixture;
    if (!filename) {
      this.set({ error: 'select a fixture first' });
      return null;
    }
    return this.run(async () => {
      const preview = await this.requireTransport().preview(this.requireWorkspace(), filename);
      this.set({ preview });
      return preview;
    });
  }

  /**
   * Commit the selected fixture. Requires a preview first (so the operator has
   * seen the counts and hashes) and a run label, from which the retained
   * idempotency key is derived.
   */
  async commit(runLabel: string): Promise<CommitOutcome | null> {
    if (!this.state.capabilities.canCommit) {
      this.set({ error: 'your role cannot commit an import' });
      return null;
    }
    const { selectedFixture, selectedSourceSystemId, preview } = this.state;
    if (!selectedFixture) {
      this.set({ error: 'select a fixture first' });
      return null;
    }
    if (!selectedSourceSystemId) {
      this.set({ error: 'select a registered source system first' });
      return null;
    }
    if (!preview) {
      this.set({ error: 'preview the import before committing it' });
      return null;
    }
    if (!runLabel || runLabel.trim().length < 3) {
      this.set({ error: 'a run label of at least 3 characters is required' });
      return null;
    }

    const idempotencyKey = makeIdempotencyKey(
      preview.sourceLabel,
      preview.contentSha256,
      runLabel.trim()
    );

    return this.run(async () => {
      const workspaceId = this.requireWorkspace();
      const t = this.requireTransport();
      const outcome = await t.commit(workspaceId, {
        filename: selectedFixture,
        sourceSystemId: selectedSourceSystemId,
        idempotencyKey,
      });
      // Refresh the stored surfaces so the committed job and its audit trail
      // are immediately visible.
      const [jobs, auditEvents, crosswalks] = await Promise.all([
        t.listJobs(workspaceId),
        t.listAuditEvents(workspaceId),
        t.listCrosswalks(workspaceId, ['candidate', 'rejected', 'superseded']),
      ]);
      this.set({ lastCommit: outcome, jobs, auditEvents, crosswalks });
      return outcome;
    });
  }

  /** The key a commit would use — shown in the UI before committing. */
  previewIdempotencyKey(runLabel: string): string | null {
    const { preview } = this.state;
    if (!preview || !runLabel) return null;
    return makeIdempotencyKey(preview.sourceLabel, preview.contentSha256, runLabel.trim());
  }

  async openJob(jobId: string): Promise<void> {
    await this.run(async () => {
      const workspaceId = this.requireWorkspace();
      const t = this.requireTransport();
      const [job, page, issues] = await Promise.all([
        t.getJob(workspaceId, jobId),
        t.listRecords(workspaceId, jobId, this.state.recordPageSize, 0),
        t.listIssues(workspaceId, jobId),
      ]);
      this.set({
        selectedJob: job,
        records: page.records,
        recordTotal: page.total,
        recordOffset: 0,
        issues,
      });
      return null;
    });
  }

  async pageRecords(offset: number): Promise<void> {
    const job = this.state.selectedJob;
    if (!job) return;
    const next = Math.max(0, offset);
    await this.run(async () => {
      const page = await this.requireTransport().listRecords(
        this.requireWorkspace(),
        job.id,
        this.state.recordPageSize,
        next
      );
      this.set({ records: page.records, recordTotal: page.total, recordOffset: next });
      return null;
    });
  }

  nextRecordPage() {
    return this.pageRecords(this.state.recordOffset + this.state.recordPageSize);
  }

  previousRecordPage() {
    return this.pageRecords(this.state.recordOffset - this.state.recordPageSize);
  }

  private async reviewAction(
    capable: boolean,
    deniedMessage: string,
    action: (t: ProvenanceTransport, workspaceId: string) => Promise<void>
  ): Promise<boolean> {
    if (!capable) {
      this.set({ error: deniedMessage });
      return false;
    }
    const result = await this.run(async () => {
      const workspaceId = this.requireWorkspace();
      const t = this.requireTransport();
      await action(t, workspaceId);
      const [crosswalks, auditEvents, jobs] = await Promise.all([
        t.listCrosswalks(workspaceId, ['candidate', 'rejected', 'superseded']),
        t.listAuditEvents(workspaceId),
        t.listJobs(workspaceId),
      ]);
      this.set({ crosswalks, auditEvents, jobs });
      if (this.state.selectedJob) {
        this.set({ issues: await t.listIssues(workspaceId, this.state.selectedJob.id) });
      }
      return true;
    });
    return result === true;
  }

  confirmCrosswalk(id: string, note?: string) {
    return this.reviewAction(
      this.state.capabilities.canReviewCrosswalks,
      'your role cannot confirm a crosswalk',
      (t, ws) => t.confirmCrosswalk(ws, id, note)
    );
  }

  rejectCrosswalk(id: string, note?: string) {
    return this.reviewAction(
      this.state.capabilities.canReviewCrosswalks,
      'your role cannot reject a crosswalk',
      (t, ws) => t.rejectCrosswalk(ws, id, note)
    );
  }

  supersedeCrosswalk(id: string, replacementId: string, note?: string) {
    return this.reviewAction(
      this.state.capabilities.canReviewCrosswalks,
      'your role cannot supersede a crosswalk',
      (t, ws) => t.supersedeCrosswalk(ws, id, replacementId, note)
    );
  }

  resolveIssue(id: string, status: DataQualityStatus, note?: string) {
    return this.reviewAction(
      this.state.capabilities.canResolveIssues,
      'your role cannot resolve an issue',
      (t, ws) => t.resolveIssue(ws, id, status, note)
    );
  }

  clearError() {
    this.set({ error: null });
  }
}
