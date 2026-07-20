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

export interface AcquisitionTransport {
  listJobs(workspaceId: string): Promise<AcquisitionJobRow[]>;
  listOrders(
    workspaceId: string,
    limit: number,
    offset: number
  ): Promise<{ total: number; orders: AcquisitionOrderRow[] }>;
  listSupplierCandidates(workspaceId: string): Promise<SupplierCandidate[]>;
  listAuditEvents(workspaceId: string): Promise<Array<Record<string, unknown>>>;
  preview(workspaceId: string, sourceImportJobId: string): Promise<PreviewSummary>;
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
  readonly orders: readonly AcquisitionOrderRow[];
  readonly totalOrders: number;
  readonly candidates: readonly SupplierCandidate[];
  readonly auditEvents: ReadonlyArray<Record<string, unknown>>;
  readonly preview: PreviewSummary | null;
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
      orders: [],
      totalOrders: 0,
      candidates: [],
      auditEvents: [],
      preview: null,
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

  async open(workspaceId: string, role: WorkspaceRole): Promise<void> {
    if (!this.transport || this.state.status === 'unconfigured') return;
    this.set({
      status: 'loading',
      workspaceId,
      role,
      capabilities: capabilitiesFor(role),
      error: null,
      preview: null,
    });
    try {
      const [jobs, orders, candidates, auditEvents] = await Promise.all([
        this.transport.listJobs(workspaceId),
        this.transport.listOrders(workspaceId, 50, 0),
        this.transport.listSupplierCandidates(workspaceId),
        this.transport.listAuditEvents(workspaceId),
      ]);
      this.set({
        status: 'ready',
        jobs,
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
        orders: [],
        totalOrders: 0,
        candidates: [],
        auditEvents: [],
      });
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
      this.set({ preview, error: null });
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : 'preview failed' });
    }
  }
}
