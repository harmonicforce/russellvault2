<!--
  Fill in the sections below. Delete guidance comments before submitting.
  Do NOT include secrets, tokens, private URLs, backups, or live/exported data.
-->

## Summary

<!-- What this PR changes and why. -->

## Dependency-root coverage

Confirm checks were run for **all three** roots (root / client / server) — a
root-only run does not count as client or server coverage.

- [ ] `npm ci` (root), `npm ci --prefix client`, `npm ci --prefix server` all pass
- [ ] Lint / typecheck / build / tests pass for client and server
- [ ] Production audits pass for root, client, server (`npm audit --omit=dev --audit-level=high`)
- [ ] Dev-only advisories reviewed separately (`npm audit --audit-level=low`)

## Safety / deployment gates

- [ ] This PR makes **no** deployment-affecting change (no default/deployed
      branch change, no Railway config change, no restart/redeploy, no migration
      against the live DB).
- [ ] No database, backup, secret, credential, private URL, or live/exported
      data is committed.
- [ ] **Gate G0A** (Railway backup evidence) is `READY` **before** any
      deployment-affecting merge. See
      `docs/runbooks/railway-backup-deploy-preflight.md`.
- [ ] Reminder: a later **Phase 13** timed restore rehearsal is still required
      before broad cutover.

## Known non-authoritative / target-model risks (acknowledge, do not "fix" here)

- [ ] I understand the SQLite app is **non-authoritative**. Startup data
      deletion was fixed going forward in `claude/p0-legacy-stop-loss` (source
      rows are now flagged, never deleted). The repository seed (2,149 rows)
      and the verified production backup (2,119 rows) differ by 30, but that
      difference has **not** been reconciled row-for-row — no restoration is
      performed by this fix, and the seed may only become a restoration
      source after exact `acquisition_line_id`/content reconciliation via a
      separate, backup-protected, owner-reviewed procedure. Production writes
      are now disabled by default (see `docs/architecture.md`); the underlying
      money-cents migration and full relational shadow system remain concerns
      for **later target-model phases**.

## Rollback

<!-- How to revert this change safely. -->
