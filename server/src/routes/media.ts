// Governed inventory media.
//
// Metadata operations go through SECURITY DEFINER functions so multi-row
// invariants (ordering, primary selection) are held in one transaction rather
// than assembled from separate client statements.
//
// The image bytes never pass through this server. The browser uploads straight
// into the private bucket using a short-lived signed URL minted here, so the
// path is allocated by the governed reserve call rather than chosen by the
// client, and no service-role credential exists anywhere near the browser.

import { Router, type NextFunction, type Response } from 'express';
import { requireMember, requireOperator, requireOwner, type AuthedRequest } from '../provenance/auth.js';
import { isProvenanceEnabled } from '../provenance/config.js';
import {
  MEDIA_BUCKET, asByteSize, asContentHash, asContentType, asRotationDelta, asSlotKey,
  asStoragePaths, asSubjectKind, asText, asUuid, asUuidArray, pathsBelongToWorkspace,
} from '../media/contract.js';

const router = Router();
router.use((_req, res, next) => (isProvenanceEnabled(process.env) ? next() : res.status(404).json({ error: 'not found' })));

function asyncRoute(fn: (req: AuthedRequest, res: Response) => Promise<void>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
}
function ctx(req: AuthedRequest) {
  if (!req.caller) throw new Error('caller not resolved');
  return req.caller;
}
function body(req: AuthedRequest) { return (req.body ?? {}) as Record<string, unknown>; }

const ERROR_MAP: readonly [RegExp, number, string][] = [
  [/not found in this workspace/i, 404, 'not_found'],
  [/owner authority|not a member|permission denied|row-level security|viewer cannot/i, 403, 'forbidden'],
  [/no longer awaiting|only a live photo|already/i, 409, 'lifecycle_conflict'],
  [/required|invalid|unsupported|outside the accepted range|quarter turn|multiple of 90/i, 422, 'invalid_request'],
];
function dbFailure(res: Response, message: string): void {
  const match = ERROR_MAP.find(([pattern]) => pattern.test(message));
  res.status(match?.[1] ?? 400).json({ error: match?.[2] ?? 'governed_operation_failed' });
}
function invalid(res: Response, field: string): void {
  res.status(422).json({ error: 'invalid_request', field });
}

async function rpc(req: AuthedRequest, res: Response, fn: string, args: Record<string, unknown>) {
  const { client, workspaceId } = ctx(req);
  const { data, error } = await client.rpc(fn as never, { p_workspace_id: workspaceId, ...args } as never);
  if (error) return dbFailure(res, error.message);
  res.json(data);
}

// ---- reads -----------------------------------------------------------------

router.get('/', requireMember, asyncRoute(async (req, res) => {
  const kind = asSubjectKind(req.query.subjectKind);
  const subjectId = asUuid(req.query.subjectId);
  if (!kind) return invalid(res, 'subjectKind');
  if (!subjectId) return invalid(res, 'subjectId');
  return rpc(req, res, 'list_inventory_media', {
    p_subject_kind: kind, p_subject_id: subjectId,
    p_include_deleted: req.query.includeDeleted === 'true',
  });
}));

router.get('/readiness', requireMember, asyncRoute(async (req, res) => {
  const kind = asSubjectKind(req.query.subjectKind);
  const subjectId = asUuid(req.query.subjectId);
  if (!kind) return invalid(res, 'subjectKind');
  if (!subjectId) return invalid(res, 'subjectId');
  return rpc(req, res, 'get_inventory_media_readiness', {
    p_subject_kind: kind, p_subject_id: subjectId,
  });
}));

/**
 * Display URLs are minted in one batch so a gallery costs a single round trip
 * instead of one request per thumbnail.
 */
