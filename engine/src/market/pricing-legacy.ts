/**
 * Line-for-line port of the original Python prototype's `update_prices_for_category`
 * (testing/helper.py, since moved to scratchpad/helper.py), applied per faction. Kept so the
 * simulation harness can compare the new algorithm against the one it replaces. Python's
 * banker's rounding is reproduced so results match the prototype exactly.
 */
import { AVAILABLE } from '../catalog/catalog';
import { CATEGORIES, FACTIONS } from '../catalog/types';
import { clamp, median } from '../util/math';
import type { LegacyParams } from './config';
import type { Batch, CategoryReport, ItemChange, MarketState } from './types';

export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function legacyElasticity(ema: number, tau: number, price: number, meanPrice: number, direction: number, p: LegacyParams): number {
  const r = ema / tau;
  const q = meanPrice > 0 ? price / meanPrice : 1;
  const popFactor = 1 / (1 + Math.exp(-p.kLogistic * (r - 1)));
  const lvlFactor = direction > 0 ? Math.pow(q, p.gamma) : 1 / Math.pow(q, p.gamma);
  return clamp(p.alphaBase * popFactor * lvlFactor, p.alphaMin, p.alphaMax);
}

export function legacyUpdate(state: MarketState, batch: Batch, categories: CategoryReport[], changes: ItemChange[]): void {
  const config = state.config;
  const p = config.legacy;
  for (const f of FACTIONS) {
    if (batch.loadouts[f] <= 0) continue; // prototype: "No missions recorded; nothing to update."
    const book = state.books[f];
    for (const c of CATEGORIES) {
      const items = AVAILABLE[f][c];
      const v = items.length;
      if (!v) continue;
      let total = 0;
      for (const it of items) total += batch.counts[f][it.index] ?? 0;
      const tau = 1 / v;
      const oldPrices = items.map((it) => book.items[it.index]!.price);
      const meanPrice = oldPrices.reduce((a, b) => a + b, 0) / v;
      const before: number[] = [];
      const after: number[] = [];
      items.forEach((it, i) => {
        const b = book.items[it.index]!;
        const laplace = ((batch.counts[f][it.index] ?? 0) + p.kappa) / (total + p.kappa * v);
        b.share = p.beta * laplace + (1 - p.beta) * b.share;
        const old = oldPrices[i];
        if (old === 0) return;
        before.push(old);
        const delta = (b.share - tau) / tau;
        const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;
        const alpha = legacyElasticity(b.share, tau, old, meanPrice, direction, p);
        const factor = clamp(1 + alpha * delta, 1 - p.maxStep, 1 + p.maxStep);
        b.price = clamp(roundHalfEven(old * factor), config.minPrice, config.maxPrice);
        b.target = b.price;
        after.push(b.price);
        changes.push({ faction: f, index: it.index, before: old, after: b.price, target: b.price, share: b.share, picks: b.picks });
      });
      categories.push({
        faction: f,
        category: c,
        picks: total,
        confidence: p.beta,
        heat: 0,
        spendPerSlot: batch.loadouts[f] > 0 ? batch.spend[f][c] / batch.loadouts[f] : 0,
        medianBefore: median(before),
        medianAfter: median(after),
      });
    }
  }
}
