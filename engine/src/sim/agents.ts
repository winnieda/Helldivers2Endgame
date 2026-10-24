/**
 * Rule-based simulated Helldivers. No LLMs: each diver scores every affordable item with a
 * simple utility (true strength vs. the faction + personal taste + archetype quirks - a price
 * penalty that grows as their balance shrinks) and samples a choice with a softmax.
 */
import { AVAILABLE, ITEMS, tierScore } from '../catalog/catalog';
import { CATEGORIES, FACTIONS, type Category, type Faction, type Tier } from '../catalog/types';
import { Rng } from '../util/rng';

export type ArchetypeId = 'regular' | 'meta' | 'thrifty' | 'niche' | 'loyalist' | 'chaos';

export interface Archetype {
  id: ArchetypeId;
  label: string;
  description: string;
  /** Utility per tier point of true item strength. */
  strengthWeight: number;
  /** SD of personal taste per item, in tier points. */
  tasteSd: number;
  /** Utility lost per 1000 Requisition, at a 25k balance (scaled up when poorer, down when richer). */
  priceSensitivity: number;
  /** Utility gained per unit of -ln(popularity / fair share): likes what others don't use. */
  nicheAffinity: number;
  /** Bonus for personal favourites. */
  loyalty: number;
  /** Favourites per category. */
  favorites: number;
  /** Softmax temperature: higher = more random. */
  temperature: number;
  /** Fraction of the current balance this diver is willing to put into one loadout. */
  aggression: number;
  /** Requisition this diver likes to keep in reserve rather than spend. */
  reserve: number;
  difficulty: [number, number];
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  regular: {
    id: 'regular',
    label: 'Regular',
    description: 'Wants good gear, watches the price tag, keeps a little in reserve.',
    strengthWeight: 1,
    tasteSd: 0.8,
    priceSensitivity: 0.55,
    nicheAffinity: 0,
    loyalty: 0.6,
    favorites: 2,
    temperature: 0.7,
    aggression: 0.45,
    reserve: 1500,
    difficulty: [7, 10],
  },
  meta: {
    id: 'meta',
    label: 'Meta Chaser',
    description: 'Brings the strongest gear and pays whatever it costs.',
    strengthWeight: 1.6,
    tasteSd: 0.45,
    priceSensitivity: 0.3,
    nicheAffinity: 0,
    loyalty: 0,
    favorites: 0,
    temperature: 0.5,
    aggression: 0.7,
    reserve: 1000,
    difficulty: [9, 10],
  },
  thrifty: {
    id: 'thrifty',
    label: 'Penny-Pincher',
    description: 'Hunts bargains and free picks; only splurges when flush.',
    strengthWeight: 0.8,
    tasteSd: 0.6,
    priceSensitivity: 1.4,
    nicheAffinity: 0.15,
    loyalty: 0.3,
    favorites: 1,
    temperature: 0.8,
    aggression: 0.25,
    reserve: 3000,
    difficulty: [6, 9],
  },
  niche: {
    id: 'niche',
    label: 'Niche Enjoyer',
    description: 'Seeks out what nobody else is running. The players the market should reward.',
    strengthWeight: 0.55,
    tasteSd: 1,
    priceSensitivity: 0.55,
    nicheAffinity: 0.9,
    loyalty: 0.4,
    favorites: 2,
    temperature: 0.9,
    aggression: 0.45,
    reserve: 1500,
    difficulty: [6, 10],
  },
  loyalist: {
    id: 'loyalist',
    label: 'Loyalist',
    description: 'Runs the same favourites every mission if they can afford them.',
    strengthWeight: 0.7,
    tasteSd: 0.6,
    priceSensitivity: 0.35,
    nicheAffinity: 0,
    loyalty: 2.6,
    favorites: 3,
    temperature: 0.6,
    aggression: 0.6,
    reserve: 1500,
    difficulty: [7, 10],
  },
  chaos: {
    id: 'chaos',
    label: 'Chaos Diver',
    description: 'Picks almost at random. For democracy, probably.',
    strengthWeight: 0.3,
    tasteSd: 0.5,
    priceSensitivity: 0.4,
    nicheAffinity: 0,
    loyalty: 0,
    favorites: 0,
    temperature: 2.6,
    aggression: 0.5,
    reserve: 500,
    difficulty: [5, 10],
  },
};

