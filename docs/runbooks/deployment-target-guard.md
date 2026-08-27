# Runbook: Deployment target guard and production identity

**Purpose:** make it impossible to deploy or migrate the wrong Supabase project
by accident, and record what is and is not known about which project is
production.

**Who runs this:** Kyle / an owner-admin. CI and Claude Code cannot deploy and
must never claim to have done so.

## The rule

> **A project name is not authority.** Neither is a dashboard listing, a
> remembered reference, an old document, or a green GitHub check.

Production identity is established in this order, and only the first item can
establish it:

1. the environment actually consumed by the deployed Railway service;
2. deployment metadata showing which environment/service is live;
3. the Supabase endpoint derived from that runtime configuration;
4. read-only catalog evidence from the project reached by that endpoint;
5. the repository attestation / target registry;
6. current operational documentation;
7. GitHub integration configuration;
8. historical documents, names, comments, memory.

## Current state: production identity is ESTABLISHED by owner declaration

`scripts/ci/deployment-targets.json` has:

```
canonicalProductionRef: "ncyqqitqtsyjrijieykd"
identityBasis:          "owner_declaration"
```

The repository owner declared which project is production. An owner knows their
own deployment; that is authority, and it settles the question. It is **not** a
reading of the deployed Railway runtime, and the attestation is required to keep
saying so — see *The three identity states* below.

### What is known

| Project | Classification | Evidence |
| --- | --- | --- |
| `ncyqqitqtsyjrijieykd` (displayed `russellvault2-production`) | **CANONICAL_PRODUCTION** | Owner declaration, corroborated by read-only catalog: governed ledger 79/79 with the repository's tail; 119 public tables with a fingerprint identical to the local replay; 54 enums; 17 views; 4/4 marker tables; 8 receiving RPCs; migration 80 not applied |
| `ykdyqnvmwpxhowbwhzqz` (displayed `The Russell Vault 2`) | **STALE_PREVIEW** | Governed ledger 40; 69 public tables; no receiving RPCs; target of the Supabase Preview check |
| `ssqrgfbhqfufnjrsjpgj` (displayed `TheRussellOps`) | **LEGACY_OR_DECOY** | A different product's project, INACTIVE |

Two traps sit next to each other, and both are still live:

- the project that is **far behind** is displayed under a name that reads like
  the product; and
- the project that **matches the repository** is literally named
  `russellvault2-production`.

The canonical project was selected on the owner's declaration, **not** on its
name — and the guard never reads a name. A schema that matches the repository
proves what a database *contains*, never which database the deployed service is
*configured to use*; that is why the catalog evidence is recorded as
corroboration and not as the basis.

### The three identity states

`docs/ai/CURRENT_STATE.attestation.json` distinguishes three, and
`scripts/ci/current-state-guard.mjs` enforces the whole tuple of each:

| State | Meaning |
| --- | --- |
| `UNVERIFIED` | Nobody has established an identity. No ref, no production role, no document may assert one. |
| `OWNER_DECLARED` | **Where this repository is today.** The owner declared the canonical project. Requires `independentRuntimeInspection`, `corroboration` and `preDeploymentRequirement` to be populated. |
| `RUNTIME_VERIFIED` | The ref was read from the environment the deployed service actually consumes. |

A half-applied transition fails CI rather than half-asserting an identity, and
the registry entry's role and evidence class must name the **same** authority as
the section — an owner declaration cannot be filed as a runtime reading, or the
reverse.

### What has NOT been done

**The deployed Railway runtime has never been independently inspected.** Every
verifying environment has been refused by egress policy: the proxy answers `403`
to `CONNECT` for the live app host, and Railway environment variables are not
stored in this repository. This limitation stands, is recorded in
`deploymentIdentity.independentRuntimeInspection`, and is pinned by a test.

This does not reopen the identity question — the owner settled it. It is why
preflight step 5 below is not optional: the guard must still resolve the target
from the live environment immediately before any migration, because a
declaration fixes the expected answer without confirming that the environment in
front of you matches it.

## OWNER PROCEDURE — upgrading to RUNTIME_VERIFIED

Optional, and worth doing the next time an owner is at a machine that can reach
Railway. It does not change *which* project is canonical — the owner already
settled that — it upgrades the **evidence** behind it from a declaration to a
reading of the deployed runtime, and closes the one gap this repository still
has.

1. Open the Railway project → the **production** service → **Variables**.
2. Read the value of `VITE_SUPABASE_URL` (and `SUPABASE_URL` if set). **Do not
   paste keys, tokens or connection strings anywhere.**
3. Extract only the project ref — the 20-character label in
   `https://<ref>.supabase.co`.
4. Confirm the service is the one serving the live host, and note the
   environment name and deployed commit.
5. Cross-check by loading the live app and confirming the same ref appears in
   the bundle it serves.
6. If the ref read there is **not** `ncyqqitqtsyjrijieykd`, **stop and treat it
   as an incident**: the declared canonical identity and the deployed runtime
   disagree, and nothing may be deployed or migrated until that is resolved.
