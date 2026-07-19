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

## Known non-authoritative / Phase 1 risks (acknowledge, do not "fix" here)

- [ ] I understand the SQLite app is **non-authoritative** and that startup data
      deletion (`cleanupFoodPurchases` → `DELETE FROM whatnot_purchases`) and
      unsafe financial writes remain **Phase 1** issues.

## Rollback

<!-- How to revert this change safely. -->
