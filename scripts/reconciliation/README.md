# Offline reconciliation runner

The runner compares two fixed JSON artifacts without opening a database or
making a network request. Each artifact must have this shape:

```json
{"artifactVersion":1,"rows":[{"id":"A-1","amountMinor":100,"status":"held"}]}
```

A domain configuration declares every field the domain compares and its
materiality. Strings remain exact unless a field explicitly selects `trim`,
`lowercase`, or `trim_lowercase` normalization.

```json
{
  "domain": "example_inventory",
  "comparisonKey": "id",
  "comparedFields": [
    {"name": "amountMinor", "materiality": "financial"},
    {"name": "status", "materiality": "material"}
  ],
  "aggregateNumericFields": ["amountMinor"],
  "aggregateGroupFields": ["status"]
}
```

Run it with Node and redirect the authoritative evidence to a new file:

```sh
node scripts/reconciliation/cli.mjs \
  --source source.json --target target.json --config domain.json \
  > reconciliation-result.json
```

Use `--pretty` only for human-readable formatting. Neither output mode includes
an execution timestamp or input path. Both include exact input SHA-256 hashes,
artifact metadata, L1 aggregates, one ordered L2 finding per union key, and
verdict/materiality counts. L1 always states that aggregate agreement is not a
reconciliation pass.

`ledger.mjs` is an optional boundary adapter. Its caller supplies an RPC
function connected only to an authorized local/shadow governed database. It
does not import Supabase or establish a connection, and it persists exclusively
through the S3.1 governed functions. Comparison never requires this adapter.
