// Item Detail — a single serialized inventory item, in plain language. Shows
// everything the governed identity chain and its originating intake session
// actually know. No location-change control here: the current backend has no
// safe "move item" operation, so that capability is deliberately deferred
// rather than faked.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, PackagePlus, ScanLine } from 'lucide-react';
import { getProvenanceUiConfig } from '../lib/provenanceConfig';
import { createShadowClient } from '../lib/supabaseShadow';
import {
  createInventoryIdentityTransport,
  type InventoryIdentityTransport,
  type ItemDetail as ItemDetailData,
} from '../lib/inventoryIdentityApi';
import { tokenProviderFromClient } from '../lib/tokenProvider';
import { useWorkspace } from '../lib/workspaceContext';

function str(record: Record<string, unknown> | null, key: string): string | null {
  const v = record?.[key];
  return v === undefined || v === null || v === '' ? null : String(v);
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="contents">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="break-words">{value ?? '—'}</dd>
    </div>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function ItemDetail() {
  const config = useMemo(
    () => getProvenanceUiConfig(import.meta.env as unknown as Record<string, string | undefined>),
    []
  );
  const { workspace } = useWorkspace();
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const transport: InventoryIdentityTransport | null = useMemo(() => {
    if (!config) return null;
    const client = createShadowClient(import.meta.env as unknown as Record<string, string | undefined>);
    return createInventoryIdentityTransport(tokenProviderFromClient(client));
  }, [config]);

  const [detail, setDetail] = useState<ItemDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!transport || !workspace || !itemId) return;
    setLoading(true);
    setError(null);
    transport
      .itemDetail(workspace.id, itemId)
      .then(setDetail)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [transport, workspace, itemId]);

  if (!config || !transport) {
    return <div className="p-6 text-sm text-ink-muted">Item detail is not enabled in this build.</div>;
  }
  if (!workspace) {
    return <div className="p-6 text-sm text-ink-muted">Select a workspace to view this item.</div>;
  }
  if (loading) {
    return <div className="p-6 text-sm text-ink-muted">Loading…</div>;
  }
  if (error || !detail) {
    return (
      <div className="p-6 space-y-3">
        <div className="rounded border border-danger/40 bg-danger/8 px-3 py-2 text-sm text-danger">
          {error ?? 'Item not found.'}
        </div>
        <button onClick={() => navigate('/inventory/current')} className="text-sm text-accent underline">
          Back to Current Inventory
        </button>
      </div>
    );
  }

  const item = detail.item;
  const scanSku = str(item, 'scan_sku');
  const displayName = str(detail.product, 'display_name') ?? 'Unnamed item';
  const grade = [detail.session?.numericGrade, detail.session?.gradeDesignation].filter(Boolean).join(' ');
  const locationLabel = str(detail.location, 'display_name') ?? str(detail.location, 'location_code');
  const locationRetired = detail.location ? str(detail.location, 'retired_at') !== null : false;

  const copyScanSku = () => {
    if (!scanSku) return;
    navigator.clipboard?.writeText(scanSku).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="p-6 max-w-3xl space-y-5">
      <button
        onClick={() => navigate('/inventory/current')}
        className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Current Inventory
      </button>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ScanLine className="h-5 w-5 text-accent" /> {displayName}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Item ID {str(item, 'public_id')}</p>
      </header>

      <section className="rounded-lg border border-hairline bg-surface-1 p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <Row label="Grading company" value={str(item, 'grading_company')} />
          <Row label="Grade" value={grade || null} />
          <Row label="Certificate number" value={str(item, 'certificate_number')} />
          <Row label="Scan SKU" value={scanSku} />
          <Row label="Storage location" value={locationRetired ? `${locationLabel} (retired)` : locationLabel} />
          <Row label="Date added" value={formatWhen(str(item, 'created_at'))} />
          <Row
            label="Intake session"
            value={
              detail.session
                ? (detail.session.sessionLabel || 'Untitled session')
                : 'Not tracked by an intake session'
            }
          />
        </dl>
      </section>

      {locationLabel === null && (
        <p className="text-xs text-ink-muted">
          This item has no active storage location on record. Moving items between locations isn't available yet —
          that's planned for a future update.
        </p>
      )}
      {locationLabel !== null && (
        <p className="text-xs text-ink-muted">
          Changing an item's storage location isn't available yet — that's planned for a future update.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => navigate('/inventory/current')}
          className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
        >
          Return to Inventory
        </button>
        <button
          onClick={() => navigate('/quick-add')}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
        >
          <PackagePlus className="h-4 w-4" /> Add another item
        </button>
        {scanSku && (
          <button
            onClick={copyScanSku}
            className="flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            <Copy className="h-4 w-4" /> {copied ? 'Copied!' : 'Copy scan SKU'}
          </button>
        )}
        {detail.session && (
          <button
            onClick={() => navigate('/quick-add', { state: { resumeSessionId: detail.session!.sessionId } })}
            className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Open originating intake session
          </button>
        )}
      </div>
    </div>
  );
}
