#!/usr/bin/env node
/**
 * Squad simulation harness.
 *
 *   npm run sim                                   # whole scenario suite, anchored algorithm
 *   npm run sim -- baseline --days 180            # one scenario, verbose
 *   npm run sim -- --compare                      # suite: anchored vs the original prototype
 *   npm run sim -- baseline --set anchored.elasticityUp=1.1 --set free.count=6
 *   npm run sim -- meta-rush --json out.json --csv reports/   # dump data for spreadsheets
 */
import * as fs from 'fs';
import * as path from 'path';
import { AVAILABLE, CATEGORY_LABEL, FACTION_LABEL, ITEMS } from '../catalog/catalog';
import { CATEGORIES, FACTIONS } from '../catalog/types';
import { defaultConfig, setParam, type Algorithm, type MarketConfig } from '../market/config';
import type { HealthCheck, Verdict } from '../sim/health';
import { SCENARIOS, scenarioById, type Scenario } from '../sim/scenarios';
import { simulate, type SimResult } from '../sim/simulate';
import { c, lpad, money, num, pad, parseArgs } from './args';
import { writeHtmlReport } from './html-report';

const args = parseArgs(process.argv.slice(2));

if (args.flags.help || args.flags.h) {
  console.log(`Usage: npm run sim -- [scenario|all] [options]

Scenarios:
${SCENARIOS.map((s) => `  ${pad(s.id, 16)} ${s.description}`).join('\n')}

Options:
  --algorithm anchored|legacy   pricing algorithm (default anchored)
  --compare                     run both algorithms side by side
  --days N  --squads N  --seed N
  --set path=value              override any config value (repeatable), e.g. --set anchored.maxStep=0.15
  --seeds N                     repeat each scenario over N seeds and report the worst verdicts
  --json FILE  --csv DIR  --html FILE
  --list-params                 print every tunable parameter`);
  process.exit(0);
}

if (args.flags['list-params']) {
  const { PARAM_SPECS, getParam } = require('../market/config') as typeof import('../market/config');
  const cfg = defaultConfig();
  for (const p of PARAM_SPECS) console.log(`${pad(p.path, 34)} ${lpad(String(getParam(cfg, p.path)), 8)}  ${c.dim(p.description)}`);
  process.exit(0);
}

function buildConfig(algorithm: Algorithm): MarketConfig {
  let cfg = defaultConfig();
  cfg.algorithm = algorithm;
  for (const [k, v] of args.sets) cfg = setParam(cfg, k, v);
  return cfg;
}

const VERDICT_STYLE: Record<Verdict, (s: string) => string> = {
  pass: (s) => c.green(s),
  warn: (s) => c.yellow(s),
  fail: (s) => c.red(c.bold(s)),
  info: (s) => c.dim(s),
};
const badge = (v: Verdict) => VERDICT_STYLE[v](pad(v.toUpperCase(), 4));

function runOne(scenario: Scenario, algorithm: Algorithm, seed: number): SimResult {
  return simulate({
    scenario,
    config: buildConfig(algorithm),
    seed,
    days: args.flags.days ? num(args.flags.days, scenario.days) : undefined,
    squadsPerDay: args.flags.squads ? num(args.flags.squads, scenario.squadsPerDay) : undefined,
  });
}

