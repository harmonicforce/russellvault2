# Last Implementation Handoff

## S1.2 corrected final state

- S1.2 was merged through PR #43. Implementation head: `ac5365fdafeb484d559a7a64ff49ebf801dcbf99`; merge commit: `26fc578d921babdcd97577484df24110a4884595`.
- Exact-head CI run `31090088564` passed all four required jobs. PR #42 is obsolete and remains open.
- No hosted migration was claimed or performed.

## S1.3 governed acquisition-line read surface

- Repository: `harmonicforce/russellvault2`; base: `26fc578d921babdcd97577484df24110a4884595`; branch: `codex/s1-3-acquisition-read-surface`.
- Draft PR and final exact head/CI: recorded after the handoff commit is pushed and exact-head CI completes.
- Additive migration: `20260806000100_acquisition_line_read_surface.sql` (repository migrations 62 → 63).
- `acquisition_line_overview`: one row per committed governed-native acquisition line, active placement/order only, current classification only, exact same-workspace joins.
- RPCs: `list_acquisition_lines(uuid,text,text,text,text,text,text,text,text,integer,integer)` and `get_acquisition_facets(uuid)`. Both re-authorize `auth.uid()` membership, permit all member roles, revoke public/anon, and grant authenticated execute only.
- HTTP: `GET /api/acquisition/lines` and `GET /api/acquisition/facets`, caller bearer token and explicit active workspace, bounded errors, `coverage: governed_native_committed`, `historicalLegacyImported: false`.
- Client: governed `/acquisitions` primary-navigation route; submitted search, URL-held filters/sort/order/page, exact totals, classification facets, desktop table, sub-`lg` cards, retryable loading/error truth.
- Persistent coverage notice says historical legacy Whatnot purchases are not imported and the two populations' counts must not be added. No financial aggregate is shown.
- Focused pgTAP file `58_acquisition_line_read_surface.sql`: 60 assertions; full plain-PostgreSQL pgTAP: 1,848 assertions.
- Repository verification passed: dependency installs, lint (seven pre-existing warnings), typecheck, CI build (existing chunk warning), server 463 tests, client 558 tests, combined guard/advisory 23 tests, separate database guard 9 tests, separate client advisory gate 14 tests, database reset/suite, and `git diff --check`.

## Boundaries and next decision

- No classification/override/rule-authoring endpoint, acquisition detail page, payment, shipment, receiving, exclusion, historical import, SQLite change, Railway action, hosted Supabase access/migration, S1.4 implementation, or `CURRENT_STATE.md` edit.
- Hosted migration parity: not checked; hosted acceptance and deployment: not authorized/not checked. Rollback is branch/PR reversion before merge.
- Next slice: S1.4 acquisition payments/shipments schema and acquisition detail page.
