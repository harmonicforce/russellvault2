# Last implementation handoff

## Final Cycle Count implementation checkpoint

Corrective migrations remain unapplied to live Supabase. This checkpoint closes
the locally implementable client contract; environmental and publication proofs
listed below are still mandatory before acceptance.

## Final evidence report

1. **Working branch:** `work`.
2. **Final remote SHA:** unavailable; the configured repository proxy at
   `127.0.0.1:41729` refused the connection.
3. **Draft PR:** metadata was recorded with the required PR tool, but no GitHub PR
   number or URL is available without a reachable remote.
4. **Checkpoint commits:** `e30b0b7`, `feb6054`, `4a8e9ae`, `42c0007`,
   `9a48cdc`, `5d15050`, `20a7943`, `f16a057`, plus the current final
   checkpoint.
5. **Migrations:** additive migrations `20260730000100` through
   `20260730000500` and `20260731000100`; no historical migration changed.
6. **Rounds:** sessions point to persisted workspace-scoped initial/recount
   rounds with unique per-session numbers and append-only lifecycle evidence.
7. **Blindness:** direct expected-item/lot reads are revoked; governed reads
   distinguish counters from owner/reviewers and recount progress hides answers.
8. **Recount:** owner selection remains in review; one atomic begin freezes the
   entire selected set into one blind round.
9. **Results/discrepancies:** immutable per-round results retain predecessors;
   latest accepted results drive active successor discrepancies and recount
   classifications while historical discrepancies remain evidence.
10. **Lifecycle locks:** observe, void, submit, recount start, cancel, complete,
    and resolution paths lock the governed session/round before validation.
11. **Idempotency:** canonical winner rows and append-only attempts distinguish
    accepted, replay, subject conflict, key conflict, rejected, and closed
    outcomes. The scanner UI now reuses its client key after an indeterminate
    failure and rotates it only after a structured success.
12. **Resolution matrix:** discrepancy/action rules govern role, reason,
    destination, quantity, approval, downstream function, and completion state.
13. **Failed attempts:** create and execute are separate commits; sanitized
    failure events are durable and successful execution is once-only.
14. **Loss:** append-only loss events validate item/session/discrepancy/attempt
    provenance; loss is separate from duplicate or invalid-record voiding.
15. **Summaries:** completed UI consumes the latest-result server summary and
    displays historical rounds separately, preventing lot totals across rounds
    from being added together.
16. **Database assertions:** Cycle Count tests 34–40 declare 125 fixed assertions;
    test 33 is fixture-driven `no_plan()`. None executed here.
17. **Concurrency:** test 40 declares 22 bounded overlapping-session assertions;
    none executed here because `psql` is unavailable.
18. **Server/client totals:** two dependency-free Node suites passed 23/23.
    Vitest server/client totals are unavailable because dependencies could not be
    installed.
19. **Rendered tests:** seven Cycle Count rendered cases are present; unexecuted.
20. **Playwright:** six required real browser flows remain unavailable and are
    not fabricated; the environment returned HTTP 403 for Playwright packages.
21. **CI:** no run IDs or outcomes; remote publication is unavailable.
22. **Live Supabase:** untouched; no migrations applied.
23. **Railway:** untouched.
24. **Incomplete:** PostgreSQL/pgTAP/concurrency execution, Playwright source and
    execution, generated types, full lint/typecheck/test/build/audits, remote SHA,
    PR number/URL, and CI results.
25. **Owner-only actions:** review expected data, select/begin recount, create and
    execute resolutions, complete, and cancel remain owner-gated.
26. **Exact next step:** restore the repository remote and use a runner with npm,
    PostgreSQL/pgTAP, Docker, and browsers; execute the complete matrix, correct
    every failure, push without force, and update the draft PR evidence.

## Validation performed

- `git diff --check`: exit 0.
- `node --test scripts/db/guard.test.mjs scripts/ci/client-audit-gate.test.mjs`:
  exit 0, 23 passed, 0 failed.
- `node scripts/db/test.mjs`: exit 1; `psql` failed to start with `ENOENT`.
- Client `npm ci --ignore-scripts`: interrupted with exit 130 after a bounded
  wait without progress.
- Playwright package lookup/install: exit 1, HTTP 403 from the environment proxy.
- PostgreSQL package installation: exit 100, HTTP 403 from the apt proxy.
- `git fetch origin main --prune`: exit 128, connection refused by the local
  repository proxy.

Do not ship. No merge, deployment, live migration, Railway operation,
branch-protection change, or production configuration change was performed.
