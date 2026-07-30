# Engineering Rules

## Evidence and claims

- Inspect before changing.
- Distinguish verified repository facts from assumptions.
- Never report a command, test, migration, deployment, benchmark, or hosted check as successful unless it was actually run and observed.
- Preserve exact commit SHAs, branch names, commands, and test counts in handoffs.

## Branching and commits

- Start from the canonical branch and verified SHA in `CURRENT_STATE.md`.
- Use a dedicated working branch for implementation or documentation changes.
- Commit coherent checkpoints with descriptive messages.
- Do not force-push, rewrite shared history, delete branches, merge, deploy, or change repository defaults without explicit authorization.

## Database and authority

- Legacy SQLite is authoritative until an explicit owner-approved transition is recorded.
- Supabase/PostgreSQL remains shadow/non-authoritative.
- Do not introduce dual-write, silent synchronization, automatic cutover, or a second committed truth.
- Maintain workspace isolation, RLS, caller-derived workspace context, immutable evidence, idempotency, and explicit concurrency behavior.
- Migrations must be additive unless a reviewed correction requires otherwise.
- Never use service-role credentials in browser/client code.

## Product behavior

- The server is authoritative for workflow state, blockers, transitions, identities, idempotency, and commit decisions.
- Clients may validate shape and improve operator ergonomics but must not contain a competing business-rule engine.
- Unknown factual values stay unknown. Do not invent defaults for source, cost, condition, grade, certificate, defects, marketplace state, or location.
- Terminal records remain read-only unless a governed correction path exists.

## Testing

Run checks appropriate to the changed surface, then complete the repository-required validation before declaring the checkpoint complete. At minimum, account for:

- root, client, and server dependency roots
- lint and typecheck
- builds
- unit/component tests
- database/pgTAP tests when migrations or SQL behavior change
- concurrency tests when locking, uniqueness, idempotency, or capacity behavior changes
- security/audit gates

If an environment prevents a required test, state exactly what was not run and why.

## Documentation

- Keep implementation documentation synchronized with actual behavior.
- `CURRENT_STATE.md` is reviewer-owned and must not be edited by implementation agents.
- Update `LAST_IMPLEMENTATION_HANDOFF.md` at every checkpoint.
- Remove stale statements when later work supersedes earlier draft language.

## Context limits

Context exhaustion is not permission to narrow scope. Decompose, commit, hand off, and resume.