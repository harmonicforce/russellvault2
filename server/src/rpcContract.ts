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
 * A note on what is NOT in this module any more.
 *
 * It used to carry a closed union of three receiving function names plus one
 * widening cast, so the server could call functions the generated contract did
 * not contain: submit, cancel and reconcile for acquisition receipts. They were
 * missing for a real reason. `20260808000100_s2_receiving_functions.sql`
 * declared all three with UNNAMED SQL parameters, and PostgREST resolves a
 * JSON-body RPC by matching the body's keys to parameter NAMES, so they could
 * not be called that way at all. The generator omits what PostgREST cannot
 * reach, and the ledger recorded the gap rather than papering over it.
 *
 * `20260826000100_receiving_rpc_named_parameters.sql` gave those parameters
 * names. The generator now emits all three, and they are called through the
 * same typed path as every other governed function, so the union, the cast and
 * the ledger entry are gone rather than rewritten.
 *
 * The lesson worth keeping: an absence from the generated contract is evidence
 * about the DATABASE, not a limitation of the generator. The fix for one
 * belongs in a migration, never in a cast.
 */

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
