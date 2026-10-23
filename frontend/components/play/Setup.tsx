'use client';
import { useState } from 'react';
import { createCampaign, type GameMode } from '@engine';
import { DIVER_COLORS, req } from '@/lib/format';
import { store } from '@/lib/store';
import { toast } from '@/lib/toast';
import { Check } from '../icons';

const DEFAULT_NAMES = ['', '', '', ''];
const PLACEHOLDERS = ['Helldiver 1', 'Helldiver 2', 'Helldiver 3', 'Helldiver 4'];

export function Setup({ initialMode }: { initialMode: GameMode }) {
  const [mode, setMode] = useState<GameMode>(initialMode);
  const [names, setNames] = useState<string[]>(DEFAULT_NAMES.slice(0, 1));
  const [share, setShare] = useState(true);
  const [margin, setMargin] = useState(0);
  const [escalation, setEscalation] = useState(0);

  const start = () => {
    const finalNames = names.map((n, i) => n.trim() || PLACEHOLDERS[i]);
    try {
      const c = createCampaign({
        mode,
        names: finalNames,
        contributeToMarket: share,
        rules: mode === 'blitz' ? { blitzMargin: margin, blitzMarginStep: escalation } : {},
      });
      store.setCampaign(c);
      toast(c.operationName, `${finalNames.length} Helldiver${finalNames.length > 1 ? 's' : ''} reporting for duty.`, 'good');
    } catch (e) {
      toast('Cannot start', (e as Error).message, 'bad');
    }
  };

  const modes: { id: GameMode; title: string; tag: string; text: string; facts: string[] }[] = [
    {
      id: 'operations',
      title: 'Operations',
      tag: 'Endurance · co-op',
      text: 'Back-to-back three-mission operations. Balances carry over (cap 50,000). Reinforcements cost Requisition. Drop below zero and you’re out.',
      facts: ['Start with 50,000', 'Earnings cap at 50,000', '250 per reinforcement'],
    },
    {
      id: 'blitz',
      title: 'Budget Blitz',
      tag: 'Elimination · competitive',
      text: 'Each round, lock in a loadout and earn more than it cost (plus reinforcements). Anyone who doesn’t is eliminated. Last Helldiver standing wins.',
      facts: ['Up to 50,000 per round', 'Profit or perish', 'Solo: longest streak'],
    },
  ];

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-12 rise">
      <div className="eyebrow text-yellow">New campaign</div>
      <h1 className="h-display text-[52px] sm:text-[64px]">Assemble your squad</h1>
      <p className="text-text-2 max-w-2xl mt-2">
        Everything happens on this device: pass it around (or sit together) — each Helldiver gets their own balance and loadout. Play your missions in Helldivers 2 as normal and report back here.
      </p>

      <div className="mt-8 grid md:grid-cols-2 gap-4">
        {modes.map((m) => {
          const on = m.id === mode;
          return (
            <button key={m.id} onClick={() => setMode(m.id)} className={`panel text-left p-6 transition-colors ${on ? 'panel-accent bg-yellow/[0.04]' : 'hover:bg-white/[0.02]'}`} aria-pressed={on}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="eyebrow">{m.tag}</div>
                  <div className={`h-display text-[38px] mt-1 ${on ? 'text-yellow' : ''}`}>{m.title}</div>
                </div>
                <span className={`w-7 h-7 grid place-items-center border ${on ? 'bg-yellow text-yellow-ink border-yellow' : 'border-line-2 text-transparent'}`}>
                  <Check />
                </span>
              </div>
              <p className="text-text-2 mt-2">{m.text}</p>
              <div className="flex gap-2 flex-wrap mt-4">
                {m.facts.map((f) => (
                  <span key={f} className="chip">
                    {f}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid lg:grid-cols-[1.3fr_1fr] gap-4">
        <div className="panel p-6">
          <div className="flex items-center justify-between">
            <div className="font-display font-bold uppercase tracking-wider text-[18px]">Squad roster</div>
            <span className="text-muted text-[13px]">{names.length} / 4</span>
          </div>
          <div className="mt-4 space-y-2">
            {names.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2 self-stretch" style={{ background: DIVER_COLORS[i] }} />
                <input
                  className="field"
                  value={n}
                  maxLength={24}
                  placeholder={PLACEHOLDERS[i]}
                  onChange={(e) => setNames((ns) => ns.map((x, k) => (k === i ? e.target.value : x)))}
                  onKeyDown={(e) => e.key === 'Enter' && start()}
                  aria-label={`Helldiver ${i + 1} name`}
                />
                {names.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setNames((ns) => ns.filter((_, k) => k !== i))} aria-label={`Remove Helldiver ${i + 1}`}>
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {names.length < 4 && (
            <button className="btn btn-ghost btn-sm mt-3" onClick={() => setNames((ns) => [...ns, ''])}>
              + Add Helldiver
            </button>
          )}
          <div className="mt-5 text-[13px] text-muted">Squad lobbies with join codes come later; for now the whole squad shares this browser.</div>
        </div>

        <div className="panel p-6 flex flex-col">
          <div className="font-display font-bold uppercase tracking-wider text-[18px]">Rules of engagement</div>
          <label className="mt-4 flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1 accent-[var(--yellow)] w-4 h-4" />
            <span>
              <span className="font-semibold">Contribute to the Galactic Market</span>
              <span className="block text-[13px] text-muted">Deployed loadouts are counted (anonymously) toward the next price update.</span>
            </span>
          </label>
          {mode === 'blitz' && (
            <div className="mt-5 space-y-4">
              <div>
                <div className="flex justify-between text-[14px]">
                  <span>Required profit per round</span>
                  <span className="tnum text-yellow">{req(margin)}</span>
                </div>
                <input type="range" min={0} max={5000} step={250} value={margin} onChange={(e) => setMargin(+e.target.value)} aria-label="Required profit per round" />
              </div>
              <div>
                <div className="flex justify-between text-[14px]">
                  <span>Escalation each round</span>
                  <span className="tnum text-yellow">+{req(escalation)}</span>
                </div>
                <input type="range" min={0} max={3000} step={250} value={escalation} onChange={(e) => setEscalation(+e.target.value)} aria-label="Escalation each round" />
                <div className="text-[12.5px] text-muted">Raise the bar every round so even all-free loadouts eventually crack.</div>
              </div>
            </div>
          )}
          <div className="flex-1" />
          <button className="btn btn-primary btn-lg mt-6 w-full" onClick={start}>
            Begin {mode === 'operations' ? 'operation' : 'blitz'}
          </button>
        </div>
      </div>
    </div>
  );
}
