# Last Implementation Handoff

## S1.6.1 — Governed UI Foundations

First slice of the seven-slice S1.6 program. Establishes the visual, semantic,
accessibility, truth-state, and component foundation every later S1.6 slice
inherits. No business semantics changed.

### Lineage and base

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `claude/s1-6-1-ui-foundations`.
- Base SHA: `2dd1fce2b6cf20daf027c9ddaed9036bbdaa79a0` — current `main` matched the expected PR #51 merge commit exactly. No drift, no intervening commits.
- PR #51 implementation head `08ebb61db6579d12c139b8b4cf2a2dd3f827a6ad`, confirmed an ancestor of the base.
- PR #51 completed S1.5 with exact-head CI green on all four jobs, so this slice starts from a CI-clean base.

### Dependency decision

**`@fontsource/barlow-condensed@5.3.0`**, added to `client` dependencies and
**pinned exactly** (no caret).

- **Licence:** OFL-1.1, verified from the package's own `LICENSE` (SIL Open Font License 1.1, Copyright 2017 The Barlow Project Authors).
- **Why a package:** no approved Barlow Condensed asset existed in the repository, and the doctrine forbids a Google Fonts or other third-party runtime request. Fontsource ships the OFL font files for local bundling.
- **Scope:** only `500.css`, `600.css`, `700.css` are imported. The 400 weight and every italic are deliberately not pulled in.
- **Verified self-hosted:** the production build emits `barlow-condensed-latin-{500,600,700}-normal-*.woff2/.woff` as local assets, and the built stylesheet contains no `googleapis`/`gstatic` URL. A test asserts the stylesheet requests no third-party font.

No other dependency was added. `@dnd-kit`, Playwright, and axe are **not**
present — they belong to S1.6.4 and S1.6.7.

### The defect that had to be fixed to land the palette

The dark theme's brand accent is a **bright** gold (`#D6AE52`). The application
already used `bg-accent` as a solid fill in 69 places, 61 of them labelled
`text-white`, which was acceptable while the accent was blue. Against bright
gold a white label is roughly **1.9:1** — a contrast regression the palette
change would have shipped silently across the application.

Fixed by introducing a paired **`on-accent`** semantic token — white on the
light theme's dark gold, dark ink on the dark theme's bright gold — and moving
those 61 sites from `text-white` to `text-on-accent`. This is a foreground
correction, not a redesign: no layout, copy, or behaviour changed. A test
asserts the primary Button uses `text-on-accent` and never `text-white`.

### What was built

**Token architecture (`client/src/index.css`)** — three layers: primitives
(`--rv-*`, the only place a hex literal appears), semantic tokens
(`--surface-*`, `--text-*`, `--brand-*`, `--status-*`), Tailwind utilities.
Light Vault Ledger and Dark Vault both fully defined, with status colour on its
own ramps in both and gold never carrying status.

Two tokens are not in the originally approved list, both for stated reasons:
`brand-accent-strong` (light) is derived one step deeper from the approved
light brand accent because the pre-existing `accent-strong` utility needs an
emphatic step; `on-accent` is the contrast fix above.

**Compatibility** — `bg-surface-0/1/2`, `text-ink`, `text-ink-secondary`,
`text-ink-muted`, `border-hairline`, `text-accent`, `text-accent-strong`,
`text-good`, `text-warning`, `text-serious`, `text-critical` all resolve onto
the new semantic tokens. Verified against the built stylesheet: every one is
emitted (`text-serious` only absent because nothing uses it yet). No
repository-wide class-name migration was forced.

**Spacing was deliberately NOT overridden.** Tailwind's default scale already
is the approved 4px rhythm; defining explicit `--spacing-N` keys risked
dropping the fractional steps (`py-0.5`, `py-1.5`) the application uses. The
rhythm is mirrored as `--rv-space-*` for consumers outside Tailwind. Radii,
elevation, and motion tokens are additive and safe.

**Theme contract (`client/src/lib/theme.ts`)** — `system | light | dark`,
presentation only. Explicit choice overrides the OS in both directions;
`system` removes the marker so the stylesheet keeps following the OS rather
than freezing a snapshot. The module defines a `ThemeStore` port and does not
touch web storage — the shell injects the adapter in S1.6.2. A test strips
comments before asserting the module contains no `localStorage` reference, so
the assertion turns on code rather than prose.

