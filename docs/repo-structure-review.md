# Repository Structure Review

**Status:** Advisory. Nothing here changes shipped behavior. Every recommendation is
subject to the owner's priorities and to `docs/ai/ENGINEERING_RULES.md` and `CLAUDE.md`
(prefer additive, focused changes over rewrites; the server/database stays authoritative).
This document only *describes* structure and *suggests* improvements — it does not move
code, delete branches, or close pull requests.

## What this repository is

A monorepo for the Russell Vault operations app:

| Root | Stack | Purpose |
| --- | --- | --- |
| `server/` | Express + better-sqlite3 (TypeScript via `tsx`) | Authoritative API + SQLite prototype, seeded from `server/seed/*.json` |
| `client/` | Vite + React + TS + Tailwind v4, TanStack Query, react-router | Owner-facing operations UI |
| `supabase/` + `scripts/db/` | PostgreSQL / Supabase, pgTAP | Non-authoritative "shadow" foundation (workspaces, RLS, governed functions) |
| `docs/` | Markdown | Governance (`ai/`), `releases/`, `runbooks/`, architecture |
| `.github/workflows/ci.yml` | GitHub Actions (Node 20) | Lint, typecheck, build, test, audits, pgTAP — never deploys |

The codebase is already well-engineered: strong CI, per-root dependency audits, append-only
database governance, and an explicit AI work-order protocol. The findings below are about
**sharpening** an already-solid structure, not rescuing it.

---

## Findings (ordered by impact)

### P0 — Repository & branch hygiene (owner actions, no code)

