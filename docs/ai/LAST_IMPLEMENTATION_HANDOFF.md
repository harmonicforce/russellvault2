# Last Implementation Handoff

## Surrender state

- Repository / canonical branch: `harmonicforce/russellvault2`, `main`
- **Actual base SHA: `f96d51d4a7d5b53f32d890704d60778de18f819e`** (`origin/main`,
  fetched this session).
- **Not stacked.** The work order anticipated stacking on PR #38, but **PR #38
  merged before this task started**: `main` moved from `1a3e27b` to `f96d51d`,
  which is the merge commit for `claude/s0-1-legacy-boot-write-safety`, and the
  S0.1 head `6083cbf94b927aa16ac0b001df3deb7ad4f110f4` is contained in it
  (`git merge-base --is-ancestor` confirms). So this branch is cut from current
  `main` and the PR targets `main` directly.
- Work order: Commercial Core & Legacy Retirement Program — **S0.2, Client
  Data-Path Truth, Health Failure Visibility, and Fail-Closed Configuration**
- Implementation branch: `claude/s0-2-client-data-path-truth`
- Pull request: **draft**, into `main`. Not to be merged.
- Repository migration count: **60 → 60.** `supabase/` is byte-identical to
  `main`; `supabase/tests/06_provenance_structure.sql` unchanged.
- pgTAP files: 54 → 54.
- **`server/` is byte-identical to `main`.** No S0.1 server behaviour, no
  `/api/health` field and no status code was changed by this PR.
- Hosted Supabase parity: not checked and not claimed. No hosted project
  contacted.
- Railway: not deployed, not restarted, not reconfigured; no variable changed.
- Hosted acceptance: **not run**, for S0.1 or S0.2. No acceptance evidence for
  S0.1 exists in the repository at the time of writing, so the hosted checklist
  below is recorded rather than performed.
- Production data, configuration and secrets: untouched. **No production
  database was accessed and no backup was captured — S0.3 remains outstanding.**
- `docs/ai/CURRENT_STATE.md`: **not edited.** Proposed replacement text is at the
  end of this document.
- **S1 was not started.**

## Previous false client claims

`client/src/lib/dataAdapter.ts` stated, in a comment and in three exports:

> The legacy SQLite REST adapter (lib/api.ts → /api → server/src) is the ONLY
> read and write path for business data. The Supabase shadow database is
> non-authoritative: the client touches it solely for authentication and
> workspace-membership checks inside the auth shell. There is deliberately no
> shadow data adapter and no dual-write path.

```ts
export const DATA_BACKENDS = ['legacy-sqlite-rest'] as const;
export function activeDataBackend(): DataBackend { return 'legacy-sqlite-rest'; }
export const SHADOW_WRITES_ENABLED = false as const;
```

Every one of those was false by the time governed intake, current inventory,
locations, movement, media, corrections, cycle counts and Listing Prep shipped.
Worse, they were **CI-enforced**: `client/src/lib/authShell.test.ts` and
`client/src/lib/provenanceConfig.test.ts` both asserted them, so correcting the
architecture would have failed the build.

