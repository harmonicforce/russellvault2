# Last Implementation Handoff

## Production Identity and Supabase Preview Integrity

- Repository: `harmonicforce/russellvault2`; canonical branch: `main`.
- Branch: `claude/wo-production-identity-preview-integrity`.
- Base SHA: `d1ee80ccb654fe056a767f8c3a75c23584934277` — current `main`, the
  merge of PR #84, read from GitHub 2026-08-26T11:48:27Z.
- Release authority: branch and draft PR only. **No deployment, no hosted
  mutation, no merge.** Migration 80 was deliberately NOT deployed.
- Status: **investigation complete**, control-plane guard **implemented**;
  production identity **still UNVERIFIED** and deliberately left that way.

### Preconditions, verified

PR #84 `merged: true`, merged 2026-08-26T11:47:28Z, head
`48f860783d1e4c3d10441f95768dc8ae83306e6e` (matches expected) and an ancestor of
`main`. Migration count 80, tail `20260826000100_receiving_rpc_named_parameters`.
Generated contract blob `784a10be27ffa8d25c7c04a81454b89584595996`. Worktree
clean.

## The headline

**Production identity could not be established, and this work order refuses to
pretend otherwise.**

Two traps sit next to each other in this account:

- the project **far behind** the repository is displayed as **"The Russell Vault
  2"** — it reads like the product;
- the project that **matches the repository exactly** is displayed as
  **"russellvault2-production"** — it reads like the answer.

Choosing either because of its name would be the same mistake. So the repair
here is not a conclusion; it is a **fail-closed guard** that refuses every
production target until an owner reads the ref from the deployed environment.

## Candidate registry

