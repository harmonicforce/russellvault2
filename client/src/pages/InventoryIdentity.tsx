// Phase 5 inventory-identity DIAGNOSTIC surface — read-only and non-authoritative.
//
// This is an admin/diagnostic tool, NOT the final Quick Add, Guided Intake,
// Daily Workbench, Storage Scan & Move, listing, or reconciliation workflow. It
// exposes three panels — an exact public-id resolver, an exact unit scan-SKU
// search, and a lot identity list — so an operator can trace governed identity
// records. It never mutates anything.

import { useCallback, useMemo, useState } from 'react';
import { Boxes, ScanLine, Search } from 'lucide-react';
import { getProvenanceUiConfig, STAGING_NOTICE } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import {
  createInventoryIdentityTransport,
  type IdentityLookupResult,
  type InventoryIdentityTransport,
} from '../lib/inventoryIdentityApi';
import {
  describeIdentityRecord,
  summarizeLotDetail,
  type IdentityRecord,
} from '../lib/inventoryIdentity';
import type { LotDetail } from '../lib/inventoryIdentityApi';

function IdentityCard({ result }: { result: IdentityLookupResult }) {
  const d = describeIdentityRecord(result.kind, result.record);
  return (
    <div className="rounded-lg border border-hairline bg-surface-1 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-accent/12 px-2 py-0.5 text-xs font-semibold text-accent-strong">
          {d.kindLabel}
        </span>
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
  const [lots, setLots] = useState<IdentityRecord[]>([]);
  const [lotId, setLotId] = useState('');
  const [lotDetail, setLotDetail] = useState<LotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (!config || !transport) {
    return (
      <div className="p-6 text-sm text-ink-muted">
        The identity diagnostic surface is not enabled in this build.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Boxes className="h-5 w-5 text-accent" /> Inventory Identity — Diagnostics
        </h1>
        <p className="mt-1 text-xs text-ink-muted">{STAGING_NOTICE}</p>
        <p className="mt-1 text-xs text-ink-muted">
          Read-only. This is a diagnostic surface, not the intake, workbench, scan-and-move,
          listing, or reconciliation workflow.
        </p>
      </header>

      <label className="block text-sm">
        <span className="text-ink-muted">Workspace id</span>
        <input
          className="mt-1 w-full rounded border border-hairline bg-surface-0 px-2 py-1 font-mono text-sm"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          placeholder="workspace uuid"
        />
      </label>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Search className="h-4 w-4" /> Exact public-id lookup
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-hairline bg-surface-0 px-2 py-1 font-mono text-sm"
            value={publicId}
            onChange={(e) => setPublicId(e.target.value)}
            placeholder="RV-PROD-… / RV-SKU-… / RV-C-… / RV-ITEM-… / RV-LOC-…"
          />
          <button
            className="rounded bg-accent px-3 py-1 text-sm font-medium text-white"
            onClick={() =>
              run(async () => setPidResult(await transport.lookupPublicId(workspaceId, publicId)))
            }
          >
            Resolve
          </button>
        </div>
        {pidResult && <IdentityCard result={pidResult} />}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ScanLine className="h-4 w-4" /> Exact unit scan-SKU search
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-hairline bg-surface-0 px-2 py-1 font-mono text-sm"
            value={scanSku}
            onChange={(e) => setScanSku(e.target.value)}
            placeholder="RV-7K3F9Q2"
          />
          <button
            className="rounded bg-accent px-3 py-1 text-sm font-medium text-white"
            onClick={() =>
              run(async () => setScanResult(await transport.lookupScan(workspaceId, scanSku)))
            }
          >
            Find item
          </button>
        </div>
        {scanResult && <IdentityCard result={scanResult} />}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Boxes className="h-4 w-4" /> Lot identity list
        </h2>
        <button
          className="rounded border border-hairline px-3 py-1 text-sm"
          onClick={() => run(async () => setLots(await transport.listLots(workspaceId, 50, 0)))}
        >
          Load lots
        </button>
        {lots.length > 0 && (
          <div className="space-y-2">
            {lots.map((lot) => (
              <IdentityCard key={String(lot.id)} result={{ kind: 'lot', record: lot }} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Boxes className="h-4 w-4" /> Lot identity chain (Product → SKU → Lot → Location)
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-hairline bg-surface-0 px-2 py-1 font-mono text-sm"
            value={lotId}
            onChange={(e) => setLotId(e.target.value)}
            placeholder="lot internal id"
          />
          <button
            className="rounded bg-accent px-3 py-1 text-sm font-medium text-white"
            onClick={() => run(async () => setLotDetail(await transport.lotDetail(workspaceId, lotId)))}
          >
            Load chain
          </button>
        </div>
        {lotDetail && (
          <div className="rounded-lg border border-hairline bg-surface-1 p-3 text-sm">
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
    </div>
  );
}
