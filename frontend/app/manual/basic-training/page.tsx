'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireItem, type Faction } from '@engine';
import { FactionEmblem, ItemIcon } from '@/components/icons';
import { SectionTitle } from '@/components/ui';

const B = ({ children }: { children: ReactNode }) => <span className="text-text font-semibold">{children}</span>;

const STEPS: { n: string; t: string; d: ReactNode; note?: ReactNode }[] = [
  {
    n: '01',
    t: 'Buy your loadout',
    d: (
      <>
        Four stratagems, a primary, a secondary and a throwable, each priced in Requisition (today’s prices are in the Price Database). <B>Armor and boosters are on the house</B> — though that may change
        later.
      </>
    ),
  },
  {
    n: '02',
    t: 'Dive',
    d: (
      <>
        Play a normal Helldivers 2 mission using the loadout you’ve purchased. <B>HD2 Galactic Market is only a web app, not a mod</B>: it doesn’t touch the game itself, so you must enter your loadout in-game
        manually.
      </>
    ),
  },
  {
    n: '03',
    t: 'Report & get paid',
    d: <>Once you’ve completed the mission, pay attention to how much Requisition you earn on the “Squad Payout” screen. That’s your payday for this mission.</>,
    note: 'Keep a pen and paper handy or take a screenshot so you don’t forget it. A web app can’t read your game, so this one small step is on you; we’ve kept everything else as quick as we can.',
  },
];

