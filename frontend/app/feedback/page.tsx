'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { serverMode } from '@/lib/api';
import { saveFeedback, type FeedbackEntry } from '@/lib/feedback';
import { lobby } from '@/lib/lobby';
import { toast } from '@/lib/toast';

type View = 'choose' | 'detailed' | 'brief';

type Answers = Record<string, string | number>;

type Question = {
  id: string;
  text: string;
  kind: 'scale' | 'choice' | 'select' | 'text' | 'line';
  options?: string[];
  /** Asked only when this holds for the answers so far (e.g. "Other" was chosen). */
  showIf?: (a: Answers) => boolean;
};

const HEARD_OTHER = 'Other (tell us below)';
const HEARD: Question[] = [
  {
    id: 'heard',
    text: 'How did you hear about HD2 Galactic Market?',
    kind: 'select',
    options: ['Reddit', 'Another forum or website', 'Discord', 'YouTube', 'Twitch or another live stream', 'A friend or squadmate', HEARD_OTHER],
  },
  { id: 'heardOther', text: 'Where did you hear about it?', kind: 'line', showIf: (a) => a.heard === HEARD_OTHER },
];

const OWNED: Question = {
  id: 'owned',
  text: 'Did you find your purchases constrained by not owning stratagems or equipment on your account?',
  kind: 'choice',
  options: ['Yes', 'No', 'Not sure', 'N/A: I own all or most equipment'],
};

const QUESTIONS: Question[] = [
  { id: 'overall', text: 'How much did you enjoy this session overall?', kind: 'scale' },
  { id: 'rules', text: 'How clear were the rules?', kind: 'scale' },
  { id: 'prices', text: 'Did the prices make sense to you?', kind: 'scale' },
  { id: 'motivated', text: 'Did you feel motivated to use gear you haven’t used often or at all before?', kind: 'choice', options: ['Yes', 'Somewhat', 'No'] },
  { id: 'different', text: 'Did you pick gear that’s different to what you normally take in Helldivers?', kind: 'choice', options: ['Yes', 'Somewhat', 'No'] },
  { id: 'loadouts', text: 'Did you enjoy the loadout(s) you created and played?', kind: 'scale' },
  OWNED,
  { id: 'confusing', text: 'Did you find anything in the UI or navigation confusing?', kind: 'text' },
  { id: 'change', text: 'What is the first thing you would change?', kind: 'text' },
  { id: 'bugs', text: 'Anything broken, confusing or surprising?', kind: 'text' },
  { id: 'again', text: 'Do you think you will play Helldivers 2 Galactic Market again, and why?', kind: 'text' },
  ...HEARD,
  { id: 'squad', text: 'Did playing with your squad change what you bought? How?', kind: 'text' },
];

const BRIEF_QUESTIONS: Question[] = [
  { id: 'rating', text: 'How much did you enjoy this session? (1 = not at all, 5 = loved it)', kind: 'scale' },
  { id: 'improved', text: 'Did this improve the experience compared to playing normally?', kind: 'choice', options: ['Yes', 'No'] },
  OWNED,
  ...HEARD,
  { id: 'text', text: 'Other thoughts, or a bug to report', kind: 'text' },
];

/** The questions on screen right now: a follow-up shows only while its condition holds. */
const visible = (qs: Question[], a: Answers) => qs.filter((q) => !q.showIf || q.showIf(a));

/**
 * What gets sent: the questions on screen and only their answers. An answer to a follow-up that
 * has since been hidden (say "Other" was picked, typed into, then changed) is left out.
 */
function entryFor(qs: Question[], a: Answers) {
  const shown = visible(qs, a);
  return {
    questions: shown.map(({ id, text, kind }) => ({ id, text: kind === 'scale' && !text.includes('(1') ? `${text} (1–5)` : text, kind: kind === 'line' ? 'text' : kind === 'select' ? 'choice' : kind })),
    payload: Object.fromEntries(shown.map((q) => [q.id, a[q.id] ?? null])),
  };
}

