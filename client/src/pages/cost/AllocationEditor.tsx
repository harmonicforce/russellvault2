import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Dialog, Field } from '../../design-system';
import type {
  AllocationMethod, Amount, MethodOption, ScopeLine, SplitShare,
} from '../../lib/costApi';
import {
  checkConservation, formatMinor, parseMajorInput, splittableTotal,
} from './costMoney';
import { KnownDirectCost, METHOD_LABEL, MinorAmount, PublicId, UNKNOWN } from './costPresentation';

/**
 * Propose a split of a shared cost across the lines it applies to.
 *
 * THE MOST CONSEQUENTIAL DIALOG IN THIS APPLICATION, and the design follows
 * from one fact about the governed contract: A PROPOSAL CANNOT BE WITHDRAWN.
 *
 * `propose_cost_allocation` writes durable `candidate` rows. Nothing in the
 * governed contract deletes one — propose refuses while candidates exist,
 * confirm refuses unless they conserve the component amount, and reverse
 * requires a CONFIRMED allocation. A proposal that does not add up therefore
 * leaves the component permanently stuck: it can never be confirmed, never be
 * reversed, and never be replaced.
 *
 * Three consequences are visible in this file:
 *
 *   1. THE OWNER SEES THE EXACT FIGURES BEFORE ANYTHING IS WRITTEN. The split
 *      is computed by the server, in exact integer arithmetic, and displayed.
 *      Those same figures are what get sent — the browser does not recompute
 *      them, so what is confirmed is what was shown.
 *
 *   2. NOTHING IS FABRICATED HERE. This file performs no allocation
 *      arithmetic of its own. It reads a preview the server computed, and for
 *      a hand-entered split it parses exactly what the owner typed. When a
 *      method has no basis to work from, the server refuses and this shows the
 *      refusal rather than falling back to an even split.
 *
 *   3. THE BALANCE CHECK IS STATED, NOT IMPLIED. The running difference is
 *      computed in `BigInt` and shown as an exact signed figure, so an owner
 *      never has to work out from a greyed-out button why they cannot proceed.
 *
 * Amounts are integer minor units end to end. Nothing here multiplies, divides,
 * or rounds a floating point number.
 */
