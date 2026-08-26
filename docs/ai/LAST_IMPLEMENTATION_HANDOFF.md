# Last Implementation Handoff

## Receiving RPC Dispatch Repair — ESC-002

- Repository: `harmonicforce/russellvault2`; canonical branch: `main`.
- Branch: `claude/wo-esc002-receiving-rpc-dispatch`.
- Base SHA: `43ca11400dca6f5fd28859bf5181e6d9811b5f7a` — current `main`, the merge
  of PR #81 (Work Order 3), read from GitHub 2026-08-26T04:57Z.
- Release authority: branch and draft PR only. No merge, no deploy, no Railway
  change, no hosted Supabase contact.
- Status: **implemented** and **validated** locally; CI evidence below.

### Preconditions, verified rather than assumed

PR #81 reported `merged: true`, `state: closed`, merged 2026-08-26T04:07:14Z,
head `ec09e6732c01378cf59c25a1cfea53f99b2d4f63` — matching the expected WO3
head — and `ec09e673` is an ancestor of `main`. `main` CI: run `32929009096`,
**attempt 1**, success, no earlier attempt.

## The defect

`20260808000100_s2_receiving_functions.sql` declared three governed receiving
wrappers with a bare type list and no parameter names:

```sql
create function public.submit_acquisition_receipt(uuid,text) ...
create function public.cancel_acquisition_receipt(uuid,text,text) ...
create function public.reconcile_acquisition_receipt(uuid,text) ...
```

Every other function in that file names its parameters. These three did not, so
`pg_proc.proargnames` was `NULL`. PostgREST resolves a JSON-body RPC by matching
the body's keys to parameter **names**, and the only alternative convention — a
single unnamed `json`/`jsonb` parameter — does not apply to `(uuid,text)` or
`(uuid,text,text)`. All three were therefore uncallable through the transport
the server uses.

### Why pgTAP missed it

The pgTAP suite calls these functions **positionally from SQL**, where unnamed
parameters are legal. The database semantics were never broken — only the
dispatch membrane — so 2,673 assertions stayed green over three dead endpoints.
A governed function's SQL semantics and its transport dispatchability are
separate properties; proving the first says nothing about the second.

### Why the generated contract exposed it

Work Order 4 generated `shared/database.types.ts` from the catalog. The
generator emits what PostgREST can call, so all three came back **absent** while
their named siblings were present. That absence was evidence about the
**database**, not a limitation of the generator — which is why the correct fix
was a migration and not a cast.

## Baseline reproduction (PROVEN)

Reproduced against the unmodified baseline: 79 migrations replayed from empty on
local PostgreSQL, real **PostgREST 13.0.7** in front of it, schema cache freshly
loaded (155 functions).

| Probe | Token | Result |
| --- | --- | --- |
| `open_acquisition_receipt` (named sibling, control) | operator | `42501` / **403** `workspace not found or not authorized` |
| `link_acquisition_receipt_inventory` (named sibling, control) | operator | `42501` / **403** |
| `submit_acquisition_receipt` | operator | **`PGRST202` / 404** |
| `reconcile_acquisition_receipt` | operator | **`PGRST202` / 404** |
| `cancel_acquisition_receipt` | operator | **`PGRST202` / 404** |

The `PGRST202` details named the very parameters searched for. Catalog:
`proargnames IS NULL` for all three; exactly one overload each; no dependents.
Positional SQL entered the function body and failed inside
`app.assert_workspace_role`, i.e. at domain validation rather than resolution.

**This rules out every alternative cause.** The controls used the *same* token,
the *same* nonexistent workspace, and the *same* schema cache, and they passed
through authentication, RLS, workspace authorization and into business
validation. The targets never got that far. Overload ambiguity is excluded by
the catalog (one each); staleness by the freshly loaded cache; fixture state by
the controls sharing it.

## The repair

`supabase/migrations/20260826000100_receiving_rpc_named_parameters.sql`, one
forward-only migration.

**`CREATE OR REPLACE`, not DROP.** PostgreSQL refuses to *rename* an existing
input parameter but permits *adding* a name to one that had none — exactly this
case, verified empirically before choosing it. Consequences: function identity
unchanged, so nothing referencing it needs rebuilding; the ACL survives, so no
re-`GRANT` can widen or narrow it by accident; no window where the governed
function does not exist; no `CASCADE`.

