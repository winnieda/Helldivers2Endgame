export const FACTIONS = ['terminids', 'automatons', 'illuminate'] as const;
export type Faction = (typeof FACTIONS)[number];

export const CATEGORIES = ['stratagem', 'primary', 'secondary', 'throwable'] as const;
export type Category = (typeof CATEGORIES)[number];

export const STRATAGEM_TYPES = ['orbital', 'eagle', 'support', 'backpack', 'defensive', 'vehicle'] as const;
export type StratagemType = (typeof STRATAGEM_TYPES)[number];

/** u.gg tier letters, best to worst. */
export const TIERS = ['OP', 'S+', 'S', 'A', 'B', 'C', 'D'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * How widely owned an item is. Anything other than `base` is assumed to be owned by fewer
 * players, which the pricing model corrects for (see `ownershipFactor` in the pricing config).
 */
export type Ownership = 'base' | 'warbond' | 'superstore' | 'special';

/** Shape of an entry in the generated catalog.data.ts. */
export interface RawItem {
  id: string;
  name: string;
  short: string;
  designation: string | null;
  category: Category;
  source: string;
  ownership: Ownership;
  /** null = not usable against that faction (u.gg lists "—"). */
  tiers: Record<Faction, Tier | null>;
  type?: StratagemType;
  /** Stratagem input, one letter per arrow: U D L R. */
  code?: string;
  cooldown?: number;
  /** Occupies the backpack slot (backpacks and backpack-fed support weapons). */
  backpack?: boolean;
  weaponClass?: string;
  ap?: number;
  alwaysFree?: boolean;
  glyph: string;
}

export interface Item extends RawItem {
  /** Position in the catalog; stable for a given catalog build. */
  index: number;
}

/** The seven paid slots of a loadout, in order. */
export const SLOT_CATEGORIES: readonly Category[] = [
  'stratagem',
  'stratagem',
  'stratagem',
  'stratagem',
  'primary',
  'secondary',
  'throwable',
];

/** Number of loadout slots each category fills. */
export const SLOTS_PER_CATEGORY: Record<Category, number> = {
  stratagem: 4,
  primary: 1,
  secondary: 1,
  throwable: 1,
};
