// HTTP transport for the Phase 5 inventory-identity diagnostic surface.
//
// READ-ONLY. Every call carries the caller's own Supabase access token and an
// explicit workspace id to the server's /api/inventory-identity surface. There
// is no mutation endpoint and no service-role key anywhere in this path; the
// legacy SQLite inventory remains authoritative and untouched.

import type { IdentityKind, IdentityRecord } from './inventoryIdentity';

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

export interface ItemDetail {
  readonly product: IdentityRecord | null;
  readonly sku: IdentityRecord | null;
  readonly lot: IdentityRecord | null;
  readonly item: IdentityRecord;
  readonly location: IdentityRecord | null;
}

export interface InventoryIdentityTransport {
  listLots(workspaceId: string, limit: number, offset: number): Promise<IdentityRecord[]>;
  lookupPublicId(workspaceId: string, publicId: string): Promise<IdentityLookupResult>;
  lookupScan(workspaceId: string, scanSku: string): Promise<IdentityLookupResult>;
  lotDetail(workspaceId: string, lotId: string): Promise<LotDetail>;
  itemDetail(workspaceId: string, itemId: string): Promise<ItemDetail>;
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
  };
}
