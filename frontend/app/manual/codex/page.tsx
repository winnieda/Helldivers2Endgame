'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AVAILABLE,
  CATALOG_SOURCES,
  CATEGORIES,
  CATEGORY_LABEL,
  DIFFICULTY_NAMES,
  ITEMS,
  PARAM_SPECS,
  PRESETS,
  SCENARIOS,
  SLOTS_PER_CATEGORY,
  TIERS,
  TIER_MULTIPLE,
  defaultRules,
  getParam,
  popularityMultiple,
  softBand,
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
  ['equations', 'The pricing algorithm'],
  ['schedule', '· When prices change'],
  ['parameters', '· Every setting'],
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
    return { x, values: x.map((v) => p.baseline[cat] * popularityMultiple(2 ** v, p, p.baseline[cat])) };
  }, [p, cat]);
  const counts = CATEGORIES.map((c) => `${ITEMS.filter((i) => i.category === c).length} ${CATEGORY_LABEL[c].toLowerCase()}`).join(', ');
  const catCounts = CATEGORIES.map((c) => `${AVAILABLE.terminids[c].length} ${CATEGORY_LABEL[c].toLowerCase()}`).join(', ');

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

        <H id="equations">The pricing algorithm, in full</H>
        <p>
          Nothing about the market is secret. This section is the complete algorithm with every number it uses, read live from the market’s current settings, so it can’t fall out of date. The code is{' '}
          <Code>engine/src/market/</Code> in the{' '}
          <a className="text-yellow hover:underline" href={REPO_URL} target="_blank" rel="noreferrer">
            source repository
          </a>
          .
        </p>

        <H3 id="schedule">When prices change, and what counts</H3>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>
            Prices change once a day, at <span className="text-text">09:00 UTC</span>. That run is skipped if the previous update was less than 20 hours ago, so a retried trigger can’t run two days at once.
          </li>
          <li>
            When a squad that contributes to the market deploys, each Helldiver’s loadout is added to its front’s queue: the front, the seven items, and the price paid for each slot (0 for free picks). A
            cancelled deploy is taken back out. Nothing else is recorded.
          </li>
          <li>
            Each front (Terminids, Automatons, Illuminate) is a separate market with four categories. Every category is priced independently. Against the Terminids there are {catCounts}.
          </li>
          <li>
            The update below runs for every front and category; <span className="font-mono">N</span> is the number of items in that category on that front, and <span className="font-mono">i</span> is one item.
          </li>
        </ul>

        <H3>Step 1 · Measure popularity</H3>
        <Formula>
          {`picks_i     = loadouts today that brought item i
adjusted_i  = picks_i ÷ ownership_i
observed_i  = (1 − frozenShare) × adjusted_i ÷ Σⱼ adjusted_j
M           = Σⱼ picks_j                                 (today's picks in this category)
w           = ${p.ema} × M ÷ (M + ${p.halfSamplePerItem} × N)
share_i    ← (1 − w) × share_i + w × observed_i            then shares are rescaled to add up to 1`}
        </Formula>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>
            <span className="text-text">ownership</span> is {p.ownershipFactor.base} for gear everyone has, {p.ownershipFactor.warbond} for Warbond gear, {p.ownershipFactor.superstore} for Superstore gear and{' '}
            {p.ownershipFactor.special} for limited gear: fewer players own those, so each pick counts a little more.
          </li>
          <li>
            <span className="text-text">w</span> is how much today counts. A busy day counts up to {p.ema}; a quiet day counts less, so a single squad can move prices but can’t take them over. Today’s weight in each
            category against the Terminids:
          </li>
        </ul>
        <div className="panel-flat mt-3 overflow-x-auto">
          <table className="w-full text-[13.5px] tnum">
            <thead className="text-muted">
              <tr>
                <th className="text-left px-3 py-1.5">Loadouts on a front today</th>
                {CATEGORIES.map((c) => (
                  <th key={c} className="text-right px-3 py-1.5">
                    {CATEGORY_LABEL[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[12, 36, 120, 720].map((l) => (
                <tr key={l} className="border-t border-line">
                  <td className="px-3 py-1">
                    {l} <span className="text-muted">({l / 12 === 1 ? 'one squad' : `${l / 12} squads`}, 3 missions each)</span>
                  </td>
                  {CATEGORIES.map((c) => {
                    const n = AVAILABLE.terminids[c].length;
                    const m = l * SLOTS_PER_CATEGORY[c];
                    return (
                      <td key={c} className="px-3 py-1 text-right">
                        {((p.ema * m) / (m + p.halfSamplePerItem * n)).toFixed(3)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim mt-3">
          <li>
            <span className="text-text">Rotating free stratagems are frozen</span> while free: their picks are left out of today’s count and their share is held (<span className="font-mono">frozenShare</span> is
            their combined share). People pick them partly because they’re free, which says nothing about their real price.
          </li>
          <li>
            <span className="text-text">The always-free items stay in.</span> The Constitution, Peacemaker and High Explosive have shares like everything else. When lots of players lean on them, the paid items in
            their category get a little cheaper to compete.
          </li>
          <li>On a day with no picks in a category, its shares don’t change.</li>
        </ul>

        <H3>Step 2 · Set a target price</H3>
        <Formula>
          {`r_i       = share_i × N                         (1 = exactly a fair share of the category)
target_i  = baseline × F(r_i)
F(r)      = exp(  U × tanh(${p.elasticityUp} × ln r ÷ U) )         when r ≥ 1
F(r)      = exp( −D × tanh(${p.elasticityDown} × ln(1/r) ÷ D) )      when r < 1
U         = ln(${req(p.ceilingPrice)} ÷ baseline)      D = ln(baseline ÷ ${req(p.floorPrice)})`}
        </Formula>
        <p>
          Near a fair share, F behaves like <span className="font-mono">r^{p.elasticityUp}</span> above and <span className="font-mono">r^{p.elasticityDown}</span> below: twice as popular as fair costs about{' '}
          {Math.round((popularityMultiple(2, p, p.baseline.stratagem) - 1) * 100)}% more, half as popular about {Math.round((1 - popularityMultiple(0.5, p, p.baseline.stratagem)) * 100)}% less. Further out it bends
          smoothly into a <span className="text-text">soft ceiling of {req(p.ceilingPrice)}</span> and a <span className="text-text">soft floor of {req(p.floorPrice)}</span>, the same for every category. So gear
          nobody wants keeps getting cheaper until someone gives it a try, and an outlier in a cheap slot (the Ultimatum among secondaries) can cost as much as a top stratagem. Because F is bounded, no pattern of
          play can push a price past the ceiling or below the floor; that’s what lets the market run on its own.
        </p>
        <div className="panel-flat mt-3 overflow-x-auto">
          <table className="w-full text-[13.5px] tnum">
            <thead className="text-muted">
              <tr>
                <th className="text-left px-3 py-1.5">Category</th>
                <th className="text-right px-3 py-1.5">Baseline</th>
                <th className="text-right px-3 py-1.5">U</th>
                <th className="text-right px-3 py-1.5">D</th>
                {[0.1, 0.25, 0.5, 2, 4, 8].map((r) => (
                  <th key={r} className="text-right px-3 py-1.5">
                    {r}×
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((c) => {
                const band = softBand(p.baseline[c], p);
                return (
                  <tr key={c} className="border-t border-line">
                    <td className="px-3 py-1">{CATEGORY_LABEL[c]}</td>
                    <td className="px-3 py-1 text-right">{req(p.baseline[c])}</td>
                    <td className="px-3 py-1 text-right">{band.up.toFixed(3)}</td>
                    <td className="px-3 py-1 text-right">{band.down.toFixed(3)}</td>
                    {[0.1, 0.25, 0.5, 2, 4, 8].map((r) => (
                      <td key={r} className="px-3 py-1 text-right">
                        {req(p.baseline[c] * popularityMultiple(r, p, p.baseline[c]))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[13.5px] text-muted">Target price at a given multiple of a fair share of picks. The chart below plots the whole curve.</p>
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

        <H3>Step 3 · Move toward the target</H3>
        <Formula>
          {`gap    = ln(target ÷ price)
k      = ${p.adjustRate} × (${p.upBias} if rising, ${p.downBias} if falling) × speed × pressure
step   = clamp(min(k, 1) × gap,  ln(1 − ${p.maxStep}),  max(ln(1 + ${p.maxStep}), ln(1 + ${p.minClimb} × baseline ÷ price)))
price ← clamp(price × e^step, ${req(market.config.minPrice)}, ${req(market.config.maxPrice)})`}
        </Formula>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>
            Each day a price closes about {Math.round(p.adjustRate * p.upBias * 100)}% of the (logarithmic) gap to its target when rising and {Math.round(p.adjustRate * p.downBias * 100)}% when falling.
          </li>
          <li>
            It falls at most {Math.round(p.maxStep * 100)}% a day and rises at most {Math.round(p.maxStep * 100)}%, or {Math.round(p.minClimb * 100)}% of its category baseline if that’s more (
            {CATEGORIES.map((c) => `${req(p.minClimb * p.baseline[c])} for ${CATEGORY_LABEL[c].toLowerCase()}`).join(', ')}). That lets gear sitting near the floor climb back within days once people want it.
          </li>
          <li>
            <span className="font-mono">speed</span> and <span className="font-mono">pressure</span> are optional modifiers:{' '}
            <span className="font-mono">speed = max({p.minSpeed}, 2q^γ ÷ (1 + q^γ))</span> with <span className="font-mono">q = price ÷ baseline</span> and γ = {p.speedExponent}, and{' '}
            <span className="font-mono">pressure = 2 ÷ (1 + e^(±{p.spendPressure} × heat))</span> (− when rising, + when falling), where <span className="font-mono">heat</span> is a smoothed{' '}
            <span className="font-mono">ln(spend per slot ÷ baseline)</span>, clamped to ±2 and updated with the same <span className="font-mono">w</span>.{' '}
            {p.speedExponent === 0 && p.spendPressure === 0
              ? 'Both are switched off (each is always 1): the first kept gear near the floor stuck there, and the second sped up rises when players spent little.'
              : `Right now ${p.speedExponent === 0 ? 'speed is off (always 1)' : 'speed is on'} and ${p.spendPressure === 0 ? 'pressure is off (always 1)' : 'pressure is on'}.`}
          </li>
          <li>
            What you pay is the price rounded to the nearest {market.config.quoteStep}, and never less than {req(market.config.minPrice)}.
          </li>
        </ul>

        <H3>Step 4 · Rotate the free stratagems</H3>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-dim">
          <li>
            Each front has <span className="text-text">{market.config.free.count}</span> free stratagems. Each stays free for {market.config.free.tenure} days, then can’t be free again for{' '}
            {market.config.free.cooldown} days.
          </li>
          <li>
            Open slots go to the {market.config.free.rule === 'cheapest' ? 'cheapest stratagems by list price (ties: the least popular)' : market.config.free.rule === 'least-popular' ? 'least popular stratagems' : 'a random pick among the cheapest quarter'}{' '}
            that aren’t cooling down. At launch the slots are staggered so about one changes per day.
          </li>
          <li>While free, a stratagem’s price and popularity are frozen (step 1); it goes back on sale at the price it had.</li>
          <li>The Constitution, Peacemaker and High Explosive are always free and have no price.</li>
        </ul>

        <H3>Launch prices</H3>
        <p>
          Day one started from the u.gg tier lists, per front: each item’s starting price was its category baseline times{' '}
          {TIERS.map((t) => `${TIER_MULTIPLE[t]} (${t})`).join(', ')}. Each item was then given the popularity that would justify that price (the inverse of F), the popularities were rescaled to add up to 1, and
          every starting price was set to the target of its rescaled popularity. That last step means an update with no loadouts changes nothing: prices only move when people play.
        </p>
        <p className="mt-3">
          Baselines are tuned so the average loadout price (the community’s picks at full price, weighted by how often each item is picked) settles near 16,000, about two Super Helldive payouts. The market
          deliberately doesn’t steer spending toward that number: what players can spend is capped by what they earn, so a controller that chased spending would raise prices exactly when players are broke.
        </p>

        <H3 id="parameters">Every setting (live values)</H3>
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
              {(
                [
                  ['anchored.ownershipFactor.base', p.ownershipFactor.base, 'Picks of gear everyone owns are divided by this.'],
                  ['free.rule', market.config.free.rule, 'How open free slots are filled: cheapest, least-popular or random-bottom.'],
                  ['quoteStep', market.config.quoteStep, 'Prices are rounded to this many Requisition.'],
                ] as [string, string | number, string][]
              ).map(([path, v, d]) => (
                <tr key={path} className="border-t border-line">
                  <td className="px-3 py-1.5 font-mono text-yellow whitespace-nowrap">{path}</td>
                  <td className="px-3 py-1.5 tnum text-text text-right">{String(v)}</td>
                  <td className="px-3 py-1.5 text-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[14px]">
          The original prototype’s algorithm is kept for comparison as <Code>legacy</Code>. It nudged prices by how far popularity was from a fair share every day, which drifts: junk can never reach a fair share,
          so prices kept sliding toward the floor. Here the floor is only where gear nobody uses ends up, never where the whole market slides.
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
          <li>no runaway prices (fail above the soft ceiling), no collapse to the minimum, no drift once settled, prices that move every day without thrashing</li>
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
          Results (120 days, seed 1): the live algorithm passes 11 of 12 scenarios and warns on 1 (when demand is spread evenly, the gap between niche and meta prices narrows). Across seeds 1–3 it never fails.
          Balance patches are absorbed in about 9 days, and a brigade submitting a sixth of all traffic peaks at 87% of the ceiling. Full details in{' '}
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
            ['Can something become free?', `The three permanently free items always are, and the cheapest stratagems on each front rotate through the free slots. Paid gear nobody uses keeps getting cheaper, down to ${req(p.floorPrice)} Requisition, until someone gives it a try.`],
            ['What if I can’t afford anything?', 'You can always deploy with free gear. In Operations money can’t end your run — failing a mission can.'],
            ['Can prices go crazy?', `No. Every price stays between a soft floor (${req(p.floorPrice)}) and a soft ceiling (${req(p.ceilingPrice)}), and moves at most ${Math.round(p.maxStep * 100)}% a day (cheap gear may climb a little faster). Our simulations specifically test for runaway prices, collapses and oscillation.`],
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