export interface Agent {
  id: number;
  arch: Archetype;
  /** Personal taste per catalog index. */
  taste: Float64Array;
  /** 1 if a personal favourite, by catalog index. */
  favorite: Uint8Array;
  /** Squad skill contribution, in tier points. */
  skill: number;
  balance: number;
  runMissions: number;
}

export function makeAgent(id: number, arch: Archetype, rng: Rng, startingBalance: number, world: World): Agent {
  const taste = new Float64Array(ITEMS.length);
  for (let i = 0; i < ITEMS.length; i++) taste[i] = rng.normal(0, arch.tasteSd);
  const favorite = new Uint8Array(ITEMS.length);
  if (arch.favorites > 0) {
    for (const c of CATEGORIES) {
      // Favourites lean toward decent gear but aren't purely meta.
      const pool = ITEMS.filter((i) => i.category === c);
      const scored = pool.map((it) => ({ i: it.index, s: world.meanStrength(it.index) + taste[it.index] + rng.normal(0, 1.2) }));
      scored.sort((a, b) => b.s - a.s);
      const n = c === 'stratagem' ? arch.favorites + 1 : Math.max(1, Math.round(arch.favorites / 2));
      for (const { i } of scored.slice(0, n)) favorite[i] = 1;
    }
  }
  return { id, arch, taste, favorite, skill: rng.normal(0, 0.35), balance: startingBalance, runMissions: 0 };
}

/**
 * Ground truth for the simulation: how strong each item really is against each faction. It
 * starts from the u.gg tier (OP = 7 ... D = 1) plus hidden noise, because tier lists are
 * opinions, and can be "patched" mid-simulation.
 */
export class World {
  readonly strength: Record<Faction, Float64Array>;

  constructor(rng: Rng, noise = 0.45) {
    this.strength = {} as Record<Faction, Float64Array>;
    const shared = ITEMS.map(() => rng.normal(0, noise * 0.8));
    for (const f of FACTIONS) {
      const arr = new Float64Array(ITEMS.length);
      for (const it of ITEMS) arr[it.index] = it.tiers[f] ? tierScore(it.tiers[f]) + shared[it.index] + rng.normal(0, noise * 0.6) : 0;
      this.strength[f] = arr;
    }
  }

  meanStrength(index: number): number {
    let s = 0;
    let n = 0;
    for (const f of FACTIONS) {
      if (ITEMS[index].tiers[f]) {
        s += this.strength[f][index];
        n++;
      }
    }
    return n ? s / n : 0;
  }

  setTier(index: number, tier: Tier, faction?: Faction): void {
    for (const f of faction ? [faction] : FACTIONS) {
      if (ITEMS[index].tiers[f]) this.strength[f][index] = tierScore(tier);
    }
  }
}

export interface ChoiceContext {
  faction: Faction;
  /** Price to pay right now (0 for free picks), by catalog index. */
  price: Float64Array;
  strength: Float64Array;
  /** clamp(-ln(share / fairShare), 0, 3): how unpopular an item is (public information). */
  niche: Float64Array;
  /** Squadmates' picks this mission, by catalog index. */
  squad: Int32Array;
  rng: Rng;
  expectedIncome: number;
  maxBalance: number;
  /** Control runs: choose as if everything were free. */
  priceBlind?: boolean;
}

const SLOT_PENALTY = 3.5;
const VEHICLE_PENALTY = 2.5;
const DUPLICATE_PENALTY = 0.35;

function usesSupportSlot(index: number): boolean {
  return ITEMS[index].type === 'support';
}

