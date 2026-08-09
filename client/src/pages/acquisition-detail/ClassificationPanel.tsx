import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Field, ReasonField, StatusPill } from '../../design-system';
import type { AcquisitionDetail, Role } from '../../lib/acquisitionDetailApi';
import { Fact, FactGrid, History, HistoryEntry, Panel, instant } from './detailPresentation';

/**
 * How this line is classified, and the two governed ways that can change.
 *
 * NEITHER PATH IS COORDINATED BY THE UNRESOLVED-OPERATION LOCK, deliberately.
 * Classification carries no idempotency key: running the classifier again
 * recomputes from the same governed inputs, and an owner override writes a new
 * append-only row rather than replaying one. There is no unconfirmed-outcome
 * hazard to protect against, so these controls stay usable while a payment or
 * shipment is unresolved.
 *
 * The override collects its reason through a real labelled field. It was
 * previously `window.prompt()` — unlabelled, unstyled, unable to show an error,
 * and effectively unreachable by assistive technology. There is no browser
 * prompt anywhere on this page.
 */
export function ClassificationPanel({
  detail,
  role,
  classify,
  override,
}: {
  readonly detail: AcquisitionDetail;
  readonly role: Role;
  readonly classify: () => Promise<void>;
  readonly override: (optionKey: string, reason: string) => Promise<void>;
}) {
  const [option, setOption] = useState(detail.classification?.optionKey ?? detail.classificationOptions[0]?.key ?? '');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');

  const automatic = useMutation({
    mutationFn: classify,
    onSuccess: () => setMessage('Classification refreshed.'),
    onError: () => setMessage('Classification could not be confirmed. Try again.'),
  });

  const ownerOverride = useMutation({
    // The reason is trimmed on the way OUT and nowhere else: the operator keeps
    // seeing exactly what they typed, and the governed record stores the
    // normalised string the existing contract expects.
    mutationFn: () => override(option, reason.trim()),
    onSuccess: () => {
      setMessage('Owner override saved with history preserved.');
      setReason('');
    },
    onError: () => setMessage('Override could not be confirmed. Try again.'),
  });

  const canClassify = role === 'owner' || role === 'operator';
  const busy = automatic.isPending || ownerOverride.isPending;
  const failure = message.includes('could not') || message.includes('required');

  return (
    <Panel
      title="Classification"
      actions={
        canClassify ? (
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            aria-busy={automatic.isPending || undefined}
            onClick={() => automatic.mutate()}
          >
            Run governed classifier
          </Button>
        ) : undefined
      }
    >
      <FactGrid columns={3}>
        <Fact label="Current classification">
          {detail.classification ? (
            <StatusPill tone="information">{detail.classification.optionLabel}</StatusPill>
          ) : (
            'Not classified'
          )}
        </Fact>
        <Fact label="Method">{detail.classification?.method ?? 'No classification method recorded'}</Fact>
        <Fact label="Confidence">
          {detail.classification ? (
            <span className="tabular-nums">{detail.classification.confidence}</span>
          ) : (
            'No confidence recorded'
          )}
        </Fact>
      </FactGrid>

      {automatic.isPending && (
        <p role="status" className="text-sm text-ink-secondary">
          Running the governed classifier…
        </p>
      )}

      <History
        title="Classification history"
        emptyLabel="No classification history."
        count={detail.classificationHistory.length}
      >
        {detail.classificationHistory.map((entry) => (
          // A single text flow, so history reads as a sentence rather than a
          // row of pills whose relationship the operator has to infer. The
          // owner's reason stays attached to the row it justified — an override
          // adds a row, it does not rewrite the one before it.
          <HistoryEntry key={entry.publicId}>
            {entry.optionLabel} · {entry.method} · {instant(entry.createdAt)}
            {entry.ownerOverrideReason ? ` · ${entry.ownerOverrideReason}` : ''}
            {entry.supersededAt ? ' · superseded' : ' · current'}
          </HistoryEntry>
        ))}
      </History>

      {role === 'owner' && (
        <form
          aria-label="Owner classification override"
          className="grid gap-3 rounded-instrument border border-subtle p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) {
              setMessage('An override reason is required.');
              return;
            }
            ownerOverride.mutate();
          }}
        >
          {/* Not marked `required`: the original contract validates the reason
              in the submit handler, and a native `required` here would change
              which submissions ever reach it. */}
          <Field label="Classification option">
            {(control) => (
              <select
                {...control}
                value={option}
                onChange={(event) => setOption(event.target.value)}
                className="w-full rounded-control border border-subtle bg-surface-base px-3 py-2 text-sm text-ink"
              >
                {detail.classificationOptions.map((choice) => (
                  <option value={choice.key} key={choice.key}>
                    {choice.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <ReasonField
            label="Required reason"
            description="Recorded against the new classification row and kept in history."
            value={reason}
            onChange={setReason}
            rows={2}
          />

          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" disabled={busy || !option} aria-busy={ownerOverride.isPending || undefined}>
              Save owner override
            </Button>
          </div>
        </form>
      )}

      {message && (
        <Alert tone={failure ? 'critical' : 'success'}>
          <p>{message}</p>
        </Alert>
      )}
    </Panel>
  );
}
