import { describe, expect, it } from 'vitest';
import {
  createAuthShellController,
  type AuthShellClient,
  type AuthShellState,
  type Membership,
} from './authShell';
import { getShadowAuthConfig } from './shadowConfig';
import { activeDataBackend, DATA_BACKENDS, SHADOW_WRITES_ENABLED } from './dataAdapter';

interface FakeOptions {
  session?: { user: { id: string; email?: string | null } } | null;
  memberships?: Membership[];
  signInError?: string;
  membershipError?: string;
}

function fakeClient(options: FakeOptions): AuthShellClient {
  let signedIn = options.session != null;
  return {
    auth: {
      async getSession() {
        return {
          data: { session: signedIn ? (options.session ?? { user: { id: 'u1', email: 'a@b.c' } }) : null },
          error: null,
        };
      },
      async signInWithPassword() {
        if (options.signInError) return { error: { message: options.signInError } };
        signedIn = true;
        options.session ??= { user: { id: 'u1', email: 'a@b.c' } };
        return { error: null };
      },
      async signOut() {
        signedIn = false;
        return { error: null };
      },
    },
    from() {
      return {
        select: () =>
          Promise.resolve(
            options.membershipError
              ? { data: null, error: { message: options.membershipError } }
              : { data: options.memberships ?? [], error: null }
          ),
      };
    },
  };
}

function collector() {
  const states: AuthShellState[] = [];
  return { states, onState: (s: AuthShellState) => states.push(s) };
}

describe('shadow auth configuration flag', () => {
  it('is absent when the flag is off', () => {
    expect(getShadowAuthConfig({})).toBeNull();
    expect(
      getShadowAuthConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'k' })
    ).toBeNull();
  });

  it('is absent when configuration is incomplete, even with the flag on', () => {
    expect(getShadowAuthConfig({ VITE_SHADOW_AUTH: 'supabase' })).toBeNull();
    expect(getShadowAuthConfig({ VITE_SHADOW_AUTH: 'supabase', VITE_SUPABASE_URL: 'x' })).toBeNull();
    expect(getShadowAuthConfig({ VITE_SHADOW_AUTH: 'supabase', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
  });

  it('resolves only with flag plus full configuration', () => {
    expect(
      getShadowAuthConfig({
        VITE_SHADOW_AUTH: 'supabase',
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_ANON_KEY: 'anon-key',
      })
    ).toEqual({ url: 'http://127.0.0.1:54321', anonKey: 'anon-key' });
  });
});

describe('auth shell states', () => {
  it('configuration absent: renders the legacy app untouched', async () => {
    const { states, onState } = collector();
    const controller = createAuthShellController(null, onState);
    const state = await controller.initialize();
    expect(state.kind).toBe('config-absent');
    expect(states).toEqual([{ kind: 'config-absent' }]);
  });

  it('shows loading before the session resolves', async () => {
    const { states, onState } = collector();
    const controller = createAuthShellController(fakeClient({ session: null }), onState);
    await controller.initialize();
    expect(states[0]).toEqual({ kind: 'loading' });
  });

  it('unauthenticated: lands on signed-out (login) state', async () => {
    const { onState } = collector();
    const controller = createAuthShellController(fakeClient({ session: null }), onState);
    const state = await controller.initialize();
    expect(state).toEqual({ kind: 'signed-out' });
  });

  it('failed sign-in surfaces the error on the login state', async () => {
    const { onState } = collector();
    const controller = createAuthShellController(
      fakeClient({ session: null, signInError: 'Invalid login credentials' }),
      onState
    );
    const state = await controller.signIn('a@b.c', 'wrong');
    expect(state).toEqual({ kind: 'signed-out', error: 'Invalid login credentials' });
  });

  it('authenticated member: exposes email and memberships', async () => {
    const memberships: Membership[] = [{ workspace_id: 'ws-1', role: 'operator' }];
    const { onState } = collector();
    const controller = createAuthShellController(
      fakeClient({ session: { user: { id: 'u1', email: 'op@vault.test' } }, memberships }),
      onState
    );
    const state = await controller.initialize();
    expect(state).toEqual({ kind: 'member', email: 'op@vault.test', memberships });
  });

  it('authenticated non-member: denied with no-membership state', async () => {
    const { onState } = collector();
    const controller = createAuthShellController(
      fakeClient({ session: { user: { id: 'u2', email: 'stranger@vault.test' } }, memberships: [] }),
      onState
    );
    const state = await controller.initialize();
    expect(state).toEqual({ kind: 'no-membership', email: 'stranger@vault.test' });
  });

  it('sign-in then membership resolution reaches member state', async () => {
    const { states, onState } = collector();
    const controller = createAuthShellController(
      fakeClient({ session: null, memberships: [{ workspace_id: 'ws-1', role: 'viewer' }] }),
      onState
    );
    const state = await controller.signIn('a@b.c', 'pw');
    expect(state.kind).toBe('member');
    expect(states.map((s) => s.kind)).toEqual(['loading', 'member']);
  });

  it('sign-out returns to signed-out', async () => {
    const { onState } = collector();
    const controller = createAuthShellController(
      fakeClient({ session: { user: { id: 'u1' } }, memberships: [{ workspace_id: 'w', role: 'owner' }] }),
      onState
    );
    await controller.initialize();
    const state = await controller.signOut();
    expect(state).toEqual({ kind: 'signed-out' });
  });

  it('membership query errors fail closed to signed-out', async () => {
    const { onState } = collector();
    const controller = createAuthShellController(
      fakeClient({ session: { user: { id: 'u1' } }, membershipError: 'network down' }),
      onState
    );
    const state = await controller.initialize();
    expect(state).toEqual({ kind: 'signed-out', error: 'network down' });
  });
});

describe('legacy adapter and no-dual-write guarantees', () => {
  it('the legacy SQLite REST adapter remains the active data backend', () => {
    expect(activeDataBackend()).toBe('legacy-sqlite-rest');
  });

  it('no shadow data backend or dual-write path exists', () => {
    expect(DATA_BACKENDS).toEqual(['legacy-sqlite-rest']);
    expect(SHADOW_WRITES_ENABLED).toBe(false);
  });
});