/** How much this diver is prepared to spend on the next loadout. */
export function loadoutBudget(agent: Agent, ctx: ChoiceContext): number {
  const a = agent.arch;
  const disposable = Math.max(0, agent.balance - a.reserve);
  let budget = a.aggression * agent.balance + 0.35 * ctx.expectedIncome;
  // Near the cap, unspent Requisition would be wasted, so spend the overflow.
  budget += Math.max(0, agent.balance + ctx.expectedIncome - ctx.maxBalance);
  return Math.min(disposable, budget);
}

const scratch = new Float64Array(256);

/** Picks a full 7-slot loadout. Returns catalog indices and what each slot cost. */
export function chooseLoadout(agent: Agent, ctx: ChoiceContext): { items: number[]; paid: number[] } {
  const a = agent.arch;
  const rng = ctx.rng;
  let budget = ctx.priceBlind ? Infinity : loadoutBudget(agent, ctx);
  const wealth = Math.pow(25000 / Math.max(agent.balance, 2500), 0.6);
  const priceWeight = ctx.priceBlind ? 0 : (a.priceSensitivity * wealth) / 1000;

  const items = new Array<number>(7).fill(-1);
  const paid = new Array<number>(7).fill(0);
  const order: Category[] = rng.shuffle(['stratagem', 'primary', 'secondary', 'throwable']);
  let hasSupport = false;
  let hasBackpack = false;
  let vehicles = 0;
  const taken = new Set<number>();

  const pick = (category: Category): number => {
    const pool = AVAILABLE[ctx.faction][category];
    let best = -Infinity;
    let count = 0;
    let cheapest = -1;
    for (let k = 0; k < pool.length; k++) {
      const it = pool[k];
      const i = it.index;
      const cost = ctx.price[i];
      if (cheapest < 0 || cost < ctx.price[cheapest]) cheapest = i;
      if (cost > budget || taken.has(i)) {
        scratch[k] = NaN;
        continue;
      }
      let v = a.strengthWeight * ctx.strength[i] + agent.taste[i] + a.nicheAffinity * ctx.niche[i] - priceWeight * cost;
      if (agent.favorite[i]) v += a.loyalty;
      if (category === 'stratagem') {
        if (usesSupportSlot(i) && hasSupport) v -= SLOT_PENALTY;
        if (it.backpack && hasBackpack) v -= SLOT_PENALTY;
        if (it.type === 'vehicle' && vehicles > 0) v -= VEHICLE_PENALTY;
      }
      v -= DUPLICATE_PENALTY * ctx.squad[i];
      scratch[k] = v;
      if (v > best) best = v;
      count++;
    }
    if (count === 0) return cheapest; // only reachable with no free fallbacks configured
    let total = 0;
    for (let k = 0; k < pool.length; k++) {
      const v = scratch[k];
      const w = Number.isNaN(v) ? 0 : Math.exp((v - best) / a.temperature);
      scratch[k] = w;
      total += w;
    }
    return pool[rng.weighted(scratch.subarray(0, pool.length), total)].index;
  };

  for (const category of order) {
    const slots = category === 'stratagem' ? [0, 1, 2, 3] : [category === 'primary' ? 4 : category === 'secondary' ? 5 : 6];
    for (const slot of slots) {
      const i = pick(category);
      items[slot] = i;
      paid[slot] = ctx.price[i];
      budget -= ctx.price[i];
      if (category === 'stratagem') {
        taken.add(i);
        if (usesSupportSlot(i)) hasSupport = true;
        if (ITEMS[i].backpack) hasBackpack = true;
        if (ITEMS[i].type === 'vehicle') vehicles++;
      }
    }
  }
  return { items, paid };
}

const SLOT_WEIGHT = [1.25, 1.25, 1.25, 1.25, 1, 0.5, 0.5];
const SLOT_WEIGHT_SUM = SLOT_WEIGHT.reduce((s, w) => s + w, 0);

/** Combat value of a loadout in tier points (roughly 1 = all D-tier, 7 = all OP). */
export function loadoutPower(items: readonly number[], strength: Float64Array): number {
  let s = 0;
  for (let k = 0; k < items.length; k++) s += SLOT_WEIGHT[k] * strength[items[k]];
  return s / SLOT_WEIGHT_SUM;
}