function Field({ q, answers, set }: { q: Question; answers: Answers; set: (id: string, v: string | number) => void }) {
  const value = answers[q.id];
  return (
    <div>
      <label className="block font-semibold text-text mb-2" htmlFor={`q-${q.id}`}>
        {q.text}
      </label>
      {q.kind === 'scale' && <Scale label={q.text} value={(value as number) ?? null} onChange={(v) => set(q.id, v)} />}
      {q.kind === 'choice' && (
        <div className="flex gap-2 flex-wrap">
          {q.options!.map((o) => (
            <button key={o} type="button" className="chip chip-toggle" data-on={value === o} onClick={() => set(q.id, o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      {q.kind === 'select' && (
        <select id={`q-${q.id}`} className="field !w-auto min-w-[280px]" value={(value as string) ?? ''} onChange={(e) => set(q.id, e.target.value)}>
          <option value="" disabled>
            Choose one…
          </option>
          {q.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
      {q.kind === 'text' && <textarea id={`q-${q.id}`} className="field min-h-[72px]" value={(value as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} />}
      {q.kind === 'line' && <input id={`q-${q.id}`} className="field max-w-[520px]" value={(value as string) ?? ''} maxLength={200} onChange={(e) => set(q.id, e.target.value)} />}
    </div>
  );
}

const CHOICES: { id: Exclude<View, 'choose'> | 'skip'; title: string; sub: string }[] = [
  { id: 'detailed', title: 'Give Detailed Feedback', sub: 'Amazing :D! Thank you!' },
  { id: 'brief', title: 'Give Brief Feedback', sub: 'Great!' },
  { id: 'skip', title: 'Skip Feedback', sub: 'All Good' },
];

function Scale({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n)}
          className={`w-12 h-12 border font-display font-bold text-[20px] ${value === n ? 'bg-yellow text-yellow-ink border-yellow' : 'border-line-2 hover:border-muted'}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export default function FeedbackPage() {
  const router = useRouter();
  const [from, setFrom] = useState('');
  const [next, setNext] = useState('/play/');
  const [view, setView] = useState<View>('choose');
  const [answers, setAnswers] = useState<Answers>({});
  const [brief, setBrief] = useState<Answers>({});

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setFrom(q.get('from') ?? '');
    setNext(q.get('next') || '/play/');
  }, []);

  useEffect(() => {
    router.prefetch(next);
  }, [router, next]);

  const leave = () => {
    // In a lobby, the squad waits until everyone has sent or skipped the post-operation form.
    const lob = lobby.get().view;
    if (from === 'operation' && lob?.feedbackPending?.includes(lob.you)) void lobby.lobbyAct({ type: 'lobby.feedbackDone' });
    router.push(next);
  };
  const [sending, setSending] = useState(false);
  const submit = async (entry: FeedbackEntry) => {
    setSending(true);
    const sent = await saveFeedback(entry);
    if (sent || !serverMode) toast('Thank you!', sent ? 'Your feedback was sent to the team.' : 'Your feedback was saved on this device.', 'good');
    else toast('Feedback not sent', 'We couldn’t reach the server, so it was saved on this device only.', 'warn');
    leave();
  };
  const submitDetailed = () => submit({ at: Date.now(), from, kind: 'detailed', ...entryFor(QUESTIONS, answers) });
  const submitBrief = () => submit({ at: Date.now(), from, kind: 'brief', ...entryFor(BRIEF_QUESTIONS, brief) });

  return (
    <div className="mx-auto max-w-[900px] px-4 py-14 rise">
      <h1 className="h-display text-[48px] sm:text-[60px]">
        {view === 'choose' ? 'Would you like to give us feedback?' : view === 'detailed' ? 'Detailed feedback' : 'Brief feedback'}
      </h1>
      <p className="text-[12.5px] text-muted mt-1 mb-6">
        {serverMode ? 'Answers go to the developers. Please don’t include personal information.' : 'Answers are saved on this device only.'}
      </p>

      {view === 'choose' && (
        <div className="grid md:grid-cols-3 gap-4">
          {CHOICES.map((c) => (
            <button
              key={c.id}
              className="choice-card"
              onClick={() => {
                if (c.id === 'skip') {
                  void saveFeedback({ at: Date.now(), from, kind: 'skipped' });
                  leave();
                } else setView(c.id);
              }}
            >
              <div className="h-display text-[26px] leading-tight">{c.title}</div>
              <div className="text-[14px] text-text-2 mt-2">{c.sub}</div>
              <div className="choice-cta">Choose →</div>
            </button>
          ))}
        </div>
      )}

      {view === 'detailed' && (
        <div className="space-y-6">
          {visible(QUESTIONS, answers).map((q) => (
            <Field key={q.id} q={q} answers={answers} set={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} />
          ))}
          <div className="flex justify-between gap-2 pt-2">
            <button className="btn btn-ghost" onClick={() => setView('choose')}>
              Back
            </button>
            <button className="btn btn-primary" onClick={submitDetailed} disabled={sending}>
              Send feedback
            </button>
          </div>
        </div>
      )}

      {view === 'brief' && (
        <div className="space-y-6">
          {visible(BRIEF_QUESTIONS, brief).map((q) => (
            <Field key={q.id} q={q} answers={brief} set={(id, v) => setBrief((a) => ({ ...a, [id]: v }))} />
          ))}
          <div className="flex justify-between gap-2 pt-2">
            <button className="btn btn-ghost" onClick={() => setView('choose')}>
              Back
            </button>
            <button className="btn btn-primary" onClick={submitBrief} disabled={sending}>
              Send feedback
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
