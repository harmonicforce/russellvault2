// Purchase type classifier — the settled logic worked out with the owner.
// Card verticals get Slab / Single / Sealed / Unreviewed from the title (plus
// the app's sealed-identity links). Non-card verticals get their own label
// (Sneakers, Apparel, Accessories, Electronics, Collectibles, Other).
// "Unreviewed" is the honest bucket for gambling/mystery formats and generic
// lots whose title states no definite type — the owner resolves those by hand.
//
// Bump CLASSIFIER_VERSION whenever this logic changes; the startup migration
// re-tags auto-classified rows on a version change but never touches a row the
// owner edited by hand.
export const CLASSIFIER_VERSION = 2;

export type ProductType =
  | 'Slab' | 'Single' | 'Sealed'
  | 'Sneakers' | 'Apparel' | 'Accessories' | 'Electronics' | 'Collectibles' | 'Other'
  | 'Unreviewed';

export const PRODUCT_TYPES: ProductType[] = [
  'Slab', 'Single', 'Sealed',
  'Sneakers', 'Apparel', 'Accessories', 'Electronics', 'Collectibles', 'Other',
  'Unreviewed',
];

// Only genuine random/gambling formats override a concrete product signal.
// (Seller boilerplate like "read notes"/"giveaway" must NOT — it was stealing
// real sealed items such as "INFERNO X BOOSTER BOX ... READ NOTES".)
const STRONG_MYSTERY = /mystery|wheel|\bspin\b|\brazz\b|raffle/i;
// A named card carrying a grade is a definitive slab even without the word "slab".
const GRADER = /\b(psa|bgs|cgc|sgc|tag|ace|hga|gma)\s*\.?\s*(?:10|9\.5|9|8\.5|8|7|6|5|4|3|2|1|black|gold|pristine|gem)\b/i;
const SLAB_WORD = /\bslabs?\b/i;
const SEALED = /booster pack|booster box|booster bundle|\bboosters?\b|\betbs?\b|elite trainer|\bupc\b|ultra[- ]premium|build\s*(&|and)\s*battle|\bsealed\b|sleeved|\btin\b|blister|collection box|premium collection|\bpacks?\b|\bbundle\b/i;
const SINGLE = /\bsingles?\b|\bnm-?lp\b|\bnm\b|near mint/i;

const VERTICAL_MAP: Record<string, ProductType> = {
  'Sneakers / footwear': 'Sneakers',
  'Apparel': 'Apparel',
  'Accessories': 'Accessories',
  'Electronics': 'Electronics',
  'Other collectibles / games': 'Collectibles',
  'Other / personal': 'Other',
  'Unclassified / review': 'Unreviewed',
  'Food / consumables': 'Other',
};

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
  const vert = row.business_vertical || '';
  const poke = vert === 'Pokémon / TCG';

  // A purchase the app matched as a sealed item is sealed regardless of title
  // or of whether its cost link was later rejected (e.g. the Terapagos UPCs).
  if (row.acquisition_line_id && sealedLineIds.has(row.acquisition_line_id)) return 'Sealed';

  // Non-card verticals are tagged by what they are, not by card keywords.
  if (!poke) return VERTICAL_MAP[vert] ?? 'Other';

  if (STRONG_MYSTERY.test(t)) return 'Unreviewed';        // mystery wheels / spins — not definitive
  if (SLAB_WORD.test(t) || GRADER.test(t)) return 'Slab';
  if (SEALED.test(t)) return 'Sealed';
  if (SINGLE.test(t)) return 'Single';
  return 'Unreviewed';                                     // generic Pokémon lot, live-bid, etc.
}
