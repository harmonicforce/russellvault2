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
| **S1.6.3 Data and overlay primitives** | Table, dialog, drawer, popover, and the remaining feedback surfaces. |
| **S1.6.4 Workbench foundation** | Layout store and grid mechanics (see below). |
| **S1.6.5 Governed-list reference migration** | Acquisitions list migrated onto the system as the reference implementation. |
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
Dialog/Drawer primitives are S1.6.3's, and no general focus-trap framework is
claimed to exist yet.

## Workbench customization boundary (S1.6.4+, not implemented here)

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

## Explicitly deferred

Not part of S1.6.1, and in several cases not part of S1.6 at all:

- Shell restructuring and navigation redesign (S1.6.2).
- Table, dialog, drawer, and popover primitives (S1.6.3).
- Workbench implementation, `@dnd-kit`, and the LayoutStore (S1.6.4).
- Page migrations (S1.6.5, S1.6.6).
- Playwright and axe (S1.6.7).
- Any database, acquisition, exclusion, receiving, cost, historical-import, or
  marketplace change (S2 and beyond).
