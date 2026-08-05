# Last Implementation Handoff

## PR #41 S1.1 classification trigger repair

- Repository: `harmonicforce/russellvault2`
- PR: #41 — `S1.1: Add governed acquisition classification schema, seed data, and tests`
- Branch: `codex/add-governed-acquisition-classification-schema-3tx1ht`
- Current remote head named in work order: `cf24bbd0acfbf4eb6c2a47cddb0b86a556cd3508`
- Current CI run named in work order: `30964839596`
- Local head inspected before this repair: `b0b90e873be6a64fd89ffd79f47a739d49f60f8b`
- Final local repair head: 5fa70ad3b4be0dc7ab25d3b5f32f359b31fcdf1d (pre-handoff-amend)
- Migration count remains: 61
- Migration file edited in place because it is the unmerged S1.1 migration: `supabase/migrations/20260804000100_governed_acquisition_classification.sql`

## Proven CI failure and root cause

CI run `30964839596` completed the focused `supabase/tests/55_governed_acquisition_classification.sql` file with 74/76 assertions passing. Assertions 54 and 55 failed because `app.classification_rule_target_matches()` was a BEFORE trigger that treated foreign-workspace option/rule references as semantic rule target/version mismatches and raised `23514` before PostgreSQL could enforce the existing composite foreign keys with `23503`.

## Repair made

`app.classification_rule_target_matches()` now resolves the rule only inside `new.workspace_id`. If the rule is missing from that workspace, it returns `new` so the `(rule_id, workspace_id)` composite FK emits `23503`. It separately checks whether the referenced option exists in `new.workspace_id`; if not, it returns `new` so the `(classification_option_id, workspace_id)` composite FK emits `23503`. Only after both references are known to be valid in the row workspace does it compare rule version and target option and raise the semantic `23514` mismatch.

## Trigger behavior audit

- `owner_override` rows with `rule_id IS NULL` still bypass the trigger.
- Retirement updates with unchanged rule data still pass because the trigger sees the same valid rule/version/target.
- Valid rule-derived classifications still pass.
- Cross-workspace rule references should now reach the composite FK and fail with `23503`.
- Cross-workspace option references should now reach the composite FK and fail with `23503`.
- Same-workspace version or target contradictions still raise `23514`.
- No composite FK, RLS policy, append-only trigger, fixture lifecycle, regex seed, or classification semantic was weakened.

## Verification

Local PostgreSQL remains unavailable in this container (`psql` is missing), so `npm run db:reset`, the focused pgTAP run, and the full database test suite cannot execute locally. `git diff --check` passed locally. Push and exact-head CI inspection require GitHub network/auth access from an environment that can reach GitHub.

## Non-changes

No migration count change, no second migration, no FK weakening, no RLS weakening, no append-only weakening, no fixture lifecycle change, no `server/src/classify.ts` change, no Railway action, no hosted Supabase access, no hosted migration, no historical import, no S1.2 work, and no `docs/ai/CURRENT_STATE.md` edit.

## Next step

Push this repair to PR #41 and verify all four required exact-head CI jobs: `build-and-verify`, `shadow-db-postgres-shim`, `shadow-db-supabase-stack`, and `dev-advisory-report`.
