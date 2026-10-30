'use client';
import type { Campaign } from '@engine';
import { postFeedback, serverMode } from './api';
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
    await postFeedback({ from: entry.from, kind: entry.kind, version: __BUILD_ID__, questions: entry.questions, payload: entry.payload });
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
