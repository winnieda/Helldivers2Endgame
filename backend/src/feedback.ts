/**
 * Player feedback from the site's debrief form. Every entry is saved as 'feedback/<day>/<id>';
 * detailed and brief ones are also emailed through a Notifier (SNS on AWS, the console locally),
 * at most EMAILS_PER_DAY a day so a flood can't bury the inbox. Entries past the cap are still saved.
 */
import { randomBytes } from 'crypto';
import { ConflictError, type Storage } from './storage';

export type FeedbackKind = 'detailed' | 'brief' | 'skipped';
export type FeedbackValue = string | number | boolean | null;

/** A question as the form showed it, so the email still makes sense if the form changes. */
export interface FeedbackQuestion {
  id: string;
  text: string;
  kind?: 'scale' | 'choice' | 'text';
}

export interface Feedback {
  /** Server time, ms. */
  at: number;
  /** Where the player came from (the page's `from` parameter). */
  from: string;
  /** The site build the player was on (the footer's "Build ..."). */
  version?: string;
  kind: FeedbackKind;
  payload?: Record<string, FeedbackValue>;
  /** The form's questions in order, answered or not. */
  questions?: FeedbackQuestion[];
}

export interface Notifier {
  send(subject: string, text: string): Promise<void>;
}

/** Stands in for email when there's no topic: the local server prints what would be sent. */
export const consoleNotifier: Notifier = {
  async send(subject, text) {
    console.log(`[feedback email] ${subject}\n${text}`);
  },
};

/** Gmail filters sort on this. */
export const SUBJECT_TAG = '[H2E Feedback Email]';
export const EMAILS_PER_DAY = 50;

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

/** SNS subjects must be ASCII without control characters and under 100 characters. */
const ascii = (s: string, max: number) => s.replace(/[^\x20-\x7e]/g, '').trim().slice(0, max);

export function subjectOf(f: Feedback): string {
  const rating = f.payload?.rating ?? f.payload?.overall;
  const parts = [f.kind === 'detailed' ? 'Detailed' : 'Brief'];
  if (typeof rating === 'number') parts.push(`${rating}/5`);
  if (f.from) parts.push(`from ${ascii(f.from, 30)}`);
  return ascii(`${SUBJECT_TAG} ${parts.join(' - ')}`, 99);
}

/** Where the form was opened from (the page's `from` parameter), in words. */
const FROM: Record<string, string> = {
  operation: 'after finishing an operation (all three missions)',
  standdown: 'after standing down (ending a campaign)',
  abandon: 'after abandoning a campaign in the armory',
  header: 'from the Feedback button in the site header',
};

const answerOf = (v: FeedbackValue | undefined, kind?: string): string => {
  if (v === undefined || v === null || v === '') return '(no answer)';
  if (kind === 'scale' && typeof v === 'number') return `${v} / 5`;
  return String(v);
};

/**
 * The email body. It spells out every question the form asked, answered or not, so the email
 * alone is enough to know what the player was shown.
 */
export function textOf(f: Feedback, key: string): string {
  const lines = [
    `${f.kind === 'detailed' ? 'DETAILED' : 'BRIEF'} FEEDBACK FORM`,
    `Sent:  ${new Date(f.at).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
    `Where: ${f.from ? `${FROM[f.from] ?? 'opened from an unrecognised place'} (from=${f.from})` : 'unknown'}`,
    `Build: ${f.version || 'unknown'}`,
    '',
  ];
  const payload = f.payload ?? {};
  const asked = new Set<string>();
  (f.questions ?? []).forEach((q, i) => {
    asked.add(q.id);
    lines.push(`${i + 1}. ${q.text}`, `   ${answerOf(payload[q.id], q.kind).replace(/\n/g, '\n   ')}`, '');
  });
  // Answers without a question (an older form, or one that sent no questions).
  for (const [k, v] of Object.entries(payload)) {
    if (asked.has(k) || v === null || v === '') continue;
    lines.push(`${k}:`, `   ${String(v).replace(/\n/g, '\n   ')}`, '');
  }
  lines.push(`Saved as ${key} in the data bucket.`);
  return lines.join('\n');
}

/** Counts one email against today's cap; false once the cap is reached. */
async function takeEmailSlot(storage: Storage, today: string): Promise<boolean> {
  const key = `feedback-count/${today}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await storage.get(key);
    const emails = cur ? (JSON.parse(cur.body) as { emails: number }).emails : 0;
    if (emails >= EMAILS_PER_DAY) return false;
    try {
      await storage.put(key, JSON.stringify({ emails: emails + 1 }), cur ? cur.etag : null);
      return true;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  return false;
}

/** Saves the entry, then emails it if it has content and today's cap allows. A failed email is logged, not thrown. */
export async function recordFeedback(storage: Storage, notifier: Notifier, f: Feedback): Promise<{ saved: true; emailed: boolean }> {
  const key = `feedback/${day(f.at)}/${f.at.toString(36)}-${randomBytes(4).toString('hex')}`;
  await storage.put(key, JSON.stringify(f));
  if (f.kind === 'skipped' || !(await takeEmailSlot(storage, day(f.at)))) return { saved: true, emailed: false };
  try {
    await notifier.send(subjectOf(f), textOf(f, key));
    return { saved: true, emailed: true };
  } catch (e) {
    console.error('Feedback email failed:', e);
    return { saved: true, emailed: false };
  }
}
