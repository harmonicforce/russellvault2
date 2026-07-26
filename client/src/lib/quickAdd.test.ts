// Phase 6A Quick Add — pure client logic tests (the 17 acceptance behaviors).
// The SERVER is authoritative; these prove the client renders/recovers correctly
// and never invents facts, bypasses readiness, or duplicates inventory.
import { it, expect } from 'vitest';
import type {
  IntakeCommitConflict,
  IntakeCommitFailed,
  IntakeCommitReceipt,
  IntakeGroupSnapshot,
  IntakeGroupSummary,
} from './intakeApi';
import {
  CONTAINER_CLASS,
  EXISTING_ITEM_SEARCH_HINT,
  FORBIDDEN_DETAIL_FIELDS,
  GRADED_FIELDS,
  INITIAL_FOCUS_FIELD,
  SHADOW_LABEL,
  buildEntryPayload,
  buildGroupPayload,
  commitEnabled,
  commitRequest,
  emptyGradedValues,
  existingItemRoute,
  firstBlockerField,
  firstIncompleteRequiredField,
  hasInventedFactualDefault,
  initialQuickAddState,
  isReadOnly,
  itemDetailView,
  layoutForWidth,
  liveRegionMessage,
  nextField,
  quickAddReducer,
  receiptView,
  resolveKeyboardIntent,
  selectResumeGroup,
  snapshotToValues,
  visibleActions,
  type GradedValues,
  type QuickAddState,
} from './quickAdd';

function filled(overrides: Partial<GradedValues> = {}): GradedValues {
  return {
    certificate_number: 'CGC-77001', grading_company: 'CGC', numeric_grade: '9.5',
    grade_designation: '', card_name: 'Charizard', set_name: 'Base Set', card_number: '4',
    source_kind: 'personal_collection', location_code: '', ...overrides,
  };
}

const RECEIPT: IntakeCommitReceipt = {
  outcome: 'committed', idempotent_replay: false, session_id: 'sess-1', group_id: 'g-1',
  group_public_id: 'RV-IG-1', idempotency_key: 'key-1', product_id: 'p-1', product_public_id: 'RV-PROD-1',
  product_created: true, sku_id: 's-1', sku_public_id: 'RV-SKU-1', sku_fingerprint: 'f'.repeat(64),
  sku_created: true, lot_id: 'l-1', lot_public_id: 'RV-I-0000000001', tracking_mode: 'serialized',
  quantity: 1, items: [{ entry_id: 'e-1', entry_index: 1, item_id: 'i-1', item_public_id: 'RV-ITEM-1', scan_sku: 'RV-7K3F9Q2' }],
  source_state: 'stated', source_evidence: { source_kind: 'personal_collection' }, candidates: [],
  applied_rule_version: 'INTAKE_RULES_1', next_action: 'READY_FOR_FUTURE_LISTING_PREP',
  actor: 'u-1', committed_at: '2026-07-26T00:00:00Z',
};

// 1. A new draft contains no invented factual defaults.
it('1. a new Quick Add draft has no invented factual defaults', () => {
  const v = emptyGradedValues();
  expect(hasInventedFactualDefault(v)).toBe(false);
  for (const f of GRADED_FIELDS) expect(v[f.key]).toBe('');
});

// 2. Certificate number receives initial focus.
it('2. certificate number receives initial focus', () => {
  expect(INITIAL_FOCUS_FIELD).toBe('certificate_number');
  expect(GRADED_FIELDS[0].key).toBe('certificate_number');
});

// 3. Required server blockers disable commit.
it('3. server blockers keep the draft in editing and disable commit', () => {
  let s = initialQuickAddState('sess-1');
  s = quickAddReducer(s, { type: 'READINESS', ready: false, ruleVersion: 'INTAKE_RULES_1',
    blockers: [{ code: 'missing_required', field: 'tcg_numeric_grade', message: 'numeric grade is required' }] });
  expect(s.phase).toBe('editing');
  expect(commitEnabled(s)).toBe(false);
  expect(visibleActions(s).some((a) => a.id === 'commit')).toBe(false);
  expect(firstBlockerField(s.blockers)).toBe('numeric_grade');
});

