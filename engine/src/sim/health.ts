/**
 * Automated checks for "is the pricing doing something unwanted?". Each check returns
 * pass / warn / fail (or info for context-only numbers) with the measured value, so a
 * scenario suite can be read at a glance and regressions show up when equations change.
 */
import { AVAILABLE, CATEGORY_LABEL, FACTION_LABEL, ITEMS } from '../catalog/catalog';
import { CATEGORIES, FACTIONS, type Category, type Faction } from '../catalog/types';
import { mean, median, quantile, slope, spearman } from '../util/math';
import type { SimResult } from './simulate';

export type Verdict = 'pass' | 'warn' | 'fail' | 'info';

export interface HealthCheck {
  id: string;
  label: string;
  verdict: Verdict;
  value: string;
  detail: string;
}

export interface HealthReport {
  verdict: Exclude<Verdict, 'info'>;
  checks: HealthCheck[];
}

const RANK: Record<Verdict, number> = { info: 0, pass: 1, warn: 2, fail: 3 };
const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (n: number, d = 0) => `${fmt(n * 100, d)}%`;

function grade(value: number, passIf: (v: number) => boolean, warnIf: (v: number) => boolean): Verdict {
  return passIf(value) ? 'pass' : warnIf(value) ? 'warn' : 'fail';
}

type SimData = Omit<SimResult, 'health'>;

/** Priced (non-free) items of a category available vs a faction. */
const priced = (f: Faction, c: Category) => AVAILABLE[f][c].filter((i) => !i.alwaysFree);

