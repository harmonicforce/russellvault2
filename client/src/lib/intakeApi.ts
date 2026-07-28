// HTTP transport for the Phase 6A intake kernel (Quick Add).
//
// SHADOW / NON-AUTHORITATIVE. Every call carries the caller's own Supabase
// access token and an explicit workspace id to the server's /api/intake
// surface, which is dark by default. There is no service-role key and no
// business rule here: the SERVER is authoritative for field rules, blockers,
// state transitions, optimistic concurrency, identity coherence, source-state
// derivation, serialization, location resolution, duplicate detection,
// idempotency, receipts, and next-action. This client only renders what the
// server returns and never creates a location or a second intake engine.

export type TokenProvider = () => Promise<string | null>;
export type FetchLike = typeof fetch;

// ---- wire types (mirror server/src/intake/contract.ts) ---------------------
export type IntakeSourceState = 'unknown' | 'candidate' | 'stated';
export type TrackingMode = 'lot_managed' | 'serialized';
export type IntakeNextAction =
  | 'CONDITION_DETAILS_NEEDED'
  | 'LOCATION_ASSIGNMENT_NEEDED'
  | 'PHOTOS_NEEDED'
  | 'SOURCE_REVIEW_NEEDED'
  | 'READY_FOR_FUTURE_LISTING_PREP'
  | 'NO_IMMEDIATE_ACTION';

export interface IntakeBlocker {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}
export interface IntakeRuleEvaluation {
  readonly ready: boolean;
  readonly blockers: readonly IntakeBlocker[];
  readonly rule_version: string;
}
export interface IntakeSession {
  readonly id: string;
  readonly public_id: string;
  readonly state: 'open' | 'abandoned';
  readonly group_counts?: Record<string, number>;
}
export interface IntakeSessionListItem {
  readonly id: string;
  readonly public_id: string;
  readonly label: string | null;
  readonly state: 'open' | 'abandoned';
  readonly opened_at: string;
  readonly abandoned_at: string | null;
  readonly abandon_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly groupCounts: Record<string, number>;
}
export interface IntakeGroupRef {
  readonly id: string;
  readonly public_id: string;
  readonly state: 'draft' | 'ready_to_commit' | 'committed' | 'abandoned';
  readonly version: number;
  readonly source_state?: IntakeSourceState;
}
export interface IntakeReceiptItem {
  readonly entry_id: string;
  readonly entry_index: number;
  readonly item_id: string;
  readonly item_public_id: string;
  readonly scan_sku: string;
}
export interface IntakeCommitReceipt {
  readonly outcome: 'committed';
  readonly idempotent_replay: boolean;
  readonly session_id: string;
  readonly group_id: string;
  readonly group_public_id: string;
  readonly idempotency_key: string;
  readonly product_id: string;
  readonly product_public_id: string;
  readonly product_created: boolean;
  readonly sku_id: string;
  readonly sku_public_id: string;
  readonly sku_fingerprint: string;
  readonly sku_created: boolean;
  readonly lot_id: string;
  readonly lot_public_id: string;
  readonly tracking_mode: TrackingMode;
  readonly quantity: number;
  readonly items: readonly IntakeReceiptItem[];
  readonly source_state: IntakeSourceState;
  readonly source_evidence: Record<string, unknown>;
  readonly candidates: readonly Record<string, unknown>[];
  readonly applied_rule_version: string;
  readonly next_action: IntakeNextAction;
  readonly actor: string;
  readonly committed_at: string;
}
export interface IntakeCommitConflict {
  readonly outcome: 'conflict';
  readonly conflict_type:
    | 'stale_version'
    | 'content_hash_mismatch'
    | 'idempotency_content_changed'
    | 'already_committed';
  readonly message: string;
  readonly group_id: string;
  readonly expected_version?: number;
  readonly actual_version?: number;
}
export interface IntakeCommitBlocked {
  readonly outcome: 'blocked';
  readonly blockers: readonly IntakeBlocker[];
  readonly rule_version: string;
  readonly group_id: string;
}
/**
 * A sanitized reference to the ONE pre-existing item a duplicate-identity commit
 * collided with. Present only when the server actually resolved the prior item;
 * the client never fabricates a link when this is absent.
 */
