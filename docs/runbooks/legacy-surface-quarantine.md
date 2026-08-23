# Runbook: Legacy HTTP Surface Quarantine

**Purpose:** explain what the legacy quarantine is, what it is *not*, and the
exact variables an owner must set for the legacy pages to work at all.

**Who runs this:** Kyle / an owner-admin with Railway access. Claude Code and CI
**cannot** set these variables and must never claim they are set.

## What this is

The legacy SQLite routes — inventory, purchases, cost links, listings, sales,
dashboard, checks, lookups — were anonymously readable by anyone who could reach
the process. They now require an authenticated member of one explicitly
configured workspace, and writes additionally require an authorized role plus an
explicit flag.

## What this is NOT

**Quarantine is not authority.** `LEGACY_WORKSPACE_ID` does not make legacy rows
workspace-scoped, governed, or authoritative. The legacy SQLite dataset is a
single global database with no workspace column. The variable names the one
governed workspace whose members are permitted to *see* that global data. It is
an access boundary and nothing more.

Nothing here migrates, deletes, or promotes legacy data. `docs/architecture.md`
remains correct: legacy rows are non-authoritative regardless of who may read
them.

## Variables

| Variable | Required for | Effect when absent |
| --- | --- | --- |
| `SUPABASE_URL` | legacy reads and writes | surface unconfigured → 503 |
| `SUPABASE_ANON_KEY` | legacy reads and writes | surface unconfigured → 503 |
| `LEGACY_WORKSPACE_ID` | legacy reads and writes | surface unconfigured → 503 |
| `ALLOW_LEGACY_WRITES` | legacy writes only | writes refused in every environment |
| `DEV_CORS_ORIGINS` | non-production cross-origin dev | defaults to the standard Vite origins |

`SUPABASE_ANON_KEY` is a public client identifier, not a secret: it grants only
what RLS allows. There is no service-role key in this path, and membership is
always resolved under the caller's own JWT.

`LEGACY_WORKSPACE_ID` must be a UUID. A malformed value is treated as absent —
half a quarantine is not a quarantine.

## Fail-closed behaviour

With the surface unconfigured, every legacy route returns `503` with
`{"error":"legacy_surface_not_configured"}`. **This is the correct production
posture until an owner deliberately configures it, not an outage.** The governed
application is unaffected: governed routes carry their own gates and never
consult `LEGACY_WORKSPACE_ID` or `ALLOW_LEGACY_WRITES`.

`/api/health` and `/api/version` stay public and are unchanged by this work.
Health *semantics* are deliberately untouched here — that is Work Order 3.

## Authorization matrix

| Caller | Read | Write |
| --- | --- | --- |
| Anonymous | 401 `legacy_authentication_required` | 401 |
| Invalid or expired bearer | 401 `legacy_authentication_invalid` | 401 |
| Member of another workspace | 403 `legacy_access_forbidden` | 403 |
| Viewer in the legacy workspace | permitted | 403 `legacy_write_role_forbidden` |
| Owner/operator, flag absent or not exactly `true` | permitted | 403 `legacy_writes_disabled` |
| Owner/operator, `ALLOW_LEGACY_WRITES=true` | permitted | permitted |

Read access matches the governed contract in `docs/ai/ENGINEERING_RULES.md` §1 —
owner and operator may mutate, viewers remain read-only — so legacy write
authority is never broader than governed write authority.

Refusals are bounded codes. They never carry a filesystem path, SQL, a token, a
workspace id, or a provider message.

## Enabling the legacy surface

1. Decide which governed workspace should be able to see legacy data. There is
   no automatic answer, and guessing wrong exposes one workspace's members to
   the global legacy dataset.
2. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `LEGACY_WORKSPACE_ID` on the
   deployed service.
3. Confirm a member of that workspace can load a legacy page and a non-member
   cannot.
4. Leave `ALLOW_LEGACY_WRITES` unset unless legacy writing is actually needed.
   When it is needed, set it to exactly `true`, and unset it afterwards.

Before doing any of this against a live environment, re-read the deployed
Supabase URL immediately before acting and confirm the project ref, per the
deployment identity rule in `CLAUDE.md`.

## Local development

Legacy writes are now closed in development and test too. To exercise them
locally, opt in explicitly:

```bash
ALLOW_LEGACY_WRITES=true npm run dev --prefix server
```

This is deliberate. The previous rule left non-production writable by default,
so local and CI runs never exercised the path production actually takes.

## Known compatibility impact

`client/src/lib/api.ts` sends no `Authorization` header, so the legacy UI pages
(`/inventory`, `/purchases`, `/cost-links`, `/listings`, `/sales`, `/checks`,
and the legacy dashboard) will receive `401` once the surface is configured, and
`503` before it is. That is the intended quarantine effect and is **not** fixed
in this work order. Attaching the caller's session token to legacy requests is a
separate, deliberate decision about whether those pages should continue to exist
at all — see the legacy retirement tranche in
`docs/ai/GENOME_PROGRAM_REGISTRY.md`.
