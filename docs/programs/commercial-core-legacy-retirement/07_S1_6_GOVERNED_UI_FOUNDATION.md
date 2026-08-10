# S1.6 — Governed UI Foundation and Russell Vault Design System

## Position in the program

S1.6 sits **after S1.5** (governed acquisition-line exclusions) and **before S2**
(receiving, cost, and the commercial core). It changes no business semantics. Its
job is to make the governed surfaces that S1.2–S1.5 built legible, consistent,
accessible, and recognisably Russell Vault, so that S2 is built on a foundation
rather than beside one.

Nothing in S1.6 touches the database, acquisition semantics, exclusion
semantics, receiving, cost basis, historical import, or marketplace behaviour.

## Governing doctrine

> **The operator may customize perspective, but never truth.**

An operator may choose a theme, and later may arrange their own awareness
surfaces. No such choice may change what a number means, whether a total is
safe to compute, who is allowed to see a record, or what the provenance of a
fact is. Presentation is a lens, never an edit.

Three consequences run through every slice:

1. **Colour is never the sole carrier of meaning.** Every status surface also
   states its meaning in words.
2. **Decoration never masks incomplete or failed data.** A surface that could
   not establish the truth says so; it does not render a confident zero.
3. **Brand is structural, not ornamental.** Gold carries hierarchy and
   identity. It never carries status, and it never signals danger.
4. **A surface never asserts more than it can know.** Reassurance is a factual
   claim like any other. A surface that cannot establish what happened says so
   and points at the authoritative record.

### A render boundary cannot infer the outcome of a submitted operation

The architectural rule stands: **render failure is not business-data failure.**
A network error, a governed dependency error, and an authorization error are
the domain component's to report, and the root error boundary must not
reinterpret them.

The stronger rule that follows from consequence 4: **a render boundary cannot
infer the completion state of a previously submitted governed operation.** A
component can throw during the rerender or refetch that *follows* a mutation
which already committed, and from inside the boundary that is
indistinguishable from a crash on first paint.

So the fallback may not say a preceding operation succeeded, may not say it
failed, and may not say nothing was saved or altered. It must:

1. identify itself as an interface/render failure;
2. state that it cannot determine whether a previously submitted action
   completed;
3. direct the operator to reload and verify the authoritative record;
4. warn against blindly repeating a consequential operation because the screen
   crashed.

Behavioural tests render the boundary and assert each forbidden claim is absent
from its actual DOM text, rather than inspecting module source.

## Visual character: the 75/25 Vault Operations Hybrid

Russell Vault should read as **branded operational equipment** — not a generic
admin dashboard, and not a decorative collectibles website.

- **≈75% restrained operational console.** Dense, legible, fast to scan.
  System typography, tabular figures, quiet surfaces, honest states.
- **≈25% unmistakable Russell Vault identity.** Delivered through
  typography, spacing, geometry, hierarchy, gold structural accents,
  restrained vault/plate references, and consistent micro-details.

**Brand is:** typography, spacing, geometry, hierarchy, gold structural
accents, restrained vault references, consistent micro-details.

**Brand is not:** ornate gold borders everywhere, mascot imagery in serious
workflows, status communicated through gold, or decoration masking incomplete
or failed data.

## Token architecture

Three layers, and components only ever reach the third.

```
primitive color        raw palette value, no meaning attached (--rv-*)
      |                the ONLY place a hex literal appears
      v
semantic token         what the colour MEANS in this theme
      |                (--surface-*, --text-*, --brand-*, --status-*)
      v
Tailwind utility       what a component writes
                       (bg-surface-raised, text-ink, border-subtle, ...)
```

A component that needs a colour uses a utility. If no semantic token expresses
what it means, the answer is to **add a semantic token**, never to inline a hex
value.

### Paired themes

| Role | Light Vault Ledger | Dark Vault |
| --- | --- | --- |
| `surface-canvas` | `#F5F2EA` | `#0C0D0D` |
| `surface-base` | `#FBFAF6` | `#141516` |
| `surface-raised` | `#FFFFFF` | `#1B1C1D` |
| `surface-inset` | `#EFE9DD` | `#101112` |
| `text-primary` | `#171511` | `#F5F1E8` |
| `text-secondary` | `#504B42` | `#C8C0B2` |
| `text-muted` | `#746E63` | `#968C7E` |
| `border-subtle` | `#DDD5C6` | `#2E2C29` |
| `border-strong` | `#B7AA94` | `#49443B` |
| `brand-accent` | `#7A5812` | `#D6AE52` |
| `brand-accent-strong` | `#5E430E` (derived) | `#E3BE65` |
| `brand-accent-soft` | `#E8D8AE` | `#342B18` |
| `on-accent` | `#FFFFFF` | `#171511` |
| `focus-ring` | `#7A5812` | `#E3BE65` |

Two tokens are not in the originally approved list and exist for stated
reasons:

- **`brand-accent-strong` (light)** — the approved light palette names no
  strong variant, but the pre-existing `accent-strong` utility needs an
  emphatic step for text on a gold tint. Derived from the approved light brand
  accent: same hue, one step deeper.
- **`on-accent`** — the readable foreground paired with a **solid** brand fill.
  It is required, not stylistic: the dark theme's brand accent is a bright
  gold, and a white label on it is roughly 1.9:1. Light fills dark and takes a
  white label; dark fills bright and takes a dark-ink label.

### Status colour is independent of brand

| Status | Light | Dark |
| --- | --- | --- |
| success | `#1E7A4A` | `#4DC27C` |
| warning | `#8B5500` | `#F0A33A` |
| serious | `#A84722` | `#F08B5F` |
| critical | `#B3261E` | `#E66B63` |
| information | `#2467A8` | `#72A7DB` |

Gold does not mean warning. Destructive behaviour uses critical semantics.
Status colours are not decorative accents, and no status is communicated by
colour alone.

## Typography: two families, two jobs

