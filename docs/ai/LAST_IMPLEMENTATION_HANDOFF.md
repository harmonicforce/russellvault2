# Last Implementation Handoff

## Production Identity and Supabase Preview Integrity

- Repository: `harmonicforce/russellvault2`; canonical branch: `main`.
- Branch: `claude/wo-production-identity-preview-integrity`.
- Base SHA: `d1ee80ccb654fe056a767f8c3a75c23584934277` — current `main`, the
  merge of PR #84, read from GitHub 2026-08-26T11:48:27Z.
- Release authority: branch and draft PR only. **No deployment, no hosted
  mutation, no merge.** Migration 80 was deliberately NOT deployed.
- Status: **investigation complete**, control-plane guard **implemented and
  bound**; production identity **ESTABLISHED by owner declaration** and
  corroborated by read-only catalog evidence. The deployed Railway runtime was
  **not** independently inspected — a limitation, not an open question.

### Preconditions, verified

PR #84 `merged: true`, merged 2026-08-26T11:47:28Z, head
`48f860783d1e4c3d10441f95768dc8ae83306e6e` (matches expected) and an ancestor of
`main`. Migration count 80, tail `20260826000100_receiving_rpc_named_parameters`.
Generated contract blob `784a10be27ffa8d25c7c04a81454b89584595996`. Worktree
clean.

## The headline

**Canonical production is `ncyqqitqtsyjrijieykd`, on the repository owner's
declaration.** The guard is bound to it and fails closed on everything else.

Two traps sit next to each other in this account, and both are still live:

- the project **far behind** the repository is displayed as **"The Russell Vault
  2"** — it reads like the product;
- the canonical project is displayed as **"russellvault2-production"** — it
  reads like the answer.

Choosing either *because of its name* would be the same mistake, and one of them
would merely have been lucky. The canonical project was selected on the owner's
declaration; its name played no part, and the guard never reads one.

Three things are kept apart deliberately, and every document here must keep them
apart:

| | |
| --- | --- |
| **Owner declaration** | The authority. The owner knows their own deployment. This is what makes `ncyqqitqtsyjrijieykd` canonical. |
| **Catalog corroboration** | Read-only evidence that agrees with the declaration. Proves what a database *contains*, never which one the deployed service is *configured to use*. |
| **Live Railway configuration** | **Never inspected here** — egress policy answered 403 to CONNECT. This is why the guard must still resolve the live target immediately before any migration. |

An established identity is not a licence to deploy. A declaration fixes the
expected answer; the guard checks the environment in front of you against it.

## Candidate registry

