# Russell Vault Project Context

## Product identity

Russell Vault is a private owner-operated inventory and resale operations application for a mixed collectibles business.

Primary inventory includes:

- Pokémon and other TCG cards, graded and raw
- sealed TCG products
- footwear
- apparel
- electronics
- other collectibles

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

The intended long-term loop is:

`acquire → receive → identify → store → photograph → label → prepare listing → list → move/sell/adjust → audit`

A feature is not finished merely because its database objects exist. The owner must be able to complete the corresponding workflow through the hosted application.

## Inventory model

The governed hierarchy is:

- **Product**: what the thing fundamentally is
- **SKU**: the sellable identity or condition/variant form
- **Lot**: quantity and acquisition/storage grouping
- **Item**: one individually tracked physical unit

Tracking modes:

- **serialized**: one Item per physical unit, each with its own scan SKU
- **lot-managed**: quantity held on the Lot

Do not flatten this model into a single generic inventory table. Do not create a second inventory truth.

## Inventory categories

Owner-facing categories:

- graded_card
- raw_card
- sealed_tcg
- footwear
- apparel
- electronics
- other_collectible

The database may use broader business verticals internally, but the exact owner-facing subtype should be retained whenever possible. Do not infer a subtype when stored facts do not support it.

## Immutable versus mutable facts

Identity-defining facts are immutable after commit unless corrected through a governed supersession or correction workflow.

Examples:

- product identity
- SKU identity
- certificate number
- serial number
- public identifiers
- scan SKU

Operational facts may change only through governed actions that preserve history.

Examples:

- location through movement events
- lot quantity through adjustment events
- primary image through an authorized media function
- operational status through explicit workflow transitions

## Evidence rule

Never invent or silently strengthen:

- condition
- grade
- edition or printing
- language
- packaging condition
- authenticity
- serial or certificate number
- source
- cost
- purchase details
- listing claims

Use explicit values such as `Unassessed`, `Unknown`, or a review queue when uncertainty is real.

## Existing product surfaces

The application currently includes or has foundations for:

- authentication
- workspaces
- first-run setup
- locations
- multi-category single intake
- batch intake
- intake sessions and draft recovery
- Current Inventory for items and lots
- item and lot details
- private media
- printable labels
- scan/find
- governed movement
- Daily Workbench
- legacy SQLite operations surfaces
- provenance and acquisition foundations

Consult `CURRENT_STATE.md` for what is confirmed complete and what remains open.

## Out-of-scope unless a work order explicitly adds it

- public storefront
- customer accounts
- billing
- tax advice or tax filing
- automated marketplace publishing
- AI identification of inventory
- fabricated price recommendations
- destructive deletion of committed inventory
- unrestricted arbitrary-field/EAV architecture
- replacement authentication system
- rewrite of the governed inventory hierarchy