// Auth-shell state machine for the Phase 2 Supabase shadow pilot.
//
// Framework-agnostic so every state transition is unit-testable. The shell
// only authenticates and checks workspace membership; it never reads or
// writes business data (the legacy SQLite REST adapter remains the only data
// path — see dataAdapter.ts).

import type { WorkspaceRole } from './database.types';

export interface Membership {
  workspace_id: string;
  role: WorkspaceRole;
}

export type AuthShellState =
  | { kind: 'config-absent' }
  | { kind: 'loading' }
  | { kind: 'signed-out'; error?: string }
  | { kind: 'member'; email: string | null; memberships: Membership[] }
  | { kind: 'no-membership'; email: string | null };

// Minimal structural surface of @supabase/supabase-js used by the shell, so
// tests can substitute a fake without a network or a real project.
export interface AuthShellUser {
  id: string;
  email?: string | null;
}

export interface AuthShellClient {
  auth: {
    getSession(): Promise<{
      data: { session: { user: AuthShellUser } | null };
      error: { message: string } | null;
    }>;
    signInWithPassword(credentials: { email: string; password: string }): Promise<{
      error: { message: string } | null;
    }>;
    signOut(): Promise<{ error: { message: string } | null }>;
  };
  from(table: 'workspace_members'): {
    select(columns: 'workspace_id, role'): {
      eq(
        column: 'user_id',
        value: string
      ): PromiseLike<{
        data: Membership[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export interface AuthShellController {
  initialize(): Promise<AuthShellState>;
  signIn(email: string, password: string): Promise<AuthShellState>;
  signOut(): Promise<AuthShellState>;
}

export function createAuthShellController(
  client: AuthShellClient | null,
  onState: (state: AuthShellState) => void
): AuthShellController {
  const emit = (state: AuthShellState): AuthShellState => {
    onState(state);
    return state;
  };

  if (!client) {
    // No Supabase configuration: the app runs exactly as before Phase 2.
    return {
      initialize: async () => emit({ kind: 'config-absent' }),
      signIn: async () => emit({ kind: 'config-absent' }),
      signOut: async () => emit({ kind: 'config-absent' }),
    };
  }

  const supabase = client;

  async function resolveSession(): Promise<AuthShellState> {
    const { data, error } = await supabase.auth.getSession();
    if (error) return emit({ kind: 'signed-out', error: error.message });
    if (!data.session) return emit({ kind: 'signed-out' });

    const email = data.session.user.email ?? null;
    // Filter to the SESSION USER's rows explicitly. RLS lets a member read
    // their whole workspace roster, so without this filter other members'
    // rows would be misread as the caller's own memberships.
    const { data: memberships, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', data.session.user.id);
    if (membershipError) {
      return emit({ kind: 'signed-out', error: membershipError.message });
    }
    if (!memberships || memberships.length === 0) {
      return emit({ kind: 'no-membership', email });
    }
    return emit({ kind: 'member', email, memberships });
  }

  return {
    async initialize() {
      emit({ kind: 'loading' });
      return resolveSession();
    },
    async signIn(email: string, password: string) {
      emit({ kind: 'loading' });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return emit({ kind: 'signed-out', error: error.message });
      return resolveSession();
    },
    async signOut() {
      await supabase.auth.signOut();
      return emit({ kind: 'signed-out' });
    },
  };
}
