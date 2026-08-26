# Runbook: Receiving RPC dispatch, and the schema cache

**Purpose:** explain what ESC-002 was, what the repair changed, and the one
deployment step that is easy to miss.

**Who runs this:** Kyle / an owner-admin, at deploy time. CI and Claude Code
cannot deploy and must never claim to have done so.

## The defect

`supabase/migrations/20260808000100_s2_receiving_functions.sql` declared three
governed receiving wrappers with a bare type list and no parameter names:

```sql
create function public.submit_acquisition_receipt(uuid,text) ...
create function public.cancel_acquisition_receipt(uuid,text,text) ...
create function public.reconcile_acquisition_receipt(uuid,text) ...
```

Every other function in that file names its parameters. These three did not, so
`pg_proc.proargnames` was `NULL` for them.

PostgREST resolves a JSON-body RPC by matching the body's keys to parameter
**names**. A function with no names has nothing to match, and its only other
calling convention — a single unnamed `json`/`jsonb` parameter — does not apply
to `(uuid,text)` or `(uuid,text,text)`. So all three were unreachable through the
transport the application uses:

```
PGRST202 / HTTP 404
"Could not find the function public.submit_acquisition_receipt
 (p_receipt_public_id, p_workspace_id) in the schema cache"
```

`POST /receipts/:id/submit`, `/cancel` and `/reconcile` could not work against a
real deployment.

## Why nothing caught it

The pgTAP suite calls these functions **positionally from SQL**, where unnamed
parameters are perfectly legal. The database semantics were never broken — only
the dispatch membrane — so 2,673 assertions stayed green over a broken API.

It surfaced only when Work Order 4 generated the database contract from the
catalog and all three came back **absent**, because the generator omits what
PostgREST cannot call.

The general lesson: a governed function's **SQL semantics** and its **transport
dispatchability** are separate properties. Proving the first says nothing about
the second.

## The repair

`20260826000100_receiving_rpc_named_parameters.sql` uses `CREATE OR REPLACE`.
PostgreSQL refuses to *rename* an existing input parameter but permits *adding*
a name to one that had none, which is exactly this case. So there is no `DROP`,
no `CASCADE`, no window where the governed function does not exist, and no
re-`GRANT` that could widen or narrow privileges by accident. Function identity,
ownership, ACL, `SECURITY DEFINER`, volatility, strictness, parallel safety and
`search_path=''` are all preserved, and the migration asserts that postcondition
against `pg_proc` before it commits.

## Coverage added

| Layer | File | Proves |
| --- | --- | --- |
| Catalog | `supabase/tests/71_receiving_rpc_dispatch.sql` | every governed receiving RPC names all its parameters; one overload each; privileges and attributes preserved |
| Transport | `scripts/db/transport/` | real HTTP to real PostgREST with named JSON bodies: resolution, durable state, replay, concurrency, authorization, cross-workspace refusal, argument contract |
| Compile time | `scripts/ci/type-negative.test.mjs` | the contract rejects missing, misspelled and wrongly typed arguments, and incompatible results |

The transport suite fails 14 of its 17 tests against the unrepaired baseline, so
it cannot pass vacuously.

## DEPLOYMENT: the schema cache

**PostgREST caches the schema. A correct migration does nothing until that cache
is reloaded.** Until then every affected RPC keeps answering `PGRST202` — which
looks exactly like the defect this migration fixes.

- **Supabase Cloud** ships DDL event triggers (`pgrst_ddl_watch` /
  `pgrst_drop_watch`) that issue `NOTIFY pgrst, 'reload schema'` automatically,
  so a normal migration deploy should refresh it without intervention.
- **If the three RPCs still return `PGRST202` after deploying**, the cache did
  not refresh. Reload it explicitly:

  ```sql
  notify pgrst, 'reload schema';
  ```

This migration deliberately does **not** embed that `NOTIFY`. There is no
existing convention for it in this repository, and inventing an ad hoc one in a
migration is out of scope for the work order that produced this repair. The
harness does issue it (`scripts/db/transport/run.mjs`) because a test run that
raced a stale cache would be indistinguishable from a real failure.

## Verifying a deployment

After the migration is applied to the hosted project, confirm dispatchability
directly rather than inferring it:

```sql
select p.oid::regprocedure, p.proargnames
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('submit_acquisition_receipt',
                    'cancel_acquisition_receipt',
                    'reconcile_acquisition_receipt');
```

All three must report names. Then exercise one owner-facing receiving action end
to end through the deployed app. Until that has been done against the verified
production project, this repair is **merged and deployable, not deployed** —
and the distinction matters: nothing in this repository can prove production is
fixed.
