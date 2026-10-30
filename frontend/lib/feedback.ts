'use client';
import { DIFFICULTY_NAMES, FACTION_LABEL, scoreCampaign, type Campaign } from '@engine';
import { postFeedback, serverMode } from './api';
import { lobby } from './lobby';
import { store } from './store';

/**
 * Feedback is kept on this device (localStorage) and, when the site runs against the server, also
 * sent there, which emails it to the developers.
 */
const KEY = 'hd2e:feedback:v1';

export interface FeedbackEntry {
  at: number;
  from: string;
  kind: 'detailed' | 'brief' | 'skipped';
  /** The questions the form showed, in order (sent so the email can list them). */
  questions?: { id: string; text: string; kind: string }[];
  payload?: Record<string, unknown>;
}

/**
 * What the site already knows about the session, sent along with feedback so it can be read in
 * context without asking: how the squad plays, how far the campaign got, and the screen size.
 * Nothing that identifies anyone.
 */
export function feedbackContext(): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const { view } = lobby.get();
  const app = store.get();
  const c: Campaign | null = view ? view.campaign : app.campaign;
  out['Play mode'] = view ? 'Online lobby' : 'Offline lobby (one device)';
  if (view) {
    out['Players in lobby'] = view.members.length;
    out['Players online now'] = view.members.filter((m) => m.online).length;
    out['Role'] = view.hostId === view.you ? 'Host' : 'Squad member';
  }
  // Standing down archives the campaign first; the record just written still describes it.
  const last = !c && app.records[0] && Date.now() - app.records[0].finishedAt < 3_600_000 ? app.records[0] : null;
  if (c) {
    out['Squad size'] = c.divers.length;
    out['Game mode'] = c.mode === 'operations' ? 'Operations' : 'Budget Blitz';
    out['Campaign'] = c.phase === 'over' ? `Over: ${c.endedReason ?? 'ended'}` : `Operation ${c.operation}, mission ${c.missionInOp} (${c.phase})`;
    out['Missions played'] = c.log.length;
    out['Operations completed'] = scoreCampaign(c).operationsCompleted;
    out['Front'] = FACTION_LABEL[c.faction];
    out['Difficulty'] = `${DIFFICULTY_NAMES[c.difficulty]} (${c.difficulty})`;
    out['Contributing to the market'] = c.contributeToMarket;
  } else if (last) {
    out['Squad size'] = last.names.length;
    out['Campaign'] = `Just ended: ${last.reason}`;
    out['Missions played'] = last.missions;
    out['Operations completed'] = last.operations;
  } else out['Campaign'] = 'None in progress';
  out['Market day'] = app.market.day;
  out['Screen'] = `${window.innerWidth}×${window.innerHeight}`;
  return out;
}

/** Saves the entry on this device, then sends it to the server. Resolves true if the server got it. */
export async function saveFeedback(entry: FeedbackEntry): Promise<boolean> {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as FeedbackEntry[];
    list.push(entry);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* storage unavailable: only the server copy is kept */
  }
  if (!serverMode) return false;
  try {
    await postFeedback({ from: entry.from, kind: entry.kind, version: __BUILD_ID__, questions: entry.questions, payload: entry.payload, context: feedbackContext() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops the campaign the player is in. A campaign with no missions is simply discarded; one with
 * missions goes into the hall of fame as it stands.
 */
export function endRun(c: Campaign): void {
  if (c.log.length === 0) store.setCampaign(null);
  else store.archiveCampaign(c);
}

/** Where the feedback page should send the player afterwards. */
export function feedbackUrl(from: string, next = '/play/'): string {
  return `/feedback/?from=${encodeURIComponent(from)}&next=${encodeURIComponent(next)}`;
}

/** After each completed operation every player gets the feedback form once (in a lobby, each on their own device). */
const opKey = (c: Campaign) => `hd2e:op-feedback:${c.id}:${c.operation}`;

export function markOperationFeedback(c: Campaign): void {
  try {
    localStorage.setItem(opKey(c), '1');
  } catch {
    /* storage unavailable */
  }
}

export function operationFeedbackDue(c: Campaign): boolean {
  try {
    return c.phase === 'intermission' && !localStorage.getItem(opKey(c));
  } catch {
    return false;
  }
}
