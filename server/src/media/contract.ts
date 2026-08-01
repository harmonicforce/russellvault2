// Media transport contract.
//
// Pure request-shape validation kept out of the router so it can be tested
// directly. Nothing here grants authority: every route still resolves the
// caller and their workspace role before touching the database.

export const MEDIA_BUCKET = 'inventory-media';

/** Mirrors the database check constraint on inventory_media.content_type. */
export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
] as const;

export type MediaContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** Mirrors the database byte_size constraint (20 MB). */
export const MAX_BYTE_SIZE = 20971520;

export type SubjectKind = 'item' | 'lot';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

export function asSubjectKind(value: unknown): SubjectKind | null {
  return value === 'item' || value === 'lot' ? value : null;
}

export function asContentType(value: unknown): MediaContentType | null {
  return typeof value === 'string' && (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value)
    ? (value as MediaContentType)
    : null;
}

export function asByteSize(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value > 0 && value <= MAX_BYTE_SIZE ? value : null;
}

/** SHA-256 hex, used for duplicate reporting. Optional. */
export function asContentHash(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function asSlotKey(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(value) ? value : null;
}

export function asText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function asUuidArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: string[] = [];
  for (const entry of value) {
    const id = asUuid(entry);
    if (!id) return null;
    out.push(id);
  }
  return new Set(out).size === out.length ? out : null;
}

/** Rotation is quarter turns only; the stored bytes are never re-encoded. */
export function asRotationDelta(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value % 90 === 0 ? value : null;
}

/**
 * A signed URL may only ever be minted for an object inside the caller's own
 * workspace folder. Storage RLS enforces this too; checking here means a
 * mistake is a 422 instead of a silent cross-workspace attempt.
 */
export function pathsBelongToWorkspace(paths: readonly string[], workspaceId: string): boolean {
  const prefix = `${workspaceId}/`;
  return paths.every((p) => typeof p === 'string' && p.startsWith(prefix) && !p.includes('..'));
}

export function asStoragePaths(value: unknown, limit = 200): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > limit) return null;
  return value.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 400)
    ? (value as string[])
    : null;
}