**Operational** — `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
Body, forms, tables, buttons, money, identifiers, metadata, error
explanations, dense workflows. Tabular numerals for money, counts,
quantities, aligned timestamps, and relevant identifiers.

**Vault display** — Barlow Condensed, weights 500/600/700, self-hosted.
Major branded headings, major section labels, shell identity, selected
uppercase micro-labels, Workbench category labels, auth/onboarding.

Display type is **never** used for tables, form fields, long prose, money, or
errors, and is opt-in through a single utility so it cannot leak.

A third type family is not introduced.

## Truth-state contract

Every governed asynchronous surface must be able to represent:

`loading` · `ready` · `empty` · `partial` · `stale` · `unavailable` ·
`unauthorized` · `notConfigured` · `error`

The load-bearing distinction:

> **`empty` means an authoritative request succeeded and proved there are zero
> results. It is not the same fact as "we could not find out".**

There is deliberately no API anywhere that turns a failed retrieval into a
value of `0`. A dashboard reading "0 excluded lines" because the request failed
is worse than one reading "unavailable", because the operator believes it.

- **`partial`** carries included coverage, missing coverage when known, whether
  the subset is safe to aggregate, and an operator action where one exists.
  Partial data that is silently summed becomes a confident wrong total.
- **`stale`** carries the last successful refresh where known, an operator
  label, and whether a safe refresh is available.
- **Financial truth** stays currency-qualified. Mixed currencies are never
  silently summed, and no presentational component computes authoritative
  money.

## Design-system ownership boundary

`client/src/design-system` owns **presentation, accessible semantics, and the
vocabulary for expressing what is known**. It owns **no business meaning**:

- `Field` wires label, description, and error — it does not validate.
- `Alert` renders a severity — it does not decide one.
- `StatusPill` renders a tone — it does not compute status.
- `truthState` types what a surface knows — it does not fetch.

Anything requiring knowledge of what an acquisition, exclusion, payment, or
shipment *means* belongs in the domain. This boundary is why a design change
can never quietly become a business-rule change.

## Implementation sequence

| Slice | Scope |
| --- | --- |
| **S1.6.1 Foundations** ✅ | Tokens, themes, typography, geometry, motion, truth-state contract, initial house primitives, root render error boundary, this document. |
| **S1.6.2 Shell** ✅ | Governed application shell, navigation, theme control integration, storage adapter for the theme port. |
| **S1.6.3 Data and overlay primitives** ✅ | Table, responsive record list, dialog, drawer, truth-state presentation, coverage, provenance, mutation-reason pattern, and one proof migration. |
| **S1.6.4 Workbench foundation** ✅ | Widget registry, layout store, semantic sizes, CSS Grid, dnd-kit adapter, edit mode, catalog, and the Daily Workbench / Home migration. |
| **S1.6.5 Governed-list reference migration** ✅ | Acquisitions list migrated onto the system as the reference implementation. |
| **S1.6.6 Governed-detail reference migration** | Acquisition detail migrated onto the system. |
| **S1.6.7 Browser quality gate** | Playwright and axe; end-to-end and automated accessibility checks. |

Each slice is one PR. None may be pulled forward.

## The governed application shell (S1.6.2, implemented)

The shell is **fixed governed infrastructure**. It communicates application
identity, the active workspace, navigation, user context, theme preference,
system-level truth, and the boundary of page content. It calculates no business
fact and reads no governed table.

### Route truth versus navigation

`App.tsx` previously owned configuration interpretation, four navigation
arrays, the workspace header, the first-run gate, drawer state, and every route
declaration. Those are now separate concerns:

| Module | Owns |
| --- | --- |
| `app/navigation/navigationModel.ts` | What is **advertised** — one typed model |
| `app/navigation/NavigationPanel.tsx` | How destinations render, on both surfaces |
| `app/routing/AppRoutes.tsx` | What is **mounted** |
| `app/routing/FirstRunGate.tsx` | Blocking routed content until setup completes |
| `app/shell/*` | The chrome: shell, header, sidebar, drawer, workspace, theme, truth region |
| `app/theme/*` | The browser `ThemeStore` adapter and its wiring |

`App.tsx` is now composition only.

Routing and navigation overlap but are not the same set, and the difference is
deliberate. Detail routes (`/inventory/current/:itemId`,
`/acquisitions/:source/:line`) and action routes (`/batch-intake`,
`/inventory/move`) are mounted and reachable but not advertised — they are
entered from a record or a workflow, not from a menu. The reverse is forbidden:
**a destination is advertised only if the route exists today**, and a test
cross-checks every navigation entry against the router itself.

Nothing planned is listed. There is no `/settings` route, so there is no
Settings domain; no valuation, pricing, analytics, or AI route exists, so there
is no Intelligence domain. Theme control lives in the shell's user area rather
than behind a manufactured settings page.

There is no role-based route hiding. The application has no per-role route
visibility today, and inventing it in the shell would enforce authorization the
server does not apply — a lock on the menu, not on the door.

### Primary domains

| Domain | Destinations |
| --- | --- |
| **Home** | Dashboard, Daily Workbench |
| **Inventory** | Current Inventory, Scan or Find, Intake Sessions, Locations, Cycle Counts, Corrections, Photo Issues |
| **Acquire** | Acquisitions, Add Inventory |
| **Sell** | Listing Prep |

Intake Sessions appears in **Inventory only**. Intake touches acquisition and
inventory both, but a destination listed under two domains teaches the operator
that the grouping carries no meaning.

> **Primary navigation is an operational grouping, not a proof of data
> authority.** Membership in a governed domain says a destination is part of
> daily governed workflow. It does not certify that everything the page renders
> comes from the governed backend — Dashboard sits in Home and is mixed-source.
> Source composition is recorded per destination and derived, never inferred
> from the group.

### Source composition, and why it is separate from grouping

Each destination records **which backends its route surface reads**, verified
from the page's own transports. The marker shown to the operator is *derived*
from that, so a badge cannot drift from the fact it describes:

| Composition | Meaning | Marker |
| --- | --- | --- |
| `governed-only` | Every section reads the governed backend | none |
| `legacy-only` | The whole surface is non-authoritative | **Non-authoritative** |
| `mixed` | Governed and legacy sections on one page | **Includes legacy data** |

**`mixed` is a description of a rendered page, not a third backend.** There are
exactly two — `dataTopology` names them — and inventing a third here would
repeat the error `dataAdapter.ts` made in claiming one global backend.

This replaced an earlier `NavAuthority = 'governed' | 'legacy' | 'tool'` field
that conflated two orthogonal questions: what a destination is *for*, and what
it *reads*. `tool` is an answer to the first masquerading as an answer to the
second, and it produced two false classifications:

- **Health Checks** was `tool` and therefore unmarked. `/checks` reads
  `/api/checks`, which is `getDb()` — SQLite. It is a **legacy-backed
  diagnostic and non-authoritative**, and now says so.
- **Dashboard** was `governed`. It renders the governed operations sections
  *and* the legacy `/dashboard` panel it labels "Legacy spreadsheet-imported
  inventory". It is a **mixed-source route with a labelled legacy region**, and
  no single authority value was ever true of it.

A test had made the defect durable by requiring every primary destination to be
`governed` — green, and proving something false. The invariants are now
truthful: no legacy-only destination sits in a governed domain, every legacy-only
destination carries its marker, and Dashboard is mixed.

Dashboard is `mixed` in governed mode but `legacy-only` in a legacy-only
deployment, where `getProvenanceUiConfig()` is null and the governed sections
never mount.

**Boundary with `dataTopology`.** That module owns backend and domain
authority. The navigation model owns what a route surface renders. They answer
different questions and **neither proves the other**. Navigation keeps no
authority table of its own — it asks `dataTopology` whether a backend is
authoritative, so a reclassification there propagates rather than silently
disagreeing.

### Tools and legacy separation

Legacy and diagnostic destinations live in a separate, collapsed disclosure
below a rule — no legacy-only destination sits inside a governed domain.

Grouping and authority are independent, and the Tools group is the proof: it
legitimately holds three governed diagnostics *and* one legacy-backed one.

Legacy `/inventory` previously sat in the primary governed list directly above
the governed inventory destinations, labelled only "Legacy Inventory". It is now
filed under the legacy group. **The route is unchanged**; only its placement and
its marking are corrected.

In a legacy-only deployment there is no separation to draw — the whole
deployment is legacy, the System Truth Region says so permanently, and the
original legacy navigation is preserved unchanged.

### System Truth Region

Shell infrastructure, rendered outside the routed subtree. Navigation cannot
unmount it, no page can suppress it, and no future Workbench or widget API can
remove it: a layout preference may rearrange perspective, never suppress truth.

It **wraps** `SystemStatusBanner` rather than reimplementing it. That component's
precedence logic is pinned by twenty behavioural tests which are themselves a
fix for a real defect — the old banner rendered `null` whenever the health
request failed, going quiet at exactly the moment the legacy database was
unreadable. The region owns placement and permanence; the health verdict is
delegated unchanged. No new health semantics are introduced.

The two highest-ranking conditions are handled **before** the shell mounts, and
that boundary is preserved rather than duplicated:

1. application misconfiguration → `AuthShell` fails closed;
2. authorization/session failure → `AuthShell` renders the auth screen.

Ranks 3–9 belong to the region via the delegated banner: structured legacy-health
failure (critical), unverifiable dependency state (warning), legacy-only mode,
legacy read-only notice, and finally ready. **Ready renders nothing** — "we have
nothing to report" and "we have verified everything is fine" are different
claims, and only the first is true. Partial/stale coverage is not established by
any surface today and is therefore absent rather than faked.

### Responsive shell geometry

| Viewport | Shell |
| --- | --- |
| Phone `<640` | Compact top bar, drawer, single content column |
| Tablet portrait `640–1023` | Compact top bar, drawer, comfortable density |
| Tablet landscape `1024–1279` (`lg`) | Persistent narrow rail, `w-52` |
| Desktop `1280–1535` (`xl`) | Persistent full sidebar, `w-60` |
| Wide `1536+` | Same sidebar; route content owns its own width |

The shell fixes its own geometry only. It imposes **no maximum width on route
content** — how a record uses the space it is given is a page decision, and
S1.6.5/S1.6.6 make it.

### Theme persistence

```
ThemeControl → useThemePreference → ThemeStore → browser adapter → localStorage
```

No shell component touches `localStorage`. The key is namespaced and versioned
(`rv.theme.v1`) and can be scoped per user so a shared device does not leak a
preference between operators. **Nothing business-shaped is stored** — the value
is one of exactly three strings.

The preference is **device-local** and the UI says so ("Saved on this device
only"). It does not travel with the account; cross-device governed preference
persistence would need a server-side model and is deliberately not part of this
slice.

A corrupt, absent, or hostile stored value resolves to System. A storage
exception costs durability, never the application — the guard sits in
`useThemePreference`, the single choke point every store passes through, so the
invariant holds for any adapter rather than depending on each one to be careful.

`system` removes `data-theme` rather than writing a resolved snapshot, which
keeps the stylesheet's `prefers-color-scheme` block live. There is deliberately
**no `matchMedia` listener**: CSS already handles the OS change correctly, and a
JavaScript snapshot would only be staler. The absence is the feature.

S1.6.2 also taught Tailwind's `dark:` variant about the explicit opt-in. The
stock variant keys off `prefers-color-scheme` alone, so it silently did nothing
for an operator who *chose* Dark Vault while their OS was light — the
pre-existing `text-[#8a5a00] dark:text-warning` pairs would have kept a
light-theme brown on a graphite surface. A `@custom-variant dark` mirroring the
token blocks' own selectors repairs every such usage at once.

### Mobile navigation accessibility contract

The shell drawer has an accessibly-named trigger exposing `aria-expanded` and
`aria-haspopup="dialog"`; `role="dialog"` with `aria-modal` and an accessible
name; Escape, an explicit close control, and backdrop dismissal; closing on
navigation so one tap reaches a destination; focus moved in on open and
returned to the trigger on close.

The backdrop is `aria-hidden`. Exposing it as a second control named "Close
navigation" would put two identically-named commands in the accessibility tree
with no way to tell them apart.

Interactions **inside** the drawer — the Tools & legacy disclosure, the
workspace switcher, the theme radios — do not close it. The close handler is on
each destination, never on the container; a handler on the container shuts the
drawer the instant the operator touches anything in it, which is exactly the
regression that made legacy destinations unreachable from a tablet.

**This is the shell's drawer, not a reusable primitive.** Focus is moved in and
restored out; focus is not continuously trapped. The governed reusable
Dialog/Drawer primitives were S1.6.3's, and they now exist with a shared focus
trap — but this drawer is deliberately **not** rebuilt on them. It has shell
behaviour a record panel does not (closing on navigation, staying open for its
own internal controls), and destabilising the shell to share code with an
overlay would trade real risk for a cosmetic saving.

## Data and overlay primitives (S1.6.3, implemented)

S1.6.3 supplies the shared vocabulary the remaining S1.6 slices are built from.
It changes no route, no transport, no server code, no database object, and no
business rule.

### DataTable: the truth-state contract

`design-system/data/DataTable` takes `TruthState<readonly T[]>` rather than a
row array. The distinction the type enforces is the reason it exists:

> **A failed request never renders the same UI as zero results.**

There is no `rows: T[]` prop through which a failed fetch could arrive as `[]`.
The nine kinds lay out as:

| State | Notice above the table | Table rendered |
| --- | --- | --- |
| `loading` | — | headers + loading region |
| `ready` | — | headers + rows |
| `empty` | — | headers + confirmed-zero region |
| `partial` | coverage notice | headers + rows |
| `stale` | stale notice | headers + rows |
| `unavailable` | dependency notice | **no** |
| `unauthorized` | dependency notice | **no** |
| `notConfigured` | dependency notice | **no** |
| `error` | dependency notice | **no** |

The indeterminate states render no table, because a header row above nothing
reads as a table that merely happens to be short.

The component owns presentation only. Sorting, paging, filtering and searching
are callbacks; the domain is the only layer that knows whether an order is
computed in the database or in memory. Sort direction is announced twice —
`aria-sort` on the column, and the direction inside the control's own accessible
name — because the attribute alone is not reliably spoken. An unknown
pagination total renders as unknown, never as 0, and no page count is derived
from it.

**Row activation is a real button in the first cell.** A `<tr>` with `onClick`
is unreachable by keyboard, and wrapping the row in a control puts every per-row
action inside another button: invalid markup, and unreachable. Activation lives
in its own cell, other actions are siblings, and the row's pointer handler
ignores events originating inside any interactive element — so using a row
action never also opens the record.

Optional row selection, a bulk-action region that appears only when something
is selected, caller-supplied filters, a labelled search field, and an optional
responsive handoff complete the contract.

### ResponsiveRecordList

Records stacked for viewports a table cannot honestly serve. The failure it
prevents is structural rather than cosmetic: in a horizontally scrolling table,
the columns pushed off the right-hand edge are systematically the ones carrying
status, provenance, and non-authoritative markers — the critical truth is lost
by layout, not by accident.

The page supplies record key, primary identity, subheading, status tone and
words, provenance kind, primary fields, secondary fields, and actions. The
component supplies layout and accessible semantics, and invents no domain
meaning. Identity, status and provenance render together at the top; nothing
marked critical is placed behind a disclosure.

### Overlay accessibility contract

`Dialog` and `Drawer` are native `<dialog>` elements. Where the platform
supports `showModal()` they use it, which supplies the top layer, background
inertness and `::backdrop` with no UI framework added. Where it does not — jsdom
included — they render their own backdrop and retain `aria-modal`.

Both share one hook for focus entry, focus containment, focus restoration,
Escape, and dismissal. S1.6.2's shell drawer deliberately left the reusable trap
to this slice rather than growing a second overlay system; that drawer is
unchanged here, since destabilising the shell to share code with a record panel
would trade real risk for a cosmetic saving.

`dismissible={false}` blocks Escape and backdrop dismissal while a governed
mutation is in flight, and leaves the explicit close control live. Preventing
accidental dismissal must not become trapping the operator; `closeDisabled` is
the separate, deliberate opt-in for that. Motion is `motion-safe:` only.

### Truth-state presentation

`LoadingState`, `EmptyState`, `DependencyState`, `PartialState`, `StaleState`.
Nine kinds, nine distinct texts, asserted as distinct.

- **`empty`** is the only presentation that says there is nothing, and it states
  that the zero is a confirmed result rather than a failed request.
- **`unavailable`** says nothing is being claimed about how many records exist.
- **`unauthorized`** shows no protected content and reports neither a count nor
  an absence — both are disclosures.
- **`notConfigured`** says nothing has failed, because a configuration gap is
  not a fault and reporting it as one sends the operator hunting for breakage.
- **`error`** carries a bounded code and states that no count has been assumed.
- **`stale`** shows the data with its label and last confirmed time, or "not
  known" — never an invented freshness.

A retry is offered for `unavailable`, `notConfigured` and `error` only.
Repeating an unauthorized request cannot change the answer and only teaches the
operator to hammer a locked door.

### CoverageNotice

Renders a `CoverageGap`; never computes one. It states what is included, what is
missing or that the missing part is not known, and whether the subset may be
totalled — the aggregation warning is unconditional when `safeToAggregate` is
false. Dependency availability and current/historical basis render only when the
caller supplies them; an unknown flag renders nothing rather than a guess.

### ProvenanceLabel

Six kinds — Governed, Legacy (non-authoritative), Imported source evidence,
Marketplace source, Current, Historical — each with distinct words and a fuller
sentence reaching assistive technology. The meaning is in the text; the tone is
a second channel, never the only one.

It exists for the places where authority actually matters. Stamping "Governed"
onto every ordinary row teaches the operator that the word means nothing, and
then the one row that is *not* governed reads exactly like the rest.

### Mutation-reason pattern

`ReasonField` replaces `window.prompt()`, which cannot be labelled, described,
required, validated, disabled, or usefully reached by assistive technology. It
validates nothing itself — whether a reason is required, and how long it must
be, are the workflow's rules — and it never trims or normalises, so the recorded
reason and the displayed reason are the same string.

`MutationConfirmation` composes the four questions every governed mutation asks
in the same order: what am I about to do, what will it do to the records, what
exactly am I acting on, and why. Action title, plain-language consequence, an
immutable/current facts slot, the reason field, confirm, cancel, pending, and a
bounded error. It encodes no acquisition, payment, exclusion, shipment or
inventory rule; every one of those arrives as a prop.

### Compatibility, not migration

`components/DataTable` and `components/Drawer` keep their exact call signatures
and delegate to the governed components, so six legacy pages gain semantic
markup and the overlay contract without being migrated.

The wrapper's honesty is bounded and says so. The old `rows: T[]` plus
`loading: boolean` shape cannot distinguish a failed query from a zero, because
the failure was flattened to `[]` before it reached the component. The wrapper
maps an empty array to `empty` — which is what those pages already displayed —
and cannot do better, since the missing fact never arrived. A surface that needs
the distinction calls the governed table directly and says which it means.

### Proof migration: Inventory Identity Diagnostics

Chosen because it is read-only, carries no business risk, is neither the S1.6.5
nor the S1.6.6 reference surface, and already contained exactly the ad hoc
patterns the primitives replace.

Its transports, their arguments, the read-only guarantee, and every displayed
fact are unchanged. What changed:

- the disabled build renders `notConfigured`, saying the deployment is not set
  up rather than implying something broke;
- a failed lookup renders a bounded `Alert` instead of a hand-rolled div;
- every diagnostic input has a real accessible label;
- the lot list carries a truth state, so an empty workspace and a failed lot
  read are no longer the same blank region — previously both rendered nothing;
- one page-level `ProvenanceLabel` marks the surface as imported source
  evidence, matching what `STAGING_NOTICE` has always said, and is deliberately
  not repeated per row.

### Behavioural proof and its limits

149 rendered tests across six files. Every assertion renders the component and
inspects the resulting DOM and accessibility tree; nothing reads module source.

**What jsdom cannot prove.** It implements neither `HTMLDialogElement.showModal()`
nor the top layer, so the overlay suites exercise the FALLBACK path. Real-browser
geometry, `::backdrop` rendering, and platform-supplied inertness remain
unproven until S1.6.7. The overlay suite asserts `supportsModalDialog() === false`
explicitly, so if jsdom ever gains the API the suite reports that it is
exercising a different path rather than silently claiming coverage it never had.
Responsive behaviour is likewise CSS-driven: the tests prove the handoff exists
and carries the right visibility classes, not that a 390px viewport renders as
intended.

## Workbench customization boundary (S1.6.4, implemented)

Approved architecture, recorded now so later slices inherit it rather than
re-deciding it:

- **Fixed governed workflows.** The workflows themselves are not rearrangeable.
- **Customizable awareness surfaces.** What an operator may arrange is which
  awareness widgets they see and where — never what a workflow does.
- **CSS Grid** for layout.
- **`@dnd-kit/react` behind an internal Russell Vault adapter**, so the
  drag-and-drop dependency never leaks into product code.
- **Semantic widget sizes**, not arbitrary pixel geometry.
- **A `LayoutStore` keyed by user × workspace × surface.**
- **No `react-grid-layout` port.**

The customization boundary follows the doctrine directly: an operator may
arrange perspective. They may not arrange truth, and no layout choice may
change what a widget is permitted to show.

### What S1.6.4 built

**The WidgetDefinition contract.** A definition declares identity (stable id,
definition version, title, description, domain), availability (lifecycle,
required role, named requirements, supported surfaces), a data contract
(governed source, provenance, coverage, refresh policy, **what a genuine zero
means**, whether stale-while-refreshing is allowed), a presentation contract
(family, supported sizes, default size, what each size shows, responsive
behaviour), and an interaction contract (read-only vs action-capable,
destination, local settings, background refresh).

**Registry metadata never touches business data.** There is no `load()`, no
query and no transport on a definition, and a test asserts no definition holds a
callable at all. A definition describes a widget; the domain layer supplies
typed facts to what gets rendered.

**`planned` and `retired` are metadata only.** The active catalogue offers only
`available` and `experimental` definitions whose surface, role and requirements
are all satisfied. There is no "coming soon" card, no placeholder, and nothing
greyed out — an advertisement is indistinguishable from a broken feature. There
is also no tier, entitlement, purchase or upsell: those belong to the rejected
prototype.

**Presentation families are orthogonal to truth state.** `metric` is a bare
figure, `instrument` a bounded operational module, `workspace` a larger tool
surface with stronger separation. A Metric that could not load is still a
Metric — it does not become an "error family". The frame owns visual weight;
the S1.6.3 `TruthState` presentation owns what is claimed, and tests hold the
family constant across loading, empty, unavailable and error.

**Semantic sizes carry information hierarchy.** Compact · Standard · Expanded ·
Wide · Full. Each definition declares which it supports, its default, and what
each one *shows* — and a test requires those descriptions to be distinct, so a
larger size cannot be the same content stretched wider. An unsupported size is
never offered in the size control and is refused by the layout model, so it
cannot be persisted and repaired later.

**The layout instance model holds presentation preference only.** A persisted
instance is `{definitionId, instanceId, size, settings?}` — no counts, no money,
no API responses, no authorization or provenance facts. Settings accept scalars
only, which is the one place a cached response could otherwise survive. The
browser adapter serialises field by field rather than handing the object to
`JSON.stringify`, and a test pollutes a layout with a count, a total and an API
response and proves none of them reach storage.

**`allowMultiple` defaults to false.** A second instance requires an explicit
`allowMultiple: true` plus a stated `allowMultipleReason`; the catalogue
disables Add rather than silently ignoring it. Every widget shipped in this
slice is single-instance.

**LayoutStore identity is user × workspace × surface × schema version.** All
four are in the key, so two operators sharing a tablet do not inherit each
other's arrangement, two workspaces stay separate, and Home and Daily Workbench
are separate surfaces rather than one blob. An unresolved user or workspace gets
an explicit `anonymous` / `no-workspace` segment rather than an omitted one,
because omitting a segment merges two identities onto one key. The user scope is
the authenticated user id already carried by `workspaceContext` — never a
display name, never an email.

**Device-local interim persistence, and the UI says so.** The browser adapter is
the only file in the Workbench that knows `localStorage` exists, and edit mode
states "Saved on this device only. Your layout does not follow you to other
devices." No claim of cross-device sync is made anywhere; governed cross-device
preference persistence needs a server-side model and is deliberately not part of
this slice. No database preference table was created.

**Recovery is repair-where-possible, reset-where-not.** A non-object payload,
a schema-version mismatch or a foreign surface resets to defaults. Within a
valid layout: an unknown or retired widget id is dropped, an unsupported size is
repaired to the widget's default, duplicate single-instance entries keep the
**first** occurrence deterministically, and a reused instance id is regenerated.
Every correction is reported to the operator, so "nothing was wrong" and "we
quietly discarded your layout" are distinguishable. Corrupt JSON, a throwing
`getItem` and a throwing `setItem` all cost durability and nothing else.

**CSS Grid, one order, many geometries.**

| Viewport | Logical columns |
| --- | --- |
| Phone `<640` | 2 — ordered, effectively full-width stack |
| Tablet portrait `sm` | 6 |
| Tablet landscape `lg` | 12 |
| Desktop `xl` | 12 |
| Wide `2xl` | 12, wider gutters |

Exactly ONE semantic order is persisted. Narrower screens change how much
horizontal space a size buys; they never change which widget comes first, and
there is no second per-breakpoint arrangement to drift out of step with the
first. Every size spans full width on a phone — a "compact" widget in half a
390px screen is unreadable, not compact.

**One dnd-kit containment boundary.** `@dnd-kit/react@0.5.0` and
`@dnd-kit/dom@0.5.0`, both pinned exactly. `0.5.0` is the package's `latest`
dist-tag and its newest **stable** release; the registry also publishes a stream
of `0.5.1-beta-*` builds, and a prerelease is not adopted for being newest
because a beta drag library is a beta reorder for the operator.
`workbench/interaction/WorkbenchInteractionAdapter.tsx` is the only file in the
application that imports either package. Widgets, pages and definitions speak
`items` and `onReorder(from, to)`; the adapter translates. `react-grid-layout`
was not ported.

**Normal mode versus edit mode.** In normal mode there is no drag handle, no
size control, no remove control, and no drag context mounted at all — nothing is
listening, so scrolling a queue on a tablet cannot reorder anything. Edit mode
is entered through Customize and left through Done, and only then does the
furniture appear. Drag begins only from the visible grip; the grip is
`aria-hidden` because the accessible path is the buttons. Touch activation uses
a 200 ms delay with an 8 px tolerance plus a 6 px distance constraint, so a
finger landing on the handle to scroll does not start a drag.

**Keyboard/button reorder is first class, not a fallback.** Every movable widget
carries Move earlier / Move later buttons whose accessible names identify the
widget. They drive the same canonical order the drag path drives — a test proves
`applyReorder` and the layout model's `reorderInstances` compute identical
results, and another proves repeated button moves equal one drag reorder.
Boundaries disable, and every movement is announced in a polite live region.
"dnd-kit has keyboard sensors" was not accepted as proof; the button path is
independent of the package and would survive its removal.

**The Widget Catalog** uses the S1.6.3 `Dialog`: modal semantics, search across
title and description, domain filtering, add/remove, in-layout state visible,
supported-size summary, and several operations without closing. Its footer
control is "Close catalog", not "Done", because the surface behind it has its
own Done that leaves edit mode.

### Daily Workbench migration, and the truth defect it repaired

The page kept every business source and lost its layout. `workQueueCounts`,
`workQueue`, `operationsQueueCounts`, `operationsQueueRows`,
`openCorrectionCount`, the listing-prep summary and the intake session list are
the same calls with the same arguments against the same transports.

What changed is the truth model. The old page initialised every count to `0`
and loaded them together under one shared `catch`, so between mount and response
— and after any failure — it displayed a confident zero for facts it had not
established, and one failing query blanked seven working ones.

Each source now carries its own `TruthState`:

- nothing starts at zero; everything starts at `loading`, rendered as an em dash
  and an explicit "reading" state, never as `0`;
- a rejection becomes `error` with a bounded code, never `0`;
- an unconfigured transport becomes `notConfigured`, never `0`;
- a proven zero becomes `empty`, which states that it is a confirmed result;
- sources settle independently, so corrections and listing prep can both fail
  while the inventory queues keep showing their real numbers.

There is deliberately no `Promise.all` over the whole set: a single rejection
there rejects the batch, which is exactly how the old page lost seven panels to
one failure.

### Home stays mixed source

The governed awareness region on Home uses the Workbench architecture and reads
governed transports only. Everything below it is fixed: the governed operations
panels, and then the legacy spreadsheet-imported section.

The legacy panel is **never a widget**. It is not in the catalogue, it has no
drag handle, no move controls and no remove control even in edit mode, and it
cannot be rearranged into the governed region — letting an operator drop
non-authoritative SQLite figures into the same arrangement as governed ones
would teach exactly the equivalence this programme exists to break. Home's
layout is stored under the `home` surface, separate from Daily Workbench's.

### Widgets shipped, and widgets deliberately absent

Nine definitions, every one over a fact the application already read before this
slice: Needs location, Needs photos, Unclassified category, Needs condition
details, Open corrections, Inventory records, Listing preparation, Open intake
sessions, Quick actions. No server query was invented to manufacture a widget.

Absent on purpose, and asserted absent by test: valuation, pricing and market
value (no governed source exists, and a number nobody can defend is worse than a
missing panel); AI or recommendation widgets; S2 receiving, landed-cost and
cost-basis widgets (S2.1 shipped schema, not an owner-facing read model);
orders, returns and fulfilment; and any widget over the legacy store.

### What the tests cannot prove

jsdom performs no layout and produces no real pointer or touch events. No
assertion in this slice demonstrates that a drag gesture works; what is proved
is that a reorder REPORTED by the adapter drives the same canonical order the
buttons drive. `@dnd-kit/dom` constructs a `ResizeObserver` at module load,
which jsdom does not implement, so `client/vitest.setup.ts` installs no-op
observer stubs purely so the module can be imported — they simulate no geometry
and prove no gesture. Responsive behaviour is proved at the class/contract
level, not at a measured viewport. Real pointer, touch and geometry proof
remains S1.6.7's browser quality gate.

## The governed list reference (S1.6.5, implemented)

`/acquisitions` is the canonical governed-list experience. Later governed list
surfaces copy this page. It changed **no** acquisition semantics, no server
route, no RPC and no SQL — the same transport is called with the same closed
vocabularies, the same 50-row page size and the same search predicate.

### The URL is the list state

`query`, `classification`, `seller`, `businessVertical`, `method`,
`classificationState`, `exclusionState`, `sort`, `order` and `page` live in the
address bar and nowhere else. There is no parallel component state holding any
of them, so back, forward, reload and a pasted link all recover exactly the list
the operator was looking at.

Changing anything except the page resets to page 1 — page 4 of the previous
filter is not page 4 of this one, and an operator who lands on an empty page 4
reads it as "there are none". Changing only the page preserves everything else.
A workspace switch clears the whole list state rather than applying workspace
A's filters to workspace B's records.

`pages/acquisitions/listState.ts` owns this as pure functions: parse, validate,
rewrite. It does not fetch and it does not render.

### Fail closed, and say so

Every closed vocabulary is mirrored from `server/src/routes/acquisition.ts`, so
the client cannot offer a filter the server rejects or hide one it supports. An
unsupported value never reaches the transport, is stripped from the URL, and is
reported.

The notice is deliberately **sticky**. Stripping the parameter is what makes the
"unsupported" set empty again, so a notice derived from it would erase itself in
the same tick it appeared and the operator would never learn their filter was
dropped. It clears on a workspace switch, the one moment the whole list state is
rebuilt.

### The classification-method filter is a surfaced capability, not a new rule

`method` was already carried by the transport, already validated by the route
against exactly `rule`, `owner_override`, `seller_specialization`,
`explicit_evidence`, `system_fallback` (anything else answers `invalid_filter`,
400), and already counted by the facets. It had no operator control. It has one
now. No backend filter semantics were created.

### Lines and facets are independent dependencies

This is the defect the migration repaired. The previous page evaluated
`lines.isError || facets.isError` and rendered one "Acquisition data could not
be loaded" screen — so a failed FACETS request, which supplies only filter
suggestions and a classification summary, destroyed a perfectly good page of
governed acquisition lines.

Now each dependency is derived independently in `listTruth.ts`:

| Condition | Result |
| --- | --- |
| lines loading | no count, no rows, no zero |
| lines ready, facets failed | **rows and exact total survive**; a scoped notice explains the facet failure |
| lines failed | bounded server code shown; the empty presentation is never rendered |
| facets failed | no zero facet counts; the applied filter stays selected and truthful |
| no workspace | `notConfigured` — nothing has been asked yet |

A facet failure costs the operator their suggestions and their summary. It does
not cost them the list, the exact total, or the truthfulness of the filter they
already have applied — the select keeps its current value even when the
suggestion list could not be read, because a select that dropped its own value
would display "All sellers" while the URL still filtered by one.

Retrying the summary re-issues only the facets query; the lines query is not
re-run and no filter, search term or page is cleared.

### The exact total is the server's

Derived separately from the rows, because the header must be able to say "137
filtered lines" while this page happens to be short. It is never computed from
`rows.length`, which pagination makes false. Four distinct answers for four
distinct facts: loading shows no count at all, ready shows the server total, a
genuine zero says it is *a confirmed zero from the governed backend*, and a
failure says the count is unavailable and no total has been assumed.

Pagination uses that exact total. Next is disabled only when the total proves
there is no next page — deriving it from `rows.length` would offer a page that
does not exist whenever the last page happens to be full.

### Coverage

`CoverageNotice` renders the contract the transport reports
(`governed_native_committed`, `historicalLegacyImported: false`) as: committed
governed-native lines are included, historical legacy Whatnot purchases are
missing, and — unconditionally, because the subset is unsafe to aggregate — *do
not total these figures*. Governed and legacy counts describe different
populations; added together they produce a total that is true of neither.

### Presentation

The desktop `DataTable` carries classification, eligibility, date, recorded
date, seller, product/title, quantity, vertical, source line identity, source
order reference and classification method. All six server sort keys are
exposed as sortable columns — including `created_at`, which got its own
"Recorded" column rather than being reachable only by hand-editing the URL.
Nothing else is sortable, because a control that cannot map onto a server key
would either do nothing or re-sort locally and disagree with the ordering the
next page was computed against.

Below `lg` the table hands over to `ResponsiveRecordList`. The breakpoint is
`lg`, not the component default of `md`: nine columns on a tablet held in
portrait is a horizontally scrolling strip, which is exactly what the responsive
handoff exists to prevent. `DataTable` gained an optional
`responsiveBreakpoint` for this — presentation only, and it teaches the
component nothing about acquisitions.

Every record keeps classification, eligibility, quantity, seller, date, vertical
and the source-qualified identity as primary facts; only the order reference and
the method are secondary, and neither is hidden.

**Excluded is a decision, not a deletion.** An excluded line stays visible,
searchable and linkable, and is marked with the word "Excluded" — never colour
alone. "Unclassified" is likewise a word, and absent values render as bounded
unknowns ("Unknown seller", "No source order") because a blank cell cannot be
told apart from a rendering gap.

### Source-qualified addressing

Every list-to-detail link is `/acquisitions/:sourceSystemPublicId/:linePublicId`
with both values encoded. An acquisition line public id is unique only *within*
its source system, so a single-segment path addresses the wrong record the
moment a second source exists. No internal UUID appears in any link. Each link
carries the current list URL — query string included — as `state.from`, so
Acquisition Detail returns to the exact filtered, searched, sorted page.

### The design system learned nothing about acquisitions

`pages/acquisitions/listPresentation.tsx` is the domain adapter. Field values,
labels, classification and exclusion presentation, the detail URL and the filter
values are all decided there and handed over as typed facts. `DataTable` and
`ResponsiveRecordList` remain domain-agnostic.

### Tests

Client 1177 → 1229. The 20 S1.5 assertions in
`Acquisitions.render.test.tsx` are all preserved — two selectors were updated
for the new accessible DOM (the failure copy, and the empty state that now
renders in both the table and the record list), and no business assertion was
weakened or deleted. `Acquisitions.reference.test.tsx` adds 52 covering the
reference patterns above.

What jsdom cannot prove remains unproven: it applies no CSS, so the table and
the record list are both in the document at once and no test demonstrates which
one a real viewport shows. Real responsive geometry is S1.6.7's browser gate.

## The governed detail reference (S1.6.6, implemented)

Acquisition Detail is the canonical governed-detail and governed-mutation
surface. Every later consequential workflow — receiving, cost basis, disposal —
is expected to look and behave like this page.

The page already carried substantial, hard-won business behaviour, and none of
it was rewritten. Every governed lifecycle, role boundary, idempotency rule,
source-qualified address and financial rule survives byte-for-byte. What changed
is the presentation, the information architecture, the accessibility, and one
sentence that was actively false.

### Acquisition Detail is a FIXED transactional surface

There is no Customize control, no widget, no drag handle, no LayoutStore and no
Workbench embedding on this page, and none should be added. The rule is:

> An operator may customise their PERSPECTIVE. They may never customise the
> structure of a consequential transaction.

The Workbench (S1.6.4) exists for perspective. A payment form an operator could
move, resize, or accidentally remove is a payment form whose absence looks
exactly like a payment that was never owed.

### Independent read truth

The detail request is translated into the S1.6 truth vocabulary in
`pages/acquisition-detail/detailTruth.ts`, and the states are genuinely
distinct because the operator's next action is genuinely different:

| Server answer | Truth state | What it means |
| --- | --- | --- |
| record | `ready` | authoritative |
| 404 | `empty` | the backend looked, and there is no such line |
| 401 / `signed_out` | `unauthorized` | the session ended |
| 403 / `unauthorized_workspace` | `unauthorized` | not permitted to read it |
| `*_contract_missing` | `notConfigured` | the deployment lacks the read contract |
| 5xx | `unavailable` | the dependency did not answer |
| other bounded code | `error` | a named refusal |
| failed **re-read** of a held record | `stale` | the record stays, and says it may not be current |

A 404 is `empty` rather than a failure because it is an authoritative answer,
and it renders "This is a confirmed result, not a failed request." The
`unauthorized` presentation offers no retry and discloses nothing about whether
the record exists — "there is none" and "there is one you may not see" are both
disclosures.

`stale` is the state the recovery flow depends on. A failed re-read of a record
already on screen must not blank the page: an operator resolving an unconfirmed
payment needs the evidence *and* the recovery controls in front of them.

### Coverage and provenance

The transport states `coverage: 'governed_native_committed'` and
`historicalLegacyImported: false` on every response, so coverage is a property
of the deployment and is declared once as a constant. `safeToAggregate` is
false: governed and legacy figures must never be added together.

`ProvenanceLabel` appears exactly once on the page, on source evidence. Stamping
"Governed" on every row teaches the operator that the word means nothing, and
then the one row that is not governed reads the same as the rest.

Source evidence keeps two deliberately different identity types visually
distinct. `sourceRecordRowKey` is a **raw source row key**, not an RV governed
identity, and is labelled as such; `sourceImportJobPublicId` is the *source*
import job's public id. Neither is linked, because the application cannot
navigate to source evidence and a link that goes nowhere is a worse answer than
plain text.

### Placement integrity

`placement.integrityState` is not one more metadata row. When it is
`missing_active_placement` the page raises an explicit integrity alert, invents
no lot, offers no repair action that does not exist, and states that downstream
readiness must not be assumed.

### Money

Money stays currency-qualified integer minor units at the domain boundary and is
converted to decimal only for display, never back into a payload. Three rules
are enforced by the panel rather than by discipline:

- mixed currencies produce **no** combined total — there is no exchange rate
  here, and inventing one would fabricate a financial fact;
- a difference is rendered only when both sides share a currency;
- an absent total reads "No active recorded total", never `0`. An authoritative
  zero count still renders as `0`, because that one *is* a fact.

Money and counts use tabular numerals so a column aligns on the decimal point.

### Delivered is not received

`delivered` is a carrier-reported arrival at an explicitly recorded time. It is
not a claim that anything was opened, counted, matched against the order, or
taken into governed inventory. The sentence saying so is visible on the panel,
not hidden in a tooltip, and no receiving control appears because a shipment
says delivered. S2 receiving is a separate domain.

The transition graph is the **server's**: only `allowedNextTransitions` is
offered, and nothing client-side reconstructs which status may follow which.

### The unresolved governed operation contract

Payments, reversals, shipment creation, shipment transitions, exclusions and
restorations each carry an idempotency key minted **where the operator confirms
the semantic operation** — never in transport, never inside a retry, never on a
rerender. Exactly one such operation may be unresolved at a time, because two
unresolved keys mean two unknown outcomes and no way to tell which the server
took.

A retry resends the retained operation object itself, so the workspace, target,
source qualification, payload and key are byte-for-byte the originals.

A stale transition is the one exception and is never retained: its expected
status is already known to be wrong, so replaying it under the same key is
meaningless. The detail is re-read and a fresh confirmation mints a new key.

### The corrected unknown-outcome semantics

This is the truth defect S1.6.6 repaired. The page previously offered "Discard
retry" and told the operator:

> "Unconfirmed request discarded. Nothing was sent."

That was false. A request whose response never arrived may have reached the
governed backend, committed, and lost only its reply. An owner who believes
nothing was sent records the payment again — under a *new* idempotency key the
server has no reason to collapse — and the vault ends up with two payments for
one purchase.

The action is now about the **retained retry**, not about the request. An
operator can stop retrying; they cannot un-send. "Stop retrying and verify":

1. keeps the unconfirmed-outcome warning;
2. states that stopping does not establish whether the earlier request
   completed;
3. re-reads the authoritative record **before** anything is unlocked;
4. on a successful re-read, clears the retained retry and tells the operator to
   inspect the current record before submitting a replacement;
5. on a **failed** re-read, keeps the lock, keeps the retained retry, and says
   the current state could not be verified.

Step 5 is the one that matters most: unlocking consequential work while both the
earlier outcome *and* the current state are unknown is precisely how the
duplicate gets written.

The notice never renders the idempotency key. It is machinery, not evidence.

### Mutation feedback

One global "Saved." became bounded per-operation feedback naming the record that
changed. If the mutation response succeeded but the authoritative re-read did
not, the page says so explicitly rather than presenting an unverified record as
a refreshed one. No optimistic payment or shipment row is ever inserted; success
is authoritative only after the refetch.

### Component structure

`AcquisitionDetail.tsx` composes. The domain lives in
`pages/acquisition-detail/`:

| Module | Owns |
| --- | --- |
| `detailTruth.ts` | truth derivation and the coverage constant |
| `operationModel.ts` | the unresolved-operation coordinator and its copy |
| `detailPresentation.tsx` | money, instants, identities, panels, fact grids, history |
| `OperationRecovery.tsx` | the unresolved-operation notice |
| `AcquisitionOverview.tsx` | identity, order facts, placement integrity |
| `ClassificationPanel.tsx` | classification, classifier, owner override |
| `EligibilityPanel.tsx` | exclusion and restoration |
| `PaymentsPanel.tsx` | payment summary, payments, recording, reversal |
| `ShipmentsPanel.tsx` | shipments, creation, transitions |
| `SourceEvidencePanel.tsx` | source evidence and its provenance |

Transport and governed semantics stay centralised; no business rule has a second
copy.

### Mutation reason pattern

Every governed reason is collected in a real labelled `ReasonField` — the owner
classification override, the eligibility decision, the payment reversal and the
lost/cancelled transition. There is no `window.prompt()` anywhere on the page.
Consequential decisions use `MutationConfirmation`, which states what is about
to happen, what it does to the records, exactly which record, whether it is
reversible, and why.

Classification is deliberately **not** under the coordinator lock: it carries no
idempotency key, so it has no unconfirmed-outcome hazard and stays usable while
a payment is unresolved.

### Role matrix, unchanged

| | viewer | operator | owner |
| --- | --- | --- | --- |
| read the governed detail | yes | yes | yes |
| run the governed classifier | no | yes | yes |
| record a payment | no | yes | yes |
| create a shipment | no | yes | yes |
| transition a shipment | no | yes | yes |
| owner classification override | no | no | yes |
| reverse a payment | no | no | yes |
| exclude / restore | no | no | yes |

No authority was added or removed.

### Responsive architecture

Panels stack on a phone and share width from `sm`, with classification and
eligibility pairing from `lg`. Public ids and tracking numbers wrap rather than
push a panel sideways, money never clips, transactional forms go full width on
narrow screens, actions keep a comfortable touch target, and no history or
provenance is hidden at any width — governed history is the evidence that a
decision was made by someone for a reason.

### Tests

Client 1229 → 1324. All 81 assertions in `AcquisitionDetail.render.test.tsx`
are preserved; selectors moved to the new accessible structure and no business
assertion was weakened or deleted. **One assertion was deliberately inverted**:
the test that demanded "Nothing was sent" now forbids it.

`AcquisitionDetail.reference.test.tsx` adds 95. The eight tests in its
"false discard guarantee" block are load-bearing and were confirmed to fail
against the pre-S1.6.6 implementation, which renders "Unconfirmed request
discarded. Nothing was sent."

What jsdom cannot prove remains unproven: it applies no CSS, so the responsive
tests assert class-level architecture and the presence of evidence, never real
geometry. Real responsive and accessibility proof is S1.6.7's browser gate.

## Browser quality gate (S1.6.7, implemented — S1.6 complete)

S1.6.1 through S1.6.6 each deferred real-browser proof, and each said so in
writing. jsdom applies no CSS, performs no layout, implements no top layer, has
no `showModal()`, evaluates no media query and has no tab order. Everything
those slices could not prove is proved here, or is not proved at all.

### Versions, and why

| Package | Version | Why |
| --- | --- | --- |
| `@playwright/test` | **1.56.1** (exact) | latest patch of the stable line whose Chromium build (r1194) is executable in the development sandbox |
| `@axe-core/playwright` | **4.12.1** (exact) | current `latest`; not beta/rc/next |
| `axe-core` | **4.12.1** (exact) | inside the integration's own `~4.12.1` range |
| `playwright-core` | **1.56.1** (npm `overrides`) | the axe integration declares `playwright-core >= 1.0.0`, which hoists a second copy beside the runner — two `Page` types and two browser registries |

**Deviation, stated plainly.** The latest stable Playwright is 1.62.1. It
requires Chromium r1234, and this sandbox's egress policy blocks Playwright's
CDN, so 1.62.1 cannot launch a browser here at all. Pinning 1.56.1 — whose
r1194 build is pre-installed — is what makes it possible to write, run and
validate the suite rather than commit an unexecuted gate. Upgrading is a
mechanical bump plus a baseline refresh once the CDN is reachable.

### The harness runs the real application

The gate serves the REAL production bundle: the same `vite build`, the same
`main.tsx`, `AuthShell`, `AppShell`, routes, pages and design system. There is
no browser-test mode, no compile-time branch, no alternate entry point and no
cloned "test version" of any page. Only the four governed environment variables
differ, and they point the app at a Supabase origin that does not exist.

Determinism comes from two places, both OUTSIDE the application:

1. `addInitScript` seeds the browser's own `localStorage` with the session and
   theme a returning operator's browser would already hold;
2. `page.route` answers the network at the browser boundary.

**Production authentication is not weakened.** `AuthShell` resolves its own
configuration, constructs a real `@supabase/supabase-js` client and asks it for
a session exactly as in production. A production browser has neither the storage
seed nor the interception, so it resolves `signed-out` and renders the sign-in
form — which is what the harness saw before its route ordering was fixed. No
application code has a test branch this harness can reach.

Anything the harness does not explicitly answer is **aborted**, so a fixture gap
fails loudly instead of reaching a real host.

### Reference matrix

Chromium exercises all five approved viewports — 390x844, 834x1194, 1194x834,
1440x900, 1728x1117 — declared in the repository rather than taken from
Playwright's device presets, which change between releases for reasons that are
not product changes.

WebKit smokes the two iPad geometries. **WebKit is a Safari-engine
approximation, not an iPad**: no touch hardware, no Safari UI, no iPadOS, no
momentum scrolling. It catches the class of defect only Safari's layout, focus
and `<dialog>` implementation produce. It is not evidence about physical
hardware, and a missing WebKit build fails the suite rather than skipping it.

### What the gate measures

- **Overflow** — `documentElement.scrollWidth` vs `clientWidth` on every
  canonical surface at every Chromium viewport, not a search for
  `overflow-x-hidden`, which hides the symptom.
- **Touch targets** — real `getBoundingClientRect()` measurements, scoped to
  controls an operator drives by thumb at the widths where they do.
- **Themes** — explicit Light and Dark each override the OS preference; System
  stamps no `data-theme` and follows a LIVE `prefers-color-scheme` change.
- **Top layer and focus** — real `<dialog>` + `showModal()`, background
  inertness by hit test, Tab and Shift+Tab containment, focus restoration.
- **Keyboard** — a pointer-free journey across shell, Workbench, catalog,
  Acquisitions and Detail, with a visible focus treatment checked at each stop.
- **axe** — zero serious and zero critical violations across six surface states
  in both themes at a narrow and a wide viewport. There is **no `disableRules`
  list**.
- **Visual** — 40 committed baselines (4 surfaces x 2 themes x 5 viewports).
  Viewport captures, not `fullPage`: the shell is a fixed-height frame whose
  content scrolls inside it, and stitching a full-page capture of a
  non-scrolling document bakes duplicated bands into the baseline. Tolerance is
  `threshold: 0.2`, `maxDiffPixelRatio: 0.01` — enough for antialiasing, far
  less than any real layout regression.

### Defects the browser found, and the repairs

Eight, all invisible to jsdom and all repaired client-side with a failing
browser reproduction first.

1. **The shell navigation drawer had no focus containment at all.** It shipped
   in S1.6.2 claiming `aria-modal="true"`, deferring the trap to S1.6.3 — which
   built it, onto a primitive the shell was never migrated to. A real browser
   walked out of the "modal" drawer into the page behind it on the seventeenth
   Tab while assistive technology was still told the rest was inert. Repaired by
   reusing `containTabWithin` rather than growing a second trap.
2. **The shared focus trap counted every radio in a group.** A browser gives a
   same-named radio group ONE tab stop; the trap's computed "last focusable" was
   an element the browser never focuses, so the wrap never fired. This was the
   mechanism behind (1) and it affected `Dialog` and `Drawer` too.
3. **`Button size="small"` was a flat 36px.** Customize, Acquisitions
   pagination and the Acquisition Detail eligibility control are all primary
   operator actions rendered at `small`. The floor now rises on a coarse
   pointer or below `lg`; desktop density is unchanged.
4. **The sign-out control measured 28x28.** Replaced with `IconButton`, which
   already owns the 44x44 minimum.
5. **Workbench reorder dropped focus to `document.body`.** Reordering unmounts
   the pressed button, so a keyboard operator moving a widget twice was thrown
   to the top of the page between presses. Focus is now restored to the same
   control on the same widget instance.
6. **Every Workbench widget was a nested interactive control.** @dnd-kit marks
   the sortable element itself `role="button"` with a tabindex so it can be
   dragged from anywhere. This surface drags only from the handle by design, so
   that wrapper announced a button that does nothing — and it CONTAINS the
   reorder, resize and remove buttons. The generated attributes are removed
   after every render, because the package rewrites them on each one.
7. **Two theme contrast failures, both measured rather than eyeballed.** White
   on the destructive fill measured **3.15:1** in Dark Vault, because
   `--status-critical` is a light coral there — tuned to be read as TEXT, which
   makes it the wrong luminance to pair with a fixed white. It now uses a
   paired `--on-critical` token that flips with the theme, exactly as
   `--on-accent` already did for the brand. Separately, the success pill
   measured **4.46:1** on the inset-surface tint in Light Vault Ledger — a hair
   under the 4.5:1 minimum, and precisely the kind of miss no amount of reading
   the palette reveals. `--rv-success-on-light` was darkened to clear 5.1:1.
8. **The drag handle was `aria-hidden` and focusable at the same time.** It
   shipped as a decorative grip. A real browser disagreed: @dnd-kit writes
   `tabindex="0"` and `role="button"` onto the node and the adapter configures
   a KeyboardSensor, so the handle genuinely is a tab stop and genuinely is
   keyboard-operable. Hiding it left a stop that announced nothing. Suppressing
   the focus would have removed a working capability, so the repair was to stop
   hiding a control that exists and give it the name it always needed. The
   jsdom test that asserted the old behaviour is inverted, and that inversion
   is the finding.

### CI

The gate runs inside **`build-and-verify`** — one of the four required jobs —
not in a fifth status and not in an optional workflow. Browser failures,
screenshot regressions and serious/critical axe violations all fail the required
job. CI installs Chromium and WebKit with `--with-deps`, compares committed
baselines and never rewrites them; `browser:test:update` is a local command.
The test server binds to `127.0.0.1` only.

### Remaining limitations

- **No physical iPad has been tested.** WebKit at iPad geometry is the closest
  CI can run.
- Screenshot baselines are engine- and font-sensitive; they are pinned by the
  exact Playwright version and are refreshed deliberately, in a reviewable diff.
- axe is a static analysis of a rendered state. It does not replace the
  behavioural focus, keyboard and containment assertions, which is why both are
  in this suite.
- Touch geometry is measured in an emulated coarse-pointer context, not under a
  real finger.

## Explicitly deferred

Not part of S1.6.1, and in several cases not part of S1.6 at all:

- Shell restructuring and navigation redesign (S1.6.2).
- Table, dialog, and drawer primitives (S1.6.3).
- Workbench implementation, `@dnd-kit`, and the LayoutStore (S1.6.4).
- Page migrations beyond Acquisitions list (S1.6.5) and Acquisition Detail
  (S1.6.6).
- Nothing further in S1.6: S1.6.7 is the final slice and the program is
  complete.
- Any database, acquisition, exclusion, receiving, cost, historical-import, or
  marketplace change (S2 and beyond).
