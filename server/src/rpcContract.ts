// Helpers for calling governed RPCs against the generated contract without
// casting the contract away.
//
// Every routine here exists because of a specific, demonstrated gap between
// what PostgreSQL/PostgREST actually accept and what `supabase gen types` can
// express. None of them widens a type: each either narrows at runtime or
// reshapes an argument object in a way the compiler still checks end to end.

/**
 * Make every property of a generated Args type nullable.
 *
 * PostgreSQL function parameters are ALWAYS nullable — `p_query text` accepts
 * NULL — but the generator emits them as non-nullable (`p_query: string`),
 * because a function signature carries no nullability information. For the
 * functions that document NULL as "no filter" in their own body, passing null
 * is correct SQL that the generated type cannot describe.
 *
 * Typing an argument object as `NullableArgs<T>` keeps every key name and every
 * value type checked against the contract while permitting the nulls the
 * database expects. Only the final handoff to `.rpc()` needs a cast, and that
 * cast is registered in docs/ai/TYPE_ESCAPE_MANIFEST.md.
 */
export type NullableArgs<T> = { [K in keyof T]: T[K] | null };

/**
 * The one place a generated Args type is widened, and the only cast in this
 * repository's RPC path.
 *
 * WHY IT CANNOT BE EXPRESSED OTHERWISE
 * -----------------------------------
 * A PostgreSQL function parameter is always nullable — `p_query text` accepts
 * NULL — but a function signature records no nullability, so `supabase gen
 * types` emits `p_query: string`. Several governed functions document NULL as
 * "no filter" or "no evidence" in their own bodies, and this repository's
 * acceptance tests assert that the transport sends those nulls EXPLICITLY
 * rather than omitting the key (see acquisition.finalAcceptance.test.ts,
 * "never forwards a client-supplied source record id").
 *
 * Omitting the keys instead is not equivalent and is not safe here:
 *   * for an OVERLOADED function, PostgREST chooses the overload by the set of
 *     keys supplied, so dropping a null key silently calls a different
 *     function;
 *   * for a parameter whose SQL default is a value rather than null, omitting
 *     it substitutes that default.
 *
 * So the nulls stay on the wire and the widening happens here. Every key name
 * and every value type is still checked against the contract by
 * `NullableArgs<A>` at the call site; the only thing this discards is the
 * generator's inability to say "nullable". Registered as ESC-001.
 */
export function asRpcArgs<A>(args: NullableArgs<A>): A {
  return args as A;
}

/**
 * The result shape every PostgREST query resolves to. Declared structurally so
 * these helpers need no dependency on @supabase/postgrest-js, which is a
 * transitive package this repository does not depend on directly.
 */
export interface QueryResult<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

/**
 * Read every row of a query, one bounded page at a time.
 *
 * The caller supplies a function that builds the query for a page, rather than
 * passing a table name and a filter callback. That inversion is what removes
 * the `(q: any) => any` these pagers used to take: the query is built at the
 * call site by the TYPED client, so the table name, the selected columns and
 * every filter are checked against the generated contract, and the row type
 * flows back out through `Row` instead of being asserted.
 */
