'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  CATALOG_SOURCES,
  CATEGORIES,
  CATEGORY_LABEL,
  DIFFICULTY_NAMES,
  ITEMS,
  PARAM_SPECS,
  PRESETS,
  SCENARIOS,
  defaultRules,
  getParam,
  popularityMultiple,
  type Category,
} from '@engine';
import { LineChart } from '@/components/charts';
import { serverMode } from '@/lib/api';
import { openTerminal } from '@/lib/devtools';
import { req } from '@/lib/format';
import { useApp } from '@/lib/store';

import { REPO_URL } from '@/lib/site';

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="h-display text-[32px] mt-16 mb-3 scroll-mt-24 border-b border-line pb-2">
      {children}
    </h2>
  );
}
function H3({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="font-display font-bold uppercase tracking-wider text-text text-[19px] mt-8 mb-2 scroll-mt-24">
      {children}
    </h3>
  );
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[13.5px] text-yellow bg-yellow/[0.07] px-1.5 py-0.5">{children}</code>;
}
function Formula({ children }: { children: React.ReactNode }) {
  return <pre className="panel-flat px-4 py-3 font-mono text-[13.5px] text-text overflow-x-auto my-3 leading-6">{children}</pre>;
}

const TOC: [string, string][] = [
  ['what', 'What this mode is'],
  ['rules', 'Rules'],
  ['operations', '· Operations'],
  ['blitz', '· Budget Blitz'],
  ['debrief', '· Reporting a mission'],
  ['free', '· Free gear'],
  ['market', 'The Price Database'],
  ['data', '· What we collect'],
  ['equations', 'The pricing equations'],
  ['parameters', '· Parameters'],
  ['testing', 'How we test the economy'],
  ['sources', 'Data sources'],
  ...(__DEV_TOOLS__ ? ([['prototype', 'Dev build notes']] as [string, string][]) : []),
  ['roadmap', 'Roadmap'],
  ['code', 'Source code'],
  ['faq', 'FAQ'],
];

