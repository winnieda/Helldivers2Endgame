import type { Category, Ownership } from '../catalog/types';

export type Algorithm = 'anchored' | 'legacy';

/**
 * "Anchored" pricing: each item's price steers toward a target set by how popular it is
 * relative to a fair share of its category, anchored to a per-category baseline.
 * See docs/PRICING.md for the derivation and why it can't run away.
 */
export interface AnchoredParams {
  /** Price of an item that gets exactly its fair share (1/N) of its category's picks. */
  baseline: Record<Category, number>;
  /** EMA rate for pick shares when a batch is large (β). */
  ema: number;
  /** Batch size (picks per item in the category) at which a batch gets half the EMA rate. */
  halfSamplePerItem: number;
  /** How strongly above-fair-share popularity raises the target (power-law exponent). */
  elasticityUp: number;
  /** How strongly below-fair-share popularity lowers the target. */
  elasticityDown: number;
  /** Targets approach baseline × this for the most popular items, never exceeding it. */
  ceilingMultiple: number;
  /** Targets approach baseline × this for unused items, never going below it. */
  floorMultiple: number;
  /** Fraction of the gap to target closed per update, before modifiers. */
  adjustRate: number;
  /** Multiplier on upward moves (the 1.1 "upward nudge"). */
  upBias: number;
  /** Multiplier on downward moves (the 0.9 "downward nudge"). */
  downBias: number;
  /** Largest fractional price change in one update (0.2 = ±20%). */
  maxStep: number;
  /** Cheap items move slower and expensive items faster: speed ∝ (price/baseline)^this, smoothed. */
  speedExponent: number;
  /** Lower bound on that speed multiplier so niche items can still climb. */
  minSpeed: number;
  /** How much category spending above/below baseline damps rises/falls. 0 disables. */
  spendPressure: number;
  /** Observed picks are divided by this, so less-owned gear isn't discounted for being less owned. */
  ownershipFactor: Record<Ownership, number>;
}

/** Faithful port of the original Python prototype (testing/helper.py, now scratchpad/helper.py). */
export interface LegacyParams {
  kappa: number;
  beta: number;
  maxStep: number;
  alphaBase: number;
  alphaMin: number;
  alphaMax: number;
  kLogistic: number;
  gamma: number;
}

export type FreeRule = 'cheapest' | 'least-popular' | 'random-bottom';

/**
 * Rotating free stratagems. Each one is free for `tenure` cycles (starts are staggered so
 * roughly count/tenure rotate per cycle), then goes back on sale and can't be free again for
 * `cooldown` cycles. While free, an item's popularity and price are frozen: its free picks say
 * nothing about demand at its real price.
 */
export interface FreeRotationParams {
  /** Number of stratagems that are free at any time, per faction. */
  count: number;
  rule: FreeRule;
  tenure: number;
  cooldown: number;
}

export interface MarketConfig {
  algorithm: Algorithm;
  anchored: AnchoredParams;
  legacy: LegacyParams;
  free: FreeRotationParams;
  /** Hard bounds for non-free items. */
  minPrice: number;
  maxPrice: number;
  /** Charged prices are rounded to this many Requisition. */
  quoteStep: number;
}

export function defaultConfig(): MarketConfig {
  return {
    algorithm: 'anchored',
    anchored: {
      baseline: { stratagem: 5000, primary: 3300, secondary: 2200, throwable: 1100 },
      ema: 0.35,
      halfSamplePerItem: 8,
      elasticityUp: 0.8,
      elasticityDown: 1.5,
      ceilingMultiple: 3.5,
      floorMultiple: 0.04,
      adjustRate: 0.4,
      upBias: 1.1,
      downBias: 0.9,
      maxStep: 0.2,
      speedExponent: 0.5,
      minSpeed: 0.35,
      spendPressure: 0.6,
      ownershipFactor: { base: 1, warbond: 0.9, superstore: 0.9, special: 0.9 },
    },
    legacy: {
      kappa: 3,
      beta: 0.4,
      maxStep: 0.2,
      alphaBase: 0.35,
      alphaMin: 0.15,
      alphaMax: 0.8,
      kLogistic: 1.2,
      gamma: 0.6,
    },
    free: { count: 4, rule: 'cheapest', tenure: 4, cooldown: 12 },
    minPrice: 10,
    maxPrice: 50000,
    quoteStep: 10,
  };
}