| Ref | Displayed name | Org | Status | Governed ledger | Public tables | Markers | Receiving RPCs | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ncyqqitqtsyjrijieykd` | `russellvault2-production` | `mbxqxhxmvocethwktvct` | ACTIVE_HEALTHY | **79**, tail `20260819000200_null_safe…` | **119** | 4/4 | 8, all **UNNAMED** | **CANONICAL_PRODUCTION** — owner-declared, catalog-corroborated |
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

0. **Owner declaration — OBTAINED, and the basis for the designation.** The
   repository owner declared `ncyqqitqtsyjrijieykd` canonical production in the
   follow-up work order of 2026-08-26. An owner knows their own deployment.
   Recorded as `evidenceClass: owner_declaration`, never as a runtime reading.
1. **Railway runtime — NOT OBTAINED.** The egress proxy answered **403 to
   CONNECT** for the live app host, twice, at 2026-08-26T11:49:25Z; the proxy's
   own guidance is that policy denials must be reported, not retried. Railway
   variables are not stored in this repository. This limitation is permanent for
   this environment and is recorded in
   `deploymentIdentity.independentRuntimeInspection`. It does **not** reopen the
   identity question — it is why preflight re-resolves the live target.
2. **Deployment metadata — not obtainable** for the same reason.
3. **Endpoint derived from runtime config — not obtainable.**
4. **Read-only catalog — obtained, and it corroborates the declaration.** The
   repository's 80 migrations replayed locally produce a public-table set whose
   sha256 is `f5cfa2ee1a1de329da47a5156b3911f539bddd2a79d67b89975eb690fc72e77d`,
   with 54 enums, 17 views and 8 receiving RPCs. `ncyqqitqtsyjrijieykd` returns
   the **identical fingerprint and counts**. That is a strong statement about
   schema lineage and **not a statement about deployment**; it agrees with the
   declaration without being what establishes it.
5. **Attestation** — state `OWNER_DECLARED`: `verificationPerformed: true`,
   `canonicalProjectRef: ncyqqitqtsyjrijieykd`,
   `evidenceClass: owner_declaration`, with `independentRuntimeInspection`,
   `corroboration` and `preDeploymentRequirement` all populated and enforced.

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
| `scripts/ci/production-target-guard.test.mjs` | 26 tests |
| `scripts/ci/current-state-guard.mjs` | Extended to a three-state identity machine (see below) |
| `scripts/ci/current-state-guard.test.mjs` | 55 tests, incl. the owner-declared state and its half-applied transitions |
| `docs/runbooks/deployment-target-guard.md` | Identity states, owner upgrade procedure, preflight, stop conditions, Preview autopsy |

The guard compares **only non-secret routing identity** — the project ref inside
the Supabase URL. It never reads, requires or prints a key, and redacts
credential-shaped values. It reads all four target variables rather than the
first, because two variables disagreeing is precisely the ambiguity worth
catching. Production and non-production acceptance use **different** outcome
codes, so a preview verdict can never read as a production one.

Bound behaviour, all pinned by tests:

| Resolves to | Mode | Exit | Code |
| --- | --- | --- | --- |
| `ncyqqitqtsyjrijieykd` | production | 0 | `target_matches_canonical_production` |
| `ykdyqnvmwpxhowbwhzqz` | production | 1 | `target_is_preview` |
| `ssqrgfbhqfufnjrsjpgj` | production | 1 | `target_is_legacy` |
| nothing set | production | 1 | `target_absent` |
| two variables disagreeing | production | 1 | `target_ambiguous` |
| unregistered project | production | 1 | `target_unknown_to_registry` |
| `ncyqqitqtsyjrijieykd` | non-production | 1 | `target_is_not_canonical_production` |

`canonical_identity_unverified` remains reachable and tested: it fires if
`canonicalProductionRef` ever returns to `null`. The guard did not lose the
ability to fail closed by gaining a canonical answer. Tests also pin that
exactly one entry is `deployable`, and that the registry and the attestation
name the same project on the same authority — a half-applied identity update
fails.

### The attestation now has three identity states, not two

The old machine had only `UNVERIFIED` (`not_inspectable`) and `VERIFIED`
(`deployed_config`). An owner declaration is neither, and filing it as
`deployed_config` would have asserted that this environment read Railway, which
it did not. So the machine gained a third coherent state, `OWNER_DECLARED`,
which requires `independentRuntimeInspection`, `corroboration` and
`preDeploymentRequirement` alongside the usual tuple. `verificationPerformed`
stays the single state variable for "is there an established identity";
`evidenceClass` — already present and already validated — says on what
authority. No second boolean was introduced, because a duplicate flag is exactly
what drifts.

The guard rejects a registry entry whose role or evidence class names a
different authority than the section does, in either direction.

It is deliberately **not** wired into a deployment path, because no deployment
path exists in this repository. The runbook names it as preflight step 1 for the
future deployment work order.

## Verification

All local checks green — see the PR body for the table. No SQL, no schema
change, no generated-type change: migration 80 remains the tail, the contract
blob is unchanged at `784a10b`, ESC-002 remains retired, and receiving code is
untouched.

## Known limitations / remaining uncertainty

- **The deployed Railway runtime was never independently inspected here** (403
  to CONNECT). Identity rests on the owner's declaration plus catalog
  corroboration. This is a limitation on the *evidence class*, not an open
  question about *which project* is production, and it is exactly why preflight
  re-resolves the live target before any migration.
- Migration 80 is **not deployed**, and the three hosted receiving functions
  still carry unnamed parameters.
- After migration 80 is applied, PostgREST will keep answering `PGRST202` until
  its schema cache reloads — indistinguishable from the defect. Confirm the
  reload; see `docs/runbooks/receiving-rpc-dispatch.md`.
- The Preview integration could not be corrected from here — it needs Supabase
  dashboard admin. It remains externally connected to `ykdyqnvmwpxhowbwhzqz`,
  emits a permanent `skipped` no-op, and **is not production evidence**. The
  exact owner action is in the runbook.
- `ssqrgfbhqfufnjrsjpgj` was classified from project metadata only; its catalog
  was not read, because it belongs to a different product.
- Hosted PostgREST behaviour for the three RPCs was inferred from the catalog
  rather than exercised, deliberately.

## Exact next decision

Open a **separate migration-80 deployment and hosted-acceptance work order**. It
runs the preflight in `docs/runbooks/deployment-target-guard.md` — starting with
`npm run guard:target` exiting 0 *in the environment that will run the
migration* — applies migration 80, confirms the PostgREST schema-cache reload,
and verifies the three receiving RPCs resolve with named arguments.

Independently and separately, disconnect or repoint the Supabase Preview
integration.
