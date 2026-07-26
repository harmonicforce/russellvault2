// Phase 6A Quick Add — client-side view/state logic ONLY.
//
// This module holds NO business rules. Field rules, blockers, state
// transitions, optimistic concurrency, identity coherence, source-state
// derivation, serialization, location resolution, duplicate detection,
// idempotency, receipts, and next-action are the SERVER's authority; the client
// renders what the server returns and never contradicts it. Everything here is
// pure view logic (focus order, action model, keyboard intent, receipt/detail
// view-models, a UI-state reducer over server responses) so it can be unit
// tested without a DOM. The resulting inventory is SHADOW / NON-AUTHORITATIVE.

import { money } from './format';
import type {
  GradedEntryPayload,
  GradedGroupPayload,
  IntakeBlocker,
  IntakeCommitReceipt,
  IntakeCommitResult,
  IntakeExistingItemRef,
  IntakeGroupSnapshot,
  IntakeGroupState,
  IntakeGroupSummary,
} from './intakeApi';

export const SHADOW_LABEL = 'SHADOW / NON-AUTHORITATIVE';

// Workflow-fixed Quick Add configuration for a graded slab. These are workflow
// defaults, NOT guessed product facts: a graded slab is always quantity 1,
// serialized, exactly one child.
export const WORKFLOW_FIXED = {
  category: 'graded_tcg',
  quantity: 1,
  trackingMode: 'serialized',
  serializedChildCount: 1,
  productFormat: 'Graded slab',
} as const;

export type FieldKey =
  | 'certificate_number'
  | 'grading_company'
  | 'numeric_grade'
  | 'grade_designation'
  | 'card_name'
  | 'set_name'
  | 'card_number'
  | 'source_kind'
  | 'location_code';

export interface GradedFieldDef {
  readonly key: FieldKey;
  readonly label: string;
  readonly factual: boolean; // a fact that must never be invented/defaulted
  readonly optional: boolean;
}

// Visible, logical tab/focus order. Certificate number is first (scanner-first).
export const GRADED_FIELDS: readonly GradedFieldDef[] = [
  { key: 'certificate_number', label: 'Certificate number', factual: true, optional: false },
  { key: 'grading_company', label: 'Grading company', factual: true, optional: false },
  { key: 'numeric_grade', label: 'Numeric grade', factual: true, optional: false },
  { key: 'grade_designation', label: 'Grade designation', factual: true, optional: true },
  { key: 'card_name', label: 'Card name or featured subject', factual: true, optional: false },
  { key: 'set_name', label: 'Set name', factual: true, optional: false },
  { key: 'card_number', label: 'Card number', factual: true, optional: false },
  { key: 'source_kind', label: 'Source', factual: true, optional: false },
  { key: 'location_code', label: 'Location code', factual: true, optional: true },
];

export const INITIAL_FOCUS_FIELD: FieldKey = 'certificate_number';

// Presentation lists that MIRROR the server's governed reference lists
// (intake_reference_options). They only populate selects for convenience; the
// server remains authoritative and rejects any value it does not govern.
export const GRADING_COMPANY_OPTIONS: readonly string[] = ['PSA', 'CGC', 'BGS', 'SGC', 'TAG', 'AGS'];
export const SOURCE_KIND_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'personal_collection', label: 'Personal collection' },
  { value: 'retail_purchase', label: 'Retail purchase' },
  { value: 'marketplace_purchase', label: 'Marketplace purchase' },
  { value: 'trade', label: 'Trade' },
  { value: 'consignment', label: 'Consignment' },
  { value: 'other', label: 'Other' },
];

export type GradedValues = Record<FieldKey, string>;

/** A fresh draft: every factual field is visibly blank. No invented defaults. */
export function emptyGradedValues(): GradedValues {
  return {
    certificate_number: '', grading_company: '', numeric_grade: '', grade_designation: '',
    card_name: '', set_name: '', card_number: '', source_kind: '', location_code: '',
  };
}

