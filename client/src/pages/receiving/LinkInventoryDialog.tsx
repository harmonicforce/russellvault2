import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Dialog, Field } from '../../design-system';
import type {
  InventorySubjectCandidate,
  ReceivingExpectedLine,
  ReceivingTransport,
} from '../../lib/receivingApi';
import { UNKNOWN, linkProgressText, subjectSummary, trackingModeText } from './receivingPresentation';

/**
 * Attribute observed receiving evidence to a governed inventory subject.
 *
 * TRACKING MODE COMES FROM INVENTORY, NOT FROM THE OPERATOR.
 *
 * There is no "is this a lot or an item?" toggle that the operator sets and the
 * subject then has to match. They choose a real governed subject, and what it
 * IS determines how it is linked: a lot-managed lot takes an editable quantity,
 * a serialized item is exactly one unit and its quantity field does not exist.
 * Letting someone declare a tracking mode contrary to inventory truth would be
 * inviting a claim S2.2 rejects and the operator cannot act on.
 *
 * SERIALIZED MEANS ONE ITEM PER UNIT.
 *
 * A receipt line observing three serialized units needs three real items, not
 * one item carrying quantity three. Nothing here creates or clones an item; if
 * the right subject does not exist yet, the operator is sent to the governed
 * Quick Add workflow that owns inventory creation.
 */
export function LinkInventoryDialog({
  line, workspaceId, api, open, onCancel, onConfirm, pending, error,
}: {
  readonly line: ReceivingExpectedLine;
  readonly workspaceId: string;
  readonly api: ReceivingTransport;
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (
    input:
      | { readonly inventoryLotPublicId: string; readonly quantity: number }
      | { readonly inventoryItemPublicId: string },
  ) => void;
  readonly pending: boolean;
  readonly error: { readonly code: string; readonly message: string } | null;
}) {
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<InventorySubjectCandidate | null>(null);
  // The remaining amount is a DEFAULT, visibly editable, and never presented as
  // an already-established fact before the operator confirms it.
  const [quantity, setQuantity] = useState(String(line.unlinkedQuantity || 1));

  const search = useQuery({
    queryKey: ['receiving-inventory-subjects', workspaceId, term],
    queryFn: () => api.inventorySubjects(workspaceId, { q: term || undefined }),
    enabled: open,
  });

  const subjects = useMemo(() => search.data?.subjects ?? [], [search.data]);
  const parsedQuantity = Number(quantity);
  const quantityValid =
    selected?.subjectKind === 'item'
    || (Number.isSafeInteger(parsedQuantity) && parsedQuantity > 0);

  return (
    <Dialog
      open={open}
      onDismiss={onCancel}
      title="Link received units to inventory"
      description="Attributes observed receiving evidence to a governed inventory subject. It does not create inventory."
      dismissible={!pending}
      size="wide"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!selected || !quantityValid || pending}
            onClick={() => {
              if (!selected) return;
              onConfirm(
                selected.subjectKind === 'item'
                  ? { inventoryItemPublicId: selected.publicId }
                  : { inventoryLotPublicId: selected.publicId, quantity: parsedQuantity },
              );
            }}
          >
            {pending ? 'Linking…' : 'Link to inventory'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <dl className="grid gap-2 rounded-instrument border border-subtle bg-surface-inset px-3 py-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Acquisition line</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{line.title ?? UNKNOWN.title}</dd>
            <dd className="mt-0.5 break-all font-mono text-xs text-ink-secondary">
              {line.sourceSystemPublicId} · {line.acquisitionLinePublicId}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Linking progress</dt>
            <dd className="mt-0.5 text-sm text-ink" data-link-progress>
              {linkProgressText(line.observed?.quantityReceived ?? 0, line.linkedQuantity)}
            </dd>
          </div>
        </dl>

        <Field
          label="Find a governed inventory subject"
          description="Searches lot-managed lots and serialized items already in this workspace."
        >
          {(props) => (
            <input
              {...props}
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Product, public ID, serial or scan code"
              className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm text-ink"
            />
          )}
        </Field>

        {search.isError && (
          <Alert tone="critical" title="The governed inventory search did not answer">
            No subjects can be listed right now. This is not a statement that none exist.
          </Alert>
        )}

        {search.data && !search.data.complete && (
          <Alert tone="warning" title="This is part of the matching inventory">
            The governed search reached its size limit, so subjects may be missing from this list. Narrow
            the search before concluding that a subject does not exist.
          </Alert>
        )}

        <Field label="Inventory subject" required>
          {(props) => (
            <select
              {...props}
              value={selected?.publicId ?? ''}
              onChange={(event) => {
                const next = subjects.find((s) => s.publicId === event.target.value) ?? null;
                setSelected(next);
                // A serialized item is one unit; a lot defaults to what is left.
                if (next?.subjectKind === 'lot') setQuantity(String(line.unlinkedQuantity || 1));
              }}
              className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">
                {search.isLoading ? 'Loading governed inventory…' : 'Select a governed inventory subject'}
              </option>
              {subjects.map((subject) => (
                <option key={`${subject.subjectKind}:${subject.publicId}`} value={subject.publicId}>
                  {trackingModeText(subject.trackingMode)} — {subjectSummary(subject)}
                </option>
              ))}
            </select>
          )}
        </Field>

        {search.data && subjects.length === 0 && (
          // The governed answer PROVED there is no matching subject. That is a
          // real answer, and the operator's next step is to create one in the
          // workflow that owns inventory creation — not here.
          <Alert tone="information" title="No governed inventory subject matches">
            Receiving attributes evidence to inventory that already exists; it does not create Products,
            SKUs, Lots or Items from acquisition text. Create the subject in{' '}
            <Link className="underline" to="/quick-add">Add Inventory</Link>, then return here to link it.
          </Alert>
        )}

        {selected && (
          <div className="grid gap-3 rounded-instrument border border-subtle px-3 py-2">
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-secondary">
                Selected subject
              </span>
              <p className="mt-0.5 break-words text-sm text-ink">{subjectSummary(selected)}</p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                Tracking mode: {trackingModeText(selected.trackingMode)} — recorded by inventory, not chosen here.
              </p>
            </div>

            {selected.subjectKind === 'item' ? (
              <p className="text-sm text-ink-secondary" data-serialized-note>
                A serialized item is exactly one unit, so this link attributes a quantity of 1. Receiving{' '}
                {line.observed?.quantityReceived ?? 0} serialized units needs{' '}
                {line.observed?.quantityReceived ?? 0} separate items, linked one at a time.
              </p>
            ) : (
              <Field
                label="Quantity to attribute"
                required
                description="Defaults to the amount still needing a subject. Edit it before confirming if that is not what this lot accounts for."
              >
                {(props) => (
                  <input
                    {...props}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    className="w-full rounded-control border border-subtle bg-surface px-3 py-2 text-sm tabular-nums text-ink"
                  />
                )}
              </Field>
            )}
          </div>
        )}

        {error && (
          <Alert tone="critical" title="The governed receiving service refused this link">
            {error.message}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
