import { ITEMS, itemById } from '../catalog/catalog';
import { FACTIONS, type Faction } from '../catalog/types';
import { roundQuote } from './free';
import type { MarketState } from './types';

/** One saved market cycle. Arrays are indexed by catalog index; -1 = unavailable. */
export interface HistoryPoint {
  day: number;
  at: number;
  loadouts: Record<Faction, number>;
  prices: Record<Faction, number[]>;
  /** Smoothed share × 100000, rounded. */
  shares: Record<Faction, number[]>;
  free: Record<Faction, number[]>;
}

export interface MarketHistory {
  schema: 1;
  catalogIds: string[];
  points: HistoryPoint[];
}

export const HISTORY_CAP = 365;
export const SHARE_SCALE = 100000;

export function emptyHistory(): MarketHistory {
  return { schema: 1, catalogIds: ITEMS.map((i) => i.id), points: [] };
}

export function snapshot(state: MarketState): HistoryPoint {
  const prices = {} as Record<Faction, number[]>;
  const shares = {} as Record<Faction, number[]>;
  const free = {} as Record<Faction, number[]>;
  for (const f of FACTIONS) {
    const book = state.books[f];
    prices[f] = book.items.map((b, i) => (b ? (ITEMS[i].alwaysFree ? 0 : roundQuote(b.price, state)) : -1));
    shares[f] = book.items.map((b) => (b ? Math.round(b.share * SHARE_SCALE) : -1));
    free[f] = [...book.free];
  }
  return {
    day: state.day,
    at: state.updatedAt,
    loadouts: Object.fromEntries(FACTIONS.map((f) => [f, state.books[f].lastLoadouts])) as Record<Faction, number>,
    prices,
    shares,
    free,
  };
}

/** Appends the current state, replacing any point for the same day, and trims to `cap`. */
export function recordHistory(history: MarketHistory, state: MarketState, cap = HISTORY_CAP): MarketHistory {
  const points = history.points.filter((p) => p.day < state.day);
  points.push(snapshot(state));
  return { ...history, points: points.slice(-cap) };
}

export function priceSeries(history: MarketHistory, faction: Faction, index: number): { day: number; price: number; share: number; free: boolean }[] {
  return history.points
    .filter((p) => (p.prices[faction]?.[index] ?? -1) >= 0)
    .map((p) => ({
      day: p.day,
      price: p.prices[faction][index],
      share: p.shares[faction][index] / SHARE_SCALE,
      free: p.free[faction].includes(index),
    }));
}

/** Remaps saved history onto the current catalog order. */
export function migrateHistory(raw: MarketHistory): MarketHistory {
  if (!raw || raw.schema !== 1 || !Array.isArray(raw.points)) return emptyHistory();
  const ids = raw.catalogIds ?? [];
  const sameOrder = ids.length === ITEMS.length && ids.every((id, i) => ITEMS[i].id === id);
  if (sameOrder) return raw;
  const map = ids.map((id) => itemById(id)?.index ?? -1);
  const remap = (arr: number[]) => {
    const out = new Array<number>(ITEMS.length).fill(-1);
    arr.forEach((v, oldI) => map[oldI] >= 0 && (out[map[oldI]] = v));
    return out;
  };
  return {
    schema: 1,
    catalogIds: ITEMS.map((i) => i.id),
    points: raw.points.map((p) => ({
      ...p,
      prices: Object.fromEntries(FACTIONS.map((f) => [f, remap(p.prices[f] ?? [])])) as Record<Faction, number[]>,
      shares: Object.fromEntries(FACTIONS.map((f) => [f, remap(p.shares[f] ?? [])])) as Record<Faction, number[]>,
      free: Object.fromEntries(FACTIONS.map((f) => [f, (p.free[f] ?? []).map((i) => map[i]).filter((i) => i >= 0)])) as Record<Faction, number[]>,
    })),
  };
}
