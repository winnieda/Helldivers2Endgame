import { AVAILABLE, ITEMS } from '../catalog/catalog';
import { CATEGORIES, FACTIONS, TIERS, type Category, type Faction, type Item, type Tier } from '../catalog/types';
import { clamp } from '../util/math';
import { Rng } from '../util/rng';
import { emptyBatch } from './batch';
import { defaultConfig, type MarketConfig } from './config';
import { rotateFree } from './free';
import { popularityForMultiple } from './pricing-anchored';
import type { FactionBook, MarketState } from './types';

export type PresetId = 'equal' | 'tiers' | 'tiers-inverted' | 'random' | 'flat';

export interface PresetOptions {
  /** Multiplies every starting price. */
  scale?: number;
  seed?: number;
  /** Price used by the `flat` preset (the prototype started everything at 3000). */
  flatPrice?: number;
}

export interface PresetInfo {
  id: PresetId;
  label: string;
  description: string;
}

export const PRESETS: PresetInfo[] = [
  {
    id: 'tiers',
    label: 'Tier list',
    description: 'Per-faction prices from the u.gg tier lists: OP/S+ gear starts expensive, D-tier starts cheap. The realistic launch state.',
  },
  {
    id: 'equal',
    label: 'Everything equal',
    description: "Every paid item starts at its category's baseline. Tests whether the market discovers the meta on its own.",
  },
  {
    id: 'tiers-inverted',
    label: 'Inverted tiers',
    description: 'Stress test: meta gear starts dirt cheap and junk starts expensive. A healthy market should flip this around.',
  },
  {
    id: 'random',
    label: 'Random',
    description: 'Log-uniform random prices between the soft floor and ceiling. Tests convergence from noise.',
  },
  {
    id: 'flat',
    label: 'Flat (prototype)',
    description: 'Every paid item at one price (default 3000), exactly like the original Python prototype.',
  },
];

/** Starting price multiple of the category baseline for each tier. */
export const TIER_MULTIPLE: Record<Tier, number> = { OP: 2.2, 'S+': 1.75, S: 1.35, A: 1, B: 0.72, C: 0.5, D: 0.33 };

function startPrice(item: Item, faction: Faction, preset: PresetId, config: MarketConfig, rng: Rng, opts: PresetOptions): number {
  const baseline = config.anchored.baseline[item.category];
  const tier = item.tiers[faction] ?? 'D';
  switch (preset) {
    case 'equal':
      return baseline;
    case 'tiers':
      return baseline * TIER_MULTIPLE[tier];
    case 'tiers-inverted':
      return baseline * TIER_MULTIPLE[TIERS[TIERS.length - 1 - TIERS.indexOf(tier)]];
    case 'random': {
      const lo = Math.log(baseline * config.anchored.floorMultiple * 2);
      const hi = Math.log(baseline * config.anchored.ceilingMultiple * 0.85);
      return Math.exp(rng.range(lo, hi));
    }
    case 'flat':
      return opts.flatPrice ?? 3000;
  }
}

/**
 * Seeds smoothed shares to match starting prices, so day one isn't spent "correcting" a price
 * the algorithm can't yet justify. The legacy prototype always began from uniform shares.
 */
function seedShares(state: MarketState, faction: Faction, category: Category): void {
  const items = AVAILABLE[faction][category];
  const book = state.books[faction];
  if (state.config.algorithm === 'legacy') {
    for (const it of items) book.items[it.index]!.share = 1 / items.length;
    return;
  }
  const p = state.config.anchored;
  const weights = items.map((it) => {
    const b = book.items[it.index]!;
    const multiple = it.alwaysFree ? TIER_MULTIPLE[it.tiers[faction] ?? 'D'] : b.price / p.baseline[category];
    return popularityForMultiple(multiple, p);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  items.forEach((it, k) => (book.items[it.index]!.share = weights[k] / total));
}

export function createMarket(preset: PresetId = 'tiers', opts: PresetOptions = {}, config: MarketConfig = defaultConfig()): MarketState {
  const rng = new Rng(opts.seed ?? 1);
  const scale = opts.scale ?? 1;
  const now = Date.now();
  const books = {} as Record<Faction, FactionBook>;
  for (const f of FACTIONS) {
    books[f] = {
      items: ITEMS.map((it) => {
        if (it.tiers[f] === null) return null;
        const price = it.alwaysFree ? 0 : clamp(startPrice(it, f, preset, config, rng, opts) * scale, config.minPrice, config.maxPrice);
        return { price, prevPrice: price, share: 0, picks: 0, target: price };
      }),
      free: [],
      freeSince: [],
      freeLast: {},
      heat: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>,
      lastLoadouts: 0,
      totalLoadouts: 0,
    };
  }
  const state: MarketState = {
    schema: 1,
    catalogIds: ITEMS.map((i) => i.id),
    day: 0,
    createdAt: now,
    updatedAt: now,
    preset: { id: preset, seed: opts.seed, scale: opts.scale, flatPrice: opts.flatPrice },
    config: structuredClone(config),
    books,
    pending: emptyBatch(),
    recent: [],
  };
  for (const f of FACTIONS) for (const c of CATEGORIES) seedShares(state, f, c);
  rotateFree(state);
  return state;
}
