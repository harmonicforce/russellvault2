# Russell Vault Project Context

## Product identity

Russell Vault is a private owner-operated inventory and resale operations application for a mixed collectibles business.

Primary inventory includes Pokémon and other TCG cards, sealed TCG products, footwear, apparel, electronics, and other collectibles.

The application must work for an ordinary operator using an iPad or desktop browser, barcode scanner, mobile camera, and browser-based label printing.

## Product priority order

1. Inventory truth and life-safety of data
2. Workspace isolation and authorization
3. Duplicate and identity protection
4. Recoverability after refresh, navigation, or network interruption
5. Owner usability
6. Operational speed
7. Reporting and convenience
8. Architectural elegance

## Owner-facing operating loop

`acquire → receive → identify → store → photograph → label → prepare listing → list → move/sell/adjust → audit`

A feature is not finished merely because database objects exist. The owner must be able to complete the workflow through the hosted application.

## Inventory model

The governed hierarchy is:

- **Product**: what the thing fundamentally is
- **SKU**: the sellable identity or condition/variant form
- **Lot**: quantity and acquisition/storage grouping
- **Item**: one individually tracked physical unit

Tracking modes:

- **serialized**: one Item per physical unit, each with its own scan SKU
- **lot-managed**: quantity held on the Lot

Do not flatten this model into one generic inventory table or create a second inventory truth.

## Inventory categories

- graded_card
- raw_card
- sealed_tcg
- footwear
- apparel
- electronics
- other_collectible

The database may use broader verticals internally, but the owner-facing subtype should be retained whenever supported. Do not infer a subtype from missing evidence.

## Immutable versus mutable facts

Identity facts are immutable after commit except through governed correction or supersession. Examples include product/SKU identity, certificate, serial, public identifiers, and scan SKU.

Operational facts change only through governed actions preserving history. Examples include location movements, lot adjustments, media-primary changes, workflow transitions, loss, and cycle-count resolutions.

## Evidence rule

Never invent or silently strengthen condition, grade, edition, language, packaging condition, authenticity, identifiers, source, cost, purchase details, listing claims, weights, fees, or market values.

Use explicit `Unknown`, `Unassessed`, or review states when evidence is incomplete.

## Existing product surfaces

The application includes or has foundations for:

- authentication, workspaces, and first-run setup;
- locations;
- multi-category single and batch intake;
- intake sessions and recovery;
- Product → SKU → Lot → Item inventory;
- Current Inventory, item details, and lot details;
- private media and printable labels;
- scan/find and governed movement;
- lot quantity adjustment, recount, split, and merge;
- governed corrections and supersession;
- governed Cycle Count with blind rounds, recounts, resolutions, and audit;
- governed UI/design-system primitives and responsive browser quality gates;
- customizable Daily Workbench;
- governed acquisition classification, list/detail, payment, shipment, and exclusion flows;
- governed receiving from acquisition evidence into inventory provenance;
- governed cost allocation, withdrawal/recovery, derived inventory cost basis, and unresolved-cost triage;
- append-only reconciliation ledger and deterministic offline reconciliation runner;
- legacy SQLite operational surfaces retained only during transition and never to be conflated with governed truth.

The next owner-facing reconciliation surface is S3.3. Historical data import has not been executed.

Consult `CURRENT_STATE.md` for reviewed shipped state and blockers, and `PROJECT_ROADMAP.md` for the approved continuation sequence.

## Deployment identity

This repository does not name the production Supabase project. The deployed Railway environment is the only authority for that identity, and it must be re-read immediately before any consequential live work. See `docs/ai/CURRENT_STATE.attestation.json` for what each known project ref actually is and for the current verification status.

## Out of scope unless explicitly added

- public storefront;
- customer accounts;
- billing;
- tax advice or filing;
- automated marketplace publishing;
- AI identification of inventory;
- fabricated price recommendations;
- destructive deletion of committed inventory;
- unrestricted arbitrary-field/EAV architecture;
- replacement authentication system;
- rewrite of the governed inventory hierarchy.
