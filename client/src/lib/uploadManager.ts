// Multi-file upload manager.
//
// Photographing inventory happens on a phone in a warehouse, so the failure
// modes are ordinary: one file in five fails, the connection drops mid-batch,
// the response to a commit never arrives. The manager therefore tracks every
// file independently — a batch never fails as a unit — and keeps enough state
// that a retry resumes where the file stopped instead of starting over.
//
// A file is complete only when BOTH the bytes and the governed commit
// succeeded. The two half-failures are distinguished so the operator is told
// which one happened rather than "upload failed".
//
// The transport, hashing, byte transfer and id generation are all injected, so
// the whole state machine is testable without a browser.

import type { MediaTransport, SubjectKind } from './mediaApi';

export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
] as const;
export const MAX_BYTE_SIZE = 20971520;

export type UploadStage =
  | 'queued' | 'hashing' | 'reserving' | 'uploading' | 'committing'
  | 'done' | 'failed' | 'cancelled';

/**
 * Where a file stopped. `bytes` means the metadata was saved but the image did
 * not arrive; `commit` means the image arrived but was never made part of the
 * record. Both are recoverable, and the operator sees which is which.
 */
export type FailureKind = 'validation' | 'metadata' | 'bytes' | 'commit' | null;

export interface UploadSource {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

export interface UploadTask {
  readonly id: string;
  readonly source: UploadSource;
  readonly stage: UploadStage;
  readonly progress: number;
  readonly error: string | null;
  readonly failureKind: FailureKind;
  readonly mediaId: string | null;
  readonly bytesUploaded: boolean;
  readonly duplicateOf: string | null;
  readonly idempotencyKey: string;
  readonly slotKey: string | null;
  readonly slotLabel: string | null;
}

export interface UploadBytesArgs {
  readonly signedUrl: string;
  readonly token: string | null;
  readonly path: string;
  readonly source: UploadSource;
  readonly onProgress: (fraction: number) => void;
  readonly signal: AbortSignal;
}

export interface UploadManagerOptions {
  readonly transport: MediaTransport;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly uploadBytes: (args: UploadBytesArgs) => Promise<void>;
  readonly onChange: (tasks: readonly UploadTask[]) => void;
  readonly concurrency?: number;
  readonly hashFile?: (source: UploadSource) => Promise<string | null>;
  readonly newId?: () => string;
  readonly onCommitted?: () => void;
}

export interface UploadManager {
  enqueue(sources: readonly UploadSource[], slot?: { slotKey: string | null; slotLabel: string | null }): void;
  retry(taskId: string): void;
  retryFailed(): void;
  cancel(taskId: string): void;
  cancelAll(): void;
  clearFinished(): void;
  tasks(): readonly UploadTask[];
  idle(): Promise<void>;
}

export function validateUploadSource(source: UploadSource): string | null {
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(source.type)) {
    return 'Only JPEG, PNG, WebP or HEIC photos can be uploaded.';
  }
  if (source.size <= 0) return 'That file is empty.';
  if (source.size > MAX_BYTE_SIZE) return 'Photos must be 20 MB or smaller.';
  return null;
}

