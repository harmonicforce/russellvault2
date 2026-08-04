// @vitest-environment jsdom
//
// The shell's three configuration outcomes, rendered.
//
// The one that matters most is `misconfigured`. A partial governed
// configuration used to resolve to null and fall through to the legacy
// application, so a single dropped environment variable silently downgraded a
// governed deployment into an unauthenticated legacy one. These tests require
// it to fail closed instead — and require that it constructs no Supabase
// client and issues no request while doing so.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AuthShell from './AuthShell';
import type { EnvLike } from '../lib/appConfig';

// A governed deployment has a real client. Its session check never settles
// here, which holds the shell in `loading` — the state that proves the
// application body is gated rather than rendered.
const pendingClient = vi.hoisted(() => ({
  auth: {
    getSession: () => new Promise(() => undefined),
    signInWithPassword: () => new Promise(() => undefined),
    signUp: () => new Promise(() => undefined),
    signOut: () => new Promise(() => undefined),
    resetPasswordForEmail: () => new Promise(() => undefined),
  },
  from: () => ({ select: () => ({ eq: () => new Promise(() => undefined) }) }),
}));
const createShadowClient = vi.hoisted(() => vi.fn(() => null as unknown));
const createShadowSupabaseClient = vi.hoisted(() => vi.fn(() => null as unknown));
vi.mock('../lib/supabaseShadow', () => ({ createShadowClient, createShadowSupabaseClient }));

const apiGet = vi.hoisted(() => vi.fn(() => new Promise(() => undefined)));
vi.mock('../lib/api', () => ({ get: apiGet, post: apiGet, patch: apiGet }));

const fetchSpy = vi.hoisted(() => vi.fn());

afterEach(() => {
  cleanup();
  createShadowClient.mockReset();
  createShadowSupabaseClient.mockReset();
  createShadowClient.mockReturnValue(null);
  createShadowSupabaseClient.mockReturnValue(null);
  createShadowClient.mockClear();
  createShadowSupabaseClient.mockClear();
  apiGet.mockClear();
  fetchSpy.mockClear();
  vi.unstubAllGlobals();
});

const URL_VALUE = 'https://project.supabase.test';
const KEY_VALUE = 'anon-key-that-must-never-be-rendered';

const GOVERNED: EnvLike = {
  VITE_SHADOW_AUTH: 'supabase',
  VITE_SHADOW_IMPORT: 'repository-fixtures',
  VITE_SUPABASE_URL: URL_VALUE,
  VITE_SUPABASE_ANON_KEY: KEY_VALUE,
};

function renderShell(env: EnvLike) {
  vi.stubGlobal('fetch', fetchSpy);
  return render(
    <AuthShell env={env}>
      <div data-testid="app-body">routed application</div>
    </AuthShell>,
  );
}

describe('legacy-only mode', () => {
  it('renders the application', () => {
    renderShell({});
    expect(screen.getByTestId('app-body')).toBeTruthy();
  });

  it('constructs no Supabase client, because there is nothing to connect to', () => {
    renderShell({});
    expect(createShadowClient).not.toHaveBeenCalled();
    expect(createShadowSupabaseClient).not.toHaveBeenCalled();
  });
});

describe('governed mode', () => {
  it('gates the application behind the auth flow rather than rendering it', () => {
    createShadowClient.mockReturnValue(pendingClient);
    createShadowSupabaseClient.mockReturnValue(pendingClient);
    renderShell(GOVERNED);
    expect(screen.queryByTestId('app-body')).toBeNull();
    // The controller starts in `loading` while it checks for a session.
    expect(screen.getByText(/checking access/i)).toBeTruthy();
  });

  it('constructs the Supabase clients from the complete configuration', () => {
    renderShell(GOVERNED);
    expect(createShadowClient).toHaveBeenCalledWith(GOVERNED);
    expect(createShadowSupabaseClient).toHaveBeenCalledWith(GOVERNED);
  });

  it('shows no legacy-only or configuration warning', () => {
    renderShell(GOVERNED);
    expect(screen.queryByText(/legacy-only/i)).toBeNull();
    expect(screen.queryByText(/configuration incomplete/i)).toBeNull();
  });
});

describe('misconfigured mode fails closed', () => {
  const PARTIALS: Array<[string, EnvLike]> = [
    ['auth flag missing', { ...GOVERNED, VITE_SHADOW_AUTH: undefined }],
    ['import flag missing', { ...GOVERNED, VITE_SHADOW_IMPORT: undefined }],
    ['url missing', { ...GOVERNED, VITE_SUPABASE_URL: undefined }],
    ['anon key missing', { ...GOVERNED, VITE_SUPABASE_ANON_KEY: undefined }],
    ['wrong auth flag value', { ...GOVERNED, VITE_SHADOW_AUTH: 'postgres' }],
    ['whitespace-only url', { ...GOVERNED, VITE_SUPABASE_URL: '   ' }],
  ];

  it.each(PARTIALS)('does not render the application when the %s', (_label, env) => {
    renderShell(env);
    expect(screen.queryByTestId('app-body')).toBeNull();
    expect(screen.getByText(/configuration incomplete/i)).toBeTruthy();
  });

  it.each(PARTIALS)('constructs no Supabase client when the %s', (_label, env) => {
    renderShell(env);
    expect(createShadowClient).not.toHaveBeenCalled();
    expect(createShadowSupabaseClient).not.toHaveBeenCalled();
  });

  it('issues no business-data request and no network request at all', () => {
    renderShell({ ...GOVERNED, VITE_SHADOW_IMPORT: undefined });
    expect(apiGet).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not present an authentication form it could not satisfy', () => {
    renderShell({ ...GOVERNED, VITE_SUPABASE_ANON_KEY: undefined });
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('names the offending variables and renders no value', () => {
    const { container } = renderShell({ ...GOVERNED, VITE_SUPABASE_ANON_KEY: undefined });
    expect(container.textContent).toContain('VITE_SUPABASE_ANON_KEY');
    expect(container.textContent).not.toContain(URL_VALUE);
    expect(container.textContent).not.toContain(KEY_VALUE);
  });

  it('explains that it will not fall back to the legacy application', () => {
    const { container } = renderShell({ ...GOVERNED, VITE_SHADOW_AUTH: undefined });
    expect(container.textContent).toMatch(/will not fall back to the legacy application/i);
  });

  it('announces itself as an alert', () => {
    renderShell({ ...GOVERNED, VITE_SHADOW_AUTH: undefined });
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
