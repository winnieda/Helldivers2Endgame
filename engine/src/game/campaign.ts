/**
 * Campaign state machine for both game modes. Pure functions: each returns a new campaign
 * (and, on deploy, the anonymous submissions for the market). The web app drives this for a
 * hot-seat squad in one browser; a future multiplayer backend can run the same transitions.
 *
 *   briefing ──► loadout ──► deployed ──► debrief ──► summary ──► (loadout | briefing | over)
 *
 * Operations: each diver has a balance (start 50,000, cap 50,000). Loadouts are bought at lock-in
 * and earnings are paid after the mission. Operations are three missions on one front. Failing a
 * single mission ends the run; money only limits what you can afford (a free loadout is always
 * possible), so you can't go bankrupt.
 *
 * Budget Blitz (under construction, not offered in the UI yet): no balances. Each round a diver
 * may spend up to the blitz cap and must earn more than they spent (plus any required margin) or
 * they're eliminated. Last diver standing wins; solo divers play for the longest streak.
 *
 * Reinforcements are recorded but cost nothing: `rules.reinforcementCost` defaults to 0 and is
 * kept only as a possible future rule.
 */
import { ITEMS, tierScore } from '../catalog/catalog';
import { SLOT_CATEGORIES, type Faction } from '../catalog/types';
import { quote } from '../market/free';
import { validateLoadout, type LoadoutProblem } from '../market/market';
import type { MarketState, Submission } from '../market/types';
import { Rng } from '../util/rng';
import { blitzRequiredMargin, defaultRules, suggestedEarnings, type EconomyRules, type MissionOutcome } from './rules';

export type GameMode = 'operations' | 'blitz';
export type Phase = 'briefing' | 'loadout' | 'deployed' | 'debrief' | 'summary' | 'over';
export type DiverStatus = 'active' | 'eliminated';

export interface MissionResult {
  outcome: MissionOutcome;
  earned: number;
  deaths: number;
  /** True once a human has edited `earned`, so outcome changes stop overwriting it. */
  earnedEdited?: boolean;
}

export interface DiverStats {
  missions: number;
  successes: number;
  spent: number;
  earned: number;
  reinforcements: number;
  peakBalance: number;
  profit: number;
}

export interface Diver {
  id: string;
  name: string;
  /** Index into the UI's diver colour palette. */
  color: number;
  status: DiverStatus;
  balance: number;
  /** Seven slots of catalog indices (4 stratagems, primary, secondary, throwable). */
  loadout: (number | null)[];
  ready: boolean;
  locked: { items: number[]; paid: number[]; total: number } | null;
  result: MissionResult | null;
  stats: DiverStats;
  /** Mission number on which they were eliminated (Budget Blitz). */
  outAt?: number;
}

export interface MissionDiverRecord {
  id: string;
  name: string;
  items: number[];
  paid: number[];
  total: number;
  outcome: MissionOutcome;
  earned: number;
  deaths: number;
  reinforcement: number;
  balanceBefore: number;
  balanceAfter: number;
  profit: number;
  status: DiverStatus;
  /** Requisition lost to the balance cap. */
  wasted: number;
}

export interface MissionRecord {
  n: number;
  operation: number;
  missionInOp: number;
  round: number;
  faction: Faction;
  difficulty: number;
  marketDay: number;
  at: number;
  divers: MissionDiverRecord[];
}

export interface Campaign {
  schema: 1;
  id: string;
  mode: GameMode;
  operationName: string;
  squadCode: string;
  createdAt: number;
  updatedAt: number;
  rules: EconomyRules;
  divers: Diver[];
  phase: Phase;
  /** Missions started so far (the current one included once deployed). */
  missionNumber: number;
  operation: number;
  missionInOp: number;
  round: number;
  faction: Faction;
  difficulty: number;
  log: MissionRecord[];
  contributeToMarket: boolean;
  endedReason: string | null;
  winnerId: string | null;
}

const EMPTY_LOADOUT = () => new Array<number | null>(SLOT_CATEGORIES.length).fill(null);
const now = () => Date.now();

