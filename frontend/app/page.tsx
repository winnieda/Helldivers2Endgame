'use client';
import Link from 'next/link';
import { FactionEmblem } from '@/components/icons';
import { Pitch } from '@/components/Pitch';
import { Delta, SectionTitle } from '@/components/ui';
import { req } from '@/lib/format';
import { useMovers } from '@/lib/marketView';
import { useApp } from '@/lib/store';

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
        <h1 className="h-display text-[44px] sm:text-[64px] lg:text-[84px] leading-[0.95]">
          Welcome to the <span className="text-yellow">Helldivers 2 Galactic Market</span>
        </h1>
        <div className="hazard-thin mt-8 max-w-[420px]" />
        <h2 className="h-display text-[30px] sm:text-[40px] leading-tight mt-6">
          Freedom isn’t free. <span className="text-yellow">Neither is your loadout.</span>
        </h2>
        <Pitch className="mt-3 text-[18px]" />
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href="/play/" className="btn btn-primary btn-lg">
            {active ? `Resume ${campaign.operationName}` : 'Start an Operation'}
          </Link>
          <Link href="/manual/" className="btn btn-ghost">
            See Game Rules
          </Link>
          <Link href="/market/" className="btn btn-ghost">
            Price Database
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
