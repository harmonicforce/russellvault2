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

### ESC-002 — receiving functions absent from the contract

- **File and symbol:** `server/src/rpcContract.ts`, `rpcNotInContract` and the
  closed union `UncontractedRpcName`
- **Covered names:** `submit_acquisition_receipt`, `cancel_acquisition_receipt`,
  `reconcile_acquisition_receipt`
- **Category:** RPC name bypass — but the underlying cause is a **database
  defect, not a typing limitation**
- **Why generated types cannot express it:**
  `supabase/migrations/20260808000100_s2_receiving_functions.sql` declares all
  three with UNNAMED parameters (`create function
  public.submit_acquisition_receipt(uuid,text)`). PostgREST resolves a
  JSON-body RPC by matching the body's keys to parameter NAMES, so a function
  whose parameters have no names cannot be called that way at all. The
  generator omits all three for exactly that reason, while their named siblings
  (`open_acquisition_receipt`, `record_acquisition_receipt_line`) are present.
- **Narrowest cast used:** one `client.rpc as LooseRpc` inside
  `rpcNotInContract`. The function name is still constrained — to the closed
  three-name union, not to `string`.
- **Runtime validation protecting it:** the result goes through
  `requireJsonObject`, and PostgREST's own error is surfaced by `fail()`.
- **Consequence, stated plainly:** `POST /receipts/:id/submit`, `/cancel` and
  `/reconcile` are believed non-functional against a real deployment. The pgTAP
  suite does not catch it because those tests call the functions positionally
  in SQL and never traverse PostgREST.
- **Removal condition:** a migration that drops and recreates the three
  functions with named parameters (`create or replace` cannot rename a
  parameter). That is database work outside Work Order 4's scope; until it
  lands, the calls are left exactly as they are, because changing them would
  only move the failure.

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