Bodies keep their `$1/$2/$3` references, so the change is provably
interface-only. The migration then **asserts its own postcondition** against
`pg_proc` and fails if any parameter is still unnamed, so it cannot report
success over a partially applied state.

### Before and after

| Function | Before | After |
| --- | --- | --- |
| `submit_acquisition_receipt` | `(uuid, text)` | `(p_workspace_id uuid, p_receipt_public_id text)` |
| `cancel_acquisition_receipt` | `(uuid, text, text)` | `(p_workspace_id uuid, p_receipt_public_id text, p_reason text)` |
| `reconcile_acquisition_receipt` | `(uuid, text)` | `(p_workspace_id uuid, p_receipt_public_id text)` |

Names are not invented for the generator: they are what the delegate
`app.transition_receipt(p_workspace_id, p_receipt_public_id, p_action, p_reason)`
uses, what every sibling in the S2 migration uses, and what
`server/src/routes/receiving.ts` was already sending.

### Preserved, verified in the catalog before and after

Identical across all three: `SECURITY DEFINER` (`prosecdef=t`), volatile
(`v`), parallel unsafe (`u`), not strict (`f`), not leakproof (`f`), language
`sql`, owner unchanged, `proconfig = search_path=""`, returns `jsonb`, ACL
`owner=X/owner | authenticated=X/owner`, no comments before or after, one
overload each, zero dependents. Replay-from-empty and
upgrade-from-the-previous-schema were both exercised and both produce the same
catalog state.

## Security review

- **SECURITY DEFINER**, deliberately and unchanged. Authorization is enforced
  *inside* the function by `app.assert_workspace_role`, which resolves the
  caller from `auth.uid()` — i.e. from the token's own `sub` — and checks
  `workspace_members` for the **named** workspace. A caller cannot reach another
  workspace by naming it.
- **`search_path=''`** is retained, so every object reference must be
  schema-qualified and object shadowing is not possible. The bodies reference
  `app.transition_receipt` fully qualified.
- **Executable roles unchanged:** `authenticated` only. `anon` is not granted,
  and `PUBLIC` is not granted. Asserted in pgTAP and exercised over HTTP.
- **No service-role anywhere** — not in the server, and deliberately not in the
  transport harness, where it would let an unauthorized call look successful.
- **Error disclosure unchanged:** bounded codes (`receipt_not_found`,
  `receipt_not_open`, `receipt_not_submitted`, `invalid_request`, `42501`).

No security semantics were changed. The repair alters the dispatch membrane
only.

## Coverage added

| Layer | File | Count |
| --- | --- | --- |
| Catalog | `supabase/tests/71_receiving_rpc_dispatch.sql` | 27 assertions |
| Transport | `scripts/db/transport/` (real HTTP, real PostgREST) | 17 tests |
| Compile time | `scripts/ci/type-negative.test.mjs` | 5 new cases + a group control |

The catalog test covers **every** governed receiving RPC, not only the three
that were broken, so a fourth declared without names would fail there rather
than in production.

**The transport suite is not vacuous:** it fails **14 of 17** against the
unrepaired baseline and passes **17 of 17** after the repair. The three that pass
either way are the missing/misspelled/unknown-argument cases, which are
`PGRST202` in both worlds and are meaningful only alongside the resolution test.

## The generated contract

Regenerated by the pinned CLI (2.109.1) from the schema replayed from empty. The
diff adds exactly three `Functions` entries and changes nothing else.

Docker image pulls are blocked in the agent environment (the egress policy
answers `403` at the registry blob layer for both `public.ecr.aws` and Docker
Hub), so the file could not be produced locally — the same constraint Work Order
4 recorded. It was generated by a temporary CI step, recovered from that job's
own `git diff`, applied as a patch, and confirmed **byte-for-byte** by git blob
hash `784a10b`, matching the object CI produced. It was **not** hand-edited. The
temporary steps have been removed; `db:types:check` verifies the committed bytes
on every run.

## ESC-002 retired