export function AllocationEditor({
  open,
  componentPublicId,
  amount,
  scopeLines,
  methods,
  onCancel,
  onPreview,
  onConfirm,
  preview,
  previewPending,
  pending,
  error,
  locked,
}: {
  readonly open: boolean;
  readonly componentPublicId: string;
  readonly amount: Amount;
  readonly scopeLines: readonly ScopeLine[];
  readonly methods: readonly MethodOption[];
  readonly onCancel: () => void;
  readonly onPreview: (input: {
    readonly method: AllocationMethod;
    readonly lines: readonly { sourceSystemPublicId: string; acquisitionLinePublicId: string }[];
  }) => void;
  readonly onConfirm: (input: {
    readonly method: AllocationMethod;
    readonly allocations: readonly {
      readonly sourceSystemPublicId: string;
      readonly acquisitionLinePublicId: string;
      readonly amountMinor: string;
    }[];
  }) => void;
  readonly preview: { readonly method: AllocationMethod; readonly shares: readonly SplitShare[] } | null;
  readonly previewPending: boolean;
  readonly pending: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
  /** Proposing is locked because a previous attempt's outcome is unknown. */
  readonly locked: boolean;
}) {
  const [method, setMethod] = useState<AllocationMethod>('manual_equal');
  const [selected, setSelected] = useState<readonly string[]>([]);
  /** Hand-entered MAJOR-unit text, keyed by line. Never parsed as a float. */
  const [typed, setTyped] = useState<Record<string, string>>({});

  const currency = amount.currency;
  const total = splittableTotal(amount);

  const lineKey = (line: { sourceSystemPublicId: string; acquisitionLinePublicId: string }) =>
    `${line.sourceSystemPublicId} ${line.acquisitionLinePublicId}`;

  // Every line in scope starts selected. Narrowing the set is a deliberate act;
  // starting from nothing selected would make the common case the fiddly one.
  useEffect(() => {
    if (open) setSelected(scopeLines.map(lineKey));
  }, [open, scopeLines]);

  const chosen = useMemo(
    () => scopeLines.filter((line) => selected.includes(lineKey(line))),
    [scopeLines, selected],
  );

  const isCustom = method === 'manual_custom';

  /**
   * The amounts that would actually be sent.
   *
   * For a computed method these are the SERVER's figures, read straight from
   * the preview — this browser does not recompute them, so it cannot disagree
   * with what the owner was shown. For a hand-entered split they are what the
   * owner typed, converted by string surgery.
   */
  const proposalLines = useMemo(() => {
    if (isCustom) {
      return chosen.map((line) => {
        const minor = parseMajorInput(typed[lineKey(line)] ?? '', currency);
        return {
          sourceSystemPublicId: line.sourceSystemPublicId,
          acquisitionLinePublicId: line.acquisitionLinePublicId,
          amountMinor: minor === null ? null : minor.toString(),
        };
      });
    }
    if (!preview || preview.method !== method) return [];
    return preview.shares.map((share) => ({
      sourceSystemPublicId: share.sourceSystemPublicId,
      acquisitionLinePublicId: share.acquisitionLinePublicId,
      amountMinor: share.amountMinor,
    }));
  }, [isCustom, chosen, typed, currency, preview, method]);

  const everyAmountReadable = proposalLines.length > 0
    && proposalLines.every((line) => line.amountMinor !== null);

  const verdict = everyAmountReadable
    ? checkConservation(amount, proposalLines.map((line) => line.amountMinor as string))
    : { kind: 'unreadable' as const };

  const balanced = verdict.kind === 'balanced' || verdict.kind === 'within_tolerance';
  const canSend = !locked && !pending && everyAmountReadable && balanced && chosen.length > 0;

  const previewMatchesMethod = preview !== null && preview.method === method;

  return (
    <Dialog
      open={open}
      onDismiss={onCancel}
      title="Propose a cost split"
      description="Records a durable, reviewable proposal. It does not yet establish a cost basis."
      size="wide"
      dismissible={!pending}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSend}
            onClick={() =>
              onConfirm({
                method,
                allocations: proposalLines.map((line) => ({
                  sourceSystemPublicId: line.sourceSystemPublicId,
                  acquisitionLinePublicId: line.acquisitionLinePublicId,
                  amountMinor: line.amountMinor as string,
                })),
              })}
          >
            {pending ? 'Proposing…' : 'Propose this split'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        {/*
          The single most important warning on this surface, stated before the
          owner touches anything rather than after they have made a mistake.
        */}
        <Alert tone="warning" title="A proposal is durable and cannot be edited">
          Proposing writes a governed record. It can be confirmed — which makes it the cost basis — or
          withdrawn, which is a separate governed act with its own reason and audit trail, not an undo:
          the withdrawn amounts stay on record as history and a corrected split is a NEW proposal.
          A split that does not add up to the component amount could never be confirmed, so it is
          refused before it is sent rather than after.
        </Alert>

        {locked && (
          <Alert tone="critical" title="Proposing is locked">
            An earlier attempt did not return a usable answer, so whether it was recorded is unknown.
            Verify what is on record before proposing again.
          </Alert>
        )}

        <dl className="grid gap-2 rounded-instrument border border-subtle bg-surface-inset px-3 py-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
              Cost component
            </dt>
            <dd className="mt-0.5"><PublicId>{componentPublicId}</PublicId></dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
              Amount to split
            </dt>
            <dd className="mt-0.5 tabular-nums text-ink">
              {total === null
                ? 'No known amount'
                : `${formatMinor(total, currency)} ${currency}`}
            </dd>
          </div>
        </dl>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-ink">How should it be split?</legend>
          <div className="grid gap-2">
            {methods.map((option) => (
              <label
                key={option.method}
                className="flex items-start gap-2 rounded-instrument border border-subtle px-3 py-2"
              >
                <input
                  type="radio"
                  name="allocation-method"
                  className="mt-1"
                  value={option.method}
                  checked={method === option.method}
                  onChange={() => setMethod(option.method)}
                  disabled={pending}
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium text-ink">
                    {METHOD_LABEL[option.method] ?? option.method}
                  </span>
                  {/*
                    The description comes from the SERVER, which is also what
                    computed the split. A caption written separately here could
                    drift away from the arithmetic it describes.
                  */}
                  <span className="text-xs text-ink-secondary">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <section aria-label="Lines in scope" className="grid gap-2">
          <h3 className="text-sm font-medium text-ink">
            Lines this cost applies to
          </h3>
          {scopeLines.length === 0 ? (
            <p className="text-sm text-ink-muted">
              This component’s governed scope contains no acquisition lines, so there is nothing to
              split across.
            </p>
          ) : (
            <ul className="grid gap-2">
              {scopeLines.map((line) => {
                const key = lineKey(line);
                const share = proposalLines.find(
                  (entry) => `${entry.sourceSystemPublicId} ${entry.acquisitionLinePublicId}` === key);
                return (
                  <li
                    key={key}
                    className="rounded-instrument border border-subtle px-3 py-2"
                    data-scope-line={line.acquisitionLinePublicId}
                  >
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.includes(key)}
                        disabled={pending}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, key]
                              : current.filter((entry) => entry !== key))}
                        aria-label={`Include ${line.acquisitionLinePublicId} in the split`}
                      />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="text-sm text-ink">{line.title ?? UNKNOWN.title}</span>
                        <PublicId>{line.acquisitionLinePublicId}</PublicId>
                        <span className="text-xs text-ink-secondary">
                          Quantity {line.quantity} · Lot {line.lotPublicId} · Known direct cost{' '}
                          <KnownDirectCost minor={line.knownDirectCostMinor} currency={currency} />
                        </span>
                      </span>
                    </label>

                    {selected.includes(key) && (
                      <div className="mt-2 pl-6">
                        {isCustom ? (
                          <Field
                            label={`Amount for ${line.acquisitionLinePublicId}`}
                            required
                            description={`In ${currency}. Entered exactly — nothing here is rounded.`}
                            error={
                              (typed[key] ?? '').trim() !== ''
                              && parseMajorInput(typed[key] ?? '', currency) === null
                                ? `That is not an amount ${currency} can hold exactly. `
                                  + 'It was not rounded to fit.'
                                : undefined
                            }
                          >
                            {(props) => (
                              <input
                                {...props}
                                type="text"
                                inputMode="decimal"
                                value={typed[key] ?? ''}
                                disabled={pending}
                                onChange={(event) =>
                                  setTyped((current) => ({ ...current, [key]: event.target.value }))}
                                className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm tabular-nums text-ink"
                              />
                            )}
                          </Field>
                        ) : share?.amountMinor ? (
                          <p className="text-sm text-ink" data-share-for={line.acquisitionLinePublicId}>
                            Share: <MinorAmount minor={share.amountMinor} currency={currency} />
                          </p>
                        ) : (
                          <p className="text-sm text-ink-secondary">
                            {previewMatchesMethod
                              ? 'No share computed for this line.'
                              : 'Compute the split to see this line’s share.'}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {!isCustom && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={previewPending || pending || chosen.length === 0}
              onClick={() =>
                onPreview({
                  method,
                  lines: chosen.map((line) => ({
                    sourceSystemPublicId: line.sourceSystemPublicId,
                    acquisitionLinePublicId: line.acquisitionLinePublicId,
                  })),
                })}
            >
              {previewPending ? 'Computing…' : 'Compute the split'}
            </Button>
            <span className="text-xs text-ink-secondary">
              Computing writes nothing. It shows the exact amounts that would be proposed.
            </span>
          </div>
        )}

        {/*
          The balance, stated as an exact signed figure. An owner who cannot
          proceed is told by how much and in which direction, rather than being
          left to infer it from a disabled button.
        */}
        <div
          className="rounded-instrument border border-subtle px-3 py-2"
          data-conservation={verdict.kind}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Balance</p>
          <p className="mt-0.5 text-sm text-ink">{conservationSentence(verdict, currency)}</p>
        </div>

        {error && (
          <Alert tone="critical" title="The governed contract refused this">
            {error.message} <span className="font-mono text-xs">({error.code})</span>
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

/** The balance, in the owner's words, with the exact difference where there is one. */
export function conservationSentence(
  verdict: ReturnType<typeof checkConservation> | { readonly kind: 'unreadable' },
  currency: string,
): string {
  switch (verdict.kind) {
    case 'balanced':
      return 'The split adds up to the component amount exactly.';
    case 'within_tolerance':
      return (
        'The split is within the one-minor-unit rounding tolerance the governed contract allows, so it '
        + 'can be confirmed.'
      );
    case 'out_of_balance': {
      const delta = verdict.deltaMinor;
      const over = delta > 0n;
      const magnitude = over ? delta : -delta;
      return (
        `The split is ${formatMinor(magnitude, currency)} ${currency} ${over ? 'more' : 'less'} than the `
        + 'component amount, so it cannot be proposed. A proposal that does not add up can never be '
        + 'confirmed, and undoing it would take a governed withdrawal that stays on the record.'
      );
    }
    case 'no_total':
      return (
        'This component has no known amount, so there is nothing to conserve against and no split can '
        + 'be proposed.'
      );
    case 'unreadable':
    default:
      return 'Not every line has a readable amount yet, so the balance cannot be stated.';
  }
}
