import { AVAILABLE, ITEMS, itemById } from '../catalog/catalog';
import { CATEGORIES, FACTIONS, SLOT_CATEGORIES, SLOTS_PER_CATEGORY, type Category, type Faction } from '../catalog/types';
import { geoMean, median } from '../util/math';
import { addLoadout, batchSize, emptyBatch } from './batch';
import { mergeConfig } from './config';
import { quote, rotateFree } from './free';
import { anchoredUpdate } from './pricing-anchored';
import { legacyUpdate } from './pricing-legacy';
import { createMarket } from './presets';
import type { Batch, CategoryReport, ItemChange, MarketState, Submission, UpdateReport } from './types';

const RECENT_CAP = 60;

export interface LoadoutProblem {
  slot: number | null;
  message: string;
}

/** Checks a 7-slot loadout (catalog indices or null) against the rules. */
export function validateLoadout(faction: Faction, items: readonly (number | null)[]): LoadoutProblem[] {
  const problems: LoadoutProblem[] = [];
  if (items.length !== SLOT_CATEGORIES.length) return [{ slot: null, message: `A loadout has exactly ${SLOT_CATEGORIES.length} slots.` }];
  const seen = new Set<number>();
  items.forEach((idx, slot) => {
    const want = SLOT_CATEGORIES[slot];
    if (idx === null || idx === undefined) {
      problems.push({ slot, message: `Slot ${slot + 1} is empty.` });
      return;
    }
    const item = ITEMS[idx];
    if (!item) problems.push({ slot, message: `Unknown item in slot ${slot + 1}.` });
    else if (item.category !== want) problems.push({ slot, message: `${item.name} can't go in a ${want} slot.` });
    else if (item.tiers[faction] === null) problems.push({ slot, message: `${item.name} isn't available against this faction.` });
    else if (want === 'stratagem' && seen.has(idx)) problems.push({ slot, message: `${item.name} is already equipped.` });
    if (want === 'stratagem') seen.add(idx);
  });
  return problems;
}

/** Current price of each slot for a faction (0 for free picks). */
export function priceLoadout(state: MarketState, faction: Faction, items: readonly (number | null)[]): number[] {
  return items.map((idx) => (idx === null || idx === undefined ? 0 : quote(state, faction, idx).price));
}

/** Records a deployed loadout as anonymous usage for the next price update. */
export function submitLoadout(state: MarketState, sub: Submission): void {
  const problems = validateLoadout(sub.faction, sub.items);
  if (problems.length) throw new Error(problems.map((p) => p.message).join(' '));
  addLoadout(state.pending, sub.faction, sub.items, sub.paid);
  state.recent.push({ ...sub, at: sub.at ?? Date.now() });
  if (state.recent.length > RECENT_CAP) state.recent.splice(0, state.recent.length - RECENT_CAP);
}

/**
 * Takes a queued loadout back out (a cancelled deploy). Returns false, and changes nothing, if
 * the pending queue no longer holds it, e.g. because an update already counted it.
 */
export function withdrawLoadout(state: MarketState, sub: Pick<Submission, 'faction' | 'items' | 'paid'>): boolean {
  const p = state.pending;
  if (p.loadouts[sub.faction] < 1) return false;
  const need = new Map<number, { all: number; free: number }>();
  sub.items.forEach((idx, s) => {
    const n = need.get(idx) ?? { all: 0, free: 0 };
    n.all++;
    if (!sub.paid[s] && !ITEMS[idx]?.alwaysFree) n.free++;
    need.set(idx, n);
  });
  for (const [idx, n] of need) {
    if ((p.counts[sub.faction][idx] ?? 0) < n.all || (p.freeCounts[sub.faction][idx] ?? 0) < n.free) return false;
  }
  addLoadout(p, sub.faction, sub.items, sub.paid, -1);
  const k = state.recent.map((s) => s.items.join()).lastIndexOf(sub.items.join());
  if (k >= 0) state.recent.splice(k, 1);
  return true;
}

export function pendingCount(state: MarketState): number {
  return batchSize(state.pending);
}

/**
 * Runs one market cycle: processes a batch (default: everything pending), moves prices,
 * re-selects free stratagems, and clears the pending queue if it was the batch used.
 */
export function updateMarket(state: MarketState, batch?: Batch): UpdateReport {
  const usePending = batch === undefined;
  const b = batch ?? state.pending;
  const categories: CategoryReport[] = [];
  const changes: ItemChange[] = [];
  const freeBefore = Object.fromEntries(FACTIONS.map((f) => [f, [...state.books[f].free]])) as Record<Faction, number[]>;

  for (const f of FACTIONS) {
    const book = state.books[f];
    book.lastLoadouts = b.loadouts[f];
    book.totalLoadouts += b.loadouts[f];
    for (let i = 0; i < ITEMS.length; i++) {
      const ib = book.items[i];
      if (!ib) continue;
      ib.prevPrice = ib.price;
      ib.picks = b.counts[f][i] ?? 0;
    }
  }

  if (state.config.algorithm === 'legacy') legacyUpdate(state, b, categories, changes);
  else anchoredUpdate(state, b, categories, changes);

  state.day += 1;
  rotateFree(state);
  state.updatedAt = Date.now();
  if (usePending) state.pending = emptyBatch();

  return {
    day: state.day,
    algorithm: state.config.algorithm,
    loadouts: { ...b.loadouts },
    categories,
    changes,
    freeBefore,
    freeAfter: Object.fromEntries(FACTIONS.map((f) => [f, [...state.books[f].free]])) as Record<Faction, number[]>,
  };
}

// ------------------------------------------------------------------------------------------
// Summaries
// ------------------------------------------------------------------------------------------

