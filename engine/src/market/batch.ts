import { ITEMS } from '../catalog/catalog';
import { CATEGORIES, FACTIONS, type Category, type Faction } from '../catalog/types';
import { recordOf } from '../util/math';
import type { Batch } from './types';

export function emptyBatch(): Batch {
  const zeros = () => new Array<number>(ITEMS.length).fill(0);
  return {
    loadouts: recordOf(FACTIONS, () => 0),
    counts: recordOf(FACTIONS, zeros),
    freeCounts: recordOf(FACTIONS, zeros),
    spend: recordOf(FACTIONS, () => recordOf<Category, number>(CATEGORIES, () => 0)),
  };
}

/**
 * Fold one loadout into a batch. `paid[i]` is what slot i actually cost; a paid-nothing pick of
 * an item that isn't permanently free was one of the rotating free stratagems.
 */
export function addLoadout(batch: Batch, faction: Faction, items: readonly number[], paid: readonly number[], weight = 1): void {
  batch.loadouts[faction] += weight;
  const counts = batch.counts[faction];
  const freeCounts = batch.freeCounts[faction];
  const spend = batch.spend[faction];
  for (let s = 0; s < items.length; s++) {
    const item = ITEMS[items[s]];
    counts[items[s]] += weight;
    if (!paid[s] && !item.alwaysFree) freeCounts[items[s]] += weight;
    spend[item.category] += (paid[s] ?? 0) * weight;
  }
}

export function batchSize(batch: Batch): number {
  return FACTIONS.reduce((n, f) => n + batch.loadouts[f], 0);
}

export function mergeBatch(into: Batch, from: Batch): void {
  for (const f of FACTIONS) {
    into.loadouts[f] += from.loadouts[f];
    for (let i = 0; i < ITEMS.length; i++) {
      into.counts[f][i] += from.counts[f][i] ?? 0;
      into.freeCounts[f][i] += from.freeCounts[f]?.[i] ?? 0;
    }
    for (const c of CATEGORIES) into.spend[f][c] += from.spend[f][c];
  }
}
