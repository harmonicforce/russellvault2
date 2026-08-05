# Last Implementation Handoff

## PR #41 S1.1 FK-isolation test repair

- Repository: `harmonicforce/russellvault2`
- PR: #41 — `S1.1: Add governed acquisition classification schema, seed data, and tests`
- Branch: `codex/add-governed-acquisition-classification-schema-3tx1ht`
- Current head named in work order: `8f0de234bdf0fddd11abcf8ca10d78a7bd64395e`
- Current CI run named in work order: `30965321170`
- Local head inspected before this repair: `be2a4e621734d1611528f1bdb0fdd612e1ac95a9`
- Final local repair head: 798aed0618d7224032d5925ad63798fc82ea1589 (pre-handoff-amend)
- Migration count remains: 61
- No migration/schema file was changed in this repair.

## Proven CI failure and root cause

CI run `30965321170` executed all 76 focused assertions. The prior trigger repair worked: cross-workspace references now reach database constraints instead of being masked by `app.classification_rule_target_matches()`. Assertions 54 and 55 still failed because those two FK tests reused workspace A's acquisition line after the classification-history section had already created a current successor for that line. The attempted invalid rows collided first with `acquisition_line_classifications_one_current_uidx` (`23505`) before PostgreSQL could check the intended cross-workspace composite FKs (`23503`).

## Repair made

- `cross-workspace option rejected` now uses workspace B and unclassified line B, selects option `single` from workspace A, and selects the valid active v5 `seller:topshelfcollects` rule from workspace B. The row is otherwise valid, so only the option is cross-workspace.
- `cross-workspace rule rejected` now uses workspace B and unclassified line B, selects option `single` from workspace B, and selects the active v5 `seller:topshelfcollects` rule from workspace A. The row is otherwise valid, so only the rule is cross-workspace.
- Line B has no current classification at this point in the transaction: prior B-line classification attempts are inside `throws_ok` assertions and fail, leaving no row behind.

## Verification

Local PostgreSQL remains unavailable in this container (`psql` is missing), so `npm run db:reset`, the focused pgTAP run, and the full database test suite cannot execute locally. `git diff --check` passed locally. Push and exact-head CI inspection require GitHub network/auth access from an environment that can reach GitHub.

## Non-changes

No migration schema change, no migration count change, no second migration, no trigger change, no FK change, no unique-index change, no RLS change, no fixture lifecycle change, no `server/src/classify.ts` change, no Railway action, no hosted Supabase access, no hosted migration, no historical import, no S1.2 work, and no `docs/ai/CURRENT_STATE.md` edit.

## Next step

Push this repair to PR #41 and verify all four required exact-head CI jobs: `build-and-verify`, `shadow-db-postgres-shim`, `shadow-db-supabase-stack`, and `dev-advisory-report`.
