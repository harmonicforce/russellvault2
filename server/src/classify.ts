// Purchase type classifier — the settled logic worked out with the owner:
// tag every Whatnot purchase as Slab / Single / Sealed / Other / Unreviewed
// based on what the seller's title actually says (plus the app's sealed-identity
// links). "Unreviewed" is the honest bucket for lots whose title states no type
// (live-bid single items, generic "Lot #", mystery wheels) — the owner resolves
// those by hand. Non-card verticals (sneakers, electronics, food) fall to "Other".

export type ProductType = 'Slab' | 'Single' | 'Sealed' | 'Other' | 'Unreviewed';

const HYPE = /mystery|wheel|giveaway|read notes/i;
const SLAB = /\bslabs?\b/i;
const SINGLE = /\bsingles?\b|\bnm-?lp\b|\bnm\b|near mint/i;
const SEALED = /booster pack|booster box|booster bundle|\betb\b|elite trainer|\bupc\b|ultra[- ]premium|build\s*(&|and)\s*battle|\bsealed\b|\btin\b|blister|collection box|premium collection|\bpacks?\b/i;
// bare "pack" is only trustworthy as sealed for card verticals (avoids "3 Pack" candy)
const CARD_SEALED = /booster|\betb\b|elite trainer|\bupc\b/i;

export interface ClassifiablePurchase {
  acquisition_line_id?: string;
  product_name?: string | null;
  business_vertical?: string | null;
}

export function classifyPurchase(
  row: ClassifiablePurchase,
  sealedLineIds: Set<string>,
): ProductType {
  const t = row.product_name || '';
  const poke = (row.business_vertical || '') === 'Pokémon / TCG';

  // A purchase the app matched as a sealed item is sealed regardless of title
  // or of whether its cost link was later rejected (e.g. the Terapagos UPCs).
  if (row.acquisition_line_id && sealedLineIds.has(row.acquisition_line_id)) return 'Sealed';

  if (HYPE.test(t)) return 'Unreviewed';       // mystery wheels etc. — not definitive
  if (SLAB.test(t)) return 'Slab';
  if (SEALED.test(t) && (poke || CARD_SEALED.test(t))) return 'Sealed';
  if (SINGLE.test(t)) return 'Single';
  if (!poke) return 'Other';                   // non-card vertical, no card signal
  return 'Unreviewed';                         // ambiguous Pokémon lot
}

export const PRODUCT_TYPES: ProductType[] = ['Slab', 'Single', 'Sealed', 'Other', 'Unreviewed'];