/** True if a fresh draft has any factual value pre-filled (must be false). */
export function hasInventedFactualDefault(values: GradedValues): boolean {
  return GRADED_FIELDS.some((f) => f.factual && (values[f.key] ?? '') !== '');
}

const clean = (v: string): string => v.trim();
function prune(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const c = clean(v);
    if (c !== '') out[k] = c;
  }
  return out;
}

export function buildGroupPayload(values: GradedValues): GradedGroupPayload {
  return {
    displayName: clean(values.card_name),
    productAttrs: prune({
      featured_subject: values.card_name,
      set_name: values.set_name,
      card_number: values.card_number,
    }),
    // product_format is the graded category's definitional format (workflow
    // config), never a guessed fact; grade/company/etc. come only from input.
    skuAttrs: prune({
      grading_company: values.grading_company,
      numeric_grade: values.numeric_grade,
      grade_designation: values.grade_designation,
      product_format: WORKFLOW_FIXED.productFormat,
    }),
    sourceEvidence: clean(values.source_kind) ? { source_kind: clean(values.source_kind) } : {},
    locationCode: clean(values.location_code) || null,
  };
}

export function buildEntryPayload(values: GradedValues): GradedEntryPayload {
  return {
    gradingCompany: clean(values.grading_company) || null,
    numericGrade: clean(values.numeric_grade) || null,
    gradeDesignation: clean(values.grade_designation) || null,
    certificateNumber: clean(values.certificate_number) || null,
  };
}

// The server names blockers by its governed field id; map that to the client
// field to focus. Unknown / structural blockers focus the summary (null).
const BLOCKER_FIELD_MAP: Record<string, FieldKey> = {
  tcg_certificate_number: 'certificate_number',
  tcg_grading_company: 'grading_company',
  grading_company: 'grading_company',
  tcg_numeric_grade: 'numeric_grade',
  numeric_grade: 'numeric_grade',
  tcg_grade_designation: 'grade_designation',
  grade_designation: 'grade_designation',
  tcg_featured_subject: 'card_name',
  tcg_set_name: 'set_name',
  tcg_card_number: 'card_number',
  source_evidence: 'source_kind',
  source_state: 'source_kind',
  location_code: 'location_code',
};

export function blockerFieldKey(blocker: IntakeBlocker): FieldKey | null {
  return BLOCKER_FIELD_MAP[blocker.field] ?? null;
}
export function firstBlockerField(blockers: readonly IntakeBlocker[]): FieldKey | null {
  return blockers.length > 0 ? blockerFieldKey(blockers[0]) : null;
}

// ---- resume / stale-reload projections (read-only recovery) -----------------
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Reverse of buildGroupPayload/buildEntryPayload: project a server snapshot back
 * to the exact editable field values, never inventing anything the server did
 * not return. Graded identity (company/grade) is canonical on the SKU, so it is
 * read from sku_attrs and only falls back to the entry when the SKU omits it.
 */
export function snapshotToValues(snapshot: IntakeGroupSnapshot): GradedValues {
  const g = snapshot.group;
  const entry = snapshot.entries[0];
  return {
    certificate_number: asStr(entry?.certificate_number),
    grading_company: asStr(g.sku_attrs['grading_company']) || asStr(entry?.grading_company),
    numeric_grade: asStr(g.sku_attrs['numeric_grade']) || asStr(entry?.numeric_grade),
    grade_designation: asStr(g.sku_attrs['grade_designation']) || asStr(entry?.grade_designation),
    card_name: g.display_name,
    set_name: asStr(g.product_attrs['set_name']),
    card_number: asStr(g.product_attrs['card_number']),
    source_kind: asStr(g.source_evidence['source_kind']),
    location_code: asStr(g.location_code),
  };
}

