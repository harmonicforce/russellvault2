# Last Implementation Handoff

## Surrender state

- Canonical branch: `main`
- Last reviewed merge: `2f7a73ad4380c091da65db78a6f83a52f553d93c`
- Merged PR: #25, “Fix red CI (client + cycle-count pgTAP), refresh deployment docs, add hygiene files”
- Repository migration count: 47
- Exact PR-head CI run: `30675105213`, conclusion `success`
- Required jobs: all four green
- Railway deployment: success
- Hosted Cycle Count acceptance steps 1–8: owner-reported green
- Working tree state at handoff: repository state represented by merged `main`; no implementation branch is designated as active

## What is shipped

The owner-facing application includes authentication, workspaces, setup, locations, multi-category intake, inventory browsing, media foundations, movement, quantity governance, corrections, Daily Workbench, and the governed Cycle Count workflow.

Cycle Count includes explicit immutable rounds, blind counting and recounts, atomic keyed observations, round-aware results, discrepancy review, governed resolutions and approvals, durable loss/failure evidence, completion summaries, owner UI, audit UI, and Workbench queues.

PR #25 repaired the integrated validation layer:

- fixed the `Counting` component `progress` prop build failure;
- enabled jsdom and cleanup for rendered Cycle Count tests;
- updated the migration ledger from 41 to 47;
- corrected composite-FK and trigger assertions;
- bound tests to the granted atomic UUID-keyed observation functions;
- exercised the real create → approve → execute resolution flow;
- refreshed deployment documentation and repository hygiene.

No migrations or governed production functions were changed by PR #25.

## Verification evidence

- Client tests: 297 reported passing on the accepted PR head
- Server tests: 355 reported passing on the accepted PR head
- Client/server lint, typecheck, build, and production audits: green in CI
- PostgreSQL-shim pgTAP: green
- Supabase-stack pgTAP: green
- Development advisory report: green
- Railway deployment status: success
- Hosted Cycle Count smoke path: owner reports all eight acceptance steps green

## Live-state caution

The repository contains 47 migrations. This handoff does not independently record the live Supabase migration ledger. Any next migration-bearing release must check live parity before applying new migrations and must report the result explicitly.

## Open product work

- Media and Photography Hardening
- Acquisition Receiving and Landed Cost
- inventory cost-basis read models
- Listing Prep Command Center
- Sales, Fulfillment, Returns, and Inventory Exit
- Operational Dashboard and Inventory Intelligence
- broader browser acceptance and release normalization

## Known technical follow-ups

- media retry/progress, reorder, rotation, primary switching, recovery, and orphan handling;
- intermittent local in-suite slowdown in `15_acquisition_digest_parity.sql`;
- verify generated database types remain aligned when future schema work lands;
- preserve exact-head CI and live-migration verification for every release.

## Next-agent instruction

Read `AGENTS.md` and the required files listed in `CLAUDE.md`. Start from current `main`, inspect the exact feature area, create a short-lived branch and draft PR, and stop at a green exact PR head unless the work order explicitly authorizes merge, live migration, and deployment.
