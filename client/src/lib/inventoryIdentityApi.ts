// HTTP transport for the Phase 5 inventory-identity diagnostic surface.
//
// READ-ONLY. Every call carries the caller's own Supabase access token and an
// explicit workspace id to the server's /api/inventory-identity surface. There
// is no mutation endpoint and no service-role key anywhere in this path; the
// legacy SQLite inventory remains authoritative and untouched.

import type { IdentityKind, IdentityRecord, ItemDetailSummary } from './inventoryIdentity';
import { summarizeItemDetail } from './inventoryIdentity';

export type TokenProvider = () => Promise<string | null>;

export interface IdentityLookupResult {
  readonly kind: IdentityKind;
  readonly record: IdentityRecord;
}

export interface LotDetail {
  readonly product: IdentityRecord | null;
  readonly sku: IdentityRecord | null;
  readonly lot: IdentityRecord;
  readonly location: IdentityRecord | null;
  readonly serializedChildCount: number;
  readonly capacity: number | null;
  readonly atCapacity: boolean;
}

export interface OriginatingSession {
  readonly sessionId: string;
  readonly sessionPublicId: string;
  readonly sessionLabel: string | null;
  readonly groupId: string;
  readonly groupPublicId: string;
  readonly numericGrade: string | null;
  readonly gradeDesignation: string | null;
}

export interface ItemDetail {
  readonly product: IdentityRecord | null;
  readonly sku: IdentityRecord | null;
  readonly lot: IdentityRecord | null;
  readonly item: IdentityRecord;
  readonly location: IdentityRecord | null;
  readonly session: OriginatingSession | null;
}

export interface InventoryOverviewRow {
  readonly item_id: string;
  readonly item_public_id: string;
  readonly scan_sku: string;
  readonly grading_company: string | null;
  readonly certificate_number: string | null;
  readonly serial_number: string | null;
  readonly item_created_at: string;
  readonly lot_id: string;
  readonly lot_public_id: string;
  readonly tracking_mode: 'lot_managed' | 'serialized';
  readonly lot_quantity: number;
  readonly location_id: string | null;
  readonly location_public_id: string | null;
  readonly location_code: string | null;
  readonly location_display_name: string | null;
  readonly location_retired_at: string | null;
  readonly sku_id: string;
  readonly sku_public_id: string;
  readonly business_vertical: string;
  readonly product_id: string;
  readonly product_public_id: string;
  readonly product_display_name: string;
}

export interface InventoryOverviewFilters {
  readonly q?: string;
  readonly gradingCompany?: string;
  readonly locationId?: string;
  readonly trackingMode?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface InventoryOverviewPage {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly rows: readonly InventoryOverviewRow[];
}

export interface WorkspaceSummaryStats {
  readonly totalLots: number;
  readonly serializedItems: number;
  readonly itemsAddedLast7Days: number;
  readonly openIntakeSessions: number;
  readonly itemsWithoutActiveLocation: number;
}

export interface InventoryIdentityTransport {
  listLots(workspaceId: string, limit: number, offset: number): Promise<IdentityRecord[]>;
  lookupPublicId(workspaceId: string, publicId: string): Promise<IdentityLookupResult>;
  lookupScan(workspaceId: string, scanSku: string): Promise<IdentityLookupResult>;
  lotDetail(workspaceId: string, lotId: string): Promise<LotDetail>;
  itemDetail(workspaceId: string, itemId: string): Promise<ItemDetail>;
  overview(workspaceId: string, filters: InventoryOverviewFilters): Promise<InventoryOverviewPage>;
  summary(workspaceId: string): Promise<WorkspaceSummaryStats>;
}

/** A resolved serialized-item chain: the raw joined detail plus its summary. */
export interface ItemChain {
  readonly detail: ItemDetail;
  readonly summary: ItemDetailSummary;
}

/**
 * Read-only helper that resolves the full serialized-item identity chain from
 * either an exact unit scan code or an internal item id, then summarizes it. It
 * holds no state, so a caller (the diagnostic page) can clear any prior chain
 * before invoking and let a rejection leave the surface empty — failing closed.
 */
export function createItemChainLookup(transport: InventoryIdentityTransport): {
  byScan(workspaceId: string, scanSku: string): Promise<ItemChain>;
  byItemId(workspaceId: string, itemId: string): Promise<ItemChain>;
  fromLookup(workspaceId: string, result: IdentityLookupResult): Promise<ItemChain>;
} {
  const resolve = async (workspaceId: string, itemId: string): Promise<ItemChain> => {
    const detail = await transport.itemDetail(workspaceId, itemId);
    return { detail, summary: summarizeItemDetail(detail) };
  };
  const idOf = (result: IdentityLookupResult): string => {
    if (result.kind !== 'item' || result.record['id'] == null) {
      throw new Error('that lookup did not resolve to a serialized item');
    }
    return String(result.record['id']);
  };
  return {
    async byScan(workspaceId, scanSku) {
      const result = await transport.lookupScan(workspaceId, scanSku);
      return resolve(workspaceId, idOf(result));
    },
    byItemId(workspaceId, itemId) {
      return resolve(workspaceId, itemId);
    },
    fromLookup(workspaceId, result) {
      return resolve(workspaceId, idOf(result));
    },
  };
}

async function request<T>(
  getToken: TokenProvider,
  path: string
): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('you are signed out; sign in to inspect identity');
  const res = await fetch(`/api/inventory-identity${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) throw new Error('not found');
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function createInventoryIdentityTransport(
  getToken: TokenProvider
): InventoryIdentityTransport {
  const ws = (workspaceId: string): string => `workspaceId=${encodeURIComponent(workspaceId)}`;
  return {
    async listLots(workspaceId, limit, offset) {
      const body = await request<{ rows: IdentityRecord[] }>(
        getToken,
        `/lots?${ws(workspaceId)}&limit=${limit}&offset=${offset}`
      );
      return body.rows;
    },
    lookupPublicId(workspaceId, publicId) {
      return request<IdentityLookupResult>(
        getToken,
        `/lookup/public-id/${encodeURIComponent(publicId)}?${ws(workspaceId)}`
      );
    },
    lookupScan(workspaceId, scanSku) {
      return request<IdentityLookupResult>(
        getToken,
        `/lookup/scan/${encodeURIComponent(scanSku)}?${ws(workspaceId)}`
      );
    },
    lotDetail(workspaceId, lotId) {
      return request<LotDetail>(getToken, `/lots/${encodeURIComponent(lotId)}/detail?${ws(workspaceId)}`);
    },
    itemDetail(workspaceId, itemId) {
      return request<ItemDetail>(getToken, `/items/${encodeURIComponent(itemId)}/detail?${ws(workspaceId)}`);
    },
    overview(workspaceId, filters) {
      const params = new URLSearchParams({ workspaceId });
      if (filters.q) params.set('q', filters.q);
      if (filters.gradingCompany) params.set('gradingCompany', filters.gradingCompany);
      if (filters.locationId) params.set('locationId', filters.locationId);
      if (filters.trackingMode) params.set('trackingMode', filters.trackingMode);
      params.set('limit', String(filters.limit ?? 50));
      params.set('offset', String(filters.offset ?? 0));
      return request<InventoryOverviewPage>(getToken, `/overview?${params.toString()}`);
    },
    summary(workspaceId) {
      return request<WorkspaceSummaryStats>(getToken, `/summary?${ws(workspaceId)}`);
    },
  };
}