**Truth-state contract (`design-system/foundations/truthState.ts`)** — all nine
states, with the central property enforced: `empty` means an authoritative
request proved zero, the indeterminate states carry no `value` field at all,
and a test iterates every exported function against every failure state to
prove none returns a number. `partial` carries coverage and aggregation safety;
`stale` carries last-confirmed time and refresh affordance; `sumSameCurrency`
refuses mixed currencies and returns `null` for nothing-to-total rather than 0.

**Primitives (`client/src/design-system/`)** — `Button`, `IconButton`, `Field`,
`StatusPill`, `Alert`, `RootErrorBoundary`, with the ownership boundary stated
in `index.ts`. `IconButton` requires its accessible name in the type, so
omission is a compile error rather than an audit finding. `Field` wires label,
description, and error without validating. `Button` always carries an explicit
`type`.

**Root error boundary** — wired in `main.tsx` inside the providers and around
`<App/>`. Catches React render faults only; says the fault is in the interface
rather than the records; offers a reload; never renders a stack.

It does **not** claim the records are unchanged. A render boundary cannot infer
the completion state of a previously submitted governed operation: a component
can throw during the rerender or refetch that follows a mutation which already
committed, and that is indistinguishable from a crash on first paint. The
fallback therefore states the uncertainty and sends the operator to reload and
verify the authoritative record before repeating any consequential action.
Corrected on `claude/s1-6-1-render-error-truth-fix`, which replaced the earlier
"nothing has been saved or altered by it" reassurance and the test that
required it.

### Tests

Client **684 → 785** (+101), all passing:

- `design-system/designSystem.test.tsx` — 79 behavioural tests rendering every primitive and inspecting the DOM and accessibility tree. Nothing reads component source.
- `design-system/foundations/truthState.test.ts` — every state constructible, `empty` distinct from every indeterminate state, no failure-to-zero path, aggregation safety, currency refusal.
- `lib/theme.test.ts` — 22 tests covering resolution, application, the storage port, and stylesheet invariants (the two Dark Vault blocks identical, no third-party font, status never gold, paired `on-accent` in both themes).

### Verification

`npm ci` x3, `npm run lint` (0 errors; only pre-existing warnings in untouched
files), `npm run typecheck`, `npm run build:ci`, `npm test`, both `node --test`
suites, `npm run db:reset`, `npm run db:test`, `git diff --check` — all clean.
The database suite is unchanged at **2300 assertions**, confirming no schema or
semantics moved.

### Remaining risks

1. **Two dark-theme declaration blocks are duplicated.** Plain CSS has no mixin, so the Dark Vault values appear twice — once for `prefers-color-scheme`, once for the explicit opt-in. A test asserts they stay byte-identical, but the duplication is real and a build-time preprocessor would remove it.
2. **`brand-accent-strong` (light) is derived, not approved.** It was required by the pre-existing `accent-strong` utility. It should be confirmed or replaced by the owner.
3. **Contrast is reasoned, not machine-verified.** Automated contrast checking arrives with axe in S1.6.7. The `on-accent` fix addresses the one measured regression this palette introduced; the rest of the palette has not been swept.
4. **The primitives are not yet used by any page.** They are exercised by tests only, deliberately: page migration is S1.6.5 and S1.6.6. The first real consumer will surface API gaps.
5. **The `?raw` CSS import does not work under vitest** (CSS modules are stubbed to empty), so the stylesheet assertions read the file with `node:fs` behind a file-local `/// <reference types="node" />`. Widening the browser-targeted project's types was avoided deliberately.

### Scope confirmation

No database migration. No business semantics changed. No shell extraction, no
navigation redesign, no Workbench, no `@dnd-kit`, no Playwright, no axe. No
receiving, receipts, discrepancies, cost basis, historical import, or
marketplace behaviour. No SQLite change, no Railway work, no hosted Supabase
access, no service-role browser code. No S2. `docs/ai/CURRENT_STATE.md` not
edited.

### Next checkpoint

**S1.6.2 — Governed Application Shell.** It owns shell restructuring,
navigation, the theme-control UI, and the storage adapter that plugs into the
`ThemeStore` port defined here.
