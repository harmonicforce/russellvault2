# Last Implementation Handoff

## S1.1 / PR #40 repair — Governed Acquisition Classification Schema and Versioned Rules

- Repository: `harmonicforce/russellvault2`
- PR: #40, `Draft: S1.1 add governed acquisition classification schema`
- Branch: `codex/add-governed-acquisition-classification-schema`
- Original failing PR head: `d179cf76c8d8d7346fa837aba8f0b604a43c32b6`
- Local head inspected before repair: `6793c9b4251e7acd7e6ba8b25b1f66aafc37558a`
- Final repaired head: 89077ab0800450e09421a4562ba0f7b0b5d33c03 (pre-handoff-amend)
- Migration count before/after remains: 60 → 61
- Migration: `supabase/migrations/20260804000100_governed_acquisition_classification.sql`

## CI failure causes repaired

1. Automatically seeded classification options/rules used restrictive workspace FKs, preventing deletion of otherwise empty workspaces.
2. The focused cross-workspace option-target test used invalid logical key `x`, so it hit the logical-key check before the intended composite-FK violation.
3. The focused governed acquisition fixture inserted nonexistent `source_systems.key`/`name` columns and needed to match the actual provenance/acquisition schemas.
4. The current-classification partial index used `supersedes_classification_id IS NULL`, which made the predecessor look current after a successor was inserted.
5. Seeded regex payloads used doubled SQL backslashes; S1.2 needs the stored pattern source to match `server/src/classify.ts` semantics.

## Exact repairs

- New workspace-owned default/reference rows now cascade with workspace deletion, while direct rule and classification deletion remains blocked unless PostgreSQL is already performing cleanup after the parent workspace row has disappeared.
- `acquisition_line_classifications` now has `superseded_at timestamptz`; the current invariant is exactly one row per `(workspace_id, acquisition_line_item_id)` where `superseded_at IS NULL`.
- `superseded_at` can move from NULL to a non-NULL value exactly once, and no semantic field can change during that retirement update.
- A unique partial index prevents two successors from naming the same predecessor.
- The focused fixture now uses actual `source_systems`, `import_jobs`, `source_records`, `channels`, `acquisition_import_jobs`, and `acquisition_line_items` columns/constraints.
- The focused test now checks exact regex payloads, seller exact values, business-vertical exact values, and the explicit-evidence placeholder.

## Implemented S1.1 schema

Tables created: `acquisition_classification_options`, `classification_rules`, and `acquisition_line_classifications`. Default options are `slab`/Slab, `single`/Single, `sealed`/Sealed, `sneakers`/Sneakers, `apparel`/Apparel, `accessories`/Accessories, `electronics`/Electronics, `collectibles`/Collectibles, `other`/Other, and `unreviewed`/Unreviewed. Initial rule families are `business_vertical_mapping`, `explicit_evidence`, `delivered_item_pattern`, `strong_mystery_pattern`, `full_title_pattern`, and `seller_specialization`; seller defaults are `topshelfcollects → Single`, `loosepacks → Sealed`, and `findsfordays → Single`, all from `legacy_classifier_v5` / version 5.

RLS remains enabled on all new tables. `authenticated` receives SELECT only through workspace-member policies. `anon`, `PUBLIC`, and `service_role` direct table privileges are revoked. No mutation/classification RPC, Express route, React page, historical import, hosted migration, Railway action, SQLite change, or S1.2 work was added.

## pgTAP coverage

Focused file: `supabase/tests/55_governed_acquisition_classification.sql` with 76 planned assertions. It covers taxonomy, default seeding, owner extension, no enum taxonomy, exact seeded rule payloads, seller targets/rationales, rule immutability, actual-schema governed acquisition fixtures, current-classification supersession, cross-workspace constraints, grants/RLS, empty-workspace cascade deletion, and protection of workspaces with governed evidence.

Full database assertion count and exact-head CI results are pending a PostgreSQL/Supabase-capable environment. This local container still lacks `psql`, so `npm run db:reset` cannot start.

## Remaining limitations

- Push/PR/CI inspection requires repository network/auth access.
- Local database verification requires `psql`/PostgreSQL or the Supabase stack.
- PR #40 should remain unmerged; convert to draft if the available GitHub UI allows it safely.

## Proposed CURRENT_STATE.md replacement text

After independent review/merge, add that S1.1 implemented a repository-only governed acquisition classification foundation: workspace-scoped reference options, versioned rule seed data equivalent to `legacy_classifier_v5`, and append-only acquisition-line classification history with `superseded_at` current-row semantics. Do not mark S1 complete, hosted accepted, or deployed unless those gates are separately proven.

## Next slice

S1.2: controlled classification functions and pgTAP evaluation coverage.