const mostRecent = (
  groups: readonly IntakeGroupSummary[],
  state: IntakeGroupState,
): IntakeGroupSummary | null => {
  const matches = groups.filter((g) => g.state === state);
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (a.updated_at >= b.updated_at ? a : b));
};

/**
 * Pick the resume target with a deterministic priority (server truth only, no
 * invented state):
 *   1. Most recently updated ready_to_commit group (resumes editable).
 *   2. Most recently updated draft group (resumes editable).
 *   3. Most recently committed group (read-only).
 *   4. Most recently abandoned group (read-only).
 *   5. Nothing → null, so the caller begins a fresh draft in the resumed OPEN
 *      session (resuming never creates a group by itself).
 */
export function selectResumeGroup(
  groups: readonly IntakeGroupSummary[],
): IntakeGroupSummary | null {
  return (
    mostRecent(groups, 'ready_to_commit') ??
    mostRecent(groups, 'draft') ??
    mostRecent(groups, 'committed') ??
    mostRecent(groups, 'abandoned') ??
    null
  );
}

/** The first required field still blank — where focus lands after a resume. */
export function firstIncompleteRequiredField(values: GradedValues): FieldKey | null {
  for (const f of GRADED_FIELDS) {
    if (!f.optional && clean(values[f.key]) === '') return f.key;
  }
  return null;
}

/**
 * The next visible field in logical order — the scanner/Enter advance target.
 * This is a pure focus-order move (interaction convenience only); it makes NO
 * readiness decision. Returns null at the end of the form.
 */
export function nextField(current: FieldKey): FieldKey | null {
  const idx = GRADED_FIELDS.findIndex((f) => f.key === current);
  if (idx < 0 || idx >= GRADED_FIELDS.length - 1) return null;
  return GRADED_FIELDS[idx + 1].key;
}

/**
 * The in-app route target for an existing item, or null when none exists. Phase
 * 6A has no item-detail route, so this is always null: the UI must NOT fabricate
 * a link and instead directs the operator to Inventory search by public id.
 */
export function existingItemRoute(_ref: IntakeExistingItemRef): string | null {
  return null;
}

export const EXISTING_ITEM_SEARCH_HINT =
  'Existing item found. Use Inventory search with the displayed public identifier.';

// ---- UI state machine (over SERVER responses) ------------------------------
export type QuickAddPhase =
  | 'new'
  | 'editing'
  | 'ready'
  | 'committed'
  | 'duplicate'
  | 'stale'
  | 'network_unknown'
  | 'abandoned';

export interface QuickAddState {
  readonly phase: QuickAddPhase;
  readonly sessionId: string | null;
  readonly groupId: string | null;
  readonly version: number | null;
  readonly values: GradedValues;
  readonly blockers: readonly IntakeBlocker[];
  readonly ruleVersion: string | null;
  readonly idempotencyKey: string | null;
  readonly contentHash: string | null;
  readonly receipt: IntakeCommitReceipt | null;
  readonly conflict: { expected: number | null; actual: number | null } | null;
  readonly failure: { failureClass: string; message: string } | null;
  // A sanitized reference to the pre-existing item a duplicate collided with;
  // present only when the SERVER resolved it (never fabricated).
  readonly existingItem: IntakeExistingItemRef | null;
  // A non-error advisory the operator must see — e.g. a stale reload replaced
  // unsaved local values with the newer server version.
  readonly warning: string | null;
  readonly error: string | null;
}

export function initialQuickAddState(sessionId: string | null = null): QuickAddState {
  return {
    phase: 'new', sessionId, groupId: null, version: null, values: emptyGradedValues(),
    blockers: [], ruleVersion: null, idempotencyKey: null, contentHash: null, receipt: null,
    conflict: null, failure: null, existingItem: null, warning: null, error: null,
  };
}

