import { recordOf } from '../util/math';
import { RAW_ITEMS, CATALOG_SOURCES } from './catalog.data';
import {
  CATEGORIES,
  FACTIONS,
  TIERS,
  type Category,
  type Faction,
  type Item,
  type StratagemType,
  type Tier,
} from './types';

export { CATALOG_SOURCES };

/** Catalog in index order. */
export const ITEMS: readonly Item[] = RAW_ITEMS.map((raw, index) => ({ ...raw, index }));

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function itemById(id: string): Item | undefined {
  return BY_ID.get(id);
}

export function requireItem(id: string): Item {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown item "${id}"`);
  return item;
}

/** Items of a category, in catalog order. */
export const ITEMS_BY_CATEGORY: Record<Category, readonly Item[]> = recordOf(CATEGORIES, (c) => ITEMS.filter((i) => i.category === c));

/** Whether an item can be brought against a faction (u.gg marks some as "—"). */
export const isAvailable = (item: Item, faction: Faction) => item.tiers[faction] !== null;

/** Items of a category usable against a faction. */
export const AVAILABLE: Record<Faction, Record<Category, readonly Item[]>> = recordOf(FACTIONS, (f) =>
  recordOf(CATEGORIES, (c) => ITEMS_BY_CATEGORY[c].filter((i) => isAvailable(i, f))),
);

/** Permanently free items: R-2124 Constitution, P-2 Peacemaker, G-12 High Explosive. */
export const ALWAYS_FREE: readonly Item[] = ITEMS.filter((i) => i.alwaysFree);

/** Tier as a score: OP = 7 ... D = 1. */
export function tierScore(tier: Tier | null): number {
  return tier ? TIERS.length - TIERS.indexOf(tier) : 0;
}

export function searchItems(query: string, category?: Category): Item[] {
  const q = query.trim().toLowerCase();
  const pool = category ? ITEMS_BY_CATEGORY[category] : ITEMS;
  if (!q) return [...pool];
  const exact = pool.find((i) => i.id === q || i.name.toLowerCase() === q || i.fullName.toLowerCase() === q);
  if (exact) return [exact];
  return pool.filter(
    (i) =>
      i.id.includes(q.replace(/\s+/g, '-')) ||
      i.fullName.toLowerCase().includes(q) ||
      (i.designation ?? '').toLowerCase() === q,
  );
}

export const FACTION_LABEL: Record<Faction, string> = {
  terminids: 'Terminids',
  automatons: 'Automatons',
  illuminate: 'Illuminate',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  stratagem: 'Stratagems',
  primary: 'Primaries',
  secondary: 'Secondaries',
  throwable: 'Throwables',
};

export const CATEGORY_SINGULAR: Record<Category, string> = {
  stratagem: 'Stratagem',
  primary: 'Primary',
  secondary: 'Secondary',
  throwable: 'Throwable',
};

export const STRATAGEM_TYPE_LABEL: Record<StratagemType, string> = {
  orbital: 'Orbital',
  eagle: 'Eagle',
  support: 'Support Weapon',
  backpack: 'Backpack',
  defensive: 'Defensive',
  vehicle: 'Vehicle',
};

export const OWNERSHIP_LABEL = {
  base: 'Standard issue',
  warbond: 'Warbond',
  superstore: 'Superstore',
  special: 'Limited',
} as const;
