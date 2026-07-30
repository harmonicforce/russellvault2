// Starting a cycle count.
//
// Creating and starting are two separate acts, because the database treats them
// that way and the difference matters: a draft has decided nothing, and starting
// is the irreversible moment when scope and expected inventory are frozen. The
// operator sees the preview before that happens, and the lifecycle is shown as
// it advances rather than collapsed into one button.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Snowflake } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createCycleCountApi } from '../lib/cycleCountApi';
import { createLocationsTransport, type StorageLocation } from '../lib/locationsApi';
import {
  previewWarnings, requiresEmptyScopeConfirmation, validateNewCount, type ScopePreview,
} from '../lib/cycleCount';
import { ErrorNote, LoadingNote } from '../components/CycleCountPanels';

const SUBTYPES: readonly { value: string; label: string }[] = [
  { value: 'graded_card', label: 'Graded cards' },
  { value: 'raw_card', label: 'Raw cards' },
  { value: 'sealed_tcg', label: 'Sealed TCG' },
  { value: 'footwear', label: 'Footwear' },
  { value: 'apparel', label: 'Apparel' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'other_collectible', label: 'Other collectibles' },
  { value: 'unclassified', label: 'Unclassified' },
];

const VERTICALS: readonly { value: string; label: string }[] = [
  { value: 'tcg', label: 'Trading cards' },
  { value: 'footwear', label: 'Footwear' },
  { value: 'other', label: 'Other' },
];

type Stage = 'configuring' | 'draft_created';

