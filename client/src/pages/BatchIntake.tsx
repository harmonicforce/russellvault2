// Batch Intake — rapid entry of many items of one category.
//
// Each row is its own draft group and commits INDEPENDENTLY through the same
// kernel a single item uses, so a duplicate or an incomplete row fails alone
// and every good row around it stays committed. A row keeps its idempotency
// key and its server draft id for its whole life — including across a refresh
// — so retrying after a network interruption replays the receipt instead of
// creating a second copy.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, ClipboardPaste, Copy, Loader2, Plus, Printer, Trash2, XCircle,
} from 'lucide-react';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import { createIntakeTransport, isConflict, type IntakeTransport } from '../lib/intakeApi';
import { createLocationsTransport, type StorageLocation } from '../lib/locationsApi';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { useWorkspace } from '../lib/workspaceContext';
import {
  CATEGORIES, SOURCE_KINDS, buildEntryPayload, buildGroupPayload, categoryByKey,
  type CategoryDef, type IntakeCategoryKey,
} from '../lib/intakeCategories';
import {
  MAX_BATCH_ROWS, appendRows, applyShared, batchSummary, deserializeDraft, draftStorageKey,
  duplicateRow, fillDown, gridColumns, isRowEmpty, newRow, parsePastedRows, pasteHeaderLine,
  pendingRows, removeRow, rowBlockers, rowsCarriedForAudit, rowsForReplacementBatch,
  serializeDraft, totalUnitsPlanned, updateRowValue,
  type BatchRow, type SessionRestoreState,
} from '../lib/batchIntake';
import { LabelPreview } from '../components/InventoryPanels';
import { labelForItem, labelForLot, type LabelView } from '../lib/labels';

const STATUS_STYLE: Record<BatchRow['status'], string> = {
  draft: 'text-ink-muted',
  committing: 'text-accent-strong',
  committed: 'text-emerald-700',
  blocked: 'text-amber-700',
  duplicate: 'text-red-700',
  failed: 'text-red-700',
};

const STATUS_LABEL: Record<BatchRow['status'], string> = {
  draft: 'Not added',
  committing: 'Adding…',
  committed: 'Added',
  blocked: 'Needs info',
  duplicate: 'Duplicate',
  failed: 'Failed',
};

