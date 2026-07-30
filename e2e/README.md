# Browser workflows

Playwright specs that drive the real application against a **local** Supabase
stack. They exist to prove the operator workflows behave end to end — the parts
component tests cannot reach: focus moving between real inputs, a page surviving
an actual reload, a governed refusal arriving over the wire.

## What this suite will not do

- **No service-role key.** Anywhere. The seed signs up an ordinary user and does
  everything through the anon key under that user's own session, so a spec
  cannot pass by way of privileges the real application does not have.
- **No remote project.** `e2e/support/env.ts` refuses any Supabase URL that is
  not localhost. These tests create users and inventory; pointing them at a real
  project would put test data in it.
- **No shared fixture.** Every test seeds its own workspace with its own user,
  so tests are independent and none can reach another's data — or any existing
  workspace, since a brand-new user is a member of exactly one.
- **No teardown.** The schema is append-only by design; deleting a workspace
  would be refused by the database and would misrepresent what the run did.
  Local stacks are disposable, and CI starts a fresh one per run.

## Running locally

Requires Docker, for the Supabase CLI's stack.

```bash
npx supabase@$(cat supabase/cli-version) start -x studio,imgproxy
SHADOW_DB_RUNNER=supabase-cli npm run db:reset

# Take the values from `supabase status`.
export VITE_SUPABASE_URL=http://127.0.0.1:54321
export VITE_SUPABASE_ANON_KEY=<the stack's anon key>

npm run test:e2e            # headless
npm run test:e2e:ui         # interactive
npm run typecheck:e2e       # harness only, no stack needed
```

Playwright starts the client itself with the four `VITE_` variables the shadow
surfaces require; the stack is not started implicitly, because starting a
database is not something a test runner should decide to do.

## Layout

| Path | Purpose |
|---|---|
| `support/env.ts` | Required configuration, with the localhost guard |
| `support/seed.ts` | Isolated workspace and inventory, via governed functions |
| `support/fixtures.ts` | `workspace` and `signedIn` fixtures, real sign-in |
| `smoke.spec.ts` | Harness gate — proves the infrastructure, not the feature |

Specs tagged `@mobile` also run in the `phone` project at Pixel 7 width.

## CI

The `browser-workflows` job starts its own stack, applies migrations, reads the
URL and anon key from `supabase status` rather than from a hardcoded value, and
uploads the Playwright report when a run fails.