export interface IntakeExistingItemRef {
  readonly item_public_id: string;
  readonly lot_public_id?: string;
  readonly scan_sku?: string;
}
export interface IntakeCommitFailed {
  readonly outcome: 'failed';
  readonly failure_class:
    | 'duplicate_identity'
    | 'check_violation'
    | 'foreign_key_violation'
    | 'internal_error';
  readonly sqlstate: string;
  readonly message: string;
  readonly group_id: string;
  // Only on a duplicate-identity failure, and only when the server found it.
  readonly existing_item?: IntakeExistingItemRef;
}
export type IntakeCommitResult =
  | IntakeCommitReceipt
  | IntakeCommitConflict
  | IntakeCommitBlocked
  | IntakeCommitFailed;

export interface IntakePreview {
  readonly staging: true;
  readonly authoritative: false;
  readonly content_hash: string;
  readonly product_canonical_key: string;
  readonly sku_fingerprint: string;
  readonly would_create_product: boolean;
  readonly would_create_sku: boolean;
  readonly tracking_mode: TrackingMode;
  readonly quantity: number;
  readonly serialized_child_count: number;
  readonly source_state: IntakeSourceState;
  readonly next_action_preview: IntakeNextAction;
  readonly ready: boolean;
  readonly blockers: readonly IntakeBlocker[];
  readonly rule_version: string;
}

// ---- Read-only recovery snapshot (resume / stale reload) -------------------
export type IntakeGroupState = 'draft' | 'ready_to_commit' | 'committed' | 'abandoned';

