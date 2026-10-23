'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CATEGORY_SINGULAR, FACTION_LABEL, FACTIONS, typicalLoadoutCost, type Faction } from '@engine';
import { ArrowCode, FactionEmblem, ItemIcon, ReqIcon } from '@/components/icons';
import { Delta, PriceTag, Req, SectionTitle } from '@/components/ui';
import { req } from '@/lib/format';
import { useMarketView, useMovers } from '@/lib/marketView';
import { useApp } from '@/lib/store';

function Receipt({ faction }: { faction: Faction }) {
  const { byCategory } = useMarketView(faction);
  // The community's current favourite kit: most popular paid stratagems + weapons.
  const kit = useMemo(() => {
    const top = (list: typeof byCategory.stratagem, n: number) => [...list].filter((v) => !v.q.free).sort((a, b) => b.share - a.share).slice(0, n);
    return [...top(byCategory.stratagem, 4), ...top(byCategory.primary, 1), ...top(byCategory.secondary, 1), ...top(byCategory.throwable, 1)];
  }, [byCategory]);
  const total = kit.reduce((s, v) => s + v.q.price, 0);
  return (
    <div className="panel panel-accent rise" style={{ animationDelay: '0.1s' }}>
      <div className="hazard-thin" />
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div>
          <div className="eyebrow">Requisition receipt · vs {FACTION_LABEL[faction]}</div>
          <div className="font-display font-bold text-[18px] uppercase tracking-wider">Today’s meta loadout</div>
        </div>
        <FactionEmblem faction={faction} size={34} />
      </div>
      <div className="px-5 pb-2">
        {kit.map((v) => (
          <div key={v.item.index} className="flex items-center gap-3 py-1.5 border-t border-line/70">
            <ItemIcon item={v.item} size={34} />
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold truncate">{v.item.name}</div>
              <div className="text-[12px] text-muted flex items-center gap-2">
                {CATEGORY_SINGULAR[v.item.category]}
                {v.item.code && <ArrowCode code={v.item.code} size="sm" />}
              </div>
            </div>
            <PriceTag q={v.q} size="sm" />
          </div>
        ))}
      </div>
      <div className="px-5 py-3 border-t border-line-2 bg-black/20 grid grid-cols-3 gap-2 text-[13px]">
        <div>
          <div className="text-muted">Starting balance</div>
          <Req value={50000} className="font-semibold" />
        </div>
        <div>
          <div className="text-muted">This loadout</div>
          <Req value={total} className="font-semibold text-yellow" />
        </div>
        <div>
          <div className="text-muted">Left to survive on</div>
          <Req value={50000 - total} className="font-semibold" />
        </div>
      </div>
    </div>
  );
}

function Ticker() {
  const movers = useMovers(18);
  const { market } = useApp();
  if (!movers.length || market.day === 0)
    return (
      <div className="border-y border-line bg-black/30 py-2.5 text-center text-[13px] text-muted font-mono">
        MARKET FEED · cycle #{market.day} · no price moves yet — prices change when an operator runs <span className="text-yellow">update</span> in the terminal
      </div>
    );
  const row = movers.map((m) => (
    <span key={`${m.item.index}-${m.faction}`} className="inline-flex items-center gap-2 px-5 whitespace-nowrap">
      <FactionEmblem faction={m.faction} size={14} />
      <span className="text-text-2">{m.item.short}</span>
      <span className="tnum text-text">{req(m.price)}</span>
      <Delta value={m.change} />
    </span>
  ));
  return (
    <div className="border-y border-line bg-black/30 py-2.5 overflow-hidden text-[13.5px]" aria-label="Biggest price moves last cycle">
      <div className="marquee inline-flex">
        {row}
        {row}
      </div>
    </div>
  );
}

const STEPS = [
  { n: '01', t: 'Buy your loadout', d: 'Four stratagems, a primary, a sidearm and a throwable — each one priced in Requisition by the live market, separately for every enemy faction.' },
  { n: '02', t: 'Dive', d: 'Play a normal Helldivers 2 mission using only what you bought. Armor and boosters are on the house.' },
  { n: '03', t: 'Report & get paid', d: 'Log the outcome, your Requisition earned and your reinforcements. Go broke and your campaign is over.' },
];