export type QuickAddAction =
  | { type: 'SESSION_STARTED'; sessionId: string }
  | { type: 'FIELD_CHANGED'; field: FieldKey; value: string }
  | { type: 'GROUP_SYNCED'; groupId: string; version: number }
  | { type: 'READINESS'; ready: boolean; blockers: readonly IntakeBlocker[]; ruleVersion: string }
  | { type: 'COMMIT_STARTED'; idempotencyKey: string; contentHash: string; version: number }
  | { type: 'COMMIT_RESULT'; result: IntakeCommitResult }
  | { type: 'COMMIT_NETWORK_UNKNOWN' }
  // Read-only recovery: adopt a complete server snapshot on resume.
  | { type: 'HYDRATE'; snapshot: IntakeGroupSnapshot }
  // Stale reload: replace local values wholesale with the latest server snapshot.
  | { type: 'REPLACED_FROM_SERVER'; snapshot: IntakeGroupSnapshot; hadLocalEdits: boolean }
  | { type: 'ABANDONED' }
  | { type: 'RESET_FOR_ANOTHER' }
  | { type: 'RETURN_TO_SESSIONS' }
  | { type: 'ERROR'; message: string };

// Non-terminal groups resume into 'editing' so the operator re-checks readiness
// (minting a fresh content hash) before any commit; terminal groups stay
// read-only in their own phase.
function phaseForGroupState(groupState: IntakeGroupSnapshot['group']['state']): QuickAddPhase {
  if (groupState === 'committed') return 'committed';
  if (groupState === 'abandoned') return 'abandoned';
  return 'editing';
}

const TERMINAL: readonly QuickAddPhase[] = ['committed', 'abandoned'];

