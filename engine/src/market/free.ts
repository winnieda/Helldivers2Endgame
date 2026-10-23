import { AVAILABLE, ITEMS } from '../catalog/catalog';
import { FACTIONS, type Faction } from '../catalog/types';
import { Rng } from '../util/rng';
import type { MarketState } from './types';

/**
 * Picks this faction's free stratagems for the current cycle.
 *
 * Each free stratagem serves `tenure` cycles, then returns to sale and sits out `cooldown`
 * cycles. Open slots are filled by `rule`:
 * - `cheapest`: lowest list price (ties: least popular);
 * - `least-popular`: lowest smoothed share;
 * - `random-bottom`: a random pick from the cheapest quarter.
 *
 * On a fresh market (no free stratagems yet) the starting tenures are staggered so that
 * about count/tenure slots turn over each cycle instead of all at once.
 */
export function selectFree(state: MarketState, faction: Faction): { free: number[]; since: number[] } {
  const { count, rule, tenure, cooldown } = state.config.free;
  const book = state.books[faction];
  const pool = AVAILABLE[faction].stratagem.filter((i) => !i.alwaysFree).map((i) => i.index);
  if (count <= 0 || !pool.length) return { free: [], since: [] };
  const n = Math.min(count, pool.length);
  const day = state.day;
  const valid = new Set(pool);
  const fresh = book.free.length === 0;

  const kept: { i: number; since: number }[] = [];
  book.free.forEach((i, k) => {
    const since = book.freeSince?.[k] ?? day;
    if (valid.has(i) && day - since < tenure && kept.length < n) kept.push({ i, since });
  });
  const price = (i: number) => book.items[i]!.price;
  const share = (i: number) => book.items[i]!.share;
  const coolingDown = (i: number) => day - (book.freeLast?.[i] ?? -Infinity) <= cooldown;
  let ranked: number[];
  if (rule === 'random-bottom') {
    const byPrice = [...pool].sort((a, b) => price(a) - price(b) || a - b);
    ranked = new Rng(`${faction}:${day}:${state.createdAt}`).shuffle(byPrice.slice(0, Math.max(n * 2, Math.ceil(pool.length / 4))));
  } else if (rule === 'least-popular') ranked = [...pool].sort((a, b) => share(a) - share(b) || price(a) - price(b) || a - b);
  else ranked = [...pool].sort((a, b) => price(a) - price(b) || share(a) - share(b) || a - b);
  const taken = new Set(kept.map((k) => k.i));
  // Prefer items off cooldown; fall back to anything if the pool is too small.
  for (const allowCooling of [false, true]) {
    for (const i of ranked) {
      if (kept.length >= n) break;
      if (taken.has(i) || book.free.includes(i) || (!allowCooling && coolingDown(i))) continue;
      const since = fresh ? day - Math.floor((kept.length * tenure) / n) : day;
      kept.push({ i, since });
      taken.add(i);
    }
  }
  for (const i of ranked) {
    if (kept.length >= n) break;
    if (!taken.has(i)) {
      kept.push({ i, since: day });
      taken.add(i);
    }
  }
  kept.sort((a, b) => a.i - b.i);
  return { free: kept.map((k) => k.i), since: kept.map((k) => k.since) };
}

/** Re-selects free stratagems for every faction. */
export function rotateFree(state: MarketState): void {
  for (const f of FACTIONS) {
    const book = state.books[f];
    const { free, since } = selectFree(state, f);
    book.freeLast ??= {};
    for (const i of book.free) if (!free.includes(i)) book.freeLast[i] = state.day - 1;
    book.free = free;
    book.freeSince = since;
  }
}

/** Cycles left before a free stratagem goes back on sale (0 if not free). */
export function freeCyclesLeft(state: MarketState, faction: Faction, index: number): number {
  const book = state.books[faction];
  const k = book.free.indexOf(index);
  return k < 0 ? 0 : Math.max(1, state.config.free.tenure - (state.day - (book.freeSince[k] ?? state.day)));
}

export interface Quote {
  /** What the player pays right now. */
  price: number;
  /** Rounded list price (what it would cost if it weren't free). */
  list: number;
  free: boolean;
  /** Free because it's one of the rotating free stratagems (vs. permanently free). */
  rotating: boolean;
  available: boolean;
}

export function roundQuote(price: number, state: MarketState): number {
  const step = state.config.quoteStep || 1;
  return Math.max(state.config.minPrice, Math.round(price / step) * step);
}

export function quote(state: MarketState, faction: Faction, index: number): Quote {
  const item = ITEMS[index];
  const b = state.books[faction].items[index];
  if (!b) return { price: 0, list: 0, free: false, rotating: false, available: false };
  if (item.alwaysFree) return { price: 0, list: 0, free: true, rotating: false, available: true };
  const list = roundQuote(b.price, state);
  const rotating = state.books[faction].free.includes(index);
  return { price: rotating ? 0 : list, list, free: rotating, rotating, available: true };
}

export function isFree(state: MarketState, faction: Faction, index: number): boolean {
  return ITEMS[index].alwaysFree === true || state.books[faction].free.includes(index);
}