// 4. Ready enables exactly one primary commit action (max two visible actions).
it('4. ready state exposes exactly one primary Commit action', () => {
  let s = initialQuickAddState('sess-1');
  s = quickAddReducer(s, { type: 'READINESS', ready: true, ruleVersion: 'INTAKE_RULES_1', blockers: [] });
  expect(s.phase).toBe('ready');
  const actions = visibleActions(s);
  expect(actions.length).toBeLessThanOrEqual(2);
  expect(actions.filter((a) => a.primary)).toHaveLength(1);
  expect(actions[0]).toMatchObject({ id: 'commit', primary: true, enabled: true });
  expect(commitEnabled(s)).toBe(true);
});

// every non-terminal state has exactly one primary; none exceeds two actions.
it('4b. every state has one primary action and at most two actions', () => {
  const phases = ['new', 'editing', 'ready', 'duplicate', 'stale', 'network_unknown', 'committed'] as const;
  for (const phase of phases) {
    const s = { ...initialQuickAddState('s'), phase } as ReturnType<typeof initialQuickAddState>;
    const actions = visibleActions(s);
    expect(actions.length, phase).toBeLessThanOrEqual(2);
    expect(actions.filter((a) => a.primary).length, phase).toBe(1);
  }
});

// 5. Ctrl/Command+Enter cannot bypass readiness.
it('5. Ctrl/Cmd+Enter commits only when ready, else focuses blockers', () => {
  expect(resolveKeyboardIntent({ key: 'Enter', ctrlKey: true }, { ready: false })).toBe('focus_blockers');
  expect(resolveKeyboardIntent({ key: 'Enter', metaKey: true }, { ready: false })).toBe('focus_blockers');
  expect(resolveKeyboardIntent({ key: 'Enter', ctrlKey: true }, { ready: true })).toBe('commit');
  expect(resolveKeyboardIntent({ key: 'Enter' }, { ready: true })).toBe('advance');
  // Escape never abandons.
  expect(resolveKeyboardIntent({ key: 'Escape' }, { ready: true })).toBe('close');
});

// 6. Duplicate certificate preserves the draft and shows no receipt.
it('6. a duplicate-certificate failure preserves the draft with no receipt', () => {
  let s: QuickAddState = { ...initialQuickAddState('sess-1'), phase: 'ready' as const, values: filled(), groupId: 'g-1', version: 3, contentHash: 'h', idempotencyKey: 'k' };
  const dup: IntakeCommitFailed = { outcome: 'failed', failure_class: 'duplicate_identity', sqlstate: '23505', message: 'duplicate certificate', group_id: 'g-1' };
  s = quickAddReducer(s, { type: 'COMMIT_RESULT', result: dup });
  expect(s.phase).toBe('duplicate');
  expect(s.receipt).toBeNull();
  expect(s.values).toEqual(filled()); // draft preserved
  expect(visibleActions(s).some((a) => a.id === 'edit-cert' && a.primary)).toBe(true);
});

// 7. Stale version does not overwrite newer server data.
it('7. a stale-version conflict shows expected vs current and preserves data', () => {
  let s: QuickAddState = { ...initialQuickAddState('sess-1'), phase: 'ready' as const, values: filled(), version: 2 };
  const conflict: IntakeCommitConflict = { outcome: 'conflict', conflict_type: 'stale_version', message: 'stale', group_id: 'g-1', expected_version: 2, actual_version: 5 };
  s = quickAddReducer(s, { type: 'COMMIT_RESULT', result: conflict });
  expect(s.phase).toBe('stale');
  expect(s.conflict).toEqual({ expected: 2, actual: 5 });
  expect(s.values).toEqual(filled()); // no overwrite
  expect(visibleActions(s)[0]).toMatchObject({ id: 'reload', primary: true });
});