export function quickAddReducer(state: QuickAddState, action: QuickAddAction): QuickAddState {
  switch (action.type) {
    case 'SESSION_STARTED':
      return { ...state, sessionId: action.sessionId };

    case 'FIELD_CHANGED': {
      // Committed/abandoned are read-only; edits are ignored there.
      if (TERMINAL.includes(state.phase)) return state;
      // Any edit reopens to editing and clears a prior conflict/failure/receipt
      // preview, but preserves the operator's data. A changed draft also
      // invalidates the preview content hash and stored commit key.
      return {
        ...state,
        phase: 'editing',
        values: { ...state.values, [action.field]: action.value },
        conflict: null,
        failure: null,
        existingItem: null,
        warning: null,
        error: null,
        contentHash: null,
        idempotencyKey: null,
      };
    }

    case 'GROUP_SYNCED':
      return { ...state, groupId: action.groupId, version: action.version };

    case 'READINESS':
      return {
        ...state,
        phase: action.ready ? 'ready' : 'editing',
        blockers: action.blockers,
        ruleVersion: action.ruleVersion,
      };

    case 'COMMIT_STARTED':
      // Preserve the idempotency key + content hash so a retry after an unknown
      // network outcome reuses them exactly (no duplicate inventory).
      return {
        ...state,
        idempotencyKey: action.idempotencyKey,
        contentHash: action.contentHash,
        version: action.version,
      };

    case 'COMMIT_RESULT': {
      const r = action.result;
      if (r.outcome === 'committed') {
        return { ...state, phase: 'committed', receipt: r, blockers: [], conflict: null, failure: null, error: null };
      }
      if (r.outcome === 'blocked') {
        return { ...state, phase: 'editing', blockers: r.blockers, ruleVersion: r.rule_version };
      }
      if (r.outcome === 'failed') {
        if (r.failure_class === 'duplicate_identity') {
          return {
            ...state,
            phase: 'duplicate',
            failure: { failureClass: r.failure_class, message: r.message },
            existingItem: r.existing_item ?? null,
            receipt: null,
          };
        }
        // Any other genuine failure rolled back; the draft is recoverable.
        return { ...state, phase: 'editing', failure: { failureClass: r.failure_class, message: r.message }, error: r.message, idempotencyKey: null, contentHash: null };
      }
      // outcome === 'conflict'
      if (r.conflict_type === 'stale_version') {
        return {
          ...state,
          phase: 'stale',
          conflict: { expected: r.expected_version ?? null, actual: r.actual_version ?? null },
        };
      }
      // content_hash_mismatch / idempotency_content_changed / already_committed:
      // the local view is out of date — reload rather than overwrite.
      return { ...state, phase: 'stale', conflict: { expected: null, actual: null }, error: r.message };
    }

    case 'COMMIT_NETWORK_UNKNOWN':
      // Keep the key + hash so the retry is idempotent.
      return { ...state, phase: 'network_unknown' };

    case 'HYDRATE': {
      // Adopt a complete server snapshot on resume. Every value is the exact
      // stored server value (snapshotToValues); nothing is invented. A committed
      // or abandoned group hydrates read-only; an editable group hydrates into
      // 'editing' so readiness is re-checked (minting a fresh hash) before commit.
      const g = action.snapshot.group;
      const evaluation = action.snapshot.evaluation;
      return {
        ...state,
        phase: phaseForGroupState(g.state),
        sessionId: g.session_id,
        groupId: g.id,
        version: g.version,
        values: snapshotToValues(action.snapshot),
        blockers: evaluation?.blockers ?? [],
        ruleVersion: evaluation?.rule_version ?? g.applied_rule_version ?? null,
        idempotencyKey: null,
        contentHash: null,
        receipt: action.snapshot.receipt,
        conflict: null,
        failure: null,
        existingItem: null,
        warning: null,
        error: null,
      };
    }

    case 'REPLACED_FROM_SERVER': {
      // Stale reload: replace ALL local values + version + blockers + state +
      // receipt with the server snapshot in ONE transition (never a field merge),
      // clearing the stale conflict while preserving workspace/session identity.
      const hydrated = quickAddReducer(state, { type: 'HYDRATE', snapshot: action.snapshot });
      return {
        ...hydrated,
        warning: action.hadLocalEdits
          ? 'Unsaved local edits were discarded and replaced with the latest saved version from the server.'
          : null,
      };
    }

    case 'ABANDONED':
      return { ...state, phase: 'abandoned', blockers: [] };

    case 'RESET_FOR_ANOTHER':
      // Fresh draft in the SAME session; focus returns to certificate number.
      return initialQuickAddState(state.sessionId);

    case 'RETURN_TO_SESSIONS':
      // Read-only exit from a terminal group: drop back to the session picker.
      // No group is created; no mutation controls are exposed.
      return initialQuickAddState(null);

    case 'ERROR':
      return { ...state, error: action.message };

    default:
      return state;
  }
}

// ---- action model ----------------------------------------------------------
export interface QuickAddActionButton {
  readonly id: string;
  readonly label: string;
  readonly primary: boolean;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}

export function commitEnabled(state: QuickAddState): boolean {
  return state.phase === 'ready';
}

/** Exactly one primary action per state; never more than two visible actions. */
export function visibleActions(state: QuickAddState): readonly QuickAddActionButton[] {
  switch (state.phase) {
    case 'new':
      return [{ id: 'check', label: 'Check readiness', primary: true, enabled: true }];
    case 'editing':
      return [
        { id: 'check', label: 'Check readiness', primary: true, enabled: true },
        { id: 'abandon', label: 'Abandon draft', primary: false, enabled: true },
      ];
    case 'ready':
      return [{ id: 'commit', label: 'Commit slab', primary: true, enabled: true }];
    case 'duplicate':
      // "Review existing item" appears ONLY when the server actually resolved a
      // reference; "Edit certificate" is always available.
      return state.existingItem
        ? [
            { id: 'review-item', label: 'Review existing item', primary: true, enabled: true },
            { id: 'edit-cert', label: 'Edit certificate', primary: false, enabled: true },
          ]
        : [{ id: 'edit-cert', label: 'Edit certificate', primary: true, enabled: true }];
    case 'stale':
      return [{ id: 'reload', label: 'Reload latest', primary: true, enabled: true }];
    case 'network_unknown':
      return [{ id: 'retry', label: 'Retry commit', primary: true, enabled: true }];
    case 'committed':
      return [
        { id: 'another', label: 'Add another slab', primary: true, enabled: true },
        { id: 'view', label: 'View item', primary: false, enabled: true },
      ];
    case 'abandoned':
      // A terminal, read-only group: the single primary exit is back to sessions.
      return [{ id: 'return-sessions', label: 'Return to sessions', primary: true, enabled: true }];
    default:
      return [];
  }
}

