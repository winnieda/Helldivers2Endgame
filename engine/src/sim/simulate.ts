import { AVAILABLE, ITEMS, requireItem, tierScore } from '../catalog/catalog';
import { CATEGORIES, FACTIONS, type Category, type Faction } from '../catalog/types';
import { defaultRules, suggestedEarnings, type EconomyRules, type MissionOutcome } from '../game/rules';
import { addLoadout, emptyBatch } from '../market/batch';
import { defaultConfig, type MarketConfig } from '../market/config';
import { quote, roundQuote } from '../market/free';
import { cloneMarket, summarizeCategory, typicalLoadoutCost, updateMarket } from '../market/market';
import { createMarket } from '../market/presets';
import type { Batch, MarketState } from '../market/types';
import { clamp, effectiveCount, sigmoid } from '../util/math';
import { Rng } from '../util/rng';
import { ARCHETYPES, chooseLoadout, loadoutPower, makeAgent, World, type Agent, type ArchetypeId, type ChoiceContext } from './agents';
import { evaluateHealth, type HealthReport } from './health';
import type { Scenario, ScenarioEvent } from './scenarios';

export interface SimOptions {
  scenario: Scenario;
  config?: MarketConfig;
  rules?: EconomyRules;
  seed?: number;
  days?: number;
  squadsPerDay?: number;
  /** Also run a short price-blind control to measure "natural" loadout variety (default true). */
  control?: boolean;
  /** Start from this market instead of the scenario's preset (it is cloned, not mutated). */
  market?: MarketState;
  onDay?: (day: DayStats) => void;
}

export interface DayStats {
  day: number;
  loadouts: number;
  missions: number;
  squadsPerDay: number;
  /** Mean Requisition spent per loadout. */
  avgSpend: number;
  /** Fraction of loadouts that cost nothing. */
  zeroCostShare: number;
  freeUptake: Record<Category, number>;
  /** Effective number of distinct items used (exp of entropy), averaged over factions. */
  diversity: Record<Category, number>;
  /** Fraction of picks going to the strongest quarter of each market (vs that faction). */
  metaShare: number;
  /** Fraction of picks going to the weaker half of each market. */
  nicheShare: number;
  successRate: number;
  avgBalance: number;
  bankruptcies: number;
  median: Record<Faction, Record<Category, number>>;
  usageWeighted: Record<Faction, Record<Category, number>>;
  maxPrice: number;
  /** Fraction of priced items within 2x of the hard minimum. */
  floorShare: number;
  /** Popularity-weighted mean |log price change| this cycle. */
  volatility: number;
  /** Cost of a loadout drawn from the community's pick distribution at full list price, averaged over factions. */
  typicalLoadout: number;
  free: Record<Faction, number[]>;
  events: string[];
}

export interface PatchRecord {
  day: number;
  buffed: number[];
  nerfed: number[];
}

export interface SimResult {
  scenario: Scenario;
  config: MarketConfig;
  rules: EconomyRules;
  seed: number;
  days: DayStats[];
  /** prices[f][d]: rounded list prices by catalog index after day d (d = 0 is the start); -1 = unavailable. */
  prices: Record<Faction, Float32Array[]>;
  shares: Record<Faction, Float32Array[]>;
  strength: Record<Faction, Float64Array>;
  patches: PatchRecord[];
  brigaded: number[];
  runLengths: number[];
  control: ControlStats | null;
  final: MarketState;
  health: HealthReport;
  elapsedMs: number;
}

const OPERATION_MISSIONS = 3;

/** The same divers choosing with no prices at all: the baseline for "does pricing spread usage?". */
export interface ControlStats {
  diversity: Record<Category, number>;
  metaShare: number;
  nicheShare: number;
}

/**
 * Mission model: success odds depend on squad loadout power (in tier points) against a
 * difficulty threshold. Gear matters, but skill matters more: a veteran squad clears Helldive (9)
 * roughly three times in four with an all-free loadout and almost always with meta gear.
 */
function difficultyThreshold(d: number): number {
  return 2.2 + 0.16 * d;
}

export function missionSuccessChance(power: number, difficulty: number): number {
  return sigmoid(1.0 * (power - difficultyThreshold(difficulty)) + 2.0);
}

