/**
 * Campaign actions as plain data. The web app applies them in the browser for a squad sharing one
 * device; the lobby server applies the very same ones for a squad on several devices. Both go
 * through applyAction, so there is one set of rules. parseAction checks untrusted input (a lobby
 * member's request) before any of it reaches the engine.
 */
import { ITEMS } from '../catalog/catalog';
import { FACTIONS, SLOT_CATEGORIES, type Faction } from '../catalog/types';
import type { MarketState, Submission } from '../market/types';
import {
  advance,
  beginDebrief,
  beginLoadout,
  cancelDeploy,
  deploy,
  endCampaign,
  finalizeMission,
  nextOperation,
  setBriefing,
  setLoadout,
  setReady,
  setSlot,
  setSquadPayout,
  type Campaign,
} from './campaign';

export type CampaignAction =
  | { type: 'setBriefing'; faction?: Faction; difficulty?: number }
  | { type: 'beginLoadout' }
  | { type: 'setSlot'; diverId: string; slot: number; index: number | null }
  | { type: 'setLoadout'; diverId: string; items: (number | null)[] }
  | { type: 'setReady'; diverId: string; ready: boolean }
  | { type: 'deploy' }
  | { type: 'cancelDeploy' }
  | { type: 'beginDebrief' }
  /** Operations debrief: the Squad Payout every diver earns, then the mission is settled. */
  | { type: 'reportPayout'; earned: number }
  /** From the deployed screen: the mission failed, which ends an Operations run. */
  | { type: 'reportFailure' }
  | { type: 'advance' }
  | { type: 'nextOperation' }
  | { type: 'standDown'; reason?: string };

export interface ActionResult {
  campaign: Campaign;
  /** Deployed loadouts for the market (only when the campaign contributes). */
  submissions?: Submission[];
  /** Cancelled deploys to take back out of the market queue. */
  withdrawals?: Submission[];
}

export interface ActionContext {
  /** Prices for deploying. */
  market: MarketState;
  /** Recorded with each settled mission. */
  marketDay?: number;
}

/** Applies one action. Throws (with a player-readable message) if it isn't allowed right now. */
export function applyAction(c: Campaign, a: CampaignAction, ctx: ActionContext): ActionResult {
  switch (a.type) {
    case 'setBriefing':
      return { campaign: setBriefing(c, { faction: a.faction, difficulty: a.difficulty }) };
    case 'beginLoadout':
      return { campaign: beginLoadout(c) };
    case 'setSlot':
      return { campaign: setSlot(c, a.diverId, a.slot, a.index) };
    case 'setLoadout':
      return { campaign: setLoadout(c, a.diverId, a.items) };
    case 'setReady':
      return { campaign: setReady(c, a.diverId, a.ready) };
    case 'deploy': {
      const { campaign, submissions } = deploy(c, ctx.market);
      return { campaign, submissions };
    }
    case 'cancelDeploy': {
      const { campaign, withdrawals } = cancelDeploy(c);
      return { campaign, withdrawals };
    }
    case 'beginDebrief':
      return { campaign: beginDebrief(c) };
    case 'reportPayout':
      return { campaign: finalizeMission(setSquadPayout(c.phase === 'deployed' ? beginDebrief(c) : c, a.earned), { marketDay: ctx.marketDay }) };
    case 'reportFailure':
      return { campaign: finalizeMission(setSquadPayout(c.phase === 'deployed' ? beginDebrief(c) : c, 0, 'failed'), { marketDay: ctx.marketDay }) };
    case 'advance':
      return { campaign: advance(c) };
    case 'nextOperation':
      return { campaign: nextOperation(c) };
    case 'standDown':
      return { campaign: endCampaign(c, a.reason) };
  }
}

/** The diver an action is about, for actions a squad member may take on their own diver. Everything else is the host's call. */
export function diverOf(a: CampaignAction): string | null {
  return a.type === 'setSlot' || a.type === 'setLoadout' || a.type === 'setReady' ? a.diverId : null;
}

const isDiverId = (v: unknown): v is string => typeof v === 'string' && /^d[1-4]$/.test(v);
const isItem = (v: unknown, slot: number) => v === null || (Number.isInteger(v) && ITEMS[v as number]?.category === SLOT_CATEGORIES[slot]);

/** Checks an action from an untrusted source. Returns the action, or a message saying what's wrong. */
export function parseAction(raw: unknown): CampaignAction | string {
  const a = raw as Record<string, unknown> | null;
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') return 'An action needs a type.';
  switch (a.type) {
    case 'setBriefing':
      if (a.faction !== undefined && !FACTIONS.includes(a.faction as Faction)) return 'Unknown front.';
      if (a.difficulty !== undefined && !(Number.isInteger(a.difficulty) && (a.difficulty as number) >= 1 && (a.difficulty as number) <= 10)) return 'Difficulty must be 1-10.';
      return { type: 'setBriefing', ...(a.faction !== undefined ? { faction: a.faction as Faction } : {}), ...(a.difficulty !== undefined ? { difficulty: a.difficulty as number } : {}) };
    case 'setSlot':
      if (!isDiverId(a.diverId) || !Number.isInteger(a.slot) || (a.slot as number) < 0 || (a.slot as number) >= SLOT_CATEGORIES.length) return 'Bad slot.';
      if (!isItem(a.index ?? null, a.slot as number)) return 'That item doesn’t go in that slot.';
      return { type: 'setSlot', diverId: a.diverId, slot: a.slot as number, index: (a.index ?? null) as number | null };
    case 'setLoadout':
      if (!isDiverId(a.diverId) || !Array.isArray(a.items) || a.items.length !== SLOT_CATEGORIES.length || !a.items.every((v, s) => isItem(v, s))) return 'Bad loadout.';
      return { type: 'setLoadout', diverId: a.diverId, items: a.items as (number | null)[] };
    case 'setReady':
      if (!isDiverId(a.diverId) || typeof a.ready !== 'boolean') return 'Bad ready state.';
      return { type: 'setReady', diverId: a.diverId, ready: a.ready };
    case 'reportPayout':
      if (!Number.isInteger(a.earned) || (a.earned as number) < 0 || (a.earned as number) > 9_999_999) return 'The Squad Payout must be a whole number.';
      return { type: 'reportPayout', earned: a.earned as number };
    case 'standDown':
      return { type: 'standDown', ...(typeof a.reason === 'string' ? { reason: a.reason.slice(0, 200) } : {}) };
    case 'beginLoadout':
    case 'deploy':
    case 'cancelDeploy':
    case 'beginDebrief':
    case 'reportFailure':
    case 'advance':
    case 'nextOperation':
      return { type: a.type };
    default:
      return `Unknown action "${String(a.type).slice(0, 40)}".`;
  }
}
