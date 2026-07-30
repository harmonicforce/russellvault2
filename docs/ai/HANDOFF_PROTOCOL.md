# Claude ↔ Codex Handoff Protocol

This protocol keeps work portable across agents and context windows without relying on chat history.

## Starting a session

The incoming agent must:

1. Read `AGENTS.md` and the documents it names.
2. Verify the canonical base branch and SHA from `CURRENT_STATE.md` against GitHub.
3. Read `LAST_IMPLEMENTATION_HANDOFF.md` as a claim set, not as unquestioned truth.
4. Inspect the referenced commit, changed files, tests, and open gates.
5. State the verified starting point before implementation.

If the repository contradicts the handoff, stop and report the contradiction. Repository evidence wins.

## During implementation

- Work on a dedicated branch.
- Preserve all authority and deployment boundaries.
- Break large work into named phases with acceptance criteria.
- Commit every coherent checkpoint.
- Do not edit `CURRENT_STATE.md`.

## Required checkpoint handoff

Replace the contents of `LAST_IMPLEMENTATION_HANDOFF.md` with a current report using this structure:

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

Do not leave stale results from earlier heads in the active handoff.

## Independent review

After an implementation checkpoint, the reviewer:

1. independently inspects the commit and diff;
2. verifies tests/CI where available;
3. checks claims against actual behavior and scope;
4. records corrections and remaining gates;
5. updates `CURRENT_STATE.md`;
6. determines the next authorized work.

An implementation report is not acceptance by itself.

## Switching agents mid-phase

When Claude hands off to Codex, or Codex to Claude:

- the outgoing agent commits a coherent checkpoint;
- the outgoing agent updates `LAST_IMPLEMENTATION_HANDOFF.md` in the same branch;
- the incoming agent resumes from that exact SHA;
- the incoming agent does not redo completed work unless verification finds a defect;
- both agents preserve the original authorized scope across sessions.

## Merge and deployment

Creating a branch, commit, or PR does not authorize merge or deployment. Merge, Railway changes, hosted Supabase changes, default-branch changes, production writes, dual-write, and authority transfer require explicit owner direction.