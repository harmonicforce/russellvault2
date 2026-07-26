// Phase 6A intake transport — proves the typed client uses the accepted
// /api/intake endpoints and response shapes (requirement 17), carries the
// caller's token + explicit workspace, and fixes the graded-slab workflow
// values without inventing product facts.
import { it, expect } from 'vitest';
import { createIntakeTransport, gradedGroupBody, type GradedGroupPayload } from './intakeApi';

interface Recorded { method: string; url: string; body: unknown }

function recordingFetch(response: unknown, status = 200) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const token = async () => 'test-token';

const PAYLOAD: GradedGroupPayload = {
  displayName: 'Charizard',
  productAttrs: { featured_subject: 'Charizard', set_name: 'Base Set', card_number: '4' },
  skuAttrs: { grading_company: 'CGC', numeric_grade: '9.5', product_format: 'Graded slab' },
  sourceEvidence: { source_kind: 'personal_collection' },
  locationCode: 'BIN-1',
};

it('gradedGroupBody fixes the graded-slab workflow values', () => {
  const body = gradedGroupBody(WS, 'sess-1', PAYLOAD);
  expect(body).toMatchObject({
    workspaceId: WS, sessionId: 'sess-1', category: 'graded_tcg',
    quantity: 1, trackingMode: 'serialized', serializedChildCount: 1,
  });
  expect(body.expectedVersion).toBeUndefined();
  expect(gradedGroupBody(WS, 'sess-1', PAYLOAD, 3).expectedVersion).toBe(3);
});

it('createSession POSTs /sessions with the workspace and a bearer token', async () => {
  const { fetchImpl, calls } = recordingFetch({ session: { id: 'sess-1', public_id: 'RV-ISESS-1', state: 'open' } });
  const t = createIntakeTransport(token, fetchImpl);
  const s = await t.createSession(WS, 'quick add');
  expect(s.public_id).toBe('RV-ISESS-1');
  expect(calls[0].method).toBe('POST');
  expect(calls[0].url).toBe('/api/intake/sessions');
  expect(calls[0].body).toEqual({ workspaceId: WS, label: 'quick add' });
});

it('createGradedGroup POSTs /groups; updateGroup PATCHes /groups/:id with expectedVersion', async () => {
  {
    const { fetchImpl, calls } = recordingFetch({ group: { id: 'g-1', public_id: 'RV-IG-1', state: 'draft', version: 1 } });
    const t = createIntakeTransport(token, fetchImpl);
    const g = await t.createGradedGroup(WS, 'sess-1', PAYLOAD);
    expect(g.version).toBe(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/intake/groups' });
    expect(calls[0].body).toMatchObject({ category: 'graded_tcg', quantity: 1, serializedChildCount: 1 });
  }
  {
    const { fetchImpl, calls } = recordingFetch({ group: { id: 'g-1', public_id: 'RV-IG-1', state: 'draft', version: 2 } });
    const t = createIntakeTransport(token, fetchImpl);
    await t.updateGroup(WS, 'g-1', 1, 'sess-1', PAYLOAD);
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: '/api/intake/groups/g-1' });
    expect((calls[0].body as { expectedVersion: number }).expectedVersion).toBe(1);
  }
});

it('upsertEntry POSTs /groups/:id/entries with entryIndex 1 and expectedVersion', async () => {
  const { fetchImpl, calls } = recordingFetch({ entry: { id: 'e-1', public_id: 'RV-IE-1', entry_index: 1, version: 3 } });
  const t = createIntakeTransport(token, fetchImpl);
  await t.upsertEntry(WS, 'g-1', 2, { gradingCompany: 'CGC', numericGrade: '9.5', gradeDesignation: null, certificateNumber: 'CGC-77001' });
  expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/intake/groups/g-1/entries' });
  expect(calls[0].body).toMatchObject({ workspaceId: WS, expectedVersion: 2, entryIndex: 1, certificateNumber: 'CGC-77001' });
});

it('preview and evaluateRules are GETs with the workspace in the query', async () => {
  {
    const { fetchImpl, calls } = recordingFetch({ preview: { content_hash: 'h', ready: true, blockers: [] } });
    const t = createIntakeTransport(token, fetchImpl);
    await t.preview(WS, 'g-1');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`/api/intake/groups/g-1/preview?workspaceId=${WS}`);
  }
  {
    const { fetchImpl, calls } = recordingFetch({ evaluation: { ready: false, blockers: [], rule_version: 'INTAKE_RULES_1' } });
    const t = createIntakeTransport(token, fetchImpl);
    await t.evaluateRules(WS, 'g-1');
    expect(calls[0].url).toBe(`/api/intake/groups/g-1/rules?workspaceId=${WS}`);
  }
});

it('commit POSTs /groups/:id/commit with idempotency key, version, and content hash', async () => {
  const { fetchImpl, calls } = recordingFetch({ result: { outcome: 'committed', idempotent_replay: false } });
  const t = createIntakeTransport(token, fetchImpl);
  await t.commit(WS, 'g-1', 'idem-1', 4, 'a'.repeat(64));
  expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/intake/groups/g-1/commit' });
  expect(calls[0].body).toEqual({ workspaceId: WS, idempotencyKey: 'idem-1', expectedVersion: 4, contentHash: 'a'.repeat(64) });
});

it('getReceipt GETs /groups/:id/receipt; abandonGroup POSTs a governed transition (never a delete)', async () => {
  {
    const { fetchImpl, calls } = recordingFetch({ receipt: { lot_public_id: 'RV-I-0000000001' } });
    const t = createIntakeTransport(token, fetchImpl);
    await t.getReceipt(WS, 'g-1');
    expect(calls[0].url).toBe(`/api/intake/groups/g-1/receipt?workspaceId=${WS}`);
  }
  {
    const { fetchImpl, calls } = recordingFetch({ transition: { state: 'abandoned' } });
    const t = createIntakeTransport(token, fetchImpl);
    await t.abandonGroup(WS, 'g-1', 'mis-scan');
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/intake/groups/g-1/transition' });
    expect(calls[0].body).toMatchObject({ workspaceId: WS, targetState: 'abandoned' });
  }
});

it('the transport exposes NO location-creation endpoint (client never mints a location)', () => {
  const t = createIntakeTransport(token, (async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response) as unknown as typeof fetch);
  expect(Object.keys(t)).not.toContain('createLocation');
  expect(Object.keys(t)).not.toContain('registerLocation');
});

it('a missing token fails closed before any request', async () => {
  const { fetchImpl, calls } = recordingFetch({});
  const t = createIntakeTransport(async () => null, fetchImpl);
  await expect(t.createSession(WS)).rejects.toThrow(/signed out/);
  expect(calls).toHaveLength(0);
});