export default function Home() {
  const { campaign, records, market, ready } = useApp();
  const [faction, setFaction] = useState<Faction>('automatons');
  const { byCategory } = useMarketView(faction);
  const strats = useMemo(() => [...byCategory.stratagem].filter((v) => !v.q.free).sort((a, b) => b.q.price - a.q.price), [byCategory]);
  const free = byCategory.stratagem.filter((v) => v.q.rotating);
  const active = campaign && campaign.phase !== 'over';

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-[1400px] px-4 pt-14 pb-16 grid lg:grid-cols-[1.15fr_0.85fr] gap-12 items-center">
        <div className="rise min-w-0">
          <div className="eyebrow text-yellow mb-4">Unofficial endgame mode · for veteran Helldivers</div>
          <h1 className="h-display text-[54px] sm:text-[78px] lg:text-[92px]">
            Freedom isn’t free.
            <span className="block text-yellow">Neither is your loadout.</span>
          </h1>
          <p className="mt-6 text-[18px] text-text-2 max-w-[640px] leading-relaxed">
            Every stratagem, primary, sidearm and grenade costs Requisition. Start with <span className="text-text font-semibold">50,000</span>, buy your kit before each dive, and survive on what you earn. Prices
            aren’t ours to set — they come from what the whole community actually brings. Run the meta and pay for it, or find the gear nobody else will touch.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {active ? (
              <Link href="/play/" className="btn btn-primary btn-lg">
                Resume {campaign.operationName}
              </Link>
            ) : (
              <Link href="/play/?mode=operations" className="btn btn-primary btn-lg">
                Start an Operation
              </Link>
            )}
            <Link href="/play/?mode=blitz" className="btn btn-ghost btn-lg">
              Budget Blitz
            </Link>
            <Link href="/market/" className="btn btn-ghost btn-lg">
              Galactic Market
            </Link>
          </div>
          <div className="mt-6 flex items-center gap-4 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <ReqIcon /> 1–4 Helldivers on this device
            </span>
            <span>No accounts</span>
            <span>Works offline</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1 mb-2 justify-end">
            {FACTIONS.map((f) => (
              <button key={f} className="chip chip-toggle" data-on={f === faction} onClick={() => setFaction(f)}>
                <FactionEmblem faction={f} size={14} /> {FACTION_LABEL[f]}
              </button>
            ))}
          </div>
          {ready && <Receipt faction={faction} />}
        </div>
      </section>

      <Ticker />

      {/* How it works */}
      <section className="mx-auto max-w-[1400px] px-4 py-20">
        <SectionTitle eyebrow="The loop" title="Buy · Dive · Get paid · Repeat" />
        <div className="mt-8 grid md:grid-cols-3 gap-4">
          {STEPS.map((s) => (
            <div key={s.n} className="panel p-6">
              <div className="h-display text-[54px] text-yellow/90">{s.n}</div>
              <div className="font-display font-bold uppercase tracking-wider text-[20px] mt-2">{s.t}</div>
              <p className="text-text-2 mt-2">{s.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-muted max-w-3xl">
          A typical loadout runs about <span className="text-text">24,000</span> Requisition while a high-difficulty mission pays roughly 10–12,000. You can’t afford your favourite kit every mission — so you’ll mix in
          bargains, lean on the free gear, and splurge when it counts. Three things are always free: the <span className="text-text">R-2124 Constitution</span>, the <span className="text-text">P-2 Peacemaker</span> and the{' '}
          <span className="text-text">G-12 High Explosive</span>, plus four rotating free stratagems per front.
        </p>
      </section>

      {/* Modes */}
      <section className="mx-auto max-w-[1400px] px-4">
        <div className="grid md:grid-cols-2 gap-4">
          <Link href="/play/?mode=operations" className="panel panel-accent p-7 group hover:bg-white/[0.02] transition-colors">
            <div className="eyebrow">Endurance · co-op</div>
            <div className="h-display text-[44px] mt-1 group-hover:text-yellow transition-colors">Operations</div>
            <p className="text-text-2 mt-3">
              Three-mission operations, back to back. Your balance carries over, capped at 50,000. Reinforcements cost you. Go below zero and you’re out — how many operations can your squad survive?
            </p>
            <div className="mt-5 flex gap-2 flex-wrap">
              <span className="chip">50,000 start</span>
              <span className="chip">3 missions / op</span>
              <span className="chip">Bankrupt = out</span>
            </div>
          </Link>
          <Link href="/play/?mode=blitz" className="panel p-7 group hover:bg-white/[0.02] transition-colors">
            <div className="eyebrow">Elimination · competitive</div>
            <div className="h-display text-[44px] mt-1 group-hover:text-yellow transition-colors">Budget Blitz</div>
            <p className="text-text-2 mt-3">
              No balance to protect — every round you lock in a loadout, then you must earn more than you spent. Fall short and you’re eliminated. A cheap kit played well beats an expensive one played badly.
            </p>
            <div className="mt-5 flex gap-2 flex-wrap">
              <span className="chip">Profit or perish</span>
              <span className="chip">Last diver wins</span>
              <span className="chip">Solo: longest streak</span>
            </div>
          </Link>
        </div>
      </section>

      {/* Market teaser */}
      <section className="mx-auto max-w-[1400px] px-4 py-20">
        <SectionTitle
          eyebrow={`Galactic market · cycle #${market.day} · vs ${FACTION_LABEL[faction]}`}
          title="The meta has a price"
          right={
            <Link href="/market/" className="btn btn-ghost">
              Full market →
            </Link>
          }
        />
        <div className="mt-8 grid lg:grid-cols-3 gap-4">
          {[
            { title: 'Premium (most expensive)', list: strats.slice(0, 5) },
            { title: 'Bargain bin (cheapest)', list: strats.slice(-5).reverse() },
          ].map((col) => (
            <div key={col.title} className="panel p-5">
              <div className="font-display font-bold uppercase tracking-wider text-muted mb-3">{col.title}</div>
              {col.list.map((v) => (
                <div key={v.item.index} className="flex items-center gap-3 py-2 border-t border-line/60">
                  <ItemIcon item={v.item} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{v.item.name}</div>
                    <div className="text-[12px] text-muted">{(v.share * 100).toFixed(1)}% of picks</div>
                  </div>
                  <div className="text-right">
                    <PriceTag q={v.q} />
                    <div className="text-[12px]">
                      <Delta value={v.change} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="panel p-5">
            <div className="font-display font-bold uppercase tracking-wider text-good mb-3">Free this rotation</div>
            {free.map((v) => (
              <div key={v.item.index} className="flex items-center gap-3 py-2 border-t border-line/60">
                <ItemIcon item={v.item} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{v.item.name}</div>
                  <div className="text-[12px] text-muted">
                    free for {v.freeLeft} more cycle{v.freeLeft === 1 ? '' : 's'} · list {req(v.q.list)}
                  </div>
                </div>
              </div>
            ))}
            <div className="mt-4 text-[13px] text-muted">
              Typical loadout vs {FACTION_LABEL[faction]}: <Req value={typicalLoadoutCost(market, faction)} className="text-text" />
            </div>
          </div>
        </div>
      </section>

      {/* Hall of fame */}
      {records.length > 0 && (
        <section className="mx-auto max-w-[1400px] px-4">
          <SectionTitle eyebrow="Hall of fame" title="Past campaigns" />
          <div className="mt-6 panel overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead className="text-muted text-left">
                <tr>
                  {['Campaign', 'Mode', 'Squad', 'Missions', 'Earned', 'Spent', 'Result'].map((h) => (
                    <th key={h} className="px-4 py-2 font-display uppercase tracking-wider text-[12.5px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 10).map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2 font-semibold">{r.operationName}</td>
                    <td className="px-4 py-2 text-text-2">{r.mode === 'operations' ? 'Operations' : 'Budget Blitz'}</td>
                    <td className="px-4 py-2 text-text-2">{r.names.join(', ')}</td>
                    <td className="px-4 py-2 tnum">{r.missions}</td>
                    <td className="px-4 py-2 tnum">{req(r.earned)}</td>
                    <td className="px-4 py-2 tnum">{req(r.spent)}</td>
                    <td className="px-4 py-2 text-muted">{r.winner ? `${r.winner} won · ` : ''}{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
