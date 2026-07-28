// Shared helper: build a TokenProvider (used by every /api/* transport) from
// the shadow Supabase client's current session. One place instead of the
// same inline shape repeated on every page.

type SessionBearingClient = {
  auth: { getSession(): Promise<{ data: { session: { access_token?: string } | null } }> };
};

export function tokenProviderFromClient(client: unknown): () => Promise<string | null> {
  return async () => {
    const session = await (client as SessionBearingClient | null)?.auth.getSession();
    return session?.data?.session?.access_token ?? null;
  };
}
