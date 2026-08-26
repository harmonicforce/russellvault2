# Runbook: Health, Readiness, and Diagnostics

**Purpose:** explain what each health endpoint means after Genome Repair Work
Order 3, and what an owner must decide about the Railway probe.

**Who runs this:** Kyle / an owner-admin. Claude Code and CI cannot change
Railway configuration and must never claim to have done so.

## The problem this fixed (R-003)

`GET /api/health` used to return **503** whenever the legacy SQLite database was
missing, unreadable, structurally incomplete, or empty. Railway health-checks
that path. So a store that is authoritative for **no current business fact**
could veto a governed deployment: a lost volume meant the governed application
could not ship, even though nothing governed depended on that file.

## Three states, kept separate

| State | Endpoint | Question it answers |
| --- | --- | --- |
| Process liveness | `GET /api/live` | Is this process up and answering HTTP? |
| Governed readiness | `GET /api/health` | Was this deployment given a coherent governed configuration? |
| Legacy availability | reported in both, decides neither | Is the non-authoritative legacy database usable? |

`GET /api/version` is **unchanged** and remains the exact deployment
diagnostic — commit SHA, Node version, process start time.

## Old versus new `/api/health`

| Situation | Before | After |
| --- | --- | --- |
| Governed valid, legacy healthy | 200 | 200 |
| Governed valid, legacy **missing** | **503** | **200**, `legacyStatus: "unavailable"` |
| Governed valid, legacy **corrupt** | **503** | **200**, `legacyStatus: "unavailable"` |
| Governed valid, legacy **empty baseline** | **503** | **200**, `legacyStatus: "degraded"` |
| Governed **partial** (e.g. URL without key) | 200 | **503**, `governed_configuration_incomplete` |
| Legacy-only (no governed config at all) | 200 | 200, `mode: "legacy_only"`, `governedReady: false` |

`ok` changed meaning: it now reports **governed readiness**, not legacy health.
Every legacy field is still present and still honest — nothing was concealed —
and the endpoint still emits only 200 or 503, so an older client keeps parsing.

### Why legacy-only returns 200 rather than failing

A legacy-only deployment is doing exactly what it was configured to do, so the
process is not broken and the probe should not restart it. It is nonetheless
**never** reported as governed-ready: `governedReady` is `false` and `mode` is
`legacy_only`. A **partial** governed configuration is different — somebody
intended governed operation and got it wrong — so that fails closed at 503 and
must not be promoted.

### Why the probe never calls Supabase

Readiness is a pure configuration check. If the probe reached out to Supabase on
every request, a Supabase blip would fail the health check, Railway would
restart or refuse to promote, and a transient dependency wobble would become a
self-inflicted outage. The legacy read is additionally served from a short
(5 second) cache so a slow disk cannot slow the probe.

## Detailed diagnostics — owner only

`GET /api/diagnostics?workspaceId=<uuid>` with a bearer token.

Requires the caller to hold **owner** in the named workspace. Operators, viewers
and non-members are all refused with the same code. It reports per-component
status for `process`, `governed_configuration`, `legacy_database`, and
`legacy_bootstrap`, using bounded codes only — never a filesystem path, SQL
text, driver message, credential, project ref, or stack trace.

| Code | Meaning |
| --- | --- |
| `diagnostics_not_configured` | No governed configuration, so there is no Auth to verify against (503) |
| `diagnostics_authentication_required` | No bearer token (401) |
| `diagnostics_authentication_invalid` | Token rejected by Supabase Auth (401) |
| `diagnostics_workspace_required` | No valid `workspaceId` (400) |
| `diagnostics_owner_required` | Authenticated but not an owner of that workspace (403) |

## Legacy quarantine is unchanged

Work Order 2's membrane is untouched: legacy routes remain authenticated and
bound to `LEGACY_WORKSPACE_ID`, an unconfigured surface still returns
`503 legacy_surface_not_configured`, writes still require owner/operator plus
`ALLOW_LEGACY_WRITES=true`, and CORS is unchanged. Startup still creates,
migrates, or seeds SQLite **only** when `SEED_LEGACY_ON_EMPTY` is exactly
`true`.

## Remaining owner action — Railway probe (NOT performed)

`railway.json` still declares `healthcheckPath: "/api/health"`, deliberately
unchanged by this work order. That is now the governed-readiness probe, which is
the correct target: it no longer fails on legacy state, and it *does* fail on a
broken governed configuration.

An owner may optionally repoint the probe at `/api/live` if they want the
container kept alive even when the governed configuration is incomplete. **Do
not do this casually** — it would let a misconfigured deployment be promoted and
sit there serving nothing governed. The current setting is the safer default.

Changing it is a Railway configuration action, timed by the owner. Nothing in
this work order performed it, and no Railway variable was set or read.