export default function Codex() {
  const { market } = useApp();
  const p = market.config.anchored;
  const rules = defaultRules();
  const [cat, setCat] = useState<Category>('stratagem');
  const curve = useMemo(() => {
    const x: number[] = [];
    for (let v = -5; v <= 4.0001; v += 0.125) x.push(+v.toFixed(3));
    return { x, values: x.map((v) => p.baseline[cat] * popularityMultiple(2 ** v, p)) };
  }, [p, cat]);
  const counts = CATEGORIES.map((c) => `${ITEMS.filter((i) => i.category === c).length} ${CATEGORY_LABEL[c].toLowerCase()}`).join(', ');

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 grid lg:grid-cols-[230px_1fr] gap-10">
      <nav className="hidden lg:block sticky top-[90px] self-start text-[14px] space-y-1.5 max-h-[calc(100vh-110px)] overflow-y-auto">
        <Link href="/manual/" className="block text-[13px] text-muted hover:text-yellow mb-4">
          ← Field manual
        </Link>
        <div className="eyebrow mb-2">Contents</div>
        {TOC.map(([id, t]) => (
          <a key={id} href={`#${id}`} className={`block hover:text-yellow ${t.startsWith('·') ? 'text-dim pl-3' : 'text-muted'}`}>
            {t.replace(/^· /, '')}
          </a>
        ))}
      </nav>

      <article className="min-w-0 text-text-2 leading-relaxed text-[15.5px]">
        <div className="eyebrow text-yellow">Field manual · long version</div>
        <h1 className="h-display text-[48px] sm:text-[60px]">The Complete Manual</h1>
        <p className="mt-2">Everything about HD2 Galactic Market: the rules, the market, the math, the testing, and what’s coming. Skim the contents on the left, or read it top to bottom.</p>

        <H id="what">What HD2 Galactic Market is</H>
        <p>
          HD2 Galactic Market is an unofficial, fan-made game mode layered on top of normal Helldivers 2. Late in the game most players have unlocked everything and have more Requisition than they can
          spend, so the economy stops mattering. HD2 Galactic Market brings it back: every piece of gear you bring costs Requisition you have to earn, and prices are set by what the whole community deploys rather than by
          us.
        </p>
        <p className="mt-3">
          The game itself is untouched. You still dive, fight and extract in Helldivers 2. This website is the rulebook, the bookkeeper and the market. Rules are honour-system: the site can’t see your game.
        </p>

        <H id="rules">Rules</H>
        <H3>Loadouts</H3>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>
            Every mission, each Helldiver buys exactly <span className="text-text">four stratagems, one primary, one secondary and one throwable</span>, and uses only those.
          </li>
          <li>Armor and boosters are free and unrestricted.</li>
          <li>The same stratagem can’t fill two of your slots, but squadmates may bring the same gear.</li>
          <li>Prices are those of the front (Terminids, Automatons or Illuminate) you’re deploying to, and lock in when the squad deploys.</li>
        </ul>

        <H3 id="operations">Operations</H3>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>
            Each Helldiver starts with <span className="text-text">{req(rules.startingBalance)}</span> Requisition. That’s also the cap: earnings that would take you above {req(rules.maxBalance)} are lost.
          </li>
          <li>An operation is {rules.missionsPerOperation} missions on one front at one difficulty. Balances carry over between missions and operations.</li>
          <li>
            <span className="text-text">Failing a single mission ends the run.</span> Completing the objectives without extracting still counts as a completed mission (at reduced pay).
          </li>
          <li>You can’t go bankrupt: a zero-cost loadout is always available, so money limits what you can bring, not whether you can play.</li>
          <li>Your score is how many missions and operations the squad survives.</li>
        </ul>

        <H3 id="blitz">Budget Blitz (under construction)</H3>
        <p>
          A planned elimination mode. Each round every Helldiver locks in a loadout and must earn more Requisition than it cost (optionally plus a margin that rises each round); anyone who doesn’t is out. Last
          one standing wins. It isn’t playable yet, and its rules may change.
        </p>

        <H3 id="debrief">Reporting a mission</H3>
        <p>After each mission the squad reports the outcome and how much Requisition each Helldiver earned. The debrief suggests earnings by difficulty; overwrite them with what you actually got.</p>
        <div className="panel-flat mt-3 overflow-x-auto">
          <table className="w-full text-[13.5px] tnum">
            <thead className="text-muted">
              <tr>
                <th className="text-left px-3 py-1.5">Difficulty</th>
                <th className="text-right px-3 py-1.5">Extracted</th>
                <th className="text-right px-3 py-1.5">Objectives done, no extraction</th>
              </tr>
            </thead>
            <tbody>
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((d) => (
                <tr key={d} className="border-t border-line">
                  <td className="px-3 py-1">
                    {d} · {DIFFICULTY_NAMES[d]}
                  </td>
                  <td className="px-3 py-1 text-right">{req(rules.earningsByDifficulty[d])}</td>
                  <td className="px-3 py-1 text-right">{req(rules.earningsByDifficulty[d] * rules.outcomeMultiplier.completed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3">
          The debrief also records reinforcements used. That’s <span className="text-text">work in progress</span>: they’re logged but cost nothing today. Charging Requisition for reinforcements is an idea we may
          revisit.
        </p>

        <H3 id="free">Free gear</H3>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>
            Always free: <span className="text-text">R-2124 Constitution</span>, <span className="text-text">P-2 Peacemaker</span> and <span className="text-text">G-12 High Explosive</span>.
          </li>
          <li>
            Each front also has <span className="text-text">{market.config.free.count} free stratagems</span>, chosen from the cheapest gear. Each stays free for {market.config.free.tenure} days and then can’t be free
            again for {market.config.free.cooldown} days; the slots are staggered so roughly one changes each day.
          </li>
        </ul>

        <H id="market">The Price Database</H>
        <p>
          There are three markets, one per front, and each has four categories (stratagems, primaries, secondaries, throwables). Every loadout deployed is counted anonymously into that front’s queue. Once a
          day the market processes the queue and reprices every item, then rotates the free stratagems.
        </p>
        <p className="mt-3">
          Popular gear gets more expensive; ignored gear gets cheaper. Because each front prices separately, a weapon that dominates the bugs but struggles against bots can be pricey on one front and a bargain
          on the other.
        </p>
        <H3 id="data">What we collect</H3>
        <p>
          Only the equipment in each deployed loadout, which front it was for, and what it cost — no names, accounts or identifiers. You can opt out when you start a campaign; the market then just doesn’t learn from
          your picks.{serverMode ? '' : ' In this offline build nothing leaves your browser at all.'}
        </p>

        <H id="equations">The pricing equations</H>
        <p>
          The live algorithm is <span className="text-text">anchored popularity pricing</span>. For every front and category with <span className="font-mono">N</span> usable items, each day:
        </p>
        <H3>1. Measure popularity</H3>
        <Formula>
          {`observed_i = (picks_i ÷ ownership_i) ÷ Σⱼ (picks_j ÷ ownership_j)
w          = ema × M ÷ (M + halfSample × N)          M = picks today
share_i   ← (1 − w) × share_i + w × observed_i`}
        </Formula>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>
            <span className="text-text">Ownership correction.</span> Warbond, Superstore and limited gear is owned by fewer players, so its picks count ÷{p.ownershipFactor.warbond}.
          </li>
          <li>
            <span className="text-text">Confidence-weighted smoothing.</span> A quiet day with few squads nudges popularity instead of whipsawing it; a busy day moves it by up to {p.ema}.
          </li>
          <li>
            <span className="text-text">Free gear stays in.</span> Heavy use of the free Peacemaker lowers every paid sidearm’s share a little, so they get a bit cheaper to compete — but their order is kept.
          </li>
          <li>
            <span className="text-text">Free stratagems are frozen</span> while free. People pick them partly because they’re free, which says nothing about their real price.
          </li>
        </ul>
        <H3>2. Set a target price</H3>
        <Formula>
          {`r_i      = share_i × N                 (1 = exactly a fair share)
target_i = baseline × F(r_i)
F(r)     = exp(  U·tanh(εᵤ·ln r ÷ U) )       r ≥ 1,  U = ln(ceiling)
F(r)     = exp( −D·tanh(ε_d·ln(1/r) ÷ D) )   r < 1,  D = ln(1/floor)`}
        </Formula>
        <p>
          F is a power law near a fair share that bends smoothly into a ceiling ({p.ceilingMultiple}× baseline) and a floor ({p.floorMultiple}× baseline). Because it’s bounded, no pattern of play can make prices
          run away or collapse — which is what lets the market run on its own.
        </p>
        <div className="panel p-5 mt-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <div className="text-[13px] text-muted">Live parameters · pick a category</div>
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
            subtitle="x: popularity relative to a fair share of the category (log scale)"
            x={curve.x}
            series={[{ id: 'target', label: 'Target price', color: '#3987e5', values: curve.values }]}
            xFormat={(v) => (v >= 0 ? `${2 ** v}×` : `1/${2 ** -v}×`)}
            xLabel="Popularity"
            reference={{ y: p.baseline[cat], label: `baseline ${req(p.baseline[cat])}` }}
            height={260}
            zero
          />
        </div>
        <H3>3. Step toward the target</H3>
        <Formula>
          {`k     = adjustRate × (upBias | downBias) × speed(price ÷ baseline) × pressure(heat)
price ← price × exp( clamp(min(k, 1) × ln(target ÷ price), ln(1 − maxStep), ln(1 + maxStep)) )
speed(q) = max(minSpeed, 2qᵞ ÷ (1 + qᵞ))`}
        </Formula>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>Prices move at most ±{Math.round(p.maxStep * 100)}% a day. Rises get a ×{p.upBias} nudge and falls ×{p.downBias}.</li>
          <li>Cheap gear rises slowly and expensive gear reacts quickly, so a niche pick that suddenly catches on stays a bargain for a while — early adopters get rewarded.</li>
          <li>A category whose spending runs hot rises more slowly and falls faster (this only changes speed, never the target).</li>
          <li>
            Baselines are tuned so the average loadout price (the community’s picks at full price, weighted by how often each item is picked) is about 16,000, roughly two Super Helldive payouts. The market doesn’t force spending back to that number; if everyone chases the meta, the average loadout
            gets pricier.
          </li>
        </ul>
        <H3 id="parameters">Parameters (live values)</H3>
        <div className="panel-flat overflow-x-auto">
          <table className="w-full text-[13px]">
            <tbody>
              {PARAM_SPECS.filter((s) => s.algorithm !== 'legacy').map((s) => (
                <tr key={s.path} className="border-t border-line first:border-t-0">
                  <td className="px-3 py-1.5 font-mono text-yellow whitespace-nowrap">{s.path}</td>
                  <td className="px-3 py-1.5 tnum text-text text-right">{String(getParam(market.config, s.path))}</td>
                  <td className="px-3 py-1.5 text-muted">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[14px]">
          The original prototype’s algorithm is kept for comparison as <Code>legacy</Code>. It nudges prices by how far popularity is from a fair share every day, which drifts: junk can never reach a fair share, so
          prices keep sliding toward the floor.
        </p>

        <H id="testing">How we test the economy</H>
        <p>
          {__DEV_TOOLS__ ? (
            <>
              The{' '}
              <Link href="/lab/" className="text-yellow hover:underline">
                Market Lab
              </Link>
            </>
          ) : (
            'A market simulator'
          )}{' '}
          simulates months of play with squads of rule-based Helldivers (no AI): regulars, meta chasers, penny-pinchers, niche
          enjoyers, loyalists and chaos divers. Each scores affordable gear by its true strength against the front (u.gg tier plus hidden noise), personal taste and price, avoids pointless overlaps like two
          backpacks, and spends more when rich. Missions succeed or fail by squad strength and difficulty; a failure ends that squad’s run and they start a fresh one.
        </p>
        <p className="mt-3">After each run, automated checks grade whether the prices did anything unwanted:</p>
        <ul className="list-disc pl-5 space-y-1 mt-2 marker:text-dim text-[14.5px]">
          <li>no runaway prices (fail above 20,000), no collapse to the minimum, no drift once settled, low day-to-day noise</li>
          <li>meta gear priced above weak gear; niche gear cheap; free defaults don’t crush premium weapons</li>
          <li>average loadout price near 16,000; pricing pushes picks off the meta and onto niche gear compared with no prices</li>
          <li>free stratagems rotate; prices differ by front; adapts to balance patches; resists brigading</li>
        </ul>
        <div className="mt-4 grid sm:grid-cols-2 gap-2 text-[13.5px]">
          {SCENARIOS.map((s) => (
            <div key={s.id} className="panel-flat px-3 py-2">
              <span className="font-display font-bold uppercase tracking-wider text-text">{s.name}</span> <span className="text-muted font-mono text-[12px]">{s.id}</span>
              <div className="text-muted">{s.description}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[14.5px]">
          Results: the anchored algorithm passes 9 of 12 scenarios and warns on 3 (flat demand narrows price spreads; a large brigade gets close to, but not past, the price ceiling). Full details in{' '}
          <a className="text-yellow hover:underline" href={`${REPO_URL}/blob/main/docs/PRICING.md`} target="_blank" rel="noreferrer">
            docs/PRICING.md
          </a>
          .
        </p>

        <H id="sources">Data sources</H>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>
            The catalog ({counts}) and its per-front OP…D ratings come from the{' '}
            <a className="text-yellow hover:underline" href="https://u.gg/hd2/tier-list" target="_blank" rel="noreferrer">
              u.gg tier lists
            </a>{' '}
            (captured {CATALOG_SOURCES.fetched}). Ratings only set launch prices and power the simulations; live prices come from play.
          </li>
          <li>
            Stratagem codes, stratagem icons, weapon renders and damage/armor icons come from the{' '}
            <a className="text-yellow hover:underline" href="https://helldivers.wiki.gg" target="_blank" rel="noreferrer">
              Helldivers Wiki
            </a>
            . All game art belongs to Arrowhead Game Studios and Sony Interactive Entertainment — see <Link href="/credits/" className="text-yellow hover:underline">Credits &amp; Legal</Link>.
          </li>
          <li>Launch-state presets for testing:</li>
        </ul>
        <div className="mt-2 space-y-1.5 text-[14.5px] pl-5">
          {PRESETS.map((pr) => (
            <div key={pr.id}>
              <Code>init {pr.id}</Code> <span className="text-text">{pr.label}</span> — {pr.description}
            </div>
          ))}
        </div>

        {__DEV_TOOLS__ && (
          <>
            <H id="prototype">Dev build notes</H>
            <p>
              This is the developer build. It has tools the public site leaves out: the Market Lab and the ship terminal (press <kbd className="font-mono text-[12px] border border-line-2 px-1">`</kbd>), where
              you trigger market updates yourself so the equations can be tuned on demand. Without the local market API everything, including the “global” market, lives in your browser. The public site updates
              its market on its own once a day.
            </p>
            <div className="panel-flat mt-4 p-4 font-mono text-[13px] leading-7 overflow-x-auto">
              {[
                ['update', 'run the daily market update'],
                ['status', 'overview: day, queue, price levels, free stratagems'],
                ['prices bots strat --sort share', 'price board for one front and category'],
                ['price railgun', 'one item on all three fronts'],
                ['sim day 50', 'let 50 simulated squads play, then update'],
                ['config set anchored.elasticityUp 1.1', 'tune an equation live'],
                ['init tiers', 're-initialize prices from a preset'],
                ['export / import', 'move a market to or from the command line'],
              ].map(([c, d]) => (
                <div key={c}>
                  <button className="text-yellow hover:underline" onClick={() => openTerminal(c.split(' / ')[0])}>
                    {c}
                  </button>
                  <span className="text-dim"> — {d}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[14px]">
              The same commands run from a shell with <Code>npm run market -- &lt;command&gt;</Code>, and <Code>npm run sim</Code> runs the whole scenario suite. See the repository README.
            </p>
          </>
        )}

        <H id="roadmap">Roadmap</H>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>Squad lobbies with join codes so up to four players can join from their own devices (AWS AppSync + DynamoDB).</li>
          <li>Budget Blitz.</li>
          <li>Possibly charging Requisition for reinforcements.</li>
          <li>Server-side protection against spam submissions (rate limits per lobby).</li>
        </ul>

        <H id="code">Source code</H>
        <p>
          The project is open on GitHub:{' '}
          <a className="text-yellow hover:underline" href={REPO_URL} target="_blank" rel="noreferrer">
            {REPO_URL.replace('https://', '')}
          </a>
          . The economic engine (<Code>engine/</Code>) is plain TypeScript shared by the website, the command-line tools and, later, the daily price job. The pricing reference is{' '}
          <Code>docs/PRICING.md</Code>.
        </p>

        <H id="faq">FAQ</H>
        <div className="space-y-4">
          {[
            ['Why is my favourite stratagem so expensive?', 'Because lots of other Helldivers love it too. Prices follow popularity on each front. Try it on a different front, or find a cheaper alternative while it’s hot.'],
            ['Can something become free?', 'The three permanently free items always are. Paid gear never drops below its floor, but the cheapest stratagems on each front rotate through the free slots.'],
            ['What if I can’t afford anything?', 'You can always deploy with free gear. In Operations money can’t end your run — failing a mission can.'],
            ['Can prices go crazy?', 'No. Every price has a ceiling and a floor, and moves at most 20% a day. Our simulations specifically test for runaway prices, collapses and oscillation.'],
            ['Is this official?', 'No. It’s a free, non-commercial fan project and isn’t affiliated with Arrowhead or Sony. See Credits & Legal.'],
          ].map(([q, a]) => (
            <div key={q}>
              <div className="text-text font-semibold">{q}</div>
              <div>{a}</div>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
