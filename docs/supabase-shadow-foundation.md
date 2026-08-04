# Supabase shadow foundation (Phase 2)

## What this is — and is not

- **This schema is newly created in Phase 2.** Before this phase the
  repository contained **no** PostgreSQL/Supabase schema, migrations, RLS
  policies, storage policies, or database functions of any kind. Nothing here
  "migrated", "hardened", or "preserved" earlier PostgreSQL objects, because
  none existed.
- **No remote Supabase project was linked, inspected, or modified.** All
  execution in this phase was local and non-remote: plain PostgreSQL plus the
  auth/storage shim on the development machine and in CI, and a real
  Docker-local Supabase stack in CI. No remote Supabase project and no
  production environment was involved at any point. `supabase/config.toml`
  contains no remote project reference, and no URL, key, token, or secret is
  committed anywhere.
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
   The group functions authorize **inside the row lookup**: the membership
   predicate is part of the WHERE clause of the `FOR UPDATE` query, so an
   unauthorized caller never reads or locks another workspace's row, and
   nonexistent vs. unauthorized ids produce byte-identical errors
   (`supabase/tests/05_function_locking.sql` proves both properties with a
   real second session).
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

Connection safety: every psql invocation goes through `scripts/db/guard.mjs`,
which refuses or neutralizes **every** libpq setting that could redirect a
connection off the local machine — non-local `PGHOST`, non-loopback
`PGHOSTADDR`, and any `PGSERVICE`/`PGSERVICEFILE`/`PGSYSCONFDIR` service-file
indirection — and passes the validated host/socket explicitly to psql.
`SHADOW_DB_NAME` overrides the database name and is validated as a strict
lowercase PostgreSQL identifier before any command is constructed (it is the
only value ever interpolated into SQL, always identifier-quoted).
`scripts/db/guard.test.mjs` (run by `npm test` and CI) proves remote hosts,
`PGHOSTADDR`, service definitions, and malformed/injection-shaped database
names are refused before any database command runs.

With Docker available, `SHADOW_DB_RUNNER=supabase-cli` switches **both**
scripts to the pinned CLI end-to-end: `db:reset` runs
`supabase db reset --local` (applies all five migrations to the local stack
database) and `db:test` then runs `supabase test db --local`, which executes
the same pgTAP suite **against that same stack database**. The pin lives in
`supabase/cli-version` (currently 2.109.1) and is the repository-controlled
version used by every `npx supabase@$(cat supabase/cli-version)` invocation.
The stack must be started first (`npx supabase@$(cat supabase/cli-version)
start`); no link, project ref, or credentials are involved at any point.

### Node runtime contract

The repository supports **Node 20+** (root `engines.node >= 20`, CI runs
Node 20). `@supabase/supabase-js` is pinned **exactly** to `2.109.0` — the
newest release whose complete installed dependency chain declares
`node >= 20` (the 2.110.x line moved to `node >= 22`). `npm ci` at root,
client, and server was verified clean under Node v20.19.5 with zero
`EBADENGINE` warnings from the Supabase chain. Do not bump this pin past
2.109.x without an explicit owner decision to raise the runtime baseline.
(Pre-existing, unrelated: the root dev-only `concurrently@10` declares
`node >= 22`; it predates Phase 2 and only affects the local `npm run dev`
convenience wrapper.)

### What the SQL tests did and did not exercise

Coverage comes in three distinct tiers — do not conflate them:

1. **Plain PostgreSQL + shim (this machine, and the CI
   `shadow-db-postgres-shim` job).** The pgTAP suite runs against plain
   PostgreSQL 15 with `scripts/db/shim/000_supabase_shim.sql` emulating the
   minimal Supabase surface (`anon`/`authenticated`/`service_role` roles,
   `auth.users`, `auth.uid()`, minimal `storage.buckets`/`storage.objects`
   with RLS). Tests impersonate users via JWT-claim settings and role
   switching — the same mechanism Supabase's own RLS testing uses. This
   proves the SQL-level security model (RLS policies, grants, constraints,
   SECURITY DEFINER authorization, locking order) but is **not Supabase
   parity**.
2. **Real local Supabase stack (the CI `shadow-db-supabase-stack` job).**
   The pinned CLI starts a Docker-local stack, applies all five migrations
   from empty via `supabase db reset --local`, and runs the same pgTAP suite
   against that database via `supabase test db --local` — real Supabase
   `auth`/`storage` schemas and roles, no shim. Local only: no link, ref,
   remote URL, or credentials. One known divergence: the stack's storage
   service blocks **all** direct SQL deletes on `storage.objects` (deletion
   goes through the Storage API), so the three DELETE-policy assertions
   detect that and skip there with a note — they execute fully in tier 1,
   and the DELETE policies still govern the Storage API's own deletion path.
3. **Untested: the HTTP layer.** GoTrue token issuance, PostgREST request
   handling, and Storage API signed-URL behavior are exercised by neither
   tier and remain unverified; that belongs to a later phase driving the
   stack over HTTP.

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
- `client/src/lib/dataTopology.ts` records which system owns which business
  domain. It replaced `dataAdapter.ts`, whose claim that `legacy-sqlite-rest`
  was the only data backend stopped being true once governed intake, movement,
  media, corrections, cycle counts and Listing Prep shipped. Governed Supabase
  is authoritative for its domains and its writes are implemented; legacy
  SQLite is authoritative for none. Dual writes remain disabled, and client
  tests assert the domain map, the no-dual-write invariant, and every shell
  state.

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
