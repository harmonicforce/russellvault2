# Supabase shadow foundation (Phase 2)

## What this is — and is not

- **This schema is newly created in Phase 2.** Before this phase the
  repository contained **no** PostgreSQL/Supabase schema, migrations, RLS
  policies, storage policies, or database functions of any kind. Nothing here
  "migrated", "hardened", or "preserved" earlier PostgreSQL objects, because
  none existed.
- **No remote Supabase project was linked, inspected, or modified.** Every
  migration and test in this phase ran only against a local PostgreSQL
  database on the development machine. `supabase/config.toml` contains no
  remote project reference, and no URL, key, token, or secret is committed
  anywhere.
- **No production owner or workspace was assumed.** The schema defines the
  workspace/membership model; it seeds no users, no workspaces, and no data.
- **The shadow database is non-authoritative.** The deployed application
  still reads and writes only the legacy SQLite database via the Express API.
  There is **no dual-write**: the client's only Supabase traffic (when the
  feature flag is explicitly enabled) is authentication and a read of the
  caller's own `workspace_members` rows.
- **Activation and cutover require later owner-reviewed gates.** Turning the
  shadow on for real users, creating the storage bucket, granting anyone
  production access, backfilling data, or making PostgreSQL authoritative are
  all explicitly out of scope for Phase 2 and require the owner's sign-off.

## Layout

```
supabase/
  config.toml            local-only Supabase CLI configuration (no remote ref)
  cli-version            pinned Supabase CLI version (repo-controlled)
  migrations/            five ordered SQL migrations (the entire shadow schema)
  tests/                 pgTAP test files run by `npm run db:test`
scripts/db/
  reset.mjs              npm run db:reset — local-only reset + migrate
  test.mjs               npm run db:test  — reset, then run pgTAP suite
  shim/000_supabase_shim.sql   auth/storage shim for plain local PostgreSQL
```

## Migration order

1. `20260719000100_workspace_foundation.sql` — `schema_migrations_log`,
   `workspace_role` enum, `workspaces`, `workspace_members`, the `app` helper
   schema (`member_role`, triggers for `updated_at`, creator-becomes-owner
   bootstrap, last-owner protection), RLS + policies for both tables.
2. `20260719000200_intake_shadow_schema.sql` — `sessions`, `intake_groups`,
   `items`, `photos`, `photo_requirements`, `reference_lists`,
   `reference_options`, `field_registry`, `field_rules`; all workspace-scoped
   with UUID internal ids, per-workspace-unique public business identifiers,
   and composite `(id, workspace_id)` foreign keys that make cross-workspace
   relationships impossible at the constraint level.
3. `20260719000300_intake_rls_policies.sql` — RLS enabled everywhere;
   member-read policies; owner/operator write policies on intake work tables;
   owner-only write policies on configuration tables; zero anon policies.
4. `20260719000400_intake_functions.sql` — SECURITY DEFINER functions
   `mint_sku`, `expand_intake_group`, `delete_intake_group_safe`,
   `create_custom_field` (plus internal `app.assert_workspace_role` and
   `app.next_sku`), all with fixed empty `search_path`, internal
   authentication/membership/role checks, input validation, and
   least-privilege grants (`authenticated` only; `anon` and `PUBLIC` revoked).
5. `20260719000500_storage_policies.sql` — private-storage policy conventions
   for the `intake-evidence` bucket: paths must be
   `<workspace_id>/<item_id>/<filename>`, reads require workspace membership,
   uploads require owner/operator, deletes require owner, nothing for anon.
   The bucket itself is **not** created — that is an activation-gate step.
   The migration is guarded: it skips (with a notice) when no storage schema
   exists, and degrades gracefully where storage policies need the platform's
   storage admin.

Every migration records itself in `public.schema_migrations_log`, which is
RLS-enabled with no policies (owner/service only).

## Security model

- Authentication alone grants nothing: every business row is reached only
  through `workspace_members`. A signed-in user with no membership sees zero
  rows and can call no function successfully (the React shell shows a
  dedicated "no workspace access" state for this).
- Roles: `viewer` (read-only), `operator` (intake work), `owner`
  (configuration + membership administration). Membership is administered by
  owners only; a workspace always retains at least one owner.
