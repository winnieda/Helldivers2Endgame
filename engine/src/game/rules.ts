export type MissionOutcome = 'extracted' | 'completed' | 'failed';

export interface EconomyRules {
  startingBalance: number;
  /** Balances above this are lost (the in-game Requisition cap). */
  maxBalance: number;
  /**
   * Requisition charged per reinforcement. 0 = reinforcements are free (the current rule); kept as
   * a knob because charging for them is a possible future rule.
   */
  reinforcementCost: number;
  /** Suggested Requisition for a fully successful mission, by difficulty 1-10. */
  earningsByDifficulty: number[];
  /** Fraction of the suggested earnings for each outcome. */
  outcomeMultiplier: Record<MissionOutcome, number>;
  missionsPerOperation: number;
  /** Budget Blitz: most a diver may spend on one round's loadout. */
  blitzSpendCap: number;
  /** Budget Blitz: profit (earned - spent) must exceed this to survive round 1. */
  blitzMargin: number;
  /** Budget Blitz: added to the required margin each round after the first. */
  blitzMarginStep: number;
}

export const DIFFICULTY_NAMES = [
  '',
  'Trivial',
  'Easy',
  'Medium',
  'Challenging',
  'Hard',
  'Extreme',
  'Suicide Mission',
  'Impossible',
  'Helldive',
  'Super Helldive',
] as const;

export const OUTCOME_LABEL: Record<MissionOutcome, string> = {
  extracted: 'Extracted',
  completed: 'Objectives done, no extraction',
  failed: 'Mission failed',
};

export function defaultRules(): EconomyRules {
  return {
    startingBalance: 50000,
    maxBalance: 50000,
    reinforcementCost: 0,
    earningsByDifficulty: [0, 2000, 3000, 4000, 5500, 7000, 8000, 9000, 10000, 11000, 12000],
    outcomeMultiplier: { extracted: 1, completed: 0.6, failed: 0 },
    missionsPerOperation: 3,
    blitzSpendCap: 50000,
    blitzMargin: 0,
    blitzMarginStep: 0,
  };
}

export function suggestedEarnings(rules: EconomyRules, difficulty: number, outcome: MissionOutcome): number {
  const d = Math.max(1, Math.min(10, Math.round(difficulty)));
  return Math.round((rules.earningsByDifficulty[d] * rules.outcomeMultiplier[outcome]) / 50) * 50;
}

/** Required Budget Blitz profit for a given round (1-based). */
export function blitzRequiredMargin(rules: EconomyRules, round: number): number {
  return rules.blitzMargin + rules.blitzMarginStep * Math.max(0, round - 1);
}
