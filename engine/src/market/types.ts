import type { Category, Faction } from '../catalog/types';
import type { MarketConfig } from './config';

/** Per-item, per-faction market data. */
export interface ItemBook {
  /** Internal list price (unrounded). What players pay is `quote()`d from this. */
  price: number;
  /** Smoothed share of all picks in this item's category (sums to 1 per category). */
  share: number;
  /** Price before the most recent update, for change readouts. */
  prevPrice: number;
  /** Picks this item received in the most recently processed batch. */
  picks: number;
  /** Price the algorithm was steering toward at the last update (anchored algorithm only). */
  target: number;
}

export interface FactionBook {
  /** Indexed by catalog index; null when the item can't be used against this faction. */
  items: (ItemBook | null)[];
  /** Catalog indices of the stratagems that are currently free for this faction. */
  free: number[];
  /** Market cycle on which each entry of `free` became free (same order). */
  freeSince: number[];
  /** Last cycle each stratagem (by catalog index) was free, for the rotation cooldown. */
  freeLast: Record<number, number>;
  /** Smoothed log ratio of spend-per-slot to the category baseline (positive = running hot). */
  heat: Record<Category, number>;
  /** Loadouts processed in the last update and over all time. */
  lastLoadouts: number;
  totalLoadouts: number;
}

/**
 * Aggregated, anonymous usage waiting for the next price update. Submissions are folded into
 * counts immediately, which is all the pricing step needs and keeps saved state small.
 */
export interface Batch {
  loadouts: Record<Faction, number>;
  /** Picks per catalog index. */
  counts: Record<Faction, number[]>;
  /** Of those, picks made while the item was one of the rotating free stratagems. */
  freeCounts: Record<Faction, number[]>;
  /** Requisition actually paid, per category. */
  spend: Record<Faction, Record<Category, number>>;
}

export interface Submission {
  faction: Faction;
  /** Catalog indices: 4 stratagems, primary, secondary, throwable. */
  items: number[];
  /** Price paid for each slot (0 for free picks). */
  paid: number[];
  origin: 'player' | 'sim' | 'manual';
  mode?: 'operations' | 'blitz';
  at?: number;
}

export interface MarketState {
  schema: 1;
  /** Catalog ids in index order when this state was produced; lets saved data survive catalog rebuilds. */
  catalogIds: string[];
  /** Completed price updates ("market cycles"). */
  day: number;
  createdAt: number;
  updatedAt: number;
  preset: { id: string; seed?: number; scale?: number; flatPrice?: number };
  config: MarketConfig;
  books: Record<Faction, FactionBook>;
  pending: Batch;
  /** Most recent submissions, newest last, for display only (capped). */
  recent: Submission[];
}

export interface CategoryReport {
  faction: Faction;
  category: Category;
  picks: number;
  /** Weight the batch got in the share EMA (0 = no data, up to the configured EMA rate). */
  confidence: number;
  heat: number;
  spendPerSlot: number;
  medianBefore: number;
  medianAfter: number;
}

export interface ItemChange {
  faction: Faction;
  index: number;
  before: number;
  after: number;
  target: number;
  share: number;
  picks: number;
}

export interface UpdateReport {
  day: number;
  algorithm: string;
  loadouts: Record<Faction, number>;
  categories: CategoryReport[];
  changes: ItemChange[];
  freeBefore: Record<Faction, number[]>;
  freeAfter: Record<Faction, number[]>;
}
