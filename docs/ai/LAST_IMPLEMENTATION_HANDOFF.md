# Last Implementation Handoff

## S1.6.5 — Governed Acquisitions List Reference

`/acquisitions` migrated onto the S1.6 design system as the canonical
governed-list experience. No database change, no server change, no acquisition
semantics changed.

### Lineage and base

- Branch: `claude/s1-6-5-acquisitions-list-reference`.
- Base SHA: `14276f9ec5ed521d8a374ca3ca0445f66e3923fb` — current `main` matched the expected PR #58 merge commit exactly. **No drift.**
- `git merge-base --is-ancestor 701b97a…(S1.6.4 impl head) HEAD` → true.
- **S2.2 did not merge during this work.** `origin/main` was still `14276f9` at push time, so no rebase was required.

### Parallel isolation held

`supabase/**`, `server/**`, `docs/programs/.../08_S2_RECEIVING_AND_COST_BASIS.md`
and `docs/ai/CURRENT_STATE.md` are untouched — `git status` reports zero changes
across all four. No receiving, no cost basis.

### Regression baseline recorded before editing

`Acquisitions.render.test.tsx`: **20 passing**. Client total: **1177**. Both were
captured before any change and treated as a preservation contract.

### Page architecture, before → after

| Before | After |
| --- | --- |
| One 43-line minified-style file | `Acquisitions.tsx` composition + `pages/acquisitions/{listState,listTruth,listPresentation,AcquisitionsFilters}` |
| Bespoke `<table>` + bespoke mobile cards | S1.6.3 `DataTable` + `ResponsiveRecordList` |
| `lines.isError \|\| facets.isError` → one error screen | independent per-dependency TruthState |
| Hand-built unlabelled filter row | labelled `Field` controls + clear affordance |
| Sort readable from URL, no operator control | all six server sort keys as announced column controls |
| Amber `role="note"` coverage block | `CoverageNotice` |

### The URL is the list state

`query`, `classification`, `seller`, `businessVertical`, `method`,
`classificationState`, `exclusionState`, `sort`, `order`, `page` — in the
address bar, nowhere else. No parallel component state. Changing anything but
the page resets to page 1; changing the page preserves everything else; a
workspace switch clears the lot. `listState.ts` owns this as pure functions.

### Fail closed, and the sticky notice

Closed vocabularies are mirrored from `server/src/routes/acquisition.ts`, so the
client cannot offer a filter the server rejects or hide one it supports. An
unsupported value never reaches the transport, is stripped from the URL, and is
reported.

The notice had to be made **sticky**: stripping the parameter is what makes the
"unsupported" set empty again, so a notice derived from it erased itself in the
same tick it appeared. It clears on a workspace switch.

### Method filter — evidence

`server/src/routes/acquisition.ts` validates `req.query.method` against exactly
`rule`, `owner_override`, `seller_specialization`, `explicit_evidence`,
`system_fallback` and answers `invalid_filter` (400) otherwise. The transport
already carried `method`; the facets already counted methods. It had no operator
control. Surfacing it exposes an existing capability and invents no rule.

### Lines and facets are independent

The defect repaired. Previously a failed FACETS request — filter suggestions and
a summary — destroyed a working page of governed lines.

- lines ready + facets failed → rows, exact total and applied filters all survive; a scoped notice explains the facet failure; retry re-issues only facets
- facets failed → no zero facet counts; the applied filter stays selected and truthful
- lines failed → bounded server code shown; the empty presentation never renders
- no workspace → `notConfigured`

### Exact total

Derived separately from the rows, read from the server payload, never from
`rows.length`. Loading shows no count; ready shows the total; a genuine zero
says it is *a confirmed zero from the governed backend*; a failure says no total
has been assumed. Pagination disables Next from that total, so a full final page
does not offer a page that does not exist.

### Presentation

Desktop `DataTable`: classification, date, recorded, seller, product/title,
quantity, vertical, source line identity + order reference, method. All six
server sort keys sortable — `created_at` got its own Recorded column rather than
being URL-only. Nothing else is sortable.

The table hands over at `lg`, not the component default `md`: nine columns on a
tablet in portrait is the sideways-scrolling strip the handoff exists to
prevent. `DataTable` gained an optional `responsiveBreakpoint` — presentation
only, no domain knowledge.

Excluded stays visible, searchable and linkable, marked in words. Unclassified is
a word. Absent values are bounded unknowns.

### Source-qualified addressing

`/acquisitions/:sourceSystemPublicId/:linePublicId`, both `encodeURIComponent`'d,
proved for every link on the page including encoded identifiers. No internal
UUID appears in any link. `state.from` carries the current list URL with its
query string.

### Tests

