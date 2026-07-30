# Claude ↔ Codex Handoff Protocol

## Start of session

The incoming agent must read the files listed in `AGENTS.md`, then verify:

- current `main` head SHA;
- latest reviewed product commit recorded in `CURRENT_STATE.md`;
- open PRs and unmerged branches relevant to the task;
- claims in `LAST_IMPLEMENTATION_HANDOFF.md` against the actual diff and available CI;
- whether Railway and live Supabase state were actually verified or merely reported.

State the verified starting point before implementation. If the repository contradicts the handoff, stop and report the contradiction.

## During work

- Branch from current `main` unless the work order explicitly says otherwise.
- Use a dedicated working branch.
- Break large work into named phases with acceptance criteria.
- Commit each coherent checkpoint.
- Preserve the full authorized scope across sessions.
- Do not edit `CURRENT_STATE.md`.

## Required checkpoint document

At every checkpoint, replace `LAST_IMPLEMENTATION_HANDOFF.md` with:

```md
# Last Implementation Handoff
- Agent:
- Date:
- Base branch:
- Base SHA:
- Working branch:
- Head SHA:
- PR:

## Requested scope
## Completed in this checkpoint
## Files and migrations changed
## Validation actually run
| Command/check | Result |
|---|---|
## Not run or not verified
## Known issues and risks
## Owner-only actions
## Exact next step
```

Do not carry forward stale test results from an earlier head.

## Independent review

An implementation report is evidence, not acceptance. The reviewer independently inspects the commit, diff, tests, CI, migrations, and hosted evidence, then updates `CURRENT_STATE.md`.

## Merge and deployment

A commit or PR does not authorize merge, deployment, Railway changes, live Supabase changes, or authority transfer. Those require explicit owner direction.
