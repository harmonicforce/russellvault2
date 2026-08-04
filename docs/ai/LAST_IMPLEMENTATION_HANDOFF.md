# Last Implementation Handoff

## S1.1 — Governed Acquisition Classification Schema and Versioned Rules

- Repository: `harmonicforce/russellvault2`
- Base SHA actually available in this workspace: `bb4aa88604d152cad4d578448c46e1af93af60fb`
- Branch: `claude/s1-1-governed-classification-schema`
- Final head SHA: 34053b16a67fe0812f7f324fe751262043b4e5d0 (pre-final-amend handoff metadata)
- PR: not opened in this environment; GitHub fetch/push/PR creation blocked by CONNECT tunnel 403 and no make_pr tool was available
- Migration count before/after: 60 → 61
- Migration: `supabase/migrations/20260804000100_governed_acquisition_classification.sql`

## Implemented schema

Tables created:

1. `acquisition_classification_options`
2. `classification_rules`
3. `acquisition_line_classifications`

Default options seeded for every existing and future workspace: `slab`/Slab, `single`/Single, `sealed`/Sealed, `sneakers`/Sneakers, `apparel`/Apparel, `accessories`/Accessories, `electronics`/Electronics, `collectibles`/Collectibles, `other`/Other, `unreviewed`/Unreviewed. The taxonomy is governed table data rather than a PostgreSQL enum.

Default rule families seeded from `legacy_classifier_v5`: `business_vertical_mapping`, `explicit_evidence`, `delivered_item_pattern`, `strong_mystery_pattern`, `full_title_pattern`, and `seller_specialization`. Seller specializations migrated into governed seed rows: `topshelfcollects` → Single, `loosepacks` → Sealed, `findsfordays` → Single. Seller rationales state they are owner-confirmed fallbacks and must not override more specific product signals.

Public IDs use the existing `app.mint_governed_public_id` helper with prefixes `RV-ACOPT`, `RV-CRULE`, and `RV-ACLS`.

Append-only enforcement blocks direct deletion of rules and classification decisions and blocks in-place edits to semantic fields. Classification supersession uses `acquisition_line_classifications.supersedes_classification_id`: the new decision references the prior decision, leaving prior history intact and making the new unsuperseding row current.

RLS is enabled on all new tables. `authenticated` receives SELECT only through workspace-member RLS policies; `anon`, `PUBLIC`, and `service_role` table privileges are revoked. No owner mutation or classification evaluation RPC is introduced in S1.1.

## pgTAP coverage

Focused file: `supabase/tests/55_governed_acquisition_classification.sql` with 67 planned assertions covering taxonomy, rule seed data, append-only constraints, same-workspace references, supersession, grants, and RLS isolation. `supabase/tests/06_provenance_structure.sql` migration-count assertion was updated from 60 to 61 and its expected migration list now includes the S1.1 migration.

## Verification

Local verification was limited by this container missing `psql`; `npm run db:reset` failed before applying migrations with `spawnSync psql ENOENT`. Full Supabase-stack verification and exact-head CI must be checked by the next agent/operator once CI runs for the draft PR.

## Limitations and non-changes

- No hosted Supabase project was accessed and no hosted migration was applied.
- No Railway work was attempted.
- S0.3 was not attempted.
- No SQLite file was changed and no historical data was imported or classified.
- `server/src/classify.ts` behavior remains unchanged; `CLASSIFIER_VERSION` remains 5.
- No Express endpoint, React page, editor, or S1.2 classification function was added.
- `docs/ai/CURRENT_STATE.md` was not edited.

## Proposed CURRENT_STATE.md replacement text

After independent review/merge, add that S1.1 implemented a repository-only governed acquisition classification foundation: workspace-scoped reference options, versioned rule seed data equivalent to `legacy_classifier_v5`, and append-only acquisition-line classification history. Do not mark S1 complete, hosted accepted, or deployed unless those gates are separately proven.

## Next slice

S1.2: controlled classification functions and pgTAP evaluation coverage.
