// Phase 6A Quick Add — the smallest complete operator UI for adding ONE known
// graded slab through the accepted intake kernel.
//
// SHADOW / NON-AUTHORITATIVE. Legacy SQLite remains the authoritative deployed
// inventory; every Product/SKU/Lot/Item created here is shadow-only. The SERVER
// is authoritative for all rules, blockers, transitions, concurrency, identity
// coherence, source derivation, serialization, location resolution, duplicate
// detection, idempotency, receipts, and next-action. This page renders what the
// server returns via the typed intake transport and holds no rule engine.
//
// Approved handoff: Figma XAp7JmzNebQADoCxmPGiv2, frame 2:4, implementation
// contract 4:223, approved by Kyle Miller on 2026-07-26. Desktop frames
// D1 3:2 / D2 3:67 / D3 3:135 / D4 3:203 / D5 3:271; iPad frames I1 4:2 /
// I2 4:55 / I3 4:111 / I4 4:167.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackagePlus, AlertTriangle, ShieldAlert, CheckCircle2, RotateCcw } from 'lucide-react';
import { getProvenanceUiConfig, STAGING_NOTICE } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import { createIntakeTransport, isConflict, type IntakeTransport } from '../lib/intakeApi';
import {
  CONTAINER_CLASS,
  EXISTING_ITEM_SEARCH_HINT,
  GRADED_FIELDS,
  GRADING_COMPANY_OPTIONS,
  INITIAL_FOCUS_FIELD,
  PANEL_CLASS,
  SHADOW_LABEL,
  SOURCE_KIND_OPTIONS,
  blockerFieldKey,
  buildEntryPayload,
  buildGroupPayload,
  commitEnabled,
  existingItemRoute,
  firstBlockerField,
  firstIncompleteRequiredField,
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
  type FieldKey,
} from '../lib/quickAdd';

type FieldEl = HTMLInputElement | HTMLSelectElement;

function genKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `qa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// The transport is injectable ONLY for rendered tests; production always builds
// it from the gated shadow config below. Injecting it changes nothing about the
// server's authority — it is still the single source of rules and outcomes.
export interface QuickAddProps {
  readonly transport?: IntakeTransport;
}

export default function QuickAdd({ transport: injectedTransport }: QuickAddProps = {}) {
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    [],
  );
  const builtTransport: IntakeTransport | null = useMemo(() => {
    if (!config) return null;
    const client = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createIntakeTransport(async () => {
      const session = await (
        client as unknown as {
          auth: { getSession(): Promise<{ data: { session: { access_token?: string } | null } }> };
        }
      )?.auth.getSession();
      return session?.data?.session?.access_token ?? null;
    });
  }, [config]);
  const transport = injectedTransport ?? builtTransport;

  const [workspaceId, setWorkspaceId] = useState('');
  const [resumeSessionId, setResumeSessionId] = useState('');
  const [state, dispatch] = useReducer(quickAddReducer, initialQuickAddState());
  const [busy, setBusy] = useState(false);
  const [showItem, setShowItem] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const fieldRefs = useRef<Map<FieldKey, FieldEl>>(new Map());
  const blockerSummaryRef = useRef<HTMLDivElement>(null);
  const reviewHintRef = useRef<HTMLParagraphElement>(null);
  const navigate = useNavigate();

  const setRef = useCallback((key: FieldKey) => (el: FieldEl | null) => {
    if (el) fieldRefs.current.set(key, el);
    else fieldRefs.current.delete(key);
  }, []);
  const focusField = useCallback((key: FieldKey | null) => {
    if (key) fieldRefs.current.get(key)?.focus();
  }, []);

  // Certificate number receives initial focus once a session is open.
  useEffect(() => {
    if (state.sessionId && state.phase === 'new') focusField(INITIAL_FOCUS_FIELD);
  }, [state.sessionId, state.phase, focusField]);

  // Responsive layout is driven by the measured viewport width against the
  // approved breakpoint (side-by-side >= 1200; stacked below). The container
  // clips horizontal overflow so long ids wrap instead of scrolling the body.
  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 1280),
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const layout = layoutForWidth(viewportWidth);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      dispatch({ type: 'ERROR', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, []);

  const startSession = () =>
    run(async () => {
      if (!transport) return;
      const s = await transport.createSession(workspaceId, 'Quick Add');
      dispatch({ type: 'SESSION_STARTED', sessionId: s.id });
    });

  // Resume an existing session: adopt the server's truth, never invent state.
  // Deterministic group selection lives in selectResumeGroup; focus lands on the
  // first incomplete required field of an editable draft.
  const resumeSession = () =>
    run(async () => {
      if (!transport) return;
      const session = await transport.resumeSession(workspaceId, resumeSessionId.trim());
      // An abandoned session is terminal and read-only — no group is created.
      if (session.state === 'abandoned') {
        dispatch({ type: 'SESSION_STARTED', sessionId: session.id });
        dispatch({ type: 'ABANDONED' });
        return;
      }
      const groups = await transport.listGroups(workspaceId, session.id);
      const target = selectResumeGroup(groups);
      if (!target) {
        // Open session with no groups: begin a fresh draft in the resumed session
        // (resuming never mints a group by itself).
        dispatch({ type: 'SESSION_STARTED', sessionId: session.id });
        setTimeout(() => focusField(INITIAL_FOCUS_FIELD), 0);
        return;
      }
      const snapshot = await transport.getGroupSnapshot(workspaceId, target.id);
      dispatch({ type: 'HYDRATE', snapshot });
      if (snapshot.editable) {
        const focus = firstIncompleteRequiredField(snapshotToValues(snapshot))
          ?? firstBlockerField(snapshot.evaluation?.blockers ?? [])
          ?? INITIAL_FOCUS_FIELD;
        setTimeout(() => focusField(focus), 0);
      }
    });

  // Create-or-update the server group + entry, tracking the version. Returns the
  // synced group id + version, or null when a stale conflict interrupted it.
  const syncDraft = useCallback(async (): Promise<{ groupId: string; version: number } | null> => {
    if (!transport || !state.sessionId) return null;
    const payload = buildGroupPayload(state.values);
    if (!payload.displayName) {
      dispatch({ type: 'ERROR', message: 'Enter a card name or featured subject to begin.' });
      focusField('card_name');
      return null;
    }
    let groupId = state.groupId;
    let version = state.version ?? 0;
    if (!groupId) {
      const g = await transport.createGradedGroup(workspaceId, state.sessionId, payload);
      groupId = g.id;
      version = g.version;
      dispatch({ type: 'GROUP_SYNCED', groupId, version });
    } else {
      const g = await transport.updateGroup(workspaceId, groupId, version, state.sessionId, payload);
      if (isConflict(g)) {
        dispatch({ type: 'COMMIT_RESULT', result: g });
        return null;
      }
      version = g.version;
      dispatch({ type: 'GROUP_SYNCED', groupId, version });
    }
    const e = await transport.upsertEntry(workspaceId, groupId, version, buildEntryPayload(state.values));
    if (isConflict(e)) {
      dispatch({ type: 'COMMIT_RESULT', result: e });
      return null;
    }
    version = e.version;
    dispatch({ type: 'GROUP_SYNCED', groupId, version });
    return { groupId, version };
  }, [transport, state.sessionId, state.groupId, state.version, state.values, workspaceId, focusField]);

  const checkReadiness = () =>
    run(async () => {
      if (!transport) return;
      const synced = await syncDraft();
      if (!synced) return;
      const evaluation = await transport.evaluateRules(workspaceId, synced.groupId);
      dispatch({
        type: 'READINESS',
        ready: evaluation.ready,
        blockers: evaluation.blockers,
        ruleVersion: evaluation.rule_version,
      });
      if (!evaluation.ready) focusField(firstBlockerField(evaluation.blockers));
    });

  const doCommit = useCallback(
    (freshHash?: string, freshVersion?: number) =>
      run(async () => {
        if (!transport || !state.groupId) return;
        const key = state.idempotencyKey ?? genKey();
        const hash = freshHash ?? state.contentHash;
        const version = freshVersion ?? state.version;
        if (hash == null || version == null) return;
        dispatch({ type: 'COMMIT_STARTED', idempotencyKey: key, contentHash: hash, version });
        try {
          const result = await transport.commit(workspaceId, state.groupId, key, version, hash);
          dispatch({ type: 'COMMIT_RESULT', result });
        } catch {
          // Unknown network outcome: keep the key + hash so the retry is idempotent.
          dispatch({ type: 'COMMIT_NETWORK_UNKNOWN' });
        }
      }),
    [run, transport, state.groupId, state.idempotencyKey, state.contentHash, state.version, workspaceId],
  );

  const commitSlab = () =>
    run(async () => {
      if (!transport) return;
      const synced = await syncDraft();
      if (!synced) return;
      const preview = await transport.preview(workspaceId, synced.groupId);
      if (!preview.ready) {
        dispatch({ type: 'READINESS', ready: false, blockers: preview.blockers, ruleVersion: preview.rule_version });
        focusField(firstBlockerField(preview.blockers));
        return;
      }
      await doCommit(preview.content_hash, synced.version);
    });

  // Deliberate, confirmed stale reload: fetch the complete latest snapshot and
  // replace ALL local values + version + blockers + state + receipt in one
  // transition (never a field-by-field merge). Session/workspace identity is
  // preserved; unsaved local edits are discarded with a clear warning.
  const performReload = () =>
    run(async () => {
      if (!transport || !state.groupId) return;
      const snapshot = await transport.getGroupSnapshot(workspaceId, state.groupId);
      dispatch({ type: 'REPLACED_FROM_SERVER', snapshot, hadLocalEdits: true });
      setConfirmReload(false);
      if (snapshot.editable) {
        const focus = firstIncompleteRequiredField(snapshotToValues(snapshot))
          ?? firstBlockerField(snapshot.evaluation?.blockers ?? [])
          ?? INITIAL_FOCUS_FIELD;
        setTimeout(() => focusField(focus), 0);
      }
    });

  const abandonDraft = () =>
    run(async () => {
      if (!transport || !state.groupId) {
        dispatch({ type: 'ABANDONED' });
        return;
      }
      await transport.abandonGroup(workspaceId, state.groupId, 'operator abandoned');
      dispatch({ type: 'ABANDONED' });
    });

  // "Review existing item" navigates ONLY when a valid route target exists; in
  // Phase 6A none does, so it surfaces the Inventory-search guidance instead of
  // fabricating a link. The sanitized identifiers are always shown in the panel.
  const reviewExistingItem = () => {
    if (!state.existingItem) return;
    const route = existingItemRoute(state.existingItem);
    if (route) navigate(route);
    else reviewHintRef.current?.focus();
  };

  const onAction = (id: string) => {
    switch (id) {
      case 'check': return checkReadiness();
      case 'commit': return commitSlab();
      case 'abandon': return abandonDraft();
      case 'edit-cert': { dispatch({ type: 'FIELD_CHANGED', field: 'certificate_number', value: state.values.certificate_number }); focusField('certificate_number'); return; }
      case 'review-item': return reviewExistingItem();
      case 'reload': { setConfirmReload(true); return; }
      case 'retry': return doCommit();
      case 'another': { dispatch({ type: 'RESET_FOR_ANOTHER' }); setShowItem(false); setTimeout(() => focusField(INITIAL_FOCUS_FIELD), 0); return; }
      case 'view': { setShowItem(true); return; }
      case 'return-sessions': { dispatch({ type: 'RETURN_TO_SESSIONS' }); setShowItem(false); setConfirmReload(false); setResumeSessionId(''); return; }
      default: return undefined;
    }
  };

  const onFormKeyDown = (evt: React.KeyboardEvent) => {
    const intent = resolveKeyboardIntent(
      { key: evt.key, ctrlKey: evt.ctrlKey, metaKey: evt.metaKey, shiftKey: evt.shiftKey },
      { ready: commitEnabled(state) },
    );
    if (intent === 'commit') { evt.preventDefault(); commitSlab(); }
    else if (intent === 'focus_blockers') { evt.preventDefault(); blockerSummaryRef.current?.focus(); }
    else if (intent === 'advance') {
      // Scanner/Enter advances focus through the visible field order for shape
      // convenience only — it NEVER calls server readiness per field.
      const el = evt.target as HTMLElement;
      const cur = el.getAttribute('data-field') as FieldKey | null;
      if (cur) {
        evt.preventDefault();
        const nf = nextField(cur);
        if (nf) focusField(nf);
      }
    }
    else if (intent === 'close') { setShowItem(false); }
  };

  if (!transport) {
    return (
      <div className="p-6 text-sm text-ink-muted">
        Quick Add is not enabled in this build. The intake surface is dark by default.
      </div>
    );
  }

  const actions = visibleActions(state);
  const readOnly = isReadOnly(state);

  return (
    <div className="p-6">
      <div className={CONTAINER_CLASS}>
        <header className="mb-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <PackagePlus className="h-5 w-5 text-accent" /> Quick Add — Graded slab
          </h1>
          <p className="mt-1 text-xs font-semibold text-amber-600">{SHADOW_LABEL}</p>
          <p className="mt-1 text-xs text-ink-muted">{STAGING_NOTICE}</p>
        </header>

        {/* Accessible status announcements. */}
        <div aria-live="polite" role="status" className="sr-only">{liveRegionMessage(state)}</div>

        {!state.sessionId ? (
          <div className="max-w-md space-y-3 rounded-lg border border-hairline bg-surface-1 p-4">
            <label className="block text-sm">
              <span className="text-ink-muted">Workspace id</span>
              <input
                className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 font-mono text-sm"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                aria-label="Workspace id"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startSession}
                disabled={busy || workspaceId.trim() === ''}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Start new session
              </button>
            </div>
            <div className="border-t border-hairline pt-3">
              <label className="block text-sm">
                <span className="text-ink-muted">Existing session id</span>
                <input
                  className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 font-mono text-sm"
                  value={resumeSessionId}
                  onChange={(e) => setResumeSessionId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  aria-label="Existing session id"
                />
              </label>
              <button
                type="button"
                onClick={resumeSession}
                disabled={busy || workspaceId.trim() === '' || resumeSessionId.trim() === ''}
                className="mt-2 rounded-lg border border-hairline px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                Resume existing session
              </button>
            </div>
          </div>
        ) : (
          <div
            data-testid="quick-add-grid"
            data-layout={layout}
            className={`grid gap-4 ${layout === 'side-by-side' ? 'grid-cols-2' : 'grid-cols-1'}`}
          >
            {/* --- Form (D1/I1) --- */}
            <section className={`rounded-lg border border-hairline bg-surface-1 p-4 ${PANEL_CLASS}`} onKeyDown={onFormKeyDown}>
              <h2 className="mb-3 text-sm font-semibold">Slab facts</h2>
              <div className="space-y-3">
                {GRADED_FIELDS.map((f) => (
                  <label key={f.key} className="block text-sm">
                    <span className="text-ink-muted">
                      {f.label}{f.optional ? ' (optional)' : ''}
                    </span>
                    {f.key === 'grading_company' ? (
                      <select
                        ref={setRef(f.key)} disabled={readOnly} data-field={f.key}
                        className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 text-sm"
                        value={state.values[f.key]}
                        onChange={(e) => dispatch({ type: 'FIELD_CHANGED', field: f.key, value: e.target.value })}
                        aria-label={f.label}
                      >
                        <option value="">—</option>
                        {GRADING_COMPANY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : f.key === 'source_kind' ? (
                      <select
                        ref={setRef(f.key)} disabled={readOnly} data-field={f.key}
                        className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 text-sm"
                        value={state.values[f.key]}
                        onChange={(e) => dispatch({ type: 'FIELD_CHANGED', field: f.key, value: e.target.value })}
                        aria-label={f.label}
                      >
                        <option value="">—</option>
                        {SOURCE_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input
                        ref={setRef(f.key)} disabled={readOnly} data-field={f.key}
                        className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 font-mono text-sm"
                        value={state.values[f.key]}
                        onChange={(e) => dispatch({ type: 'FIELD_CHANGED', field: f.key, value: e.target.value })}
                        aria-label={f.label}
                        autoComplete="off"
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>

            {/* --- Readiness / receipt panel (D2–D4 / I2–I4) --- */}
            <section className={`rounded-lg border border-hairline bg-surface-1 p-4 ${PANEL_CLASS}`}>
              <h2 className="mb-3 text-sm font-semibold">Readiness</h2>

              {state.error && (
                <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {state.error}
                </div>
              )}

              {state.warning && (
                <div role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {state.warning}
                </div>
              )}

              {state.phase === 'editing' && state.blockers.length > 0 && (
                <div ref={blockerSummaryRef} tabIndex={-1} className="mb-3 rounded border border-red-300 bg-red-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                    <AlertTriangle className="h-4 w-4" /> {state.blockers.length} issue(s) to resolve
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {state.blockers.map((b, i) => (
                      <li key={`${b.field}-${i}`}>
                        <button
                          type="button"
                          className="text-left text-red-700 underline underline-offset-2"
                          onClick={() => focusField(blockerFieldKey(b))}
                        >
                          {b.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {state.phase === 'ready' && (
                <div className="mb-3 rounded border border-hairline bg-surface-0 p-3 text-sm">
                  <p className="font-medium">Ready to commit.</p>
                  <p className="mt-1 text-ink-muted">
                    Permanent IDs have <strong>not</strong> been minted yet. Committing creates one
                    shadow Product, SKU, Lot, and serialized Item.
                  </p>
                </div>
              )}

              {state.phase === 'duplicate' && (
                <div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                  <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4" /> Duplicate certificate</div>
                  <p className="mt-1">{state.failure?.message ?? 'This certificate already exists.'} Your draft was preserved and nothing was created. Edit the certificate number to continue.</p>
                  {state.existingItem && (
                    <div className="mt-2 rounded border border-red-200 bg-white/60 p-2">
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                        <dt className="text-ink-muted">Existing item</dt>
                        <dd className="font-mono break-all">{state.existingItem.item_public_id}</dd>
                        {state.existingItem.lot_public_id && (<><dt className="text-ink-muted">Existing lot</dt><dd className="font-mono break-all">{state.existingItem.lot_public_id}</dd></>)}
                        {state.existingItem.scan_sku && (<><dt className="text-ink-muted">Scan SKU</dt><dd className="font-mono break-all">{state.existingItem.scan_sku}</dd></>)}
                      </dl>
                      <p ref={reviewHintRef} tabIndex={-1} className="mt-2 text-xs text-red-700">
                        {EXISTING_ITEM_SEARCH_HINT}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {state.phase === 'stale' && (
                <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <div className="flex items-center gap-2 font-semibold"><RotateCcw className="h-4 w-4" /> Draft changed elsewhere</div>
                  <p className="mt-1">
                    Expected version {state.conflict?.expected ?? '—'}, current version {state.conflict?.actual ?? '—'}.
                    Reloading loads the latest saved version from the server.
                  </p>
                  {confirmReload && (
                    <div role="alertdialog" aria-label="Confirm reload" className="mt-2 rounded border border-amber-400 bg-white/70 p-2">
                      <p className="text-xs font-semibold">
                        Reloading will discard your unsaved local edits and replace them with the latest saved version. This cannot be undone.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={performReload}
                          disabled={busy}
                          className="rounded bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Reload and discard local edits
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmReload(false)}
                          disabled={busy}
                          className="rounded border border-hairline px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {state.phase === 'network_unknown' && (
                <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <div className="flex items-center gap-2 font-semibold"><RotateCcw className="h-4 w-4" /> Commit result unknown</div>
                  <p className="mt-1">Retry with the same values. A commit that already succeeded will replay its receipt — no duplicate inventory.</p>
                </div>
              )}

              {state.phase === 'committed' && state.receipt && <ReceiptPanel receipt={state.receipt} />}

              {state.phase === 'abandoned' && (
                <div className="mb-3 rounded border border-hairline bg-surface-0 p-3 text-sm text-ink-muted">
                  {state.groupId
                    ? 'This draft is abandoned and read only.'
                    : 'This session is abandoned and read only.'}
                </div>
              )}

              {/* Actions: exactly one primary, at most two total. */}
              <div className="mt-2 flex flex-wrap gap-2">
                {actions.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onAction(a.id)}
                    disabled={busy || !a.enabled}
                    title={a.enabled ? undefined : a.disabledReason}
                    className={
                      a.primary
                        ? 'rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50'
                        : 'rounded-lg border border-hairline px-3 py-2 text-sm font-medium disabled:opacity-50'
                    }
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* --- Minimal Item Detail (D5) --- */}
        {showItem && state.receipt && (
          <ItemDetailPanel view={itemDetailView(state.receipt, state.values)} onClose={() => setShowItem(false)} />
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="contents">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-mono break-all">{value ?? '—'}</dd>
    </div>
  );
}

function ReceiptPanel({ receipt }: { receipt: import('../lib/intakeApi').IntakeCommitReceipt }) {
  const v = receiptView(receipt);
  return (
    <div className="mb-3 rounded border border-emerald-300 bg-emerald-50 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> Committed — {v.idempotencyStatus}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <Row label="Product" value={v.productPublicId} />
        <Row label="SKU" value={v.skuPublicId} />
        <Row label="Lot" value={v.lotPublicId} />
        <Row label="Item" value={v.itemPublicId} />
        <Row label="Scan SKU" value={v.scanSku} />
        <Row label="Rule version" value={v.ruleVersion} />
        <Row label="Source" value={`${v.sourceState}${v.sourceKind ? ` (${v.sourceKind})` : ''}`} />
        <Row label="Next action" value={v.nextAction} />
        <Row label="Financial effect" value={v.financialEffect} />
      </dl>
      <p className="mt-2 text-xs text-ink-muted">{v.financialNote}</p>
    </div>
  );
}

function ItemDetailPanel({ view, onClose }: { view: import('../lib/quickAdd').ItemDetailView; onClose: () => void }) {
  return (
    <div className={`mt-4 rounded-lg border border-hairline bg-surface-1 p-4 ${PANEL_CLASS}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Minimal Item Detail</h2>
        <button type="button" onClick={onClose} className="text-xs text-ink-muted underline">Close</button>
      </div>
      <p className="mb-2 text-xs font-semibold text-amber-600">{view.shadowLabel}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <Row label="Display name" value={view.displayName} />
        <Row label="Grader / grade" value={view.graderAndGrade} />
        <Row label="Certificate" value={view.certificateNumber} />
        <Row label="Product" value={view.productPublicId} />
        <Row label="SKU" value={view.skuPublicId} />
        <Row label="Lot" value={view.lotPublicId} />
        <Row label="Item" value={view.itemPublicId} />
        <Row label="Scan SKU" value={view.scanSku} />
        <Row label="Source" value={`${view.sourceState}${view.sourceKind ? ` (${view.sourceKind})` : ''}`} />
        <Row label="Location" value={view.location} />
        <Row label="Intake session" value={view.intakeSession} />
        <Row label="Rule version" value={view.ruleVersion} />
        <Row label="Receipt status" value={view.receiptStatus} />
        <Row label="Next action" value={view.nextAction} />
      </dl>
    </div>
  );
}
