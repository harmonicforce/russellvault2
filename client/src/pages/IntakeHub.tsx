// Intake Hub — one place to add any category of inventory.
//
// The proven commit sequence is unchanged: create/update the draft group,
// upsert its entries, ask the server to preview, then commit with an
// idempotency key and content hash. The server remains authoritative for
// readiness, blockers, identity, duplicate detection and serialization. What
// is new is that the hub can drive that sequence for every category, not just
// a graded slab.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  PackagePlus, AlertTriangle, CheckCircle2, ShieldAlert, ArrowLeft, Plus, Camera, Printer,
} from 'lucide-react';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient, createShadowSupabaseClient } from '../lib/supabaseShadow';
import {
  createIntakeTransport, isConflict,
  type IntakeCommitReceipt, type IntakeSessionListItem, type IntakeTransport,
} from '../lib/intakeApi';
import { createLocationsTransport, type LocationsTransport, type StorageLocation } from '../lib/locationsApi';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { useWorkspace } from '../lib/workspaceContext';
import { LocationCreateForm } from '../components/LocationCreateForm';
import {
  CATEGORIES, MAX_SINGLE_ITEM_UNITS, buildEntryPayload, buildGroupPayload, categoryByKey,
  emptyValues, localBlockers, parseQuantity, resolveTracking, unitNoteKey, unitSerialKey,
  usesPerUnitIdentifiers,
  type CategoryDef, type CategoryValues, type IntakeCategoryKey,
} from '../lib/intakeCategories';
import {
  deserializeSingleDraft, draftAfterRestore, isBlankDraft, reconcileRestoredDraft,
  serializeSingleDraft, singleDraftStorageKey, type SingleDraft,
} from '../lib/singleIntakeDraft';
import type { IntakePrefill } from '../lib/intakePrefill';

type Phase = 'choose' | 'form' | 'committed';

function genKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ih-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function locationLabel(l: StorageLocation): string {
  return l.display_name ? `${l.display_name} (${l.location_code})` : l.location_code;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export interface IntakeHubProps {
  readonly workspaceId?: string | null;
  readonly transport?: IntakeTransport;
  readonly locationsTransport?: LocationsTransport;
}

export default function IntakeHub({
  workspaceId: injectedWorkspaceId,
  transport: injectedTransport,
  locationsTransport: injectedLocationsTransport,
}: IntakeHubProps = {}) {
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    [],
  );
  const contextWorkspace = useWorkspaceIfConfigured();
  const workspaceId =
    injectedWorkspaceId !== undefined ? injectedWorkspaceId : contextWorkspace?.workspace?.id ?? null;
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const resumeSessionIdFromNav =
    (routerLocation.state as { resumeSessionId?: string } | null)?.resumeSessionId ?? null;
  // "Add another like this" arrives with a prefill built by intakePrefill,
  // which is where the never-copy-an-identifier rule is enforced and tested.
  const prefillFromNav =
    (routerLocation.state as { prefill?: IntakePrefill } | null)?.prefill ?? null;

  const transport = useMemo(() => {
    if (injectedTransport) return injectedTransport;
    if (!config) return null;
    const client = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createIntakeTransport(tokenProviderFromClient(client));
  }, [config, injectedTransport]);

  const locationsTransport = useMemo(() => {
    if (injectedLocationsTransport) return injectedLocationsTransport;
    if (!config) return null;
    const supabase = createShadowSupabaseClient(import.meta.env as unknown as Record<string, string | undefined>);
    if (!supabase) return null;
    return createLocationsTransport(supabase as never, () => workspaceId);
  }, [config, injectedLocationsTransport, workspaceId]);

  const [phase, setPhase] = useState<Phase>('choose');
  const [categoryKey, setCategoryKey] = useState<IntakeCategoryKey | null>(null);
  const [values, setValues] = useState<CategoryValues>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string>('');
  const [recentSessions, setRecentSessions] = useState<readonly IntakeSessionListItem[]>([]);
  const [locations, setLocations] = useState<readonly StorageLocation[]>([]);
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<{ field: string; message: string }[]>([]);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<IntakeCommitReceipt | null>(null);
  const [committedCategory, setCommittedCategory] = useState<CategoryDef | null>(null);
  const [savedAt, setSavedAt] = useState<string>('');
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);

  // Group identity for the draft currently being edited.
  const groupRef = useRef<{ id: string; version: number } | null>(null);
  const idempotencyRef = useRef<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);
  const restoredRef = useRef(false);

  const def = categoryKey ? categoryByKey(categoryKey) : null;

  useEffect(() => {
    if (!locationsTransport || !workspaceId) return;
    locationsTransport.list().then(setLocations).catch(() => setLocations([]));
  }, [locationsTransport, workspaceId]);

  const refreshLocations = useCallback(() => {
    locationsTransport?.list().then(setLocations).catch(() => undefined);
  }, [locationsTransport]);

  useEffect(() => {
    if (!transport || !workspaceId) return;
    transport
      .listSessions(workspaceId, 5, 0)
      .then((page) => setRecentSessions(page.sessions))
      .catch(() => setRecentSessions([]));
  }, [transport, workspaceId, phase]);

  // Arriving from Intake Sessions with a session to continue adopts it.
  useEffect(() => {
    if (resumeSessionIdFromNav && !sessionId) setSessionId(resumeSessionIdFromNav);
  }, [resumeSessionIdFromNav, sessionId]);

  // Restore an unfinished single-item draft and reconcile it with the server,
  // so a refresh mid-entry loses no typing and can never produce a second copy.
  useEffect(() => {
    if (!transport || !workspaceId || restoredRef.current) return;
    // Arriving with explicit instructions from another page — continue this
    // session, or start from this record — wins over whatever was saved here.
    if (resumeSessionIdFromNav || prefillFromNav) { restoredRef.current = true; return; }
    restoredRef.current = true;

    let saved: SingleDraft | null = null;
    try {
      saved = deserializeSingleDraft(
        window.localStorage.getItem(singleDraftStorageKey(workspaceId)), workspaceId
      );
    } catch {
      return; // a corrupt draft simply does not restore
    }
    if (!saved || isBlankDraft(saved.values)) return;

    void (async () => {
      let sessionState: 'open' | 'closed' | 'missing' | null = null;
      if (saved.sessionId) {
        try {
          const session = await transport.resumeSession(workspaceId, saved.sessionId);
          sessionState = session.state === 'open' ? 'open' : 'closed';
        } catch {
          sessionState = 'missing';
        }
      }

      let groupState: 'draft' | 'committed' | 'abandoned' | 'unreachable' | null = null;
      let committedSnapshot: IntakeCommitReceipt | null = null;
      if (saved.groupId) {
        try {
          const snapshot = await transport.getGroupSnapshot(workspaceId, saved.groupId);
          groupState = snapshot.group.state === 'committed'
            ? 'committed'
            : snapshot.group.state === 'abandoned' ? 'abandoned' : 'draft';
          committedSnapshot = snapshot.receipt;
          if (groupState === 'draft') {
            // Trust the server's version over the saved one.
            saved = { ...saved, groupVersion: snapshot.group.version };
          }
        } catch {
          groupState = 'unreachable';
        }
      }

      const state = reconcileRestoredDraft({ draft: saved, sessionState, groupState });
      const next = draftAfterRestore(saved, state);

      setCategoryKey(saved.categoryKey as IntakeCategoryKey);
      setValues(next.values);
      setSessionId(next.sessionId);
      setSessionLabel(saved.sessionLabel);
      groupRef.current = next.group;
      idempotencyRef.current = next.idempotencyKey;
      setSavedAt(saved.savedAt);

      if (state.kind === 'already_committed') {
        // The commit had landed. Show the receipt rather than inviting a retry
        // that would create a second record of the same thing.
        setReceipt(committedSnapshot);
        setCommittedCategory(categoryByKey(saved.categoryKey as IntakeCategoryKey));
        setPhase('committed');
        setRestoreNotice('This had already been added before the interruption. Here is its receipt.');
        return;
      }
      setPhase('form');
      setRestoreNotice(
        state.kind === 'stale'
          ? state.reason
          : 'Restored what you had entered. Nothing has been added yet.'
      );
    })();
  }, [transport, workspaceId, resumeSessionIdFromNav, prefillFromNav]);

  // Open the form on the record the operator asked to copy. The values come
  // from intakePrefill and are already stripped of everything that names one
  // specific object; the form starts with no server draft of its own.
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (!prefillFromNav || prefillAppliedRef.current) return;
    prefillAppliedRef.current = true;
    const nextDef = categoryByKey(prefillFromNav.categoryKey);
    setCategoryKey(prefillFromNav.categoryKey);
    setValues({ ...emptyValues(nextDef), ...prefillFromNav.values });
    groupRef.current = null;
    idempotencyRef.current = null;
    setPhase('form');
    setRestoreNotice(
      'Started from an existing record. Its certificate, serial and scan SKU are deliberately blank — ' +
      'enter the ones on the item in front of you.'
    );
  }, [prefillFromNav]);

  // Persist after every change, while the form is the thing on screen.
  useEffect(() => {
    if (!workspaceId || !categoryKey || phase !== 'form') return;
    if (isBlankDraft(values)) return;
    const stamp = new Date().toISOString();
    try {
      window.localStorage.setItem(
        singleDraftStorageKey(workspaceId),
        serializeSingleDraft({
          workspaceId,
          categoryKey,
          values,
          sessionId,
          sessionLabel,
          groupId: groupRef.current?.id ?? null,
          groupVersion: groupRef.current?.version ?? null,
          idempotencyKey: idempotencyRef.current,
          savedAt: stamp,
        })
      );
      setSavedAt(stamp);
    } catch {
      /* storage unavailable — entry still works, it just will not survive a refresh */
    }
  }, [workspaceId, categoryKey, values, sessionId, sessionLabel, phase]);

  /** A finished or abandoned draft must not be restored on the next visit. */
  const clearSavedDraft = useCallback(() => {
    if (!workspaceId) return;
    try { window.localStorage.removeItem(singleDraftStorageKey(workspaceId)); } catch { /* ignore */ }
    setSavedAt('');
  }, [workspaceId]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  /** Returns the open session to add into, starting one when needed. */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (!transport || !workspaceId) return null;
    if (sessionId) return sessionId;
    const label = sessionLabel.trim() || `Intake ${new Date().toLocaleDateString()}`;
    const s = await transport.createSession(workspaceId, label);
    setSessionId(s.id);
    return s.id;
  }, [transport, workspaceId, sessionId, sessionLabel]);

  const chooseCategory = (key: IntakeCategoryKey) => {
    const nextDef = categoryByKey(key);
    setCategoryKey(key);
    setValues(emptyValues(nextDef));
    groupRef.current = null;
    idempotencyRef.current = null;
    clearSavedDraft();
    setRestoreNotice(null);
    setBlockers([]);
    setDuplicate(null);
    setError(null);
    setPhase('form');
    setTimeout(() => firstFieldRef.current?.focus(), 0);
  };

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Any edit invalidates a prior preview and its idempotency key.
    idempotencyRef.current = null;
    setBlockers([]);
    setDuplicate(null);
  };

  /**
   * Create or update the draft group and its entries. A serialized group must
   * carry exactly `quantity` entries; a quantity-tracked lot carries a single
   * entry that holds the operator's notes and is never expanded into units.
   */
  const syncDraft = useCallback(async (): Promise<{ id: string; version: number } | null> => {
    if (!transport || !workspaceId || !def) return null;
    const session = await ensureSession();
    if (!session) return null;

    const payload = buildGroupPayload(def, values);
    let group = groupRef.current;
    if (!group) {
      const created = await transport.createCategoryGroup(workspaceId, session, payload);
      group = { id: created.id, version: created.version };
    } else {
      const updated = await transport.updateCategoryGroup(
        workspaceId, group.id, group.version, session, payload
      );
      if (isConflict(updated)) {
        setError('This draft changed elsewhere. Start it again to pick up the latest version.');
        return null;
      }
      group = { id: updated.id, version: updated.version };
    }

    const entryCount = payload.trackingMode === 'serialized' ? payload.quantity : 1;
    for (let index = 1; index <= entryCount; index += 1) {
      // Per-unit payload: a serialized group gives each unit its OWN
      // identifier rather than replicating one across all of them.
      const result = await transport.upsertCategoryEntry(
        workspaceId, group.id, group.version, index, buildEntryPayload(def, values, index)
      );
      if (isConflict(result)) {
        setError('This draft changed elsewhere. Start it again to pick up the latest version.');
        return null;
      }
      group = { id: group.id, version: result.version };
    }

    groupRef.current = group;
    return group;
  }, [transport, workspaceId, def, values, ensureSession]);

  const commit = () =>
    run(async () => {
      if (!transport || !workspaceId || !def) return;
      const local = localBlockers(def, values);
      if (local.length > 0) {
        setBlockers(local.map((message) => ({ field: '', message })));
        return;
      }
      const group = await syncDraft();
      if (!group) return;

      const preview = await transport.preview(workspaceId, group.id);
      if (!preview.ready) {
        setBlockers(preview.blockers.map((b) => ({ field: b.field, message: b.message })));
        return;
      }
      const key = idempotencyRef.current ?? genKey();
      idempotencyRef.current = key;
      const result = await transport.commit(
        workspaceId, group.id, key, group.version, preview.content_hash
      );
      if (result.outcome === 'committed') {
        setReceipt(result);
        setCommittedCategory(def);
        setBlockers([]);
        setDuplicate(null);
        groupRef.current = null;
        idempotencyRef.current = null;
        // It is inventory now, not a draft. Nothing left to restore.
        clearSavedDraft();
        setRestoreNotice(null);
        setPhase('committed');
        return;
      }
      if (result.outcome === 'blocked') {
        setBlockers(result.blockers.map((b) => ({ field: b.field, message: b.message })));
        return;
      }
      if (result.outcome === 'failed' && result.failure_class === 'duplicate_identity') {
        setDuplicate(
          `${result.message}${result.existing_item ? ` Existing item ${result.existing_item.item_public_id}.` : ''}`
        );
        return;
      }
      setError('message' in result ? result.message : 'That could not be committed.');
    });

  const addAnotherSame = () => {
    if (!committedCategory) return;
    setValues(emptyValues(committedCategory));
    setCategoryKey(committedCategory.key);
    setReceipt(null);
    groupRef.current = null;
    idempotencyRef.current = null;
    clearSavedDraft();
    setRestoreNotice(null);
    setPhase('form');
    setTimeout(() => firstFieldRef.current?.focus(), 0);
  };

  if (!transport) {
    return <div className="p-6 text-sm text-ink-muted">Adding inventory is not enabled in this build.</div>;
  }
  if (!workspaceId) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to add inventory.</div>;
  }

  const activeWorkspaceName = contextWorkspace?.workspace?.name ?? null;
  const chosenLocation = locations.find((l) => l.location_code === values.location_code) ?? null;
  const noLocations = locations.length === 0;

  return (
    <div className="p-6">
      <div className="mx-auto w-full max-w-5xl overflow-x-hidden">
        <header className="mb-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <PackagePlus className="h-5 w-5 text-accent" /> Add Inventory
          </h1>
          <p className="mt-1 text-xs text-ink-muted">
            {activeWorkspaceName ? `${activeWorkspaceName} · ` : ''}
            {sessionId ? 'Adding to an open session' : 'A session starts when you add your first item'}
            {chosenLocation ? ` · ${locationLabel(chosenLocation)}` : ''}
          </p>
        </header>

        {error && (
          <div className="mb-3 rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>
        )}

        {restoreNotice && (
          <div className="mb-3 flex items-start justify-between gap-3 rounded border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink-secondary">
            <span>
              {restoreNotice}
              {savedAt && phase === 'form' && (
                <span className="ml-1 text-ink-muted">
                  Saved {new Date(savedAt).toLocaleTimeString()}.
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setRestoreNotice(null)}
              className="shrink-0 text-xs text-ink-muted underline hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        )}

        {phase === 'choose' && (
          <ChooseCategory
            recentSessions={recentSessions}
            sessionId={sessionId}
            sessionLabel={sessionLabel}
            onSessionLabel={setSessionLabel}
            onChoose={chooseCategory}
            onContinueSession={(id) => setSessionId(id)}
            onViewSessions={() => navigate('/intake-sessions')}
            onBatch={() => navigate('/batch-intake')}
          />
        )}

        {phase === 'form' && def && (
          <>
            <button
              type="button"
              onClick={() => setPhase('choose')}
              className="mb-3 flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" /> Choose a different category
            </button>

            {noLocations && (
              <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Add a storage location before adding inventory, so every item has somewhere to live.
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
              <section className="rounded-lg border border-hairline bg-surface-1 p-4">
                <h2 className="mb-1 text-sm font-semibold">{def.label}</h2>
                <p className="mb-3 text-xs text-ink-muted">{def.blurb}</p>

                <div className="grid gap-3 sm:grid-cols-2">
                  {def.fields.map((field, index) => (
                    <label
                      key={field.key}
                      className={`block text-sm ${field.kind === 'textarea' ? 'sm:col-span-2' : ''}`}
                    >
                      <span className="text-ink-muted">
                        {field.label}
                        {field.optional ? ' (optional)' : ''}
                      </span>
                      {field.kind === 'select' ? (
                        <select
                          ref={index === 0 ? (el) => { firstFieldRef.current = el; } : undefined}
                          className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
                          value={values[field.key] ?? ''}
                          onChange={(e) => setValue(field.key, e.target.value)}
                          aria-label={field.label}
                        >
                          <option value="">—</option>
                          {(field.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : field.kind === 'textarea' ? (
                        <textarea
                          className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
                          rows={2}
                          value={values[field.key] ?? ''}
                          onChange={(e) => setValue(field.key, e.target.value)}
                          aria-label={field.label}
                        />
                      ) : (
                        <input
                          ref={index === 0 ? (el) => { firstFieldRef.current = el; } : undefined}
                          type={field.kind === 'number' ? 'text' : 'text'}
                          inputMode={field.kind === 'number' ? 'numeric' : undefined}
                          className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
                          value={values[field.key] ?? ''}
                          placeholder={field.placeholder}
                          onChange={(e) => setValue(field.key, e.target.value)}
                          aria-label={field.label}
                          autoComplete="off"
                        />
                      )}
                      {field.key === 'quantity'
                        && parseQuantity(values.quantity) === null && (
                        <span className="mt-1 block text-xs text-danger">
                          Enter a whole number of at least 1.
                        </span>
                      )}
                    </label>
                  ))}

                  {def.allowsTrackingChoice && (
                    <label className="block text-sm sm:col-span-2">
                      <span className="text-ink-muted">How should this be tracked?</span>
                      <select
                        className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
                        value={values.tracking_choice ?? 'quantity'}
                        onChange={(e) => setValue('tracking_choice', e.target.value)}
                        aria-label="Tracking choice"
                      >
                        <option value="quantity">Track by quantity (one record for all of them)</option>
                        <option value="individual">Track individually (one record per unit)</option>
                      </select>
                      <span className="mt-1 block text-xs text-ink-muted">
                        {resolveTracking(def, values) === 'serialized'
                          ? 'Each unit gets its own scan SKU and can be moved on its own.'
                          : 'One record carries the quantity. Choose individual tracking for unique or high-value pieces.'}
                      </span>
                    </label>
                  )}

                  {usesPerUnitIdentifiers(def, values) && (
                    <div className="sm:col-span-2 rounded border border-hairline bg-surface-0 p-3">
                      <h3 className="text-sm font-semibold">Each unit's identifier</h3>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        You're adding {parseQuantity(values.quantity) ?? 0} individually tracked units.
                        One serial number cannot describe several objects, so each unit gets its own
                        (or leave them blank). Every unit still receives its own scan SKU.
                      </p>
                      {(parseQuantity(values.quantity) ?? 0) > MAX_SINGLE_ITEM_UNITS ? (
                        <p className="mt-2 text-xs text-danger">
                          That's more units than this form handles. Use Batch Intake for {' '}
                          {parseQuantity(values.quantity)} units.
                        </p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {Array.from(
                            { length: Math.min(parseQuantity(values.quantity) ?? 1, MAX_SINGLE_ITEM_UNITS) },
                            (_, i) => i + 1
                          ).map((unit) => (
                            <div key={unit} className="grid gap-2 sm:grid-cols-[3rem_1fr_1fr] sm:items-center">
                              <span className="text-xs font-medium text-ink-muted">Unit {unit}</span>
                              <input
                                className="w-full rounded border border-hairline bg-surface-1 px-2 py-1.5 text-sm"
                                value={values[unitSerialKey(unit)] ?? ''}
                                onChange={(e) => setValue(unitSerialKey(unit), e.target.value)}
                                placeholder="Serial or identifier (optional)"
                                aria-label={`Unit ${unit} serial or identifier`}
                                autoComplete="off"
                              />
                              <input
                                className="w-full rounded border border-hairline bg-surface-1 px-2 py-1.5 text-sm"
                                value={values[unitNoteKey(unit)] ?? ''}
                                onChange={(e) => setValue(unitNoteKey(unit), e.target.value)}
                                placeholder="Note (optional)"
                                aria-label={`Unit ${unit} note`}
                                autoComplete="off"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <label className="block text-sm sm:col-span-2">
                    <span className="text-ink-muted">Storage location</span>
                    <select
                      className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
                      value={values.location_code ?? ''}
                      onChange={(e) => setValue('location_code', e.target.value)}
                      aria-label="Storage location"
                    >
                      <option value="">No location selected</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.location_code}>{locationLabel(l)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowCreateLocation((v) => !v)}
                      className="mt-1 flex items-center gap-1 text-xs text-accent-strong underline underline-offset-2"
                    >
                      <Plus className="h-3 w-3" /> Create a new location
                    </button>
                    {showCreateLocation && locationsTransport && (
                      <div className="mt-2 rounded border border-hairline bg-surface-0 p-2">
                        <LocationCreateForm
                          transport={locationsTransport}
                          parentOptions={locations}
                          onCreated={() => { refreshLocations(); setShowCreateLocation(false); }}
                          compact
                        />
                      </div>
                    )}
                  </label>
                </div>
              </section>

              <section className="rounded-lg border border-hairline bg-surface-1 p-4">
                <h2 className="mb-3 text-sm font-semibold">Ready to add?</h2>

                {duplicate && (
                  <div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                    <div className="flex items-center gap-2 font-semibold">
                      <ShieldAlert className="h-4 w-4" /> Already in inventory
                    </div>
                    <p className="mt-1">{duplicate} Your draft was kept and nothing was created.</p>
                  </div>
                )}

                {blockers.length > 0 && (
                  <div className="mb-3 rounded border border-red-300 bg-red-50 p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                      <AlertTriangle className="h-4 w-4" /> {blockers.length} to resolve
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-red-700">
                      {blockers.map((b, i) => <li key={`${b.field}-${i}`}>{b.message}</li>)}
                    </ul>
                  </div>
                )}

                <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-ink-muted">Tracking</dt>
                  <dd>{resolveTracking(def, values) === 'serialized' ? 'Individually tracked' : 'Tracked by quantity'}</dd>
                  <dt className="text-ink-muted">Quantity</dt>
                  <dd>{def.allowsQuantity ? (parseQuantity(values.quantity) ?? '—') : 1}</dd>
                  <dt className="text-ink-muted">Location</dt>
                  <dd>{chosenLocation ? locationLabel(chosenLocation) : 'Not set'}</dd>
                </dl>

                <button
                  type="button"
                  onClick={commit}
                  disabled={busy || noLocations}
                  className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Adding…' : `Add ${def.label.toLowerCase()}`}
                </button>
              </section>
            </div>
          </>
        )}

        {phase === 'committed' && receipt && committedCategory && (
          <CommittedReceipt
            receipt={receipt}
            category={committedCategory}
            locationName={chosenLocation ? locationLabel(chosenLocation) : null}
            onAddAnother={addAnotherSame}
            onSwitchCategory={() => setPhase('choose')}
            onOpenItem={(itemId) => navigate(`/inventory/current/${itemId}`)}
            onOpenLot={(lotId) => navigate(`/inventory/lots/${lotId}`)}
          />
        )}
      </div>
    </div>
  );
}

function useWorkspaceIfConfigured(): ReturnType<typeof useWorkspace> | null {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useWorkspace();
  } catch {
    return null;
  }
}

function ChooseCategory({
  recentSessions, sessionId, sessionLabel, onSessionLabel, onChoose, onContinueSession, onViewSessions,
  onBatch,
}: {
  recentSessions: readonly IntakeSessionListItem[];
  sessionId: string | null;
  sessionLabel: string;
  onSessionLabel: (v: string) => void;
  onChoose: (key: IntakeCategoryKey) => void;
  onContinueSession: (id: string) => void;
  onViewSessions: () => void;
  onBatch: () => void;
}) {
  const openSessions = recentSessions.filter((s) => s.state === 'open');
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-semibold">What are you adding?</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onChoose(c.key)}
              className="rounded-lg border border-hairline bg-surface-1 p-3 text-left hover:border-accent hover:bg-surface-2"
            >
              <div className="text-sm font-medium">{c.label}</div>
              <div className="mt-0.5 text-xs text-ink-muted">{c.blurb}</div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Adding a lot at once?</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onBatch}
            className="rounded-lg border border-hairline bg-surface-1 p-3 text-left hover:border-accent hover:bg-surface-2"
          >
            <div className="text-sm font-medium">Batch Intake</div>
            <div className="mt-0.5 text-xs text-ink-muted">
              A spreadsheet-style grid for many items of one category.
            </div>
          </button>
          <button
            type="button"
            onClick={onViewSessions}
            className="rounded-lg border border-hairline bg-surface-1 p-3 text-left hover:border-accent hover:bg-surface-2"
          >
            <div className="text-sm font-medium">Resume Session</div>
            <div className="mt-0.5 text-xs text-ink-muted">
              Pick up an intake session you already started.
            </div>
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-2 text-sm font-semibold">Session</h2>
        {sessionId ? (
          <p className="text-sm text-ink-muted">Adding into the open session. Pick a category above to continue.</p>
        ) : (
          <>
            <label className="block text-sm">
              <span className="text-ink-muted">Name this session (optional)</span>
              <input
                className="mt-1 w-full max-w-sm rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
                value={sessionLabel}
                onChange={(e) => onSessionLabel(e.target.value)}
                placeholder="e.g. Tuesday mail-in"
                aria-label="Session name"
              />
            </label>
            {openSessions.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs text-ink-muted">Or continue where you left off:</p>
                {openSessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onContinueSession(s.id)}
                    className="block w-full rounded border border-hairline px-3 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    {s.label || 'Untitled session'}
                    <span className="ml-2 text-xs text-ink-muted">last active {formatWhen(s.updated_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <button
          type="button"
          onClick={onViewSessions}
          className="mt-3 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          View all intake sessions
        </button>
      </section>
    </div>
  );
}

function CommittedReceipt({
  receipt, category, locationName, onAddAnother, onSwitchCategory, onOpenItem, onOpenLot,
}: {
  receipt: IntakeCommitReceipt;
  category: CategoryDef;
  locationName: string | null;
  onAddAnother: () => void;
  onSwitchCategory: () => void;
  onOpenItem: (itemId: string) => void;
  onOpenLot: (lotId: string) => void;
}) {
  const serialized = receipt.tracking_mode === 'serialized';
  const first = receipt.items[0] ?? null;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Added{receipt.idempotent_replay ? ' (already recorded)' : ''}
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Category</dt>
          <dd>{category.label}</dd>
          <dt className="text-ink-muted">Quantity</dt>
          <dd>{receipt.quantity}</dd>
          <dt className="text-ink-muted">Storage location</dt>
          <dd>{locationName ?? 'Not set'}</dd>
          {serialized && first && (
            <>
              <dt className="text-ink-muted">Item ID</dt>
              <dd className="font-mono">{first.item_public_id}</dd>
              <dt className="text-ink-muted">Scan SKU</dt>
              <dd className="font-mono">{first.scan_sku}</dd>
            </>
          )}
          {!serialized && (
            <>
              <dt className="text-ink-muted">Lot ID</dt>
              <dd className="font-mono">{receipt.lot_public_id}</dd>
            </>
          )}
          <dt className="text-ink-muted">Added</dt>
          <dd>{formatWhen(receipt.committed_at)}</dd>
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAddAnother}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
        >
          Add another {category.label.toLowerCase()}
        </button>
        {serialized && first && (
          <button
            type="button"
            onClick={() => onOpenItem(first.item_id)}
            className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            <Camera className="h-4 w-4" /> Open item &amp; add photos
          </button>
        )}
        {!serialized && (
          <button
            type="button"
            onClick={() => onOpenLot(receipt.lot_id)}
            className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            <Camera className="h-4 w-4" /> Open lot &amp; add photos
          </button>
        )}
        <button
          type="button"
          onClick={() => (serialized && first ? onOpenItem(first.item_id) : onOpenLot(receipt.lot_id))}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
        >
          <Printer className="h-4 w-4" /> Print label
        </button>
        <button
          type="button"
          onClick={onSwitchCategory}
          className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
        >
          Add something else
        </button>
      </div>
    </div>
  );
}