/** Squads drop a couple of difficulty levels when they're broke (they still need to get paid). */
function chooseDifficulty(squad: Agent[], rng: Rng, rules: EconomyRules): number {
  const [lo, hi] = squad[0].arch.difficulty;
  let d = Math.round(rng.range(lo, hi));
  const avg = squad.reduce((s, a) => s + a.balance, 0) / squad.length;
  if (avg < rules.maxBalance * 0.1) d -= 2;
  else if (avg < rules.maxBalance * 0.2) d -= 1;
  return clamp(d, 1, 10);
}

function snapshotPrices(state: MarketState): Record<Faction, Float32Array> {
  const out = {} as Record<Faction, Float32Array>;
  for (const f of FACTIONS) {
    const arr = new Float32Array(ITEMS.length);
    state.books[f].items.forEach((b, i) => (arr[i] = !b ? -1 : ITEMS[i].alwaysFree ? 0 : roundQuote(b.price, state)));
    out[f] = arr;
  }
  return out;
}

function snapshotShares(state: MarketState): Record<Faction, Float32Array> {
  const out = {} as Record<Faction, Float32Array>;
  for (const f of FACTIONS) out[f] = Float32Array.from(state.books[f].items, (b) => (b ? b.share : -1));
  return out;
}

class Population {
  agents: Agent[] = [];
  constructor(
    private rng: Rng,
    private world: World,
    private rules: EconomyRules,
  ) {}

  add(mix: Partial<Record<ArchetypeId, number>>, total: number): void {
    const weights = Object.entries(mix) as [ArchetypeId, number][];
    const sum = weights.reduce((s, [, w]) => s + w, 0);
    for (const [id, w] of weights) {
      const n = Math.round((w / sum) * total);
      for (let k = 0; k < n; k++) this.agents.push(makeAgent(this.agents.length, ARCHETYPES[id], this.rng, this.rules.startingBalance, this.world));
    }
  }

  addExact(mix: Partial<Record<ArchetypeId, number>>): void {
    for (const [id, n] of Object.entries(mix) as [ArchetypeId, number][]) {
      for (let k = 0; k < n; k++) this.agents.push(makeAgent(this.agents.length, ARCHETYPES[id], this.rng, this.rules.startingBalance, this.world));
    }
  }

  /** Squads of four for the day; divers may play more than one operation when traffic outstrips the population. */
  squads(count: number): Agent[][] {
    const order = this.rng.shuffle([...this.agents.keys()]);
    const out: Agent[][] = [];
    let cursor = 0;
    for (let s = 0; s < count; s++) {
      const squad: Agent[] = [];
      for (let k = 0; k < 4; k++) {
        if (cursor >= order.length) {
          this.rng.shuffle(order);
          cursor = 0;
        }
        squad.push(this.agents[order[cursor++]]);
      }
      out.push(squad);
    }
    return out;
  }
}

interface FactionView {
  price: Float64Array;
  niche: Float64Array;
}

function factionViews(state: MarketState): Record<Faction, FactionView> {
  const out = {} as Record<Faction, FactionView>;
  for (const f of FACTIONS) {
    const price = new Float64Array(ITEMS.length);
    const niche = new Float64Array(ITEMS.length);
    for (const c of CATEGORIES) {
      const pool = AVAILABLE[f][c];
      const fair = 1 / pool.length;
      for (const it of pool) {
        price[it.index] = quote(state, f, it.index).price;
        niche[it.index] = clamp(-Math.log(Math.max(state.books[f].items[it.index]!.share, 1e-9) / fair), 0, 3);
      }
    }
    out[f] = { price, niche };
  }
  return out;
}

interface DayTally {
  loadouts: number;
  missions: number;
  spend: number;
  zeroCost: number;
  freePicks: Record<Category, number>;
  picks: Record<Category, number>;
  successes: number;
  bankruptcies: number;
}

function newTally(): DayTally {
  const z = () => Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  return { loadouts: 0, missions: 0, spend: 0, zeroCost: 0, freePicks: z(), picks: z(), successes: 0, bankruptcies: 0 };
}