/** Illustrative prices. `faction` labels the whole card (one front); a third tuple value labels one column instead. */
function Example({ id, faction, days, note }: { id: string; faction?: Faction; days: [string, number, Faction?][]; note: string }) {
  const item = requireItem(id);
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-3">
        <ItemIcon item={item} size={44} />
        <div>
          <div className="font-semibold text-[16px]">{item.name}</div>
          {faction && (
            <div className="text-[12.5px] text-muted flex items-center gap-1.5">
              <FactionEmblem faction={faction} size={14} /> example prices vs {faction === 'terminids' ? 'Terminids' : faction === 'automatons' ? 'Automatons' : 'Illuminate'}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-end gap-2">
        {days.map(([d, p, f]) => (
          <div key={d} className="flex-1 text-center">
            <div className="tnum font-display font-bold text-[20px]">{p === 0 ? 'FREE' : p.toLocaleString()}</div>
            <div className="text-[11.5px] text-muted uppercase tracking-wider font-display flex items-center justify-center gap-1.5">
              {f && <FactionEmblem faction={f} size={14} />}
              {d}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[14px] text-text-2 mt-3">{note}</p>
    </div>
  );
}

export default function BasicTraining() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-12">
      <Link href="/manual/" className="text-[13px] text-muted hover:text-yellow">
        ← Field manual
      </Link>
      <h1 className="h-display text-[52px] sm:text-[64px] mt-4">Basic Training</h1>
      <p className="text-text-2 mt-3 text-[17px] leading-relaxed">
        You play Helldivers 2 exactly as you normally would, except your gear isn’t free. Before each mission your squad buys its loadouts here with Requisition. After it, you report what you earned and
        spend it on the next one. Here’s how each part works.
      </p>

      <section className="mt-12">
        <SectionTitle title="Buy · Dive · Get paid · Repeat" />
        <div className="mt-6 grid md:grid-cols-3 gap-4">
          {STEPS.map((s) => (
            <div key={s.n} className="panel p-6">
              <div className="h-display text-[54px] text-yellow/90">{s.n}</div>
              <div className="font-display font-bold uppercase tracking-wider text-[20px] mt-2">{s.t}</div>
              <p className="text-text-2 mt-2">{s.d}</p>
              {s.note && <p className="text-muted text-[14px] mt-3">{s.note}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14">
        <SectionTitle title="What you need to know" />
        <div className="mt-6 grid md:grid-cols-2 gap-4 text-[15.5px] text-text-2">
          <div className="panel p-6 space-y-3">
            <p>
              <span className="text-text font-semibold">Start with 50,000 Requisition.</span> That’s also the most you can hold. Anything earned above it is lost, so spend it.
            </p>
            <p>
              <span className="text-text font-semibold">The average loadout costs far more than what you can earn on a mission.</span> Mix in bargains and splurge when it counts, and remember that you can save
              thousands of Requisition by sharing equipment with your teammates or scavenging equipment from the mission site.
            </p>
            <p>
              <span className="text-text font-semibold">You can always deploy for free.</span> The Constitution, Peacemaker and High Explosive grenade never cost anything, and four stratagems on every front are free
              each day — but can you rely on the community’s least favorite equipment?
            </p>
          </div>
          <div className="panel panel-accent p-6 space-y-3">
            <div className="font-display font-bold uppercase tracking-wider text-text text-[20px]">Operations</div>
            <p>Three missions per operation, back to back, on one front. Your balance carries over from mission to mission and operation to operation.</p>
            <p>
              <span className="text-text font-semibold">Fail a single mission and the run is over.</span> Money only limits what you can afford; it can’t make you fail this game mode. Spend, save and earn as
              much or as little as you see fit. Your only objective is to accomplish the missions.
            </p>
            <p className="text-[13.5px] text-muted">Budget Blitz, an elimination mode where you must earn more than you spend, is under construction.</p>
          </div>
        </div>
      </section>

      <section className="mt-14">
        <SectionTitle title="How prices work" />
        <p className="text-text-2 mt-3">
          Every loadout deployed is counted, anonymously. Once a day the market looks at what everyone brought and reprices every item. Here’s what that looks like in practice (illustrative numbers):
        </p>
        <div className="mt-6 grid lg:grid-cols-3 gap-4">
          <Example
            id="rs-422-railgun"
            faction="automatons"
            days={[
              ['Mon', 5000],
              ['Tue', 6000],
              ['Wed', 6900],
              ['Thu', 7300],
            ]}
            note="If half the bot front starts running the Railgun, it’s picked more than its fair share every day, so its price climbs — but never more than 20% in a day."
          />
          <Example
            id="tx-41-sterilizer"
            faction="automatons"
            days={[
              ['Mon', 1800],
              ['Tue', 1450],
              ['Wed', 1150],
              ['Thu', 0],
            ]}
            note="Hardly anyone brings the Sterilizer, so it keeps getting cheaper until it lands among the day’s free stratagems. Niche gear is where the bargains are."
          />
          <Example
            id="flam-40-flamethrower"
            days={[
              ['Bots', 2900, 'automatons'],
              ['Bugs', 6400, 'terminids'],
              ['Squids', 7400, 'illuminate'],
            ]}
            note="Every front has its own market. Gear that’s brilliant against one enemy can be cheap against another, so check prices for the front you’re about to dive on."
          />
        </div>
        <div className="mt-6 grid md:grid-cols-3 gap-4 text-[14.5px] text-text-2">
          <div className="panel-flat p-4">
            <span className="text-text font-semibold">Nothing runs away.</span> Prices have a ceiling and a floor, so the meta gets expensive without becoming unbuyable, and niche gear gets cheap without becoming
            worthless.
          </div>
          <div className="panel-flat p-4">
            <span className="text-text font-semibold">Free gear still counts.</span> If everyone leans on the free Peacemaker, other sidearms get a little cheaper to compete.
          </div>
          <div className="panel-flat p-4">
            <span className="text-text font-semibold">Your picks matter.</span> The market only knows what players bring. Contributing your (anonymous) weapon choices is what keeps prices honest.
          </div>
        </div>
      </section>

      <div className="mt-14 flex flex-wrap items-center justify-center gap-3">
        <Link href="/play/" className="btn btn-primary btn-lg">
          Start an Operation
        </Link>
        <Link href="/manual/codex/" className="btn btn-ghost">
          Read the complete manual
        </Link>
        <Link href="/market/" className="btn btn-ghost">
          See today’s prices
        </Link>
      </div>
    </div>
  );
}
