import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEV_ORIGINS,
  buildCorsOptions,
  isOriginAllowed,
  resolveCorsPolicy,
} from './corsPolicy.js';

describe('resolveCorsPolicy', () => {
  it('is same-origin in production, emitting no CORS headers at all', () => {
    expect(resolveCorsPolicy({ NODE_ENV: 'production' })).toEqual({ mode: 'same-origin' });
    // Even an explicit dev list must not open production.
    expect(
      resolveCorsPolicy({ NODE_ENV: 'production', DEV_CORS_ORIGINS: 'https://evil.example' }),
    ).toEqual({ mode: 'same-origin' });
    expect(buildCorsOptions(resolveCorsPolicy({ NODE_ENV: 'production' }))).toBeNull();
  });

  it('uses a bounded built-in dev allowlist when nothing is configured', () => {
    const policy = resolveCorsPolicy({ NODE_ENV: 'development' });
    expect(policy).toEqual({ mode: 'allowlist', origins: [...DEFAULT_DEV_ORIGINS] });
  });

  it('honours an explicit DEV_CORS_ORIGINS list', () => {
    const policy = resolveCorsPolicy({
      NODE_ENV: 'development',
      DEV_CORS_ORIGINS: 'http://localhost:3000, http://127.0.0.1:4321 ',
    });
    expect(policy).toEqual({
      mode: 'allowlist',
      origins: ['http://localhost:3000', 'http://127.0.0.1:4321'],
    });
  });

  it('treats an explicitly empty list as same-origin rather than falling back to defaults', () => {
    expect(resolveCorsPolicy({ NODE_ENV: 'development', DEV_CORS_ORIGINS: '' })).toEqual({
      mode: 'same-origin',
    });
    expect(resolveCorsPolicy({ NODE_ENV: 'development', DEV_CORS_ORIGINS: '  , ,' })).toEqual({
      mode: 'same-origin',
    });
  });
});

describe('isOriginAllowed', () => {
  const dev = resolveCorsPolicy({ NODE_ENV: 'development' });
  const prod = resolveCorsPolicy({ NODE_ENV: 'production' });

  it('rejects unlisted origins in development', () => {
    expect(isOriginAllowed(dev, 'https://evil.example')).toBe(false);
    expect(isOriginAllowed(dev, 'http://localhost:5174')).toBe(false);
    // Not a prefix or suffix match.
    expect(isOriginAllowed(dev, 'http://localhost:5173.evil.example')).toBe(false);
    expect(isOriginAllowed(dev, 'http://evil.example/http://localhost:5173')).toBe(false);
  });

  it('allows exactly the listed dev origins', () => {
    for (const origin of DEFAULT_DEV_ORIGINS) {
      expect(isOriginAllowed(dev, origin)).toBe(true);
    }
  });

  it('rejects every cross origin in production', () => {
    for (const origin of [...DEFAULT_DEV_ORIGINS, 'https://russellvault2-production.up.railway.app']) {
      expect(isOriginAllowed(prod, origin)).toBe(false);
    }
  });

  it('permits requests with no Origin header, which is how the health check calls', () => {
    expect(isOriginAllowed(prod, undefined)).toBe(true);
    expect(isOriginAllowed(dev, undefined)).toBe(true);
  });
});

describe('buildCorsOptions', () => {
  it('refuses an unlisted origin by withholding the header, not by throwing a 500', async () => {
    const options = buildCorsOptions(resolveCorsPolicy({ NODE_ENV: 'development' }));
    expect(options).not.toBeNull();
    const decide = (origin: string | undefined) =>
      new Promise<[unknown, unknown]>((resolve) => {
        (options!.origin as any)(origin, (err: unknown, allow: unknown) => resolve([err, allow]));
      });
    expect(await decide('https://evil.example')).toEqual([null, false]);
    expect(await decide('http://localhost:5173')).toEqual([null, true]);
    expect(await decide(undefined)).toEqual([null, true]);
  });

  it('never enables credentialed cross-origin requests', () => {
    const options = buildCorsOptions(resolveCorsPolicy({ NODE_ENV: 'development' }));
    expect(options?.credentials).toBe(false);
  });
});