function diversityOf(batch: Batch): Record<Category, number> {
  const out = {} as Record<Category, number>;
  for (const c of CATEGORIES) {
    let acc = 0;
    let wsum = 0;
    for (const f of FACTIONS) {
      const n = batch.loadouts[f];
      if (!n) continue;
      acc += n * effectiveCount(AVAILABLE[f][c].map((it) => batch.counts[f][it.index]));
      wsum += n;
    }
    out[c] = wsum ? acc / wsum : 0;
  }
  return out;
}

/** Share of picks on each market's strongest quarter and weaker half (by true strength). */
function usageSpread(batch: Batch, world: World): { meta: number; niche: number } {
  let meta = 0;
  let niche = 0;
  let total = 0;
  for (const f of FACTIONS) {
    if (!batch.loadouts[f]) continue;
    const str = world.strength[f];
    for (const c of CATEGORIES) {
      const pool = AVAILABLE[f][c];
      const sorted = pool.map((i) => str[i.index]).sort((a, b) => a - b);
      const q75 = sorted[Math.floor(sorted.length * 0.75)];
      const q50 = sorted[Math.floor(sorted.length * 0.5)];
      for (const it of pool) {
        const n = batch.counts[f][it.index];
        total += n;
        if (str[it.index] >= q75) meta += n;
        if (str[it.index] < q50) niche += n;
      }
    }
  }
  return total ? { meta: meta / total, niche: niche / total } : { meta: 0, niche: 0 };
}

/** Runs one squad operation (3 missions), mutating agent balances and the batch. */
function playOperation(
  squad: Agent[],
  faction: Faction,
  difficulty: number,
  view: FactionView,
  world: World,
  rules: EconomyRules,
  rng: Rng,
  batch: Batch,
  tally: DayTally,
  runLengths: number[],
  priceBlind: boolean,
): void {
  const strength = world.strength[faction];
  const squadPicks = new Int32Array(ITEMS.length);
  const expectedIncome = rules.earningsByDifficulty[difficulty] * 0.75;
  const squadSkill = squad.reduce((s, a) => s + a.skill, 0) / squad.length;
  const ctx: ChoiceContext = {
    faction,
    price: view.price,
    strength,
    niche: view.niche,
    squad: squadPicks,
    rng,
    expectedIncome,
    maxBalance: rules.maxBalance,
    priceBlind,
  };
  for (let m = 0; m < OPERATION_MISSIONS; m++) {
    squadPicks.fill(0);
    let power = 0;
    for (const agent of squad) {
      const { items, paid } = chooseLoadout(agent, ctx);
      let cost = 0;
      items.forEach((i, slot) => {
        squadPicks[i]++;
        const c = ITEMS[i].category;
        tally.picks[c]++;
        if (paid[slot] === 0) tally.freePicks[c]++;
        cost += paid[slot];
      });
      if (!priceBlind) agent.balance -= cost;
      addLoadout(batch, faction, items, paid);
      tally.loadouts++;
      tally.spend += cost;
      if (cost === 0) tally.zeroCost++;
      power += loadoutPower(items, strength);
    }
    power = power / squad.length + squadSkill;
    const pSuccess = missionSuccessChance(power, difficulty);
    const r = rng.next();
    const outcome: MissionOutcome = r < pSuccess ? 'extracted' : r < pSuccess + 0.4 * (1 - pSuccess) ? 'completed' : 'failed';
    tally.missions++;
    if (outcome === 'extracted') tally.successes++;
    if (priceBlind) continue;
    for (const agent of squad) {
      const earned = suggestedEarnings(rules, difficulty, outcome) * rng.range(0.9, 1.1);
      const deaths = rng.poisson(1.2 + 3.5 * (1 - pSuccess));
      agent.balance = Math.min(rules.maxBalance, agent.balance - deaths * rules.reinforcementCost + earned);
      agent.runMissions++;
      if (agent.balance < 0) {
        runLengths.push(agent.runMissions);
        agent.balance = rules.startingBalance;
        agent.runMissions = 0;
        tally.bankruptcies++;
      }
    }
  }
}

