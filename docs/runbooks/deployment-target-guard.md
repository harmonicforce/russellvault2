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

## Current state: production identity is UNVERIFIED

`scripts/ci/deployment-targets.json` has `canonicalProductionRef: null`.

While it is null the guard **rejects every production target**, including the
strongest candidate. That is deliberate. An unproven canonical identity must
block deployment rather than wave a plausible answer through.

### What is known

| Project | Classification | Evidence |
| --- | --- | --- |
| `ncyqqitqtsyjrijieykd` (displayed `russellvault2-production`) | **UNKNOWN** — strongest candidate, not confirmed | Governed ledger 79/79 with the repository's tail; schema fingerprint identical to the repository's replayed schema; migration 80 not applied |
| `ykdyqnvmwpxhowbwhzqz` (displayed `The Russell Vault 2`) | **STALE_PREVIEW** | Governed ledger 40; 69 public tables; no receiving RPCs; target of the Supabase Preview check |
| `ssqrgfbhqfufnjrsjpgj` (displayed `TheRussellOps`) | **LEGACY_OR_DECOY** | A different product's project, INACTIVE |

Two traps are live here at once:

- the project that is **far behind** is displayed under a name that reads like
  the product; and
- the project that **matches the repository** is literally named
  `russellvault2-production`.

Selecting either on the strength of its name would be the same mistake. A schema
that matches the repository proves what a database *contains*, never which
database the deployed service is *configured to use*.

### Why it is still unverified

Every verifying environment so far has been refused by egress policy: the proxy
answers `403` to `CONNECT` for the live app host, and Railway environment
variables are not stored in this repository. That is a **not_inspectable**
blocker, recorded as such — never quietly converted into a conclusion.

## OWNER PROCEDURE — verifying production identity

Only an owner can do this, and it must be done from somewhere that can reach
Railway.

1. Open the Railway project → the **production** service → **Variables**.
2. Read the value of `VITE_SUPABASE_URL` (and `SUPABASE_URL` if set). **Do not
   paste keys, tokens or connection strings anywhere.**
3. Extract only the project ref — the 20-character label in
   `https://<ref>.supabase.co`.
4. Confirm the service is the one serving the live host, and note the
   environment name and deployed commit.
5. Cross-check by loading the live app and confirming the same ref appears in
   the bundle it serves.
6. Then, and only then, update **both** of these together:
   - `scripts/ci/deployment-targets.json` — set `canonicalProductionRef` to that
     ref, set that entry's `classification` to `CANONICAL_PRODUCTION` and
     `deployable` to `true`;
   - `docs/ai/CURRENT_STATE.attestation.json` — perform the full UNVERIFIED →
     VERIFIED transition (`verificationPerformed`, `canonicalProjectRef`,
     `evidenceClass: deployed_config`, `verifiedAtUtc`, `verificationMethod`,
     cleared blocker, and exactly one registry entry with role
     `deployed_production`). `scripts/ci/current-state-guard.mjs` enforces the
     whole tuple and rejects a half-applied transition.

If the two files disagree, the guards fail. That is the point.

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

1. Owner verification procedure above completed, both files updated together.
2. `npm run guard:target` exits 0 in the environment that will run the migration.
3. `node scripts/ci/current-state-guard.mjs` exits 0.
4. The exact commit has green required CI, named with run id **and attempt**.
5. Re-read the deployed Supabase URL immediately before acting and confirm it
   still matches — the attestation is historical evidence, not live authority.
6. Confirm the target's governed ledger is 79 and migration 80 is absent, so the
   migration is being applied to the state it was written against.

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