function printDetail(r: SimResult): void {
  const cfg = r.config;
  console.log();
  console.log(c.bold(c.yellow(`▌ ${r.scenario.name.toUpperCase()}`)) + c.dim(`  (${r.scenario.id}, ${cfg.algorithm}, seed ${r.seed}, ${r.days.length} cycles, ${r.elapsedMs} ms)`));
  console.log(c.dim(`  ${r.scenario.description}`));
  console.log(c.dim(`  Expect: ${r.scenario.expectation}`));
  console.log();
  for (const ch of r.health.checks) console.log(`  ${badge(ch.verdict)}  ${pad(ch.label, 40)} ${ch.value}`);
  console.log();

  const days = r.days;
  const marks = [1, ...[0.25, 0.5, 0.75].map((q) => Math.round(days.length * q)), days.length].filter((d, i, a) => d > 0 && a.indexOf(d) === i);
  console.log(c.bold('  Price level (median paid price) by cycle'));
  console.log('  ' + pad('', 26) + marks.map((d) => lpad(`#${d}`, 9)).join(''));
  for (const f of FACTIONS)
    for (const cat of CATEGORIES)
      console.log('  ' + pad(`${FACTION_LABEL[f]} ${CATEGORY_LABEL[cat]}`, 26) + marks.map((d) => lpad(money(days[d - 1].median[f][cat]), 9)).join(''));
  console.log('  ' + pad('Avg loadout spend', 26) + marks.map((d) => lpad(money(days[d - 1].avgSpend), 9)).join(''));
  console.log('  ' + pad('Avg diver balance', 26) + marks.map((d) => lpad(money(days[d - 1].avgBalance), 9)).join(''));
  console.log('  ' + pad('Mission success', 26) + marks.map((d) => lpad(`${Math.round(days[d - 1].successRate * 100)}%`, 9)).join(''));
  console.log('  ' + pad('Typical loadout (list)', 26) + marks.map((d) => lpad(money(days[d - 1].typicalLoadout), 9)).join(''));
  for (const cat of CATEGORIES)
    console.log(
      '  ' +
        pad(`Free uptake ${CATEGORY_LABEL[cat]}`, 26) +
        marks.map((d) => lpad(`${Math.round(days[d - 1].freeUptake[cat] * 100)}%`, 9)).join('') +
        c.dim(`   variety ${days[days.length - 1].diversity[cat].toFixed(1)} vs ${r.control ? r.control.diversity[cat].toFixed(1) : '?'} unpriced`),
    );
  console.log();

  const final = r.prices.terminids.length - 1;
  for (const f of FACTIONS) {
    console.log(c.bold(`  ${FACTION_LABEL[f]} — most and least expensive stratagems`));
    const strats = AVAILABLE[f].stratagem.filter((i) => !i.alwaysFree).map((i) => ({ i, p: r.prices[f][final][i.index] }));
    strats.sort((a, b) => b.p - a.p);
    const row = (x: { i: (typeof ITEMS)[number]; p: number }) =>
      `${pad(x.i.name, 34)} ${lpad(money(x.p), 7)}  ${c.dim(`tier ${x.i.tiers[f]}  share ${(r.final.books[f].items[x.i.index]!.share * 100).toFixed(1)}%`)}`;
    strats.slice(0, 5).forEach((x) => console.log('    ' + row(x)));
    console.log(c.dim('    …'));
    strats.slice(-3).forEach((x) => console.log('    ' + row(x)));
    const free = r.final.books[f].free.map((i) => ITEMS[i].short).join(', ');
    console.log(c.dim(`    free now: ${free}`));
  }
}

function writeCsv(r: SimResult, dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FACTIONS) {
    const ids = ITEMS.filter((i) => i.tiers[f]);
    const lines = ['cycle,' + ids.map((i) => `"${i.name}"`).join(',')];
    r.prices[f].forEach((day, d) => lines.push([d, ...ids.map((i) => day[i.index])].join(',')));
    fs.writeFileSync(path.join(dir, `${r.scenario.id}_${r.config.algorithm}_${f}_prices.csv`), lines.join('\n'));
  }
  const keys = ['day', 'loadouts', 'avgSpend', 'zeroCostShare', 'successRate', 'avgBalance', 'bankruptcies', 'maxPrice', 'floorShare', 'volatility'] as const;
  const lines = [keys.join(',') + ',' + CATEGORIES.map((cat) => `diversity_${cat},freeUptake_${cat}`).join(',')];
  for (const d of r.days) lines.push([...keys.map((k) => d[k]), ...CATEGORIES.flatMap((cat) => [d.diversity[cat], d.freeUptake[cat]])].join(','));
  fs.writeFileSync(path.join(dir, `${r.scenario.id}_${r.config.algorithm}_daily.csv`), lines.join('\n'));
}