const ADJECTIVES = ['Righteous', 'Swift', 'Iron', 'Liberty', 'Burning', 'Silent', 'Valiant', 'Eternal', 'Steel', 'Crimson', 'Patriotic', 'Unyielding', 'Glorious', 'Free', 'Lawful', 'Hallowed', 'Thundering', 'Vigilant'];
const NOUNS = ['Hammer', 'Liberty', 'Dawn', 'Judgment', 'Freedom', 'Eagle', 'Tempest', 'Guardian', 'Spear', 'Harvest', 'Mandate', 'Bastion', 'Verdict', 'Inferno', 'Anthem', 'Citadel', 'Ballot', 'Vanguard'];

export function operationName(rng: Rng = new Rng(now())): string {
  return `Operation ${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`;
}

function squadCode(rng: Rng): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => alphabet[rng.int(alphabet.length)]).join('');
}

const touch = (c: Campaign): Campaign => ({ ...c, updatedAt: now() });
const mapDiver = (c: Campaign, id: string, fn: (d: Diver) => Diver): Campaign => touch({ ...c, divers: c.divers.map((d) => (d.id === id ? fn(d) : d)) });

export interface NewCampaign {
  mode: GameMode;
  names: string[];
  faction?: Faction;
  difficulty?: number;
  rules?: Partial<EconomyRules>;
  contributeToMarket?: boolean;
  seed?: number;
}

export function createCampaign(opts: NewCampaign): Campaign {
  const rng = new Rng(opts.seed ?? now());
  const rules = { ...defaultRules(), ...opts.rules };
  const names = opts.names.map((n) => n.trim()).filter(Boolean).slice(0, 4);
  if (!names.length) throw new Error('A squad needs at least one Helldiver.');
  const t = now();
  return {
    schema: 1,
    id: `c${t.toString(36)}${rng.int(1e6).toString(36)}`,
    mode: opts.mode,
    operationName: operationName(rng),
    squadCode: squadCode(rng),
    createdAt: t,
    updatedAt: t,
    rules,
    divers: names.map((name, i) => ({
      id: `d${i + 1}`,
      name,
      color: i,
      status: 'active',
      balance: opts.mode === 'operations' ? rules.startingBalance : 0,
      loadout: EMPTY_LOADOUT(),
      ready: false,
      locked: null,
      result: null,
      stats: { missions: 0, successes: 0, spent: 0, earned: 0, reinforcements: 0, peakBalance: opts.mode === 'operations' ? rules.startingBalance : 0, profit: 0 },
    })),
    phase: 'briefing',
    missionNumber: 0,
    operation: 1,
    missionInOp: 1,
    round: 1,
    faction: opts.faction ?? 'terminids',
    difficulty: opts.difficulty ?? 10,
    log: [],
    contributeToMarket: opts.contributeToMarket ?? true,
    endedReason: null,
    winnerId: null,
  };
}

export const activeDivers = (c: Campaign) => c.divers.filter((d) => d.status === 'active');

/** Most a diver may spend on this mission's loadout. */
export function spendLimit(c: Campaign, d: Diver): number {
  return c.mode === 'operations' ? d.balance : c.rules.blitzSpendCap;
}

function assertPhase(c: Campaign, ...phases: Phase[]): void {
  if (!phases.includes(c.phase)) throw new Error(`Can't do that during ${c.phase}.`);
}

export function setBriefing(c: Campaign, b: { faction?: Faction; difficulty?: number; operationName?: string }): Campaign {
  assertPhase(c, 'briefing');
  return touch({
    ...c,
    faction: b.faction ?? c.faction,
    difficulty: b.difficulty !== undefined ? Math.max(1, Math.min(10, Math.round(b.difficulty))) : c.difficulty,
    operationName: b.operationName ?? c.operationName,
  });
}

/** Leave the briefing for the armory. Loadouts carry over; anything no longer usable is cleared. */
export function beginLoadout(c: Campaign): Campaign {
  assertPhase(c, 'briefing', 'summary');
  return touch({
    ...c,
    phase: 'loadout',
    divers: c.divers.map((d) => ({
      ...d,
      ready: false,
      locked: null,
      result: null,
      loadout: d.loadout.map((idx) => (idx !== null && ITEMS[idx]?.tiers[c.faction] ? idx : null)),
    })),
  });
}

export function setSlot(c: Campaign, diverId: string, slot: number, index: number | null): Campaign {
  assertPhase(c, 'loadout');
  if (slot < 0 || slot >= SLOT_CATEGORIES.length) throw new Error('No such slot.');
  if (index !== null && ITEMS[index]?.category !== SLOT_CATEGORIES[slot]) throw new Error('Wrong slot for that item.');
  return mapDiver(c, diverId, (d) => {
    const loadout = [...d.loadout];
    // Equipping a stratagem already in another slot moves it.
    if (index !== null && SLOT_CATEGORIES[slot] === 'stratagem') loadout.forEach((v, s) => s !== slot && v === index && (loadout[s] = null));
    loadout[slot] = index;
    return { ...d, loadout, ready: false };
  });
}