export function isReadOnly(state: QuickAddState): boolean {
  return state.phase === 'abandoned' || state.phase === 'committed';
}

// ---- keyboard / scanner intent ---------------------------------------------
export type KeyboardIntent = 'advance' | 'commit' | 'focus_blockers' | 'close' | null;
export interface KeyEventLike {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export function resolveKeyboardIntent(evt: KeyEventLike, ctx: { ready: boolean }): KeyboardIntent {
  if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
    // Ctrl/Cmd+Enter commits ONLY when the server reports ready; otherwise it
    // moves focus to the blocker summary — it can never bypass readiness.
    return ctx.ready ? 'commit' : 'focus_blockers';
  }
  if (evt.key === 'Enter') return 'advance';
  if (evt.key === 'Escape') return 'close'; // never abandons a draft or session
  return null;
}

// ---- commit request (stable across retries) --------------------------------
export interface CommitRequest {
  readonly idempotencyKey: string;
  readonly contentHash: string;
  readonly expectedVersion: number;
}

/**
 * The commit arguments. A preserved key/hash (after a network-unknown outcome)
 * is REUSED so a retry is idempotent and can never create duplicate inventory;
 * only a truly fresh attempt mints a new key.
 */
export function commitRequest(state: QuickAddState, keyFactory: () => string): CommitRequest {
  if (state.contentHash == null || state.version == null) {
    throw new Error('a preview (content hash + version) is required before commit');
  }
  return {
    idempotencyKey: state.idempotencyKey ?? keyFactory(),
    contentHash: state.contentHash,
    expectedVersion: state.version,
  };
}

// ---- receipt + minimal item detail view-models -----------------------------
export interface ReceiptView {
  readonly productPublicId: string;
  readonly skuPublicId: string;
  readonly lotPublicId: string;
  readonly itemPublicId: string;
  readonly scanSku: string;
  readonly ruleVersion: string;
  readonly sourceState: string;
  readonly sourceKind: string | null;
  readonly nextAction: string;
  readonly idempotencyStatus: 'New commit' | 'Idempotent replay';
  readonly financialEffect: string; // "$0.00"
  readonly financialNote: string;
  readonly shadow: true;
}

function firstItem(receipt: IntakeCommitReceipt): IntakeCommitReceipt['items'][number] | null {
  return receipt.items.length > 0 ? receipt.items[0] : null;
}

export function receiptView(receipt: IntakeCommitReceipt): ReceiptView {
  const item = firstItem(receipt);
  return {
    productPublicId: receipt.product_public_id,
    skuPublicId: receipt.sku_public_id,
    lotPublicId: receipt.lot_public_id,
    itemPublicId: item?.item_public_id ?? '—',
    scanSku: item?.scan_sku ?? '—',
    ruleVersion: receipt.applied_rule_version,
    sourceState: receipt.source_state,
    sourceKind: (receipt.source_evidence?.source_kind as string | undefined) ?? null,
    nextAction: receipt.next_action,
    idempotencyStatus: receipt.idempotent_replay ? 'Idempotent replay' : 'New commit',
    // Phase 6A performs NO cost allocation; the financial effect is exactly zero.
    financialEffect: money(0),
    financialNote: 'Cost allocation is not performed in Phase 6A.',
    shadow: true,
  };
}