export interface ParamSpec {
  path: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  algorithm?: Algorithm;
}

/** Every tunable number, for the terminal's `config` command and the Lab's sliders. */
export const PARAM_SPECS: ParamSpec[] = [
  { path: 'anchored.baseline.stratagem', label: 'Stratagem baseline', description: 'Price of a stratagem at exactly fair-share popularity.', min: 500, max: 12000, step: 100, algorithm: 'anchored' },
  { path: 'anchored.baseline.primary', label: 'Primary baseline', description: 'Price of a primary at fair-share popularity.', min: 200, max: 10000, step: 100, algorithm: 'anchored' },
  { path: 'anchored.baseline.secondary', label: 'Secondary baseline', description: 'Price of a secondary at fair-share popularity.', min: 100, max: 8000, step: 100, algorithm: 'anchored' },
  { path: 'anchored.baseline.throwable', label: 'Throwable baseline', description: 'Price of a throwable at fair-share popularity.', min: 100, max: 6000, step: 50, algorithm: 'anchored' },
  { path: 'anchored.ema', label: 'Share EMA rate (β)', description: 'How much a full-confidence batch moves smoothed popularity.', min: 0.02, max: 1, step: 0.01, algorithm: 'anchored' },
  { path: 'anchored.halfSamplePerItem', label: 'Half-confidence sample', description: 'Picks per item at which a batch counts half. Protects against tiny, noisy batches.', min: 0, max: 50, step: 0.5, algorithm: 'anchored' },
  { path: 'anchored.elasticityUp', label: 'Popularity → price (up)', description: 'Exponent mapping above-fair popularity to price.', min: 0.1, max: 2, step: 0.05, algorithm: 'anchored' },
  { path: 'anchored.elasticityDown', label: 'Popularity → price (down)', description: 'Exponent mapping below-fair popularity to price. Higher = niche gear gets cheaper faster.', min: 0.1, max: 2.5, step: 0.05, algorithm: 'anchored' },
  { path: 'anchored.ceilingMultiple', label: 'Ceiling multiple', description: 'Most popular items approach baseline × this (soft cap).', min: 1.5, max: 12, step: 0.1, algorithm: 'anchored' },
  { path: 'anchored.floorMultiple', label: 'Floor multiple', description: 'Unused items approach baseline × this (soft floor).', min: 0.003, max: 0.5, step: 0.001, algorithm: 'anchored' },
  { path: 'anchored.adjustRate', label: 'Adjust rate (η)', description: 'Share of the gap to target closed each update.', min: 0.02, max: 1, step: 0.01, algorithm: 'anchored' },
  { path: 'anchored.upBias', label: 'Upward nudge', description: 'Multiplier on price increases.', min: 0.5, max: 2, step: 0.05, algorithm: 'anchored' },
  { path: 'anchored.downBias', label: 'Downward nudge', description: 'Multiplier on price decreases.', min: 0.5, max: 2, step: 0.05, algorithm: 'anchored' },
  { path: 'anchored.maxStep', label: 'Max step', description: 'Largest fractional change per update.', min: 0.01, max: 0.9, step: 0.01, algorithm: 'anchored' },
  { path: 'anchored.speedExponent', label: 'Price-level speed exponent', description: 'Cheap items move slower, expensive faster. 0 = everything moves at the same speed.', min: 0, max: 2, step: 0.05, algorithm: 'anchored' },
  { path: 'anchored.minSpeed', label: 'Minimum speed', description: 'Lower bound for that speed multiplier.', min: 0.05, max: 1, step: 0.05, algorithm: 'anchored' },
  { path: 'anchored.spendPressure', label: 'Spend pressure', description: 'How much hot category spending slows rises and speeds falls.', min: 0, max: 3, step: 0.05, algorithm: 'anchored' },
  { path: 'anchored.ownershipFactor.warbond', label: 'Warbond ownership', description: 'Observed warbond picks are divided by this.', min: 0.3, max: 1, step: 0.01, algorithm: 'anchored' },
  { path: 'anchored.ownershipFactor.superstore', label: 'Superstore ownership', description: 'Observed superstore picks are divided by this.', min: 0.3, max: 1, step: 0.01, algorithm: 'anchored' },
  { path: 'anchored.ownershipFactor.special', label: 'Limited-item ownership', description: 'Observed picks of campaign/edition items are divided by this.', min: 0.3, max: 1, step: 0.01, algorithm: 'anchored' },
  { path: 'legacy.kappa', label: 'Laplace pseudocount (κ)', description: 'Prototype smoothing pseudocount.', min: 0, max: 50, step: 1, algorithm: 'legacy' },
  { path: 'legacy.beta', label: 'EMA (β)', description: 'Prototype EMA factor.', min: 0.01, max: 1, step: 0.01, algorithm: 'legacy' },
  { path: 'legacy.maxStep', label: 'Max step', description: 'Prototype max change per batch.', min: 0.01, max: 0.9, step: 0.01, algorithm: 'legacy' },
  { path: 'legacy.alphaBase', label: 'α base', description: 'Prototype base aggressiveness.', min: 0.01, max: 2, step: 0.01, algorithm: 'legacy' },
  { path: 'legacy.alphaMin', label: 'α min', description: 'Prototype elasticity floor.', min: 0, max: 1, step: 0.01, algorithm: 'legacy' },
  { path: 'legacy.alphaMax', label: 'α max', description: 'Prototype elasticity ceiling.', min: 0.05, max: 3, step: 0.01, algorithm: 'legacy' },
  { path: 'legacy.kLogistic', label: 'Demand-gain steepness', description: 'Prototype logistic steepness.', min: 0.1, max: 5, step: 0.1, algorithm: 'legacy' },
  { path: 'legacy.gamma', label: 'Price-bias exponent (γ)', description: 'Prototype price-bias exponent.', min: 0, max: 2, step: 0.05, algorithm: 'legacy' },
  { path: 'free.count', label: 'Free stratagems', description: 'Stratagems free at any time, per faction.', min: 0, max: 12, step: 1 },
  { path: 'free.tenure', label: 'Free tenure', description: 'Cycles each free stratagem stays free.', min: 1, max: 60, step: 1 },
  { path: 'free.cooldown', label: 'Free cooldown', description: 'Cycles before a stratagem can be free again.', min: 0, max: 120, step: 1 },
  { path: 'minPrice', label: 'Hard minimum', description: 'Lowest price for non-free gear.', min: 1, max: 1000, step: 1 },
  { path: 'maxPrice', label: 'Hard maximum', description: 'Highest price for any gear.', min: 1000, max: 50000, step: 500 },
];

