// Listing Prep — the detail workspace.
//
// One screen, in the order the work actually happens: what this is, what is
// stopping it, the photographs, the condition and disclosures, the words that
// will appear in the listing, the price, the box it ships in, and finally the
// owner's review.
//
// Two things this screen will not do. It never writes a listing claim on the
// owner's behalf — a condition summary or a title is typed by a person or it
// stays empty. And it never decides readiness itself: the blockers shown here
// are the ones the database computed on this read.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, MinusCircle, Tags } from 'lucide-react';
import { useWorkspace } from '../lib/workspaceContext';
import { createShadowClient } from '../lib/supabaseShadow';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { createMediaTransport } from '../lib/mediaApi';
import { MediaGallery } from '../components/MediaGallery';
import {
  READINESS_LABELS, STATUS_LABELS, createListingPrepTransport, formatMoney,
  parseMoneyToMinor, type CheckState, type PackagePreset, type PrepCheck,
  type PrepContent, type PrepRecord,
} from '../lib/listingPrepApi';

const CHECK_ICON: Record<CheckState, typeof Circle> = {
  unknown: Circle,
  confirmed: CheckCircle2,
  not_applicable: MinusCircle,
};

export default function ListingPrepDetail() {
  const { prepId = '' } = useParams();
  const { workspace, client } = useWorkspace();
  const navigate = useNavigate();
  // Depend on the workspace id, never on the workspace object: an identity
  // that changes on every render would put these effects into a loop.
  const workspaceId = workspace?.id ?? null;
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'operator';
  const isOwner = workspace?.role === 'owner';

  const transport = useMemo(() => {
    const shadow = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createListingPrepTransport(tokenProviderFromClient(shadow), () => workspace?.id ?? null);
  }, [workspace?.id]);

  const mediaTransport = useMemo(
    () => createMediaTransport(tokenProviderFromClient(client as never), () => workspace?.id ?? null),
    [client, workspace?.id]
  );

  const [prep, setPrep] = useState<PrepRecord | null>(null);
  const [presets, setPresets] = useState<readonly PackagePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId || !prepId) return;
    setLoading(true);
    try {
      setPrep(await transport.get(prepId));
      setError(null);
    } catch (e) {
      setPrep(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [transport, workspaceId, prepId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!workspaceId) return;
    transport.presets().then(setPresets).catch(() => setPresets([]));
  }, [transport, workspaceId]);

  const act = useCallback(async (fn: () => Promise<PrepRecord | unknown>, message?: string) => {
    setSaving(true);
    setError(null);
    try {
      const result = await fn();
      if (result && typeof result === 'object' && 'readiness_status' in result) {
        setPrep(result as PrepRecord);
      } else {
        await load();
      }
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [load]);

  if (loading) return <p className="p-6 text-sm text-ink-muted">Loading…</p>;
  if (!prep) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          {error ?? 'That preparation could not be opened.'}
        </p>
        <button type="button" onClick={() => navigate('/listing-prep')} className="text-sm text-accent">
          Back to listing preparation
        </button>
      </div>
    );
  }

  const ready = prep.blockers.length === 0;
  const terminal = prep.status === 'listed' || prep.status === 'cancelled';
  const editable = canEdit && !terminal;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <button
        type="button"
        onClick={() => navigate('/listing-prep')}
        className="flex items-center gap-1 text-sm text-accent"
      >
        <ArrowLeft className="h-4 w-4" /> Listing preparation
      </button>

      {/* Identity ------------------------------------------------------- */}
      <header className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Tags className="h-5 w-5 text-accent" />
          {prep.identity.display_name ?? prep.identity.public_id ?? prep.public_id}
        </h1>
        <p className="text-xs text-ink-muted">
          {prep.identity.public_id} · {prep.subject_kind === 'item' ? 'Single item' : 'Lot'}
          {prep.identity.detail_line ? ` · ${prep.identity.detail_line}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-hairline px-1.5 py-0.5">{STATUS_LABELS[prep.status]}</span>
          <span className={`rounded border px-1.5 py-0.5 ${ready ? 'border-good/50 bg-good/10 text-good' : 'border-warning/50 bg-warning/10 text-warning'}`}>
            {READINESS_LABELS[prep.readiness_status]}
          </span>
          {prep.identity.location_code && (
            <span className="text-ink-muted">at {prep.identity.location_code}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => navigate(prep.subject_kind === 'item'
            ? `/inventory/current/${prep.subject_id}`
            : `/inventory/lots/${prep.subject_id}`)}
          className="mt-2 text-xs font-semibold text-accent"
        >
          Open the {prep.subject_kind === 'item' ? 'item' : 'lot'} record
        </button>
      </header>

      {notice && <p role="status" className="rounded border border-hairline bg-surface-1 p-3 text-sm">{notice}</p>}
      {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      {/* Blockers ------------------------------------------------------- */}
      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-2 text-sm font-semibold">What is stopping this being listed</h2>
        {ready ? (
          <p className="flex items-center gap-2 text-sm text-good">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Nothing outstanding.
          </p>
        ) : (
          <ul className="space-y-1">
            {prep.blockers.map((b) => (
              <li key={b.code} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <span>{b.label}</span>
              </li>
            ))}
          </ul>
        )}
        {prep.blocked_reason && (
          <p className="mt-2 rounded border border-bad/40 bg-bad/10 p-2 text-sm text-bad">
            Blocked: {prep.blocked_reason}
          </p>
        )}
      </section>

      {/* Photographs ---------------------------------------------------- */}
      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-2 text-sm font-semibold">Photographs</h2>
        <MediaGallery
          transport={mediaTransport}
          subjectKind={prep.subject_kind}
          subjectId={prep.subject_id}
          canEdit={editable}
          onChanged={() => void load()}
        />
      </section>

      {/* Preparation checklist ------------------------------------------ */}
      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="text-sm font-semibold">Preparation checklist</h2>
        <p className="mb-2 text-xs text-ink-muted">
          These are confirmations, not fields. Nothing is assumed from a value being filled in.
        </p>
        <ul className="space-y-1.5">
          {prep.checks.map((check) => (
            <ChecklistRow
              key={check.requirement_key}
              check={check}
              disabled={!editable || saving}
              onSet={(state) => void act(
                () => transport.setCheck(prep.id, check.requirement_key, state)
              )}
            />
          ))}
        </ul>
      </section>

      {/* Listing content ------------------------------------------------ */}
      <ContentSection
        prep={prep}
        presets={presets}
        editable={editable}
        saving={saving}
        onSave={(patch) => act(() => transport.saveContent(prep.id, patch), 'Saved.')}
        onApplyPreset={(presetId) => act(() => transport.applyPreset(prep.id, presetId), 'Package preset applied.')}
      />

      {/* Review --------------------------------------------------------- */}
      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-2 text-sm font-semibold">Review</h2>
        {!canEdit && <p className="text-sm text-ink-muted">You have read-only access to this workspace.</p>}

        {editable && (
          <div className="flex flex-wrap gap-2">
            {prep.status !== 'needs_review' && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void act(() => transport.transition(prep.id, 'needs_review'), 'Sent for review.')}
                className="rounded border border-hairline px-3 py-1.5 text-sm disabled:opacity-60"
              >
                Send for review
              </button>
            )}
            {prep.status !== 'blocked' && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const reason = window.prompt('Why is this blocked?');
                  if (reason && reason.trim()) {
                    void act(() => transport.transition(prep.id, 'blocked', reason.trim()), 'Marked blocked.');
                  }
                }}
                className="rounded border border-hairline px-3 py-1.5 text-sm disabled:opacity-60"
              >
                Block…
              </button>
            )}
            {prep.status === 'blocked' && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void act(() => transport.transition(prep.id, 'in_preparation'), 'Unblocked.')}
                className="rounded border border-hairline px-3 py-1.5 text-sm disabled:opacity-60"
              >
                Unblock
              </button>
            )}

            {isOwner && prep.status !== 'ready_to_list' && (
              <button
                type="button"
                disabled={saving || !ready}
                title={ready ? undefined : 'Clear the outstanding blockers first'}
                onClick={() => void act(() => transport.transition(prep.id, 'ready_to_list'), 'Marked ready to list.')}
                className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-on-accent disabled:opacity-40"
              >
                Mark ready to list
              </button>
            )}
          </div>
        )}

        {isOwner && prep.status === 'ready_to_list' && (
          <MarkListed
            saving={saving}
            onSubmit={(ref) => act(() => transport.markListed(prep.id, ref), 'Recorded as listed.')}
          />
        )}

        {prep.status === 'listed' && (
          <div className="space-y-2">
            <p className="text-sm">
              Listed {prep.listed_at ? new Date(prep.listed_at).toLocaleString() : ''} at{' '}
              <span className="font-semibold">{prep.external_listing_ref}</span>.
            </p>
            <p className="text-xs text-ink-muted">
              Recording this changed no inventory. The stock is still in the vault until it sells.
            </p>
            {isOwner && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const reason = window.prompt('Why is this listing being reopened?');
                  if (reason === null) return;
                  void act(
                    () => transport.transition(prep.id, 'in_preparation', reason.trim() || null),
                    'Reopened.'
                  );
                }}
                className="rounded border border-hairline px-3 py-1.5 text-sm disabled:opacity-60"
              >
                Reopen
              </button>
            )}
          </div>
        )}
      </section>

      {/* History -------------------------------------------------------- */}
      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <ul className="space-y-1 text-xs text-ink-muted">
          {prep.events.map((event) => (
            <li key={event.id}>
              {new Date(event.created_at).toLocaleString()} — {event.event_type.replace(/_/g, ' ')}
              {event.to_status ? ` → ${STATUS_LABELS[event.to_status]}` : ''}
              {event.reason ? ` (${event.reason})` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ChecklistRow({
  check, disabled, onSet,
}: {
  check: PrepCheck;
  disabled: boolean;
  onSet: (state: CheckState) => void;
}) {
  const Icon = CHECK_ICON[check.state];
  const tone = check.state === 'confirmed' ? 'text-good'
    : check.state === 'not_applicable' ? 'text-ink-muted' : 'text-warning';
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="flex-1 text-sm">
        {check.label}
        {!check.is_required && <span className="ml-1 text-xs text-ink-muted">(optional)</span>}
      </span>
      {!disabled && (
        <span className="flex gap-1">
          <button
            type="button"
            aria-label={`Confirm ${check.label}`}
            aria-pressed={check.state === 'confirmed'}
            onClick={() => onSet('confirmed')}
            className={`rounded border px-2 py-0.5 text-xs ${
              check.state === 'confirmed' ? 'border-good bg-good/10 text-good' : 'border-hairline'
            }`}
          >
            Confirmed
          </button>
          <button
            type="button"
            aria-label={`Mark ${check.label} not applicable`}
            aria-pressed={check.state === 'not_applicable'}
            onClick={() => onSet('not_applicable')}
            className={`rounded border px-2 py-0.5 text-xs ${
              check.state === 'not_applicable' ? 'border-accent bg-accent/5' : 'border-hairline'
            }`}
          >
            N/A
          </button>
          {check.state !== 'unknown' && (
            <button
              type="button"
              aria-label={`Clear ${check.label}`}
              onClick={() => onSet('unknown')}
              className="rounded border border-hairline px-2 py-0.5 text-xs"
            >
              Clear
            </button>
          )}
        </span>
      )}
    </li>
  );
}

/**
 * The listing's own words and numbers. Held as a local draft so a half-typed
 * description is not sent on every keystroke, and saved explicitly.
 */
function ContentSection({
  prep, presets, editable, saving, onSave, onApplyPreset,
}: {
  prep: PrepRecord;
  presets: readonly PackagePreset[];
  editable: boolean;
  saving: boolean;
  onSave: (patch: Partial<PrepContent>) => void;
  onApplyPreset: (presetId: string) => void;
}) {
  const c = prep.content;
  const [draft, setDraft] = useState({
    working_title: c.working_title ?? '',
    condition_summary: c.condition_summary ?? '',
    description_notes: c.description_notes ?? '',
    defects_disclosures: c.defects_disclosures ?? '',
    included_items: c.included_items ?? '',
    asking: c.asking_price_minor === null ? '' : (c.asking_price_minor / 100).toFixed(2),
    minimum: c.minimum_price_minor === null ? '' : (c.minimum_price_minor / 100).toFixed(2),
    currency: c.currency ?? 'USD',
    quantity: c.quantity_to_list === null ? '' : String(c.quantity_to_list),
    weight: c.package_weight_grams === null ? '' : String(c.package_weight_grams),
    length: c.package_length_mm === null ? '' : String(c.package_length_mm),
    width: c.package_width_mm === null ? '' : String(c.package_width_mm),
    height: c.package_height_mm === null ? '' : String(c.package_height_mm),
  });
  const [priceError, setPriceError] = useState<string | null>(null);

  const set = (key: keyof typeof draft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const int = (value: string) => (value.trim() === '' ? null : Number.parseInt(value, 10));

  const submit = () => {
    setPriceError(null);
    const asking = draft.asking.trim() === '' ? null : parseMoneyToMinor(draft.asking);
    const minimum = draft.minimum.trim() === '' ? null : parseMoneyToMinor(draft.minimum);
    if (draft.asking.trim() !== '' && asking === null) {
      setPriceError('Enter the asking price as an amount, for example 24.99.');
      return;
    }
    if (draft.minimum.trim() !== '' && minimum === null) {
      setPriceError('Enter the lowest acceptable price as an amount, for example 20.00.');
      return;
    }
    if (asking !== null && minimum !== null && minimum > asking) {
      setPriceError('The lowest acceptable price cannot be above the asking price.');
      return;
    }

    const patch: { -readonly [K in keyof PrepContent]?: PrepContent[K] } = {
      working_title: draft.working_title.trim() || null,
      condition_summary: draft.condition_summary.trim() || null,
      description_notes: draft.description_notes.trim() || null,
      defects_disclosures: draft.defects_disclosures.trim() || null,
      included_items: draft.included_items.trim() || null,
      asking_price_minor: asking,
      minimum_price_minor: minimum,
      currency: draft.currency.trim() ? draft.currency.trim().toUpperCase() : null,
      package_weight_grams: int(draft.weight),
      package_length_mm: int(draft.length),
      package_width_mm: int(draft.width),
      package_height_mm: int(draft.height),
    };
    if (prep.subject_kind === 'lot') patch.quantity_to_list = int(draft.quantity);
    onSave(patch);
  };

  const field = 'w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 text-sm';

  return (
    <section className="space-y-4 rounded-lg border border-hairline bg-surface-1 p-4">
      <div>
        <h2 className="text-sm font-semibold">Condition and disclosures</h2>
        <p className="mb-2 text-xs text-ink-muted">
          Written by you. Nothing here is generated from inventory data.
        </p>
        <label className="block text-xs" htmlFor="condition_summary">Condition summary</label>
        <textarea
          id="condition_summary" rows={2} disabled={!editable} className={field}
          value={draft.condition_summary}
          onChange={(e) => set('condition_summary', e.target.value)}
        />
        <label className="mt-2 block text-xs" htmlFor="defects_disclosures">Defects and disclosures</label>
        <textarea
          id="defects_disclosures" rows={2} disabled={!editable} className={field}
          value={draft.defects_disclosures}
          onChange={(e) => set('defects_disclosures', e.target.value)}
        />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Title and description</h2>
        <label className="block text-xs" htmlFor="working_title">Working title</label>
        <input
          id="working_title" disabled={!editable} className={field}
          value={draft.working_title}
          onChange={(e) => set('working_title', e.target.value)}
        />
        <label className="mt-2 block text-xs" htmlFor="description_notes">Description</label>
        <textarea
          id="description_notes" rows={4} disabled={!editable} className={field}
          value={draft.description_notes}
          onChange={(e) => set('description_notes', e.target.value)}
        />
        <label className="mt-2 block text-xs" htmlFor="included_items">What is included</label>
        <input
          id="included_items" disabled={!editable} className={field}
          value={draft.included_items}
          onChange={(e) => set('included_items', e.target.value)}
        />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Price</h2>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs" htmlFor="asking">Asking price</label>
            <input
              id="asking" inputMode="decimal" disabled={!editable} className={field}
              value={draft.asking} onChange={(e) => set('asking', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs" htmlFor="minimum">Lowest acceptable</label>
            <input
              id="minimum" inputMode="decimal" disabled={!editable} className={field}
              value={draft.minimum} onChange={(e) => set('minimum', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs" htmlFor="currency">Currency</label>
            <input
              id="currency" maxLength={3} disabled={!editable} className={field}
              value={draft.currency} onChange={(e) => set('currency', e.target.value)}
            />
          </div>
        </div>
        {priceError && <p role="alert" className="mt-1 text-xs text-bad">{priceError}</p>}
        <p className="mt-1 text-xs text-ink-muted">
          Currently {formatMoney(c.asking_price_minor, c.currency)}.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Package and shipping</h2>
        {prep.subject_kind === 'lot' && (
          <div className="mb-2">
            <label className="block text-xs" htmlFor="quantity">Quantity to list</label>
            <input
              id="quantity" inputMode="numeric" disabled={!editable} className={field}
              value={draft.quantity} onChange={(e) => set('quantity', e.target.value)}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {([['weight', 'Weight (g)'], ['length', 'Length (mm)'],
             ['width', 'Width (mm)'], ['height', 'Height (mm)']] as const).map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs" htmlFor={key}>{label}</label>
              <input
                id={key} inputMode="numeric" disabled={!editable} className={field}
                value={draft[key]} onChange={(e) => set(key, e.target.value)}
              />
            </div>
          ))}
        </div>
        {editable && presets.length > 0 && (
          <div className="mt-2">
            <label className="block text-xs" htmlFor="preset">Apply a package preset</label>
            <select
              id="preset" className={field} defaultValue=""
              onChange={(e) => { if (e.target.value) onApplyPreset(e.target.value); }}
            >
              <option value="">Choose…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {editable && (
        <button
          type="button"
          disabled={saving}
          onClick={submit}
          className="rounded bg-accent px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save listing details'}
        </button>
      )}
    </section>
  );
}

function MarkListed({ saving, onSubmit }: { saving: boolean; onSubmit: (ref: string) => void }) {
  const [ref, setRef] = useState('');
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => { e.preventDefault(); if (ref.trim()) onSubmit(ref.trim()); }}
    >
      <label className="block text-xs" htmlFor="externalRef">Where did you list it?</label>
      <input
        id="externalRef"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        placeholder="Marketplace and listing number, or a link"
        className="w-full rounded border border-hairline bg-surface-0 px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={saving || !ref.trim()}
        className="rounded bg-accent px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-40"
      >
        Record as listed
      </button>
      <p className="text-xs text-ink-muted">
        This records where you listed it. It does not publish anything, and it moves no stock.
      </p>
    </form>
  );
}
