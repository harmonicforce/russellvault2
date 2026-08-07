// The quantity operations a quantity-managed lot supports: adjust, recount,
// split, merge — plus the histories that explain how it got to its current
// number.
//
// Every one of these goes through a governed database function. Nothing here
// writes a quantity; it collects an intention, shows what the result will be
// BEFORE the operator commits to it, and reports what the database actually
// did. The expected-quantity value is carried on every write so that two
// people counting the same shelf get a conflict instead of silently
// overwriting each other.

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, History, Minus, Plus, Scale, Split,
} from 'lucide-react';
import {
  ADJUSTMENT_REASON_LABELS, OPERATOR_ADJUSTMENT_REASONS,
  type AdjustmentReason, type LotLineageRow, type LotOverviewRow,
  type QuantityAdjustmentRow,
} from '../lib/inventoryData';
import type { StorageLocation } from '../lib/locationsApi';
import {
  isStaleQuantityError, validateAdjust, validateRecount, validateSplit,
} from '../lib/lotOperations';

interface Data {
  adjustLotQuantity(input: {
    lotId: string; change: number; reason: AdjustmentReason;
    expectedQuantity: number | null; note: string | null;
  }): Promise<void>;
  recountLotQuantity(input: {
    lotId: string; countedQuantity: number; expectedQuantity: number | null; note: string | null;
  }): Promise<void>;
  splitLot(input: {
    lotId: string; quantity: number; toLocationCode: string; note: string | null;
  }): Promise<{ child_lot_id: string; child_public_id: string; source_quantity: number }>;
  mergeLots(input: {
    survivorLotId: string; absorbedLotIds: readonly string[]; note: string | null;
  }): Promise<{ survivor_quantity: number; absorbed_count: number }>;
  mergeCandidates(lot: LotOverviewRow): Promise<LotOverviewRow[]>;
  quantityHistory(lotId: string): Promise<QuantityAdjustmentRow[]>;
  lotLineage(lotId: string): Promise<LotLineageRow[]>;
}

