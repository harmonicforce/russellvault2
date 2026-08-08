// Phase 5 inventory-identity DIAGNOSTIC surface — read-only and non-authoritative.
//
// This is an admin/diagnostic tool, NOT the final Quick Add, Guided Intake,
// Daily Workbench, Storage Scan & Move, listing, or reconciliation workflow. It
// exposes three panels — an exact public-id resolver, an exact unit scan-SKU
// search, and a lot identity list — so an operator can trace governed identity
// records. It never mutates anything.
//
// S1.6.3 PROOF MIGRATION
//
// This page is the proof surface for the S1.6.3 primitives, chosen because it
// is read-only, carries no business risk, and already contained exactly the ad
// hoc patterns the primitives replace: a hand-rolled error div, unlabelled
// inputs, bare buttons, and a lot list that rendered NOTHING when it had no
// rows — indistinguishable from never having been loaded, and from a load that
// failed.
//
// The transports, their arguments, the read-only guarantee, and every fact
// displayed are unchanged. What changed is how the surface states what it
// knows:
//
//   - the disabled build now renders `notConfigured`, which says the deployment
//     is not set up rather than implying something broke;
//   - a failed lookup renders a bounded Alert instead of a raw div;
//   - the lot list carries a real TruthState, so "no lots" and "the lot read
//     failed" are no longer the same blank region.

import { useCallback, useMemo, useState } from 'react';
import { Boxes, ScanLine, Search } from 'lucide-react';
import { getProvenanceUiConfig, STAGING_NOTICE } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import {
  createInventoryIdentityTransport,
  createItemChainLookup,
  type IdentityLookupResult,
  type InventoryIdentityTransport,
} from '../lib/inventoryIdentityApi';
import {
  describeIdentityRecord,
  summarizeLotDetail,
  summarizeItemDetail,
  type IdentityRecord,
} from '../lib/inventoryIdentity';
import type { ItemDetail, LotDetail } from '../lib/inventoryIdentityApi';
import {
  Alert,
  Button,
  DependencyState,
  Field,
  ProvenanceLabel,
  ResponsiveRecordList,
  StatusPill,
  empty,
  failed,
  loading,
  notConfigured,
  ready,
  type ResponsiveRecord,
  type TruthState,
  type TruthStateOf,
} from '../design-system';

/**
 * Exactly the states the lot read can produce, and no others.
 *
 * Typed this narrowly so mapping the governed records onto presentation records
 * needs no cast: every non-`ready` member carries no value, so it passes
 * straight through to a list of a different value type.
 */
type LotListState =
  | TruthStateOf<'loading'>
  | TruthStateOf<'empty'>
  | TruthStateOf<'error'>
  | { readonly kind: 'ready'; readonly value: readonly IdentityRecord[] };