// 8. Network retry reuses the same idempotency key and content hash.
it('8. a network-unknown retry reuses the same idempotency key and content hash', () => {
  let s: QuickAddState = { ...initialQuickAddState('sess-1'), phase: 'ready' as const, contentHash: 'HASH', version: 4 };
  const req1 = commitRequest(s, () => 'key-A');
  s = quickAddReducer(s, { type: 'COMMIT_STARTED', idempotencyKey: req1.idempotencyKey, contentHash: req1.contentHash, version: req1.expectedVersion });
  s = quickAddReducer(s, { type: 'COMMIT_NETWORK_UNKNOWN' });
  expect(s.phase).toBe('network_unknown');
  const req2 = commitRequest(s, () => 'key-B-different');
  expect(req2.idempotencyKey).toBe('key-A');
  expect(req2.contentHash).toBe('HASH');
  expect(req2.expectedVersion).toBe(4);
});

// 9. An idempotent committed replay renders the existing receipt.
it('9. an idempotent replay renders the committed receipt', () => {
  let s: QuickAddState = { ...initialQuickAddState('sess-1'), phase: 'network_unknown' as const, idempotencyKey: 'k', contentHash: 'h', version: 3 };
  const replay: IntakeCommitReceipt = { ...RECEIPT, idempotent_replay: true };
  s = quickAddReducer(s, { type: 'COMMIT_RESULT', result: replay });
  expect(s.phase).toBe('committed');
  expect(s.receipt?.idempotent_replay).toBe(true);
  expect(receiptView(s.receipt!).idempotencyStatus).toBe('Idempotent replay');
});

// 10. Abandoned sessions/groups are read-only with only a Return to sessions exit.
it('10. an abandoned draft is read-only with only a Return to sessions exit', () => {
  let s = quickAddReducer(initialQuickAddState('sess-1'), { type: 'ABANDONED' });
  expect(s.phase).toBe('abandoned');
  expect(isReadOnly(s)).toBe(true);
  // Exactly one primary, read-only exit action; NO edit/commit/readiness controls.
  const actions = visibleActions(s);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ id: 'return-sessions', primary: true });
  for (const forbidden of ['check', 'commit', 'edit-cert', 'reload', 'retry', 'abandon']) {
    expect(actions.some((a) => a.id === forbidden)).toBe(false);
  }
  // a field change is ignored (no mutation).
  const before = s.values;
  s = quickAddReducer(s, { type: 'FIELD_CHANGED', field: 'numeric_grade', value: '10' });
  expect(s.values).toBe(before);
  // Return to sessions drops back to the picker (no session, no group).
  s = quickAddReducer(s, { type: 'RETURN_TO_SESSIONS' });
  expect(s.sessionId).toBeNull();
  expect(s.groupId).toBeNull();
  expect(s.phase).toBe('new');
});

// 11. Add another slab preserves the session and creates a new draft.
it('11. Add another slab keeps the session and starts a fresh draft', () => {
  let s: QuickAddState = { ...initialQuickAddState('sess-KEEP'), phase: 'committed' as const, receipt: RECEIPT, values: filled(), groupId: 'g-1', version: 3 };
  s = quickAddReducer(s, { type: 'RESET_FOR_ANOTHER' });
  expect(s.sessionId).toBe('sess-KEEP');
  expect(s.groupId).toBeNull();
  expect(s.phase).toBe('new');
  expect(hasInventedFactualDefault(s.values)).toBe(false);
});

// 12. The minimal Item Detail shows the non-authoritative shadow indicator.
it('12. minimal Item Detail carries the SHADOW / NON-AUTHORITATIVE indicator', () => {
  const view = itemDetailView(RECEIPT, filled());
  expect(view.shadow).toBe(true);
  expect(view.shadowLabel).toBe(SHADOW_LABEL);
  expect(view.itemPublicId).toBe('RV-ITEM-1');
  expect(view.scanSku).toBe('RV-7K3F9Q2');
});