export function setLoadout(c: Campaign, diverId: string, items: (number | null)[]): Campaign {
  assertPhase(c, 'loadout');
  return mapDiver(c, diverId, (d) => ({ ...d, loadout: [...items], ready: false }));
}

export function setReady(c: Campaign, diverId: string, ready: boolean): Campaign {
  assertPhase(c, 'loadout');
  return mapDiver(c, diverId, (d) => ({ ...d, ready }));
}

export interface LoadoutCheck {
  total: number;
  limit: number;
  problems: LoadoutProblem[];
  ok: boolean;
}

export function checkLoadout(c: Campaign, d: Diver, market: MarketState): LoadoutCheck {
  const problems = validateLoadout(c.faction, d.loadout);
  const total = d.loadout.reduce<number>((s, idx) => s + (idx === null ? 0 : quote(market, c.faction, idx).price), 0);
  const limit = spendLimit(c, d);
  if (total > limit)
    problems.push({ slot: null, message: c.mode === 'operations' ? `Costs ${total.toLocaleString()} but only ${limit.toLocaleString()} Requisition left.` : `Over the ${limit.toLocaleString()} Blitz spending cap.` });
  return { total, limit, problems, ok: problems.length === 0 };
}

export function canDeploy(c: Campaign, market: MarketState): { ok: boolean; reasons: string[] } {
  if (c.phase !== 'loadout') return { ok: false, reasons: ['Not in the loadout phase.'] };
  const reasons: string[] = [];
  for (const d of activeDivers(c)) {
    const chk = checkLoadout(c, d, market);
    if (!chk.ok) reasons.push(`${d.name}: ${chk.problems[0].message}`);
    else if (!d.ready) reasons.push(`${d.name} isn't ready.`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Locks in every active diver's loadout at current prices and charges them. */
export function deploy(c: Campaign, market: MarketState): { campaign: Campaign; submissions: Submission[] } {
  const gate = canDeploy(c, market);
  if (!gate.ok) throw new Error(gate.reasons.join(' '));
  const submissions: Submission[] = [];
  const divers = c.divers.map((d) => {
    if (d.status !== 'active') return d;
    const items = d.loadout as number[];
    const paid = items.map((idx) => quote(market, c.faction, idx).price);
    const total = paid.reduce((a, b) => a + b, 0);
    submissions.push({ faction: c.faction, items, paid, origin: 'player', mode: c.mode, at: now() });
    return {
      ...d,
      locked: { items, paid, total },
      balance: c.mode === 'operations' ? d.balance - total : d.balance,
      result: null,
    };
  });
  return { campaign: touch({ ...c, divers, phase: 'deployed', missionNumber: c.missionNumber + 1 }), submissions: c.contributeToMarket ? submissions : [] };
}

/**
 * Undo a deploy (misclick): refunds the loadouts. The returned withdrawals are the submissions
 * to take back out of the pending market batch (see withdrawLoadout).
 */
export function cancelDeploy(c: Campaign): { campaign: Campaign; withdrawals: Submission[] } {
  assertPhase(c, 'deployed');
  const withdrawals: Submission[] = [];
  for (const d of c.divers) {
    if (!d.locked || !c.contributeToMarket) continue;
    withdrawals.push({ faction: c.faction, items: d.locked.items, paid: d.locked.paid, origin: 'player', mode: c.mode });
  }
  const campaign = touch({
    ...c,
    phase: 'loadout',
    missionNumber: c.missionNumber - 1,
    divers: c.divers.map((d) => (d.locked ? { ...d, balance: c.mode === 'operations' ? d.balance + d.locked.total : d.balance, locked: null, ready: false } : d)),
  });
  return { campaign, withdrawals };
}

export function beginDebrief(c: Campaign): Campaign {
  assertPhase(c, 'deployed');
  return touch({
    ...c,
    phase: 'debrief',
    divers: c.divers.map((d) =>
      d.status === 'active' ? { ...d, result: d.result ?? { outcome: 'extracted', earned: suggestedEarnings(c.rules, c.difficulty, 'extracted'), deaths: 0 } } : d,
    ),
  });
}

export function setResult(c: Campaign, diverId: string, patch: Partial<MissionResult>): Campaign {
  assertPhase(c, 'debrief');
  return mapDiver(c, diverId, (d) => {
    const prev = d.result ?? { outcome: 'extracted' as MissionOutcome, earned: 0, deaths: 0 };
    const next: MissionResult = { ...prev, ...patch };
    if (patch.earned !== undefined) next.earnedEdited = true;
    if (patch.outcome && patch.earned === undefined && !prev.earnedEdited) next.earned = suggestedEarnings(c.rules, c.difficulty, patch.outcome);
    next.earned = Math.max(0, Math.round(next.earned));
    next.deaths = Math.max(0, Math.round(next.deaths));
    return { ...d, result: next };
  });
}

/** Applies one outcome to the whole squad (missions are usually won or lost together). */
export function setSquadOutcome(c: Campaign, outcome: MissionOutcome): Campaign {
  return activeDivers(c).reduce((acc, d) => setResult(acc, d.id, { outcome }), c);
}

/** Settles the mission: pays out, ends an Operations run on failure, applies Blitz elimination. */
export function finalizeMission(c: Campaign, opts: { marketDay?: number } = {}): Campaign {
  assertPhase(c, 'debrief');
  const r = c.rules;
  const records: MissionDiverRecord[] = [];
  const margin = blitzRequiredMargin(r, c.round);
  const divers = c.divers.map((d): Diver => {
    if (d.status !== 'active' || !d.locked) return d;
    const res = d.result ?? { outcome: 'failed', earned: 0, deaths: 0 };
    const reinforcement = res.deaths * r.reinforcementCost;
    const profit = res.earned - d.locked.total - reinforcement;
    const balanceBefore = c.mode === 'operations' ? d.balance + d.locked.total : 0;
    let balance = d.balance;
    let wasted = 0;
    let status: DiverStatus = 'active';
    if (c.mode === 'operations') {
      const raw = d.balance - reinforcement + res.earned;
      wasted = Math.max(0, raw - r.maxBalance);
      balance = Math.max(0, Math.min(r.maxBalance, raw));
    } else if (profit <= margin) status = 'eliminated';
    const stats: DiverStats = {
      missions: d.stats.missions + 1,
      successes: d.stats.successes + (res.outcome === 'extracted' ? 1 : 0),
      spent: d.stats.spent + d.locked.total,
      earned: d.stats.earned + res.earned,
      reinforcements: d.stats.reinforcements + reinforcement,
      peakBalance: Math.max(d.stats.peakBalance, balance),
      profit: d.stats.profit + profit,
    };
    records.push({
      id: d.id,
      name: d.name,
      items: d.locked.items,
      paid: d.locked.paid,
      total: d.locked.total,
      outcome: res.outcome,
      earned: res.earned,
      deaths: res.deaths,
      reinforcement,
      balanceBefore,
      balanceAfter: balance,
      profit,
      status,
      wasted,
    });
    return { ...d, balance, status, stats, outAt: status === 'active' ? d.outAt : c.missionNumber };
  });

  const record: MissionRecord = {
    n: c.missionNumber,
    operation: c.operation,
    missionInOp: c.missionInOp,
    round: c.round,
    faction: c.faction,
    difficulty: c.difficulty,
    marketDay: opts.marketDay ?? 0,
    at: now(),
    divers: records,
  };
  let next: Campaign = touch({ ...c, divers, phase: 'summary', log: [...c.log, record] });

  const alive = activeDivers(next);
  if (c.mode === 'operations' && records.some((x) => x.outcome === 'failed'))
    next = { ...next, phase: 'over', endedReason: `Mission ${c.missionInOp} of operation ${c.operation} failed. The run is over.` };
  if (c.mode === 'blitz') {
    if (c.divers.length > 1 && alive.length <= 1) {
      const winner = alive[0] ?? [...divers].filter((d) => d.outAt === c.missionNumber).sort((a, b) => b.stats.profit - a.stats.profit)[0];
      next = { ...next, phase: 'over', winnerId: winner?.id ?? null, endedReason: alive.length ? `${alive[0].name} is the last Helldiver standing.` : 'The last divers fell in the same round; best total profit wins.' };
    } else if (alive.length === 0) next = { ...next, phase: 'over', endedReason: `Eliminated in round ${c.round}.` };
  }
  return next;
}

/** Advance after the summary: next mission of the operation, next operation, or next Blitz round. */
export function advance(c: Campaign): Campaign {
  assertPhase(c, 'summary');
  if (c.mode === 'blitz') return touch({ ...c, phase: 'briefing', round: c.round + 1 });
  if (c.missionInOp < c.rules.missionsPerOperation) return beginLoadout({ ...c, missionInOp: c.missionInOp + 1 });
  return touch({ ...c, phase: 'briefing', operation: c.operation + 1, missionInOp: 1, operationName: operationName() });
}

export function endCampaign(c: Campaign, reason = 'The squad stood down.'): Campaign {
  if (c.phase === 'over') return c;
  const best = [...c.divers].sort((a, b) => b.stats.profit - a.stats.profit)[0];
  return touch({ ...c, phase: 'over', endedReason: reason, winnerId: c.mode === 'blitz' ? (activeDivers(c).length === 1 ? activeDivers(c)[0].id : best?.id ?? null) : null });
}

export interface CampaignScore {
  missions: number;
  successes: number;
  operationsCompleted: number;
  roundsSurvived: number;
  totalEarned: number;
  totalSpent: number;
  profit: number;
}

export function scoreCampaign(c: Campaign): CampaignScore {
  const missions = c.log.length;
  const successes = c.log.filter((m) => m.divers.some((d) => d.outcome === 'extracted')).length;
  const opsDone = c.mode === 'operations' ? new Set(c.log.filter((m) => m.missionInOp === c.rules.missionsPerOperation).map((m) => m.operation)).size : 0;
  return {
    missions,
    successes,
    operationsCompleted: opsDone,
    roundsSurvived: c.mode === 'blitz' ? c.log.filter((m) => m.divers.some((d) => d.status === 'active')).length : 0,
    totalEarned: c.divers.reduce((s, d) => s + d.stats.earned, 0),
    totalSpent: c.divers.reduce((s, d) => s + d.stats.spent, 0),
    profit: c.divers.reduce((s, d) => s + d.stats.profit, 0),
  };
}

/** Cheapest valid loadout at current prices (the guaranteed-free fallback, usually). */
export function cheapestLoadout(faction: Faction, market: MarketState): number[] {
  const out: number[] = [];
  const taken = new Set<number>();
  SLOT_CATEGORIES.forEach((cat) => {
    let best = -1;
    let bestPrice = Infinity;
    for (const it of ITEMS) {
      if (it.category !== cat || !it.tiers[faction] || taken.has(it.index)) continue;
      const p = quote(market, faction, it.index).price;
      if (p < bestPrice || (p === bestPrice && best >= 0 && tierScore(it.tiers[faction]) > tierScore(ITEMS[best].tiers[faction]))) {
        best = it.index;
        bestPrice = p;
      }
    }
    out.push(best);
    if (cat === 'stratagem') taken.add(best);
  });
  return out;
}

/**
 * A random loadout that fits within `limit` Requisition: each slot draws uniformly from what is
 * still affordable after reserving enough for the cheapest options in the remaining slots.
 */
export function randomLoadout(faction: Faction, market: MarketState, limit: number, rng: Rng = new Rng(now())): number[] {
  const price = (i: number) => quote(market, faction, i).price;
  const pools = SLOT_CATEGORIES.map((cat) => ITEMS.filter((it) => it.category === cat && it.tiers[faction]).map((it) => it.index));
  const cheapest = pools.map((pool) => Math.min(...pool.map(price)));
  const order = rng.shuffle([...SLOT_CATEGORIES.keys()]);
  const out = new Array<number>(SLOT_CATEGORIES.length).fill(-1);
  let budget = limit;
  for (let k = 0; k < order.length; k++) {
    const slot = order[k];
    const reserve = order.slice(k + 1).reduce((s, o) => s + cheapest[o], 0);
    const taken = new Set(out.filter((i, s) => i >= 0 && SLOT_CATEGORIES[s] === 'stratagem'));
    const options = pools[slot].filter((i) => !(SLOT_CATEGORIES[slot] === 'stratagem' && taken.has(i)) && price(i) <= budget - reserve);
    const pick = options.length ? rng.pick(options) : pools[slot].filter((i) => !taken.has(i)).sort((a, b) => price(a) - price(b))[0];
    out[slot] = pick;
    budget -= price(pick);
  }
  return out;
}
