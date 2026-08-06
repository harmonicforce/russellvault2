# Last Implementation Handoff

## S1.2 governed acquisition classification functions

- Repository: `harmonicforce/russellvault2`
- Base SHA recorded locally: `c7c6f07d2ff80e5df8419c11a73017bd35a7128e`
- Branch: `codex/s1-2-classification-functions`
- PR: not opened from this environment; GitHub network access failed with `CONNECT tunnel failed, response 403`.
- Migration: `supabase/migrations/20260805000100_governed_acquisition_classification_functions.sql`
- Repository migration count: 61 before, 62 after.

## Functions

- `app.acquisition_delivered_item_title(text)`
- `app.get_acquisition_classification_input(uuid)`
- `app.classification_match_value(jsonb, text)`
- `app.regex_flags_supported(text)`
- `app.validate_classification_rule_payload(text,text,text,text,text)`
- `app.evaluate_acquisition_classification(uuid)`
- `public.classify_acquisition_line(uuid)`
- `public.override_acquisition_line_classification(uuid,text,text)`
- `public.create_classification_rule(uuid,text,text,text,text,text,text,text,text,integer,text)`
- `public.supersede_classification_rule(uuid,integer,text,text,text,text,text,text,integer,text)`

## Classification behavior

- Input mapping uses governed acquisition/provenance data only: workspace, line ID/public ID, import job status, business vertical, full/product title, delivered-item title via final ` - ` extraction, source record/system IDs, and seller normalized handle through the acquisition order's supplier alias relationship.
- Explicit evidence status: no governed workspace-scoped equivalent of legacy `sealedLineIds` was found; `evidence_set` rules remain non-matching and evidence records `legacy_sealed_line_ids_unavailable`.
- Evaluator ordering: active rules only; lower numerical precedence wins; ambiguity at the winning precedence raises check violation.
- Fallback: no active match returns active same-workspace `unreviewed` with explicit no-match fallback evidence.
- Confidence: deterministic `1.0000` for governed rules and owner overrides.

## Mutation behavior

- Automatic classification authorizes owner/operator membership as part of line lookup, requires a committed acquisition job, locks the line and current classification, preserves owner overrides, and supersedes system classifications atomically.
- Owner override is owner-only, requires a bounded nonblank reason, active same-workspace option, and creates `owner_override` history without rule provenance.
- Rule authoring is owner-only; version bumps lock the active rule, require the expected version, mark the predecessor superseded, and insert a new active successor.
- Direct authenticated table writes remain denied; public mutation functions are `SECURITY DEFINER`, revoked from `PUBLIC`/`anon`, and granted only to `authenticated`.

## Audit events

- `acquisition_line_classified`
- `acquisition_line_classification_superseded`
- `acquisition_line_classification_overridden`
- `classification_rule_created`
- `classification_rule_superseded`

## Verification status

- `npm run db:reset` failed locally because `psql` is not installed (`spawnSync psql ENOENT`).
- Full pgTAP, focused pgTAP, CI, and PR checks are not verified in this environment due to missing local PostgreSQL tooling and blocked GitHub network access.
- `git diff --check` passed locally.

## Limitations and next slice

- Concurrency proof is implemented through row locks/unique current indexes but not executed locally because pgTAP/database tooling is unavailable.
- Draft PR still needs to be pushed/opened from an environment with GitHub access and verified against exact-head CI.
- No Express endpoint, React page, Railway work, hosted Supabase access, hosted migration, SQLite change, `server/src/classify.ts` change, historical import, S1.3 work, or `CURRENT_STATE.md` edit was performed.
- Next slice: S1.3 acquisition read endpoints and list page.
