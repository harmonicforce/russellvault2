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
  // Sign-up succeeded but Supabase Auth requires email confirmation before a
  // session exists (the default posture for a real hosted project).
  | { kind: 'awaiting-confirmation'; email: string }
  // A password-reset email was requested. Supabase never reveals whether the
  // address is registered, so this shows regardless — never a fabricated
  // "email not found" that would leak account existence.
  | { kind: 'password-reset-sent'; email: string }
  | { kind: 'member'; email: string | null; memberships: Membership[] }
  // Signed in, but a member of no workspace yet. Carries an optional error
  // from a failed create-workspace attempt (never a fabricated membership).
  | { kind: 'no-membership'; email: string | null; error?: string };

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
    // Standard Supabase Auth sign-up. When email confirmation is required,
    // Supabase returns a user but NO session; the shell surfaces that
    // explicitly (awaiting-confirmation) rather than pretending success.
    signUp(credentials: { email: string; password: string }): Promise<{
      data: { session: { user: AuthShellUser } | null };
      error: { message: string } | null;
    }>;
    signOut(): Promise<{ error: { message: string } | null }>;
    resetPasswordForEmail(email: string): Promise<{ error: { message: string } | null }>;
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
  // Creating a workspace makes its creator the first owner (a database
  // trigger, not client logic) — see workspaces_add_creator_as_owner.
  from(table: 'workspaces'): {
    insert(row: { name: string; created_by: string }): PromiseLike<{
      error: { message: string } | null;
    }>;
  };
}

export interface AuthShellController {
  initialize(): Promise<AuthShellState>;
  signIn(email: string, password: string): Promise<AuthShellState>;
  signUp(email: string, password: string): Promise<AuthShellState>;
  signOut(): Promise<AuthShellState>;
  // Only reachable while signed in; a workspace name is the only input — no
  // other field is ever invented for the caller.
  createWorkspace(name: string): Promise<AuthShellState>;
  forgotPassword(email: string): Promise<AuthShellState>;
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
      signUp: async () => emit({ kind: 'config-absent' }),
      signOut: async () => emit({ kind: 'config-absent' }),
      createWorkspace: async () => emit({ kind: 'config-absent' }),
      forgotPassword: async () => emit({ kind: 'config-absent' }),
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
    async signUp(email: string, password: string) {
      emit({ kind: 'loading' });
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return emit({ kind: 'signed-out', error: error.message });
      // No session back means Auth requires email confirmation first — never
      // claim membership or a signed-in state that does not actually exist.
      if (!data.session) return emit({ kind: 'awaiting-confirmation', email });
      return resolveSession();
    },
    async signOut() {
      await supabase.auth.signOut();
      return emit({ kind: 'signed-out' });
    },
    async createWorkspace(name: string) {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) return emit({ kind: 'signed-out', error: sessionError.message });
      if (!sessionData.session) return emit({ kind: 'signed-out' });
      const uid = sessionData.session.user.id;
      const email = sessionData.session.user.email ?? null;
      const trimmed = name.trim();
      if (!trimmed) {
        return emit({ kind: 'no-membership', email, error: 'a workspace name is required' });
      }
      emit({ kind: 'loading' });
      const { error } = await supabase
        .from('workspaces')
        .insert({ name: trimmed, created_by: uid });
      if (error) return emit({ kind: 'no-membership', email, error: error.message });
      // The workspaces_add_creator_as_owner trigger already made this caller
      // the owner; re-resolving membership picks that up, never fabricated
      // client-side.
      return resolveSession();
    },
    async forgotPassword(email: string) {
      const trimmed = email.trim();
      if (!trimmed) return emit({ kind: 'signed-out', error: 'an email address is required' });
      emit({ kind: 'loading' });
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed);
      if (error) return emit({ kind: 'signed-out', error: error.message });
      return emit({ kind: 'password-reset-sent', email: trimmed });
    },
  };
}
