import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createListingPrepTransport, formatMoney, parseMoneyToMinor,
} from './listingPrepApi';

const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PREP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let requests: Array<{ url: string; init: RequestInit }>;
let respond: () => Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  requests = [];
  respond = () => jsonResponse({ ok: true });
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return Promise.resolve(respond());
  });
});
afterEach(() => vi.unstubAllGlobals());

const transport = () =>
  createListingPrepTransport(async () => 'jwt-token', () => WS);

function lastBody(): Record<string, unknown> {
  return JSON.parse(String(requests.at(-1)!.init.body));
}

describe('listing prep transport', () => {
  it('sends the caller token and names the workspace on every request', async () => {
    await transport().summary();
    const { url, init } = requests[0];
    expect(url).toContain(`workspaceId=${WS}`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt-token');
  });

  it('refuses to call anything without a workspace', async () => {
    const t = createListingPrepTransport(async () => 'jwt', () => null);
    await expect(t.summary()).rejects.toThrow(/No workspace selected/);
    expect(requests).toHaveLength(0);
  });

  it('asks the user to sign in again rather than sending an unauthenticated request', async () => {
    const t = createListingPrepTransport(async () => null, () => WS);
    await expect(t.summary()).rejects.toThrow(/Sign in again/);
    expect(requests).toHaveLength(0);
  });

  it('sends queue filters as the server expects and omits the ones not set', async () => {
    await transport().queue({
      status: ['blocked', 'needs_review'],
      readiness: ['needs_photos'],
      limit: 25,
      offset: 50,
    });
    const url = requests[0].url;
    expect(url).toContain('status=blocked%2Cneeds_review');
    expect(url).toContain('readiness=needs_photos');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
    expect(url).not.toContain('subtype=');
    expect(url).not.toContain('assignedTo=');
  });

  // A failed request must be a failure, not an empty queue.
  it('raises the reason the database gave rather than a generic message', async () => {
    respond = () => jsonResponse(
      { error: 'lifecycle_conflict', detail: 'this preparation still has 3 outstanding blocker(s)' },
      409);
    await expect(transport().transition(PREP, 'ready_to_list'))
      .rejects.toThrow(/3 outstanding blocker/);
  });

  it('falls back to a plain-language message when the server sends no detail', async () => {
    respond = () => jsonResponse({ error: 'forbidden' }, 403);
    await expect(transport().markListed(PREP, 'ebay/1'))
      .rejects.toThrow(/do not have permission/);
  });

  it('names the field when the server rejects one', async () => {
    respond = () => jsonResponse({ error: 'invalid_request', field: 'asking_price_minor' }, 422);
    await expect(transport().saveContent(PREP, { asking_price_minor: 1 }))
      .rejects.toThrow(/asking_price_minor/);
  });

  it('says so plainly when the surface is not deployed', async () => {
    respond = () => jsonResponse({ error: 'not found' }, 404);
    await expect(transport().summary()).rejects.toThrow(/not enabled on this deployment/);
  });

  it('does not swallow a non-JSON failure', async () => {
    respond = () => new Response('<html>gateway</html>', { status: 502 });
    await expect(transport().summary()).rejects.toThrow(/502/);
  });

  it('sends a content patch verbatim, so an explicit null clears the field', async () => {
    await transport().saveContent(PREP, { asking_price_minor: null, working_title: 'Charizard' });
    expect(lastBody().content).toEqual({ asking_price_minor: null, working_title: 'Charizard' });
  });

  it('sends a bulk action with its records and its parameters', async () => {
    await transport().bulk('set_priority', [PREP], { priority: 'urgent' });
    expect(lastBody()).toMatchObject({
      action: 'set_priority', prepIds: [PREP], priority: 'urgent', workspaceId: WS,
    });
  });
});

describe('money', () => {
  // Money is integer minor units everywhere except the moment it is displayed.
  it('formats minor units without ever rounding the stored value', () => {
    expect(formatMoney(129999, 'USD')).toContain('1,299.99');
    expect(formatMoney(0, 'USD')).toContain('0.00');
    expect(formatMoney(null, 'USD')).toBe('—');
  });

  it('still shows an amount when the currency code is not one Intl knows', () => {
    expect(formatMoney(2500, 'ZZZ')).toContain('25.00');
  });

  it('parses a typed amount into whole minor units', () => {
    expect(parseMoneyToMinor('24.99')).toBe(2499);
    expect(parseMoneyToMinor('24')).toBe(2400);
    expect(parseMoneyToMinor('24.5')).toBe(2450);
    expect(parseMoneyToMinor('')).toBeNull();
  });

  // Anything that is not a plain amount is rejected rather than coerced: a
  // silently misread price is a real loss.
  it('refuses input it cannot read as an amount instead of guessing', () => {
    for (const bad of ['24.999', '-5', '1,299.99', '$24.99', 'free', '1e3']) {
      expect(parseMoneyToMinor(bad)).toBeNull();
    }
  });
});
