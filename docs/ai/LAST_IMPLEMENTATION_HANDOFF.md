# Last Implementation Handoff

## S1.2 governed acquisition classification functions — CI repair

- Repository: `harmonicforce/russellvault2`
- Base SHA: `c7c6f07d2ff80e5df8419c11a73017bd35a7128e`
- Branch: `codex/draft-s1.2-add-governed-acquisition-classification-functions`
- Draft PR: `#42`
- Original PR head: `05146abde5db3b840d11dce84e15b78784cb93d4`
- Original failing CI run: `31075943936`
- Final exact head and CI run: recorded in the final PR report after the handoff commit is pushed and exact-head CI completes.
- Release authority: draft PR only; nothing was merged, deployed, or applied to hosted Supabase.

## Reproduced failures

- `55_governed_acquisition_classification.sql`, assertion 56 (`rule method requires rule`) returned `23505` from `acquisition_line_classifications_one_current_uidx`; the unchanged test expected `23514`.
- The original `56_governed_acquisition_classification_functions.sql` stopped on PostgreSQL because `hasnt_function_privilege(unknown, unknown, unknown)` did not exist. Direct execution after a pristine reset also exposed that the file relied on pgTAP having been created by an earlier test, so it now creates the extension itself.

## Repairs

- Restored the closed rule-presence invariant. `rule`, `seller_specialization`, and `explicit_evidence` require a governed rule and version. `owner_override` and the new `system_fallback` forbid rule references.
- Added explicit `system_fallback` method semantics: no actor, governed system provenance, deterministic confidence, active same-workspace fallback option, and explicit no-match evidence. Card no-match becomes Unreviewed; unknown non-card vertical becomes Other.
- Preserved the function-owned lock/retire/insert/link/audit sequence. No generic current-row retirement trigger was added.
- Replaced non-portable pgTAP negative privilege helpers with `ok(not has_*_privilege(...))` assertions. No shim wrapper was added and the shim was not edited.
- Corrected non-card behavior to map business vertical before inspecting any card title signal.
- Corrected card precedence: delivered signal, strong mystery, full-title fallback, seller specialization, then system fallback; the explicit-evidence placeholder remains nonmatching until governed evidence exists.
- Executed every accepted PostgreSQL regex flag (`i`, `m`, `s`, `x`) and translated JavaScript `\b` boundaries to PostgreSQL ARE `\y` at execution while retaining the governed source patterns unchanged.
- Removed arbitrary winner selection. Multiple matching rules at the winning numeric precedence fail closed.
- Restricted seller evidence to the exact governed alias tied to the line's acquisition order and source system/raw handle; display-name similarity is not used.
- Corrected classification audit events to reference the Phase 3 `import_jobs` identity required by the shared audit-event foreign key, and extended the closed audit event vocabulary for S1.2 events.

## Executable evidence

- `55_governed_acquisition_classification.sql`: 76 assertions.
- `56_governed_acquisition_classification_functions.sql`: 27 assertions.
- `57_governed_acquisition_classification_execution.sql`: 60 assertions.
- Test 57 executes evaluation, fallback, history filtering, ambiguity, authorization, automatic classification, idempotency, owner override preservation, rule authoring/supersession, audit, direct-write denial, and rollback on failed successor insertion.
- Genuine dblink overlap proves: two classifiers yield one current idempotent row; classifier-versus-override ends with the owner result and valid history; two overrides yield one current row and two history rows; and two concurrent rule supersessions yield one active winner with complete version history.
- Full plain-PostgreSQL pgTAP suite: 1,788 assertions passed.

## Repository verification

- `npm ci`, `npm ci --prefix client`, and `npm ci --prefix server`: passed. Existing audit output reported root two high advisories, client one moderate/two high, and server one moderate; the governed advisory CI gate remains authoritative.
- `npm run lint`: passed with seven pre-existing warnings.
- `npm run typecheck`: passed.
- `npm run build:ci`: passed with the existing client chunk-size warning.
- `npm test`: passed (server 461, client 554, guard/advisory 23).
- Separate database guard test: 9 passed.
- Separate client audit gate test: 14 passed.
- `npm run db:reset`: passed on PostgreSQL 16.14.
- `npm run db:test`: 1,788 assertions passed.
- `git diff --check`: passed.

## Boundaries and remaining risk

- Only the existing unmerged S1.2 migration was edited; no second migration was added.
- No `hasnt_function_privilege` shim wrapper, generic retirement trigger, new branch, new PR, merge, Railway action, hosted migration, S1.3 work, or `CURRENT_STATE.md` edit occurred.
- Local Supabase-stack execution is delegated to exact-head CI; no hosted schema or production data was touched.
- Rollback is branch/PR reversion before merge. The next owner decision is whether to review and merge PR #42 after its exact head has all four required jobs green.
