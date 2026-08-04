// S0.1 made 503 a defined state carrying structured diagnostic data. Routing
// it through the generic `request()` helper discarded that body and made the
// banner vanish at the moment it mattered most. These tests pin the split:
// 200 and a well-formed 503 are both successful parses; anything else is a
// transport error, and no server text ever escapes.

import { describe, expect, it, vi } from 'vitest';
import {
  HealthTransportError,
  LEGACY_HEALTH_REASONS,
  fetchSystemHealth,
  parseSystemHealth,
} from './healthApi';
import { get } from './api';

const HEALTHY_BODY = {
  ok: true,
  readOnly: true,
  legacyDatabaseAvailable: true,
  legacySchemaPresent: true,
  legacySeeded: true,
  legacyBootWritesEnabled: false,
};

const UNHEALTHY_BODY = {
  ok: false,
  readOnly: true,
  legacyDatabaseAvailable: false,
  legacySchemaPresent: false,
  legacySeeded: false,
  legacyBootWritesEnabled: false,
  reason: 'legacy_database_missing',
};

function respond(status: number, body: unknown): typeof fetch {
  return (async () => ({
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function respondNonJson(status: number): typeof fetch {
  return (async () => ({
    status,
    json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
  })) as unknown as typeof fetch;
}

describe('a 200 health response', () => {
  it('parses into a healthy typed state', async () => {
    const result = await fetchSystemHealth(respond(200, HEALTHY_BODY));
    expect(result.status).toBe('healthy');
    expect(result.health.readOnly).toBe(true);
    expect(result.health.legacySeeded).toBe(true);
    expect(result.health.reason).toBeUndefined();
  });
});

describe('the defined 503 health response', () => {
  it('parses into a structured unhealthy state instead of throwing', async () => {
    const result = await fetchSystemHealth(respond(503, UNHEALTHY_BODY));
    expect(result.status).toBe('unhealthy');
    expect(result.health.reason).toBe('legacy_database_missing');
    expect(result.health.legacyDatabaseAvailable).toBe(false);
    // readOnly survives: it describes the write guard, not the failure.
    expect(result.health.readOnly).toBe(true);
  });

  it.each(LEGACY_HEALTH_REASONS)('accepts the bounded reason %s', async (reason) => {
    const result = await fetchSystemHealth(respond(503, { ...UNHEALTHY_BODY, reason }));
    expect(result.status).toBe('unhealthy');
    expect(result.health.reason).toBe(reason);
  });

  it('drops a reason code it does not recognize rather than trusting it', async () => {
    const result = await fetchSystemHealth(
      respond(503, { ...UNHEALTHY_BODY, reason: 'rm -rf /data/vault.db failed' }),
    );
    expect(result.status).toBe('unhealthy');
    // The unhealthy state is still reported; the unvalidated string is not.
    expect(result.health.reason).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('vault.db');
  });

  it('treats a 200 body that claims not-ok as unhealthy, the safe direction', async () => {
    const result = await fetchSystemHealth(respond(200, { ...HEALTHY_BODY, ok: false }));
    expect(result.status).toBe('unhealthy');
  });
});

describe('untrustworthy responses are transport errors, not diagnostics', () => {
  it('rejects a 503 that is not the documented shape', async () => {
    await expect(fetchSystemHealth(respond(503, { error: 'internal error' })))
      .rejects.toBeInstanceOf(HealthTransportError);
  });

  it('rejects a 503 that is an HTML proxy page', async () => {
    await expect(fetchSystemHealth(respondNonJson(503)))
      .rejects.toBeInstanceOf(HealthTransportError);
  });

  it('rejects a 503 whose declared booleans are not booleans', async () => {
    await expect(fetchSystemHealth(respond(503, { ...UNHEALTHY_BODY, legacySeeded: 'no' })))
      .rejects.toBeInstanceOf(HealthTransportError);
  });

  it('rejects an unexpected status even with a valid body', async () => {
    await expect(fetchSystemHealth(respond(502, HEALTHY_BODY)))
      .rejects.toBeInstanceOf(HealthTransportError);
  });

  it('keeps a network failure distinct from a structured unhealthy response', async () => {
    const failing = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchSystemHealth(failing)).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchSystemHealth(respond(503, { nope: true }))).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('carries no server text, path, SQL or stack trace on the error', async () => {
    const leaky = (async () => ({
      status: 503,
      json: async () => ({ error: '/data/vault.db SELECT * FROM secrets — SQLITE_CANTOPEN\n at Foo' }),
    })) as unknown as typeof fetch;
    await expect(fetchSystemHealth(leaky)).rejects.toSatisfy((err: unknown) => {
      const text = String(err) + JSON.stringify(err instanceof Error ? err.message : err);
      return !/vault\.db|SELECT |SQLITE_|at Foo/.test(text);
    });
  });
});

describe('parseSystemHealth narrowing', () => {
  it.each([null, undefined, 'string', 42, [], { ok: true }])('rejects %j', (payload) => {
    expect(parseSystemHealth(payload)).toBeNull();
  });

  it('accepts the documented shape', () => {
    expect(parseSystemHealth(HEALTHY_BODY)).toMatchObject({ ok: true, readOnly: true });
  });
});

describe('the generic transport is not weakened', () => {
  it('still rejects an ordinary 503 from any other endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'service unavailable' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(get('/inventory')).rejects.toThrow(/service unavailable/);
    vi.unstubAllGlobals();
  });
});