| Ref | Displayed name | Org | Status | Governed ledger | Public tables | Markers | Receiving RPCs | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ncyqqitqtsyjrijieykd` | `russellvault2-production` | `mbxqxhxmvocethwktvct` | ACTIVE_HEALTHY | **79**, tail `20260819000200_null_safe…` | **119** | 4/4 | 8, all **UNNAMED** | **UNKNOWN** — strongest candidate, unconfirmed |
| `ykdyqnvmwpxhowbwhzqz` | `The Russell Vault 2` | `kdhymqcheiwhnjxdffrl` | ACTIVE_HEALTHY | **40**, tail `20260729000300_cycle_count_observations` | 69 | 2/4 | **0** | **STALE_PREVIEW** |
| `ssqrgfbhqfufnjrsjpgj` | `TheRussellOps` | `kdhymqcheiwhnjxdffrl` | INACTIVE | not inspected | — | — | — | **LEGACY_OR_DECOY** (different product) |
| Railway runtime target | — | — | — | — | — | — | — | **NOT_INSPECTABLE** |

### Why the scoped listing looked wrong

`list_projects` returns only organization `kdhymqcheiwhnjxdffrl`, so
`ncyqqitqtsyjrijieykd` — which lives in `mbxqxhxmvocethwktvct` — is absent from
it while being directly reachable. The prior note that "a scoped listing's
silence is not evidence of absence" is now explained rather than merely warned
about: **the listing was scoped to the wrong organization.**

### One number that looks like a contradiction and is not

`supabase_migrations.schema_migrations` (the Supabase **CLI** ledger) reports 43
for `ncyqqitqtsyjrijieykd` and 0 for `ykdyqnvmwpxhowbwhzqz`. The governed ledger
this repository actually maintains is `public.schema_migrations_log`, which
reports 79 and 40 respectively. Two different tables; only the governed one is
this repository's ledger.

## Evidence chain (redacted)

1. **Railway runtime — NOT OBTAINED.** The egress proxy answered **403 to
   CONNECT** for the live app host, twice, at 2026-08-26T11:49:25Z; the proxy's
   own guidance is that policy denials must be reported, not retried. Railway
   variables are not stored in this repository. **This is the missing link, and
   nothing below substitutes for it.**
2. **Deployment metadata — not obtainable** for the same reason.
3. **Endpoint derived from runtime config — not obtainable.**
4. **Read-only catalog — obtained, for candidates only.** The repository's 80
   migrations replayed locally produce a public-table set whose sha256 is
   `f5cfa2ee1a1de329da47a5156b3911f539bddd2a79d67b89975eb690fc72e77d`, with 54
   enums, 17 views and 8 receiving RPCs. `ncyqqitqtsyjrijieykd` returns the
   **identical fingerprint and counts**. That is a very strong statement about
   schema lineage and **not a statement about deployment**.
5. **Attestation** — refreshed with the above; `deploymentIdentity` remains
   `verificationPerformed: false`, `canonicalProjectRef: null`.

## Migration 80 in production

**Not applied anywhere**, and not applied by this work order.
`ncyqqitqtsyjrijieykd` reports `migration_80_applied = 0` and all three
receiving RPCs still carry **UNNAMED** parameters — i.e. the candidate sits at
exactly the pre-repair state migration 80 was written against.

Hosted PostgREST resolution for those three RPCs was **not** probed. Doing so
would require either a mutation or an authenticated application call against a
project whose production role is unproven. The catalog evidence (`proargnames IS
NULL`) is sufficient and non-mutating: with unnamed parameters PostgREST cannot
resolve them by name, so they are unreachable there today.

## Supabase Preview — autopsy

- **Owner:** the Supabase GitHub integration, installed on project
  `ykdyqnvmwpxhowbwhzqz`.
- **Configuration:** entirely external. There is no integration config in
  `.github/`, and `supabase/config.toml` names only the local stack
  (`russellvault2-shadow`). Nothing in this repository selects it.
- **Target:** `ykdyqnvmwpxhowbwhzqz` — the 40-migration project.
- **What it does:** nothing. Its own check output reads *"Creating a new preview
  branch per PR is disabled. You can re-enable it in Project Integrations
  Settings."* It is a permanent `skipped` no-op: no preview branch, no deploy,
  no mutation.
- **Merge authority:** none. It is not a required check.
- **Why it stayed attached:** it was connected to a project that later fell
  behind, and disabling *preview branching* left the *integration* connected. A
  disabled feature still emits a check, so the residue is visible while the
  function is gone.
- **Can it mislead?** Yes, and that is the whole finding. A Supabase-branded
  check sitting beside four required jobs reads like hosted-database evidence to
  a reviewer or an agent. It is not.

## What was built

| File | Purpose |
| --- | --- |
| `scripts/ci/production-target-guard.mjs` | Fail-closed deployment-target guard |
| `scripts/ci/deployment-targets.json` | Canonical non-secret target registry |
| `scripts/ci/production-target-guard.test.mjs` | 21 tests |
| `docs/runbooks/deployment-target-guard.md` | Owner verification procedure, preflight, stop conditions, Preview autopsy |

The guard compares **only non-secret routing identity** — the project ref inside
the Supabase URL. It never reads, requires or prints a key, and redacts
credential-shaped values. It reads all four target variables rather than the
first, because two variables disagreeing is precisely the ambiguity worth
catching. Production and non-production acceptance use **different** outcome
codes, so a preview verdict can never read as a production one.

**Today it rejects everything in production mode** with
`canonical_identity_unverified`, including `ncyqqitqtsyjrijieykd`. A test pins
that, and another pins that no shipped entry is marked `deployable`.

It is deliberately **not** wired into a deployment path, because no deployment
path exists in this repository. The runbook names it as preflight step 2 for the
future deployment work order.

## Verification

All local checks green — see the PR body for the table. No SQL, no schema
change, no generated-type change: migration 80 remains the tail, the contract
blob is unchanged at `784a10b`, ESC-002 remains retired, and receiving code is
untouched.

## Known limitations / remaining uncertainty

- **Production identity remains unproven.** Everything about
  `ncyqqitqtsyjrijieykd` is consistent with it being production; none of it is
  proof, and the guard treats it accordingly.
- The Preview integration could not be corrected from here — it needs Supabase
  dashboard admin. The exact owner action is in the runbook.
- `ssqrgfbhqfufnjrsjpgj` was classified from project metadata only; its catalog
  was not read, because it belongs to a different product.
- Hosted PostgREST behaviour for the three RPCs was inferred from the catalog
  rather than exercised, deliberately.

## Exact next decision

Owner performs the verification procedure in
`docs/runbooks/deployment-target-guard.md`, updates the two files together, and
only then opens a **separate migration-80 deployment work order**. Independently,
disconnect or repoint the Supabase Preview integration.
