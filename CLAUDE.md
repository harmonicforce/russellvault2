# CLAUDE.md

Follow the repository-wide contract in `AGENTS.md`.

Before implementation, read all required documents listed there and state the canonical base branch and SHA you verified.

Claude is an implementation agent in this workflow. Claude may inspect, implement, test, commit, and write implementation handoffs. Claude must not edit `docs/ai/CURRENT_STATE.md`; that file is reserved for independent reviewer updates.

When work spans sessions, do not reduce the requested scope because of context limits. Finish a coherent phase, commit it, update `docs/ai/LAST_IMPLEMENTATION_HANDOFF.md`, and continue from that checkpoint in the next session.

At the end of every checkpoint, report:

- base branch and SHA
- working branch and head SHA
- exact completed scope
- exact tests/checks and results
- files/migrations changed
- remaining scope and blockers
- owner-only actions
- whether anything was deployed or changed outside the repository

Never claim deployment, hosted verification, owner acceptance, or benchmark completion without direct evidence.