'use client';
import type { Campaign } from '@engine';
import { store } from './store';

/**
 * Feedback is kept on this device for now (localStorage). When the backend exists it can
 * replace this with a request; the shape stays the same.
 */
const KEY = 'hd2e:feedback:v1';

export interface FeedbackEntry {
  at: number;
  from: string;
  kind: 'detailed' | 'brief' | 'skipped';
  payload?: Record<string, unknown>;
}

export function saveFeedback(entry: FeedbackEntry): void {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as FeedbackEntry[];
    list.push(entry);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* storage unavailable: feedback is dropped quietly */
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
