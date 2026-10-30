/**
 * Anchored popularity pricing.
 *
 *   1. Measure: each category's picks become shares (warbond/superstore picks scaled up by
 *      1/ownership), blended into an EMA whose rate shrinks for small batches.
 *   2. Target: r = share / fairShare. target = baseline × F(r), where F is a power law near
 *      r = 1 that saturates smoothly at ceilingPrice (popular) and floorPrice (unused). The
 *      ceiling and floor are prices shared by every category, so an outlier in a cheap slot can
 *      cost as much as a top stratagem, and useless gear can sink to a few Requisition.
 *      Because F is bounded, no amount of demand can push a target past the ceiling, and no
 *      lack of demand can push it under the floor. Free items stay in the shares, so heavy
 *      free-item use gently cheapens the paid alternatives without collapsing them.
 *   3. Move: price steps a fraction of the way (in log space) toward its target. The step is
 *      scaled by the up/down nudges and capped at ±maxStep, except that a rise may always be
 *      minClimb × baseline (so cheap gear can climb back quickly). Two optional modifiers, off
 *      by default: a price-level speed and category spend pressure.
 *
 * Launch prices are the targets of the seeded popularity (see presets.ts), so an update with no
 * loadouts changes nothing.
 */
import { AVAILABLE } from '../catalog/catalog';
import { CATEGORIES, FACTIONS, SLOTS_PER_CATEGORY, type Category } from '../catalog/types';
import { clamp, median } from '../util/math';
import type { AnchoredParams, MarketConfig } from './config';
import type { Batch, CategoryReport, ItemChange, MarketState } from './types';

/** A category's soft band in log space: U = ln(ceilingPrice / baseline) above it, D = ln(baseline / floorPrice) below. */
export function softBand(baseline: number, p: AnchoredParams): { up: number; down: number } {
  return { up: Math.log(Math.max(p.ceilingPrice / baseline, 1.01)), down: Math.log(Math.max(baseline / p.floorPrice, 1.01)) };
}

/** F(r): price multiple of the category baseline for an item at r × its fair share of picks. */
export function popularityMultiple(r: number, p: AnchoredParams, baseline: number): number {
  const { up, down } = softBand(baseline, p);
  const lr = Math.log(Math.max(r, 1e-9));
  if (lr >= 0) return Math.exp(up * Math.tanh((p.elasticityUp * lr) / up));
  return Math.exp(-down * Math.tanh((p.elasticityDown * -lr) / down));
}

/** Inverse of popularityMultiple: the popularity ratio that would justify a price multiple. */
export function popularityForMultiple(m: number, p: AnchoredParams, baseline: number): number {
  const { up, down } = softBand(baseline, p);
  const lm = Math.log(Math.max(m, 1e-9));
  if (lm >= 0) return Math.exp((up * Math.atanh(clamp(lm / up, 0, 0.995))) / p.elasticityUp);
  return Math.exp((-down * Math.atanh(clamp(-lm / down, 0, 0.995))) / p.elasticityDown);
}

/** Smooth speed multiplier from relative price q = price/baseline: ~q^γ near 1, bounded to [minSpeed, 2]. */
export function priceLevelSpeed(q: number, p: AnchoredParams): number {
  const g = Math.pow(Math.max(q, 1e-6), p.speedExponent);
  return Math.max(p.minSpeed, (2 * g) / (1 + g));
}

/** Logistic pressure factors in (0, 2); equal to 1 when the category spends exactly baseline per slot. */
export function spendPressureFactors(heat: number, p: AnchoredParams): { up: number; down: number } {
  return { up: 2 / (1 + Math.exp(p.spendPressure * heat)), down: 2 / (1 + Math.exp(-p.spendPressure * heat)) };
}

export function anchoredTarget(share: number, fairShare: number, baseline: number, config: MarketConfig): number {
  const t = baseline * popularityMultiple(share / fairShare, config.anchored, baseline);
  return clamp(t, config.minPrice, config.maxPrice);
}