export function evaluateHealth(r: SimData): HealthReport {
  const checks: HealthCheck[] = [];
  const nDays = r.days.length;
  const last = r.days.slice(-Math.min(30, nDays));
  const finalPrices = (f: Faction) => r.prices[f][r.prices[f].length - 1];
  const base = r.config.anchored.baseline;

  // 1. Ceiling: no single item should become absurdly expensive.
  const maxEver = Math.max(...r.days.map((d) => d.maxPrice), 0);
  checks.push({
    id: 'ceiling',
    label: 'No runaway prices',
    verdict: grade(maxEver, (v) => v <= 15000, (v) => v <= 20000),
    value: `max ${fmt(maxEver)}`,
    detail: 'Highest price any item reached. Above 20,000 means the algorithm is failing; above 15,000 is a warning.',
  });

  // 2. Collapse: prices pinned at the hard minimum mean the market has stopped working.
  const finalFloor = r.days[nDays - 1]?.floorShare ?? 0;
  let worstMedian = Infinity;
  let worstMedianAt = '';
  for (const f of FACTIONS)
    for (const c of CATEGORIES) {
      const m = median(priced(f, c).map((i) => finalPrices(f)[i.index]));
      const ratio = m / base[c];
      if (ratio < worstMedian) {
        worstMedian = ratio;
        worstMedianAt = `${FACTION_LABEL[f]} ${CATEGORY_LABEL[c]}`;
      }
    }
  const collapse = Math.max(RANK[grade(finalFloor, (v) => v < 0.1, (v) => v < 0.3)], RANK[grade(worstMedian, (v) => v >= 0.12, (v) => v >= 0.05)]);
  checks.push({
    id: 'collapse',
    label: 'No price collapse',
    verdict: (['info', 'pass', 'warn', 'fail'] as Verdict[])[collapse],
    value: `${pct(finalFloor)} at floor · lowest median ${pct(worstMedian)} of baseline`,
    detail: `Share of paid items stuck near the hard minimum, and the cheapest category median relative to its baseline (${worstMedianAt}).`,
  });

  // 3. Drift: the overall price level should be stationary once settled.
  let worstDrift = 0;
  let worstDriftAt = '';
  // Measure after the last scripted event has had time to settle, so a patch or a brigade
  // ending isn't mistaken for drift.
  const lastEvent = Math.max(0, ...(r.scenario.events ?? []).map((e) => ('until' in e && e.until ? e.until : e.day)));
  const tailStart = Math.min(Math.max(Math.floor(nDays * 0.6), lastEvent + 20), Math.max(0, nDays - 20));
  for (const f of FACTIONS)
    for (const c of CATEGORIES) {
      const series = r.prices[f].slice(tailStart + 1).map((day) => {
        const ps = priced(f, c).map((i) => Math.log(Math.max(day[i.index], 1)));
        return mean(ps);
      });
      const perMonth = Math.abs(slope(series) * 30);
      if (perMonth > worstDrift) {
        worstDrift = perMonth;
        worstDriftAt = `${FACTION_LABEL[f]} ${CATEGORY_LABEL[c]}`;
      }
    }
  checks.push({
    id: 'drift',
    label: 'No inflation or deflation',
    verdict: grade(worstDrift, (v) => v < Math.log(1.15), (v) => v < Math.log(1.4)),
    value: `${pct(Math.exp(worstDrift) - 1, 1)} / month`,
    detail: `Largest trend in a category's (geometric) price level from cycle ${tailStart} on, once scripted events have settled (${worstDriftAt}).`,
  });

  // 4. Volatility and oscillation.
  const vol = mean(last.map((d) => d.volatility));
  let flips = 0;
  let flipWeight = 0;
  const window = Math.min(30, nDays - 1);
  for (const f of FACTIONS) {
    const series = r.prices[f];
    const shares = r.shares[f][r.shares[f].length - 1];
    for (const it of ITEMS) {
      if (it.alwaysFree || !it.tiers[f]) continue;
      let prev = 0;
      let n = 0;
      for (let d = series.length - window; d < series.length; d++) {
        const a = series[d - 1][it.index];
        const b = series[d][it.index];
        if (a <= 0 || b <= 0) continue;
        const delta = Math.log(b / a);
        if (Math.abs(delta) < 0.02) continue;
        if (prev !== 0 && Math.sign(delta) !== Math.sign(prev)) n++;
        prev = delta;
      }
      flips += shares[it.index] * (n / window);
      flipWeight += shares[it.index];
    }
  }
  const zigzag = flipWeight ? flips / flipWeight : 0;
  checks.push({
    id: 'volatility',
    label: 'Stable day to day',
    verdict: (['info', 'pass', 'warn', 'fail'] as Verdict[])[
      Math.max(RANK[grade(vol, (v) => v < 0.03, (v) => v < 0.06)], RANK[grade(zigzag, (v) => v < 0.2, (v) => v < 0.4)])
    ],
    value: `${pct(vol, 1)} avg move · ${pct(zigzag)} zig-zag`,
    detail: 'Popularity-weighted average daily price move over the last 30 cycles, and how often popular items reverse direction (oscillation).',
  });

  // 5. Meta gear expensive: price should track true strength within each faction market.
  const corr: number[] = [];
  const weights: number[] = [];
  for (const f of FACTIONS)
    for (const c of CATEGORIES) {
      const items = priced(f, c);
      if (items.length < 4) continue;
      corr.push(spearman(items.map((i) => r.strength[f][i.index]), items.map((i) => finalPrices(f)[i.index])));
      weights.push(items.length);
    }
  const metaCorr = corr.reduce((s, v, i) => s + v * weights[i], 0) / weights.reduce((s, w) => s + w, 0);
  checks.push({
    id: 'meta-expensive',
    label: 'Meta gear is expensive',
    verdict: grade(metaCorr, (v) => v >= 0.5, (v) => v >= 0.25),
    value: `ρ = ${fmt(metaCorr, 2)}`,
    detail: 'Rank correlation between how strong an item really is (vs that faction) and its final price, averaged over every faction/category market.',
  });

  // 6. Niche gear affordable.
  const nicheRatios: number[] = [];
  const spreads: number[] = [];
  for (const f of FACTIONS)
    for (const c of CATEGORIES) {
      const items = priced(f, c);
      if (items.length < 4) continue;
      const str = items.map((i) => r.strength[f][i.index]);
      const lo = quantile(str, 0.25);
      const hi = quantile(str, 0.75);
      const p = (sel: (s: number) => boolean) => mean(items.filter((i) => sel(r.strength[f][i.index])).map((i) => finalPrices(f)[i.index]));
      const bottom = p((s) => s <= lo);
      const top = p((s) => s >= hi);
      nicheRatios.push(bottom / base[c]);
      spreads.push(top / Math.max(bottom, 1));
    }
  const niche = mean(nicheRatios);
  const spread = median(spreads);
  checks.push({
    id: 'niche-affordable',
    label: 'Niche gear is affordable',
    verdict: (['info', 'pass', 'warn', 'fail'] as Verdict[])[
      Math.max(RANK[grade(niche, (v) => v <= 0.5, (v) => v <= 0.9)], RANK[grade(spread, (v) => v >= 3, (v) => v >= 1.8)])
    ],
    value: `bottom quartile at ${pct(niche)} of baseline · top/bottom ${fmt(spread, 1)}x`,
    detail: 'Average price of the weakest quarter of each market relative to its baseline, and how many times pricier the strongest quarter is.',
  });

  // 7. Premium gear isn't crushed by the permanently free option in its category.
  const crushed: string[] = [];
  for (const f of FACTIONS)
    for (const c of ['primary', 'secondary', 'throwable'] as Category[]) {
      const items = priced(f, c);
      const best = items.reduce((a, b) => (r.strength[f][b.index] > r.strength[f][a.index] ? b : a));
      const med = median(items.map((i) => finalPrices(f)[i.index]));
      if (finalPrices(f)[best.index] < med) crushed.push(`${best.short} (${FACTION_LABEL[f]})`);
    }
  checks.push({
    id: 'premium-survives',
    label: 'Free defaults don’t crush premium gear',
    verdict: crushed.length === 0 ? 'pass' : crushed.length <= 2 ? 'warn' : 'fail',
    value: crushed.length ? `${crushed.length} below median` : 'all above median',
    detail: crushed.length
      ? `Strongest paid weapon priced under its category median: ${crushed.join(', ')}.`
      : 'In every weapon category the strongest paid item stays above the category median despite the free Constitution / Peacemaker / High Explosive.',
  });

  // 8. Affordability: the design benchmark is a ~24,000 typical loadout, about twice what a
  // high-difficulty mission pays. What players actually spend is capped by income, so that is
  // reported for context rather than graded.
  const typical = mean(last.map((d) => d.typicalLoadout));
  const spend = mean(last.map((d) => d.avgSpend));
  checks.push({
    id: 'affordability',
    label: 'Typical loadout near 24k',
    verdict: grade(typical, (v) => v >= 16000 && v <= 32000, (v) => v >= 10000 && v <= 40000),
    value: `${fmt(typical)} typical · ${fmt(spend)} actually spent`,
    detail: 'A loadout drawn from what the community picks, at full list price, over the last 30 cycles (target ~24,000). "Actually spent" is what budget-limited divers paid on average.',
  });

  // 9. Pricing should push usage off the meta and onto niche gear, compared with the same divers
  // choosing with no prices at all.
  if (r.control) {
    const metaRatio = mean(last.map((d) => d.metaShare)) / Math.max(r.control.metaShare, 1e-9);
    const nicheRatio = mean(last.map((d) => d.nicheShare)) / Math.max(r.control.nicheShare, 1e-9);
    checks.push({
      id: 'spread',
      label: 'Pricing spreads usage',
      verdict: metaRatio <= 1 && nicheRatio >= 1 ? 'pass' : metaRatio <= 1.1 && nicheRatio >= 0.9 ? 'warn' : 'fail',
      value: `meta picks ${fmt(metaRatio, 2)}x · niche picks ${fmt(nicheRatio, 2)}x`,
      detail: 'Share of picks on the strongest quarter (meta) and weaker half (niche) of each market, relative to the same divers choosing with no prices. Meta below 1x and niche above 1x means the economy rewards niche gear.',
    });
    const variety = (['stratagem', 'primary', 'secondary', 'throwable'] as Category[])
      .map((c) => `${CATEGORY_LABEL[c].toLowerCase()} ${fmt(mean(last.map((d) => d.diversity[c])) / Math.max(r.control!.diversity[c], 1e-9), 2)}x`)
      .join(' · ');
    checks.push({
      id: 'variety',
      label: 'Loadout variety',
      verdict: 'info',
      value: variety,
      detail: 'Effective number of distinct items in use relative to unpriced choices. Broke divers leaning on the free stratagems pulls this down by design.',
    });
  }

  // 10. Free stratagem rotation.
  let churn = 0;
  const distinct = FACTIONS.map((f) => new Set(r.days.flatMap((d) => d.free[f])).size);
  for (let d = 1; d < nDays; d++)
    for (const f of FACTIONS) churn += r.days[d].free[f].filter((i) => !r.days[d - 1].free[f].includes(i)).length;
  const churnPerDay = nDays > 1 ? churn / (nDays - 1) / FACTIONS.length : 0;
  checks.push({
    id: 'free-rotation',
    label: 'Free stratagems rotate',
    verdict: r.config.free.count === 0 ? 'info' : grade(Math.min(...distinct), (v) => v >= r.config.free.count + 2, (v) => v > r.config.free.count) === 'fail' ? 'warn' : churnPerDay > 2 ? 'warn' : 'pass',
    value: `${Math.min(...distinct)}-${Math.max(...distinct)} distinct · ${fmt(churnPerDay, 2)} swaps/day`,
    detail: 'How many different stratagems were free per faction over the run, and how many free slots change per cycle (too few = stuck, too many = flickering).',
  });

  // 11. Faction differentiation.
  let spreadSum = 0;
  let spreadN = 0;
  for (const it of ITEMS) {
    if (it.alwaysFree) continue;
    const logs = FACTIONS.filter((f) => it.tiers[f]).map((f) => Math.log(Math.max(finalPrices(f)[it.index], 1)));
    if (logs.length < 2) continue;
    const m = mean(logs);
    spreadSum += Math.sqrt(mean(logs.map((x) => (x - m) ** 2)));
    spreadN++;
  }
  const factionSpread = spreadN ? spreadSum / spreadN : 0;
  checks.push({
    id: 'factions',
    label: 'Prices differ by faction',
    verdict: grade(factionSpread, (v) => v >= 0.12, (v) => v >= 0.05),
    value: `${pct(Math.exp(factionSpread) - 1)} typical gap`,
    detail: 'Typical difference between an item’s price in its three faction markets (gear that is great vs bugs but weak vs bots should be priced accordingly).',
  });

  // 12. Adaptation to balance patches.
  for (const patch of r.patches) {
    const daysToCross = (index: number, up: boolean): number | null => {
      for (let d = patch.day; d < r.prices.terminids.length; d++) {
        let ok = 0;
        let n = 0;
        for (const f of FACTIONS) {
          if (!ITEMS[index].tiers[f]) continue;
          const p = r.prices[f][d][index];
          const med = median(priced(f, ITEMS[index].category).map((i) => r.prices[f][d][i.index]));
          n++;
          if (up ? p >= med : p <= med) ok++;
        }
        if (n && ok === n) return d - patch.day;
      }
      return null;
    };
    const times = [...patch.buffed.map((i) => daysToCross(i, true)), ...patch.nerfed.map((i) => daysToCross(i, false))];
    const worst = times.some((t) => t === null) ? Infinity : Math.max(...(times as number[]));
    checks.push({
      id: 'adaptation',
      label: 'Adapts to balance patches',
      verdict: grade(worst, (v) => v <= 21, (v) => v <= 45),
      value: Number.isFinite(worst) ? `${worst} cycles` : 'never',
      detail: `Cycles after the day-${patch.day} patch until every buffed item was above its category median and every nerfed item below it, in all faction markets.`,
    });
  }

  // 13. Brigading.
  if (r.brigaded.length) {
    const multiples = r.brigaded.flatMap((i) =>
      FACTIONS.filter((f) => ITEMS[i].tiers[f]).map((f) => Math.max(...r.prices[f].map((day) => day[i])) / base[ITEMS[i].category]),
    );
    const worst = Math.max(...multiples);
    checks.push({
      id: 'brigade',
      label: 'Resists brigading',
      verdict: grade(worst, (v) => v <= r.config.anchored.ceilingMultiple * 0.9, (v) => v <= r.config.anchored.ceilingMultiple * 1.2),
      value: `peak ${fmt(worst, 1)}x baseline`,
      detail: 'Highest price a brigaded item reached relative to its baseline. Spam can make an item pricey but never past the soft ceiling.',
    });
  }

  // Context.
  const runs = r.runLengths;
  const missions = r.days.reduce((s, d) => s + d.missions * 4, 0);
  checks.push({
    id: 'economy',
    label: 'Player economy',
    verdict: 'info',
    value: `${fmt(mean(last.map((d) => d.avgBalance)))} avg balance · ${fmt((runs.length / Math.max(missions, 1)) * 100, 2)} bankruptcies / 100 dives`,
    detail: `Median run before bankruptcy: ${runs.length ? fmt(median(runs)) + ' missions' : 'nobody went bankrupt'}. Mission success rate ${pct(mean(last.map((d) => d.successRate)))}. Zero-cost loadouts ${pct(mean(last.map((d) => d.zeroCostShare)))}.`,
  });

  const verdict = checks.reduce<Exclude<Verdict, 'info'>>((v, c) => (RANK[c.verdict] > RANK[v] ? (c.verdict as Exclude<Verdict, 'info'>) : v), 'pass');
  return { verdict, checks };
}
