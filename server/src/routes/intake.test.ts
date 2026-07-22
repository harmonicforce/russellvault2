// Phase 6A intake kernel route tests. Cover the two gates reused from Phases
// 3-5 (availability 404; authentication 401; membership/role 403) and the
// success contract for the appropriate member. A fake Supabase client stands in
// for the shadow project so these run without Docker: it rejects unknown tokens,
// workspace_members returns rows only for real members (as RLS does), and every
// governed RPC returns a deterministic staging result.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { setCallerClientFactoryForTests } from '../provenance/auth.js';

const { default: intakeRouter } = await import('./intake.js');

const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GID = '11111111-1111-1111-1111-111111111111';
const SID = '22222222-2222-2222-2222-222222222222';
const LINE = '33333333-3333-3333-3333-333333333333';
const CAND = '44444444-4444-4444-4444-444444444444';

const TOKENS: Record<string, { userId: string; memberships: Record<string, string> }> = {
  'owner-token': { userId: 'u-owner', memberships: { [WS_A]: 'owner' } },
  'operator-token': { userId: 'u-operator', memberships: { [WS_A]: 'operator' } },
  'viewer-token': { userId: 'u-viewer', memberships: { [WS_A]: 'viewer' } },
  'stranger-token': { userId: 'u-stranger', memberships: {} },
  'other-ws-token': { userId: 'u-other', memberships: { [WS_B]: 'owner' } },
};

function makeFakeClient(token: string) {
  const identity = TOKENS[token];
  function rowsFor(table: string, filters: Record<string, string>): unknown[] {
    if (table === 'workspace_members') {
      const role = identity?.memberships[filters.workspace_id];
      return role ? [{ role }] : [];
    }
    if (table === 'intake_field_registry') {
      return [{ field_key: 'tcg_grading_company', scope: 'sku', is_identity_driving: true }];
    }
    if (table === 'intake_field_rules') {
      return [{ category: 'graded_tcg', field_key: 'tcg_grading_company', is_commit_blocker: true }];
    }
    return [];
  }
  return {
    auth: {
      getUser: async () =>
        identity
          ? { data: { user: { id: identity.userId } }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
    },
    from(table: string) {
      const filters: Record<string, string> = {};
      const result = () => ({ data: rowsFor(table, filters), error: null, count: 0 });
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: string) => {
          filters[c] = v;
          return q;
        },
        order: async () => result(),
        limit: async () => result(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(result())),
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      switch (fn) {
        case 'create_intake_session':
          return { data: { id: SID, public_id: 'RV-ISESS-TEST01', state: 'open' }, error: null };
        case 'resume_intake_session':
          return { data: { id: SID, state: 'open', group_counts: {} }, error: null };
        case 'abandon_intake_session':
          return { data: { id: SID, state: 'abandoned', changed: true }, error: null };
        case 'upsert_intake_group':
          return { data: { id: GID, public_id: 'RV-IG-TEST01', state: 'draft', version: 1 }, error: null };
        case 'upsert_intake_entry':
          return { data: { id: 'e1', public_id: 'RV-IE-TEST01', entry_index: args.p_entry_index }, error: null };
        case 'evaluate_intake_field_rules':
          return { data: { ready: false, blockers: [], rule_version: 'INTAKE_RULES_1' }, error: null };
        case 'validate_intake_readiness':
          return { data: { ready: true, blockers: [], version: 1 }, error: null };
        case 'transition_intake_group':
          return { data: { id: GID, state: args.p_target_state }, error: null };
        case 'attach_intake_candidate':
          return { data: { id: CAND, financial_effect: false }, error: null };
        case 'remove_intake_candidate':
          return { data: { id: CAND, removed: true }, error: null };
        case 'preview_intake_commit':
          return { data: { content_hash: 'a'.repeat(64), ready: true, would_create_sku: true }, error: null };
        case 'commit_intake_group':
          return {
            data: {
              outcome: 'committed', idempotent_replay: false, group_id: GID,
              lot_public_id: 'RV-I-0000000001', next_action: 'SOURCE_REVIEW_NEEDED', items: [],
            },
            error: null,
          };
        case 'get_intake_commit_receipt':
          return { data: { lot_public_id: 'RV-I-0000000001', next_action: 'SOURCE_REVIEW_NEEDED' }, error: null };
        default:
          return { data: {}, error: null };
      }
    },
  };
}

function startServer(): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/intake', intakeRouter);
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
  setCallerClientFactoryForTests((token) => makeFakeClient(token) as never);
});
afterAll(() => {
  server?.close();
  setCallerClientFactoryForTests(null);
});

function enable() {
  process.env.SHADOW_IMPORT = 'repository-fixtures';
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
}
function disable() {
  delete process.env.SHADOW_IMPORT;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
}

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

const commitBody = {
  workspaceId: WS_A, idempotencyKey: 'commit-key-0001', expectedVersion: 1, contentHash: 'a'.repeat(64),
};

const MEMBER_ROUTES: ReadonlyArray<[string, string, unknown]> = [
  ['GET', `/api/intake/session?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/intake/sessions/${SID}?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/intake/field-registry?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/intake/field-rules?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/intake/groups/${GID}/rules?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/intake/groups/${GID}/preview?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/intake/groups/${GID}/receipt?workspaceId=${WS_A}`, undefined],
  ['GET', `/api/intake/groups/${GID}/next-action?workspaceId=${WS_A}`, undefined],
];