- Public business IDs (`public_id`, `sku`, `*_key`, `code`) are unique per
  workspace and distinct from the internal UUID keys; SKUs are minted
  per-workspace (`sku_prefix` + zero-padded counter, matching the legacy
  `RV-N-000001` shape). Canonical legacy source IDs are untouched.
- Photos/evidence are private by default: DB `CHECK` constraints pin
  `photos.storage_path` to the owning workspace and item folder, and the
  storage policies enforce the same convention with membership checks. Reads
  are meant to go through signed/authenticated requests, never a public
  bucket.

## Local environment

Prerequisites (what this phase was actually built and tested with):

- PostgreSQL 15 (Debian: `apt-get install postgresql postgresql-contrib`)
- pgTAP 1.2.0 (`apt-get install postgresql-15-pgtap`)
- A superuser role for your OS user
  (`sudo -u postgres createuser -s "$USER"`)
- Node 20+

Commands:

```
npm run db:reset   # drop + recreate the LOCAL russellvault_shadow DB, apply migrations
npm run db:test    # db:reset, then run every pgTAP file in supabase/tests
```

Both scripts refuse non-local `PGHOST` values, so they cannot be pointed at a
remote database. `SHADOW_DB_NAME` overrides the database name.

Optionally, with Docker available, the pinned Supabase CLI can drive the same
migrations through a full local Supabase stack:
`SHADOW_DB_RUNNER=supabase-cli npm run db:reset`. The pin lives in
`supabase/cli-version` (currently 2.109.1) and is the repository-controlled
version used by any `npx supabase@$(cat supabase/cli-version)` invocation.

### What the SQL tests did and did not exercise

The pgTAP suite ran against **plain local PostgreSQL 15**, not a running
Supabase stack (Docker is unavailable in the build environment).
`scripts/db/shim/000_supabase_shim.sql` recreates the minimal Supabase
surface the schema depends on — `anon`/`authenticated`/`service_role` roles,
`auth.users`, `auth.uid()`, and a minimal `storage.buckets`/`storage.objects`
with RLS — and tests impersonate users by setting JWT-claim settings and
switching roles, which is the same mechanism Supabase's own RLS testing uses.

This means the tests **do** prove the SQL-level security model: RLS policies,
grants, constraints, and function authorization behave as asserted for anon,
non-members, viewers, operators, and owners across workspaces. They do **not**
exercise Supabase's HTTP layer (GoTrue token issuance, PostgREST, the Storage
API's signed URLs) — that verification belongs to a later phase with a real
local stack.

## Client integration (feature-flagged)

- Flag: `VITE_SHADOW_AUTH=supabase` **and** `VITE_SUPABASE_URL` **and**
  `VITE_SUPABASE_ANON_KEY` must all be set (see `client/.env.example`).
  Default (any of them absent): the app renders exactly as before — the
  legacy SQLite REST path with no Supabase traffic. This is the deployed
  production behavior.
- `client/src/components/AuthShell.tsx` + `client/src/lib/authShell.ts`
  implement the shell states: configuration-absent (legacy passthrough),
  loading, signed-out (login form), authenticated member (app renders), and
  authenticated-but-no-membership (denied screen with sign-out).
- `client/src/lib/database.types.ts` holds generated-style types mirroring
  the migrations (regenerate with
  `npx supabase@$(cat supabase/cli-version) gen types typescript --local`
  when a local stack is available).
- `client/src/lib/dataAdapter.ts` records that `legacy-sqlite-rest` is the
  only data backend and that shadow writes are disabled; client tests assert
  both, plus every shell state.

## Future backfill contract (not implemented)

If/when the shadow becomes authoritative, the backfill must: map each legacy
SQLite row to exactly one workspace chosen by the owner; carry legacy public
IDs (`sellable_sku`, etc.) into the public-identifier columns unchanged;
never renumber or re-mint existing IDs; run against a disposable copy first;
and present row-count reconciliation to the owner before any cutover
decision. No production migration logic exists in this phase.

## Rollback

Phase 2 is additive and inert by default. To reverse it: revert the Phase 2
commit (removes `supabase/`, `scripts/db/`, the client shell, and the two npm
scripts); the deployed app never depended on any of it. The local shadow
database is disposable — `dropdb russellvault_shadow` (or simply delete the
local cluster). Nothing remote exists to roll back.