function brigadeLoadouts(state: MarketState, batch: Batch, items: number[], count: number, mix: Record<Faction, number>, rng: Rng): void {
  for (let k = 0; k < count; k++) {
    const f = rng.weightedKey(mix);
    const loadout = new Array<number>(7).fill(-1);
    const wanted = items.filter((i) => state.books[f].items[i]);
    const strats = wanted.filter((i) => ITEMS[i].category === 'stratagem').slice(0, 4);
    strats.forEach((i, s) => (loadout[s] = i));
    for (const i of wanted) {
      const slot = { primary: 4, secondary: 5, throwable: 6, stratagem: -1 }[ITEMS[i].category];
      if (slot >= 0) loadout[slot] = i;
    }
    // Fill the rest with whatever is cheapest.
    const cheapest = (c: Category, exclude: number[]) =>
      AVAILABLE[f][c].filter((it) => !exclude.includes(it.index)).sort((a, b) => quote(state, f, a.index).price - quote(state, f, b.index).price)[0].index;
    for (let s = 0; s < 4; s++) if (loadout[s] < 0) loadout[s] = cheapest('stratagem', loadout);
    if (loadout[4] < 0) loadout[4] = cheapest('primary', []);
    if (loadout[5] < 0) loadout[5] = cheapest('secondary', []);
    if (loadout[6] < 0) loadout[6] = cheapest('throwable', []);
    addLoadout(batch, f, loadout, loadout.map((i) => quote(state, f, i).price));
  }
}

function measureControl(scenario: Scenario, seed: number, rules: EconomyRules, world: World, state: MarketState): ControlStats {
  const rng = new Rng(`${seed}:control`);
  const pop = new Population(rng, world, rules);
  pop.add(scenario.population, Math.max(24, scenario.squadsPerDay * 5));
  const view = factionViews(state);
  const totals = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  let meta = 0;
  let niche = 0;
  const days = 4;
  for (let d = 0; d < days; d++) {
    const batch = emptyBatch();
    const tally = newTally();
    for (const squad of pop.squads(Math.max(scenario.squadsPerDay, 20))) {
      const f = rng.weightedKey(scenario.factionMix);
      playOperation(squad, f, 9, view[f], world, rules, rng, batch, tally, [], true);
    }
    const div = diversityOf(batch);
    for (const c of CATEGORIES) totals[c] += div[c] / days;
    const spread = usageSpread(batch, world);
    meta += spread.meta / days;
    niche += spread.niche / days;
  }
  return { diversity: totals, metaShare: meta, nicheShare: niche };
}