// 13. No cost, listing, photo, sales, or Phase 6B controls appear.
it('13. the Item Detail and receipt views expose no cost/listing/photo/sales fields', () => {
  const detailKeys = Object.keys(itemDetailView(RECEIPT, filled()));
  const receiptKeys = Object.keys(receiptView(RECEIPT));
  for (const forbidden of FORBIDDEN_DETAIL_FIELDS) {
    expect(detailKeys).not.toContain(forbidden);
    expect(receiptKeys).not.toContain(forbidden);
  }
  // The only financial surface is an explicit zero effect.
  expect(receiptView(RECEIPT).financialEffect).toBe('$0.00');
});

// 14. Desktop and iPad layouts render without horizontal overflow.
it('14. desktop is side-by-side, iPad stacks, and the container clips x-overflow', () => {
  expect(layoutForWidth(1440)).toBe('side-by-side');
  expect(layoutForWidth(1024)).toBe('stacked');
  expect(CONTAINER_CLASS).toContain('overflow-x-hidden');
  expect(CONTAINER_CLASS).toContain('max-w');
});

// 15. Blocker focus and live-region behavior are accessible.
it('15. the first blocker maps to a focusable field and a live message announces it', () => {
  const s = { ...initialQuickAddState('s'), phase: 'editing' as const,
    blockers: [{ code: 'missing_required', field: 'tcg_certificate_number', message: 'certificate number is required' }] };
  expect(firstBlockerField(s.blockers)).toBe('certificate_number');
  expect(liveRegionMessage(s)).toContain('certificate number is required');
  expect(liveRegionMessage({ ...initialQuickAddState('s'), phase: 'ready' })).toContain('Ready to commit');
});

// 16. The client never creates a location during intake.
it('16. the group payload references a location code and never mints one', () => {
  const payload = buildGroupPayload(filled({ location_code: 'BIN-1' }));
  expect(payload.locationCode).toBe('BIN-1');
  // location is a plain code reference; there is no create-location field anywhere.
  expect(JSON.stringify(payload)).not.toMatch(/register_storage_location|createLocation|newLocation/i);
  // an empty location stays null (never invented).
  expect(buildGroupPayload(filled()).locationCode).toBeNull();
});

// no fabricated factual attrs make it into the payload when values are blank.
it('16b. blank factual fields are omitted from the payload (unknown stays blank)', () => {
  const payload = buildGroupPayload(emptyGradedValues());
  expect(payload.displayName).toBe('');
  expect(payload.productAttrs).toEqual({});
  // product_format is the category's definitional format, the only sku attr set.
  expect(payload.skuAttrs).toEqual({ product_format: 'Graded slab' });
  expect(payload.sourceEvidence).toEqual({});
  const entry = buildEntryPayload(emptyGradedValues());
  expect(entry).toEqual({ gradingCompany: null, numericGrade: null, gradeDesignation: null, certificateNumber: null });
});

// ---- Read-only recovery contract (resume / stale reload / duplicate ref) -----

function summary(over: Partial<IntakeGroupSummary> = {}): IntakeGroupSummary {
  return {
    id: 'g', public_id: 'RV-IG-1', session_id: 'sess-1', state: 'draft', version: 1,
    category: 'graded_tcg', business_vertical: 'trading_cards', display_name: 'Charizard',
    quantity: 1, tracking_mode: 'serialized', serialized_child_count: 1, source_state: 'unknown',
    location_code: null, next_action: null, applied_rule_version: null, committed_at: null,
    created_at: '2026-07-26T00:00:00Z', updated_at: '2026-07-26T00:00:00Z', ...over,
  };
}