function when(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

const field =
  'w-full rounded-lg border border-hairline bg-surface-1 px-2.5 py-2 text-sm outline-none focus:border-accent';

/** A conflict is not a failure the operator caused; it says so differently. */
function ProblemBanner({ message }: { message: string }) {
  const stale = isStaleQuantityError(message);
  return (
    <div
      className={`rounded border px-3 py-2 text-sm ${
        stale ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-danger/40 bg-danger/8 text-danger'
      }`}
    >
      {stale && <AlertTriangle className="mr-1 inline h-4 w-4" />}
      {stale ? 'Someone else changed this lot while you were working. ' : ''}
      {message}
    </div>
  );
}

export function QuantityPanel({
  lot, data, onChanged,
}: { lot: LotOverviewRow; data: Data; onChanged: () => void }) {
  const [mode, setMode] = useState<'add' | 'remove' | 'recount'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<string>('received');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = mode === 'recount'
    ? validateRecount({ counted: amount, currentQuantity: lot.quantity })
    : validateAdjust({
        direction: mode, amount, reason, note, currentQuantity: lot.quantity,
      });

  const submit = async () => {
    if (!validation.ok) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'recount') {
        await data.recountLotQuantity({
          lotId: lot.lot_id,
          countedQuantity: validation.resulting,
          expectedQuantity: lot.quantity,
          note: note.trim() || null,
        });
      } else {
        await data.adjustLotQuantity({
          lotId: lot.lot_id,
          change: validation.change,
          reason: reason as AdjustmentReason,
          expectedQuantity: lot.quantity,
          note: note.trim() || null,
        });
      }
      setAmount('');
      setNote('');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-hairline bg-surface-1 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Scale className="h-4 w-4 text-accent" /> Quantity
      </h2>

      <div className="flex flex-wrap gap-2">
        {([
          { key: 'add', label: 'Add quantity', icon: Plus },
          { key: 'remove', label: 'Remove quantity', icon: Minus },
          { key: 'recount', label: 'Recount', icon: Scale },
        ] as const).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => { setMode(m.key); setAmount(''); setError(null); }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              mode === m.key ? 'border-accent bg-accent/12 text-accent-strong' : 'border-hairline'
            }`}
          >
            <m.icon className="h-3.5 w-3.5" /> {m.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          {mode === 'recount' ? 'Counted quantity' : 'How many units'}
          <input
            className={`mt-1 ${field}`}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={mode === 'recount' ? `Currently ${lot.quantity}` : '0'}
            aria-label={mode === 'recount' ? 'Counted quantity' : 'Units to adjust'}
          />
        </label>
        {mode !== 'recount' && (
          <label className="text-sm font-medium">
            Reason
            <select
              className={`mt-1 ${field}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Adjustment reason"
            >
              {OPERATOR_ADJUSTMENT_REASONS.map((r) => (
                <option key={r} value={r}>{ADJUSTMENT_REASON_LABELS[r]}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="block text-sm font-medium">
        Note{reason === 'other' && mode !== 'recount' ? '' : ' (optional)'}
        <input
          className={`mt-1 ${field}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened"
        />
      </label>

      {/* The result is shown before the operator commits to it. */}
      {amount.trim() !== '' && (
        <p className="text-sm text-ink-muted">
          {validation.ok
            ? `${lot.quantity} → ${validation.resulting}`
            : validation.problem}
        </p>
      )}

      {error && <ProblemBanner message={error} />}

      <button
        onClick={submit}
        disabled={!validation.ok || busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
      >
        {busy ? 'Saving…' : mode === 'recount' ? 'Apply recount' : 'Apply adjustment'}
      </button>
    </section>
  );
}

export function SplitPanel({
  lot, locations, data, onSplit,
}: {
  lot: LotOverviewRow;
  locations: readonly StorageLocation[];
  data: Data;
  onSplit: (childLotId: string) => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [toLocationCode, setToLocationCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = locations.filter((l) => !l.retired_at && l.location_code !== lot.location_code);
  const validation = validateSplit({
    quantity, toLocationCode, currentQuantity: lot.quantity,
  });

  const submit = async () => {
    if (!validation.ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await data.splitLot({
        lotId: lot.lot_id,
        quantity: validation.quantity,
        toLocationCode,
        note: note.trim() || null,
      });
      setQuantity('');
      setNote('');
      onSplit(result.child_lot_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-hairline bg-surface-1 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Split className="h-4 w-4 text-accent" /> Split lot
      </h2>
      <p className="text-xs text-ink-muted">
        Moves part of this lot to another location. The new lot is the same product and the same
        SKU — splitting for a shelf does not create a different kind of thing.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Units to split off
          <input
            className={`mt-1 ${field}`}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={`1–${Math.max(lot.quantity - 1, 1)}`}
            aria-label="Units to split off"
          />
        </label>
        <label className="text-sm font-medium">
          Destination
          <select
            className={`mt-1 ${field}`}
            value={toLocationCode}
            onChange={(e) => setToLocationCode(e.target.value)}
            aria-label="Split destination"
          >
            <option value="">Choose a location…</option>
            {active.map((l) => (
              <option key={l.id} value={l.location_code}>{l.display_name || l.location_code}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm font-medium">
        Note (optional)
        <input
          className={`mt-1 ${field}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why this is splitting"
        />
      </label>

      {quantity.trim() !== '' && (
        <p className="text-sm text-ink-muted">
          {validation.ok
            ? `${lot.quantity} here → ${validation.remaining} here, ${validation.quantity} at the new location`
            : validation.problem}
        </p>
      )}

      {error && <ProblemBanner message={error} />}

      <button
        onClick={submit}
        disabled={!validation.ok || busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
      >
        {busy ? 'Splitting…' : 'Split lot'}
      </button>
    </section>
  );
}

export function MergePanel({
  lot, data, onMerged,
}: { lot: LotOverviewRow; data: Data; onMerged: () => void }) {
  const [candidates, setCandidates] = useState<LotOverviewRow[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    data.mergeCandidates(lot)
      .then((rows) => !cancelled && setCandidates(rows))
      .catch(() => !cancelled && setCandidates([]))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [data, lot]);

  const toggle = (id: string) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const combined = lot.quantity + candidates
    .filter((c) => chosen.has(c.lot_id))
    .reduce((sum, c) => sum + c.quantity, 0);

  const submit = async () => {
    if (chosen.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await data.mergeLots({
        survivorLotId: lot.lot_id,
        absorbedLotIds: [...chosen],
        note: note.trim() || null,
      });
      setChosen(new Set());
      onMerged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <p className="text-sm text-ink-muted">Checking for compatible lots…</p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-hairline bg-surface-1 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ArrowLeftRight className="h-4 w-4 text-accent" /> Merge compatible lots
      </h2>

      {candidates.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No other lot of this exact SKU is in this location. Lots merge only when they are the same
          SKU in the same place — a matching name is not enough.
        </p>
      ) : (
        <>
          <p className="text-xs text-ink-muted">
            These are the same SKU, in the same location, and still active. This lot survives; the
            ones you choose are absorbed into it and keep their history.
          </p>
          <ul className="divide-y divide-hairline rounded border border-hairline">
            {candidates.map((c) => (
              <li key={c.lot_id} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={chosen.has(c.lot_id)}
                  onChange={() => toggle(c.lot_id)}
                  aria-label={`Merge ${c.lot_public_id}`}
                />
                <span className="flex-1 font-mono text-xs text-ink-muted">{c.lot_public_id}</span>
                <span className="text-sm tabular-nums">{c.quantity}</span>
              </li>
            ))}
          </ul>

          {chosen.size > 0 && (
            <p className="text-sm text-ink-muted">
              Combined quantity: {lot.quantity} + {combined - lot.quantity} = {combined}
            </p>
          )}

          <label className="block text-sm font-medium">
            Note (optional)
            <input
              className={`mt-1 ${field}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why these are merging"
            />
          </label>

          {error && <ProblemBanner message={error} />}

          <button
            onClick={submit}
            disabled={chosen.size === 0 || busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
          >
            {busy ? 'Merging…' : `Merge ${chosen.size} lot${chosen.size === 1 ? '' : 's'} into this one`}
          </button>
        </>
      )}
    </section>
  );
}

/**
 * Quantity history and lineage, side by side but never mixed: an adjustment
 * says how many, lineage says where the lot came from and what became of it.
 * Neither belongs in movement history, which is about where things are.
 */
export function LotHistoryPanel({ lot, data }: { lot: LotOverviewRow; data: Data }) {
  const [adjustments, setAdjustments] = useState<QuantityAdjustmentRow[]>([]);
  const [lineage, setLineage] = useState<LotLineageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, l] = await Promise.all([
        data.quantityHistory(lot.lot_id).catch(() => [] as QuantityAdjustmentRow[]),
        data.lotLineage(lot.lot_id).catch(() => [] as LotLineageRow[]),
      ]);
      setAdjustments(a);
      setLineage(l);
    } finally {
      setLoading(false);
    }
  }, [data, lot.lot_id]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="space-y-4 rounded-lg border border-hairline bg-surface-1 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 text-accent" /> Quantity history and lineage
      </h2>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Quantity changes
            </h3>
            {adjustments.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No quantity changes since this lot was added.
              </p>
            ) : (
              <ul className="divide-y divide-hairline text-sm">
                {adjustments.map((a) => (
                  <li key={a.id} className="py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium tabular-nums">
                        {a.previous_quantity} → {a.resulting_quantity}
                      </span>
                      <span className="tabular-nums text-ink-muted">
                        ({a.change_amount > 0 ? '+' : ''}{a.change_amount})
                      </span>
                      <span className="text-ink-muted">
                        {ADJUSTMENT_REASON_LABELS[a.reason] ?? a.reason}
                      </span>
                    </div>
                    <div className="text-xs text-ink-muted">
                      {when(a.adjusted_at)}
                      {a.note ? ` · ${a.note}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Lineage
            </h3>
            {lineage.length === 0 ? (
              <p className="text-sm text-ink-muted">
                This lot has not been split or merged.
              </p>
            ) : (
              <ul className="divide-y divide-hairline text-sm">
                {lineage.map((l) => {
                  const isParent = l.parent_lot_id === lot.lot_id;
                  const label = l.event_kind === 'split'
                    ? (isParent
                        ? `Split ${l.quantity} off into ${l.child_public_id}`
                        : `Split from ${l.parent_public_id}`)
                    : (isParent
                        ? `Merged into ${l.child_public_id}`
                        : `Absorbed ${l.parent_public_id}`);
                  return (
                    <li key={l.id} className="py-2">
                      <div>{label}</div>
                      <div className="text-xs text-ink-muted">
                        {when(l.created_at)}
                        {l.note ? ` · ${l.note}` : ''}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