export function simulate(opts: SimOptions): SimResult {
  const t0 = Date.now();
  const scenario = opts.scenario;
  const seed = opts.seed ?? 1;
  const rules = opts.rules ?? defaultRules();
  const config = structuredClone(opts.config ?? opts.market?.config ?? defaultConfig());
  const rng = new Rng(seed);
  const world = new World(new Rng(`${seed}:world`), scenario.strengthNoise ?? 0.45);
  const state = opts.market ? cloneMarket(opts.market) : createMarket(scenario.preset, scenario.presetOptions ?? {}, config);
  state.config = config;
  const totalDays = opts.days ?? scenario.days;
  let squadsPerDay = opts.squadsPerDay ?? scenario.squadsPerDay;
  let factionMix = { ...scenario.factionMix };

  const pop = new Population(rng, world, rules);
  pop.add(scenario.population, Math.max(24, Math.round(squadsPerDay * 4 * 1.3)));

  const control = opts.control === false ? null : measureControl(scenario, seed, rules, world, state);

  const prices = Object.fromEntries(FACTIONS.map((f) => [f, [] as Float32Array[]])) as Record<Faction, Float32Array[]>;
  const shares = Object.fromEntries(FACTIONS.map((f) => [f, [] as Float32Array[]])) as Record<Faction, Float32Array[]>;
  const pushSnapshot = () => {
    const p = snapshotPrices(state);
    const s = snapshotShares(state);
    for (const f of FACTIONS) {
      prices[f].push(p[f]);
      shares[f].push(s[f]);
    }
  };
  pushSnapshot();

  const days: DayStats[] = [];
  const patches: PatchRecord[] = [];
  const runLengths: number[] = [];
  const brigades: Extract<ScenarioEvent, { type: 'brigade' }>[] = [];
  const brigaded = new Set<number>();

  for (let day = 1; day <= totalDays; day++) {
    const eventsToday: string[] = [];
    for (const ev of scenario.events ?? []) {
      if (ev.day !== day) continue;
      eventsToday.push(ev.label);
      if (ev.type === 'patch') {
        const rec: PatchRecord = { day, buffed: [], nerfed: [] };
        for (const ch of ev.changes) {
          const item = requireItem(ch.item);
          const before = world.meanStrength(item.index);
          world.setTier(item.index, ch.tier, ch.faction);
          (tierScore(ch.tier) >= before ? rec.buffed : rec.nerfed).push(item.index);
        }
        patches.push(rec);
      } else if (ev.type === 'factionMix') factionMix = { ...ev.mix };
      else if (ev.type === 'traffic') squadsPerDay = ev.squadsPerDay;
      else if (ev.type === 'recruits') pop.addExact(ev.add);
      else if (ev.type === 'brigade') {
        brigades.push(ev);
        ev.items.forEach((id) => brigaded.add(requireItem(id).index));
      }
    }

    const view = factionViews(state);
    const batch = emptyBatch();
    const tally = newTally();
    for (const squad of pop.squads(squadsPerDay)) {
      const faction = rng.weightedKey(factionMix);
      const difficulty = chooseDifficulty(squad, rng, rules);
      playOperation(squad, faction, difficulty, view[faction], world, rules, rng, batch, tally, runLengths, false);
    }
    for (const b of brigades) {
      if (day >= b.day && day <= (b.until ?? Infinity)) brigadeLoadouts(state, batch, b.items.map((id) => requireItem(id).index), b.loadoutsPerDay, factionMix, rng);
    }

    const diversity = diversityOf(batch);
    const spread = usageSpread(batch, world);
    const report = updateMarket(state, batch);
    pushSnapshot();

    let vol = 0;
    let groups = 0;
    for (const f of FACTIONS) {
      for (const c of CATEGORIES) {
        groups++;
        for (const it of AVAILABLE[f][c]) {
          const b = state.books[f].items[it.index]!;
          if (it.alwaysFree || b.prevPrice <= 0) continue;
          vol += b.share * Math.abs(Math.log(b.price / b.prevPrice));
        }
      }
    }
    let typical = 0;
    for (const f of FACTIONS) typical += typicalLoadoutCost(state, f) / FACTIONS.length;
    let maxPrice = 0;
    let atFloor = 0;
    let priced = 0;
    const median = {} as Record<Faction, Record<Category, number>>;
    const usageWeighted = {} as Record<Faction, Record<Category, number>>;
    for (const f of FACTIONS) {
      median[f] = {} as Record<Category, number>;
      usageWeighted[f] = {} as Record<Category, number>;
      for (const c of CATEGORIES) {
        const s = summarizeCategory(state, f, c);
        median[f][c] = s.median;
        usageWeighted[f][c] = s.usageWeighted;
        maxPrice = Math.max(maxPrice, s.max);
        atFloor += s.atFloor;
        priced += s.count;
      }
    }
    const freeUptake = Object.fromEntries(CATEGORIES.map((c) => [c, tally.picks[c] ? tally.freePicks[c] / tally.picks[c] : 0])) as Record<Category, number>;
    const stats: DayStats = {
      day,
      loadouts: tally.loadouts,
      missions: tally.missions,
      squadsPerDay,
      avgSpend: tally.loadouts ? tally.spend / tally.loadouts : 0,
      zeroCostShare: tally.loadouts ? tally.zeroCost / tally.loadouts : 0,
      freeUptake,
      diversity,
      metaShare: spread.meta,
      nicheShare: spread.niche,
      successRate: tally.missions ? tally.successes / tally.missions : 0,
      avgBalance: pop.agents.reduce((s, a) => s + a.balance, 0) / pop.agents.length,
      bankruptcies: tally.bankruptcies,
      median,
      usageWeighted,
      maxPrice,
      floorShare: priced ? atFloor / priced : 0,
      volatility: groups ? vol / groups : 0,
      typicalLoadout: typical,
      free: report.freeAfter,
      events: eventsToday,
    };
    days.push(stats);
    opts.onDay?.(stats);
  }

  const partial = {
    scenario,
    config,
    rules,
    seed,
    days,
    prices,
    shares,
    strength: world.strength,
    patches,
    brigaded: [...brigaded],
    runLengths,
    control,
    final: state,
    elapsedMs: 0,
  };
  const health = evaluateHealth(partial);
  return { ...partial, health, elapsedMs: Date.now() - t0 };
}