| File | Before | After |
| --- | --- | --- |
| `Acquisitions.render.test.tsx` | 20 | 20 (all preserved) |
| `Acquisitions.reference.test.tsx` | — | 52 (new) |
| **Client total** | **1177** | **1229** |

Two selectors in the preserved file were updated for the new accessible DOM —
the failure copy, and the empty state that now renders in both the table and the
record list. No business assertion was weakened or deleted.

### Verification — every command run, every exit code checked

| Command | Result |
| --- | --- |
| `npm ci`, `npm ci --prefix client`, `npm ci --prefix server` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build:ci` | exit 0 |
| `npm test` | exit 0 — server 593, client 1229, node guards 23 |
| `node --test scripts/db/guard.test.mjs` | exit 0 — 9 pass |
| `node --test scripts/ci/client-audit-gate.test.mjs` | exit 0 — 14 pass |
| `npm run db:reset` | exit 0 |
| `npm run db:test` | exit 0 — **2468 assertions**, unchanged |
| `git diff --check` | exit 0 |

Migrations **71**, unchanged. DB assertions unchanged — the evidence this branch
touched no database object.

### Remaining risks

- **No real responsive geometry proof.** jsdom applies no CSS, so the table and
  the record list are both in the document at once; nothing here demonstrates
  which one a 768px or 1024px viewport actually shows. The `lg` handoff is proved
  at the class/contract level only. S1.6.7 owns the browser gate.
- **Touch and keyboard interaction on real hardware is unproven**, including the
  sort controls and the filter selects on a tablet.
- **The exact total is briefly `loading` during a page change** rather than
  showing the previous page's total. That is deliberate — a stale total presented
  as current would be the failure this contract exists to prevent — but it means
  the count flickers on paging. If that proves annoying in use, the honest fix is
  an explicit `stale` representation, not `keepPreviousData`.
- A page beyond the last one renders an authoritative-empty table while the
  header still reports the real total. Truthful, but the copy is worth a second
  look once someone hits it in practice.

### Scope confirmation

No database migration. No server route, RPC or SQL change. No pagination, search,
classification or exclusion semantic change. No historical import, no legacy
reconciliation. No Acquisition Detail migration. No Workbench redesign, no new
widget, no LayoutStore change, no dnd-kit work. No Playwright, no axe. No S2.
No edit to `docs/ai/CURRENT_STATE.md` or the S2 receiving document.

### Next checkpoint

**S1.6.6 — Governed Acquisition Detail Reference.**

## S1.6.4 — Workbench Foundation

The customizable Workbench architecture, with the Daily Workbench and the
governed Home region migrated onto it. No database change, no server change, no
S2 semantics.

### Lineage and base

- Branch: `claude/s1-6-4-workbench-foundation`.
- Base SHA: `83a7778b7f1109f2771bf938012de1084b0a47d0` — current `main` matched the expected SHA exactly. **No drift.**
- `git merge-base --is-ancestor 9797995e63a9e16e5da96ed987ee8491bdfc9ff3 HEAD` → true. The S1.6.3 merge and its implementation head `4900e05` are both ancestors.
- Main carries both parallel predecessors: S1.6.3 (PR #57, merge `9797995`) and S2.1 receiving schema (PR #56, merge `83a7778`).

### Parallel isolation held

`supabase/**`, `docs/programs/.../08_S2_RECEIVING_AND_COST_BASIS.md` and
`docs/ai/CURRENT_STATE.md` are untouched — `git status` reports zero changes
across all three. No receiving or cost-basis behaviour was implemented.

### What was built

All under `client/src/workbench/`.

| Module | Owns |
| --- | --- |
| `registry/widgetDefinition.ts` | The typed contract; availability resolution |
| `registry/definitions.ts` | The nine shipped definitions |
| `registry/widgetRegistry.ts` | Lookup and availability filtering |
| `layout/layoutModel.ts` | Instances, defaults, repair, pure mutations |
| `layout/layoutStore.ts` | The port and the key identity |
| `layout/browserLayoutStore.ts` | The only file touching `localStorage` |
| `presentation/grid.ts` | CSS Grid mapping and size spans |
| `presentation/WidgetFrame.tsx` | Families and edit furniture |
| `interaction/WorkbenchInteractionAdapter.tsx` | The only file importing @dnd-kit |
| `data/workbenchFacts.ts` | Per-source TruthState from existing transports |
| `widgets/widgetRenderers.tsx` | Widget bodies |
| `WidgetCatalog.tsx`, `WorkbenchSurface.tsx`, `useWorkbenchLayout.ts`, `useWorkbenchContext.ts` | Surface, catalogue, controller, wiring |

### dnd-kit version and rationale

`@dnd-kit/react@0.5.0` and `@dnd-kit/dom@0.5.0`, both pinned exactly
(`--save-exact`). `0.5.0` is the package's `latest` dist-tag and its newest
**stable** release. The registry also publishes a `0.5.1-beta-*` stream; a
prerelease was not adopted for being newest, because a beta drag library is a
beta reorder for the operator. `@dnd-kit/dom` is declared explicitly rather than
relied on transitively, since the adapter imports `PointerActivationConstraints`
from it. Peer range is `react ^18 || ^19`; the client is on React 19.

### Contracts

**WidgetDefinition** — identity (stable id, definition version, title,
description, domain), availability (lifecycle, required role, named
requirements, surfaces), data contract (source, provenance, coverage, refresh,
**genuine-empty definition**, stale-while-refreshing), presentation contract
(family, supported sizes, default, per-size behaviour, responsive mode),
interaction contract (read-only vs action-capable, destination, local settings,
background refresh), and `allowMultiple` defaulting to false.

**Registry never fetches.** No `load()`, no query, no transport; a test asserts
no definition holds a callable at all.

**Lifecycle.** Only `available` and `experimental` are offerable. `planned` and
`retired` are metadata and are absent from the catalogue — no "coming soon"
card, nothing greyed out. No tier, entitlement, purchase or upsell anywhere.

**Presentation families** — `metric`, `instrument`, `workspace` — are orthogonal
to truth state. A Metric that could not load is still a Metric.

**Semantic sizes** — Compact · Standard · Expanded · Wide · Full. Each
definition declares supported sizes, a default, and what each size *shows*; a
test requires those descriptions to be distinct so a larger size cannot be the
same content stretched wider. An unsupported size is never offered and is
refused by the model.

**Layout instance** — `{definitionId, instanceId, size, settings?}` only.
Settings accept scalars. The adapter serialises field by field, and a test
pollutes a layout with a count, a total and an API response to prove none reach
storage.

**LayoutStore identity** — user × workspace × surface × schema version, all four
in the key. Key prefix `rv.workbench.v1.<user>.<workspace>.<surface>`. Explicit
`anonymous` / `no-workspace` segments rather than omitted ones. The user scope
is the authenticated `userId` from `workspaceContext` — never a display name,
never an email.

**Device-local persistence.** The UI states "Saved on this device only. Your
layout does not follow you to other devices." No database preference table.

**Recovery.** Non-object payload, schema mismatch or foreign surface → reset.
Unknown/retired widget → dropped. Unsupported size → repaired to default.
Duplicate single-instance → first occurrence kept, deterministically. Reused
instance id → regenerated. Every correction is reported to the operator. Corrupt
JSON and throwing storage cost durability only.

**CSS Grid.** 2 columns on phone, 6 at `sm`, 12 from `lg`. One persisted
semantic order; breakpoints change span, never sequence. No `react-grid-layout`,
no free-pixel resize.

**Edit mode.** Normal mode mounts no drag context at all. Edit mode adds handle,
move buttons, size select, remove, catalogue and reset. Drag starts only at the
grip, under a 200 ms/8 px touch delay plus a 6 px distance constraint.

**Keyboard/button reorder** names each widget, disables at boundaries, announces
into a polite live region, and drives the same canonical order as drag — proved
by asserting `applyReorder` equals `reorderInstances`, and that repeated button
moves equal one drag reorder. Independent of the package.

### Widgets shipped

Needs location · Needs photos · Unclassified category · Needs condition details ·
Open corrections · Inventory records · Listing preparation · Open intake
sessions · Quick actions.

Every one reads a fact the application already read. No server query was
invented. Deliberately absent and asserted absent: valuation, pricing, market
value, AI, S2 receiving/cost-basis, orders/returns, and anything over the legacy
SQLite store.

### The truth defect repaired

The old Daily Workbench initialised every count to `0` and loaded them under one
shared `catch`. An unresolved or failed source rendered a confident zero, and
one failure blanked seven working panels. Each source now carries its own
`TruthState`: `loading` renders an em dash, a rejection renders a bounded code,
an unconfigured transport renders `notConfigured`, and a proven zero renders as
a confirmed zero. Sources settle independently — no `Promise.all` over the set.

### Home

The governed awareness region is customizable and reads governed transports
only. The governed operations panels and the legacy spreadsheet-imported section
below it are fixed. The legacy panel is never a widget, never in the catalogue,
has no furniture in edit mode, and cannot enter the governed region.

### Tests

Client **1056 → 1177** (+121). Five new files plus an expanded `Workbench.test.tsx`:

| File | Tests |
| --- | --- |
| `workbench/workbenchSurface.test.tsx` | 38 |
| `workbench/layout/layout.test.ts` | 35 |
| `workbench/registry/registry.test.ts` | 19 |
| `pages/Workbench.test.tsx` (3 → 13) | 13 |
| `workbench/presentation/widgetPresentation.test.tsx` | 11 |
| `pages/Dashboard.workbench.test.tsx` | 8 |

### Verification — every command run, every exit code checked

| Command | Result |
| --- | --- |
| `npm ci`, `npm ci --prefix client`, `npm ci --prefix server` | exit 0 |
| `npm run lint` | exit 0 (7 pre-existing warnings + 4 new fast-refresh advisories, no errors) |
| `npm run typecheck` | exit 0 |
| `npm run build:ci` | exit 0 |
| `npm test` | exit 0 — server 593, client 1177, node guards 23 |
| `node --test scripts/db/guard.test.mjs` | exit 0 — 9 pass |
| `node --test scripts/ci/client-audit-gate.test.mjs` | exit 0 — 14 pass |
| `npm run db:reset` | exit 0 |
| `npm run db:test` | exit 0 — **2468 assertions**, unchanged baseline |
| `git diff --check` | exit 0 |

Migration count **71**, unchanged. The DB baseline is untouched, which is the
evidence that this branch made no database change.

### Remaining risks

- **No real drag/touch proof.** jsdom has no layout and no pointer/touch events.
  What is proved is that a reorder reported by the adapter drives the same order
  the buttons drive. Real gesture proof is S1.6.7.
- **`client/vitest.setup.ts` installs no-op `ResizeObserver`/`IntersectionObserver`
  stubs** because `@dnd-kit/dom` constructs one at module load and jsdom does not
  implement it. They let the module import; they simulate no geometry and prove
  no gesture.
- **Responsive behaviour is class/contract-level**, not measured at a viewport.
- **Touch activation timings (200 ms / 8 px / 6 px) are unverified on hardware.**
  They are a considered default, not a measured one.
- **Device-local persistence only.** A layout does not follow an operator to
  another device, and the UI says so.
- A widget whose requirements stop being satisfied is hidden but retained in the
  layout, so a temporary condition does not silently discard an arrangement.

### Scope confirmation

No database migration. No server change. No receiving or cost-basis
implementation. No S2 business calculation. No Acquisitions or Acquisition
Detail migration. No Playwright, no axe. No `react-grid-layout`, no free-pixel
resize. No marketplace, monetization, shared team layouts, named saved
dashboards, user-authored formulas, widget-level SQL, or AI layout mutation. No
edit to `docs/ai/CURRENT_STATE.md` or to the S2 receiving document.

### Next checkpoint

**S1.6.5 — Governed Acquisitions List Reference.**

## S1.6.3 — Data and Overlay Primitives

The shared UI primitives the remaining S1.6 slices are built from, proved
behaviourally, with one small existing surface migrated as proof. No business
semantics, no server code, no database object, and no route changed.

### Lineage and base

- Branch: `claude/s1-6-3-primitives-gg3s0a`.
- Base SHA: `e843f8d2c3061fa68bb6ac7ffcd7de98dee8fd14` — current `main` matched the expected PR #55 merge commit exactly. **No drift.**
- Branch-name note: the work order named `claude/s1-6-3-data-overlay-primitives`; the session's designated branch is `claude/s1-6-3-primitives-gg3s0a` and that is what was used. Same base, same content.

### What was built

All under `client/src/design-system`. Nothing in that directory imports
Supabase, calls a transport, knows a workspace id, computes a status, or
aggregates money.

| Module | Contract |
| --- | --- |
| `data/DataTable.tsx` | Governed table taking `TruthState<readonly T[]>` |
| `data/ResponsiveRecordList.tsx` | Stacked records for narrow viewports |
| `overlays/useOverlayBehavior.ts` | Shared focus entry/containment/restoration, Escape, dismissal |
| `overlays/Dialog.tsx` | Native `<dialog>` modal |
| `overlays/Drawer.tsx` | Native `<dialog>` edge panel |
| `overlays/MutationConfirmation.tsx` | Governed mutation confirmation composition |
| `controls/ReasonField.tsx` | Accessible mutation-reason field |
| `feedback/TruthStates.tsx` | `LoadingState`, `EmptyState`, `DependencyState`, `PartialState`, `StaleState` |
| `feedback/CoverageNotice.tsx` | Renders a `CoverageGap`; never computes one |
| `feedback/ProvenanceLabel.tsx` | Six authority kinds, meaning carried in words |

Evolved rather than duplicated:

- `foundations/truthState.ts` — constructors now return their own union member
  instead of the whole union, and `isIndeterminate` is a type predicate. Every
  narrowed member is still assignable to `TruthState<T>`, so no existing caller
  is constrained, but a component accepting only the four indeterminate kinds
  can be handed `unavailable(...)` with no cast. Additive; no behaviour change.
- `components/DataTable.tsx` and `components/Drawer.tsx` — rewritten as
  compatibility wrappers delegating to the governed components. Same call
  signatures; six legacy pages (Sales, Inventory, Purchases, CostLinks,
  Listings) carried, not migrated.

The wrapper's honesty is bounded and the code says so: the old
`rows: T[]` + `loading: boolean` shape cannot distinguish a failed query from a
zero, because the failure was flattened to `[]` before it arrived. It maps an
empty array to `empty` — which those pages already displayed — and cannot do
better. A surface needing that distinction calls the governed table directly.

### DataTable truth-state contract

`loading`/`ready`/`empty` render inside the table with headers intact.
`partial`/`stale` render their notice above the rows. The four indeterminate
states render the notice and **no table at all** — a header row above nothing
reads as a table that merely happens to be short.

There is no `rows: T[]` prop, so a failed fetch cannot arrive as `[]`. Sorting,
paging, filtering and searching are callbacks. Sort direction is announced both
as `aria-sort` and inside the control's accessible name. An unknown pagination
total renders as unknown, never as 0.

**Row activation is a real button in the first cell.** A `<tr>` with `onClick`
is unreachable by keyboard; wrapping the row makes every per-row action a button
inside a button. The activation control has its own cell, other actions are
siblings, and the row's pointer handler ignores events from inside interactive
elements — so a row action never also opens the record.

### Overlay accessibility contract

Both overlays are native `<dialog>` elements opened with `showModal()` where the
platform supports it, which supplies top layer, background inertness and
`::backdrop` with no framework added. Where it does not, they render their own
backdrop and keep `aria-modal`. One shared hook owns focus entry, containment,
restoration, Escape and dismissal.

`dismissible={false}` blocks Escape and the backdrop while a mutation is in
flight and leaves the explicit close control live — preventing accidental
dismissal must not become trapping the operator. `closeDisabled` is the separate
opt-in for that.

The S1.6.2 shell drawer is **unchanged**. It has shell behaviour a record panel
does not, and rebuilding it here would trade real risk for a cosmetic saving.

### Mutation-reason pattern

`ReasonField` replaces `window.prompt()`. It validates nothing itself and never
trims or normalises, so the recorded reason and the displayed reason are the
same string. `MutationConfirmation` composes action title, plain-language
consequence, an immutable-facts slot, the reason field, confirm/cancel, pending
and a bounded error, and encodes no acquisition, payment, exclusion, shipment or
inventory rule.

### Proof migration

`client/src/pages/InventoryIdentity.tsx` — read-only, no business risk, not the
S1.6.5 or S1.6.6 reference surface.

Transports, their arguments, the read-only guarantee and every displayed fact
are unchanged, and the rendered test asserts each. What changed:

- the disabled build renders `notConfigured` — the deployment is not set up,
  rather than something having broken;
- a failed lookup renders a bounded `Alert`;
- every diagnostic input has a real accessible label;
- the lot list carries a truth state. **Previously an empty workspace and a
  failed lot read both rendered nothing at all**; they are now distinct;
- one page-level `ProvenanceLabel` marks the surface as imported source
  evidence, matching what `STAGING_NOTICE` has always said, and is deliberately
  not repeated per row.

### Tests

149 rendered tests added across six files, all asserting against the DOM and
accessibility tree. Nothing reads module source.

| File | Tests |
| --- | --- |
| `design-system/data/dataTable.test.tsx` | 39 |
| `design-system/overlays/overlays.test.tsx` | 36 |
| `design-system/feedback/truthPresentation.test.tsx` | 29 |
| `pages/InventoryIdentity.render.test.tsx` | 16 |
| `design-system/data/responsiveRecordList.test.tsx` | 15 |
| `design-system/controls/reasonField.test.tsx` | 14 |

### Verification — every command run, every exit code checked

| Command | Result |
| --- | --- |
| `npm ci`, `npm ci --prefix client`, `npm ci --prefix server` | exit 0 |
| `npm run lint` | exit 0 (7 pre-existing warnings, none new) |
| `npm run typecheck` | exit 0 (server + client) |
| `npm run build:ci` | exit 0 (client + server) |
| `npm test` | exit 0 — server 593, client 1056, node guards 23 |
| `node --test scripts/db/guard.test.mjs` | exit 0 — 9 pass |
| `node --test scripts/ci/client-audit-gate.test.mjs` | exit 0 — 14 pass |
| `npm run db:reset` | exit 0 |
| `npm run db:test` | exit 0 — **2300 assertions**, all files passed |
| `git diff --check` | exit 0 |

DB suites were run sequentially, never concurrently. The local PostgreSQL 16
cluster and `postgresql-16-pgtap` had to be started/installed in this container
first; that is environment setup, not a repository change.

### Remaining risks

- **Real-browser overlay behaviour is unproven.** jsdom implements neither
  `HTMLDialogElement.showModal()` nor the top layer, so the overlay suites
  exercise the FALLBACK path. Top-layer placement, `::backdrop` rendering, and
  platform-supplied background inertness remain unverified until S1.6.7. The
  suite asserts `supportsModalDialog() === false` explicitly, so if jsdom ever
  gains the API the tests report that they are exercising a different path
  rather than silently claiming coverage they never had.
- **Responsive geometry is unproven.** The tests prove the handoff exists and
  carries the right visibility classes, not that a 390px viewport renders as
  intended.
- **Touch-target sizes are asserted as classes, not measured.** `min-h-11` /
  `min-w-11` are present; jsdom performs no layout.
- **The legacy wrapper cannot distinguish a failure from a zero**, by
  construction. Six legacy pages therefore still show a failed query as an
  authoritative empty. That is unchanged from before this slice and is fixed
  per page, when the page is migrated.
- `15_acquisition_digest_parity.sql` intermittent in-suite slowdown noted in
  `CURRENT_STATE.md` did not reproduce in this run.

### Scope confirmation

No database migration. No server change. No route, auth, workspace, acquisition,
payment, shipment, exclusion, inventory or Supabase-function change. No
Acquisitions migration, no Acquisition Detail migration, no Workbench, no
widget registry, no dnd-kit, no Playwright, no axe, no S2 work. No edit to
`docs/ai/CURRENT_STATE.md`.

### Next checkpoint

**S1.6.4 Workbench Foundation** — layout store and CSS Grid mechanics, per the
customization boundary already recorded in
`docs/programs/commercial-core-legacy-retirement/07_S1_6_GOVERNED_UI_FOUNDATION.md`.

## S1.6.2 post-merge repair — Navigation Source-Truth Model

Bounded corrective PR for the already-merged S1.6.2 shell. **Not a CI repair** —
PR #54's exact-head CI was genuinely green. A post-merge acceptance audit found
that S1.6.2 had introduced a false semantic invariant in the navigation model.

### Lineage and base

- Branch: `claude/s1-6-2-navigation-source-truth-repair`.
- Base SHA: `ce3be2e904cfda1c664280f0eba851aeb66485cb` — current `main` matched the expected PR #54 merge commit exactly. **No drift.**
- PR #54 implementation head `6c3a2ac270cc60ebd4091a883a119891b6179882`; exact-head CI run `31218786171`, four jobs green.

### The defect

`NavAuthority = 'governed' | 'legacy' | 'tool'` was documented as "how much a
destination's data can be trusted". But `tool` answers a different question —
where a destination sits in the menu. Conflating a navigational role with a
truth claim produced two false classifications, both verified from
implementation before being corrected:

- **`/checks`** was `authority: 'tool'` and therefore rendered with **no
  marker**. `Checks.tsx` calls `get('/checks')` → `/api/checks` →
  `server/src/routes/checks.ts` → `getDb()` → SQLite. It is legacy-backed and
  non-authoritative.
- **`/`** was `authority: 'governed'`. `Dashboard.tsx` renders
  `WorkspaceSummarySection` (governed operations transport) **and**
  `get('/dashboard')` under its "Legacy spreadsheet-imported inventory" heading.
  No single authority value is true of it.

A test made this durable by requiring every primary destination to be
`authority === 'governed'` — green, and proving something false.

### The replacement

`NavDataComposition = 'governed-only' | 'legacy-only' | 'mixed'`, **derived**
from a per-destination `reads: readonly DataBackend[]` recording which backends
that route surface actually reads.

`mixed` describes a rendered page's composition, **never a third backend**.
There are exactly two and `dataTopology` names them.

Navigation keeps **no authority table of its own**. `backendIsNonAuthoritative`
asks `dataTopology`, so a reclassification there propagates instead of silently
disagreeing. The two models answer different questions and neither proves the
other; that boundary is stated in code and in both documents.

All 21 advertised destinations were classified by inspecting each page's
transports, not by name. Result matched the expected classification exactly.
One additional truth the audit surfaced: Dashboard is `mixed` in governed mode
but `legacy-only` in a legacy-only deployment, where `getProvenanceUiConfig()`
is null and the governed sections never mount.

### Operator-facing marking

| Composition | Marker |
| --- | --- |
| `governed-only` | none |
| `legacy-only` | **Non-authoritative** |
| `mixed` | **Includes legacy data** |

Both markings are words inside the link, so they are part of its accessible
name. A mixed page is never branded wholly non-authoritative — its governed
sections are authoritative — and never invites combining the two totals.
Dashboard's internal "Legacy spreadsheet-imported inventory" heading is
unchanged.

### Tests

Client **873 → 907** (+34), 48 files, all passing. The false invariant was
deleted and replaced with truthful ones covering composition per destination,
the grouping/authority separation, and the rendered markers on both surfaces.

Verified load-bearing: re-running the new suite against the old classification
(`/checks` as a governed tool, `/` as governed) and the old single-marker
renderer fails **7** tests — 3 model, 4 rendered.

### Remaining risks

1. Composition is recorded per destination and verified by inspection; nothing mechanically ties `reads` to a page's imports, so a future page that adds a legacy call would need its entry updated. A lint-style cross-check is possible but was out of scope here.
2. `dataTopology` program debt around acquisition-domain coverage and the legacy purchase-write cutover is untouched, by instruction.
3. Marker copy has not been reviewed by an operator; "Includes legacy data" is concise and truthful but is a first formulation.

### Next checkpoint

**S1.6.3 — Data and Overlay Primitives.** Not started.

---

## S1.6.2 — Governed Application Shell

Second slice of the seven-slice S1.6 program. Separates the application shell
from route and business content, and implements the approved governed shell
architecture. **No business semantics changed, and no route path changed.**

### Lineage and base

- Repository/canonical branch: `harmonicforce/russellvault2`, `main`.
- Branch: `claude/s1-6-2-governed-app-shell`.
- Base SHA: `bbbe60af7ed20642ad480ffed838c297496eb5a7` — current `main` matched the expected PR #53 merge commit exactly. **No drift, no intervening commits.**
- PR #52 S1.6.1 implementation head `d14384393151793af05a9bf5e034332a20f6a84a`, confirmed an ancestor of the base.
- PR #53 truth-correction head `d70e17945cdc2043c4229a8b83cf1019cb594c23`, confirmed an ancestor of the base.
- PR #53 merge commit: `bbbe60af7ed20642ad480ffed838c297496eb5a7`.
- PR #53 exact-head CI run: **31209294902**, all four required jobs green — so this slice starts from a CI-clean base.

### What App.tsx stopped owning

Before: configuration interpretation, a primary navigation array, a legacy
array, a tools array, a legacy-only array, workspace chrome, the first-run
gate, mobile drawer state, the sidebar, and all 28 route declarations — 329
lines.

After: composition only — resolve configuration, choose the storage adapter,
put the routes inside the shell. 52 lines.

### Modules created

| Module | Owns |
| --- | --- |
| `app/navigation/navigationModel.ts` | What is **advertised**. One typed model; both surfaces consume it. |
| `app/navigation/NavigationPanel.tsx` | Destination rendering, grouping, the Tools & legacy disclosure. |
| `app/routing/AppRoutes.tsx` | What is **mounted**. Moved unchanged. |
| `app/routing/FirstRunGate.tsx` | Blocking routed content until setup completes. |
| `app/shell/AppShell.tsx` | Composition and responsive geometry. |
| `app/shell/AppHeader.tsx` | Compact bar and drawer trigger, below `lg`. |
| `app/shell/AppSidebar.tsx` | Persistent rail, `lg`+. |
| `app/shell/NavigationDrawer.tsx` | The shell's accessible drawer. |
| `app/shell/ShellNavigationContent.tsx` | Shared body of sidebar and drawer. |
| `app/shell/WorkspaceArea.tsx` | Workspace, role, identity, switch, sign out. |
| `app/shell/ThemeControl.tsx` | The three-mode radio group. |
| `app/shell/SystemTruthRegion.tsx` | Permanent system-truth placement. |
| `app/shell/BrandMark.tsx` | Restrained shell identity. |
| `app/theme/browserThemeStore.ts` | The browser `ThemeStore` adapter. |
| `app/theme/useThemePreference.ts` | Store ↔ document-root wiring. |

### Navigation model

One typed source of truth. Primary governed domains: **Home** (Dashboard, Daily
Workbench), **Inventory** (Current Inventory, Scan or Find, Intake Sessions,
Locations, Cycle Counts, Corrections, Photo Issues), **Acquire** (Acquisitions,
Add Inventory), **Sell** (Listing Prep). Secondary: **Legacy application** and
**Tools and diagnostics**, collapsed, below a rule, legacy marked
"Non-authoritative" in words.

Intake Sessions appears in Inventory only. No Intelligence group and no
Settings group are rendered — no route belongs in either today. No
parameterised route is advertised. A test cross-checks every advertised
destination against `AppRoutes.tsx`.

**Corrected:** legacy `/inventory` sat inside the primary governed list, above
the governed inventory destinations. It now sits in the legacy group. The route
is unchanged.

### Routes

All **28** route declarations moved verbatim. A mechanical diff of
`path → element` against `origin/main` is **identical**, and
`AppRoutes.test.tsx` pins the exact mounted set, the governed gating of each,
and the acquisition addressing contract including the ordering of the
source-qualified route before the bare-id guard.

No role-based route hiding was introduced; the application applies none.

### Theme persistence

`ThemeControl → useThemePreference → ThemeStore → browser adapter → localStorage`.
No shell component touches storage. Key `rv.theme.v1`, namespaced, versioned,
optionally user-scoped. Only one of three strings is ever written.

**Device-local**, and the UI states it ("Saved on this device only"). Corrupt,
absent, or hostile values resolve to System. The write guard lives in
`useThemePreference` — the single choke point — so a throwing store costs
durability, never the application.

`system` removes `data-theme`; no `matchMedia` listener exists, because CSS
already handles the OS change and a JS snapshot would only be staler.

### Two defects found and fixed

1. **`dark:` never fired for the explicit Dark Vault choice.** Tailwind's stock
   variant keys off `prefers-color-scheme` only, so the 18 pre-existing
   `text-[#8a5a00] dark:text-warning` pairs would have rendered light-theme
   brown on graphite for an operator who chose Dark Vault while their OS was
   light. Fixed with one `@custom-variant dark` mirroring the token blocks'
   selectors — repairs every usage without touching a page file.
2. **A throwing `ThemeStore` escaped as an unhandled exception.** The adapter
   guarded itself but `useThemePreference` did not, and React's event system
   swallowed the throw well enough that a shell-level assertion passed anyway.
   Guarded at the hook.

`SystemStatusBanner`'s hard-coded warning hex was also replaced with the
semantic `warning` token, which now carries the per-theme value itself.

### System Truth Region

Wraps `SystemStatusBanner` rather than reimplementing it; all 20 of its
behavioural tests pass unchanged and no health semantics were added. Rendered
outside the routed subtree, so navigation cannot unmount it and no page or
future layout API can remove it. Ready renders nothing.

Misconfiguration and session failure remain `AuthShell`'s, before the shell
mounts — that boundary is documented, not duplicated.

### Tests

Client **793 → 873** (+80), 48 files, all passing.

- `app/shell/AppShell.test.tsx` — 45 rendered tests: one model two surfaces, governed/tools/legacy separation, legacy-only mode, workspace area, theme control, drawer keyboard and focus behaviour, System Truth Region permanence, shell geometry.
- `app/navigation/navigationModel.test.ts` — advertised-versus-mounted cross-check, domain membership, separation invariants, all three deployment modes.
- `app/routing/AppRoutes.test.tsx` — exact mounted set, governed gating, acquisition addressing.
- `app/theme/browserThemeStore.test.ts` — key shape, round trip, corrupt values, every storage failure mode.
- `App.responsive.test.tsx` / `App.governedNav.test.tsx` — preserved; the single "backdrop and Escape" case was split into three, so backdrop, close button, and Escape are each proven independently.
- `lib/theme.test.ts` — the Dark Vault drift guard's string anchors were made robust; the invariant is unchanged.

### Verification

`npm ci` ×3, `npm run lint` (0 errors), `npm run typecheck`, `npm run build:ci`,
`npm test`, both `node --test` suites, `npm run db:reset`, `npm run db:test`
(2300 assertions), `git diff --check` — all clean.

### Remaining risks

1. **jsdom cannot prove layout.** Breakpoints are asserted as class names. Real geometry, touch-target size, and focus visibility need a browser — S1.6.7.
2. **The drawer moves focus but does not trap it.** Tabbing can leave the open panel. The reusable focus-trapping Dialog/Drawer primitive is S1.6.3's; no trap is claimed here.
3. **`text-[#8a5a00]` literals remain in 5 page/component files.** Now correct in both themes thanks to the variant fix, but still raw values that should migrate to `text-warning` during the page migrations.
4. **Contrast remains reasoned, not machine-verified**, until axe lands in S1.6.7.
5. **Theme is not user-scoped at runtime.** The adapter supports it, but `App.tsx` builds the store before `AuthShell` resolves a session; scoping would couple presentation to auth state for no operator-visible gain today.

### Next checkpoint

**S1.6.3 — Data and Overlay Primitives.** Table, dialog, drawer, popover, and
the remaining feedback surfaces. Not started.

---


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