export default function CycleCountNew() {
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();

  const api = useMemo(
    () => (workspace ? createCycleCountApi(client as never, workspace.id) : null),
    [client, workspace]
  );
  const locations = useMemo(
    () => (workspace ? createLocationsTransport(client as never, () => workspace.id) : null),
    [client, workspace]
  );

  const [locationRows, setLocationRows] = useState<readonly StorageLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);

  const [rootLocationCode, setRootLocationCode] = useState('');
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [subtypeFilter, setSubtypeFilter] = useState('');
  const [verticalFilter, setVerticalFilter] = useState('');
  const [blindCount, setBlindCount] = useState(false);
  const [notes, setNotes] = useState('');

  const [stage, setStage] = useState<Stage>('configuring');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [publicId, setPublicId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScopePreview | null>(null);
  const [emptyAcknowledged, setEmptyAcknowledged] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const loadLocations = useCallback(async () => {
    if (!locations) return;
    setLoadingLocations(true);
    try {
      setLocationRows(await locations.list(false));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingLocations(false);
    }
  }, [locations]);

  useEffect(() => { void loadLocations(); }, [loadLocations]);

  if (!workspace || !api) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to start a cycle count.</div>;
  }

  const createDraft = async () => {
    setProblem(null);
    const check = validateNewCount({
      rootLocationCode, includeDescendants,
      subtypeFilter: subtypeFilter || null, verticalFilter: verticalFilter || null,
      blindCount, notes,
    });
    if (!check.ok) { setProblem(check.problem); return; }
    // Guarded against a double click: a second create would mint a second draft
    // over the same shelf.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createSession({
        rootLocationCode, includeDescendants,
        subtypeFilter: subtypeFilter || null, verticalFilter: verticalFilter || null,
        blindCount, notes: notes.trim() || null,
      });
      setSessionId(created.id);
      setPublicId(created.public_id);
      setStage('draft_created');
      setPreview(await api.previewScope(created.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!sessionId || busy) return;
    setProblem(null);
    if (preview && requiresEmptyScopeConfirmation(preview) && !emptyAcknowledged) {
      setProblem('That scope holds nothing countable. Confirm you meant to start an empty count.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.startSession(sessionId);
      navigate(`/cycle-counts/${sessionId}/count`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const warnings = preview ? previewWarnings(preview) : [];

  return (
    <div className="max-w-2xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardCheck className="h-5 w-5 text-accent" aria-hidden /> Start a cycle count
        </h1>
        <p className="mt-1 text-xs text-ink-muted">
          Choose what to count, check what the system expects to be there, then start. Starting
          freezes the expected snapshot — that is what makes the result evidence rather than an
          opinion.
        </p>
      </header>

      {/* The lifecycle, stated rather than implied. */}
      <ol className="flex flex-wrap gap-2 text-xs">
        {(['Draft created', 'Count started', 'Snapshot frozen'] as const).map((label, i) => {
          const reached = i === 0 ? stage === 'draft_created' : false;
          return (
            <li
              key={label}
              className={`rounded-full px-2.5 py-1 ${
                reached ? 'bg-good/15 text-good' : 'bg-surface-2 text-ink-muted'
              }`}
            >
              {reached ? '✓ ' : `${i + 1}. `}{label}
            </li>
          );
        })}
      </ol>

      <ErrorNote message={error} />

      <section className="space-y-4 rounded-xl border border-hairline bg-surface-1 p-4">
        <div>
          <label htmlFor="cc-new-root" className="block text-xs font-medium text-ink-secondary">
            Location to count
          </label>
          {loadingLocations ? (
            <LoadingNote what="locations" />
          ) : (
            <select
              id="cc-new-root"
              value={rootLocationCode}
              disabled={stage === 'draft_created'}
              onChange={(e) => setRootLocationCode(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-base focus:outline-2 focus:outline-accent disabled:opacity-60"
            >
              <option value="">Choose a location…</option>
              {locationRows.map((l) => (
                <option key={l.id} value={l.location_code}>
                  {l.location_code}{l.display_name ? ` — ${l.display_name}` : ''}
                </option>
              ))}
            </select>
          )}
          {!loadingLocations && locationRows.length === 0 && (
            <p className="mt-1 text-xs text-ink-muted">
              There are no active locations yet. Add one under Locations first.
            </p>
          )}
        </div>

        <fieldset disabled={stage === 'draft_created'} className="disabled:opacity-60">
          <legend className="text-xs font-medium text-ink-secondary">Scope</legend>
          <div className="mt-1 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cc-scope"
                checked={includeDescendants}
                onChange={() => setIncludeDescendants(true)}
                className="h-4 w-4"
              />
              That location and everything below it
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cc-scope"
                checked={!includeDescendants}
                onChange={() => setIncludeDescendants(false)}
                className="h-4 w-4"
              />
              That exact location only
            </label>
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cc-new-subtype" className="block text-xs font-medium text-ink-secondary">
              Only this kind (optional)
            </label>
            <select
              id="cc-new-subtype"
              value={subtypeFilter}
              disabled={stage === 'draft_created'}
              onChange={(e) => setSubtypeFilter(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-sm focus:outline-2 focus:outline-accent disabled:opacity-60"
            >
              <option value="">Everything</option>
              {SUBTYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cc-new-vertical" className="block text-xs font-medium text-ink-secondary">
              Only this category (optional)
            </label>
            <select
              id="cc-new-vertical"
              value={verticalFilter}
              disabled={stage === 'draft_created'}
              onChange={(e) => setVerticalFilter(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-hairline bg-surface-0 px-3 text-sm focus:outline-2 focus:outline-accent disabled:opacity-60"
            >
              <option value="">Everything</option>
              {VERTICALS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
        </div>

        <fieldset disabled={stage === 'draft_created'} className="disabled:opacity-60">
          <legend className="text-xs font-medium text-ink-secondary">Blind or visible</legend>
          <div className="mt-1 space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="cc-blind"
                checked={!blindCount}
                onChange={() => setBlindCount(false)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Visible — the counter can see the expected quantity.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="cc-blind"
                checked={blindCount}
                onChange={() => setBlindCount(true)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Blind — expected quantities are withheld until the count reaches review. A blind
                count is worth more as evidence, because the number cannot have been copied.
              </span>
            </label>
          </div>
        </fieldset>

        <div>
          <label htmlFor="cc-new-notes" className="block text-xs font-medium text-ink-secondary">
            Notes (optional)
          </label>
          <textarea
            id="cc-new-notes"
            value={notes}
            disabled={stage === 'draft_created'}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-hairline bg-surface-0 px-3 py-2 text-sm focus:outline-2 focus:outline-accent disabled:opacity-60"
          />
        </div>

        {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}

        {stage === 'configuring' && (
          <button
            type="button"
            onClick={createDraft}
            disabled={busy}
            className="min-h-11 w-full rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
          >
            {busy ? 'Creating the draft…' : 'Create the draft and preview the scope'}
          </button>
        )}
      </section>

      {stage === 'draft_created' && (
        <section className="space-y-3 rounded-xl border border-hairline bg-surface-1 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">What this count will cover</h2>
            {publicId && <span className="font-mono text-xs text-ink-muted">{publicId}</span>}
          </div>

          {preview === null ? (
            <LoadingNote what="the scope preview" />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">Locations</dt>
                  <dd className="text-lg font-semibold tabular-nums">{preview.location_count}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">Serialized units</dt>
                  <dd className="text-lg font-semibold tabular-nums">{preview.expected_item_count}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">Quantity lots</dt>
                  <dd className="text-lg font-semibold tabular-nums">{preview.expected_lot_count}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-muted">Lot units</dt>
                  <dd className="text-lg font-semibold tabular-nums">{preview.expected_unit_count ?? '—'}</dd>
                </div>
              </dl>

              <p className="text-xs text-ink-muted">
                {includeDescendants ? `${rootLocationCode} and everything below it` : `${rootLocationCode} only`}
                {subtypeFilter && ` · ${SUBTYPES.find((s) => s.value === subtypeFilter)?.label}`}
                {verticalFilter && ` · ${VERTICALS.find((v) => v.value === verticalFilter)?.label}`}
                {blindCount && ' · blind count'}
              </p>

              {warnings.map((w) => (
                <p key={w} className="rounded border border-warning/50 bg-warning/8 px-3 py-2 text-xs text-[#8a5a00] dark:text-warning">
                  {w}
                </p>
              ))}

              {requiresEmptyScopeConfirmation(preview) && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={emptyAcknowledged}
                    onChange={(e) => setEmptyAcknowledged(e.target.checked)}
                    className="mt-0.5 h-5 w-5"
                  />
                  I meant to start a count over an empty scope.
                </label>
              )}

              <div className="rounded-lg bg-surface-2 p-3 text-xs text-ink-secondary">
                <span className="font-medium text-ink">Starting is not reversible.</span> The expected
                snapshot is written now and never recalculated from current inventory afterwards, so
                anything that moves during the count shows up as a discrepancy rather than quietly
                changing what was expected.
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={start}
                  disabled={busy}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Snowflake className="h-4 w-4" aria-hidden />
                  {busy ? 'Starting…' : 'Start the count and freeze the snapshot'}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/cycle-counts')}
                  className="min-h-11 rounded-lg border border-hairline px-4 text-sm font-medium"
                >
                  Leave it as a draft
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
