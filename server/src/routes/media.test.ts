import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { setCallerClientFactoryForTests } from '../provenance/auth.js';
const { default: router } = await import('./media.js');

const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_WS = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SUBJECT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MEDIA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const KEY = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const identities: Record<string, { id: string; role?: string }> = {
  owner: { id: 'owner', role: 'owner' },
  operator: { id: 'operator', role: 'operator' },
  viewer: { id: 'viewer', role: 'viewer' },
  stranger: { id: 'stranger' },
};

let calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let storageCalls: Array<{ op: string; arg: unknown }> = [];
let reserveLifecycle = 'reserved';
let signedUploadFails = false;
let listFails = false;

function fake(token: string) {
  const who = identities[token];
  const members = who?.role ? [{ role: who.role }] : [];
  return {
    auth: {
      getUser: async () => (who
        ? { data: { user: { id: who.id } }, error: null }
        : { data: { user: null }, error: { message: 'bad' } }),
    },
    from() {
      const q: Record<string, unknown> = {};
      const result = { data: members, error: null };
      Object.assign(q, {
        select: () => q, eq: () => q, order: async () => result, limit: async () => result,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result)),
      });
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'reserve_inventory_media') {
        return { data: { outcome: 'reserved', media_id: MEDIA, storage_path: `${WS}/${SUBJECT}/x.jpg`, lifecycle: reserveLifecycle }, error: null };
      }
      return { data: { outcome: 'ok' }, error: null };
    },
    storage: {
      from() {
        return {
          createSignedUploadUrl: async (path: string) => {
            storageCalls.push({ op: 'createSignedUploadUrl', arg: path });
            return signedUploadFails
              ? { data: null, error: { message: 'storage refused' } }
              : { data: { signedUrl: 'https://signed.example/upload', token: 'tok', path }, error: null };
          },
          createSignedUrls: async (paths: string[]) => {
            storageCalls.push({ op: 'createSignedUrls', arg: paths });
            return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}`, error: null })), error: null };
          },
          list: async (prefix: string) => {
            storageCalls.push({ op: 'list', arg: prefix });
            if (listFails) return { data: null, error: { message: 'no listing' } };
            return prefix === WS
              ? { data: [{ name: SUBJECT }], error: null }
              : { data: [{ name: 'x.jpg' }], error: null };
          },
          remove: async (paths: string[]) => {
            storageCalls.push({ op: 'remove', arg: paths });
            return { data: null, error: null };
          },
        };
      },
    },
  };
}

let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/media', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const a = server.address();
      base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
      resolve();
    });
  });
  setCallerClientFactoryForTests((t) => fake(t) as never);
});
afterAll(() => { server.close(); setCallerClientFactoryForTests(null); });
beforeEach(() => {
  calls = []; storageCalls = []; reserveLifecycle = 'reserved';
  signedUploadFails = false; listFails = false;
  process.env.SHADOW_IMPORT = 'repository-fixtures';
  process.env.SUPABASE_URL = 'http://127.0.0.1';
  process.env.SUPABASE_ANON_KEY = 'test';
});

async function call(method: string, path: string, token?: string, b?: unknown) {
  return fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(b ? { 'content-type': 'application/json' } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
}
const reserveBody = {
  workspaceId: WS, subjectKind: 'item', subjectId: SUBJECT,
  contentType: 'image/jpeg', byteSize: 1024, idempotencyKey: KEY,
};

describe('media routes', () => {
  it('is absent when shadow surfaces are disabled', async () => {
    delete process.env.SHADOW_IMPORT;
    expect((await call('GET', `/api/media?workspaceId=${WS}&subjectKind=item&subjectId=${SUBJECT}`, 'owner')).status).toBe(404);
  });

  it('requires authentication and membership', async () => {
    expect((await call('GET', `/api/media?workspaceId=${WS}&subjectKind=item&subjectId=${SUBJECT}`)).status).toBe(401);
    expect((await call('GET', `/api/media?workspaceId=${WS}&subjectKind=item&subjectId=${SUBJECT}`, 'stranger')).status).toBe(403);
  });

  it('lets a viewer read the gallery but never change it', async () => {
    expect((await call('GET', `/api/media?workspaceId=${WS}&subjectKind=item&subjectId=${SUBJECT}`, 'viewer')).status).toBe(200);
    expect((await call('GET', `/api/media/readiness?workspaceId=${WS}&subjectKind=item&subjectId=${SUBJECT}`, 'viewer')).status).toBe(200);
    expect((await call('POST', '/api/media/uploads/reserve', 'viewer', reserveBody)).status).toBe(403);
    expect((await call('DELETE', `/api/media/${MEDIA}`, 'viewer', { workspaceId: WS })).status).toBe(403);
  });

  it('reserves a governed path and hands back a signed upload url', async () => {
    const response = await call('POST', '/api/media/uploads/reserve', 'operator', reserveBody);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.media_id).toBe(MEDIA);
    expect(payload.upload.signedUrl).toBe('https://signed.example/upload');
    expect(calls[0]).toMatchObject({
      fn: 'reserve_inventory_media',
      args: { p_workspace_id: WS, p_subject_id: SUBJECT, p_idempotency_key: KEY, p_content_type: 'image/jpeg' },
    });
  });

  it('rejects unsupported types, impossible sizes and missing retry keys', async () => {
    for (const [patch, field] of [
      [{ contentType: 'application/pdf' }, 'contentType'],
      [{ byteSize: 0 }, 'byteSize'],
      [{ byteSize: 20971521 }, 'byteSize'],
      [{ idempotencyKey: 'not-a-uuid' }, 'idempotencyKey'],
    ] as const) {
      const response = await call('POST', '/api/media/uploads/reserve', 'operator', { ...reserveBody, ...patch });
      expect(response.status).toBe(422);
      expect((await response.json()).field).toBe(field);
    }
  });

  it('does not reissue an upload url for a reservation whose bytes already landed', async () => {
    reserveLifecycle = 'active';
    const payload = await (await call('POST', '/api/media/uploads/reserve', 'operator', reserveBody)).json();
    expect(payload.upload).toBeNull();
    expect(storageCalls.find((c) => c.op === 'createSignedUploadUrl')).toBeUndefined();
  });

  it('retires the reservation when no upload url can be issued', async () => {
    signedUploadFails = true;
    const response = await call('POST', '/api/media/uploads/reserve', 'operator', reserveBody);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(calls.map((c) => c.fn)).toContain('abandon_inventory_media');
  });

  it('mints display urls in one batch and refuses another workspace folder', async () => {
    const ok = await call('POST', '/api/media/signed-urls', 'viewer', { workspaceId: WS, paths: [`${WS}/${SUBJECT}/a.jpg`, `${WS}/${SUBJECT}/b.jpg`] });
    expect(ok.status).toBe(200);
    expect((await ok.json()).urls).toHaveLength(2);
    expect(storageCalls.filter((c) => c.op === 'createSignedUrls')).toHaveLength(1);

    const crossWorkspace = await call('POST', '/api/media/signed-urls', 'viewer', { workspaceId: WS, paths: [`${OTHER_WS}/${SUBJECT}/a.jpg`] });
    expect(crossWorkspace.status).toBe(403);
  });

  it('routes gallery operations to their governed functions', async () => {
    await call('POST', '/api/media/reorder', 'operator', { workspaceId: WS, subjectKind: 'item', subjectId: SUBJECT, mediaIds: [MEDIA] });
    await call('POST', `/api/media/${MEDIA}/primary`, 'operator', { workspaceId: WS });
    await call('POST', `/api/media/${MEDIA}/rotate`, 'operator', { workspaceId: WS, deltaDegrees: 90 });
    await call('DELETE', `/api/media/${MEDIA}`, 'operator', { workspaceId: WS, reason: 'blurry' });
    await call('POST', `/api/media/${MEDIA}/restore`, 'operator', { workspaceId: WS });
    expect(calls.map((c) => c.fn)).toEqual([
      'reorder_inventory_media', 'set_primary_inventory_media', 'rotate_inventory_media',
      'soft_delete_inventory_media', 'restore_inventory_media',
    ]);
  });

  it('refuses a rotation that is not a quarter turn', async () => {
    const response = await call('POST', `/api/media/${MEDIA}/rotate`, 'operator', { workspaceId: WS, deltaDegrees: 45 });
    expect(response.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('keeps purge owner-only and removes the bytes before recording it', async () => {
    const storagePath = `${WS}/${SUBJECT}/x.jpg`;
    expect((await call('POST', `/api/media/${MEDIA}/purge`, 'operator', { workspaceId: WS, storagePath })).status).toBe(403);
    const response = await call('POST', `/api/media/${MEDIA}/purge`, 'owner', { workspaceId: WS, storagePath });
    expect(response.status).toBe(200);
    expect(storageCalls.find((c) => c.op === 'remove')).toBeTruthy();
    expect(calls.map((c) => c.fn)).toEqual(['purge_inventory_media']);
  });

  it('reconciles against the observed storage listing', async () => {
    const response = await call('POST', '/api/media/issues/reconcile', 'operator', { workspaceId: WS });
    expect(response.status).toBe(200);
    expect(calls[0]).toMatchObject({
      fn: 'reconcile_inventory_media',
      args: { p_storage_paths: [`${WS}/${SUBJECT}/x.jpg`] },
    });
  });

  it('skips storage-dependent checks rather than inventing orphans when the listing fails', async () => {
    listFails = true;
    const response = await call('POST', '/api/media/issues/reconcile', 'operator', { workspaceId: WS });
    expect(response.status).toBe(200);
    expect(calls[0].args.p_storage_paths).toBeNull();
  });
});