Removed from `docs/ai/TYPE_ESCAPE_MANIFEST.md` — not reworded — because its
cause is gone. `UncontractedRpcName`, `LooseRpc`, `rpcNotInContract` and the
`client.rpc as LooseRpc` cast are deleted from `server/src/rpcContract.ts`, and
`rpcUncontracted` is deleted from `server/src/routes/receiving.ts`; all three
call sites now use the ordinary typed `rpc()` path. **No replacement cast.**
The retired entry is recorded under a heading that deliberately does not match
the guard's `### ESC-nnn` form, so a retired id cannot be referenced by code as
if it were live. **ESC-001 and ESC-003 are untouched.**

## Verification (local, all exit 0)

| Command | Result |
| --- | --- |
| `npm ci` (root, client, server) | 0 |
| `npm run lint --prefix client` | 0 |
| `npm run typecheck` | 0 |
| `npm run build:ci` | 0 |
| `npm test` | server **1134**/41 files, client **1637**/68 files, node guards **154** |
| `npm run guard:escapes` | 0 — 2 registered escapes (ESC-001, ESC-003) |
| `node --test scripts/ci/type-negative.test.mjs` | 0 — **12** proofs |
| `node scripts/ci/current-state-guard.mjs` | 0 |
| `npm run db:reset` (shim) | 0 — **80** migrations from empty |
| `npm run db:test` (shim) | 0 — **71 files, 2700 assertions** |
| `npm run db:transport` (real PostgREST) | 0 — **17/17** |
| Upgrade path (79-migration schema + this migration) | applied cleanly, names present, ACL preserved |
| `npm audit` root / client gate / server | 0 / 0 / 0 |

**Not run locally:** the Supabase-stack pgTAP lane and `db:types:check`, both of
which need Docker images this environment cannot pull. Both run in CI, where the
transport suite also runs against the real Supabase stack.

## Rollback

Revert the branch's commits, or close the PR. If the migration has already been
applied to a database, reverting the repository does **not** restore unnamed
parameters — and should not: the previous state was the defect. To roll the
database back deliberately, `CREATE OR REPLACE` the three functions with a bare
type list, which is the inverse operation and is equally non-destructive. Note
that PostgreSQL will not let a later migration *rename* these parameters; only
adding names to unnamed ones is permitted, so a future rename would require a
DROP and full privilege reconstruction.

## Deployment requirements

Nothing here is deployed. This change is **merged-and-deployable at most**, and
this document must not be read as saying production is repaired.

**PostgREST caches the schema.** Until that cache reloads, the repaired RPCs keep
answering `PGRST202` — indistinguishable from the defect. Supabase Cloud's DDL
event triggers normally reload it automatically; if the three RPCs still return
`PGRST202` after deploying, run `notify pgrst, 'reload schema'`. The migration
deliberately does not embed that NOTIFY: there is no such convention in this
repository and inventing one was out of scope. See
`docs/runbooks/receiving-rpc-dispatch.md`.

## Known limitations

- Production is **not** verified. No hosted Supabase was contacted, the project
  ref was not read from Railway, and no owner-facing receiving action was
  exercised against the deployed app.
- The transport fixture commits and expects a freshly reset database; it is a
  CI/local harness, never pointed at a hosted project.
- The `supabase-cli` lane's 300 s suite budget remains WO11 platform debt. It
  was not resized here.
- `docs/ai/CURRENT_STATE.md` narrative is unchanged; only the auto-authorized
  machine-derived baseline block moved, together with the attestation.

## Unrelated finding: the Supabase Preview check

A non-required **"Supabase Preview"** check appears on pull requests, and its
details URL points at the stale 40-migration decoy project rather than the
project whose ledger matches this repository. It was `skipped` on PR #81.

It could mislead a reviewer: a green or skipped "Supabase Preview" next to the
required jobs reads like hosted-database evidence, and it is not. It is **not**
production evidence, was not deployed to, was not mutated, and was not repaired
here. It deserves a separate production-identity / control-plane work order.

## Exact next decision

Review and merge this PR, deploy the migration to the verified production
project, confirm the schema cache reloaded, and exercise submit / cancel /
reconcile through the deployed app before treating receiving as functional.