export async function readAllPages<Row>(
  pageSize: number,
  page: (from: number, to: number) => PromiseLike<QueryResult<Row>>,
  onError: (message: string) => Error,
): Promise<Row[]> {
  const out: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw onError(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/** A JSON object, which is what every governed RPC in this repository returns. */
export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrow an RPC result to a JSON object, at runtime.
 *
 * The governed functions return `jsonb`, which the generator can only describe
 * as `Json` — a union that says nothing about the object's shape. That is not a
 * generator defect: the shape genuinely is not in the schema. So the shape is
 * established the only way it can be, by checking the value, and the caller
 * supplies the error its own surface should raise.
 *
 * This replaces the previous `data as unknown as { … }`, which asserted a shape
 * rather than establishing one.
 */
export function requireJsonObject(value: unknown, onInvalid: () => Error): JsonObject {
  if (!isJsonObject(value)) throw onInvalid();
  return value;
}

/**
 * Read a string field out of a jsonb RPC result.
 *
 * The alternative is `data as { id: string }`, which does not read the value at
 * all — it just tells the compiler to stop asking. If the function ever returns
 * a different shape, the assertion keeps compiling and the wrong value flows on
 * silently; this raises at the boundary instead.
 */
export function jsonString(obj: JsonObject, key: string, onInvalid: (key: string) => Error): string {
  const value = obj[key];
  if (typeof value !== 'string') throw onInvalid(key);
  return value;
}

/** As jsonString, for a finite number. */
export function jsonNumber(obj: JsonObject, key: string, onInvalid: (key: string) => Error): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw onInvalid(key);
  return value;
}

/**
 * Functions this repository calls over PostgREST that the generated contract
 * does NOT contain — because they are not callable that way at all.
 *
 * THIS IS A DEFECT LEDGER, NOT AN ESCAPE HATCH.
 *
 * `supabase/migrations/20260808000100_s2_receiving_functions.sql` declares
 * these three with UNNAMED parameters:
 *
 *   create function public.submit_acquisition_receipt(uuid,text) …
 *   create function public.cancel_acquisition_receipt(uuid,text,text) …
 *   create function public.reconcile_acquisition_receipt(uuid,text) …
 *
 * PostgREST resolves a JSON-body RPC by matching the body's keys to parameter
 * NAMES. A function whose parameters have no names cannot be matched, which is
 * why the generator omits all three while their named siblings
 * (open_acquisition_receipt, record_acquisition_receipt_line) are present. The
 * pgTAP suite does not catch it: those tests call the functions positionally in
 * SQL and never traverse PostgREST.
 *
 * So POST /receipts/:id/submit, /cancel and /reconcile are believed
 * non-functional against a real deployment. Repairing that means a migration
 * that drops and recreates the three with named parameters, which is database
 * work outside this work order. Until then the calls are left exactly as they
 * are — changing them would only move the failure — and the type system is told
 * the truth about why they cannot be checked.
 *
 * The union is CLOSED. Adding a name here requires a matching entry in
 * docs/ai/TYPE_ESCAPE_MANIFEST.md, and scripts/ci/escape-guard.mjs fails if the
 * two disagree.
 */
export type UncontractedRpcName =
  | 'submit_acquisition_receipt'
  | 'cancel_acquisition_receipt'
  | 'reconcile_acquisition_receipt';

/**
 * Call one of the functions above. Registered as ESC-002.
 *
 * The name is still constrained — to the closed union, not to `string` — and
 * the result is still narrowed at runtime. What cannot be checked is the
 * argument shape, because the contract has no entry to check it against.
 */
type LooseRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

export async function rpcNotInContract(
  client: { rpc: unknown },
  fn: UncontractedRpcName,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> {
  // The typed client refuses a name it has no entry for, which is the whole
  // point of typing it — and also the reason this call cannot go through it.
  // The widening is confined to this line and covers only these three names.
  const call = client.rpc as LooseRpc;
  return call.call(client, fn, args);
}

/**
 * A minor-unit (bigint) RPC argument, transported as a decimal string.
 * Registered as ESC-003.
 *
 * WHY THE CONTRACT CANNOT EXPRESS THIS
 * ------------------------------------
 * PostgreSQL `bigint` exceeds the exact-integer range of a JavaScript number,
 * so this repository carries minor-unit money as `bigint` and puts a decimal
 * STRING on the wire; PostgreSQL parses it losslessly. `supabase gen types`
 * maps `bigint` to `number`, because that is the closest JSON type it has.
 *
 * Satisfying the generated type would mean `Number(value)` — precisely the
 * silent coercion into an unsafe number that Work Order 4 forbids. So the
 * string stays on the wire and the mismatch is declared here instead.
 *
 * Removal condition: Work Order 7 decides the repository-wide representation
 * for bigint and minor units. This helper is the single place that changes.
 */
export function minorUnitArg(value: bigint): number {
  // The wire value is a string; only the contract's TYPE says number.
  return value.toString() as unknown as number;
}
