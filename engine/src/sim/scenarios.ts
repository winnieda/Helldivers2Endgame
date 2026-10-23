import type { Faction, Tier } from '../catalog/types';
import type { PresetId, PresetOptions } from '../market/presets';
import type { ArchetypeId } from './agents';

export type ScenarioEvent =
  | { day: number; type: 'patch'; label: string; changes: { item: string; tier: Tier; faction?: Faction }[] }
  | { day: number; type: 'factionMix'; label: string; mix: Record<Faction, number> }
  | { day: number; type: 'traffic'; label: string; squadsPerDay: number }
  | { day: number; type: 'recruits'; label: string; add: Partial<Record<ArchetypeId, number>> }
  | { day: number; type: 'brigade'; label: string; items: string[]; loadoutsPerDay: number; until?: number };

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** What a healthy market should do here, in plain words. */
  expectation: string;
  days: number;
  squadsPerDay: number;
  preset: PresetId;
  presetOptions?: PresetOptions;
  /** Relative archetype weights for the starting population. */
  population: Partial<Record<ArchetypeId, number>>;
  factionMix: Record<Faction, number>;
  events?: ScenarioEvent[];
  /** SD of hidden strength noise around the tier lists. */
  strengthNoise?: number;
}

const MIXED: Partial<Record<ArchetypeId, number>> = { regular: 40, meta: 20, thrifty: 15, niche: 10, loyalist: 10, chaos: 5 };
const FACTIONS_NORMAL: Record<Faction, number> = { terminids: 40, automatons: 35, illuminate: 25 };

const base = {
  days: 120,
  squadsPerDay: 60,
  preset: 'tiers' as PresetId,
  population: MIXED,
  factionMix: FACTIONS_NORMAL,
};

export const SCENARIOS: Scenario[] = [
  {
    ...base,
    id: 'baseline',
    name: 'Launch',
    description: 'A mixed playerbase starts from tier-list prices and plays for four months.',
    expectation: 'Prices settle without drifting; meta gear stays pricey, niche gear stays cheap.',
  },
  {
    ...base,
    id: 'equal-start',
    name: 'Blank Slate',
    preset: 'equal',
    description: 'Every item starts at its baseline price. No hints from the tier list.',
    expectation: 'The market discovers the meta on its own: price should come to track item strength.',
  },
  {
    ...base,
    id: 'inverted-start',
    name: 'Upside Down',
    preset: 'tiers-inverted',
    description: 'Meta gear starts dirt cheap and junk starts expensive.',
    expectation: 'Within a few weeks the ordering flips to meta-expensive, niche-cheap.',
  },
  {
    ...base,
    id: 'random-start',
    name: 'Static Noise',
    preset: 'random',
    presetOptions: { seed: 7 },
    description: 'Random starting prices.',
    expectation: 'Converges to the same shape as Launch.',
  },
  {
    ...base,
    id: 'meta-rush',
    name: 'Meta Rush',
    population: { meta: 65, regular: 20, loyalist: 15 },
    description: 'Most divers chase the strongest gear regardless of cost.',
    expectation: 'Meta prices climb but stay under the soft ceiling; nothing runs away.',
  },
  {
    ...base,
    id: 'penny-pinchers',
    name: 'Penny-Pinchers',
    population: { thrifty: 60, regular: 25, niche: 15 },
    description: 'A frugal playerbase that leans on free and cheap picks.',
    expectation: 'Paid gear gets cheaper but does not collapse to the floor.',
  },
  {
    ...base,
    id: 'niche-lovers',
    name: 'Off the Beaten Path',
    population: { niche: 50, regular: 30, chaos: 20 },
    description: 'Lots of divers deliberately run unpopular gear.',
    expectation: 'Prices flatten out (usage is spread), still bounded and stable.',
  },
  {
    ...base,
    id: 'balance-patch',
    name: 'Balance Patch',
    description: 'On day 60 three junk items get buffed to top tier and three meta items get nerfed.',
    expectation: 'Buffed items climb above their category median and nerfed ones fall below it within a few weeks.',
    events: [
      {
        day: 60,
        type: 'patch',
        label: 'Patch: One True Flag, Liberator Concussive, Throwing Knife buffed; Orbital Laser, Eruptor, Thermite nerfed',
        changes: [
          { item: 'cqc-1-one-true-flag', tier: 'S+' },
          { item: 'ar-23c-liberator-concussive', tier: 'S+' },
          { item: 'k-2-throwing-knife', tier: 'S' },
          { item: 'orbital-laser', tier: 'C' },
          { item: 'r-36-eruptor', tier: 'C' },
          { item: 'g-123-thermite', tier: 'C' },
        ],
      },
    ],
  },
  {
    ...base,
    id: 'major-order',
    name: 'Major Order',
    description: 'From day 40 to 80, 85% of the playerbase fights Automatons.',
    expectation: 'Starved faction markets hold steady instead of drifting on thin data.',
    events: [
      { day: 40, type: 'factionMix', label: 'Major Order: everyone to the Automaton front', mix: { terminids: 8, automatons: 85, illuminate: 7 } },
      { day: 80, type: 'factionMix', label: 'Major Order complete', mix: FACTIONS_NORMAL },
    ],
  },
  {
    ...base,
    id: 'low-traffic',
    name: 'Quiet Week',
    squadsPerDay: 3,
    description: 'Only three squads a day (36 loadouts) feed the market.',
    expectation: 'Small, noisy batches move prices slowly instead of whipsawing them.',
  },
  {
    ...base,
    id: 'surge',
    name: 'Warbond Launch Surge',
    description: 'Traffic jumps 6x on day 30 with a wave of meta-chasing recruits, then subsides on day 45.',
    expectation: 'Prices react to the surge but recover; no permanent inflation.',
    events: [
      { day: 30, type: 'traffic', label: 'Traffic x6', squadsPerDay: 360 },
      { day: 30, type: 'recruits', label: 'Recruit wave', add: { meta: 500, regular: 300 } },
      { day: 45, type: 'traffic', label: 'Traffic back to normal', squadsPerDay: 60 },
    ],
  },
  {
    ...base,
    id: 'brigade',
    name: 'Brigading',
    description: 'From day 20 to 75 a coordinated group submits 150 loadouts a day (about a sixth of all traffic) with the One True Flag and Directional Shield.',
    expectation: 'The brigaded items rise but stay below the soft ceiling, then come back down once the spam stops.',
    events: [
      { day: 20, type: 'brigade', label: 'Brigade starts', items: ['cqc-1-one-true-flag', 'sh-51-directional-shield'], loadoutsPerDay: 150, until: 75 },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
