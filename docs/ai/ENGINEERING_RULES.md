# Russell Vault Engineering Rules

## 1. Authority and security

- Every application read and mutation requires an authenticated user unless explicitly public by design.
- Every record is workspace-scoped.
- Fail closed across workspaces.
- Use caller-token access and RLS or governed server/database functions.
- Never expose a service-role key to the browser.
- Never accept a workspace ID from the UI without verifying membership.
- Owner/operator may mutate where appropriate; members may read where appropriate.

## 2. Database changes

- Prefer additive migrations.
- Preserve existing identifiers and history.
- Use append-only events for movement, quantity adjustments, corrections, lineage, and other auditable changes.
- Use atomic functions for multi-step state changes.
- Lock rows and reject stale expected state where concurrent edits could lose data.
- Do not grant unrestricted direct-table writes when a governed function should own the mutation.
- Maintain both plain-PostgreSQL shim compatibility and local Supabase compatibility.
- Apply required migrations to the live Supabase project before reporting hosted completion.

## 3. Identity

- Product, SKU, Lot, and Item remain distinct.
- A serialized physical unit receives one Item and one scan SKU.
- A quantity lot stores quantity on the Lot.
- One certificate or serial identifies at most one active physical unit in a workspace.
- Never copy a unique identifier into “Add another like this.”
- Never copy one serial or certificate across quantity greater than one.
- Duplicate protection must exist server-side even when the client validates first.

## 4. History and corrections

- Do not silently edit committed identity.
- Correct identity through a governed correction/supersession workflow.
- Do not hard-delete committed inventory to hide mistakes.
- Do not overwrite location; create a movement event.
- Do not overwrite quantity; create an adjustment, split, merge, receipt, sale, or other explicit event.
- Preserve the actor, timestamp, reason, and before/after state.

## 5. Client experience

- No raw UUIDs in owner-facing UI.
- No SQL, schema, shadow, kernel, or internal-state jargon in normal owner screens.
- Design for iPad, desktop browser, keyboard scanner, touch, and mobile photo capture.
- Use visible loading, saving, success, conflict, and recovery states.
- Preserve drafts through refresh and safe navigation.
- A network retry must not create duplicate inventory.
- Avoid horizontal page overflow; large grids may scroll within their own bounded container.
- Use readable public IDs and scan identifiers.

## 6. Media

- Inventory media is private.
- Use workspace-scoped storage paths and signed URLs.
- Validate file type and size.
- Do not create public permanent media URLs.
- Primary-image switching should be atomic.
- Deletion must surface partial failure and permit cleanup/retry.
- Recommended photo slots are guidance, not evidence.

## 7. Money and cost

- Use integer minor units or an exact decimal type.
- Never use floating-point arithmetic for stored money.
- Preserve currency and original entered totals.
- Cost allocations must reconcile exactly.
- Show rounding adjustments explicitly.
- Do not invent shipping, tax, fees, discounts, weights, or market values.

## 8. Testing

Required before hosted completion:

- lint
- client typecheck
- server typecheck
- client build
- server build
- client tests
- server tests
- plain PostgreSQL reset and pgTAP
- local Supabase reset and pgTAP
- production dependency audits
- focused browser or hosted acceptance testing for the changed owner workflow

Do not weaken tests merely to obtain green CI.

## 9. Deployment

- Verify Railway serves the final commit through `/api/version`.
- Do not call a feature complete if it is only local, hidden, or undeployed.
- Do not deploy with required CI red.
- Use Git history as rollback.
- Avoid changing Railway configuration unless required and verified.

## 10. Implementation discipline

- Inspect and reuse existing code before creating parallel systems.
- Prefer one coherent owner-facing vertical slice over many disconnected partial features.
- Do not stop at backend-only implementation.
- Do not replace implementation with a large documentation packet.
- Keep documentation concise and update `CURRENT_STATE.md` when shipped behavior changes.
- Report incomplete requirements honestly with exact technical reasons.