const GROUP_BODY = {
  workspaceId: WS_A, sessionId: SID, category: 'raw_tcg', displayName: 'X', quantity: 1,
  trackingMode: 'lot_managed', serializedChildCount: 0, sourceState: 'stated',
};
const OPERATOR_ROUTES: ReadonlyArray<[string, string, unknown]> = [
  ['POST', '/api/intake/sessions', { workspaceId: WS_A, label: 's' }],
  ['POST', `/api/intake/sessions/${SID}/abandon`, { workspaceId: WS_A, reason: 'x' }],
  ['POST', '/api/intake/groups', GROUP_BODY],
  ['PATCH', `/api/intake/groups/${GID}`, GROUP_BODY],
  ['POST', `/api/intake/groups/${GID}/entries`, { workspaceId: WS_A, entryIndex: 1 }],
  ['POST', `/api/intake/groups/${GID}/readiness`, { workspaceId: WS_A }],
  ['POST', `/api/intake/groups/${GID}/transition`, { workspaceId: WS_A, targetState: 'abandoned' }],
  ['POST', `/api/intake/groups/${GID}/candidates`, { workspaceId: WS_A, acquisitionLineItemId: LINE }],
  ['DELETE', `/api/intake/candidates/${CAND}`, { workspaceId: WS_A }],
  ['POST', `/api/intake/groups/${GID}/commit`, commitBody],
];

describe('availability gate: unconfigured means 404', () => {
  beforeEach(() => disable());
  for (const [method, path, b] of [...MEMBER_ROUTES, ...OPERATOR_ROUTES]) {
    it(`${method} ${path.split('?')[0]} responds 404 with the flags absent`, async () => {
      const res = await call(method, path, { token: 'owner-token', body: b });
      expect(res.status).toBe(404);
    });
  }
});

describe('401: missing authentication', () => {
  beforeEach(() => enable());
  afterAll(() => disable());
  for (const [method, path, b] of [...MEMBER_ROUTES, ...OPERATOR_ROUTES]) {
    it(`${method} ${path.split('?')[0]} responds 401 without a token`, async () => {
      const res = await call(method, path, { body: b });
      expect(res.status).toBe(401);
    });
  }
});

describe('403: non-member, wrong workspace, and viewer on mutations', () => {
  beforeEach(() => enable());
  afterAll(() => disable());

  it('refuses an authenticated non-member on a read', async () => {
    const res = await call('GET', `/api/intake/session?workspaceId=${WS_A}`, { token: 'stranger-token' });
    expect(res.status).toBe(403);
  });
  it('refuses a member of a DIFFERENT workspace', async () => {
    const res = await call('GET', `/api/intake/session?workspaceId=${WS_A}`, { token: 'other-ws-token' });
    expect(res.status).toBe(403);
  });
  it('refuses a VIEWER on every operator route', async () => {
    for (const [method, path, b] of OPERATOR_ROUTES) {
      const res = await call(method, path, { token: 'viewer-token', body: b });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
  it('requires an explicit workspaceId', async () => {
    const res = await call('GET', '/api/intake/session', { token: 'owner-token' });
    expect(res.status).toBe(400);
  });
});

describe('success for the appropriate member', () => {
  beforeEach(() => enable());
  afterAll(() => disable());

  it('a viewer may read every member surface', async () => {
    for (const [method, path] of MEMBER_ROUTES) {
      const res = await call(method, path, { token: 'viewer-token' });
      expect(res.status, path).toBe(200);
      expect((await res.json()).staging).toBe(true);
    }
  });

  it('an operator opens a session and creates a draft group', async () => {
    const s = await call('POST', '/api/intake/sessions', { token: 'operator-token', body: { workspaceId: WS_A } });
    expect(s.status).toBe(200);
    expect((await s.json()).session.public_id).toBe('RV-ISESS-TEST01');
    const g = await call('POST', '/api/intake/groups', { token: 'operator-token', body: GROUP_BODY });
    expect(g.status).toBe(200);
    expect((await g.json()).group.state).toBe('draft');
  });

  it('an operator commit returns a structured committed result with an opaque lot id', async () => {
    const res = await call('POST', `/api/intake/groups/${GID}/commit`, {
      token: 'operator-token', body: commitBody,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.authoritative).toBe(false);
    expect(json.result.outcome).toBe('committed');
    expect(json.result.lot_public_id).toMatch(/^RV-I-\d{10}$/);
    expect(json.result.next_action).toBe('SOURCE_REVIEW_NEEDED');
  });

  it('attaching candidate evidence reports zero financial effect', async () => {
    const res = await call('POST', `/api/intake/groups/${GID}/candidates`, {
      token: 'operator-token', body: { workspaceId: WS_A, acquisitionLineItemId: LINE },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).candidate.financial_effect).toBe(false);
  });

  it('a malformed commit body (bad content hash) fails closed with 400', async () => {
    const res = await call('POST', `/api/intake/groups/${GID}/commit`, {
      token: 'operator-token',
      body: { workspaceId: WS_A, idempotencyKey: 'commit-key-0001', expectedVersion: 1, contentHash: 'nope' },
    });
    expect(res.status).toBe(400);
  });

  it('offers no endpoint that writes committed inventory outside the kernel', async () => {
    for (const path of ['/api/intake/inventory', '/api/intake/skus', '/api/intake/lots']) {
      const res = await call('POST', path, { token: 'owner-token', body: { workspaceId: WS_A } });
      expect(res.status).toBe(404);
    }
  });
});
