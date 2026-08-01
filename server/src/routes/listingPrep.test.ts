import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { setCallerClientFactoryForTests } from '../provenance/auth.js';
const { default: router } = await import('./listingPrep.js');

const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SUBJECT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PREP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PREP2 = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PRESET = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const PERSON = '11111111-2222-4333-8444-555555555555';

const identities: Record<string, { id: string; role?: string }> = {
  owner: { id: 'owner', role: 'owner' },
  operator: { id: 'operator', role: 'operator' },
  viewer: { id: 'viewer', role: 'viewer' },
  stranger: { id: 'stranger' },
};

let calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcError: string | null = null;

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
      if (rpcError) return { data: null, error: { message: rpcError } };
      return { data: { outcome: 'ok' }, error: null };
    },
  };
}

let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/listing-prep', router);
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
  calls = [];
  rpcError = null;
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

describe('listing prep routes', () => {
  it('is absent when shadow surfaces are disabled', async () => {
    delete process.env.SHADOW_IMPORT;
    expect((await call('GET', `/api/listing-prep?workspaceId=${WS}`, 'owner')).status).toBe(404);
  });

  it('requires authentication and membership', async () => {
    expect((await call('GET', `/api/listing-prep?workspaceId=${WS}`)).status).toBe(401);
    expect((await call('GET', `/api/listing-prep?workspaceId=${WS}`, 'stranger')).status).toBe(403);
  });

  it('gives a viewer every read and no mutation at all', async () => {
    for (const path of ['', '/summary', '/presets', `/${PREP}`, `/${PREP}/readiness`]) {
      expect((await call('GET', `/api/listing-prep${path}?workspaceId=${WS}`, 'viewer')).status).toBe(200);
    }
    const mutations: Array<[string, string, unknown]> = [
      ['POST', '', { workspaceId: WS, subjectKind: 'item', subjectId: SUBJECT }],
      ['PATCH', `/${PREP}/content`, { workspaceId: WS, content: { working_title: 'x' } }],
      ['POST', `/${PREP}/checks`, { workspaceId: WS, requirementKey: 'product_identity', state: 'confirmed' }],
      ['POST', `/${PREP}/assign`, { workspaceId: WS, assignedTo: PERSON }],
      ['POST', `/${PREP}/priority`, { workspaceId: WS, priority: 'high' }],
      ['POST', `/${PREP}/transition`, { workspaceId: WS, status: 'needs_review' }],
      ['POST', `/${PREP}/listed`, { workspaceId: WS, externalListingRef: 'ebay/1' }],
      ['POST', '/presets', { workspaceId: WS, name: 'Small box' }],
      ['POST', '/bulk', { workspaceId: WS, action: 'cancel', prepIds: [PREP] }],
    ];
    for (const [method, path, payload] of mutations) {
      expect((await call(method, `/api/listing-prep${path}`, 'viewer', payload)).status).toBe(403);
    }
  });

  it('starts a preparation for a named inventory record, never a raw guess', async () => {
    const response = await call('POST', '/api/listing-prep', 'operator', {
      workspaceId: WS, subjectKind: 'item', subjectId: SUBJECT, priority: 'high',
    });
    expect(response.status).toBe(200);
    expect(calls[0]).toMatchObject({
      fn: 'start_listing_prep',
      args: { p_workspace_id: WS, p_subject_kind: 'item', p_subject_id: SUBJECT, p_priority: 'high' },
    });
  });

  it('refuses a subject that is neither an item nor a lot', async () => {
    const response = await call('POST', '/api/listing-prep', 'operator', {
      workspaceId: WS, subjectKind: 'shipment', subjectId: SUBJECT,
    });
    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe('subjectKind');
    expect(calls).toHaveLength(0);
  });

  // Required scenario: money never becomes a float on the way to the database.
  it('rejects fractional money and names the field rather than rounding it', async () => {
    const response = await call('PATCH', `/api/listing-prep/${PREP}/content`, 'operator', {
      workspaceId: WS, content: { asking_price_minor: 1250.5 },
    });
    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe('asking_price_minor');
    expect(calls).toHaveLength(0);
  });

  it('rejects a price floor above the asking price', async () => {
    const response = await call('PATCH', `/api/listing-prep/${PREP}/content`, 'operator', {
      workspaceId: WS, content: { asking_price_minor: 5000, minimum_price_minor: 9000 },
    });
    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe('minimum_price_minor');
  });

  it('rejects an unrecognized content field instead of silently dropping it', async () => {
    const response = await call('PATCH', `/api/listing-prep/${PREP}/content`, 'operator', {
      workspaceId: WS, content: { listing_price: 100 },
    });
    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe('listing_price');
    expect(calls).toHaveLength(0);
  });

  it('passes a content patch through with empty strings cleared to null', async () => {
    await call('PATCH', `/api/listing-prep/${PREP}/content`, 'operator', {
      workspaceId: WS,
      content: { working_title: '  Charizard holo  ', condition_summary: '', currency: 'usd' },
    });
    expect(calls[0].args.p_patch).toEqual({
      working_title: 'Charizard holo', condition_summary: null, currency: 'USD',
    });
  });

  it('records a confirmation with its requirement and state', async () => {
    await call('POST', `/api/listing-prep/${PREP}/checks`, 'operator', {
      workspaceId: WS, requirementKey: 'condition_assessment', state: 'confirmed', note: 'Light edge wear',
    });
    expect(calls[0]).toMatchObject({
      fn: 'set_listing_prep_check',
      args: { p_requirement_key: 'condition_assessment', p_state: 'confirmed', p_note: 'Light edge wear' },
    });
  });

  it('will not accept an invented check state', async () => {
    const response = await call('POST', `/api/listing-prep/${PREP}/checks`, 'operator', {
      workspaceId: WS, requirementKey: 'condition_assessment', state: 'probably_fine',
    });
    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe('state');
  });

  // Required scenario: the owner gate is the database's, not this file's.
  it('sends ready_to_list to the database, which refuses a non-owner', async () => {
    rpcError = 'owner authority required for listing review';
    const response = await call('POST', `/api/listing-prep/${PREP}/transition`, 'operator', {
      workspaceId: WS, status: 'ready_to_list',
    });
    expect(calls[0]).toMatchObject({ fn: 'transition_listing_prep', args: { p_to_status: 'ready_to_list' } });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('forbidden');
  });

  it('reports an outstanding blocker as a conflict, with the reason intact', async () => {
    rpcError = 'this preparation still has 3 outstanding blocker(s)';
    const response = await call('POST', `/api/listing-prep/${PREP}/transition`, 'owner', {
      workspaceId: WS, status: 'ready_to_list',
    });
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toBe('lifecycle_conflict');
    expect(payload.detail).toMatch(/3 outstanding blocker/);
  });

  it('does not let the transition route be used to record a listing', async () => {
    const response = await call('POST', `/api/listing-prep/${PREP}/transition`, 'owner', {
      workspaceId: WS, status: 'listed',
    });
    expect(response.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('keeps recording a listing owner-only and demands where it was listed', async () => {
    expect((await call('POST', `/api/listing-prep/${PREP}/listed`, 'operator', {
      workspaceId: WS, externalListingRef: 'ebay/1234',
    })).status).toBe(403);

    const missingRef = await call('POST', `/api/listing-prep/${PREP}/listed`, 'owner', { workspaceId: WS });
    expect(missingRef.status).toBe(422);
    expect((await missingRef.json()).field).toBe('externalListingRef');

    const ok = await call('POST', `/api/listing-prep/${PREP}/listed`, 'owner', {
      workspaceId: WS, externalListingRef: 'ebay/1234',
    });
    expect(ok.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      fn: 'mark_listing_prep_listed', args: { p_external_listing_ref: 'ebay/1234' },
    });
  });

  it('passes queue filters through as arrays and separates absent from empty', async () => {
    await call('GET',
      `/api/listing-prep?workspaceId=${WS}&status=blocked,needs_review&readiness=needs_photos&limit=10&offset=20`,
      'viewer');
    expect(calls[0]).toMatchObject({
      fn: 'list_listing_prep_queue',
      args: {
        p_statuses: ['blocked', 'needs_review'],
        p_readiness: ['needs_photos'],
        p_subtypes: null,
        p_priorities: null,
        p_limit: 10,
        p_offset: 20,
      },
    });
  });

  it('refuses a filter value the database has no enum for', async () => {
    const response = await call('GET', `/api/listing-prep?workspaceId=${WS}&status=sold`, 'viewer');
    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe('status');
    expect(calls).toHaveLength(0);
  });

  it('caps the page size rather than letting a caller ask for everything', async () => {
    await call('GET', `/api/listing-prep?workspaceId=${WS}&limit=100000`, 'viewer');
    expect(calls[0].args.p_limit).toBe(200);
  });

  it('bounds a bulk action and requires a reason to block', async () => {
    const tooMany = await call('POST', '/api/listing-prep/bulk', 'operator', {
      workspaceId: WS, action: 'cancel',
      prepIds: Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    });
    expect(tooMany.status).toBe(422);
    expect((await tooMany.json()).field).toBe('prepIds');

    const noReason = await call('POST', '/api/listing-prep/bulk', 'operator', {
      workspaceId: WS, action: 'mark_blocked', prepIds: [PREP],
    });
    expect(noReason.status).toBe(422);
    expect((await noReason.json()).field).toBe('reason');

    const ok = await call('POST', '/api/listing-prep/bulk', 'operator', {
      workspaceId: WS, action: 'set_priority', priority: 'urgent', prepIds: [PREP, PREP2],
    });
    expect(ok.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      fn: 'bulk_listing_prep_action',
      args: { p_action: 'set_priority', p_prep_ids: [PREP, PREP2], p_params: { priority: 'urgent' } },
    });
  });

  it('refuses a bulk action nobody defined', async () => {
    const response = await call('POST', '/api/listing-prep/bulk', 'operator', {
      workspaceId: WS, action: 'delete_everything', prepIds: [PREP],
    });
    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe('action');
    expect(calls).toHaveLength(0);
  });

  it('treats a rejected assignee as a bad request, not a refusal of the caller', async () => {
    rpcError = 'the assignee is not a member of this workspace';
    const response = await call('POST', `/api/listing-prep/${PREP}/assign`, 'operator', {
      workspaceId: WS, assignedTo: PERSON,
    });
    expect(response.status).toBe(422);
  });

  it('lets an assignment be cleared explicitly', async () => {
    await call('POST', `/api/listing-prep/${PREP}/assign`, 'operator', { workspaceId: WS, assignedTo: null });
    expect(calls[0].args.p_assignee).toBeNull();
  });

  it('applies a package preset through the governed content path', async () => {
    await call('POST', `/api/listing-prep/${PREP}/package-preset`, 'operator', {
      workspaceId: WS, presetId: PRESET,
    });
    expect(calls[0]).toMatchObject({
      fn: 'apply_listing_package_preset', args: { p_prep_id: PREP, p_preset_id: PRESET },
    });
  });

  it('answers whether a record already has a preparation open', async () => {
    await call('GET',
      `/api/listing-prep/for-subject?workspaceId=${WS}&subjectKind=lot&subjectId=${SUBJECT}`, 'viewer');
    expect(calls[0]).toMatchObject({
      fn: 'get_listing_prep_for_subject',
      args: { p_subject_kind: 'lot', p_subject_id: SUBJECT },
    });
  });

  // A failed request must never look like an empty queue.
  it('reports a governed failure as a failure rather than as no results', async () => {
    rpcError = 'listing preparation not found in this workspace';
    const response = await call('GET', `/api/listing-prep/${PREP}?workspaceId=${WS}`, 'viewer');
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('not_found');
  });
});
