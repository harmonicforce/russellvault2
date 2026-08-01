import { describe, expect, it, vi } from 'vitest';
import { createUploadManager, validateUploadSource, type UploadSource, type UploadTask } from './uploadManager';
import type { MediaTransport } from './mediaApi';

const jpeg = (name: string, size = 1024): UploadSource => ({ name, size, type: 'image/jpeg' });

interface Harness {
  transport: MediaTransport;
  reserved: string[];
  committed: string[];
  abandoned: string[];
  uploads: string[];
  inFlight: { max: number };
}

function harness(overrides: {
  failUploadFor?: (name: string) => boolean;
  failCommitOnce?: boolean;
  reserveLifecycle?: (key: string) => 'reserved' | 'active';
  uploadDelayMs?: number;
} = {}): Harness {
  const reserved: string[] = [], committed: string[] = [], abandoned: string[] = [], uploads: string[] = [];
  const inFlight = { max: 0 };
  let current = 0;
  let commitFailures = overrides.failCommitOnce ? 1 : 0;
  const keyToMedia = new Map<string, string>();

  const transport = {
    async reserve(input: { idempotencyKey: string; originalFilename?: string | null }) {
      reserved.push(input.idempotencyKey);
      // The governed function resolves a repeated key to the same media row.
      const mediaId = keyToMedia.get(input.idempotencyKey) ?? `media-${keyToMedia.size + 1}`;
      keyToMedia.set(input.idempotencyKey, mediaId);
      const lifecycle = overrides.reserveLifecycle?.(input.idempotencyKey) ?? 'reserved';
      return {
        outcome: reserved.filter((k) => k === input.idempotencyKey).length > 1 ? 'replay' : 'reserved',
        media_id: mediaId,
        storage_path: `ws/subject/${mediaId}.jpg`,
        lifecycle,
        duplicate_of: null,
        upload: lifecycle === 'active' ? null : { signedUrl: `https://up/${mediaId}`, token: 't', path: `ws/subject/${mediaId}.jpg` },
      };
    },
    async commit(mediaId: string) {
      if (commitFailures > 0) { commitFailures -= 1; throw new Error('commit response lost'); }
      committed.push(mediaId);
      return {};
    },
    async abandon(mediaId: string) { abandoned.push(mediaId); return {}; },
  } as unknown as MediaTransport;

  const uploadBytes = async ({ source, onProgress }: { source: UploadSource; onProgress: (n: number) => void }) => {
    current += 1;
    inFlight.max = Math.max(inFlight.max, current);
    try {
      if (overrides.uploadDelayMs) await new Promise((r) => setTimeout(r, overrides.uploadDelayMs));
      if (overrides.failUploadFor?.(source.name)) throw new Error('the connection dropped');
      onProgress(0.5);
      onProgress(1);
      uploads.push(source.name);
    } finally { current -= 1; }
  };

  return { transport, reserved, committed, abandoned, uploads, inFlight, uploadBytes } as unknown as Harness & { uploadBytes: typeof uploadBytes };
}

function manager(h: ReturnType<typeof harness> & { uploadBytes?: unknown }, opts: Record<string, unknown> = {}) {
  let latest: readonly UploadTask[] = [];
  let n = 0;
  const m = createUploadManager({
    transport: h.transport,
    subjectKind: 'item',
    subjectId: 'subject-1',
    uploadBytes: (h as unknown as { uploadBytes: never }).uploadBytes,
    onChange: (tasks) => { latest = tasks; },
    newId: () => `id-${++n}`,
    ...opts,
  });
  return { m, tasks: () => latest };
}