export interface CategorySummary {
  faction: Faction;
  category: Category;
  median: number;
  geoMean: number;
  /** Price of a pick weighted by smoothed popularity, i.e. what an average pick costs. */
  usageWeighted: number;
  min: number;
  max: number;
  atFloor: number;
  count: number;
}

export function summarizeCategory(state: MarketState, faction: Faction, category: Category): CategorySummary {
  const book = state.books[faction];
  const items = AVAILABLE[faction][category].filter((i) => !i.alwaysFree);
  const prices = items.map((i) => quote(state, faction, i.index).list);
  let weighted = 0;
  let wsum = 0;
  for (const it of AVAILABLE[faction][category]) {
    const q = quote(state, faction, it.index);
    const s = book.items[it.index]!.share;
    weighted += s * q.price;
    wsum += s;
  }
  return {
    faction,
    category,
    median: median(prices),
    geoMean: geoMean(prices),
    usageWeighted: wsum > 0 ? weighted / wsum : 0,
    min: Math.min(...prices),
    max: Math.max(...prices),
    atFloor: prices.filter((p) => p <= state.config.minPrice * 2).length,
    count: prices.length,
  };
}

/**
 * Cost of a "typical" loadout for a faction: every slot filled at the popularity-weighted average
 * list price of its category, ignoring which stratagems happen to be free right now. This is
 * the number the ~16,000 design benchmark refers to.
 */
export function typicalLoadoutCost(state: MarketState, faction: Faction): number {
  const book = state.books[faction];
  let total = 0;
  for (const c of CATEGORIES) {
    let weighted = 0;
    let wsum = 0;
    for (const it of AVAILABLE[faction][c]) {
      const s = book.items[it.index]!.share;
      weighted += s * (it.alwaysFree ? 0 : quote(state, faction, it.index).list);
      wsum += s;
    }
    total += (wsum > 0 ? weighted / wsum : 0) * SLOTS_PER_CATEGORY[c];
  }
  return total;
}

// ------------------------------------------------------------------------------------------
// Persistence
// ------------------------------------------------------------------------------------------

export function serializeMarket(state: MarketState): string {
  const books = Object.fromEntries(
    FACTIONS.map((f) => {
      const b = state.books[f];
      return [
        f,
        {
          ...b,
          items: b.items.map((ib) =>
            ib ? { price: +ib.price.toFixed(3), prevPrice: +ib.prevPrice.toFixed(3), share: +ib.share.toPrecision(6), picks: ib.picks, target: Math.round(ib.target) } : null,
          ),
        },
      ];
    }),
  );
  return JSON.stringify({ ...state, books });
}

/**
 * Loads saved state, remapping by item id so data survives catalog rebuilds: new items start at
 * their category's tier-list price, removed items are dropped, and missing config fields
 * fall back to defaults.
 */
export function deserializeMarket(json: string | object): MarketState {
  const raw = (typeof json === 'string' ? JSON.parse(json) : json) as MarketState;
  if (!raw || raw.schema !== 1 || !raw.books) throw new Error('Not an HD2 Galactic Market market file.');
  const config = mergeConfig(raw.config);
  const fresh = createMarket('tiers', {}, config);
  const oldIds: string[] = raw.catalogIds ?? ITEMS.map((i) => i.id);
  const state: MarketState = {
    ...fresh,
    day: raw.day ?? 0,
    createdAt: raw.createdAt ?? fresh.createdAt,
    updatedAt: raw.updatedAt ?? fresh.updatedAt,
    preset: raw.preset ?? fresh.preset,
    recent: Array.isArray(raw.recent) ? raw.recent.filter((s) => s.items?.every((i) => ITEMS[i]?.id === oldIds[i])) : [],
  };
  for (const f of FACTIONS) {
    const src = raw.books[f];
    if (!src) continue;
    const dst = state.books[f];
    oldIds.forEach((id, oldIndex) => {
      const item = itemById(id);
      const ib = src.items?.[oldIndex];
      if (!item || !ib || !dst.items[item.index]) return;
      dst.items[item.index] = { ...dst.items[item.index]!, ...ib };
      if (item.alwaysFree) dst.items[item.index]!.price = 0;
    });
    const free = (src.free ?? []).map((i: number, k: number) => [itemById(oldIds[i])?.index, src.freeSince?.[k] ?? raw.day ?? 0] as const);
    dst.free = free.filter(([i]) => i !== undefined).map(([i]) => i as number);
    dst.freeSince = free.filter(([i]) => i !== undefined).map(([, d]) => d);
    dst.freeLast = { ...(src.freeLast ?? {}) };
    dst.heat = { ...dst.heat, ...(src.heat ?? {}) };
    dst.lastLoadouts = src.lastLoadouts ?? 0;
    dst.totalLoadouts = src.totalLoadouts ?? 0;
    for (const c of CATEGORIES) {
      const items = AVAILABLE[f][c];
      const total = items.reduce((s, it) => s + dst.items[it.index]!.share, 0);
      if (total > 0) for (const it of items) dst.items[it.index]!.share /= total;
    }
    if (raw.pending?.counts?.[f]) {
      state.pending.loadouts[f] = raw.pending.loadouts[f] ?? 0;
      oldIds.forEach((id, oldIndex) => {
        const item = itemById(id);
        if (!item) return;
        state.pending.counts[f][item.index] = raw.pending.counts[f][oldIndex] ?? 0;
        state.pending.freeCounts[f][item.index] = raw.pending.freeCounts?.[f]?.[oldIndex] ?? 0;
      });
      state.pending.spend[f] = { ...state.pending.spend[f], ...(raw.pending.spend?.[f] ?? {}) };
    }
  }
  return state;
}

export function cloneMarket(state: MarketState): MarketState {
  return structuredClone(state);
}
