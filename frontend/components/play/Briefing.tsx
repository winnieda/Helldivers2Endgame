'use client';
import { beginLoadout, DIFFICULTY_NAMES, FACTION_LABEL, FACTIONS, ITEMS, setBriefing, suggestedEarnings, typicalLoadoutCost, blitzRequiredMargin } from '@engine';
import { FACTION_BLURB } from '@/lib/format';
import { FactionEmblem } from '../icons';
import { Req } from '../ui';
import { useCampaign } from './useCampaign';

export function Briefing() {
  const { campaign: c, apply, app } = useCampaign();
  if (!c) return null;
  const market = app.market;
  const isOps = c.mode === 'operations';
  const margin = blitzRequiredMargin(c.rules, c.round);

  return (
    <div className="rise">
      <div className="eyebrow text-yellow">{isOps ? `Operation ${c.operation} · briefing` : `Round ${c.round} · briefing`}</div>
      <h1 className="h-display text-[44px] sm:text-[56px]">{isOps ? c.operationName : `Budget Blitz — round ${c.round}`}</h1>
      <p className="text-text-2 mt-1 max-w-2xl">
        {isOps
          ? 'Pick the front and difficulty you’ll play in Helldivers 2. All three missions of the operation are fought there — and every price is set by that front’s own market.'
          : `Pick this round’s front and difficulty. To survive the round, each Helldiver must earn more than they spend${margin > 0 ? ` plus ${margin.toLocaleString()}` : ''}.`}
      </p>

      <div className="mt-8 grid md:grid-cols-3 gap-4">
        {FACTIONS.map((f) => {
          const on = c.faction === f;
          const free = market.books[f].free.map((i) => ITEMS[i].short);
          return (
            <button
              key={f}
              onClick={() => apply((x) => setBriefing(x, { faction: f }))}
              className="panel p-5 text-left transition-colors hover:bg-white/[0.02]"
              style={on ? { borderColor: `var(--${f})`, background: `color-mix(in srgb, var(--${f}) 7%, transparent)` } : undefined}
              aria-pressed={on}
            >
              <div className="flex items-center gap-3">
                <FactionEmblem faction={f} size={44} />
                <div className="h-display text-[30px]" style={on ? { color: `var(--${f})` } : undefined}>
                  {FACTION_LABEL[f]}
                </div>
              </div>
              <p className="text-text-2 text-[14px] mt-3 min-h-[42px]">{FACTION_BLURB[f]}</p>
              <div className="mt-3 text-[13px] text-muted">
                Typical loadout <Req value={typicalLoadoutCost(market, f)} className="text-text" />
              </div>
              <div className="mt-1 text-[13px] text-muted truncate">
                Free: <span className="text-good">{free.join(', ')}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 panel p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="font-display font-bold uppercase tracking-wider text-[18px]">Difficulty</div>
          <div className="text-[14px] text-muted">
            Suggested pay for a clean extraction: <Req value={suggestedEarnings(c.rules, c.difficulty, 'extracted')} className="text-yellow font-semibold" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-5 sm:grid-cols-10 gap-1.5">
          {Array.from({ length: 10 }, (_, k) => k + 1).map((d) => {
            const on = d === c.difficulty;
            return (
              <button
                key={d}
                onClick={() => apply((x) => setBriefing(x, { difficulty: d }))}
                className={`py-2.5 px-1 border text-center transition-colors ${on ? 'bg-yellow text-yellow-ink border-yellow' : 'border-line-2 hover:border-muted'}`}
                aria-pressed={on}
              >
                <div className="h-display text-[26px]">{d}</div>
                <div className={`text-[10.5px] uppercase tracking-wide leading-tight ${on ? 'text-yellow-ink/80' : 'text-muted'}`}>{DIFFICULTY_NAMES[d]}</div>
              </button>
            );
          })}
        </div>
        <div className="text-[12.5px] text-muted mt-3">Report your actual Requisition after each mission — these are just the defaults the debrief pre-fills.</div>
      </div>

      <div className="mt-6 flex justify-end">
        <button className="btn btn-primary btn-lg" onClick={() => apply(beginLoadout)}>
          Proceed to the armory →
        </button>
      </div>
    </div>
  );
}
