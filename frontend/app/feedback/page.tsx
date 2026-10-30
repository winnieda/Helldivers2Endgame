'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { serverMode } from '@/lib/api';
import { saveFeedback, type FeedbackEntry } from '@/lib/feedback';
import { toast } from '@/lib/toast';

type View = 'choose' | 'detailed' | 'brief';

type Question = { id: string; text: string; kind: 'scale' | 'choice' | 'text'; options?: string[] };

const QUESTIONS: Question[] = [
  { id: 'overall', text: 'How much did you enjoy this session overall?', kind: 'scale' },
  { id: 'rules', text: 'How clear were the rules?', kind: 'scale' },
  { id: 'prices', text: 'Did the prices make sense to you?', kind: 'scale' },
  { id: 'motivated', text: 'Did you feel motivated to use gear you haven’t used often or at all before?', kind: 'choice', options: ['Yes', 'Somewhat', 'No'] },
  { id: 'different', text: 'Did you pick gear that’s different to what you normally take in Helldivers?', kind: 'choice', options: ['Yes', 'Somewhat', 'No'] },
  { id: 'loadouts', text: 'Did you enjoy the loadout(s) you created and played?', kind: 'scale' },
  { id: 'confusing', text: 'Did you find anything in the UI or navigation confusing?', kind: 'text' },
  { id: 'change', text: 'What is the first thing you would change?', kind: 'text' },
  { id: 'bugs', text: 'Anything broken, confusing or surprising?', kind: 'text' },
  { id: 'again', text: 'Do you think you will play Helldivers 2 Galactic Market again, and why?', kind: 'text' },
  { id: 'squad', text: 'Did playing with your squad change what you bought? How?', kind: 'text' },
];

const BRIEF_QUESTIONS: Question[] = [
  { id: 'rating', text: 'How much did you enjoy this session? (1 = not at all, 5 = loved it)', kind: 'scale' },
  { id: 'improved', text: 'Did this improve the experience compared to playing normally?', kind: 'choice' },
  { id: 'text', text: 'Other thoughts, or a bug to report', kind: 'text' },
];

/** The questions as sent with the answers, so the feedback email can spell out the whole form. */
const asked = (qs: Question[]) => qs.map(({ id, text, kind }) => ({ id, text: kind === 'scale' && !text.includes('(1') ? `${text} (1–5)` : text, kind }));

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
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [brief, setBrief] = useState<{ rating: number | null; improved: 'yes' | 'no' | null; text: string }>({ rating: null, improved: null, text: '' });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setFrom(q.get('from') ?? '');
    setNext(q.get('next') || '/play/');
  }, []);

  useEffect(() => {
    router.prefetch(next);
  }, [router, next]);

  const leave = () => router.push(next);
  const [sending, setSending] = useState(false);
  const submit = async (entry: FeedbackEntry) => {
    setSending(true);
    const sent = await saveFeedback(entry);
    if (sent || !serverMode) toast('Thank you!', sent ? 'Your feedback was sent to the team.' : 'Your feedback was saved on this device.', 'good');
    else toast('Feedback not sent', 'We couldn’t reach the server, so it was saved on this device only.', 'warn');
    leave();
  };
  const submitDetailed = () => submit({ at: Date.now(), from, kind: 'detailed', questions: asked(QUESTIONS), payload: answers });
  const submitBrief = () => submit({ at: Date.now(), from, kind: 'brief', questions: asked(BRIEF_QUESTIONS), payload: { rating: brief.rating, improved: brief.improved, text: brief.text } });

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
          {QUESTIONS.map((q) => (
            <div key={q.id}>
              <div className="font-semibold text-text mb-2">{q.text}</div>
              {q.kind === 'scale' && <Scale label={q.text} value={(answers[q.id] as number) ?? null} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />}
              {q.kind === 'choice' && (
                <div className="flex gap-2 flex-wrap">
                  {q.options!.map((o) => (
                    <button key={o} type="button" className="chip chip-toggle" data-on={answers[q.id] === o} onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}>
                      {o}
                    </button>
                  ))}
                </div>
              )}
              {q.kind === 'text' && (
                <textarea className="field min-h-[72px]" value={(answers[q.id] as string) ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} aria-label={q.text} />
              )}
            </div>
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
          <div>
            <div className="font-semibold text-text mb-2">How much did you enjoy this session? (1 = not at all, 5 = loved it)</div>
            <Scale label="Enjoyment" value={brief.rating} onChange={(v) => setBrief((b) => ({ ...b, rating: v }))} />
          </div>
          <div>
            <div className="font-semibold text-text mb-2">Did this improve the experience compared to playing normally?</div>
            <div className="flex gap-2">
              {(['yes', 'no'] as const).map((v) => (
                <button key={v} type="button" className="chip chip-toggle" data-on={brief.improved === v} onClick={() => setBrief((b) => ({ ...b, improved: v }))}>
                  {v === 'yes' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="font-semibold text-text mb-2">Other thoughts, or a bug to report</div>
            <textarea className="field min-h-[110px]" value={brief.text} onChange={(e) => setBrief((b) => ({ ...b, text: e.target.value }))} aria-label="Other thoughts or bug reports" />
          </div>
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
