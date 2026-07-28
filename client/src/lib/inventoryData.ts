// Inventory data access for movement, media, lots, scanning and the
// workbench.
//
// These run under the CALLER'S OWN Supabase session. Every read goes through a
// security-invoker view or an RLS-protected table, and every write is either an
// RLS-protected insert or a governed SECURITY DEFINER function that authorizes
// internally (move_inventory_item / move_inventory_lot). There is no
// service-role key here and no second authorization model: the database is the
// boundary, exactly as it is for the intake kernel.

import type { SupabaseClient } from '@supabase/supabase-js';

export type AnyClient = SupabaseClient<never, never, never>;

export interface ItemOverviewRow {
  item_id: string;
  item_public_id: string;
  scan_sku: string;
  grading_company: string | null;
  certificate_number: string | null;
  serial_number: string | null;
  item_created_at: string;
  lot_id: string;
  lot_public_id: string;
  tracking_mode: 'lot_managed' | 'serialized';
  lot_quantity: number;
  location_id: string | null;
  location_code: string | null;
  location_display_name: string | null;
  location_retired_at: string | null;
  sku_public_id: string;
  business_vertical: string;
  product_public_id: string;
  product_display_name: string;
  numeric_grade: string | null;
  grade_designation: string | null;
  condition_or_quality: string | null;
  product_format: string | null;
  shoe_size: string | null;
  size_system: string | null;
  size_label: string | null;
  media_count: number;
  primary_media_path: string | null;
}

export interface LotOverviewRow {
  lot_id: string;
  lot_public_id: string;
  tracking_mode: 'lot_managed' | 'serialized';
  quantity: number;
  lot_created_at: string;
  location_id: string | null;
  location_code: string | null;
  location_display_name: string | null;
  location_retired_at: string | null;
  sku_public_id: string;
  business_vertical: string;
  product_public_id: string;
  product_display_name: string;
  condition_or_quality: string | null;
  product_format: string | null;
  seal_or_packaging_condition: string | null;
  size_label: string | null;
  shoe_size: string | null;
  serialized_child_count: number;
  media_count: number;
  primary_media_path: string | null;
}

export interface MediaRow {
  id: string;
  subject_kind: 'item' | 'lot';
  item_id: string | null;
  lot_id: string | null;
  storage_path: string;
  slot_label: string | null;
  sort_order: number;
  is_primary: boolean;
  content_type: string;
  byte_size: number;
  created_at: string;
}

export interface MovementRow {
  id: string;
  public_id: string;
  subject_kind: 'item' | 'lot';
  from_location_id: string | null;
  to_location_id: string;
  note: string | null;
  moved_at: string;
}

export const MEDIA_BUCKET = 'inventory-media';

export interface InventoryFilters {
  q?: string;
  locationId?: string;
  gradingCompany?: string;
  businessVertical?: string;
  needsPhotos?: boolean;
  limit?: number;
  offset?: number;
}

/** Escape the characters PostgREST's `or=` filter treats structurally. */
function escapeFilterValue(term: string): string {
  return term.replace(/[,()%\\]/g, (c) => `\\${c}`);
}

