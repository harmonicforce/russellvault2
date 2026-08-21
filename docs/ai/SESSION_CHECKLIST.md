# Russell Vault Implementation Session Checklist

## Start

- [ ] Read `AGENTS.md`, `CLAUDE.md`, and all required `docs/ai` files.
- [ ] Fetch current `main`.
- [ ] Record the exact base SHA.
- [ ] Confirm a clean working tree.
- [ ] Confirm work-order scope and release authority.
- [ ] Inspect relevant existing code, migrations, tests, CI, and deployment state.
- [ ] If live Supabase matters to the task, verify the target project ref against the deployed Railway Supabase URL before making any live claim or operation.
- [ ] Create a short-lived feature branch and draft PR.

## Plan

- [ ] Define the owner workflow from entry point to completion.
- [ ] Identify database, server, client, recovery, authorization, and test layers.
- [ ] Reuse existing governed authorities.
- [ ] Identify concurrency, retry, and audit risks.
- [ ] Split large work into dependency-ordered checkpoints.

## Implement

- [ ] Preserve Product → SKU → Lot → Item.
- [ ] Preserve workspace isolation and caller-token authorization.
- [ ] Use additive migrations and governed mutations.
- [ ] Provide iPad/desktop owner UI without raw UUIDs.
- [ ] Provide loading, error, conflict, retry, and recovery states.
- [ ] Preserve immutable evidence and append-only history.
- [ ] Avoid unrelated cleanup and speculative expansion.

## Validate

- [ ] Root, client, and server dependency installs pass.
- [ ] Lint passes or warnings are explicitly reported.
- [ ] Client and server typechecks pass.
- [ ] Client and server builds pass.
- [ ] Complete client and server tests pass.
- [ ] Database reset from empty passes.
- [ ] Full pgTAP passes on PostgreSQL shim.
- [ ] Full pgTAP passes on local Supabase CI tier.
- [ ] Production audits pass under the repository's explicit audit policy.
- [ ] Rendered/browser tests cover the owner workflow where applicable.
- [ ] `git diff --check` passes.
- [ ] Every claimed command has a checked exit code.

## Draft PR gate

- [ ] Final branch is pushed.
- [ ] Working tree is clean.
- [ ] Draft PR targets current `main`.
- [ ] Exact PR-head SHA is recorded.
- [ ] All four required CI jobs are green on that exact PR-head SHA.
- [ ] `LAST_IMPLEMENTATION_HANDOFF.md` is current.
- [ ] No unauthorized live migration, merge, or deployment occurred.

## Release gate, only when authorized

- [ ] Owner or work order explicitly authorizes release.
- [ ] Exact green PR head is merged through GitHub.
- [ ] Record the exact resulting `main` merge SHA.
- [ ] Inspect the GitHub Actions workflow triggered by the push to `main` on that merge SHA; all four required jobs are green.
- [ ] Do not substitute PR-head CI, Railway deployment status, or commit-status summaries for the `main` push workflow.
- [ ] Re-verify the deployed Railway Supabase URL and extract the production project ref.
- [ ] Live Supabase migration parity is checked against that exact deployed project.
- [ ] Required migrations are applied only to that verified project and parity is rechecked.
- [ ] Railway deploys the final merge SHA.
- [ ] `/api/health` succeeds.
- [ ] `/api/version` reports the final SHA.
- [ ] Hosted owner workflow passes.
- [ ] Rollback path is recorded.

## Surrender

- [ ] Branch, base SHA, final SHA, and PR are recorded.
- [ ] Files and migrations changed are listed.
- [ ] Tests, totals, failures, and CI run IDs are recorded.
- [ ] PR-head CI and, when merged, `main` push CI are reported separately.
- [ ] Live Supabase project ref, how it was verified, migration parity, Railway, and hosted acceptance status are explicit.
- [ ] Known defects and skipped proof are explicit.
- [ ] Exact next owner decision is stated.
- [ ] `CURRENT_STATE.md` was not edited unless explicitly authorized.