**1. The default branch is `Beginner`, which is empty.**
`Beginner` contains only a one-line `README.md`. Every fresh clone and every new agent
branch starts from an app-less base (this review's own session branch did), and CI has to
carry `branches-ignore: Beginner` to compensate. **Recommend:** set the GitHub default
branch to `main` (Settings → General → Default branch).

**2. URGENT — Railway is serving a stale branch.**
`README.md` and `CLAUDE.md` state that Railway deploys
`claude/ui-better-spreadsheet-cjhwjb` and that it "points at the same commit" as `main`.
It no longer does: `cjhwjb` is **10 commits behind `main`** and is missing the entire
**cycle-count feature** (PRs #15 / #17) and the concurrency-harness fixes. Its only two
unique commits are CURRENT_STATE stewardship edits whose equivalents are already on `main`.
So the deployed app is running a version without cycle counts.
**Recommend:** switch the Railway service source branch to `main`
(Service → Settings → Source → Branch), verify via `GET /api/version`, then retire
`cjhwjb`. Update the now-stale parity claim in `README.md`/`CLAUDE.md`.

**3. URGENT — a correctness fix is stranded off `main`.**
PR #18 ("Preserve cycle count blindness during recounts", commit `6ca13e1`) merged into
`codex/redesign-cycle-count-recount-architecture-hxxy32` at 16:22 UTC, but `hxxy32` had
already been merged into `main` via PR #15 sixteen minutes earlier (16:06). The blindness
fix therefore never reached `main`. **Recommend:** verify against current `main` and, if
still absent, forward-port it in a new PR into `main` before deleting `hxxy32`.

### P0 — Branch inventory & disposition

The remote currently carries **18 branches**; most are stale. Confirm each is reflected in
`main` (`git log main..<branch>`) before deleting. This table is a recommendation, not an
action taken here.

| Branch | Relation to `main` | Recommended disposition |
| --- | --- | --- |
| `main` | — | **Keep.** Make it the default branch and the deploy source. |
| `Beginner` | empty, currently default | Flip default to `main`, then keep as an archive tag or delete. |
| `claude/ui-better-spreadsheet-cjhwjb` | 2 ahead / 10 behind | **Reconcile then retire** (see P0-2); the 2 unique commits already have equivalents on `main`. |
| `codex/redesign-cycle-count-recount-architecture-hxxy32` | 2 ahead / 1 behind | **Forward-port PR #18** (see P0-3), then delete. |
| `claude/p0-source-provenance` | merged | Safe to delete. |
| `claude/p0-supabase-shadow-security` | merged | Safe to delete. |
| `claude/p1-acquisition-ledger` | merged | Safe to delete. |
| `claude/p1-inventory-identity-core` | merged | Safe to delete. |
| `codex/fix-high-priority-bugs-from-codex-review` | merged | Safe to delete. |
| `codex/fix-codex-review-issues-in-pull-request-#14` | superseded | Delete (also has an invalid `#` in the name). |
| `codex/fix-high-priority-issues-from-codex-review` | superseded | Delete. |
| `codex/fix-high-priority-bugs-from-codex-review-1g9h0m` | merged into `hxxy32` (PR #18) | Delete after P0-3 forward-port. |
| `codex/implement-cycle-count-functionality` | draft PR #12 | Close PR & delete (cycle counts landed via #15). |
| `codex/redesign-cycle-count-recount-architecture` | open PR #13 | Close PR (superseded by the `-hxxy32` variant) & delete. |
| `reviewer/agent-handoff-foundation` | closed PR #9 (superseded) | Delete. |
| `reviewer/cross-agent-handoff` | closed PR #10 (superseded) | Delete. |
| `reviewer/cross-agent-handoff-main` | open PR #11 | Triage: merge the handoff docs if wanted, else close & delete. |
| `claude/p1-intake-kernel-quick-add-vvyn44` | 8 ahead / 5 behind | **Evaluate**: an earlier cycle-count line largely superseded by the codex work now on `main`. Confirm nothing unique is wanted, then delete. |

**Stale open PRs to triage (4):**
- **#5** `cjhwjb → Beginner` — wrong base (targets the empty branch). Close.
- **#13** superseded by the merged `-hxxy32` variant. Close.
- **#11** cross-agent handoff protocol into `main`. Merge if the docs are wanted, else close.
- **#12** draft cycle-count work stacked on a reviewer branch. Close.

**Branch policy (recommendation).** Adopt a trunk-based model to stop the sprawl and the
deploy drift from recurring:
- `main` is the single trunk **and** the deploy source.
- Feature branches are short-lived and **deleted on merge** (enable GitHub's
  auto-delete-on-merge).
- Protect `main`: required CI checks, no direct pushes.
- Keep a single, documented branch-naming convention and avoid characters like `#` in
  branch names.

### P1 — Client is organized by technical type; the server/DB are organized by domain

The server groups by domain
(`server/src/{acquisition,intake,inventory,provenance,routes}`) and the Supabase migrations
follow the same domains. The client instead splits by *kind*:

- `client/src/lib/` is a ~40-file catch-all mixing API clients (`*Api.ts`), pure domain
  logic (`inventoryIdentity.ts`, `lotOperations.ts`, `acquisitionReview.ts`), React context
  (`workspaceContext.tsx`), hooks (`useDebounce.ts`), config, and generated types
  (`database.types.ts`).
- `client/src/components/` mixes reusable UI primitives (`Modal`, `Drawer`, `Select`,
  `StatTile`, `StatusBadge`, `DataTable`) with feature-specific panels (`InventoryPanels`,
  `CorrectionPanels`, `LotQuantityPanels`).
- `client/src/pages/` is a flat list of ~28 pages with no domain grouping.

**Why it matters:** navigating the client requires knowing a file's *kind*, not its
*feature*, and `lib/` grows without a natural home for new code.

**Recommend (incremental, additive):** move toward feature slices that mirror the server,
e.g. `client/src/features/{inventory,intake,acquisition,cycleCounts,provenance}/` each
owning its own pages/components/lib. As a smaller first step, sub-folder `lib/` into
`api/ domain/ hooks/ context/ types/` and split `components/ui/` (primitives) from
feature panels. Do this **opportunistically, one feature at a time** — not as a big-bang
rewrite — to honor "focused changes over rewrites." *Effort: medium, spread over time;
risk: import churn, mitigated by TypeScript and the existing co-located tests.*

### P1 — Three dependency roots / three lockfiles

`/`, `client/`, and `server/` are independent dependency trees, each with its own
`package.json` and lockfile. `README.md` dedicates a whole section to this, and CI runs
`npm ci` three times and audits three times.

**Recommend (option, not a mandate):** evaluate **npm workspaces** to unify installs behind
a single root lockfile and a single `npm ci`. Trade-offs to weigh honestly: the native
`better-sqlite3` build must keep working, and the per-root audit gate
(`scripts/ci/client-audit-gate.mjs`, which allow-lists exactly one client advisory) must be
preserved. *Effort: medium; risk: medium (CI + audit rewiring).* If the separation is
deliberate, keep it — but then the README section is the right place to say *why*.

### P2 — Docs and governance

- **Loose docs at the `docs/` root** (`architecture.md`, `phase-6a-intake-kernel.md`,
  `supabase-shadow-foundation.md`) sit beside the tidy `ai/ releases/ runbooks/` folders.
  Suggest a `docs/design/` (or `docs/phases/`) home for phase/design docs; keep
  `architecture.md` at the root since it is the referenced entry point.
- **CURRENT_STATE stewardship is enforced only by prose.** `CLAUDE.md` says ChatGPT owns
  `docs/ai/CURRENT_STATE.md` and that Claude must not edit it, but nothing mechanical
  enforces it. Suggest a `CODEOWNERS` entry for that path (and optionally branch protection)
  so the boundary is enforced, not just described.

### P2 — Standard files & minor consistency

- **No `LICENSE`** though `package.json` declares `"ISC"`. Clarify proprietary vs. ISC and
  add the matching file, or set the license to `"UNLICENSED"` to match `"private": true`.
- **No `.editorconfig`.** One file would keep formatting consistent across the three JS
  roots plus the SQL migrations.
- **No issue templates** though a PR template exists (`.github/pull_request_template.md`) —
  optional.
- **`server/src` root modules** (`db.ts`, `ids.ts`, `classify.ts`, `validation.ts`,
  `seed.ts`, `legacyWriteGuard.ts`) sit beside the domain folders; an optional `src/core/`
  (or `src/db/`) grouping would sharpen the domain-vs-plumbing split. Minor.
- **Client page-name overlap** (`Inventory.tsx`, `CurrentInventory.tsx`,
  `InventoryIdentity.tsx`) is easy to confuse; consider disambiguating names as those pages
  move into feature folders. Minor.

---

## Suggested sequence

1. **P0 owner actions first** — flip the default branch to `main`, point Railway at `main`,
   forward-port the stranded PR #18 fix. These are minutes of work and remove real risk.
2. **Prune branches** per the table, after confirming each is reflected in `main`; then turn
   on delete-on-merge and branch protection.
3. **P2 quick wins** — `CODEOWNERS`, `LICENSE`/`.editorconfig`, tidy the loose `docs/` files.
4. **P1 structural work** — client feature-slicing (per feature, over time) and the
   workspaces evaluation, only when they can be done as focused changes with green CI.
