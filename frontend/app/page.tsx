'use client';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import { FactionEmblem } from '@/components/icons';
import { Delta, SectionTitle } from '@/components/ui';
import { req } from '@/lib/format';
import { useMovers } from '@/lib/marketView';
import { useApp } from '@/lib/store';

/** One line of text scaled so it exactly spans its container's width. */
function FitLine({ children, className = '' }: { children: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(96);
  useLayoutEffect(() => {
    const fit = () => {
      if (!box.current || !text.current) return;
      const prev = text.current.style.fontSize;
      text.current.style.fontSize = '100px';
      const natural = text.current.getBoundingClientRect().width;
      text.current.style.fontSize = prev;
      if (natural > 0) setSize(Math.floor((100 * box.current.clientWidth) / natural));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div ref={box} className="w-full overflow-hidden">
      <span ref={text} className={`inline-block whitespace-nowrap h-display ${className}`} style={{ fontSize: size, lineHeight: 0.92 }}>
        {children}
      </span>
    </div>
  );
}

function Ticker() {
  const movers = useMovers(18);
  const { market } = useApp();
  if (!movers.length || market.day === 0) return null;
  const row = movers.map((m) => (
    <span key={`${m.item.index}-${m.faction}`} className="inline-flex items-center gap-2 px-5 whitespace-nowrap">
      <FactionEmblem faction={m.faction} size={14} />
      <span className="text-text-2">{m.item.name}</span>
      <span className="tnum text-text">{req(m.price)}</span>
      <Delta value={m.change} />
    </span>
  ));
  return (
    <div className="border-y border-line bg-black/30 py-2.5 overflow-hidden text-[13.5px]" aria-label="Biggest price moves since yesterday">
      <div className="marquee inline-flex">
        {row}
        {row}
      </div>
    </div>
  );
}

export default function Home() {
  const { campaign, records } = useApp();
  const active = campaign && campaign.phase !== 'over';

  return (
    <div>
      <section className="mx-auto max-w-[1400px] px-4 pt-12 pb-14 rise">
        <div className="eyebrow text-yellow mb-5">Unofficial endgame mode · for veteran Helldivers</div>
        <FitLine>Freedom isn’t free.</FitLine>
        <FitLine className="text-yellow">Neither is your loadout.</FitLine>
        <div className="hazard-thin mt-6 max-w-[420px]" />
        <p className="mt-6 text-[18px] text-text-2 max-w-[760px] leading-relaxed">
          Every stratagem, primary, sidearm and grenade costs Requisition. Start with <span className="text-text font-semibold">50,000</span>, buy your kit before each dive, and survive on what you earn.
          Prices aren’t ours to set: every day the Galactic Market reprices all gear from what the whole community actually brings. Run the meta and pay for it, or find the gear nobody else will touch.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/play/" className="btn btn-primary btn-lg">
            {active ? `Resume ${campaign.operationName}` : 'Start an Operation'}
          </Link>
          <Link href="/manual/" className="btn btn-ghost">
            See Game Rules
          </Link>
          <Link href="/market/" className="btn btn-ghost">
            Galactic Market
          </Link>
        </div>
      </section>

      <Ticker />

      {records.length > 0 && (
        <section className="mx-auto max-w-[1400px] px-4 pt-16">
          <SectionTitle eyebrow="Hall of fame" title="Past campaigns" />
          <div className="mt-6 panel overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead className="text-muted text-left">
                <tr>
                  {['Campaign', 'Squad', 'Missions', 'Earned', 'Spent', 'How it ended'].map((h) => (
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
                    <td className="px-4 py-2 text-text-2">{r.names.join(', ')}</td>
                    <td className="px-4 py-2 tnum">{r.missions}</td>
                    <td className="px-4 py-2 tnum">{req(r.earned)}</td>
                    <td className="px-4 py-2 tnum">{req(r.spent)}</td>
                    <td className="px-4 py-2 text-muted">
                      {r.winner ? `${r.winner} won · ` : ''}
                      {r.reason}
                    </td>
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
