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
| **S1.6.1 Foundations** | Tokens, themes, typography, geometry, motion, truth-state contract, initial house primitives, root render error boundary, this document. |
| **S1.6.2 Shell** | Governed application shell, navigation, theme control integration, storage adapter for the theme port. |
| **S1.6.3 Data and overlay primitives** | Table, dialog, drawer, popover, and the remaining feedback surfaces. |
| **S1.6.4 Workbench foundation** | Layout store and grid mechanics (see below). |
| **S1.6.5 Governed-list reference migration** | Acquisitions list migrated onto the system as the reference implementation. |
| **S1.6.6 Governed-detail reference migration** | Acquisition detail migrated onto the system. |
| **S1.6.7 Browser quality gate** | Playwright and axe; end-to-end and automated accessibility checks. |

Each slice is one PR. None may be pulled forward.

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