Four further comments repeated the same claim and were corrected:
`client/src/lib/authShell.ts` ("the legacy SQLite REST adapter remains the only
data path"), `client/src/lib/supabaseShadow.ts` and
`client/src/lib/shadowConfig.ts` ("the deployed default remains the legacy
SQLite app"), `client/src/lib/provenanceApi.ts` ("those remain exclusively on
the legacy SQLite REST path"), and `docs/supabase-shadow-foundation.md:197`.

## Corrected data topology

`client/src/lib/dataTopology.ts` replaces `dataAdapter.ts`. Two backends, and
authority is a property of a **domain**:

| Backend | Domains | Authoritative | Writes implemented |
|---|---|---|---|
| `governed-supabase` | inventory-identity, intake, current-inventory, locations, movement, media, corrections, cycle-counts, listing-prep, readiness, operations-dashboard | **yes** | yes |
| `legacy-sqlite-rest` | legacy-inventory, legacy-purchases, legacy-cost-links, legacy-listings, legacy-sales, legacy-checks, legacy-dashboard | **no** | yes |

- **There is no zero-argument global-backend function.** `activeDataBackend()`
  is gone and a test asserts the module does not export it, because no honest
  answer exists without a domain. `backendForDomain(domain)` requires one.
- **No third backend was invented.** Routing between the two is a property of
  this application; a test asserts no backend name matches
  `/hybrid|both|routed|mixed/i`.
- **`SHADOW_WRITES_ENABLED` was not flipped to `true`.** It conflated "does the
  client write to Supabase" (it does) with "does the client write the same fact
  to both systems" (it does not). It is replaced by two separate facts:
  `GOVERNED_WRITES_IMPLEMENTED = true` and `DUAL_WRITES_ENABLED = false`.
- **The no-dual-write invariant is computed, not asserted.**
  `domainsWithMultipleAuthoritativeWriters()` derives from the map and is
  required by test to be `[]`.
- **Authority does not depend on configuration.** A test snapshots the map,
  resolves availability for all three modes, and requires the map unchanged.
  `backendAvailability(mode)` is the separate, configuration-dependent answer.
- **Permission coupling is `false` in both directions**
  (`PERMISSIONS_ARE_COUPLED`): a governed write never requires
  `ALLOW_LEGACY_WRITES`, and a legacy HTTP write never implies a governed write.

## Configuration-state contract

`client/src/lib/appConfig.ts`, resolved before any client is constructed:

| Mode | Condition |
|---|---|
| `governed` | `VITE_SHADOW_AUTH=supabase`, `VITE_SHADOW_IMPORT=repository-fixtures`, non-empty `VITE_SUPABASE_URL`, non-empty `VITE_SUPABASE_ANON_KEY` |
| `legacy-only` | **none** of the four present (`undefined` or `''`) |
| `misconfigured` | anything else |

Whitespace-only URL or key is **present-but-invalid**, not absent. The
misconfigured state carries `missing[]` and `invalid[]` as **field names only**;
two tests assert that neither the URL value nor the anon-key value nor a
rejected flag value appears in the serialized state or the rendered screen.

Environment variables were **not renamed** and no feature flag was removed, per
the work order.

### Fail-closed behaviour

`AuthShell` now resolves the mode first and branches before the governed shell
mounts:

- `misconfigured` → full-screen `role="alert"` configuration error. **No routes
  render, no sign-in form appears, no Supabase client is constructed, and no
  request of any kind is issued** — asserted with spies on
  `createShadowClient`, `createShadowSupabaseClient`, `api.get` and global
  `fetch`, across six distinct partial configurations.
- `legacy-only` → children render, no Supabase client is constructed at all.
- `governed` → the existing auth flow, unchanged.

The previously reachable path — complete auth configuration but missing
`VITE_SHADOW_IMPORT` — used to construct a real Supabase client and then serve
the legacy application. It is now the headline misconfiguration case.

## Health transport behaviour

`client/src/lib/healthApi.ts`:

| Response | Outcome |
|---|---|
| 200 + valid body + `ok: true` | `{ status: 'healthy', health }` |
| 200 + valid body + `ok: false` | `{ status: 'unhealthy', health }` — resolved in the safe direction |
| 503 + valid body | `{ status: 'unhealthy', health }` |
| 503 + malformed body, HTML, or `{ error }` envelope | `HealthTransportError('protocol')` |
| any other status | `HealthTransportError('protocol')` |
| network failure | `HealthTransportError('network')` |

Every declared boolean must actually be a boolean. An unrecognized `reason`
string is **dropped** rather than passed through, so no unvalidated server text
can be rendered as an explanation — the unhealthy state is still reported. The
error type carries no server text at all.

`get()` in `api.ts` is **unchanged**, so no other endpoint gained permission to
return 503; a test proves an ordinary 503 still rejects.

One shared `SYSTEM_HEALTH_QUERY_KEY` and one transport, so multiple consumers
cannot issue duplicate requests.

## System-status states

`client/src/components/SystemStatusBanner.tsx` replaces `ReadOnlyBanner.tsx`.
One banner, fixed precedence, never two contradicting each other:

1. **Structured legacy failure** (503) — `role="alert"`, critical, **shown on
   every route including governed ones**. Bounded reason mapped to fixed safe
   copy. On a legacy route: "this page cannot show reliable legacy data … do not
   read an empty list or a zero total as a real value." On a governed route: the
   same unavailability plus "Governed inventory workflows are unaffected."
2. **Unverifiable health** (network or protocol error) — `role="alert"`,
   warning, with a **Retry** button wired to the React Query refetch. Never
   reinterpreted as `readOnly: false`, and never blank.
3. **Legacy-only mode** — persistent notice: non-authoritative, governed
   workflows unavailable, totals must not be combined. When `readOnly` is also
   true the read-only sentence is folded into the **same** banner.
4. **Governed + healthy + `readOnly` + legacy write route** — the existing
   read-only warning, unchanged in meaning.

Otherwise nothing renders. Nothing is dismissible; meaning is carried in text,
not colour alone.

## Tests

**Focused S0.2 — 117 tests across 5 files, all passing:**

| File | Tests | Covers |
|---|---|---|
| `client/src/lib/dataTopology.test.ts` | 39 | both backends represented; no invented third backend; per-domain authority for all 18 domains; governed writes implemented; dual writes disabled; no domain with two authoritative writers; authority unchanged by any flag; availability separate from authority; `activeDataBackend`/`SHADOW_WRITES_ENABLED` absent from the module |
| `client/src/lib/appConfig.test.ts` | 20 | legacy-only; governed; every one-variable-missing permutation; wrong flag values; whitespace-only URL and key; URL+key without flags; flags without URL+key; no value ever leaked |
| `client/src/lib/healthApi.test.ts` | 24 | 200 healthy; defined 503 structured; all five bounded reasons; unknown reason dropped; malformed 503, HTML 503, non-boolean fields, unexpected status all rejected; network vs protocol distinct; no server text on the error; generic `get()` still rejects an ordinary 503 |
| `client/src/components/SystemStatusBanner.test.tsx` | 24 | rendered: read-only on legacy vs governed routes; legacy-only notice; one coherent notice when legacy-only + read-only; structured 503 on both route kinds; each reason's copy; no raw text; network/protocol warning; retry refetch; never silently blank; `role="alert"`; no dismiss control; plus the legacy write-path scope rules carried over |
| `client/src/components/AuthShell.render.test.tsx` | 10 | rendered: legacy-only renders children with no client constructed; governed gates behind auth and constructs clients; six misconfigurations each render the error and construct no client; no `api.get` and no `fetch`; no auth form; field names only; explains the no-fallback rule; `role="alert"` |

**Rewritten rather than deleted:** `authShell.test.ts` and
`provenanceConfig.test.ts` had their false assertions replaced with stronger
truthful ones — per-domain ownership, governed-vs-legacy authority, governed
writes implemented, dual writes disabled, no domain with two authoritative
writers, and that toggling the review flag moves no domain's owner.

**Updated mocks:** `App.responsive.test.tsx` (legacy-only) and
`App.governedNav.test.tsx` (governed) now mock `./lib/appConfig` and
`./lib/healthApi`, because `App.tsx` derives `PROVENANCE_ENABLED` from the
single config resolver rather than from `isProvenanceUiEnabled`. Both suites
remain green.

## Verification

All three dependency roots installed (`npm ci`, `npm ci --prefix client`,
`npm ci --prefix server`).

| Command | Result | Exit |
|---|---|---|
| `npm run lint` | pass (pre-existing warnings only) | 0 |
| `npm run typecheck` | pass (server + client) | 0 |
| `npm run build:ci` | pass | 0 |
| `npm test` | **server 461 / 30 files, client 554 / 37 files**, guard suites — all pass | 0 |
| focused S0.2 suites | **117 passed / 5 files** | 0 |
| rewritten + updated suites | 49 passed / 4 files | 0 |
| `node --test scripts/db/guard.test.mjs` | pass | 0 |
| `node --test scripts/ci/client-audit-gate.test.mjs` | pass | 0 |
| `git diff --check` | clean | 0 |
| `npm run db:reset` (postgres-shim tier) | 60 migrations replayed from empty | 0 |
| `npm run db:test` (postgres-shim tier) | 54 files, **1,625 assertions** | 0 |
| `ls supabase/migrations/*.sql \| wc -l` | 60, unchanged | — |
| `git diff --name-only origin/main -- supabase server` | empty | — |

Client tests grew 441 → 554 (+113).

**`shadow-db-supabase-stack` was NOT run locally** and is not claimed to have
passed locally — it needs a Docker-local Supabase stack this environment cannot
start. Exact-head GitHub CI is the evidence for that tier. Since `supabase/` is
byte-identical to `main`, the database tiers re-prove `main` rather than
anything this PR changed.

### `15_acquisition_digest_parity.sql` recurred, for the third recorded time

On the first PR-triggered run, `shadow-db-supabase-stack` failed: the step timed
out after 12 minutes with the suite sitting on
`supabase/tests/15_acquisition_digest_parity.sql`. Every preceding file passed.
It is green on re-run (4m20s) and was green first-time on the
push-triggered run of the **same commit**.

This is the same intermittent slowdown already recorded against that file — it
has previously exceeded a 600s per-file timeout in one run while completing in
6.7s standalone and passing on a second run. Four things establish that this
occurrence is not a regression from S0.2:

1. `git diff --name-only origin/main -- supabase` is **empty** — this PR cannot
   change the behaviour of a pgTAP file it does not touch.
2. The push-triggered run on the identical SHA passed that job first time.
3. The local postgres-shim tier passed all 54 files including that one.
4. The PR run's own `shadow-db-postgres-shim` passed.

It remains an open flake in the suite, not an S0.2 finding, and it is worth the
steward's attention as a recurring pattern rather than a one-off.

## Limitations

- **Repository verification only.** Nothing here proves hosted behaviour.
- **S0.1 hosted acceptance has not been recorded**, so the S0.2 hosted checklist
  cannot begin. S0.1 merged on CI evidence alone.
- The `misconfigured` screen is deliberately not reachable in production without
  breaking a variable, and the work order forbids testing it that way. It is
  covered locally and in CI only.
- The banner's precedence is fixed rather than configurable. A structured legacy
  failure outranks the legacy-only notice, which is correct but means the
  legacy-only framing is temporarily hidden during an outage.
- `isProvenanceUiEnabled` still exists and is still used by four pages
  (`ImportReview`, `InventoryIdentity`, `Dashboard`, `Workbench`) for their own
  Supabase configuration. It is no longer the application's configuration gate.
- The `SHADOW_` variable-name prefix survives; renaming is out of scope because
  the deployed service sets those names.
- No business mutation path was added anywhere. There is no synchronization
  layer, no mirrored write, no fallback write and no repository abstraction that
  conceals authority.

## Rollout sequencing

S0.2 is client-only and depends on the S0.1 server contract already merged in
`main`. It must not deploy before S0.1 hosted acceptance is recorded, because
the 503 handling it adds is only meaningful against the S0.1 server, and because
S0.3's backup should exist before any further production change.

## Rollback

Client and repository only.

1. Revert the S0.2 merge.
2. Redeploy the previous accepted commit.
3. Do **not** change SQLite. Do **not** change Supabase.
4. Do **not** alter Railway environment variables as a rollback shortcut — in
   particular, do not remove a governed variable to force legacy-only mode.
5. Do **not** enable automatic seeding. Do **not** restore data.

Reverting is safe: nothing in this change writes to any database.

## Hosted acceptance checklist (owner — not performed)

Do not begin until S0.1 hosted acceptance is recorded and the S0.3 backup exists.

1. Confirm PR #38 hosted acceptance is recorded.
2. Confirm the fresh verified S0.3 production backup exists.
3. Merge or rebase S0.2 onto accepted `main`.
4. Confirm the final S0.2-only diff.
5. Confirm all four required CI jobs green on the final exact head.
6. Deploy the reviewed merge.
7. Confirm `/api/version` reports the merge SHA.
8. With full governed configuration: sign-in required, workspace loads, governed
   routes visible, **no legacy-only warning**.
9. With `/api/health` 200: read-only warning appears on a legacy write route and
   **not** on Current Inventory or Listing Prep.
10. Confirm legacy pages still load existing data.
11. Confirm governed pages still read and write through Supabase.
12. Confirm no write is duplicated into both systems.
13. Confirm Railway remains healthy.
14. Record acceptance evidence before S1.

**Do not deliberately break a production environment variable to test the
misconfigured path.** That is covered locally and in CI.

## Proposed `CURRENT_STATE.md` replacement text

Not applied. `AGENTS.md` reserves that file for the state steward. It remains
stale in two checkable ways: it records a repository migration count of **47**
when the directory holds **60**, and a last-reviewed merge of PR #25 when PR #37
and PR #38 have both merged.

**Replace "Deployment and verification" with:**

> - Repository: `harmonicforce/russellvault2`
> - Canonical and GitHub default branch: `main`
> - Railway source branch: `main`
> - Live app: `https://russellvault2-production.up.railway.app`
> - Supabase project: `ykdyqnvmwpxhowbwhzqz`
> - Last reviewed merge: `f96d51d4a7d5b53f32d890704d60778de18f819e` (PR #38, S0.1)
> - Repository migration count: **60**
> - pgTAP files: **54**
> - Exact PR-head CI run: *(steward to record for PR #38 and the S0.2 PR)*
> - Known flake: `supabase/tests/15_acquisition_digest_parity.sql` has now timed
>   out in three separate runs while passing standalone, on re-run, and on the
>   sibling run of the same commit. It is unrelated to the changes in the PRs it
>   has failed on.
> - Required jobs: build-and-verify, shadow-db-postgres-shim,
>   shadow-db-supabase-stack, dev-advisory-report
> - Railway deployment status on the reviewed merge: *(steward to record)*
> - Hosted acceptance: **not recorded for S0.1.** It merged on CI evidence
>   alone; the hosted checklist in `LAST_IMPLEMENTATION_HANDOFF.md` is
>   outstanding.

**Add to the "Legacy retirement program" section:**

> **S0.1 is merged (PR #38).** Legacy boot writes are gated behind
> `SEED_LEGACY_ON_EMPTY`, separate from `ALLOW_LEGACY_WRITES`; the connection
> opens `fileMustExist` and `PRAGMA query_only` when neither permission is
> granted; `GET /api/health` returns 503 with a bounded reason code when the
> legacy database is unusable. **Hosted acceptance is not yet recorded.**
>
> **S0.2 is implemented on a draft PR and is not merged.** Once merged and
> accepted:
>
> - The client no longer claims legacy SQLite is the only business-data
>   backend. `client/src/lib/dataTopology.ts` maps 18 domains to two backends,
>   with governed Supabase authoritative for its eleven and legacy SQLite
>   authoritative for none. There is no global "active backend" function.
> - A **partial** governed client configuration fails closed with a
>   configuration-error screen instead of silently serving the unauthenticated
>   legacy application. Legacy-only operation is still permitted but is labelled
>   on screen as non-authoritative.
> - The client consumes the S0.1 503 as structured data rather than discarding
>   it, and a legacy-database failure now produces a persistent critical alert
>   on every route instead of a banner that disappeared.
>
> **Still outstanding, in order:** S0.1 hosted acceptance; **S0.3 — the owner has
> still not captured a fresh verified production backup**, which remains the
> highest-priority action in the program; then S0.2 review, merge and acceptance.
> S0 is not complete until all three are done.

## Owner actions carried forward

1. **S0.3 — capture and verify a SQLite export, `sales` included.** Still not
   done. Still the highest-priority action in the program.
2. Record S0.1 hosted acceptance for PR #38.
3. Review and merge the S0.2 draft PR, then run its hosted checklist.
4. `docs/ai/CURRENT_STATE.md` is stale; proposed replacement text is above.
5. Blocking owner decisions D-1, D-2, D-4, D-5, D-7, D-8, D-9, D-10, D-12, D-16
   and D-19 remain open. D-17 was answered by S0.1.