function main(): void {
  const which = args._[0] ?? 'all';
  const scenarios = which === 'all' ? SCENARIOS : [scenarioById(which)].filter((s): s is Scenario => !!s);
  if (!scenarios.length) {
    console.error(`Unknown scenario "${which}". Try --help.`);
    process.exit(1);
  }
  const algorithms: Algorithm[] = args.flags.compare ? ['legacy', 'anchored'] : [(args.flags.algorithm as Algorithm) || 'anchored'];
  const seeds = Math.max(1, num(args.flags.seeds, 1));
  const seed0 = num(args.flags.seed, 1);
  const verbose = scenarios.length === 1 || !!args.flags.verbose;
  const results: SimResult[] = [];
  const t0 = Date.now();

  for (const scenario of scenarios) {
    for (const algorithm of algorithms) {
      for (let s = 0; s < seeds; s++) {
        const r = runOne(scenario, algorithm, seed0 + s);
        results.push(r);
        if (verbose && s === 0) printDetail(r);
        if (args.flags.csv) writeCsv(r, String(args.flags.csv));
      }
    }
  }

  // Suite matrix.
  const checkIds = [...new Set(results.flatMap((r) => r.health.checks.filter((ch) => ch.verdict !== 'info').map((ch) => ch.id)))];
  const short: Record<string, string> = {
    ceiling: 'ceil',
    collapse: 'clps',
    drift: 'drft',
    volatility: 'vol',
    'meta-expensive': 'meta',
    'niche-affordable': 'nich',
    'premium-survives': 'prem',
    affordability: 'afrd',
    spread: 'sprd',
    'free-rotation': 'free',
    factions: 'fact',
    adaptation: 'adpt',
    brigade: 'brig',
  };
  console.log();
  console.log(c.bold('  SCENARIO SUITE') + c.dim(`  (${results.length} runs, ${((Date.now() - t0) / 1000).toFixed(1)} s)`));
  console.log('  ' + pad('scenario', 22) + pad('algorithm', 10) + checkIds.map((id) => pad(short[id] ?? id.slice(0, 4), 6)).join('') + 'overall');
  const worst = (vs: Verdict[]): Verdict => (vs.includes('fail') ? 'fail' : vs.includes('warn') ? 'warn' : vs.includes('pass') ? 'pass' : 'info');
  for (const scenario of scenarios) {
    for (const algorithm of algorithms) {
      const runs = results.filter((r) => r.scenario.id === scenario.id && r.config.algorithm === algorithm);
      const cells = checkIds.map((id) => {
        const vs = runs.map((r) => r.health.checks.find((ch) => ch.id === id)?.verdict).filter((v): v is Verdict => !!v);
        return vs.length ? VERDICT_STYLE[worst(vs)](pad(worst(vs) === 'pass' ? '✓' : worst(vs) === 'warn' ? '!' : worst(vs) === 'fail' ? '✗' : '·', 6)) : pad('', 6);
      });
      const overall = worst(runs.map((r) => r.health.verdict));
      console.log('  ' + pad(scenario.id, 22) + pad(algorithm, 10) + cells.join('') + badge(overall));
    }
  }
  console.log(c.dim('  ✓ pass  ! warn  ✗ fail   ' + checkIds.map((id) => `${short[id] ?? id}=${results[0].health.checks.find((ch: HealthCheck) => ch.id === id)?.label ?? id}`).slice(0, 13).join(' · ')));

  if (args.flags.json) {
    const slim = results.map((r) => ({
      scenario: r.scenario.id,
      algorithm: r.config.algorithm,
      seed: r.seed,
      health: r.health,
      days: r.days,
      finalPrices: Object.fromEntries(FACTIONS.map((f) => [f, Object.fromEntries(ITEMS.filter((i) => i.tiers[f]).map((i) => [i.id, r.prices[f][r.prices[f].length - 1][i.index]]))])),
    }));
    fs.writeFileSync(String(args.flags.json), JSON.stringify(slim, null, 1));
    console.log(c.dim(`  wrote ${args.flags.json}`));
  }
  if (args.flags.html) {
    writeHtmlReport(results, String(args.flags.html));
    console.log(c.dim(`  wrote ${args.flags.html}`));
  }
  if (results.some((r) => r.health.verdict === 'fail') && args.flags.strict) process.exit(2);
}

main();
