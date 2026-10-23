/**
 * One-off synthetic traffic for a live market: N squads of rule-based divers each buy one
 * loadout at today's prices. This is what the terminal's `sim squads` and the CLI's
 * `market simulate` use to feed the pending queue between manual `market update`s (the web
 * equivalent of the prototype's "100 Simulations" menu option).
 */
import { FACTIONS, type Faction } from '../catalog/types';
import { defaultRules, type EconomyRules } from '../game/rules';
import { quote } from '../market/free';
import { AVAILABLE, ITEMS } from '../catalog/catalog';
import type { MarketState, Submission } from '../market/types';
import { clamp } from '../util/math';
import { Rng } from '../util/rng';
import { ARCHETYPES, chooseLoadout, makeAgent, World, type ArchetypeId, type ChoiceContext } from './agents';

export interface SyntheticOptions {
  squads: number;
  seed?: number | string;
  population?: Partial<Record<ArchetypeId, number>>;
  factionMix?: Partial<Record<Faction, number>>;
  rules?: EconomyRules;
}

const DEFAULT_MIX: Partial<Record<ArchetypeId, number>> = { regular: 40, meta: 20, thrifty: 15, niche: 10, loyalist: 10, chaos: 5 };

export function generateSubmissions(state: MarketState, opts: SyntheticOptions): Submission[] {
  const rng = new Rng(opts.seed ?? `${state.day}:${Date.now()}`);
  const rules = opts.rules ?? defaultRules();
  const world = new World(new Rng('synthetic-world'));
  const mix = opts.population ?? DEFAULT_MIX;
  const factionMix = (opts.factionMix ?? { terminids: 40, automatons: 35, illuminate: 25 }) as Record<Faction, number>;
  const out: Submission[] = [];
  const views = Object.fromEntries(
    FACTIONS.map((f) => {
      const price = new Float64Array(ITEMS.length);
      const niche = new Float64Array(ITEMS.length);
      for (const c of ['stratagem', 'primary', 'secondary', 'throwable'] as const) {
        const fair = 1 / AVAILABLE[f][c].length;
        for (const it of AVAILABLE[f][c]) {
          price[it.index] = quote(state, f, it.index).price;
          niche[it.index] = clamp(-Math.log(Math.max(state.books[f].items[it.index]!.share, 1e-9) / fair), 0, 3);
        }
      }
      return [f, { price, niche }];
    }),
  ) as Record<Faction, { price: Float64Array; niche: Float64Array }>;

  for (let s = 0; s < opts.squads; s++) {
    const faction = rng.weightedKey(factionMix);
    const squadPicks = new Int32Array(ITEMS.length);
    const ctx: ChoiceContext = {
      faction,
      price: views[faction].price,
      strength: world.strength[faction],
      niche: views[faction].niche,
      squad: squadPicks,
      rng,
      expectedIncome: rules.earningsByDifficulty[9] * 0.75,
      maxBalance: rules.maxBalance,
    };
    for (let k = 0; k < 4; k++) {
      const arch = ARCHETYPES[rng.weightedKey(mix)];
      const agent = makeAgent(k, arch, rng, rules.startingBalance, world);
      agent.balance = Math.round(rng.range(0.1, 1) * rules.maxBalance);
      const { items, paid } = chooseLoadout(agent, ctx);
      items.forEach((i) => squadPicks[i]++);
      out.push({ faction, items, paid, origin: 'sim', mode: 'operations', at: Date.now() });
    }
  }
  return out;
}