export function anchoredUpdate(state: MarketState, batch: Batch, categories: CategoryReport[], changes: ItemChange[]): void {
  const config = state.config;
  const p = config.anchored;
  const stepUp = Math.log(1 + p.maxStep);
  const stepDown = Math.log(Math.max(1e-6, 1 - p.maxStep));

  for (const f of FACTIONS) {
    const book = state.books[f];
    const counts = batch.counts[f];
    for (const c of CATEGORIES) {
      const items = AVAILABLE[f][c];
      const n = items.length;
      if (!n) continue;
      const baseline = p.baseline[c];
      const fair = 1 / n;

      // 1. Measure. Rotating-free stratagems are frozen: their picks are excluded and the
      //    remaining share is spread over everything else by what people actually paid for.
      const frozen = c === 'stratagem' ? new Set(book.free) : new Set<number>();
      let picks = 0;
      let adjustedTotal = 0;
      let frozenShare = 0;
      const adjusted = new Array<number>(n);
      for (let k = 0; k < n; k++) {
        const idx = items[k].index;
        if (frozen.has(idx)) {
          adjusted[k] = 0;
          frozenShare += book.items[idx]!.share;
          continue;
        }
        const cnt = counts[idx] ?? 0;
        picks += cnt;
        adjusted[k] = cnt / (p.ownershipFactor[items[k].ownership] || 1);
        adjustedTotal += adjusted[k];
      }
      const halfSample = p.halfSamplePerItem * n;
      const w = picks > 0 ? (p.ema * picks) / (picks + halfSample) : 0;
      let shareTotal = 0;
      for (let k = 0; k < n; k++) {
        const b = book.items[items[k].index]!;
        if (!frozen.has(items[k].index)) {
          const observed = adjustedTotal > 0 ? ((1 - frozenShare) * adjusted[k]) / adjustedTotal : b.share;
          b.share = (1 - w) * b.share + w * observed;
        }
        shareTotal += b.share;
      }
      if (shareTotal > 0) for (const it of items) book.items[it.index]!.share /= shareTotal;

      const slots = batch.loadouts[f] * SLOTS_PER_CATEGORY[c as Category];
      const spendPerSlot = slots > 0 ? batch.spend[f][c] / slots : 0;
      if (slots > 0) {
        const rawHeat = clamp(Math.log(Math.max(spendPerSlot, 1) / baseline), -2, 2);
        book.heat[c] = (1 - w) * book.heat[c] + w * rawHeat;
      }
      const pressure = spendPressureFactors(book.heat[c], p);

      // 2 + 3. Target and move.
      const before: number[] = [];
      const after: number[] = [];
      for (const it of items) {
        const b = book.items[it.index]!;
        if (it.alwaysFree) {
          b.price = 0;
          b.target = 0;
          continue;
        }
        if (frozen.has(it.index)) continue;
        before.push(b.price);
        const target = anchoredTarget(b.share, fair, baseline, config);
        const gap = Math.log(target) - Math.log(Math.max(b.price, 1e-6));
        const speed = priceLevelSpeed(b.price / baseline, p);
        const k = gap > 0 ? p.adjustRate * p.upBias * speed * pressure.up : p.adjustRate * p.downBias * speed * pressure.down;
        const climb = Math.max(stepUp, Math.log(1 + (p.minClimb * baseline) / Math.max(b.price, 1e-6)));
        const step = clamp(Math.min(k, 1) * gap, stepDown, climb);
        const old = b.price;
        b.price = clamp(b.price * Math.exp(step), config.minPrice, config.maxPrice);
        b.target = target;
        after.push(b.price);
        changes.push({ faction: f, index: it.index, before: old, after: b.price, target, share: b.share, picks: b.picks });
      }
      categories.push({
        faction: f,
        category: c,
        picks,
        confidence: w,
        heat: book.heat[c],
        spendPerSlot,
        medianBefore: median(before),
        medianAfter: median(after),
      });
    }
  }
}