export function createInventoryData(client: AnyClient, workspaceId: string) {
  const db = client as unknown as {
    from(t: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    storage: {
      from(b: string): {
        upload(path: string, file: File, opts?: { contentType?: string; upsert?: boolean }): PromiseLike<{ error: { message: string } | null }>;
        createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
        remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };

  const fail = (error: { message: string } | null): void => {
    // Fail closed and loudly: an unreadable result is never rendered as "none".
    if (error) throw new Error(error.message);
  };

  return {
    async listItems(filters: InventoryFilters = {}): Promise<{ rows: ItemOverviewRow[]; total: number }> {
      let q = db
        .from('inventory_item_overview')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspaceId);
      const term = (filters.q ?? '').trim();
      if (term) {
        const t = escapeFilterValue(term);
        q = q.or(
          `product_display_name.ilike.%${t}%,item_public_id.ilike.%${t}%,scan_sku.ilike.%${t}%,` +
          `certificate_number.ilike.%${t}%,serial_number.ilike.%${t}%,lot_public_id.ilike.%${t}%`
        );
      }
      if (filters.locationId) q = q.eq('location_id', filters.locationId);
      if (filters.gradingCompany) q = q.eq('grading_company', filters.gradingCompany);
      if (filters.businessVertical) q = q.eq('business_vertical', filters.businessVertical);
      if (filters.needsPhotos) q = q.eq('media_count', 0);
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;
      const { data, error, count } = await q
        .order('item_created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      fail(error);
      return { rows: (data ?? []) as ItemOverviewRow[], total: count ?? 0 };
    },

    async listLots(filters: InventoryFilters = {}): Promise<{ rows: LotOverviewRow[]; total: number }> {
      let q = db
        .from('inventory_lot_overview')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspaceId)
        // Serialized lots are represented by their individual units in the
        // item view; showing both would double-count the same inventory.
        .eq('tracking_mode', 'lot_managed');
      const term = (filters.q ?? '').trim();
      if (term) {
        const t = escapeFilterValue(term);
        q = q.or(`product_display_name.ilike.%${t}%,lot_public_id.ilike.%${t}%,sku_public_id.ilike.%${t}%`);
      }
      if (filters.locationId) q = q.eq('location_id', filters.locationId);
      if (filters.businessVertical) q = q.eq('business_vertical', filters.businessVertical);
      if (filters.needsPhotos) q = q.eq('media_count', 0);
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;
      const { data, error, count } = await q
        .order('lot_created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      fail(error);
      return { rows: (data ?? []) as LotOverviewRow[], total: count ?? 0 };
    },

    async getItem(itemId: string): Promise<ItemOverviewRow | null> {
      const { data, error } = await db
        .from('inventory_item_overview')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('item_id', itemId)
        .maybeSingle();
      fail(error);
      return (data as ItemOverviewRow) ?? null;
    },

    async getLot(lotId: string): Promise<LotOverviewRow | null> {
      const { data, error } = await db
        .from('inventory_lot_overview')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('lot_id', lotId)
        .maybeSingle();
      fail(error);
      return (data as LotOverviewRow) ?? null;
    },

    // ---- media ------------------------------------------------------------
    async listMedia(subjectKind: 'item' | 'lot', subjectId: string): Promise<MediaRow[]> {
      const { data, error } = await db
        .from('inventory_media')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq(subjectKind === 'item' ? 'item_id' : 'lot_id', subjectId)
        .order('is_primary', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      fail(error);
      return (data ?? []) as MediaRow[];
    },

    /**
     * Uploads the bytes into the workspace's private folder, then records the
     * media row. Storage RLS validates the path shape and workspace on the
     * object; table RLS re-validates that the subject is in the same
     * workspace — so neither half can be pointed somewhere it should not be.
     */
    async uploadMedia(
      subjectKind: 'item' | 'lot',
      subjectId: string,
      file: File,
      slotLabel: string | null,
      userId: string
    ): Promise<void> {
      const ext = extensionFor(file.type);
      if (!ext) throw new Error('Only JPEG, PNG, WebP or HEIC images can be uploaded.');
      if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
        throw new Error('Images must be larger than 0 bytes and no more than 20 MB.');
      }
      const name = `${safeFileStem()}.${ext}`;
      const path = `${workspaceId}/${subjectId}/${name}`;
      const { error: upErr } = await db.storage
        .from(MEDIA_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      fail(upErr);

      const existing = await this.listMedia(subjectKind, subjectId);
      const { error: rowErr } = await db.from('inventory_media').insert({
        workspace_id: workspaceId,
        subject_kind: subjectKind,
        item_id: subjectKind === 'item' ? subjectId : null,
        lot_id: subjectKind === 'lot' ? subjectId : null,
        storage_path: path,
        slot_label: slotLabel,
        sort_order: existing.length,
        // The first photo of a subject becomes its primary image.
        is_primary: existing.length === 0,
        content_type: file.type,
        byte_size: file.size,
        uploaded_by: userId,
      });
      if (rowErr) {
        // The bytes landed but the row did not: remove the orphan so storage
        // never accumulates objects no record points at.
        await db.storage.from(MEDIA_BUCKET).remove([path]);
        throw new Error(rowErr.message);
      }
    },

    /** Short-lived signed URL. The bucket is private; there is no public URL. */
    async signedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string | null> {
      const { data, error } = await db.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);
      if (error) return null;
      return data?.signedUrl ?? null;
    },

    async deleteMedia(media: MediaRow): Promise<void> {
      const { error } = await db.from('inventory_media').delete().eq('id', media.id);
      fail(error);
      await db.storage.from(MEDIA_BUCKET).remove([media.storage_path]);
    },

    async setPrimaryMedia(subjectKind: 'item' | 'lot', subjectId: string, mediaId: string): Promise<void> {
      const column = subjectKind === 'item' ? 'item_id' : 'lot_id';
      // Clear first: a partial unique index allows only one primary per subject.
      const { error: clearErr } = await db
        .from('inventory_media')
        .update({ is_primary: false })
        .eq('workspace_id', workspaceId)
        .eq(column, subjectId)
        .eq('is_primary', true);
      fail(clearErr);
      const { error } = await db
        .from('inventory_media')
        .update({ is_primary: true })
        .eq('id', mediaId);
      fail(error);
    },

    // ---- movement ---------------------------------------------------------
    async moveItem(itemId: string, toLocationCode: string, note: string | null): Promise<void> {
      const { error } = await db.rpc('move_inventory_item', {
        p_workspace_id: workspaceId,
        p_item_id: itemId,
        p_to_location_code: toLocationCode,
        p_note: note,
      });
      fail(error);
    },

    async moveLot(lotId: string, toLocationCode: string, note: string | null): Promise<void> {
      const { error } = await db.rpc('move_inventory_lot', {
        p_workspace_id: workspaceId,
        p_lot_id: lotId,
        p_to_location_code: toLocationCode,
        p_note: note,
      });
      fail(error);
    },

    async movementHistory(subjectKind: 'item' | 'lot', subjectId: string): Promise<MovementRow[]> {
      const { data, error } = await db
        .from('inventory_movements')
        .select('id, public_id, subject_kind, from_location_id, to_location_id, note, moved_at')
        .eq('workspace_id', workspaceId)
        .eq(subjectKind === 'item' ? 'item_id' : 'lot_id', subjectId)
        .order('moved_at', { ascending: false })
        .limit(50);
      fail(error);
      return (data ?? []) as MovementRow[];
    },

    // ---- workbench --------------------------------------------------------
    async workQueueCounts(): Promise<{ needsLocation: number; needsPhotos: number; total: number }> {
      const [loc, photos, total] = await Promise.all([
        db.from('inventory_work_queue').select('subject_id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId).eq('needs_location', true),
        db.from('inventory_work_queue').select('subject_id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId).eq('needs_photos', true),
        db.from('inventory_work_queue').select('subject_id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId),
      ]);
      for (const r of [loc, photos, total]) fail(r.error);
      return {
        needsLocation: loc.count ?? 0,
        needsPhotos: photos.count ?? 0,
        total: total.count ?? 0,
      };
    },

    async workQueue(kind: 'needs_location' | 'needs_photos', limit = 10) {
      const { data, error } = await db
        .from('inventory_work_queue')
        .select('subject_kind, subject_id, subject_public_id, display_name, created_at')
        .eq('workspace_id', workspaceId)
        .eq(kind, true)
        .order('created_at', { ascending: false })
        .limit(limit);
      fail(error);
      return (data ?? []) as {
        subject_kind: 'item' | 'lot';
        subject_id: string;
        subject_public_id: string;
        display_name: string;
        created_at: string;
      }[];
    },
  };
}

export type InventoryData = ReturnType<typeof createInventoryData>;

function extensionFor(mime: string): string | null {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    default: return null;
  }
}

/** Storage RLS requires the filename to start alphanumeric and stay within a
 * safe character set; a UUID satisfies both without echoing user input. */
function safeFileStem(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  }
}
