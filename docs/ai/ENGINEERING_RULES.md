# Russell Vault Engineering Rules

## 1. Authority and security

- Every application read and mutation requires an authenticated user unless explicitly public by design.
- Every record is workspace-scoped and must fail closed across workspaces.
- Use caller-token access with RLS or governed server/database functions.
- Never expose a service-role key to the browser.
- Never accept a workspace ID without verifying membership.
- Owner/operator may mutate where appropriate; viewers remain read-only.

## 2. Database changes

- Prefer additive migrations.
- Preserve existing identifiers and history.
- Use append-only events for movement, quantity adjustments, corrections, lineage, reconciliation adjudications, and other auditable changes.
- Use atomic functions for multi-step state changes.
- Lock rows and reject stale expected state where concurrent edits could lose data.
- Do not grant unrestricted direct-table writes when a governed function should own the mutation.
- Maintain plain-PostgreSQL shim and local Supabase compatibility.
- Apply required migrations to live Supabase only when the work order authorizes release and the exact commit has green required CI.
- Before any live Supabase read, migration, reset, restore, or parity claim, verify the target project ref against the Supabase URL configured in the deployed Railway environment. Do not infer production identity from a project name, repository document, remembered ref, or scoped project listing.
- The current deployed Russell Vault project ref is `ncyqqitqtsyjrijieykd`; re-verify the deployed environment before consequential live work rather than treating this line as permanent authority.

## 3. Identity

- Product, SKU, Lot, and Item remain distinct.
- Serialized units receive one Item and one scan SKU.
- Quantity-managed stock stores quantity on the Lot.
- One certificate or serial identifies at most one active physical unit per workspace.
- Never copy unique identifiers into “Add another like this.”
- Duplicate protection must exist server-side even when the client validates first.

## 4. History and corrections

- Do not silently edit committed identity.
- Correct identity through governed correction and supersession workflows.
- Do not hard-delete committed inventory to hide mistakes.
- Location changes create movement events.
- Quantity changes create adjustment, split, merge, receipt, sale, or other explicit events.
- Preserve actor, timestamp, reason, and before/after state.
- Do not infer authoritative chronology from random UUID ordering or transaction-stable timestamps when a governed sequence exists.

## 5. Client experience

- No raw UUIDs or internal database jargon in owner-facing UI.
- Design for iPad, desktop, keyboard scanner, touch, and mobile photo capture.
- Use visible loading, saving, success, conflict, and recovery states.
- Preserve drafts through refresh and safe navigation.
- Network retries must not create duplicates.
- Avoid page-level horizontal overflow.
- Use readable public IDs and scan identifiers.
- Never render empty or zero when the underlying read is unavailable, partial, stale, or unauthorized.

## 6. Media

- Inventory media is private.
- Use workspace-scoped storage paths and signed URLs.
- Validate type and size.
- Do not create permanent public media URLs.
- Primary-image switching must be atomic.
- Deletion must surface partial failures and support cleanup or retry.
- Recommended photo slots are guidance, not evidence.

## 7. Money and cost

- Use integer minor units or exact decimals.
- Never use floating-point arithmetic for stored money.
- Preserve currency and original entered totals.
- Cost allocations must reconcile exactly, with rounding adjustments explicit.
- Do not invent shipping, tax, fees, discounts, weights, or market values.
- Keep currencies separate unless a governed FX fact explicitly authorizes conversion.
- Unresolved cost or basis must never be represented as a silent zero.

## 8. Testing

Required before release acceptance:

- lint;
- client and server typecheck;
- client and server build;
- client and server tests;
- plain PostgreSQL reset and pgTAP;
- local Supabase reset and pgTAP;
- production dependency audits;
- focused rendered, browser, or hosted acceptance for the changed owner workflow.

Do not weaken tests merely to obtain green CI. Report skipped, timed-out, cancelled, hanging, or unchecked commands honestly.

Database suites that share one shadow database run sequentially. A focused pgTAP file may be run directly for diagnosis, but it does not substitute for the full suite.

## 9. Branch, merge, CI, and deployment

- Begin from current `main` unless the work order says otherwise.
- Work on a short-lived branch and open a draft PR.
- By default, stop at a green exact PR head. Do not merge, apply live migrations, or deploy unless the work order explicitly authorizes those actions.
- The four required CI jobs are `build-and-verify`, `shadow-db-postgres-shim`, `shadow-db-supabase-stack`, and `dev-advisory-report`.
- For an unmerged PR, inspect all four required jobs on the exact PR-head SHA.
- After a merge, separately inspect the GitHub Actions workflow triggered by the push to `main` on the merge SHA. A green PR-head run does not prove the resulting `main` push run is green.
- Railway deployment success and GitHub commit-status summaries do not substitute for the required GitHub Actions jobs.
- When release is authorized, verify Railway serves the final merge SHA through `/api/version`.
- Use Git history as rollback.
- Avoid Railway configuration changes unless required and verified.

## 10. Implementation discipline

- Inspect and reuse existing code before creating parallel systems.
- Prefer one coherent owner-facing vertical slice over disconnected partial features.
- Do not stop at backend-only implementation.
- Do not replace implementation with a documentation packet.
- Implementation agents update `LAST_IMPLEMENTATION_HANDOFF.md`; they must not edit `CURRENT_STATE.md` unless explicitly authorized.
- Record non-blocking discoveries in the final handoff instead of silently expanding scope.
- Treat repository handoffs and documentation as evidence to verify, not as unquestionable authority when they conflict with deployed configuration, GitHub, or the live governed database.
