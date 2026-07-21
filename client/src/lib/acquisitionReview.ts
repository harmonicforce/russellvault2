// Controller for the Phase 4 acquisition-review interface — STAGING /
// NON-AUTHORITATIVE. Holds all state and permission logic so the page
// (pages/AcquisitionReview.tsx) is presentation only, and so this logic is
// unit-testable without a browser.
//
// SAFE BY DEFAULT: constructed with a null transport (the 'unconfigured' state)
// it makes no request and every capability is off. FAIL CLOSED: any load error
// leaves the surface in an error state, never a partially-authoritative one.
//
// Viewer vs operator/owner: a viewer can read every staging surface but cannot
// run the governed preview/commit workflow. That is an affordance only — the
// server re-checks the role and the database enforces it again.

export type WorkspaceRole = 'owner' | 'operator' | 'viewer';

export interface AcquisitionOrderRow {
  readonly id: string;
  readonly public_id: string;
  readonly source_order_reference: string;
  readonly order_status: string;
  readonly source_reported_status: string;
  readonly source_reported_total_minor: number | null;
  readonly currency: string;
  readonly occurred_at: string | null;
  readonly supplier_id: string;
  readonly suppliers?: { public_id: string } | null;
}

export interface SupplierCandidate {
  readonly sourceSystemId: string;
  readonly normalizedHandle: string;
  readonly rawHandles: readonly string[];
  readonly supplierCount: number;
}

export interface AcquisitionJobRow {
  readonly id: string;
  readonly status: string;
  readonly mode: string;
  readonly expected_line_count: number;
  readonly idempotency_key: string;
}

export interface PreviewSummary {
  readonly orders: number;
  readonly lots: number;
  readonly lineItems: number;
  readonly costComponents: number;
  readonly unresolvedSupplierCandidates: number;
  readonly unresolvedCostComponents: number;
  readonly distinctSellerHandles: number;
  readonly sourceReportedTotalMinor: number;
  readonly normalizedKnownComponentMinor: number;
  readonly knownComponents: number;
  readonly documentedFreeComponents: number;
  readonly unknownComponents: number;
  readonly discrepancies: number;
  readonly supplierCandidates: readonly SupplierCandidate[];
  readonly staging: true;
  readonly authoritative: false;
}

export interface ChannelRow {
  readonly id: string;
  readonly public_id: string;
  readonly name: string;
  readonly kind: string;
}

export interface OrderDetail {
  readonly order: Record<string, unknown>;
  readonly lots: ReadonlyArray<Record<string, unknown>>;
  readonly placements: ReadonlyArray<Record<string, unknown>>;
  readonly activePlacements: ReadonlyArray<Record<string, unknown>>;
  readonly historicalPlacements: ReadonlyArray<Record<string, unknown>>;
  readonly lines: ReadonlyArray<Record<string, unknown>>;
  readonly costComponents: ReadonlyArray<Record<string, unknown>>;
  readonly currentComponents: ReadonlyArray<Record<string, unknown>>;
  readonly historicalComponents: ReadonlyArray<Record<string, unknown>>;
  readonly allocations: ReadonlyArray<Record<string, unknown>>;
  readonly currentAllocations: ReadonlyArray<Record<string, unknown>>;
  readonly reversedAllocations: ReadonlyArray<Record<string, unknown>>;
  readonly discrepancy: Record<string, unknown>;
  readonly auditEvents: ReadonlyArray<Record<string, unknown>>;
}

export interface CommitOutcome {
  readonly importJobId: string;
  readonly status: string;
  readonly orders: number;
  readonly lineItems: number;
  readonly resumed: boolean;
}

export interface AcquisitionTransport {
  /** The caller's ACTUAL role, resolved by the server/database (never the UI). */
  getSession(workspaceId: string): Promise<{ role: WorkspaceRole }>;
  listJobs(workspaceId: string): Promise<AcquisitionJobRow[]>;
  listChannels(workspaceId: string): Promise<ChannelRow[]>;
  listOrders(
    workspaceId: string,
    limit: number,
    offset: number
  ): Promise<{ total: number; orders: AcquisitionOrderRow[] }>;
  getOrderDetail(workspaceId: string, orderId: string): Promise<OrderDetail>;
  listSupplierCandidates(workspaceId: string): Promise<SupplierCandidate[]>;
  listAuditEvents(workspaceId: string): Promise<Array<Record<string, unknown>>>;
  preview(workspaceId: string, sourceImportJobId: string): Promise<PreviewSummary>;
  commit(
    workspaceId: string,
    input: { sourceImportJobId: string; channelId: string; idempotencyKey: string }
  ): Promise<CommitOutcome>;
}

export interface AcquisitionCapabilities {
  /** True only for owner/operator: may run the governed preview/commit path. */
  readonly canRunWorkflow: boolean;
  /** True for a viewer: mutating controls are disabled affordances. */
  readonly readOnly: boolean;
}

export type AcquisitionStatus =
  | 'unconfigured'
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error';