describe('upload manager', () => {
  it('rejects files the governed contract cannot accept', () => {
    expect(validateUploadSource({ name: 'a.pdf', size: 10, type: 'application/pdf' })).toMatch(/JPEG/);
    expect(validateUploadSource({ name: 'a.jpg', size: 0, type: 'image/jpeg' })).toMatch(/empty/);
    expect(validateUploadSource({ name: 'a.jpg', size: 20971521, type: 'image/jpeg' })).toMatch(/20 MB/);
    expect(validateUploadSource(jpeg('a.jpg'))).toBeNull();
  });

  it('marks an invalid file failed without contacting the server, and will not retry it', async () => {
    const h = harness();
    const { m, tasks } = manager(h);
    m.enqueue([{ name: 'a.pdf', size: 10, type: 'application/pdf' }]);
    await m.idle();
    expect(tasks()[0].stage).toBe('failed');
    expect(tasks()[0].failureKind).toBe('validation');
    expect(h.reserved).toHaveLength(0);
    m.retryFailed();
    await m.idle();
    expect(h.reserved).toHaveLength(0);
  });

  // Required scenario 1.
  it('uploads five files, fails one, and retries only the failed file', async () => {
    const h = harness({ failUploadFor: (name) => name === 'c.jpg' });
    const { m, tasks } = manager(h);
    m.enqueue(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'].map((n) => jpeg(n)));
    await m.idle();

    expect(tasks().filter((t) => t.stage === 'done')).toHaveLength(4);
    const failed = tasks().find((t) => t.stage === 'failed')!;
    expect(failed.source.name).toBe('c.jpg');
    // Metadata was saved; the bytes were not. The operator is told which.
    expect(failed.failureKind).toBe('bytes');
    expect(h.committed).toHaveLength(4);

    expect(h.uploads).toHaveLength(4);
    const reservedBefore = h.reserved.length;
    h.uploads.length = 0;

    // Retrying touches the failed file and nothing else. This harness keeps
    // failing that file, so the four successes must not be attempted again.
    m.retryFailed();
    await m.idle();

    expect(h.uploads).toEqual([]);
    expect(h.reserved.length - reservedBefore).toBe(1);
    expect(h.reserved.filter((k) => k === failed.idempotencyKey)).toHaveLength(2);
    expect(tasks().filter((t) => t.stage === 'done')).toHaveLength(4);
    expect(h.committed).toHaveLength(4);
  });

  // Required scenario 2.
  it('reuses the same retry key so a lost response never duplicates media', async () => {
    const h = harness({ failCommitOnce: true });
    const { m, tasks } = manager(h);
    m.enqueue([jpeg('a.jpg')]);
    await m.idle();

    const task = tasks()[0];
    expect(task.stage).toBe('failed');
    // The bytes are stored; only the commit was lost.
    expect(task.failureKind).toBe('commit');
    expect(task.bytesUploaded).toBe(true);
    const keyAfterFirst = task.idempotencyKey;

    m.retry(task.id);
    await m.idle();

    expect(tasks()[0].stage).toBe('done');
    expect(tasks()[0].idempotencyKey).toBe(keyAfterFirst);
    // Reserved twice with the SAME key, so the database resolved one row.
    expect(new Set(h.reserved).size).toBe(1);
    expect(h.committed).toEqual(['media-1']);
    // The bytes were sent once; the retry only re-committed.
    expect(h.uploads).toEqual(['a.jpg']);
  });

  it('treats a reservation whose bytes already landed as complete without re-sending them', async () => {
    const h = harness({ reserveLifecycle: () => 'active' });
    const { m, tasks } = manager(h);
    m.enqueue([jpeg('a.jpg')]);
    await m.idle();
    expect(tasks()[0].stage).toBe('done');
    expect(h.uploads).toEqual([]);
    expect(h.committed).toEqual([]);
  });

  it('holds concurrency to the configured bound', async () => {
    const h = harness({ uploadDelayMs: 5 });
    const { m } = manager(h, { concurrency: 2 });
    m.enqueue(['a', 'b', 'c', 'd', 'e', 'f'].map((n) => jpeg(`${n}.jpg`)));
    await m.idle();
    expect(h.inFlight.max).toBeLessThanOrEqual(2);
    expect(h.committed).toHaveLength(6);
  });

  it('cancels an in-flight file and retires its reservation', async () => {
    const h = harness({ uploadDelayMs: 20 });
    const { m, tasks } = manager(h);
    m.enqueue([jpeg('a.jpg')]);
    await new Promise((r) => setTimeout(r, 5));
    const id = tasks()[0].id;
    m.cancel(id);
    await m.idle();
    expect(tasks()[0].stage).toBe('cancelled');
    expect(h.committed).toEqual([]);
    await new Promise((r) => setTimeout(r, 5));
    expect(h.abandoned).toEqual(['media-1']);
  });

  it('reports per-file progress', async () => {
    const h = harness();
    const seen: number[] = [];
    const { m } = manager(h, { onChange: (tasks: readonly UploadTask[]) => { const t = tasks[0]; if (t) seen.push(t.progress); } });
    m.enqueue([jpeg('a.jpg')]);
    await m.idle();
    expect(seen).toContain(0.5);
    expect(seen.at(-1)).toBe(1);
  });

  it('surfaces a duplicate-content warning without blocking the upload', async () => {
    const h = harness();
    (h.transport as unknown as { reserve: unknown }).reserve = async (input: { idempotencyKey: string }) => ({
      outcome: 'reserved', media_id: 'media-9', storage_path: 'ws/s/media-9.jpg',
      lifecycle: 'reserved', duplicate_of: 'media-1',
      upload: { signedUrl: 'https://up/9', token: 't', path: 'ws/s/media-9.jpg' },
      key: input.idempotencyKey,
    });
    const { m, tasks } = manager(h);
    m.enqueue([jpeg('a.jpg')]);
    await m.idle();
    expect(tasks()[0].stage).toBe('done');
    expect(tasks()[0].duplicateOf).toBe('media-1');
  });

  it('passes the computed content hash to the governed reservation', async () => {
    const h = harness();
    const reserve = vi.spyOn(h.transport, 'reserve');
    const { m } = manager(h, { hashFile: async () => 'f'.repeat(64) });
    m.enqueue([jpeg('a.jpg')]);
    await m.idle();
    expect(reserve.mock.calls[0][0].contentHash).toBe('f'.repeat(64));
  });
});