/** A group-list row: enough to pick a resume target and show its posture. */
export interface IntakeGroupSummary {
  readonly id: string;
  readonly public_id: string;
  readonly session_id: string;
  readonly state: IntakeGroupState;
  readonly version: number;
  readonly category: string;
  readonly business_vertical: string;
  readonly display_name: string;
  readonly quantity: number;
  readonly tracking_mode: TrackingMode;
  readonly serialized_child_count: number;
  readonly source_state: IntakeSourceState;
  readonly location_code: string | null;
  readonly next_action: IntakeNextAction | null;
  readonly applied_rule_version: string | null;
  readonly committed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The complete stored group as returned by the read-only snapshot. */
export interface IntakeGroupFull {
  readonly id: string;
  readonly public_id: string;
  readonly session_id: string;
  readonly state: IntakeGroupState;
  readonly version: number;
  readonly category: string;
  readonly business_vertical: string;
  readonly display_name: string;
  readonly product_attrs: Record<string, unknown>;
  readonly sku_attrs: Record<string, unknown>;
  readonly quantity: number;
  readonly tracking_mode: TrackingMode;
  readonly serialized_child_count: number;
  readonly source_state: IntakeSourceState;
  readonly source_evidence: Record<string, unknown>;
  readonly condition_state: string | null;
  readonly location_code: string | null;
  readonly owner_tagged: boolean;
  readonly unique_condition: boolean;
  readonly requires_item_media: boolean;
  readonly security_sensitive: boolean;
  readonly applied_rule_version: string | null;
  readonly next_action: IntakeNextAction | null;
  readonly committed_product_id: string | null;
  readonly committed_sku_id: string | null;
  readonly committed_lot_id: string | null;
  readonly committed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
export interface IntakeEntrySnapshot {
  readonly id: string;
  readonly public_id: string;
  readonly entry_index: number;
  readonly grading_company: string | null;
  readonly numeric_grade: string | null;
  readonly grade_designation: string | null;
  readonly certificate_number: string | null;
  readonly serial_number: string | null;
  readonly entry_attrs: Record<string, unknown>;
  readonly committed_item_id: string | null;
}
export interface IntakeGroupSnapshot {
  readonly group: IntakeGroupFull;
  readonly entries: readonly IntakeEntrySnapshot[];
  readonly candidates: readonly Record<string, unknown>[];
  // Live blockers + rule version while editable; null once terminal.
  readonly evaluation: IntakeRuleEvaluation | null;
  // Immutable receipt once committed; null otherwise.
  readonly receipt: IntakeCommitReceipt | null;
  readonly editable: boolean;
}

/** The governed graded-slab draft payload the server maps into typed columns. */
export interface GradedGroupPayload {
  readonly displayName: string;
  readonly productAttrs: Record<string, string>;
  readonly skuAttrs: Record<string, string>;
  readonly sourceEvidence: Record<string, string>;
  readonly locationCode: string | null;
}
export interface GradedEntryPayload {
  readonly gradingCompany: string | null;
  readonly numericGrade: string | null;
  readonly gradeDesignation: string | null;
  readonly certificateNumber: string | null;
}

// A group/entry mutation returns either the updated ref or a structured
// stale-version conflict (the server never silently overwrites).
export type GroupMutationResult = IntakeGroupRef | IntakeCommitConflict;
export interface EntryRef {
  readonly id: string;
  readonly public_id: string;
  readonly entry_index: number;
  readonly version: number;
}
export type EntryMutationResult = EntryRef | IntakeCommitConflict;

export interface IntakeSessionPage {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly sessions: readonly IntakeSessionListItem[];
}

export interface IntakeTransport {
  createSession(workspaceId: string, label?: string | null): Promise<IntakeSession>;
  resumeSession(workspaceId: string, sessionId: string): Promise<IntakeSession>;
  listSessions(workspaceId: string, limit?: number, offset?: number): Promise<IntakeSessionPage>;
  abandonSession(workspaceId: string, sessionId: string, reason?: string | null): Promise<IntakeSession>;
  listGroups(workspaceId: string, sessionId: string): Promise<readonly IntakeGroupSummary[]>;
  getGroupSnapshot(workspaceId: string, groupId: string): Promise<IntakeGroupSnapshot>;
  createGradedGroup(workspaceId: string, sessionId: string, payload: GradedGroupPayload): Promise<IntakeGroupRef>;
  updateGroup(
    workspaceId: string, groupId: string, expectedVersion: number, sessionId: string,
    payload: GradedGroupPayload,
  ): Promise<GroupMutationResult>;
  upsertEntry(
    workspaceId: string, groupId: string, expectedVersion: number, payload: GradedEntryPayload,
  ): Promise<EntryMutationResult>;
  evaluateRules(workspaceId: string, groupId: string): Promise<IntakeRuleEvaluation>;
  preview(workspaceId: string, groupId: string): Promise<IntakePreview>;
  commit(
    workspaceId: string, groupId: string, idempotencyKey: string, expectedVersion: number, contentHash: string,
  ): Promise<IntakeCommitResult>;
  getReceipt(workspaceId: string, groupId: string): Promise<IntakeCommitReceipt>;
  abandonGroup(workspaceId: string, groupId: string, reason?: string): Promise<{ state: string }>;
}

function isConflict(data: unknown): data is IntakeCommitConflict {
  return Boolean(data) && (data as { outcome?: string }).outcome === 'conflict';
}

/**
 * Build the graded-slab group request body. Category, quantity, tracking mode,
 * and serialized child count are WORKFLOW-FIXED Quick Add configuration (not
 * guessed product facts): a graded slab is always quantity 1, serialized, one
 * child. Factual attributes come only from what the operator entered.
 */
export function gradedGroupBody(
  workspaceId: string, sessionId: string, payload: GradedGroupPayload, expectedVersion?: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    workspaceId,
    sessionId,
    category: 'graded_tcg',
    displayName: payload.displayName,
    quantity: 1,
    trackingMode: 'serialized',
    serializedChildCount: 1,
    productAttrs: payload.productAttrs,
    skuAttrs: payload.skuAttrs,
    sourceEvidence: payload.sourceEvidence,
    locationCode: payload.locationCode,
  };
  if (expectedVersion !== undefined) body.expectedVersion = expectedVersion;
  return body;
}

export function createIntakeTransport(
  getToken: TokenProvider, fetchImpl: FetchLike = fetch,
): IntakeTransport {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getToken();
    if (!token) throw new Error('you are signed out; sign in to add inventory');
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetchImpl(`/api/intake${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404) throw new Error('the intake surface is not available');
    if (!res.ok) {
      let message = `request failed (${res.status})`;
      try {
        const parsed = (await res.json()) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch { /* ignore */ }
      throw new Error(message);
    }
    return (await res.json()) as T;
  }
  const ws = (workspaceId: string) => `workspaceId=${encodeURIComponent(workspaceId)}`;

  return {
    async createSession(workspaceId, label = null) {
      const body = await request<{ session: IntakeSession }>('POST', '/sessions', { workspaceId, label });
      return body.session;
    },
    async resumeSession(workspaceId, sessionId) {
      const body = await request<{ session: IntakeSession }>(
        'GET', `/sessions/${encodeURIComponent(sessionId)}?${ws(workspaceId)}`,
      );
      return body.session;
    },
    async listSessions(workspaceId, limit = 25, offset = 0) {
      return request<IntakeSessionPage>(
        'GET', `/sessions?${ws(workspaceId)}&limit=${limit}&offset=${offset}`,
      );
    },
    async abandonSession(workspaceId, sessionId, reason = null) {
      const body = await request<{ session: IntakeSession }>(
        'POST', `/sessions/${encodeURIComponent(sessionId)}/abandon`,
        { workspaceId, reason },
      );
      return body.session;
    },
    async listGroups(workspaceId, sessionId) {
      const body = await request<{ groups: readonly IntakeGroupSummary[] }>(
        'GET', `/sessions/${encodeURIComponent(sessionId)}/groups?${ws(workspaceId)}`,
      );
      return body.groups;
    },
    async getGroupSnapshot(workspaceId, groupId) {
      const body = await request<{ snapshot: IntakeGroupSnapshot }>(
        'GET', `/groups/${encodeURIComponent(groupId)}/snapshot?${ws(workspaceId)}`,
      );
      return body.snapshot;
    },
    async createGradedGroup(workspaceId, sessionId, payload) {
      const body = await request<{ group: IntakeGroupRef }>(
        'POST', '/groups', gradedGroupBody(workspaceId, sessionId, payload),
      );
      return body.group;
    },
    async updateGroup(workspaceId, groupId, expectedVersion, sessionId, payload) {
      const body = await request<{ group: GroupMutationResult }>(
        'PATCH', `/groups/${encodeURIComponent(groupId)}`,
        gradedGroupBody(workspaceId, sessionId, payload, expectedVersion),
      );
      return body.group;
    },
    async upsertEntry(workspaceId, groupId, expectedVersion, payload) {
      const body = await request<{ entry: EntryMutationResult }>(
        'POST', `/groups/${encodeURIComponent(groupId)}/entries`,
        {
          workspaceId, expectedVersion, entryIndex: 1,
          gradingCompany: payload.gradingCompany, numericGrade: payload.numericGrade,
          gradeDesignation: payload.gradeDesignation, certificateNumber: payload.certificateNumber,
        },
      );
      return body.entry;
    },
    async evaluateRules(workspaceId, groupId) {
      const body = await request<{ evaluation: IntakeRuleEvaluation }>(
        'GET', `/groups/${encodeURIComponent(groupId)}/rules?${ws(workspaceId)}`,
      );
      return body.evaluation;
    },
    async preview(workspaceId, groupId) {
      const body = await request<{ preview: IntakePreview }>(
        'GET', `/groups/${encodeURIComponent(groupId)}/preview?${ws(workspaceId)}`,
      );
      return body.preview;
    },
    async commit(workspaceId, groupId, idempotencyKey, expectedVersion, contentHash) {
      const body = await request<{ result: IntakeCommitResult }>(
        'POST', `/groups/${encodeURIComponent(groupId)}/commit`,
        { workspaceId, idempotencyKey, expectedVersion, contentHash },
      );
      return body.result;
    },
    async getReceipt(workspaceId, groupId) {
      const body = await request<{ receipt: IntakeCommitReceipt }>(
        'GET', `/groups/${encodeURIComponent(groupId)}/receipt?${ws(workspaceId)}`,
      );
      return body.receipt;
    },
    async abandonGroup(workspaceId, groupId, reason) {
      const body = await request<{ transition: { state: string } }>(
        'POST', `/groups/${encodeURIComponent(groupId)}/transition`,
        { workspaceId, targetState: 'abandoned', reason: reason ? { reason } : {} },
      );
      return body.transition;
    },
  };
}

export { isConflict };