router.post('/signed-urls', requireMember, asyncRoute(async (req, res) => {
  const { client, workspaceId } = ctx(req);
  const paths = asStoragePaths(body(req).paths);
  if (!paths) return invalid(res, 'paths');
  if (!pathsBelongToWorkspace(paths, workspaceId)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const expiresIn = 3600;
  const { data, error } = await client.storage.from(MEDIA_BUCKET).createSignedUrls(paths, expiresIn);
  if (error) return dbFailure(res, error.message);
  res.json({
    urls: (data ?? []).map((entry) => ({
      path: entry.path ?? null,
      signedUrl: entry.signedUrl ?? null,
      error: entry.error ?? null,
    })),
    expiresIn,
  });
}));

// ---- upload: reserve -> bytes -> commit ------------------------------------

router.post('/uploads/reserve', requireOperator, asyncRoute(async (req, res) => {
  const { client, workspaceId } = ctx(req);
  const b = body(req);
  const kind = asSubjectKind(b.subjectKind);
  const subjectId = asUuid(b.subjectId);
  const contentType = asContentType(b.contentType);
  const byteSize = asByteSize(b.byteSize);
  const idempotencyKey = asUuid(b.idempotencyKey);
  if (!kind) return invalid(res, 'subjectKind');
  if (!subjectId) return invalid(res, 'subjectId');
  if (!contentType) return invalid(res, 'contentType');
  if (byteSize === null) return invalid(res, 'byteSize');
  if (!idempotencyKey) return invalid(res, 'idempotencyKey');

  const exif = typeof b.exifOrientation === 'number' && b.exifOrientation >= 1 && b.exifOrientation <= 8
    ? Math.trunc(b.exifOrientation) : null;

  const { data, error } = await client.rpc('reserve_inventory_media' as never, {
    p_workspace_id: workspaceId,
    p_subject_kind: kind,
    p_subject_id: subjectId,
    p_content_type: contentType,
    p_byte_size: byteSize,
    p_idempotency_key: idempotencyKey,
    p_original_filename: asText(b.originalFilename, 160),
    p_content_hash: asContentHash(b.contentHash),
    p_slot_key: asSlotKey(b.slotKey),
    p_slot_label: asText(b.slotLabel, 60),
    p_exif_orientation: exif,
  } as never);
  if (error) return dbFailure(res, error.message);

  const reservation = (data ?? {}) as Record<string, unknown>;
  const storagePath = typeof reservation.storage_path === 'string' ? reservation.storage_path : null;
  if (!storagePath) { res.status(500).json({ error: 'reservation_incomplete' }); return; }

  // A replayed reservation whose bytes already landed must not hand out a new
  // upload URL; the client should go straight to commit.
  if (reservation.lifecycle === 'active') {
    res.json({ ...reservation, upload: null });
    return;
  }

  const signed = await client.storage.from(MEDIA_BUCKET).createSignedUploadUrl(storagePath);
  if (signed.error) {
    // The reservation exists but the client cannot send bytes for it. Retire it
    // so it does not linger as a phantom pending upload.
    await client.rpc('abandon_inventory_media' as never, {
      p_workspace_id: workspaceId,
      p_media_id: reservation.media_id,
      p_reason: 'upload url could not be issued',
    } as never);
    return dbFailure(res, signed.error.message);
  }

  res.json({
    ...reservation,
    upload: { signedUrl: signed.data?.signedUrl ?? null, token: signed.data?.token ?? null, path: storagePath },
  });
}));

router.post('/uploads/:mediaId/commit', requireOperator, asyncRoute(async (req, res) => {
  const mediaId = asUuid(req.params.mediaId);
  if (!mediaId) return invalid(res, 'mediaId');
  return rpc(req, res, 'commit_inventory_media', { p_media_id: mediaId });
}));

router.post('/uploads/:mediaId/abandon', requireOperator, asyncRoute(async (req, res) => {
  const mediaId = asUuid(req.params.mediaId);
  if (!mediaId) return invalid(res, 'mediaId');
  return rpc(req, res, 'abandon_inventory_media', {
    p_media_id: mediaId, p_reason: asText(body(req).reason, 300),
  });
}));

// ---- gallery operations ----------------------------------------------------

router.post('/reorder', requireOperator, asyncRoute(async (req, res) => {
  const b = body(req);
  const kind = asSubjectKind(b.subjectKind);
  const subjectId = asUuid(b.subjectId);
  const mediaIds = asUuidArray(b.mediaIds);
  if (!kind) return invalid(res, 'subjectKind');
  if (!subjectId) return invalid(res, 'subjectId');
  if (!mediaIds) return invalid(res, 'mediaIds');
  return rpc(req, res, 'reorder_inventory_media', {
    p_subject_kind: kind, p_subject_id: subjectId, p_media_ids: mediaIds,
  });
}));

router.post('/:mediaId/primary', requireOperator, asyncRoute(async (req, res) => {
  const mediaId = asUuid(req.params.mediaId);
  if (!mediaId) return invalid(res, 'mediaId');
  return rpc(req, res, 'set_primary_inventory_media', { p_media_id: mediaId });
}));

router.post('/:mediaId/rotate', requireOperator, asyncRoute(async (req, res) => {
  const mediaId = asUuid(req.params.mediaId);
  const delta = asRotationDelta(body(req).deltaDegrees);
  if (!mediaId) return invalid(res, 'mediaId');
  if (delta === null) return invalid(res, 'deltaDegrees');
  return rpc(req, res, 'rotate_inventory_media', { p_media_id: mediaId, p_delta_degrees: delta });
}));

router.delete('/:mediaId', requireOperator, asyncRoute(async (req, res) => {
  const mediaId = asUuid(req.params.mediaId);
  if (!mediaId) return invalid(res, 'mediaId');
  return rpc(req, res, 'soft_delete_inventory_media', {
    p_media_id: mediaId, p_reason: asText(body(req).reason, 300), p_recovery_days: 30,
  });
}));

router.post('/:mediaId/restore', requireOperator, asyncRoute(async (req, res) => {
  const mediaId = asUuid(req.params.mediaId);
  if (!mediaId) return invalid(res, 'mediaId');
  return rpc(req, res, 'restore_inventory_media', { p_media_id: mediaId });
}));

/**
 * Permanent removal. The bytes go first through the Storage API — SQL never
 * deletes storage objects — and only a confirmed removal is recorded. If
 * storage refuses, the metadata is left untouched and the disagreement is
 * surfaced by reconciliation rather than assumed away.
 */
router.post('/:mediaId/purge', requireOwner, asyncRoute(async (req, res) => {
  const { client, workspaceId } = ctx(req);
  const mediaId = asUuid(req.params.mediaId);
  const storagePath = asText(body(req).storagePath, 400);
  if (!mediaId) return invalid(res, 'mediaId');
  if (!storagePath) return invalid(res, 'storagePath');
  if (!pathsBelongToWorkspace([storagePath], workspaceId)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const removal = await client.storage.from(MEDIA_BUCKET).remove([storagePath]);
  if (removal.error) return dbFailure(res, removal.error.message);
  return rpc(req, res, 'purge_inventory_media', { p_media_id: mediaId });
}));

// ---- issues ----------------------------------------------------------------

router.get('/issues', requireMember, asyncRoute(async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : 'open';
  if (!['open', 'resolved', 'dismissed', 'all'].includes(state)) return invalid(res, 'state');
  return rpc(req, res, 'list_inventory_media_issues', { p_state: state === 'all' ? null : state });
}));

/**
 * Reconciliation walks the workspace's storage folder and hands the observed
 * object list to the governed function, which records disagreements. Nothing
 * is deleted. When the listing cannot be read, the storage-dependent checks
 * are skipped rather than guessed at.
 */
router.post('/issues/reconcile', requireOperator, asyncRoute(async (req, res) => {
  const { client, workspaceId } = ctx(req);
  const bucket = client.storage.from(MEDIA_BUCKET);
  const MAX_SUBJECTS = 500, MAX_FILES = 1000;
  let paths: string[] | null = [];
  let truncated = false;

  const folders = await bucket.list(workspaceId, { limit: MAX_SUBJECTS });
  if (folders.error) {
    paths = null; // listing unavailable — report rather than infer absence
  } else {
    truncated = (folders.data ?? []).length >= MAX_SUBJECTS;
    for (const folder of folders.data ?? []) {
      if (!folder?.name) continue;
      const files = await bucket.list(`${workspaceId}/${folder.name}`, { limit: MAX_FILES });
      if (files.error) { paths = null; break; }
      if ((files.data ?? []).length >= MAX_FILES) truncated = true;
      for (const file of files.data ?? []) {
        if (file?.name) paths.push(`${workspaceId}/${folder.name}/${file.name}`);
      }
    }
  }

  // A truncated listing would make present objects look absent, so the
  // storage-dependent checks are skipped rather than raising false orphans.
  const listing = truncated ? null : paths;

  const { data, error } = await client.rpc('reconcile_inventory_media' as never, {
    p_workspace_id: workspaceId, p_storage_paths: listing, p_stale_upload_minutes: 60,
  } as never);
  if (error) return dbFailure(res, error.message);
  res.json({ ...(data as Record<string, unknown>), truncated });
}));

router.post('/issues/:issueId/resolve', requireOperator, asyncRoute(async (req, res) => {
  const issueId = asUuid(req.params.issueId);
  const b = body(req);
  const state = b.state === 'dismissed' ? 'dismissed' : 'resolved';
  if (!issueId) return invalid(res, 'issueId');
  return rpc(req, res, 'resolve_inventory_media_issue', {
    p_issue_id: issueId, p_state: state, p_note: asText(b.note, 300),
  });
}));

export default router;