function snapshot(over: Partial<IntakeGroupSnapshot['group']> = {}, extra: Partial<IntakeGroupSnapshot> = {}): IntakeGroupSnapshot {
  return {
    group: {
      id: 'g-9', public_id: 'RV-IG-9', session_id: 'sess-9', state: 'draft', version: 7,
      category: 'graded_tcg', business_vertical: 'trading_cards', display_name: 'Blastoise',
      product_attrs: { featured_subject: 'Blastoise', set_name: 'Base Set', card_number: '2' },
      sku_attrs: { grading_company: 'PSA', numeric_grade: '10', grade_designation: 'GEM MINT', product_format: 'Graded slab' },
      quantity: 1, tracking_mode: 'serialized', serialized_child_count: 1, source_state: 'stated',
      source_evidence: { source_kind: 'retail_purchase' }, condition_state: null, location_code: 'BIN-2',
      owner_tagged: false, unique_condition: false, requires_item_media: false, security_sensitive: false,
      applied_rule_version: null, next_action: null, committed_product_id: null, committed_sku_id: null,
      committed_lot_id: null, committed_at: null, created_at: '2026-07-26T00:00:00Z', updated_at: '2026-07-26T00:00:00Z',
      ...over,
    },
    entries: [{
      id: 'e-9', public_id: 'RV-IE-9', entry_index: 1, grading_company: 'PSA', numeric_grade: '10',
      grade_designation: 'GEM MINT', certificate_number: 'PSA-88002', serial_number: null, entry_attrs: {}, committed_item_id: null,
    }],
    candidates: [], evaluation: { ready: true, blockers: [], rule_version: 'INTAKE_RULES_1' }, receipt: null, editable: true,
    ...extra,
  };
}

// snapshotToValues projects EXACT server values, never inferring from display strings.
it('17. snapshotToValues hydrates exact server values (entry + governed attrs)', () => {
  const v = snapshotToValues(snapshot());
  expect(v).toEqual({
    certificate_number: 'PSA-88002', grading_company: 'PSA', numeric_grade: '10',
    grade_designation: 'GEM MINT', card_name: 'Blastoise', set_name: 'Base Set',
    card_number: '2', source_kind: 'retail_purchase', location_code: 'BIN-2',
  });
});

// Resume selection order: ready_to_commit > draft > committed > abandoned > none.
it('18. selectResumeGroup follows the deterministic priority order', () => {
  const draftOld = summary({ id: 'd1', state: 'draft', updated_at: '2026-07-01T00:00:00Z' });
  const draftNew = summary({ id: 'd2', state: 'draft', updated_at: '2026-07-20T00:00:00Z' });
  const ready = summary({ id: 'r1', state: 'ready_to_commit', updated_at: '2026-07-10T00:00:00Z' });
  const committed = summary({ id: 'c1', state: 'committed', updated_at: '2026-07-25T00:00:00Z' });
  const abandoned = summary({ id: 'a1', state: 'abandoned', updated_at: '2026-07-26T00:00:00Z' });
  // ready_to_commit wins even when a draft/committed/abandoned is newer.
  expect(selectResumeGroup([draftNew, ready, committed, abandoned])?.id).toBe('r1');
  // most-recent draft when no ready group.
  expect(selectResumeGroup([draftOld, draftNew, committed])?.id).toBe('d2');
  // committed (read-only) when only terminal groups, preferring committed.
  expect(selectResumeGroup([committed, abandoned])?.id).toBe('c1');
  // abandoned only when nothing else.
  expect(selectResumeGroup([abandoned])?.id).toBe('a1');
  // nothing → null (caller starts a fresh draft in the resumed session).
  expect(selectResumeGroup([])).toBeNull();
});

