// The Listing Prep entry point on an Item or Lot record.
//
// It asks the server whether a preparation is already open rather than
// guessing, so the button says the true thing: open the existing one, or start
// a new one. Starting is refused by the database for a serialized parent lot
// and for stock that is no longer sellable, and that refusal is shown here
// instead of being pre-empted by a rule this component would have to keep in
// sync.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tags } from 'lucide-react';
import {
  READINESS_LABELS, STATUS_LABELS, type ListingPrepTransport, type PrepRecord,
  type SubjectKind,
} from '../lib/listingPrepApi';

export function ListingPrepEntry({
  transport, subjectKind, subjectId, canEdit,
}: {
  transport: ListingPrepTransport;
  subjectKind: SubjectKind;
  subjectId: string;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const [prep, setPrep] = useState<PrepRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await transport.forSubject(subjectKind, subjectId);
      setPrep(result.exists && result.prep ? result.prep : null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [transport, subjectKind, subjectId]);

  useEffect(() => { void load(); }, [load]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const created = await transport.start(subjectKind, subjectId);
      navigate(`/listing-prep/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  if (loading) return null;

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Tags className="h-4 w-4 text-accent" aria-hidden="true" /> Listing preparation
      </h2>

      {error && <p role="alert" className="mb-2 text-xs text-bad">{error}</p>}

      {prep ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            {STATUS_LABELS[prep.status]} · {READINESS_LABELS[prep.readiness_status]}
            {prep.blockers.length > 0
              ? ` · ${prep.blockers.length} outstanding`
              : ''}
          </p>
          <button
            type="button"
            onClick={() => navigate(`/listing-prep/${prep.id}`)}
            className="rounded border border-accent px-3 py-1.5 text-sm font-semibold text-accent"
          >
            Open listing preparation
          </button>
        </div>
      ) : canEdit ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            Not being prepared for listing yet.
          </p>
          <button
            type="button"
            disabled={starting}
            onClick={() => void start()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {starting ? 'Starting…' : 'Prepare for listing'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">Not being prepared for listing yet.</p>
      )}
    </section>
  );
}