export interface ItemDetailView {
  readonly shadow: true;
  readonly shadowLabel: string;
  readonly displayName: string;
  readonly graderAndGrade: string;
  readonly certificateNumber: string;
  readonly productPublicId: string;
  readonly skuPublicId: string;
  readonly lotPublicId: string;
  readonly itemPublicId: string;
  readonly scanSku: string;
  readonly sourceState: string;
  readonly sourceKind: string | null;
  readonly location: string | null;
  readonly intakeSession: string;
  readonly ruleVersion: string;
  readonly receiptStatus: string;
  readonly nextAction: string;
}

/** Fields that must NEVER appear in the Phase 6A minimal Item Detail. */
export const FORBIDDEN_DETAIL_FIELDS: readonly string[] = [
  'cost', 'costAllocation', 'listing', 'listings', 'photo', 'photos', 'sales', 'sale',
  'marketplace', 'marketplaceStatus', 'profit', 'profitability', 'movement', 'reconciliation',
];

export function itemDetailView(receipt: IntakeCommitReceipt, values: GradedValues): ItemDetailView {
  const item = firstItem(receipt);
  const grade = [clean(values.grading_company), clean(values.numeric_grade), clean(values.grade_designation)]
    .filter((s) => s !== '')
    .join(' ');
  return {
    shadow: true,
    shadowLabel: SHADOW_LABEL,
    displayName: clean(values.card_name),
    graderAndGrade: grade,
    certificateNumber: clean(values.certificate_number),
    productPublicId: receipt.product_public_id,
    skuPublicId: receipt.sku_public_id,
    lotPublicId: receipt.lot_public_id,
    itemPublicId: item?.item_public_id ?? '—',
    scanSku: item?.scan_sku ?? '—',
    sourceState: receipt.source_state,
    sourceKind: (receipt.source_evidence?.source_kind as string | undefined) ?? null,
    location: clean(values.location_code) || null,
    intakeSession: receipt.session_id,
    ruleVersion: receipt.applied_rule_version,
    receiptStatus: receipt.idempotent_replay ? 'Idempotent replay' : 'New commit',
    nextAction: receipt.next_action,
  };
}

// ---- accessibility + responsive layout -------------------------------------
export function liveRegionMessage(state: QuickAddState): string {
  if (state.warning) return state.warning;
  switch (state.phase) {
    case 'new':
      return 'New graded slab draft. Scan or type the certificate number to begin.';
    case 'editing':
      if (state.blockers.length > 0) {
        return `${state.blockers.length} issue${state.blockers.length === 1 ? '' : 's'} need attention. First: ${state.blockers[0].message}`;
      }
      return 'Draft updated.';
    case 'ready':
      return 'Ready to commit. Permanent IDs have not been minted yet.';
    case 'committed':
      return `Committed. Item ${state.receipt?.items[0]?.item_public_id ?? ''} created.`;
    case 'duplicate':
      return 'Duplicate certificate. This slab already exists; the draft was preserved and nothing was created.';
    case 'stale':
      return 'This draft changed elsewhere. Reload the latest before committing.';
    case 'network_unknown':
      return 'The last commit result is unknown. Retry with the same values; a completed commit will replay its receipt.';
    case 'abandoned':
      return 'This draft is abandoned and read only.';
    default:
      return '';
  }
}

export type PanelLayout = 'side-by-side' | 'stacked';
/** Desktop (>= ~1280) shows form + readiness panel side by side; iPad stacks. */
export function layoutForWidth(width: number): PanelLayout {
  return width >= 1200 ? 'side-by-side' : 'stacked';
}
// The page container clips horizontal overflow and every panel is min-w-0 so
// long ids/scan codes wrap instead of forcing the body to scroll sideways.
export const CONTAINER_CLASS = 'w-full max-w-6xl mx-auto overflow-x-hidden';
export const PANEL_CLASS = 'min-w-0 break-words';
