'use client';
import { useEffect, useState } from 'react';
import { beginLoadout, blitzRequiredMargin, DIFFICULTY_NAMES, FACTION_LABEL, FACTIONS, ITEMS, setBriefing, typicalLoadoutCost } from '@engine';
import { store } from '@/lib/store';
import { saveRoster } from '@/lib/roster';
import { endRun, feedbackUrl } from '@/lib/feedback';
import { useRouter } from 'next/navigation';
import { FactionEmblem, ItemIcon } from '../icons';
import { Modal, Req } from '../ui';
import { useCampaign } from './useCampaign';

export function Briefing() {
  const router = useRouter();
  // Warm the feedback page so leaving the run shows it immediately.
  useEffect(() => {
    router.prefetch("/feedback/");
  }, [router]);
  const { campaign: c, apply, app } = useCampaign();
  const [confirm, setConfirm] = useState(false);
  const [cancel, setCancel] = useState(false);
  if (!c) return null;
  const market = app.market;
  const isOps = c.mode === 'operations';
  const margin = blitzRequiredMargin(c.rules, c.round);
  const fresh = c.log.length === 0;

  const diffButton = (d: number, big = false) => {
    const on = d === c.difficulty;
    return (
      <button
        key={d}
        onClick={() => apply((x) => setBriefing(x, { difficulty: d }))}
        className={`border text-center transition-colors ${big ? 'py-4 px-5 flex items-center justify-between gap-4 text-left w-full' : 'py-2.5 px-1'} ${on ? 'bg-yellow text-yellow-ink border-yellow' : 'border-line-2 hover:border-muted'}`}
        aria-pressed={on}
      >
        {big ? (
          <>
            <span className="flex items-baseline gap-3">
              <span className="h-display text-[40px] leading-none">10</span>
              <span className="h-display text-[28px] leading-none">Super Helldive</span>
            </span>
            <span className={`chip ${on ? '!text-yellow-ink !border-yellow-ink/50 !bg-black/10' : '!text-yellow !border-yellow/60'}`}>Recommended</span>
          </>
        ) : (
          <>
            <div className="h-display text-[26px]">{d}</div>
            <div className={`text-[10.5px] uppercase tracking-wide leading-tight ${on ? 'text-yellow-ink/80' : 'text-muted'}`}>{DIFFICULTY_NAMES[d]}</div>
          </>
        )}
      </button>
    );
  };

  return (
    <div className="rise">
      <div className="eyebrow text-yellow">{isOps ? `Operation ${c.operation} · briefing` : `Round ${c.round} · briefing`}</div>
      <h1 className="h-display text-[44px] sm:text-[56px]">{isOps ? c.operationName : `Budget Blitz — round ${c.round}`}</h1>
      <p className="text-text-2 mt-1">
        {isOps
          ? 'Pick the front and difficulty you’ll play in Helldivers 2. All three missions of the operation are fought there, at that front’s prices.'
          : `Pick this round’s front and difficulty. To survive the round, each Helldiver must earn more than they spend${margin > 0 ? ` plus ${margin.toLocaleString()}` : ''}.`}
      </p>

      <div className="mt-8 grid md:grid-cols-3 gap-4">
        {FACTIONS.map((f) => {
          const on = c.faction === f;
          const free = market.books[f].free.map((i) => ITEMS[i]);
          return (
            <button
              key={f}
              onClick={() => apply((x) => setBriefing(x, { faction: f }))}
              className="panel p-5 text-left transition-colors hover:bg-white/[0.02] flex flex-col"
              style={on ? { borderColor: `var(--${f})`, background: `color-mix(in srgb, var(--${f}) 7%, transparent)` } : undefined}
              aria-pressed={on}
            >
              <div className="flex items-center gap-3">
                <FactionEmblem faction={f} size={48} />
                <div className="h-display text-[30px]" style={on ? { color: `var(--${f})` } : undefined}>
                  {FACTION_LABEL[f]}
                </div>
              </div>
              <div className="mt-4 text-[13px] text-muted" title="What the community's average loadout costs on this front today">
                Average loadout price <Req value={typicalLoadoutCost(market, f)} className="text-text" />
              </div>
              <div className="mt-3 pt-3 border-t border-line/70">
                <div className="eyebrow !text-good mb-1.5">Free today</div>
                <div className="flex gap-1.5">
                  {free.map((it) => (
                    <span key={it.index} title={it.name}>
                      <ItemIcon item={it} size={40} />
                    </span>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 panel p-5">
        <div className="font-display font-bold uppercase tracking-wider text-[18px]">Difficulty</div>
        <div className="mt-4">{diffButton(10, true)}</div>
        <div className="mt-2 grid grid-cols-3 sm:grid-cols-9 gap-1.5">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => diffButton(d))}</div>
        <div className="text-[12.5px] text-muted mt-3">HD2 Galactic Market works on every difficulty, but it’s built and balanced for Super Helldive.</div>
      </div>

      <div className="mt-6 flex justify-between gap-3 flex-wrap">
        {fresh ? (
          <button
            className="btn btn-ghost"
            onClick={() => {
              // Keep the same Helldivers, in the same order, for the setup screen.
              saveRoster(c.divers.map((d) => d.name));
              store.setCampaign(null);
            }}
          >
            Return to Squad Setup
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => setCancel(true)}>
            Stand down
          </button>
        )}
        <button className="btn btn-primary btn-lg" onClick={() => setConfirm(true)}>
          Begin Campaign →
        </button>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Confirm deployment orders">
        <div className="flex items-center gap-4">
          <FactionEmblem faction={c.faction} size={56} />
          <p className="text-text-2 text-[16px]">
            Your squad will fight the <span className="text-text font-semibold">{FACTION_LABEL[c.faction]}</span> on{' '}
            <span className="text-text font-semibold">
              {DIFFICULTY_NAMES[c.difficulty]} ({c.difficulty})
            </span>
            {isOps ? ' for all three missions of this operation.' : ' this round.'}
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
            Change
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setConfirm(false);
              apply(beginLoadout);
            }}
          >
            Confirm
          </button>
        </div>
      </Modal>

      <Modal open={cancel} onClose={() => setCancel(false)} title="Stand down?">
        <p className="text-text-2 text-[15.5px]">The campaign ends here and goes into the hall of fame as it stands.</p>
        <div className="mt-6 flex justify-end gap-2">
          <button data-autofocus className="btn btn-ghost" onClick={() => setCancel(false)}>
            Keep going
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              setCancel(false);
              endRun(c);
              router.push(feedbackUrl('standdown'));
            }}
          >
            Stand down
          </button>
        </div>
      </Modal>
    </div>
  );
}