function randomId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function createUploadManager(options: UploadManagerOptions): UploadManager {
  const {
    transport, subjectKind, subjectId, uploadBytes, onChange,
    concurrency = 3, hashFile, newId = randomId, onCommitted,
  } = options;

  const tasks = new Map<string, UploadTask>();
  const controllers = new Map<string, AbortController>();
  let running = 0;
  let settle: (() => void) | null = null;
  let idlePromise: Promise<void> = Promise.resolve();

  const snapshot = () => [...tasks.values()];
  const publish = () => onChange(snapshot());

  function patch(id: string, changes: Partial<UploadTask>): void {
    const current = tasks.get(id);
    if (!current) return;
    tasks.set(id, { ...current, ...changes });
    publish();
  }

  function markBusy(): void {
    if (settle) return;
    idlePromise = new Promise<void>((resolve) => { settle = resolve; });
  }

  function maybeIdle(): void {
    const pending = snapshot().some((t) => t.stage !== 'done' && t.stage !== 'failed' && t.stage !== 'cancelled');
    if (!pending && running === 0 && settle) { settle(); settle = null; }
  }

  async function run(task: UploadTask): Promise<void> {
    const controller = new AbortController();
    controllers.set(task.id, controller);
    try {
      let contentHash: string | null = null;
      if (hashFile && !task.bytesUploaded) {
        patch(task.id, { stage: 'hashing' });
        try { contentHash = await hashFile(task.source); } catch { contentHash = null; }
      }
      if (controller.signal.aborted) return;

      patch(task.id, { stage: 'reserving', error: null, failureKind: null });
      let reservation;
      try {
        // The same idempotency key on every attempt: a replay after a lost
        // response resolves to the original reservation instead of a duplicate.
        reservation = await transport.reserve({
          subjectKind, subjectId,
          contentType: task.source.type,
          byteSize: task.source.size,
          idempotencyKey: task.idempotencyKey,
          originalFilename: task.source.name,
          contentHash,
          slotKey: task.slotKey,
          slotLabel: task.slotLabel,
        });
      } catch (e) {
        patch(task.id, { stage: 'failed', failureKind: 'metadata', error: (e as Error).message });
        return;
      }
      if (controller.signal.aborted) return;

      patch(task.id, {
        mediaId: reservation.media_id,
        duplicateOf: reservation.duplicate_of ?? null,
      });

      // The bytes for this reservation already landed and were committed.
      if (reservation.lifecycle === 'active') {
        patch(task.id, { stage: 'done', progress: 1, bytesUploaded: true });
        onCommitted?.();
        return;
      }

      const current = tasks.get(task.id);
      if (!current?.bytesUploaded) {
        const upload = reservation.upload;
        if (!upload?.signedUrl) {
          patch(task.id, { stage: 'failed', failureKind: 'bytes', error: 'No upload location was issued for this photo.' });
          return;
        }
        patch(task.id, { stage: 'uploading', progress: 0 });
        try {
          await uploadBytes({
            signedUrl: upload.signedUrl,
            token: upload.token,
            path: upload.path,
            source: task.source,
            onProgress: (fraction) => patch(task.id, { progress: Math.max(0, Math.min(1, fraction)) }),
            signal: controller.signal,
          });
        } catch (e) {
          if (controller.signal.aborted) return;
          // Metadata is saved; the image is not there yet. Retrying resumes
          // from here rather than creating a second record.
          patch(task.id, { stage: 'failed', failureKind: 'bytes', progress: 0, error: (e as Error).message });
          return;
        }
        patch(task.id, { bytesUploaded: true, progress: 1 });
      }
      if (controller.signal.aborted) return;

      patch(task.id, { stage: 'committing' });
      try {
        await transport.commit(reservation.media_id);
      } catch (e) {
        // The image is stored but is not part of the record yet. Retrying only
        // re-commits; it never re-sends the bytes.
        patch(task.id, { stage: 'failed', failureKind: 'commit', error: (e as Error).message });
        return;
      }
      patch(task.id, { stage: 'done', progress: 1, error: null, failureKind: null });
      onCommitted?.();
    } finally {
      controllers.delete(task.id);
    }
  }

  function pump(): void {
    while (running < concurrency) {
      const next = snapshot().find((t) => t.stage === 'queued');
      if (!next) break;
      running += 1;
      patch(next.id, { stage: 'reserving' });
      void run(tasks.get(next.id)!)
        .catch(() => patch(next.id, { stage: 'failed', failureKind: 'metadata', error: 'Unexpected upload failure.' }))
        .finally(() => { running -= 1; maybeIdle(); pump(); });
    }
    maybeIdle();
  }

  return {
    enqueue(sources, slot) {
      for (const source of sources) {
        const id = newId();
        const problem = validateUploadSource(source);
        tasks.set(id, {
          id, source,
          stage: problem ? 'failed' : 'queued',
          progress: 0,
          error: problem,
          failureKind: problem ? 'validation' : null,
          mediaId: null,
          bytesUploaded: false,
          duplicateOf: null,
          idempotencyKey: newId(),
          slotKey: slot?.slotKey ?? null,
          slotLabel: slot?.slotLabel ?? null,
        });
      }
      publish();
      markBusy();
      pump();
    },

    retry(taskId) {
      const task = tasks.get(taskId);
      // A file rejected by validation cannot be retried into acceptance.
      if (!task || task.stage !== 'failed' || task.failureKind === 'validation') return;
      patch(taskId, { stage: 'queued', error: null, failureKind: null });
      markBusy();
      pump();
    },

    retryFailed() {
      for (const task of snapshot()) {
        if (task.stage === 'failed' && task.failureKind !== 'validation') {
          patch(task.id, { stage: 'queued', error: null, failureKind: null });
        }
      }
      markBusy();
      pump();
    },

    cancel(taskId) {
      const task = tasks.get(taskId);
      if (!task || task.stage === 'done' || task.stage === 'cancelled') return;
      controllers.get(taskId)?.abort();
      patch(taskId, { stage: 'cancelled', error: null, failureKind: null });
      // A reservation that will never be completed is retired so it does not
      // linger as a pending upload; failure to do so is picked up by
      // reconciliation rather than blocking the operator.
      if (task.mediaId) void transport.abandon(task.mediaId, 'cancelled by operator').catch(() => undefined);
      maybeIdle();
      pump();
    },

    cancelAll() {
      for (const task of snapshot()) this.cancel(task.id);
    },

    clearFinished() {
      for (const task of snapshot()) {
        if (task.stage === 'done' || task.stage === 'cancelled') tasks.delete(task.id);
      }
      publish();
    },

    tasks: snapshot,
    idle: () => idlePromise,
  };
}

/**
 * Browser byte transfer. XHR rather than fetch because it is the only way to
 * observe upload progress, which is the difference between a usable and an
 * unusable experience on a slow warehouse connection.
 */
export function createXhrUploader(): (args: UploadBytesArgs) => Promise<void> {
  return ({ signedUrl, source, onProgress, signal }) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', signedUrl, true);
      xhr.setRequestHeader('content-type', source.type);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`The photo could not be stored (${xhr.status}).`)));
      xhr.onerror = () => reject(new Error('The connection dropped while sending this photo.'));
      xhr.ontimeout = () => reject(new Error('Sending this photo timed out.'));
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(source as unknown as Blob);
    });
}

/** SHA-256 of the file bytes, used only to warn about duplicate content. */
export function createSubtleHasher(): (source: UploadSource) => Promise<string | null> {
  return async (source) => {
    const subtle = globalThis.crypto?.subtle;
    const blob = source as unknown as Blob;
    if (!subtle || typeof blob.arrayBuffer !== 'function') return null;
    const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
}
