# Type escape manifest

An exception ledger for casts that defeat the generated database contract.
**It is a ledger, not a quota.** Nothing may be added to it because removing a
cast was inconvenient; each entry has to name a limitation that generated types
genuinely cannot express, the narrowest cast that works around it, the runtime
validation standing in for the lost checking, and the condition under which the
entry goes away.

`scripts/ci/escape-guard.mjs` enforces it on every CI run.

## Enforced scope

The four Work Order 4 boundaries are held to **zero unregistered escapes**:

| Boundary | Files |
| --- | --- |
| acquisition payments and shipments | `server/src/routes/acquisition.ts`, `server/src/acquisition/**` |
| receiving and discrepancies | `server/src/routes/receiving.ts` |
| cost allocation and inventory cost basis | `server/src/routes/cost.ts`, `server/src/cost/**` |
| reconciliation | `scripts/reconciliation/**` |
| the shared contract itself | `shared/**`, `server/src/rpcContract.ts`, `server/src/routes/params.ts` |

Everything else in the repository is held to a **frozen baseline**: the guard
records how many escapes each file outside the enforced scope currently has and
fails if any file gains one. Pre-existing escapes elsewhere are not fixed by
this work order, but they cannot grow.

## Registered escapes

### ESC-001 — nullable RPC arguments

- **File and symbol:** `server/src/rpcContract.ts`, `asRpcArgs`
- **Category:** RPC argument bypass
- **Why generated types cannot express it:** a PostgreSQL function parameter is
  always nullable, but a function signature records no nullability, so
  `supabase gen types` emits `p_query: string` for a parameter that legitimately
  accepts NULL. Several governed functions document NULL as "no filter" or "no
  evidence" in their own bodies.
- **Narrowest cast used:** `args as A`, one line, inside a function whose
  parameter is `NullableArgs<A>` — so every key name and value type is still
  checked against the contract and only the nullability is widened.
- **Runtime validation protecting it:** none is needed for the argument shape,
  which the compiler still checks. The values themselves are validated before
  reaching it (`bodyText`, `isoDate`, `optionalQuery`, `singleParam`).
- **Why the nulls are not simply omitted:** omitting a key makes PostgreSQL
  apply the parameter's DEFAULT, which is only equivalent when that default is
  null, and never equivalent for an OVERLOADED function — PostgREST selects the
  overload by the set of keys supplied. `list_acquisition_lines` has two
  overloads in this schema, so dropping a null key there would silently call the
  11-argument version that does not filter exclusions. The explicit nulls are
  also a tested contract: `acquisition.finalAcceptance.test.ts` asserts the
  server sends `p_source_record_id: null` rather than forwarding a client value.
- **Removal condition:** `supabase gen types` emitting nullable parameter types,
  or the governed functions declaring `strict`/non-null parameters.

### ESC-003 — bigint minor units on the wire

- **File and symbol:** `server/src/rpcContract.ts`, `minorUnitArg`
- **Category:** genuine upstream typing limitation
- **Why generated types cannot express it:** PostgreSQL `bigint` exceeds the
  exact-integer range of a JavaScript number. This repository carries
  minor-unit money as `bigint` and puts a decimal STRING on the wire, which
  PostgreSQL parses losslessly. `supabase gen types` maps `bigint` to `number`
  because that is the closest JSON type it has.
- **Narrowest cast used:** `value.toString() as unknown as number`, in one
  function, applied to one argument (`p_expected_total_minor`).
- **Runtime validation protecting it:** `parseMinor` in
  `server/src/cost/contract.ts` accepts only an exactly-representable number or
  a canonical decimal string and returns `bigint`; the database re-verifies the
  total before committing an allocation.
- **Why it is not "fixed" by conversion:** satisfying the generated type means
  `Number(value)`, which is precisely the silent coercion into an unsafe number
  that Work Order 4 forbids.
- **Removal condition:** Work Order 7 settles the repository-wide
  representation for bigint and minor units. This helper is the single place
  that changes.

## Retired entries

These ids are NOT registered. The headings below deliberately do not match the
`### ESC-nnn` form the guard parses, so retired ids cannot be referenced by code
as though they were still live.

### Retired — ESC-002, receiving functions absent from the contract (2026-08-26)

Retired by `supabase/migrations/20260826000100_receiving_rpc_named_parameters.sql`,
and removed rather than reworded because its cause is gone.

It was never a typing limitation. `20260808000100_s2_receiving_functions.sql`
declared `submit_acquisition_receipt`, `cancel_acquisition_receipt` and
`reconcile_acquisition_receipt` with UNNAMED parameters. PostgREST resolves a
JSON-body RPC by matching the body's keys to parameter NAMES, so all three were
uncallable through the transport the server uses, and the generator omitted
them for exactly that reason. The entry existed to record a **database defect**
that the type system was being asked to absorb.

Naming the parameters removed the cause. The generated contract now describes
all three, `server/src/routes/receiving.ts` calls them through the ordinary
typed `rpc()` path, and the widening cast in `server/src/rpcContract.ts` is
deleted.

Why the previous suite could not see it: the pgTAP tests call these functions
positionally from SQL, where unnamed parameters are legal. `supabase/tests/71_receiving_rpc_dispatch.sql`
now asserts the dispatch contract in the catalog, and `scripts/db/transport/`
exercises all three over real HTTP against real PostgREST.

## Known contract hazards that are NOT escapes

Recorded here because they were found while binding the boundaries, and
because a future reader will otherwise rediscover them the hard way.

- **Four overloaded functions live in the schema**: `list_acquisition_lines`,
  `observe_cycle_count_item`, `observe_cycle_count_lot`,
  `void_cycle_count_observation`. PostgREST chooses among overloads by the set
  of argument keys supplied. For `list_acquisition_lines` the older
  11-argument version — which does **not** filter on exclusion state — is still
  present alongside the 12-argument one, so a caller that omits a key gets
  unfiltered results with no error. Dropping the superseded overloads is
  database work.
- **`as never` remains in eleven files outside the enforced scope**
  (media, listing prep, cycle counts, operations dashboard, intake, locations,
  provenance, and the provenance commit driver). They are the same untyped-RPC
  pattern this work order removed from the four named boundaries. Removing them
  produces 23 compile errors that each need individual judgement — the
  receiving defect above was found exactly that way — so they are frozen at
  their current count rather than swept. This is the natural follow-up.