export interface AcquisitionReviewState {
  readonly status: AcquisitionStatus;
  readonly workspaceId: string | null;
  readonly role: WorkspaceRole | null;
  readonly capabilities: AcquisitionCapabilities;
  readonly jobs: readonly AcquisitionJobRow[];
  readonly channels: readonly ChannelRow[];
  readonly orders: readonly AcquisitionOrderRow[];
  readonly totalOrders: number;
  readonly candidates: readonly SupplierCandidate[];
  readonly auditEvents: ReadonlyArray<Record<string, unknown>>;
  readonly preview: PreviewSummary | null;
  /** The exact source job the current preview is for; commit is gated on it. */
  readonly previewedSourceJobId: string | null;
  readonly orderDetail: OrderDetail | null;
  readonly commitOutcome: CommitOutcome | null;
  readonly error: string | null;
  /** Always true: this surface is never the system of record. */
  readonly staging: true;
  readonly authoritative: false;
}

function capabilitiesFor(role: WorkspaceRole | null): AcquisitionCapabilities {
  const canRunWorkflow = role === 'owner' || role === 'operator';
  return { canRunWorkflow, readOnly: !canRunWorkflow };
}

const CLOSED_CAPS: AcquisitionCapabilities = { canRunWorkflow: false, readOnly: true };

export class AcquisitionReviewController {
  private state: AcquisitionReviewState;
  private listeners = new Set<(s: AcquisitionReviewState) => void>();
  private readonly transport: AcquisitionTransport | null;

  constructor(transport: AcquisitionTransport | null, configured: boolean) {
    this.transport = transport;
    this.state = {
      status: configured && transport ? 'idle' : 'unconfigured',
      workspaceId: null,
      role: null,
      capabilities: CLOSED_CAPS,
      jobs: [],
      channels: [],
      orders: [],
      totalOrders: 0,
      candidates: [],
      auditEvents: [],
      preview: null,
      previewedSourceJobId: null,
      orderDetail: null,
      commitOutcome: null,
      error: null,
      staging: true,
      authoritative: false,
    };
  }

  getState(): AcquisitionReviewState {
    return this.state;
  }

  subscribe(fn: (s: AcquisitionReviewState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AcquisitionReviewState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  async open(workspaceId: string): Promise<void> {
    if (!this.transport || this.state.status === 'unconfigured') return;
    this.set({
      status: 'loading',
      workspaceId,
      role: null,
      capabilities: CLOSED_CAPS,
      error: null,
      preview: null,
      previewedSourceJobId: null,
      orderDetail: null,
      commitOutcome: null,
    });
    try {
      // The caller's ACTUAL role is resolved by the server; capabilities derive
      // from it, never from any value the UI supplied.
      const session = await this.transport.getSession(workspaceId);
      const role = session.role;
      const [jobs, channels, orders, candidates, auditEvents] = await Promise.all([
        this.transport.listJobs(workspaceId),
        this.transport.listChannels(workspaceId),
        this.transport.listOrders(workspaceId, 50, 0),
        this.transport.listSupplierCandidates(workspaceId),
        this.transport.listAuditEvents(workspaceId),
      ]);
      this.set({
        status: 'ready',
        role,
        capabilities: capabilitiesFor(role),
        jobs,
        channels,
        orders: orders.orders,
        totalOrders: orders.total,
        candidates,
        auditEvents,
      });
    } catch (err) {
      // Fail closed: no partial data is shown as if authoritative.
      this.set({
        status: 'error',
        error: err instanceof Error ? err.message : 'failed to load acquisition data',
        jobs: [],
        channels: [],
        orders: [],
        totalOrders: 0,
        candidates: [],
        auditEvents: [],
      });
    }
  }

  async openOrder(orderId: string): Promise<void> {
    if (!this.transport || !this.state.workspaceId) return;
    try {
      const orderDetail = await this.transport.getOrderDetail(this.state.workspaceId, orderId);
      this.set({ orderDetail, error: null });
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : 'failed to load order detail' });
    }
  }

  async runCommit(input: {
    sourceImportJobId: string;
    channelId: string;
    idempotencyKey: string;
  }): Promise<void> {
    if (!this.transport || !this.state.workspaceId) return;
    // A viewer cannot run the governed commit; refuse before any request.
    if (!this.state.capabilities.canRunWorkflow) {
      this.set({ error: 'committing requires an operator or owner role' });
      return;
    }
    // Commit is gated on a SUCCESSFUL preview of the EXACT same source job. A
    // changed source job (or none previewed) is refused before any request.
    if (this.state.previewedSourceJobId !== input.sourceImportJobId) {
      this.set({ error: 'preview this source import job before committing it' });
      return;
    }
    try {
      const commitOutcome = await this.transport.commit(this.state.workspaceId, input);
      // Refresh the loaded data after a commit, THEN surface the outcome (open()
      // resets transient fields, so the outcome is set last to stay visible).
      const ws = this.state.workspaceId;
      if (ws) await this.open(ws);
      this.set({ commitOutcome, error: null });
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : 'commit failed' });
    }
  }

  /** Invalidate a stale preview when the operator changes the source job. */
  clearPreview(): void {
    if (this.state.preview || this.state.previewedSourceJobId) {
      this.set({ preview: null, previewedSourceJobId: null });
    }
  }

  async runPreview(sourceImportJobId: string): Promise<void> {
    if (!this.transport || !this.state.workspaceId) return;
    // A viewer cannot run the governed workflow; refuse before any request.
    if (!this.state.capabilities.canRunWorkflow) {
      this.set({ error: 'previewing requires an operator or owner role' });
      return;
    }
    try {
      const preview = await this.transport.preview(this.state.workspaceId, sourceImportJobId);
      // Record EXACTLY which source job this preview is for; commit is gated on it.
      this.set({ preview, previewedSourceJobId: sourceImportJobId, error: null });
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : 'preview failed' });
    }
  }
}
