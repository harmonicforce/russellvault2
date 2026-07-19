# G0A Railway Backup & Deployment Evidence Manifest (REDACTED TEMPLATE)

> ⚠️ **Do NOT commit a filled copy of this manifest to the public repository.**
> Copy it to a gitignored location outside the repo (e.g.
> `preflight-evidence/g0a-<utc>.md`) and fill it there. Never include secrets,
> tokens, private URLs, connection strings, or customer data. Values below are
> placeholders.

| Field | Value |
|---|---|
| Capture time (UTC) | `<YYYY-MM-DDTHH:MM:SSZ>` |
| Railway project | `<project-name>` |
| Railway environment | `<environment-name>` |
| Railway service | `<service-name>` |
| Deployed Git branch (from Railway build evidence) | `<branch>` |
| Deployed full commit SHA (from Railway build evidence) | `<40-char-sha>` |
| `/api/version` reported SHA (cross-check) | `<40-char-sha or "unknown">` |
| Effective `DATA_DIR` | `<path or "unset">` |
| Effective `DATABASE_PATH` | `<path or "unset">` |
| Actual SQLite DB path in service | `<path>` |
| Persistent volume present? | `<yes/no>` |
| Volume mount path | `<path>` |
| Service actually using the volume? | `<yes/no>` |
| Backup method | `<sqlite .backup / writer-stopped copy incl. WAL+SHM>` |
| Backup filename label (not the file itself) | `<vault-backup-<utc>.db>` |
| Backup SHA-256 | `<64-hex>` |
| `PRAGMA integrity_check` result | `<ok / details>` |
| Backup retained outside Railway? | `<yes — location label, no path secrets>` |
| Additional data/media files not in SQLite | `<list or "none">` |

## Per-table row counts (from the backup file)

_Fill from `npm run verify:backup -- <backup> --json`._

| Table | Rows |
|---|---|
| `<table>` | `<n>` |
| ... | ... |

## Restore steps (summary)

1. `<provision volume; set DATA_DIR/DATABASE_PATH>`
2. `<place backup file at DB path>`
3. `<start service; app opens existing DB, does not reseed>`
4. `<post-restore verification queries + expected counts>`

## Attestation

| Field | Value |
|---|---|
| Status | `READY` / `BLOCKED` |
| If BLOCKED, exact missing item | `<...>` |
| Owner name | `<name>` |
| Attestation timestamp (UTC) | `<YYYY-MM-DDTHH:MM:SSZ>` |
| Evidence location (label, not secret path) | `<...>` |
| Exact deployed SHA this attestation covers | `<40-char-sha>` |

---

**Reminder:** this manifest records *metadata* only. The database backup, any
credentials, and private URLs must never be committed to the public repository.