// HYDRATE adopts server truth; committed/abandoned resume read-only.
it('19. HYDRATE adopts the snapshot; terminal groups resume read-only', () => {
  let s = quickAddReducer(initialQuickAddState(null), { type: 'HYDRATE', snapshot: snapshot() });
  expect(s.phase).toBe('editing');
  expect(s.sessionId).toBe('sess-9');
  expect(s.groupId).toBe('g-9');
  expect(s.version).toBe(7);
  expect(s.values.certificate_number).toBe('PSA-88002');
  // committed hydrates read-only with the receipt.
  const committed = quickAddReducer(initialQuickAddState(null), {
    type: 'HYDRATE', snapshot: snapshot({ state: 'committed' }, { editable: false, evaluation: null, receipt: RECEIPT }),
  });
  expect(committed.phase).toBe('committed');
  expect(isReadOnly(committed)).toBe(true);
  // abandoned hydrates read-only.
  s = quickAddReducer(initialQuickAddState(null), {
    type: 'HYDRATE', snapshot: snapshot({ state: 'abandoned' }, { editable: false, evaluation: null }),
  });
  expect(s.phase).toBe('abandoned');
  expect(isReadOnly(s)).toBe(true);
});

// Stale reload replaces ALL local values + version wholesale, with a discard warning.
it('20. REPLACED_FROM_SERVER replaces local values + version and warns of discard', () => {
  let s: QuickAddState = {
    ...initialQuickAddState('sess-9'), phase: 'stale', values: filled({ numeric_grade: '1' }),
    version: 2, conflict: { expected: 2, actual: 7 }, groupId: 'g-9',
  };
  s = quickAddReducer(s, { type: 'REPLACED_FROM_SERVER', snapshot: snapshot(), hadLocalEdits: true });
  expect(s.values.numeric_grade).toBe('10'); // server value, not the stale local '1'
  expect(s.version).toBe(7); // server version replaces stale 2
  expect(s.conflict).toBeNull(); // stale conflict cleared
  expect(s.sessionId).toBe('sess-9'); // session identity preserved
  expect(s.warning).toMatch(/discarded|replaced/i);
});

// Duplicate reference surfaces ONLY when the server resolved a real item.
it('21. duplicate exposes Review existing item only with a real server reference', () => {
  const base: QuickAddState = { ...initialQuickAddState('sess-1'), phase: 'ready', values: filled(), groupId: 'g-1', version: 3, contentHash: 'h' };
  // Without a reference: only Edit certificate (primary).
  const noRef: IntakeCommitFailed = { outcome: 'failed', failure_class: 'duplicate_identity', sqlstate: '23505', message: 'dup', group_id: 'g-1' };
  const sNo = quickAddReducer(base, { type: 'COMMIT_RESULT', result: noRef });
  expect(sNo.existingItem).toBeNull();
  expect(visibleActions(sNo).map((a) => a.id)).toEqual(['edit-cert']);
  // With a reference: Review existing item (primary) + Edit certificate.
  const withRef: IntakeCommitFailed = { ...noRef, existing_item: { item_public_id: 'RV-ITEM-5', lot_public_id: 'RV-I-0000000005', scan_sku: 'RV-ABC1234' } };
  const sYes = quickAddReducer(base, { type: 'COMMIT_RESULT', result: withRef });
  expect(sYes.existingItem?.item_public_id).toBe('RV-ITEM-5');
  const ids = visibleActions(sYes).map((a) => a.id);
  expect(ids).toEqual(['review-item', 'edit-cert']);
  expect(visibleActions(sYes)[0].primary).toBe(true);
  // Phase 6A has no item-detail route: never fabricate a link.
  expect(existingItemRoute(withRef.existing_item!)).toBeNull();
  expect(EXISTING_ITEM_SEARCH_HINT).toMatch(/Inventory search/i);
});

// firstIncompleteRequiredField + nextField drive resume focus and scanner advance.
it('22. focus helpers: first incomplete required field and next-in-order advance', () => {
  // all required present → null (optional grade_designation/location ignored).
  expect(firstIncompleteRequiredField(filled())).toBeNull();
  // a missing required field is returned in visible order.
  expect(firstIncompleteRequiredField(filled({ numeric_grade: '' }))).toBe('numeric_grade');
  // scanner Enter advances certificate → grading company → numeric grade, in order.
  expect(nextField('certificate_number')).toBe('grading_company');
  expect(nextField('grading_company')).toBe('numeric_grade');
  // last field has no next.
  expect(nextField('location_code')).toBeNull();
});
