'use client';
import Link from 'next/link';
import { Pitch } from '@/components/Pitch';
import { requireItem } from '@engine';
import { FactionEmblem, ItemIcon } from '@/components/icons';
import { SectionTitle } from '@/components/ui';

const STEPS = [
  { n: '01', t: 'Buy your loadout', d: 'Four stratagems, a primary, a secondary and a throwable, each priced in Requisition by the Galactic Market. Armor and boosters are on the house.' },
  { n: '02', t: 'Dive', d: 'Play a normal Helldivers 2 mission using only what you bought. HD2 Galactic Market doesn’t touch the game itself.' },
  { n: '03', t: 'Report & get paid', d: 'Back on the Super Destroyer, log how it went and the Requisition you earned. Then buy your next loadout.' },
];

function Example({ id, faction, days, note }: { id: string; faction: 'terminids' | 'automatons' | 'illuminate'; days: [string, number][]; note: string }) {
  const item = requireItem(id);
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-3">
        <ItemIcon item={item} size={44} />
        <div>
          <div className="font-semibold text-[16px]">{item.name}</div>
          <div className="text-[12.5px] text-muted flex items-center gap-1.5">
            <FactionEmblem faction={faction} size={14} /> example prices vs {faction === 'terminids' ? 'Terminids' : faction === 'automatons' ? 'Automatons' : 'Illuminate'}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-end gap-2">
        {days.map(([d, p]) => (
          <div key={d} className="flex-1 text-center">
            <div className="tnum font-display font-bold text-[20px]">{p === 0 ? 'FREE' : p.toLocaleString()}</div>
            <div className="text-[11.5px] text-muted uppercase tracking-wider font-display">{d}</div>
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
      <div className="eyebrow text-yellow mt-4">Field manual · short version</div>
      <h1 className="h-display text-[52px] sm:text-[64px]">Basic Training</h1>
      <div className="mt-4"><Pitch className="text-[17px]" /></div>

      <section className="mt-12">
        <SectionTitle eyebrow="The loop" title="Buy · Dive · Get paid · Repeat" />
        <div className="mt-6 grid md:grid-cols-3 gap-4">
          {STEPS.map((s) => (
            <div key={s.n} className="panel p-6">
              <div className="h-display text-[54px] text-yellow/90">{s.n}</div>
              <div className="font-display font-bold uppercase tracking-wider text-[20px] mt-2">{s.t}</div>
              <p className="text-text-2 mt-2">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14">
        <SectionTitle eyebrow="Rules of engagement" title="What you need to know" />
        <div className="mt-6 grid md:grid-cols-2 gap-4 text-[15.5px] text-text-2">
          <div className="panel p-6 space-y-3">
            <p>
              <span className="text-text font-semibold">Start with 50,000 Requisition.</span> That’s also the most you can hold; anything earned above it is lost, so spend it.
            </p>
            <p>
              <span className="text-text font-semibold">The average loadout costs about 24,000.</span> A high-difficulty mission pays roughly 10,000–12,000, so you can’t run your favourite kit every time. Mix in bargains and
              splurge when it counts.
            </p>
            <p>
              <span className="text-text font-semibold">You can always deploy for free.</span> The Constitution, Peacemaker and High Explosive grenade never cost anything, and four stratagems on every front are free
              each day.
            </p>
          </div>
          <div className="panel panel-accent p-6 space-y-3">
            <div className="font-display font-bold uppercase tracking-wider text-text text-[20px]">Operations</div>
            <p>Three missions per operation, back to back, on one front. Your balance carries over from mission to mission and operation to operation.</p>
            <p>
              <span className="text-text font-semibold">Fail a single mission and the run is over.</span> Money only limits what you can afford — it can’t knock you out. How many operations can your squad survive?
            </p>
            <p className="text-[13.5px] text-muted">Budget Blitz, an elimination mode where you must earn more than you spend, is under construction.</p>
          </div>
        </div>
      </section>

      <section className="mt-14">
        <SectionTitle eyebrow="The Galactic Market" title="How prices work" />
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
            note="Half the bot front starts running the Railgun. Each day it’s picked more than its fair share, so its price climbs — never more than 20% in a day."
          />
          <Example
            id="cqc-1-one-true-flag"
            faction="automatons"
            days={[
              ['Mon', 1800],
              ['Tue', 1450],
              ['Wed', 1150],
              ['Thu', 0],
            ]}
            note="Hardly anyone brings the One True Flag, so it keeps getting cheaper until it lands among the day’s free stratagems. Niche gear is where the bargains are."
          />
          <Example
            id="ac-8-autocannon"
            faction="terminids"
            days={[
              ['Bots', 7800],
              ['Bugs', 4900],
              ['Squids', 3600],
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

      <div className="mt-14 flex flex-wrap gap-3">
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