export default function BatchIntake() {
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();

  const transport: IntakeTransport | null = useMemo(() => {
    if (!config) return null;
    const client = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createIntakeTransport(tokenProviderFromClient(client));
  }, [config]);
  const locationsTransport = useMemo(
    () => createLocationsTransport(client as never, () => workspace?.id ?? null),
    [client, workspace?.id]
  );

  const [categoryKey, setCategoryKey] = useState<IntakeCategoryKey | null>(null);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [locations, setLocations] = useState<readonly StorageLocation[]>([]);
  const [sharedLocation, setSharedLocation] = useState('');
  const [sharedSource, setSharedSource] = useState('');
  const [sharedSourceRef, setSharedSourceRef] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printing, setPrinting] = useState<LabelView[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionRestoreState>({ kind: 'none' });
  const [savedAt, setSavedAt] = useState<string>('');
  const [reconciling, setReconciling] = useState(false);
  const restoredRef = useRef(false);

  const def: CategoryDef | null = categoryKey ? categoryByKey(categoryKey) : null;

  useEffect(() => {
    if (!workspace) return;
    locationsTransport.list().then(setLocations).catch(() => setLocations([]));
  }, [locationsTransport, workspace]);

  // Restore an unfinished batch and RECONCILE it with the server, so a refresh
  // mid-entry loses nothing and never re-attaches drafts to the wrong session.
  useEffect(() => {
    if (!workspace || !transport || restoredRef.current) return;
    restoredRef.current = true;

    let draft;
    try {
      // The workspace is revalidated inside deserializeDraft: a batch saved in
      // another workspace does not restore at all.
      draft = deserializeDraft(
        window.localStorage.getItem(draftStorageKey(workspace.id)), workspace.id
      );
    } catch {
      return; // a corrupt draft simply does not restore
    }
    if (!draft || draft.rows.length === 0) return;

    setCategoryKey(draft.categoryKey as IntakeCategoryKey);
    setRows([...draft.rows]);
    setSharedLocation(draft.sharedLocationCode);
    setSharedSource(draft.sharedSourceKind);
    setSharedSourceRef(draft.sharedSourceReference);
    setSessionLabel(draft.sessionLabel);
    setSavedAt(draft.savedAt);

    void (async () => {
      setReconciling(true);
      try {
        // 1. Is the original session still usable?
        let state: SessionRestoreState = { kind: 'none' };
        if (draft.sessionId) {
          try {
            const session = await transport.resumeSession(workspace.id, draft.sessionId);
            state = session.state === 'open'
              ? { kind: 'open', sessionId: draft.sessionId }
              : { kind: 'closed', sessionId: draft.sessionId };
          } catch {
            state = { kind: 'missing', sessionId: draft.sessionId };
          }
        }
        setSessionState(state);
        // Only adopt the session id when it is genuinely still open. A closed
        // or missing session must never silently receive new groups.
        setSessionId(state.kind === 'open' ? draft.sessionId : null);

        // 2. Reconcile every row that already holds a server draft.
        const reconciled = await Promise.all(draft.rows.map(async (row) => {
          if (!row.groupId) return row;
          try {
            const snapshot = await transport.getGroupSnapshot(workspace.id, row.groupId);
            const groupState = snapshot.group.state;
            if (groupState === 'committed') {
              const receipt = snapshot.receipt;
              return {
                ...row,
                status: 'committed' as const,
                messages: ['Already added.'],
                result: receipt ? {
                  itemPublicId: receipt.items[0]?.item_public_id,
                  itemId: receipt.items[0]?.item_id,
                  scanSku: receipt.items[0]?.scan_sku,
                  lotPublicId: receipt.lot_public_id,
                  lotId: receipt.lot_id,
                  unitsCreated: receipt.quantity,
                } : row.result,
              };
            }
            if (groupState === 'abandoned') {
              return { ...row, status: 'failed' as const,
                messages: ['This row\'s draft was abandoned on the server.'] };
            }
            // Still a draft: keep it, under its ORIGINAL session.
            return { ...row, status: row.status === 'committed' ? row.status : 'draft' as const };
          } catch {
            // The server no longer has this draft. Keep the operator's typed
            // values and say so plainly rather than silently recreating it.
            return {
              ...row,
              status: 'failed' as const,
              messages: ['The saved draft for this row could not be found on the server. ' +
                'Your values are kept — re-add it to create a new record.'],
            };
          }
        }));
        setRows(reconciled);

        setNotice(
          state.kind === 'open' || state.kind === 'none'
            ? 'Restored your unfinished batch.'
            : 'Restored your batch. Its original session is no longer open — see below.'
        );
      } finally {
        setReconciling(false);
      }
    })();
  }, [workspace, transport]);

  // Persist after every change.
  useEffect(() => {
    if (!workspace || !categoryKey) return;
    try {
      window.localStorage.setItem(
        draftStorageKey(workspace.id),
        serializeDraft({
          workspaceId: workspace.id,
          categoryKey,
          sessionId,
          sessionLabel,
          rows,
          sharedLocationCode: sharedLocation,
          sharedSourceKind: sharedSource,
          sharedSourceReference: sharedSourceRef,
          savedAt: new Date().toISOString(),
        })
      );
    } catch {
      /* storage unavailable — the batch still works, it just will not survive a refresh */
    }
    setSavedAt(new Date().toISOString());
  }, [workspace, categoryKey, rows, sharedLocation, sharedSource, sharedSourceRef,
      sessionId, sessionLabel]);

  const startBatch = (key: IntakeCategoryKey) => {
    const nextDef = categoryByKey(key);
    setCategoryKey(key);
    setRows(Array.from({ length: 5 }, () => newRow(nextDef)));
    setNotice(null);
    setError(null);
  };

  const clearBatch = () => {
    if (!window.confirm('Discard this unfinished batch? Rows that were already added stay in inventory.')) return;
    setRows([]);
    setCategoryKey(null);
    setSessionId(null);
    setSessionLabel(null);
    setSessionState({ kind: 'none' });
    if (workspace) {
      try { window.localStorage.removeItem(draftStorageKey(workspace.id)); } catch { /* ignore */ }
    }
  };

  /**
   * The original session can no longer take new groups. Carry only rows that
   * definitely never committed and never created a server draft into a fresh
   * batch, each with a NEW identity, and keep the rest visible for the record.
   */
  const startReplacementBatch = () => {
    const carried = rowsForReplacementBatch(rows);
    const audit = rowsCarriedForAudit(rows);
    if (carried.length === 0) {
      setNotice('Nothing in this batch is safe to re-add — every remaining row already reached the server.');
      return;
    }
    setRows([...audit, ...carried]);
    setSessionId(null);
    setSessionLabel(null);
    setSessionState({ kind: 'none' });
    setNotice(
      `Started a replacement batch with ${carried.length} row(s) that never reached the server. ` +
      `${audit.length} earlier row(s) are kept above for the record and will not be re-sent.`
    );
  };

  const doPaste = () => {
    if (!def) return;
    const parsed = parsePastedRows(def, pasteText);
    if (parsed.length === 0) {
      setNotice('Nothing recognizable to paste.');
      return;
    }
    const { rows: next, skipped } = appendRows(def, rows, parsed);
    setRows(next);
    setPasteText('');
    setShowPaste(false);
    setNotice(
      skipped > 0
        ? `Added ${parsed.length - skipped} rows. ${skipped} were skipped — a batch holds at most ${MAX_BATCH_ROWS}.`
        : `Added ${parsed.length} rows.`
    );
  };

  /** Commit one row end to end, reusing its existing draft on a retry. */
  const commitRow = useCallback(
    async (row: BatchRow, sessionId: string): Promise<BatchRow> => {
      if (!transport || !workspace || !def) return row;
      const payload = buildGroupPayload(def, row.values);

      try {
        let groupId = row.groupId;
        let version: number;

        if (groupId) {
          // Reuse the draft this row already created rather than minting a
          // second one; a group already committed is simply reported as such.
          const snapshot = await transport.getGroupSnapshot(workspace.id, groupId);
          if (snapshot.group.state === 'committed') {
            const receipt = snapshot.receipt;
            return {
              ...row,
              status: 'committed',
              messages: ['Already added.'],
              result: receipt
                ? {
                    itemPublicId: receipt.items[0]?.item_public_id,
                    itemId: receipt.items[0]?.item_id,
                    scanSku: receipt.items[0]?.scan_sku,
                    lotPublicId: receipt.lot_public_id,
                    lotId: receipt.lot_id,
                    unitsCreated: receipt.quantity,
                  }
                : row.result,
            };
          }
          version = snapshot.group.version;
          const updated = await transport.updateCategoryGroup(
            workspace.id, groupId, version, sessionId, payload
          );
          if (isConflict(updated)) {
            return { ...row, status: 'failed', messages: [updated.message] };
          }
          version = updated.version;
        } else {
          const created = await transport.createCategoryGroup(workspace.id, sessionId, payload);
          groupId = created.id;
          version = created.version;
        }

        const entryPayload = buildEntryPayload(def, row.values);
        const entryCount = payload.trackingMode === 'serialized' ? payload.quantity : 1;
        for (let index = 1; index <= entryCount; index += 1) {
          const entry = await transport.upsertCategoryEntry(
            workspace.id, groupId, version, index, entryPayload
          );
          if (isConflict(entry)) {
            return { ...row, groupId, status: 'failed', messages: [entry.message] };
          }
          version = entry.version;
        }

        const preview = await transport.preview(workspace.id, groupId);
        if (!preview.ready) {
          return {
            ...row,
            groupId,
            status: 'blocked',
            messages: preview.blockers.map((b) => b.message),
          };
        }

        const result = await transport.commit(
          workspace.id, groupId, row.idempotencyKey, version, preview.content_hash
        );

        if (result.outcome === 'committed') {
          return {
            ...row,
            groupId,
            status: 'committed',
            messages: result.idempotent_replay ? ['Already added.'] : [],
            result: {
              itemPublicId: result.items[0]?.item_public_id,
              itemId: result.items[0]?.item_id,
              scanSku: result.items[0]?.scan_sku,
              lotPublicId: result.lot_public_id,
              lotId: result.lot_id,
              unitsCreated: result.quantity,
            },
          };
        }
        if (result.outcome === 'blocked') {
          return { ...row, groupId, status: 'blocked', messages: result.blockers.map((b) => b.message) };
        }
        if (result.outcome === 'failed' && result.failure_class === 'duplicate_identity') {
          return {
            ...row,
            groupId,
            status: 'duplicate',
            messages: [
              result.existing_item
                ? `Already in inventory as ${result.existing_item.item_public_id}.`
                : result.message,
            ],
          };
        }
        return {
          ...row,
          groupId,
          status: 'failed',
          messages: ['message' in result ? result.message : 'That row could not be added.'],
        };
      } catch (e) {
        // An unknown outcome keeps the key AND the draft, so a retry is safe.
        return {
          ...row,
          status: 'failed',
          messages: [`${(e as Error).message} Retry is safe — it will not create a duplicate.`],
        };
      }
    },
    [transport, workspace, def]
  );

  const runBatch = async () => {
    if (!transport || !workspace || !def) return;
    // A restored batch whose session is closed or gone must NOT be sent: its
    // remaining rows still carry group ids belonging to that session, and
    // committing them now would attach one session's drafts to a new session.
    // The operator has to start a replacement batch instead.
    if (sessionState.kind === 'closed' || sessionState.kind === 'missing') {
      setError(
        'This batch belongs to a session that is no longer open. Start a replacement batch to continue.'
      );
      return;
    }
    const withShared = applyShared(rows, {
      locationCode: sharedLocation,
      sourceKind: sharedSource,
      sourceReference: sharedSourceRef,
    });
    setRows(withShared);

    const queue = pendingRows(withShared);
    if (queue.length === 0) {
      setNotice('Nothing left to add.');
      return;
    }

    setRunning(true);
    setError(null);
    setNotice(null);
    setProgress({ done: 0, total: queue.length });

    try {
      const label = sessionLabel ?? `Batch ${def.label} ${new Date().toLocaleDateString()}`;
      let activeSession = sessionId;
      if (!activeSession) {
        const created = await transport.createSession(workspace.id, label);
        activeSession = created.id;
        setSessionId(created.id);
        setSessionLabel(label);
        setSessionState({ kind: 'open', sessionId: created.id });
      }

      let done = 0;
      // Sequential on purpose: the kernel serializes identity anyway, and a
      // steady one-at-a-time pass gives honest per-row progress.
      for (const row of queue) {
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'committing' } : r)));
        const finished = await commitRow(row, activeSession);
        setRows((prev) => prev.map((r) => (r.id === row.id ? finished : r)));
        done += 1;
        setProgress({ done, total: queue.length });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const printCommittedLabels = () => {
    if (!def) return;
    const labels: LabelView[] = [];
    for (const row of rows) {
      if (row.status !== 'committed' || !row.result) continue;
      const name = buildGroupPayload(def, row.values).displayName;
      if (row.result.scanSku && row.result.itemPublicId) {
        labels.push(labelForItem({
          product_display_name: name,
          scan_sku: row.result.scanSku,
          item_public_id: row.result.itemPublicId,
        }));
      } else if (row.result.lotPublicId) {
        labels.push(labelForLot({
          product_display_name: name,
          lot_public_id: row.result.lotPublicId,
          quantity: row.result.unitsCreated,
        }));
      }
    }
    if (labels.length === 0) {
      setNotice('No added rows to print yet.');
      return;
    }
    setPrinting(labels);
  };

  if (!transport) {
    return <div className="p-6 text-sm text-ink-muted">Batch intake is not enabled in this build.</div>;
  }
  if (!workspace) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to add inventory.</div>;
  }

  if (!def) {
    return (
      <div className="max-w-3xl space-y-4 p-6">
        <button
          onClick={() => navigate('/quick-add')}
          className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Add Inventory
        </button>
        <header>
          <h1 className="text-lg font-semibold">Batch Intake</h1>
          <p className="mt-1 text-xs text-ink-muted">
            Add many items of one category at a time. Choose the category for this batch.
          </p>
        </header>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => startBatch(c.key)}
              className="rounded-lg border border-hairline bg-surface-1 p-3 text-left hover:border-accent hover:bg-surface-2"
            >
              <div className="text-sm font-medium">{c.label}</div>
              <div className="mt-0.5 text-xs text-ink-muted">{c.blurb}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const columns = gridColumns(def);
  const summary = batchSummary(def, rows);
  const plannedUnits = totalUnitsPlanned(rows);

  return (
    <div className="space-y-4 p-6">
      <button
        onClick={() => navigate('/quick-add')}
        className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Add Inventory
      </button>

      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Batch Intake — {def.label}</h1>
          <p className="mt-1 text-xs text-ink-muted">
            {rows.length} row{rows.length === 1 ? '' : 's'} · {plannedUnits} unit
            {plannedUnits === 1 ? '' : 's'} still to add · at most {MAX_BATCH_ROWS} rows per batch
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {sessionLabel ? <>Session: {sessionLabel} · </> : null}
            {savedAt
              ? `Saved ${new Date(savedAt).toLocaleTimeString()} — this batch survives a refresh.`
              : 'Not saved yet.'}
          </p>
        </div>
        <button onClick={clearBatch} className="text-xs text-ink-muted underline hover:text-ink">
          Clear batch
        </button>
      </header>

      {error && <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">{error}</div>}
      {notice && <div className="rounded border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink-secondary">{notice}</div>}

      {reconciling && (
        <div className="rounded border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink-secondary">
          Checking this batch against the server before you continue…
        </div>
      )}

      {(sessionState.kind === 'closed' || sessionState.kind === 'missing') && (
        <div className="rounded border border-warning/40 bg-warning/8 px-3 py-3 text-sm">
          <p className="font-medium">
            {sessionState.kind === 'closed'
              ? 'The session this batch belongs to is no longer open.'
              : 'The session this batch belongs to is no longer on the server.'}
          </p>
          <p className="mt-1 text-ink-secondary">
            Nothing has been lost. Rows that were already added stay in inventory, and rows that
            never reached the server can be carried into a new batch. Rows already sent are kept
            here for the record and will not be sent again.
          </p>
          <button
            type="button"
            onClick={startReplacementBatch}
            className="mt-2 rounded border border-hairline px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
          >
            Start a replacement batch
          </button>
        </div>
      )}

      <section className="grid gap-3 rounded-lg border border-hairline bg-surface-1 p-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-ink-muted">Location for this batch</span>
          <select
            className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
            value={sharedLocation}
            onChange={(e) => setSharedLocation(e.target.value)}
            aria-label="Location for this batch"
          >
            <option value="">No location selected</option>
            {locations.map((l) => (
              <option key={l.id} value={l.location_code}>
                {l.display_name ? `${l.display_name} (${l.location_code})` : l.location_code}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-ink-muted">Source for this batch</span>
          <select
            className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
            value={sharedSource}
            onChange={(e) => setSharedSource(e.target.value)}
            aria-label="Source for this batch"
          >
            <option value="">—</option>
            {SOURCE_KINDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-ink-muted">Source reference (optional)</span>
          <input
            className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-2 text-sm"
            value={sharedSourceRef}
            onChange={(e) => setSharedSourceRef(e.target.value)}
            aria-label="Source reference for this batch"
          />
        </label>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setRows((prev) => (prev.length >= MAX_BATCH_ROWS ? prev : [...prev, newRow(def)]))}
          disabled={running || rows.length >= MAX_BATCH_ROWS}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add row
        </button>
        <button
          onClick={() => setShowPaste((v) => !v)}
          disabled={running}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <ClipboardPaste className="h-4 w-4" /> Paste from spreadsheet
        </button>
        <button
          onClick={runBatch}
          disabled={running || pendingRows(rows).length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {running && progress
            ? `Adding ${progress.done} of ${progress.total}…`
            : `Add ${pendingRows(rows).length} row${pendingRows(rows).length === 1 ? '' : 's'}`}
        </button>
        {summary.committed > 0 && (
          <button
            onClick={printCommittedLabels}
            className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium"
          >
            <Printer className="h-4 w-4" /> Print {summary.labelsAvailable} label
            {summary.labelsAvailable === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {showPaste && (
        <section className="rounded-lg border border-hairline bg-surface-1 p-4">
          <p className="mb-2 text-xs text-ink-muted">
            Paste tab-separated rows copied from Excel or Google Sheets. Column order:
          </p>
          <code className="mb-2 block overflow-x-auto rounded bg-surface-0 px-2 py-1 text-xs">
            {pasteHeaderLine(def)}
          </code>
          <textarea
            className="w-full rounded border border-hairline bg-surface-0 px-2 py-2 font-mono text-xs"
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            aria-label="Pasted rows"
          />
          <button
            onClick={doPaste}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
          >
            Add pasted rows
          </button>
        </section>
      )}

      {/* The grid scrolls inside its own container so the page never scrolls sideways. */}
      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full text-sm">
          <thead className="bg-surface-1 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-2 py-2">#</th>
              {columns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-2 py-2">{c.label}</th>
              ))}
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((row, index) => {
              const problems = row.status === 'draft' && !isRowEmpty(row) ? rowBlockers(def, row) : [];
              const locked = row.status === 'committed' || running;
              return (
                <tr key={row.id} className={row.status === 'committed' ? 'bg-emerald-50/40' : undefined}>
                  <td className="px-2 py-1.5 align-top text-xs text-ink-muted">{index + 1}</td>
                  {columns.map((c) => (
                    <td key={c.key} className="px-1 py-1 align-top">
                      {c.kind === 'select' ? (
                        <select
                          className="w-full min-w-[8rem] rounded border border-hairline bg-surface-0 px-1.5 py-1 text-xs disabled:opacity-60"
                          value={row.values[c.key] ?? ''}
                          disabled={locked}
                          onChange={(e) => setRows((prev) => updateRowValue(prev, index, c.key, e.target.value))}
                          aria-label={`${c.label} row ${index + 1}`}
                        >
                          <option value="">—</option>
                          {(c.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input
                          className="w-full min-w-[8rem] rounded border border-hairline bg-surface-0 px-1.5 py-1 text-xs disabled:opacity-60"
                          value={row.values[c.key] ?? ''}
                          disabled={locked}
                          onChange={(e) => setRows((prev) => updateRowValue(prev, index, c.key, e.target.value))}
                          aria-label={`${c.label} row ${index + 1}`}
                          autoComplete="off"
                        />
                      )}
                      {!locked && (
                        <button
                          type="button"
                          title="Fill this value down"
                          onClick={() => setRows((prev) => fillDown(prev, index, c.key))}
                          className="mt-0.5 text-[10px] text-ink-muted underline hover:text-accent-strong"
                        >
                          fill down
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 align-top">
                    <span className={`whitespace-nowrap text-xs font-medium ${STATUS_STYLE[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                    {(row.messages.length > 0 || problems.length > 0) && (
                      <ul className="mt-0.5 max-w-[16rem] space-y-0.5 text-[11px] text-ink-secondary">
                        {[...row.messages, ...problems].map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    )}
                    {row.result && (
                      <div className="mt-0.5 font-mono text-[11px] text-ink-muted">
                        {row.result.scanSku ?? row.result.lotPublicId}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 align-top">
                    {row.status === 'committed' && row.result ? (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            row.result?.itemId
                              ? `/inventory/current/${row.result.itemId}`
                              : `/inventory/lots/${row.result?.lotId}`
                          )
                        }
                        className="text-xs text-accent-strong underline"
                      >
                        Open
                      </button>
                    ) : (
                      <span className="flex gap-1.5">
                        <button
                          type="button"
                          title="Duplicate row"
                          disabled={running}
                          onClick={() => setRows((prev) => duplicateRow(prev, index))}
                        >
                          <Copy className="h-3.5 w-3.5 text-ink-muted hover:text-accent" />
                        </button>
                        <button
                          type="button"
                          title="Remove row"
                          disabled={running}
                          onClick={() => setRows((prev) => removeRow(prev, index))}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-ink-muted hover:text-danger" />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(summary.committed > 0 || summary.blocked > 0 || summary.duplicates > 0 || summary.failed > 0) && (
        <section className="rounded-lg border border-hairline bg-surface-1 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {summary.committed > 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-amber-600" />}
            Batch summary
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div className="contents"><dt className="text-ink-muted">Rows added</dt><dd>{summary.committed}</dd></div>
            <div className="contents"><dt className="text-ink-muted">Units created</dt><dd>{summary.unitsCreated}</dd></div>
            <div className="contents"><dt className="text-ink-muted">Duplicates</dt><dd>{summary.duplicates}</dd></div>
            <div className="contents"><dt className="text-ink-muted">Needs info</dt><dd>{summary.blocked}</dd></div>
            <div className="contents"><dt className="text-ink-muted">Failed</dt><dd>{summary.failed}</dd></div>
            <div className="contents"><dt className="text-ink-muted">Incomplete</dt><dd>{summary.incomplete}</dd></div>
          </dl>
          {(summary.blocked > 0 || summary.failed > 0) && (
            <p className="mt-2 text-xs text-ink-muted">
              Correct the rows above and press Add again. Rows already added are skipped, and a retry
              can never create a duplicate of one that succeeded.
            </p>
          )}
        </section>
      )}

      {printing && <LabelPreview labels={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
