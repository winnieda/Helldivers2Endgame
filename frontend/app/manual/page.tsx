'use client';
import { useMemo, useState } from 'react';
import { CATALOG_SOURCES, CATEGORY_LABEL, CATEGORIES, PRESETS, SCENARIOS, popularityMultiple, type Category } from '@engine';
import { LineChart } from '@/components/charts';
import { openTerminal } from '@/components/terminal';
import { SectionTitle } from '@/components/ui';
import { req } from '@/lib/format';
import { useApp } from '@/lib/store';

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="h-display text-[30px] mt-14 mb-3 scroll-mt-24">
      {children}
    </h2>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[13.5px] text-yellow bg-yellow/[0.07] px-1.5 py-0.5">{children}</code>;
}

const TOC = [
  ['rules', 'Rules of engagement'],
  ['market', 'The Galactic Market'],
  ['pricing', 'How prices are set'],
  ['testing', 'Testing the economy'],
  ['commands', 'Terminal & CLI'],
  ['data', 'Data & presets'],
];

export default function ManualPage() {
  const { market } = useApp();
  const p = market.config.anchored;
  const [cat, setCat] = useState<Category>('stratagem');
  const curve = useMemo(() => {
    const x: number[] = [];
    for (let v = -5; v <= 4.0001; v += 0.125) x.push(+v.toFixed(3));
    return { x, values: x.map((v) => p.baseline[cat] * popularityMultiple(2 ** v, p)) };
  }, [p, cat]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 grid lg:grid-cols-[220px_1fr] gap-10">
      <nav className="hidden lg:block sticky top-[90px] self-start text-[14px] space-y-1.5">
        <div className="eyebrow mb-2">Contents</div>
        {TOC.map(([id, t]) => (
          <a key={id} href={`#${id}`} className="block text-muted hover:text-yellow">
            {t}
          </a>
        ))}
      </nav>

      <article className="max-w-[860px] min-w-0 text-text-2 leading-relaxed text-[15.5px]">
        <SectionTitle eyebrow="Field manual" title="How Endgame works" />
        <p className="mt-3">
          Helldivers 2 Endgame is a self-imposed challenge layered on top of normal Helldivers 2. The game doesn’t change: you still dive, fight and extract. What changes is that every piece of gear you bring
          costs Requisition you have to earn, and the prices are set by what the whole playerbase is bringing.
        </p>

        <H id="rules">Rules of engagement</H>
        <ul className="list-disc pl-5 space-y-2 marker:text-dim">
          <li>
            A loadout is exactly <span className="text-text">four stratagems, one primary, one secondary and one throwable</span>. Armor and boosters are free and unrestricted.
          </li>
          <li>
            Three items are <span className="text-text">always free</span>: R-2124 Constitution, P-2 Peacemaker and G-12 High Explosive. Each front also has <span className="text-text">four free stratagems</span> that rotate
            (each is free for {market.config.free.tenure} market cycles, picked from the cheapest gear). You can always field a zero-cost loadout.
          </li>
          <li>
            Prices are per front. The same Railgun can cost very different amounts against Terminids, Automatons and the Illuminate. Prices lock in when the squad deploys.
          </li>
          <li>
            After a mission, report the outcome, the Requisition you earned and how many times you were reinforced (<span className="text-text">{req(250)}</span> each). The debrief pre-fills suggested earnings by
            difficulty (12,000 for a clean Super Helldive extraction, 11,000 for Helldive…); overwrite them with what you actually got.
          </li>
        </ul>
        <div className="grid sm:grid-cols-2 gap-4 mt-5">
          <div className="panel p-5">
            <div className="font-display font-bold uppercase tracking-wider text-text text-[18px]">Operations</div>
            <p className="text-[14.5px] mt-1">
              Start with 50,000 Requisition (also the most you can hold — anything above the cap is lost). Operations are three missions on one front. Loadouts are paid at deploy; reinforcements after the
              mission. If a Helldiver’s balance would drop below zero they are bankrupt and out. Survive as many operations as you can.
            </p>
          </div>
          <div className="panel p-5">
            <div className="font-display font-bold uppercase tracking-wider text-text text-[18px]">Budget Blitz</div>
            <p className="text-[14.5px] mt-1">
              No balances. Each round, each Helldiver spends up to 50,000 on a loadout and must earn more than they spent plus reinforcements (optionally plus a margin that can escalate each round). Fall short
              and you’re eliminated. Last one standing wins; if the last survivors fall together, the best total profit wins. Solo, it’s a streak.
            </p>
          </div>
        </div>

        <H id="market">The Galactic Market</H>
        <p>
          Every deployed loadout is counted anonymously into a <span className="text-text">pending queue</span>. Prices only move when an operator runs the market update — in this prototype that’s a terminal
          command rather than a daily timer, so the pricing equations can be tuned on demand. Press <kbd className="font-mono text-[12px] border border-line-2 px-1">`</kbd> anywhere (or the Terminal button)
          and type <Code>update</Code>.
        </p>
        <p className="mt-3">
          One update is one <span className="text-text">market cycle</span> — in the live design, one day. The queue empties, popularity is re-estimated, prices step toward their new targets, and free
          stratagems rotate. You can generate synthetic squads to feed the queue with <Code>sim squads 50</Code>, or do both at once with <Code>sim day 50</Code>.
        </p>

        <H id="pricing">How prices are set</H>
        <p>
          The live algorithm is <span className="text-text">anchored popularity pricing</span>. The original Python prototype’s algorithm is kept as <Code>legacy</Code> for comparison (switch with{' '}
          <Code>algorithm legacy</Code>). Every cycle, for every front and category:
        </p>
        <ol className="list-decimal pl-5 space-y-3 mt-3 marker:text-yellow">
          <li>
            <span className="text-text font-semibold">Measure popularity.</span> Each item’s share of the category’s picks is blended into a smoothed share (EMA rate {p.ema}, scaled down for small batches so a quiet
            day can’t whipsaw prices). Warbond, Superstore and limited gear count as if picked ÷{p.ownershipFactor.warbond} as often — fewer players own them. Permanently free gear stays in the count, so heavy use of
            the free Peacemaker gently cheapens other sidearms instead of being ignored. Rotating free stratagems are frozen while free: picks made because something was free say nothing about its real price.
          </li>
          <li>
            <span className="text-text font-semibold">Set a target.</span> With <span className="font-mono">r = share ÷ fair share</span> (fair share = 1 ÷ items in the category), the target is{' '}
            <span className="font-mono text-text">baseline × F(r)</span>. F is a power law near r = 1 (exponent {p.elasticityUp} above, {p.elasticityDown} below) that bends smoothly into a ceiling of{' '}
            {p.ceilingMultiple}× and a floor of {p.floorMultiple}× the baseline. Because F is bounded, prices can’t run away or collapse no matter what players do — that’s what lets the market run unattended.
          </li>
          <li>
            <span className="text-text font-semibold">Step toward it.</span> Price moves {Math.round(p.adjustRate * 100)}% of the way (in log terms) per cycle, ×{p.upBias} when rising and ×{p.downBias} when
            falling, never more than ±{Math.round(p.maxStep * 100)}%. Cheap gear rises more slowly and expensive gear reacts faster (a smooth function of price ÷ baseline), so a niche pick that suddenly becomes
            popular stays a bargain for a while — the early adopters get rewarded. A category whose spending runs hot also rises slower and falls faster.
          </li>
        </ol>

        <div className="panel p-5 mt-6">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <div className="text-[13px] text-muted">Live config · click a category</div>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((c) => (
                <button key={c} className="chip chip-toggle" data-on={c === cat} onClick={() => setCat(c)}>
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          <LineChart
            title={`Target price vs popularity — ${CATEGORY_LABEL[cat].toLowerCase()}`}
            subtitle="x: how popular an item is relative to a fair share of its category (log scale)"
            x={curve.x}
            series={[{ id: 'target', label: 'Target price', color: '#3987e5', values: curve.values }]}
            xFormat={(v) => (v >= 0 ? `${2 ** v}×` : `1/${2 ** -v}×`)}
            xLabel="Popularity"
            reference={{ y: p.baseline[cat], label: `baseline ${req(p.baseline[cat])}` }}
            height={260}
            zero
          />
        </div>
        <p className="mt-4">
          Baselines are calibrated so a typical loadout — the community’s picks at full list price — lands near <span className="text-text">24,000</span>, about twice what a high-difficulty mission pays. The
          algorithm deliberately does <span className="text-text">not</span> force spending back to 24,000: if players concentrate on the meta, the typical loadout gets pricier; if they spread out, it gets cheaper.
        </p>

        <H id="testing">Testing the economy</H>
        <p>
          The <a className="text-yellow hover:underline" href="/lab/">Market Lab</a> (and the <Code>npm run sim</Code> CLI) simulate squads of rule-based Helldivers — no LLMs — with six personalities (regulars,
          meta chasers, penny-pinchers, niche enjoyers, loyalists and chaos divers). Each one scores affordable gear by its hidden true strength against the faction (u.gg tier ± noise), personal taste and price,
          respects backpack/support-weapon overlaps, and spends more when rich and less when broke. Missions succeed or fail based on squad power and difficulty; earnings and reinforcements hit their balances.
        </p>
        <p className="mt-3">After every run, automated checks grade whether prices did anything unwanted:</p>
        <ul className="list-disc pl-5 space-y-1 mt-2 marker:text-dim text-[14.5px]">
          <li>no runaway prices (fail above 20,000) and no collapse to the hard minimum</li>
          <li>no inflation/deflation trend once settled; low day-to-day noise and no oscillation</li>
          <li>meta gear priced above weak gear (rank correlation with true strength); niche gear cheap</li>
          <li>free defaults don’t crush premium weapons (the Ultimatum stays pricey even though the Peacemaker is free)</li>
          <li>typical loadout near 24k; pricing pushes usage off the meta and onto niche gear compared with no prices at all</li>
          <li>free stratagems actually rotate; prices differ by faction; adapts to balance patches; resists brigading</li>
        </ul>
        <div className="mt-4 grid sm:grid-cols-2 gap-2 text-[13.5px]">
          {SCENARIOS.map((s) => (
            <div key={s.id} className="panel-flat px-3 py-2">
              <span className="font-display font-bold uppercase tracking-wider text-text">{s.name}</span> <span className="text-muted font-mono text-[12px]">{s.id}</span>
              <div className="text-muted">{s.description}</div>
            </div>
          ))}
        </div>

        <H id="commands">Terminal & CLI</H>
        <p>
          The in-browser terminal and the shell CLI share one command set. In the browser, state lives in localStorage; the CLI keeps it in <Code>data/market.json</Code>. Move a market between them with the
          terminal’s <Code>export</Code>/<Code>import</Code>.
        </p>
        <div className="panel-flat mt-4 p-4 font-mono text-[13px] leading-7 overflow-x-auto">
          {[
            ['status', 'overview: cycle, queue, price levels, free stratagems'],
            ['prices bots strat --sort share', 'price board for one front and category'],
            ['price railgun', 'one item on all three fronts, with a sparkline'],
            ['sim squads 100', 'queue loadouts from 100 synthetic squads'],
            ['update [times]', 'run the market update (the “daily” price change)'],
            ['config set anchored.elasticityUp 1.1', 'tune an equation live'],
            ['init tiers | equal | tiers-inverted | random | flat', 're-initialize prices'],
            ['sim run balance-patch', 'full scenario on a copy, with health checks'],
          ].map(([c, d]) => (
            <div key={c}>
              <button className="text-yellow hover:underline" onClick={() => openTerminal(c.replace(/ \[.*\]|\s\|.*$/g, ''))}>
                {c}
              </button>
              <span className="text-dim"> — {d}</span>
            </div>
          ))}
        </div>
        <div className="panel-flat mt-3 p-4 font-mono text-[13px] leading-7 overflow-x-auto">
          <div className="text-muted"># from the repository root</div>
          <div>npm run market -- status</div>
          <div>npm run market -- sim squads 200 &amp;&amp; npm run market -- update</div>
          <div>npm run sim -- --compare            <span className="text-dim"># every scenario, new vs prototype</span></div>
          <div>npm run sim -- baseline --set anchored.elasticityDown=2 --html report.html</div>
          <div>npm test                             <span className="text-dim"># engine unit tests (incl. exact match with the Python prototype)</span></div>
        </div>

        <H id="data">Data & presets</H>
        <p>
          The catalog ({CATALOG_SOURCES.fetched}) has every stratagem, primary, secondary and throwable rated on the u.gg tier lists, with separate ratings against each faction, plus stratagem codes from the
          community wiki. Refresh it with <Code>python3 tools/catalog/catalog.py fetch && python3 tools/catalog/catalog.py build</Code>.
        </p>
        <div className="mt-3 space-y-2 text-[14.5px]">
          {PRESETS.map((pr) => (
            <div key={pr.id}>
              <Code>init {pr.id}</Code> <span className="text-text">{pr.label}</span> — {pr.description}
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