function IdentityCard({ result }: { result: IdentityLookupResult }) {
  const d = describeIdentityRecord(result.kind, result.record);
  return (
    <div className="rounded-instrument border border-subtle bg-surface-base p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusPill tone="neutral">{d.kindLabel}</StatusPill>
        {d.publicId && <span className="font-mono text-sm">{d.publicId}</span>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {d.facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-ink-muted">{f.label}</dt>
            <dd className="font-mono break-all">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const CONTROL =
  'min-h-11 w-full rounded-control border border-subtle bg-surface-canvas px-2 py-1 font-mono text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

export default function InventoryIdentity() {
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );
  const transport: InventoryIdentityTransport | null = useMemo(() => {
    if (!config) return null;
    const client = createShadowClient(
      import.meta.env as unknown as Record<string, string | undefined>
    );
    return createInventoryIdentityTransport(async () => {
      const session = await (
        client as unknown as {
          auth: { getSession(): Promise<{ data: { session: { access_token?: string } | null } }> };
        }
      )?.auth.getSession();
      return session?.data?.session?.access_token ?? null;
    });
  }, [config]);

  const [workspaceId, setWorkspaceId] = useState('');
  const [publicId, setPublicId] = useState('');
  const [scanSku, setScanSku] = useState('');
  const [pidResult, setPidResult] = useState<IdentityLookupResult | null>(null);
  const [scanResult, setScanResult] = useState<IdentityLookupResult | null>(null);
  // `null` is "not requested yet", which is a different fact from every
  // TruthState kind and must not be rendered as one.
  const [lotsState, setLotsState] = useState<LotListState | null>(null);
  const [lotId, setLotId] = useState('');
  const [lotDetail, setLotDetail] = useState<LotDetail | null>(null);
  const [itemId, setItemId] = useState('');
  const [itemDetail, setItemDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const itemChain = useMemo(
    () => (transport ? createItemChainLookup(transport) : null),
    [transport]
  );

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    []
  );

  // The lot list owns its own truth. A rejection here becomes `error`, not an
  // empty array: the whole point of the contract is that the operator can tell
  // "this workspace has no lots" from "we could not read the lots".
  const loadLots = useCallback(async () => {
    if (!transport) return;
    setError(null);
    setLotsState(loading());
    try {
      const rows = await transport.listLots(workspaceId, 50, 0);
      setLotsState(rows.length > 0 ? ready(rows) : empty());
    } catch (e) {
      setLotsState(failed('IDENTITY_LOT_LIST_FAILED', (e as Error).message));
    }
  }, [transport, workspaceId]);

  // The presentation form of whatever the lot read established. The non-ready
  // states carry no value and pass through unchanged.
  const lotListState: TruthState<readonly ResponsiveRecord[]> | null = useMemo(() => {
    if (!lotsState) return null;
    if (lotsState.kind !== 'ready') return lotsState;
    const records = lotsState.value.map((lot) => {
      const described = describeIdentityRecord('lot', lot);
      return {
        key: String(lot.id),
        identity: described.publicId ?? described.kindLabel,
        subheading: described.kindLabel,
        // Every fact the previous card showed, in the same order, from the same
        // pure helper. Nothing is dropped and nothing is added.
        primaryFields: described.facts.map((fact) => ({ label: fact.label, value: fact.value })),
      } satisfies ResponsiveRecord;
    });
    return ready(records);
  }, [lotsState]);

  if (!config || !transport) {
    return (
      <div className="max-w-2xl p-6">
        <DependencyState
          state={notConfigured('The identity diagnostic surface is not enabled in this build.')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5 p-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Boxes className="h-5 w-5 text-accent" aria-hidden="true" /> Inventory Identity — Diagnostics
        </h1>
        {/* The page-level authority marker, matching what STAGING_NOTICE has
            always said. It is deliberately NOT repeated on every row: a badge
            on everything is a badge that means nothing. */}
        <ProvenanceLabel kind="imported" />
        <p className="text-xs text-ink-muted">{STAGING_NOTICE}</p>
        <p className="text-xs text-ink-muted">
          Read-only. This is a diagnostic surface, not the intake, workbench, scan-and-move,
          listing, or reconciliation workflow.
        </p>
      </header>

      <Field label="Workspace id">
        {(control) => (
          <input
            {...control}
            className={CONTROL}
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            placeholder="workspace uuid"
          />
        )}
      </Field>

      {error && (
        <Alert tone="critical" title="The diagnostic lookup failed">
          {error}
        </Alert>
      )}

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Search className="h-4 w-4" aria-hidden="true" /> Exact public-id lookup
        </h2>
        <div className="flex flex-wrap gap-2">
          <Field label="Public id" className="min-w-[220px] flex-1">
            {(control) => (
              <input
                {...control}
                className={CONTROL}
                value={publicId}
                onChange={(e) => setPublicId(e.target.value)}
                placeholder="RV-PROD-… / RV-SKU-… / RV-C-… / RV-ITEM-… / RV-LOC-…"
              />
            )}
          </Field>
          <Button
            variant="primary"
            className="self-end"
            onClick={() =>
              run(async () => {
                setPidResult(null);
                setItemDetail(null);
                const r = await transport.lookupPublicId(workspaceId, publicId);
                setPidResult(r);
                if (itemChain && r.kind === 'item') {
                  setItemDetail((await itemChain.fromLookup(workspaceId, r)).detail);
                }
              })
            }
          >
            Resolve
          </Button>
        </div>
        {pidResult && <IdentityCard result={pidResult} />}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ScanLine className="h-4 w-4" aria-hidden="true" /> Exact unit scan-SKU search
        </h2>
        <div className="flex flex-wrap gap-2">
          <Field label="Unit scan SKU" className="min-w-[220px] flex-1">
            {(control) => (
              <input
                {...control}
                className={CONTROL}
                value={scanSku}
                onChange={(e) => setScanSku(e.target.value)}
                placeholder="RV-7K3F9Q2"
              />
            )}
          </Field>
          <Button
            variant="primary"
            className="self-end"
            onClick={() =>
              run(async () => {
                setScanResult(null);
                setItemDetail(null);
                const r = await transport.lookupScan(workspaceId, scanSku);
                setScanResult(r);
                if (itemChain && r.kind === 'item') {
                  setItemDetail((await itemChain.fromLookup(workspaceId, r)).detail);
                }
              })
            }
          >
            Find item
          </Button>
        </div>
        {scanResult && <IdentityCard result={scanResult} />}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Boxes className="h-4 w-4" aria-hidden="true" /> Lot identity list
        </h2>
        <Button onClick={() => void loadLots()}>Load lots</Button>
        {lotListState && (
          <ResponsiveRecordList
            label="Lot identity records"
            state={lotListState}
            empty={{
              title: 'No lots in this workspace',
              description: 'The governed identity service answered and returned no lot records.',
            }}
            onRetry={() => void loadLots()}
          />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Boxes className="h-4 w-4" aria-hidden="true" /> Lot identity chain (Product → SKU → Lot → Location)
        </h2>
        <div className="flex flex-wrap gap-2">
          <Field label="Lot internal id" className="min-w-[220px] flex-1">
            {(control) => (
              <input
                {...control}
                className={CONTROL}
                value={lotId}
                onChange={(e) => setLotId(e.target.value)}
                placeholder="lot internal id"
              />
            )}
          </Field>
          <Button
            variant="primary"
            className="self-end"
            onClick={() => run(async () => setLotDetail(await transport.lotDetail(workspaceId, lotId)))}
          >
            Load chain
          </Button>
        </div>
        {lotDetail && (
          <div className="rounded-instrument border border-subtle bg-surface-base p-3 text-sm">
            <ol className="space-y-1">
              {summarizeLotDetail(lotDetail).chain.map((step) => (
                <li key={step.kindLabel} className="flex items-center gap-2">
                  <span className="w-32 text-ink-muted">{step.kindLabel}</span>
                  <span className="font-mono">{step.publicId ?? '—'}</span>
                </li>
              ))}
            </ol>
            <div className="mt-2 text-ink-muted">
              Capacity: <span className="font-mono">{summarizeLotDetail(lotDetail).capacityLabel}</span>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ScanLine className="h-4 w-4" aria-hidden="true" /> Item identity chain (Product → SKU → Lot → Item → Location)
        </h2>
        <p className="text-xs text-ink-muted">
          Populated automatically when a scan or public-id lookup above resolves a serialized item, or
          load it directly by internal item id.
        </p>
        <div className="flex flex-wrap gap-2">
          <Field label="Item internal id" className="min-w-[220px] flex-1">
            {(control) => (
              <input
                {...control}
                className={CONTROL}
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                placeholder="item internal id"
              />
            )}
          </Field>
          <Button
            variant="primary"
            className="self-end"
            onClick={() =>
              run(async () => {
                setItemDetail(null);
                if (itemChain) setItemDetail((await itemChain.byItemId(workspaceId, itemId)).detail);
              })
            }
          >
            Load chain
          </Button>
        </div>
        {itemDetail && (
          <div className="rounded-instrument border border-subtle bg-surface-base p-3 text-sm">
            <ol className="space-y-1">
              {summarizeItemDetail(itemDetail).chain.map((step) => (
                <li key={step.kindLabel} className="flex items-center gap-2">
                  <span className="w-32 text-ink-muted">{step.kindLabel}</span>
                  <span className="font-mono">{step.publicId ?? '—'}</span>
                </li>
              ))}
            </ol>
            <div className="mt-2 text-ink-muted">
              Scan SKU:{' '}
              <span className="font-mono">{summarizeItemDetail(itemDetail).scanSku ?? '—'}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
