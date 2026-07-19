// Phase 3 provenance route tests.
//
// Verifies the safe default (every route 404s with the flag absent), the
// enabled behavior, that commit plans demand an idempotency key at the HTTP
// boundary, and that no route can create a canonical business entity.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const { default: provenanceRouter } = await import('./provenance.js');

function startServer(): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/provenance', provenanceRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

let server: Server;
let base: string;

beforeAll(async () => {
  const started = await startServer();
  server = started.server;
  base = started.base;
});

afterAll(() => {
  server?.close();
});

function enable() {
  process.env.SHADOW_IMPORT = 'repository-fixtures';
}
function disable() {
  delete process.env.SHADOW_IMPORT;
}

const ROUTES: ReadonlyArray<[string, string, unknown]> = [
  ['GET', '/api/provenance/fixtures', undefined],
  ['POST', '/api/provenance/preview', { filename: 'checks.json' }],
  ['POST', '/api/provenance/preview/records', { filename: 'checks.json' }],
  ['POST', '/api/provenance/preview/issues', { filename: 'checks.json' }],
  ['POST', '/api/provenance/preview/crosswalks', { filename: 'checks.json' }],
  ['POST', '/api/provenance/commit-plan', { filename: 'checks.json', idempotencyKey: 'k-0000001' }],
];

async function call(method: string, path: string, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('safe default: the provenance surface is unavailable when unconfigured', () => {
  beforeAll(() => disable());

  for (const [method, path, body] of ROUTES) {
    it(`${method} ${path} responds 404 with the flag absent`, async () => {
      disable();
      const res = await call(method, path, body);
      expect(res.status).toBe(404);
    });
  }

  it('does not advertise that the surface exists', async () => {
    disable();
    const res = await call('GET', '/api/provenance/fixtures');
    const json = await res.json();
    expect(json).toEqual({ error: 'not found' });
    expect(JSON.stringify(json)).not.toMatch(/provenance|shadow|import/i);
  });

  it('stays disabled for a truthy-but-wrong flag value', async () => {
    process.env.SHADOW_IMPORT = 'true';
    const res = await call('GET', '/api/provenance/fixtures');
    expect(res.status).toBe(404);
    disable();
  });
});

describe('enabled behavior', () => {
  beforeAll(() => enable());
  afterAll(() => disable());

  it('lists only repository fixtures and labels itself non-authoritative', async () => {
    const res = await call('GET', '/api/provenance/fixtures');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.staging).toBe(true);
    expect(json.authoritative).toBe(false);
    expect(Array.isArray(json.fixtures)).toBe(true);
    expect(json.fixtures.map((f: { filename: string }) => f.filename)).toContain(
      'whatnot_purchases.json'
    );
  });

  it('previews the Whatnot fixture with 2,149 rows and a stable hash', async () => {
    const res = await call('POST', '/api/provenance/preview', {
      filename: 'whatnot_purchases.json',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sourceRowCount).toBe(2149);
    expect(json.fileSha256).toBe(
      '71c55d607191c8f0a4e3d6858ef6bbe1217880602ba96f92757e9dabca8367cd'
    );
    expect(json.committed).toBe(false);
    expect(json.authoritative).toBe(false);
  });

  it('preview commits nothing', async () => {
    const res = await call('POST', '/api/provenance/preview', { filename: 'checks.json' });
    const json = await res.json();
    expect(json.mode).toBe('preview');
    expect(json.committed).toBe(false);
    expect(json.note).toMatch(/no provenance record was created or modified/i);
  });

  it('paginates raw records rather than dumping thousands', async () => {
    const res = await call('POST', '/api/provenance/preview/records', {
      filename: 'whatnot_purchases.json',
      limit: 5,
    });
    const json = await res.json();
    expect(json.total).toBe(2149);
    expect(json.records).toHaveLength(5);
    expect(json.records[0].rawPayload.acquisition_line_id).toBe('WN-A-000001');
  });

  it('caps an oversized page request', async () => {
    const res = await call('POST', '/api/provenance/preview/records', {
      filename: 'whatnot_purchases.json',
      limit: 100000,
    });
    const json = await res.json();
    expect(json.records.length).toBeLessThanOrEqual(200);
  });

  it('returns crosswalk candidates that are all in candidate state', async () => {
    const res = await call('POST', '/api/provenance/preview/crosswalks', {
      filename: 'whatnot_purchases.json',
    });
    const json = await res.json();
    expect(json.total).toBeGreaterThan(0);
    for (const c of json.crosswalks) {
      expect(c.reviewState).toBe('candidate');
    }
  });

  it('returns issues that retain their raw payload', async () => {
    const res = await call('POST', '/api/provenance/preview/issues', {
      filename: 'whatnot_purchases.json',
    });
    const json = await res.json();
    const dup = json.issues.find(
      (i: { issueType: string }) => i.issueType === 'duplicate_candidate'
    );
    expect(dup).toBeDefined();
    expect(dup.rawPayloadSnapshot).toBeTruthy();
  });

  it('refuses a commit plan without an idempotency key', async () => {
    const res = await call('POST', '/api/provenance/commit-plan', {
      filename: 'checks.json',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/idempotency key/i);
  });

  it('refuses a commit plan with too short an idempotency key', async () => {
    const res = await call('POST', '/api/provenance/commit-plan', {
      filename: 'checks.json',
      idempotencyKey: 'abc',
    });
    expect(res.status).toBe(400);
  });

  it('accepts a commit plan with a valid idempotency key', async () => {
    const res = await call('POST', '/api/provenance/commit-plan', {
      filename: 'checks.json',
      idempotencyKey: 'commit-key-0001',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe('commit');
    expect(json.idempotencyKey).toBe('commit-key-0001');
  });

  it('refuses an unknown fixture', async () => {
    const res = await call('POST', '/api/provenance/preview', { filename: 'secrets.json' });
    expect(res.status).toBe(404);
  });

  it('refuses path traversal without leaking a filesystem path', async () => {
    const res = await call('POST', '/api/provenance/preview', {
      filename: '../../../etc/passwd',
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).not.toMatch(/\/home|\/etc|seed/);
  });

  it('offers no endpoint that creates a canonical acquisition or inventory record', async () => {
    for (const path of [
      '/api/provenance/acquisitions',
      '/api/provenance/inventory',
      '/api/provenance/commit',
    ]) {
      const res = await call('POST', path, { filename: 'checks.json' });
      expect(res.status).toBe(404);
    }
  });
});