export function getParam(config: MarketConfig, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], config);
}

/** Returns a copy of config with one value changed; throws on unknown paths or bad values. */
export function setParam(config: MarketConfig, path: string, raw: string | number): MarketConfig {
  const next = structuredClone(config);
  const keys = path.split('.');
  let o = next as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) {
    if (typeof o[k] !== 'object' || o[k] === null) throw new Error(`Unknown setting "${path}"`);
    o = o[k] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (!(last in o)) throw new Error(`Unknown setting "${path}"`);
  const current = o[last];
  if (typeof current === 'number') {
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(v)) throw new Error(`"${raw}" is not a number`);
    o[last] = v;
  } else if (typeof current === 'string') {
    if (path === 'algorithm' && raw !== 'anchored' && raw !== 'legacy') throw new Error('algorithm must be anchored or legacy');
    if (path === 'free.rule' && !['cheapest', 'least-popular', 'random-bottom'].includes(String(raw)))
      throw new Error('free.rule must be cheapest, least-popular or random-bottom');
    o[last] = String(raw);
  } else {
    throw new Error(`"${path}" is a group; set one of its fields`);
  }
  return next;
}

/** Deep-merge a partial config over defaults (used when loading saved or imported state). */
export function mergeConfig(partial: unknown, base: MarketConfig = defaultConfig()): MarketConfig {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  const walk = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      if (!(k in dst)) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof dst[k] === 'object') walk(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
      else if (typeof v === typeof dst[k]) dst[k] = v;
    }
  };
  if (partial && typeof partial === 'object') walk(out, partial as Record<string, unknown>);
  return out as unknown as MarketConfig;
}
