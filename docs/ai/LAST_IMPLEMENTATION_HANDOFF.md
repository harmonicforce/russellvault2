# Last Implementation Handoff

## PR #41 S1.1 focused fixture lifecycle repair

- Repository: `harmonicforce/russellvault2`
- PR: #41 — `S1.1: Add governed acquisition classification schema, seed data, and tests`
- Branch: `codex/add-governed-acquisition-classification-schema-3tx1ht`
- Current remote head named in work order: `7f80080537d91a7e8318b2568eae24961d3184a9`
- Current CI run named in work order: `30963818752`
- Local head inspected before this repair: `681f17e6bdc9138aef176769f465df432019ed4e`
- Final local repair head: 58bd95c5e2f707d22f91857786e13c2650c5fbcb (pre-handoff-amend)
- Migration count remains: 61
- Migration file remains: `supabase/migrations/20260804000100_governed_acquisition_classification.sql`

## Proven CI failure and root cause

The current database CI failure in `supabase/tests/55_governed_acquisition_classification.sql` was `this import is committed and can no longer accept new source_records`. The prior tuple-width fix exposed, but did not cause, this lifecycle defect. The focused fixture was constructing both Phase 3 import jobs and acquisition import jobs in terminal `committed` state before inserting their child rows, reversing the repository's governed staging lifecycle.

## Repair made

- Phase 3 `public.import_jobs` fixture rows now start as `mode = 'commit'`, `status = 'preview'`, `completed_at = NULL`, `source_row_count = 1`, `accepted_row_count = 0`, and `issue_row_count = 0`.
- The two `public.source_records` rows are inserted while their parent import jobs are still open.
- Only after the source records exist, the fixture updates both import jobs to `status = 'committed'`, sets `completed_at = now()`, and records truthful counts: `source_row_count = 1`, `accepted_row_count = 1`, `issue_row_count = 0`.
- `public.acquisition_import_jobs` fixture rows now start as `mode = 'commit'`, `status = 'preview'`, `expected_line_count = 1`, all six committed-summary columns NULL, and `completed_at = NULL`.
- The two `public.acquisition_line_items` rows are inserted while their parent acquisition import jobs are still open.
- Only after the line items exist, the fixture updates both acquisition import jobs to `status = 'committed'`, sets `completed_at = now()`, and records truthful minimal-fixture summaries: zero orders, zero lots, one line item, zero cost components, zero unresolved supplier candidates, and zero unresolved cost components.
- The first successful `acquisition_line_classifications` INSERT now selects the intended active seeded rule with predicates on workspace, logical key, `status = 'active'`, `version = 5`, and `source = 'legacy_classifier_v5'` so the later retired v6 history row cannot participate.
- Other singleton `INSERT ... SELECT` rule fixtures were audited and tightened where needed to avoid arbitrary `LIMIT 1` cardinality masking.

## Static audit

The focused test setup was reviewed for parent-child and cardinality mistakes: children are staged before terminal parent updates; committed summaries match the rows actually inserted; terminal parents do not receive later children; singleton rule selections identify active v5 legacy rules where historical versions are present; workspace IDs still align across composite foreign keys; and expected SQLSTATEs continue to target the intended constraints rather than earlier lifecycle failures.

## Verification

Local PostgreSQL remains unavailable in this container (`psql` is missing), so `npm run db:reset`, the focused pgTAP run, and the full database test suite cannot execute locally. `git diff --check` passed locally. Push and exact-head CI inspection require GitHub network/auth access from an environment that can reach GitHub.

## Non-changes

No migration count change, no second migration, no schema redesign, no classification semantic change, no regex seed change, no lifecycle-trigger weakening, no `server/src/classify.ts` change, no Railway action, no hosted Supabase access, no hosted migration, no historical import, no S1.2 work, and no `docs/ai/CURRENT_STATE.md` edit.

## Next step

Push this repair to PR #41 and verify all four required exact-head CI jobs: `build-and-verify`, `shadow-db-postgres-shim`, `shadow-db-supabase-stack`, and `dev-advisory-report`.