7. Otherwise update **both** files together:
   - `scripts/ci/deployment-targets.json` — set `identityBasis` to
     `deployed_config` and update `identityBasisNote`;
   - `docs/ai/CURRENT_STATE.attestation.json` — move `evidenceClass` to
     `deployed_config`, change the canonical registry entry's role to
     `deployed_production` and its evidence class to `deployed_config`, and set
     `verifiedAtUtc`, `verificationMethod` and `authoritativeSource` to the
     runtime read.

If the two files disagree — or if one half says `owner_declaration` while the
other says `deployed_config` — the guards fail. That is the point.

### To change WHICH project is canonical

Only the owner may. Update `canonicalProductionRef` and the matching
attestation fields together, and reclassify the outgoing project. The guards
reject a half-applied change.

## Using the guard

```bash
npm run guard:target          # production mode — must pass before any deploy
node scripts/ci/production-target-guard.mjs --non-production   # preview/shadow
```

It reads `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_PROJECT_REF` and
`SUPABASE_DB_URL` from the environment it is run in, resolves each to a project
ref, and compares. It never reads, requires or prints a key, and redacts
credential-shaped values before printing.

Bounded outcome codes: `target_matches_canonical_production`,
`non_production_target_accepted`, `canonical_identity_unverified`,
`target_absent`, `target_malformed`, `target_ambiguous`,
`target_is_known_decoy`, `target_is_preview`, `target_is_legacy`,
`target_unknown_to_registry`, `target_is_not_canonical_production`,
`registry_invalid`.

Production acceptance and non-production acceptance use **different** codes, so
no log line can make a preview verdict read as a production one.

Observed behaviour today:

| Environment resolves to | Mode | Exit | Code |
| --- | --- | --- | --- |
| `ncyqqitqtsyjrijieykd` | production | 0 | `target_matches_canonical_production` |
| `ykdyqnvmwpxhowbwhzqz` | production | 1 | `target_is_preview` |
| `ssqrgfbhqfufnjrsjpgj` | production | 1 | `target_is_legacy` |
| nothing set | production | 1 | `target_absent` |
| two variables disagreeing | production | 1 | `target_ambiguous` |
| `ncyqqitqtsyjrijieykd` | non-production | 1 | `target_is_not_canonical_production` |

`canonical_identity_unverified` is still reachable and still tested: it fires if
`canonicalProductionRef` is ever returned to `null`. The guard did not lose the
ability to fail closed by gaining a canonical answer.

## The Supabase Preview check — what it proves

**Nothing about production. Nothing about this repository's schema.**

The check named **"Supabase Preview"** on pull requests is produced by the
Supabase GitHub integration installed on `ykdyqnvmwpxhowbwhzqz`. Its own output
says:

> Creating a new preview branch per PR is disabled. You can re-enable it in
> Project Integrations Settings.

So it is a permanent `skipped` no-op: it creates no preview branch, deploys
nothing, and mutates nothing. Its configuration lives in the Supabase dashboard,
not in this repository — there is no integration config in `.github/`, and
`supabase/config.toml` names only the local stack.

It is **not required** and cannot block a merge. The hazard is purely
interpretive: sitting beside four required jobs, a check with a Supabase logo
reads like hosted-database evidence. It is not, and a reviewer or agent should
never count it as one.

### OWNER ACTION REQUIRED (external, cannot be done from this repository)

Correcting the integration needs Supabase dashboard admin on that project.
Choose one:

- **Disconnect it** — Supabase dashboard → project `ykdyqnvmwpxhowbwhzqz` →
  *Settings → Integrations → GitHub* → disconnect this repository. Recommended
  if preview branching is not wanted; it removes a misleading check entirely.
- **Repoint it** at a project deliberately designated non-production and kept
  migration-compatible with `main`, and re-enable preview branching there.

**Do not repoint it at production**, do not give preview builds production
credentials, and do not copy production data into preview.

## Deployment preflight (for the future migration-80 work order)

Run in order; any failure stops the deployment.

1. `npm run guard:target` exits 0 **in the environment that will run the
   migration** — not in some other shell. This is the step that turns a
   declaration into a check: it must print
   `OK (target_matches_canonical_production) target=ncyqqitqtsyjrijieykd`.
2. `node scripts/ci/current-state-guard.mjs` exits 0.
3. The exact commit has green required CI, named with run id **and attempt**.
4. Confirm the target's governed ledger is 79 and migration 80 is absent, so the
   migration is being applied to the state it was written against.
5. Re-read the deployed Supabase URL immediately before acting and confirm it
   still matches — the attestation is historical evidence, not live authority,
   and identity here rests on a declaration rather than a runtime reading.
6. After applying: confirm PostgREST has reloaded its schema cache, then verify
   the three receiving RPCs resolve with named arguments.

### Stop conditions

Stop, and do not deploy, if any of these hold:

- the guard returns anything other than `target_matches_canonical_production`;
- two variables resolve to two different projects;
- the target's governed ledger is not the expected 79, or migration 80 is
  already present;
- the ref read live differs from the recorded canonical ref;
- CI on the exact commit is not green, or is green only after an undisclosed
  rerun;
- anything requires a mutation in order to establish identity.

## After deploying migration 80

PostgREST caches the schema. Until it reloads, the three repaired receiving RPCs
keep answering `PGRST202` — indistinguishable from the defect. See
`docs/runbooks/receiving-rpc-dispatch.md`.
