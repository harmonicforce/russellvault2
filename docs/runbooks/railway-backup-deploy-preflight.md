# Runbook: Railway Backup & Deployment Preflight (Gate G0A)

**Purpose:** produce and verify a consistent backup of the live Railway SQLite
database, plus deployment evidence, **before** any action that could alter the
running Railway service or its data. This is the enforceable form of Gate
**G0A**.

**Who runs this:** Kyle / an owner-admin with Railway access. Claude Code / CI
**cannot** perform these steps — they have no Railway authority and must never
claim this evidence exists without an owner-provided, verified manifest.

## When G0A must be READY

G0A must be `READY` before **any** deployment-affecting action, including:

- changing the GitHub **default** or **deployed** branch;
- merging into a branch watched by Railway;
- changing `railway.json`, start/build commands, `DATA_DIR`, `DATABASE_PATH`, or
  volume mounts;
- redeploying or restarting the service when the live database may be attached;
- running any migration or repair against the live SQLite file.

Local Phase 0 work and a **non-deploying draft PR** are allowed before G0A.

## What you must NOT do

- Do not commit the backup, credentials, private URLs, or a filled manifest to
  the public repository. Keep them outside Railway **and** outside this repo
  (the `.gitignore` blocks `*.db`, `*.sqlite*`, `backups/`, and
  `preflight-evidence/`, but do not rely on that alone).
- Do not assume copying only `vault.db` while the app is running is consistent —
  the DB is in **WAL mode**.

## Step 1 — Discover deployment reality (read-only)

```bash
railway login            # if not already authenticated
railway link             # select the correct project / environment / service
railway status           # project, environment, service
railway variables        # capture DATA_DIR, DATABASE_PATH (redact secrets)
```

Record, from **Railway's own** build/deploy evidence (not GitHub):

- project / environment / service names
- currently deployed **branch** and full **commit SHA**
- effective `DATA_DIR` / `DATABASE_PATH`
- persistent-volume mount path and whether the service is actually using it

Cross-check the running commit with the app itself:

```bash
curl -s https://<your-app-host>/api/version
```

## Step 2 — Capture a WAL-consistent backup

Locate the live DB path (from `DATABASE_PATH`, else `DATA_DIR/vault.db`, else
`server/data/vault.db`). Then, on the service (e.g. `railway ssh` / `railway run`
into the running container), use SQLite's **online backup** — this is safe while
the writer is live and produces a single consistent file:

```bash
# Preferred: online backup API via the sqlite3 CLI
sqlite3 "$DATABASE_PATH" ".backup '/tmp/vault-backup-$(date -u +%Y%m%dT%H%M%SZ).db'"
```

If `sqlite3` is unavailable in the container, either install it, or **stop the
writer** (do not do this casually — stopping/restarting is itself a G0A-gated
action) and copy `vault.db` **together with** `vault.db-wal` and `vault.db-shm`.
Never copy `vault.db` alone while the app is writing.

Retrieve the backup file to a machine **outside** Railway (e.g. `railway ssh`
+ `scp`, or a `railway run` that streams the file out). Keep at least one copy
outside Railway.

## Step 3 — Verify the backup (read-only)

From a clone of this repo with server deps installed (`npm ci --prefix server`):

```bash
npm run verify:backup -- /path/to/vault-backup-<utc>.db
# or: node scripts/verify-sqlite-backup.mjs /path/to/backup.db --json
```

The verifier opens the file **read-only**, computes SHA-256, runs
`PRAGMA integrity_check`, and prints per-table row counts. It never mutates the
file. Confirm `integrity_check` is `ok`.

## Step 4 — Record restore steps

Document exactly how to restore, so the backup is provably usable:

1. Provision the target volume; set `DATA_DIR` / `DATABASE_PATH`.
2. Place the backup file at the DB path (as `vault.db`).
3. Start the service; the app opens the existing DB (it only seeds when empty).
4. Post-restore verification queries, e.g. per-table counts match the manifest:
   ```sql
   SELECT 'whatnot_purchases' AS t, COUNT(*) FROM whatnot_purchases
   UNION ALL SELECT 'inventory_lots', COUNT(*) FROM inventory_lots
   UNION ALL SELECT 'cost_links', COUNT(*) FROM cost_links;
   ```

## Step 5 — Fill the manifest and attest

Copy `docs/runbooks/g0a-manifest-template.md` to a location **outside this repo**
(e.g. `preflight-evidence/g0a-<utc>.md`, which is gitignored) and fill every
field: capture time (UTC), project/service/env, deployed branch + full SHA,
data path, volume evidence, backup filename label, SHA-256, integrity result,
per-table counts, external data paths, restore steps, evidence location, owner,
and `READY` / `BLOCKED`.

Mark **G0A READY** only when every field is complete and the backup is retained
outside Railway and outside the public repo. Otherwise mark **BLOCKED** and note
the exact missing item.

## Step 6 — Phase 13 still required

G0A proves a consistent backup and a plausible restore procedure exist before
early deployment risk. It does **not** replace the Phase 13 timed restore
rehearsal, full cross-source reconciliation, cutover freeze, and owner go/no-go.
