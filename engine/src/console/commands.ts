/**
 * The market console: one command set for the shell (`npm run market -- <command>`) and the
 * in-browser ship terminal. Commands operate on a market + history and return styled lines;
 * hosts persist whatever comes back.
 */
import { AVAILABLE, CATEGORY_LABEL, FACTION_LABEL, ITEMS, searchItems, STRATAGEM_TYPE_LABEL } from '../catalog/catalog';
import { CATEGORIES, FACTIONS, type Category, type Faction, type Item } from '../catalog/types';
import { batchSize } from '../market/batch';
import { defaultConfig, getParam, PARAM_SPECS, setParam } from '../market/config';
import { freeCyclesLeft, quote } from '../market/free';
import { emptyHistory, priceSeries, recordHistory, type MarketHistory } from '../market/history';
import { pendingCount, submitLoadout, summarizeCategory, typicalLoadoutCost, updateMarket } from '../market/market';
import { createMarket, PRESETS, type PresetId } from '../market/presets';
import type { MarketState, UpdateReport } from '../market/types';
import { SCENARIOS, scenarioById } from '../sim/scenarios';
import { simulate } from '../sim/simulate';
import { generateSubmissions } from '../sim/synthetic';
import { blank, changeTone, heading, line, money, muted, padEnd, padStart, pct, seg, signedPct, sparkline, type Line } from './format';

export interface ConsoleContext {
  market: MarketState;
  history: MarketHistory;
}

export interface CommandResult {
  lines: Line[];
  market?: MarketState;
  history?: MarketHistory;
  /** Something hosts may want to react to (refresh views, open a file picker, ...). */
  effect?: 'market-changed' | 'market-replaced';
}

interface Parsed {
  words: string[];
  flags: Record<string, string | true>;
}

function parse(input: string): Parsed {
  const tokens = input.match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, '')) ?? [];
  const words: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      const [k, v] = t.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) flags[k] = tokens[++i];
      else flags[k] = true;
    } else words.push(t);
  }
  return { words, flags };
}

const FACTION_ALIASES: Record<string, Faction> = {
  t: 'terminids', term: 'terminids', terminid: 'terminids', terminids: 'terminids', bugs: 'terminids', bug: 'terminids',
  a: 'automatons', auto: 'automatons', automaton: 'automatons', automatons: 'automatons', bots: 'automatons', bot: 'automatons',
  i: 'illuminate', ill: 'illuminate', illuminate: 'illuminate', squids: 'illuminate', squid: 'illuminate',
};
const CATEGORY_ALIASES: Record<string, Category> = {
  s: 'stratagem', strat: 'stratagem', strats: 'stratagem', stratagem: 'stratagem', stratagems: 'stratagem',
  p: 'primary', primary: 'primary', primaries: 'primary',
  sec: 'secondary', secondary: 'secondary', secondaries: 'secondary', sidearm: 'secondary', sidearms: 'secondary',
  g: 'throwable', grenade: 'throwable', grenades: 'throwable', throwable: 'throwable', throwables: 'throwable',
};
const asFaction = (w?: string) => (w ? FACTION_ALIASES[w.toLowerCase()] : undefined);
const asCategory = (w?: string) => (w ? CATEGORY_ALIASES[w.toLowerCase()] : undefined);
const num = (v: string | true | undefined, d: number) => (typeof v === 'string' && Number.isFinite(+v) ? +v : d);

const err = (msg: string): CommandResult => ({ lines: [line(seg('✖ ', 'bad'), seg(msg, 'bad'))] });

interface CommandDef {
  usage: string;
  summary: string;
  run: (p: Parsed, ctx: ConsoleContext) => CommandResult;
}

function findItem(query: string): Item | string {
  const hits = searchItems(query);
  if (!hits.length) return `No item matches "${query}".`;
  if (hits.length > 1 && !hits.some((h) => h.short.toLowerCase() === query.toLowerCase() || h.name.toLowerCase() === query.toLowerCase())) {
    return `"${query}" is ambiguous: ${hits.slice(0, 6).map((h) => h.name).join(', ')}${hits.length > 6 ? ', …' : ''}`;
  }
  return hits.find((h) => h.short.toLowerCase() === query.toLowerCase() || h.name.toLowerCase() === query.toLowerCase()) ?? hits[0];
}

function priceCell(state: MarketState, f: Faction, it: Item): [string, Line[number]['c']] {
  const q = quote(state, f, it.index);
  if (!q.available) return ['—', 'muted'];
  if (it.alwaysFree) return ['FREE*', 'good'];
  if (q.rotating) return [`FREE (${money(q.list)})`, 'good'];
  return [money(q.price), 'default'];
}

function changeOf(state: MarketState, f: Faction, it: Item): number {
  const b = state.books[f].items[it.index];
  return b && b.prevPrice > 0 ? b.price / b.prevPrice - 1 : 0;
}

function summarizeReport(report: UpdateReport, state: MarketState): Line[] {
  const lines: Line[] = [];
  const total = FACTIONS.reduce((s, f) => s + report.loadouts[f], 0);
  lines.push(
    line(
      seg(`▌ MARKET CYCLE #${report.day} COMPLETE`, 'heading'),
      seg(`  ${money(total)} loadouts processed (${FACTIONS.map((f) => `${FACTION_LABEL[f]} ${money(report.loadouts[f])}`).join(' · ')}) · ${report.algorithm}`, 'muted'),
    ),
  );
  const moves = report.changes.filter((c) => c.before > 0).map((c) => ({ ...c, d: c.after / c.before - 1 }));
  const risers = [...moves].sort((a, b) => b.d - a.d).slice(0, 5);
  const fallers = [...moves].sort((a, b) => a.d - b.d).slice(0, 5);
  const row = (m: (typeof moves)[number]) =>
    line(
      '   ',
      seg(padEnd(ITEMS[m.index].name, 34)),
      seg(padEnd(FACTION_LABEL[m.faction], 12), 'muted'),
      seg(padStart(money(m.before), 7), 'muted'),
      ' → ',
      seg(padStart(money(m.after), 7)),
      '  ',
      seg(padStart(signedPct(m.d), 7), changeTone(m.d)),
    );
  if (risers.length && risers[0].d > 0) {
    lines.push(line(seg('  Biggest risers', 'accent')));
    risers.filter((m) => m.d > 0).forEach((m) => lines.push(row(m)));
  }
  if (fallers.length && fallers[0].d < 0) {
    lines.push(line(seg('  Biggest fallers', 'accent')));
    fallers.filter((m) => m.d < 0).forEach((m) => lines.push(row(m)));
  }
  for (const f of FACTIONS) {
    const added = report.freeAfter[f].filter((i) => !report.freeBefore[f].includes(i));
    const removed = report.freeBefore[f].filter((i) => !report.freeAfter[f].includes(i));
    if (added.length || removed.length)
      lines.push(
        line(
          seg(`  Free rotation ${FACTION_LABEL[f]}: `, 'muted'),
          ...added.map((i) => seg(`+${ITEMS[i].short} `, 'good')),
          ...removed.map((i) => seg(`−${ITEMS[i].short} `, 'muted')),
        ),
      );
  }
  if (total === 0) lines.push(muted('  No submissions were pending, so popularity was unchanged; prices kept easing toward their targets.'));
  lines.push(muted(`  Typical loadout now ${FACTIONS.map((f) => `${FACTION_LABEL[f]} ${money(typicalLoadoutCost(state, f))}`).join(' · ')}`));
  return lines;
}

const COMMANDS: Record<string, CommandDef> = {
  help: {
    usage: 'help [command]',
    summary: 'List commands, or explain one.',
    run: ({ words }) => {
      if (words[0] && COMMANDS[words[0]]) {
        const c = COMMANDS[words[0]];
        return { lines: [line(seg(c.usage, 'accent')), line(c.summary)] };
      }
      return {
        lines: [
          heading('SHIP MANAGEMENT TERMINAL — MARKET COMMANDS'),
          ...Object.entries(COMMANDS).map(([, c]) => line(seg(padEnd(c.usage, 44), 'accent'), seg(c.summary, 'muted'))),
          muted('Factions: bugs/terminids · bots/automatons · squids/illuminate. Categories: strat · primary · secondary · grenade.'),
        ],
      };
    },
  },

  status: {
    usage: 'status',
    summary: 'Market overview: cycle, queue, price levels, free stratagems.',
    run: (_p, { market }) => {
      const lines: Line[] = [
        heading(`GALACTIC MARKET — CYCLE #${market.day}`),
        line(
          seg('  algorithm ', 'muted'),
          seg(market.config.algorithm, 'accent'),
          seg('   started from ', 'muted'),
          seg(market.preset.id),
          seg('   pending loadouts ', 'muted'),
          seg(money(pendingCount(market)), pendingCount(market) ? 'warn' : 'default'),
        ),
        blank(),
        line(seg(padEnd('  median price', 16), 'muted'), ...CATEGORIES.map((c) => seg(padStart(CATEGORY_LABEL[c], 13), 'muted')), seg(padStart('typical kit', 14), 'muted')),
      ];
      for (const f of FACTIONS) {
        lines.push(
          line(
            seg(padEnd(`  ${FACTION_LABEL[f]}`, 16)),
            ...CATEGORIES.map((c) => seg(padStart(money(summarizeCategory(market, f, c).median), 13))),
            seg(padStart(money(typicalLoadoutCost(market, f)), 14), 'accent'),
          ),
        );
      }
      lines.push(blank());
      for (const f of FACTIONS)
        lines.push(
          line(
            seg(padEnd(`  Free vs ${FACTION_LABEL[f]}`, 24), 'muted'),
            seg(market.books[f].free.map((i) => `${ITEMS[i].short} (${freeCyclesLeft(market, f, i)})`).join(' · '), 'good'),
          ),
        );
      lines.push(muted('  (n) = cycles left free. Always free: R-2124 Constitution, P-2 Peacemaker, G-12 High Explosive.'));
      return { lines };
    },
  },

  prices: {
    usage: 'prices [faction] [category] [--sort price|share|change|name] [--top N]',
    summary: 'Price board for one faction market.',
    run: ({ words, flags }, { market }) => {
      const f = words.map(asFaction).find(Boolean) ?? 'terminids';
      const c = words.map(asCategory).find(Boolean) ?? 'stratagem';
      const sort = String(flags.sort ?? 'price');
      const top = num(flags.top, c === 'stratagem' ? 25 : 60);
      const book = market.books[f];
      const items = [...AVAILABLE[f][c]];
      items.sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'share') return book.items[b.index]!.share - book.items[a.index]!.share;
        if (sort === 'change') return changeOf(market, f, b) - changeOf(market, f, a);
        return book.items[b.index]!.price - book.items[a.index]!.price;
      });
      const lines: Line[] = [
        heading(`${CATEGORY_LABEL[c].toUpperCase()} vs ${FACTION_LABEL[f].toUpperCase()} — cycle #${market.day}`),
        line(seg(padEnd('  item', 38), 'muted'), seg(padEnd('tier', 6), 'muted'), seg(padStart('price', 16), 'muted'), seg(padStart('change', 9), 'muted'), seg(padStart('share', 8), 'muted')),
      ];
      for (const it of items.slice(0, top)) {
        const [p, tone] = priceCell(market, f, it);
        const d = changeOf(market, f, it);
        lines.push(
          line(
            seg(padEnd(`  ${it.name}`, 38)),
            seg(padEnd(it.tiers[f] ?? '—', 6), 'muted'),
            seg(padStart(p, 16), tone),
            seg(padStart(it.alwaysFree ? '' : signedPct(d), 9), changeTone(d)),
            seg(padStart(pct(book.items[it.index]!.share, 1), 8), 'muted'),
          ),
        );
      }
      if (items.length > top) lines.push(muted(`  … ${items.length - top} more (use --top ${items.length})`));
      return { lines };
    },
  },

  price: {
    usage: 'price <item>',
    summary: 'One item across all three faction markets.',
    run: ({ words }, { market, history }) => {
      if (!words.length) return err('Which item? e.g. price railgun');
      const it = findItem(words.join(' '));
      if (typeof it === 'string') return err(it);
      const lines: Line[] = [
        heading(it.name.toUpperCase()),
        muted(`  ${it.category === 'stratagem' ? STRATAGEM_TYPE_LABEL[it.type!] : CATEGORY_LABEL[it.category].replace(/s$/, '')} · ${it.source}${it.code ? ` · code ${it.code.replace(/U/g, '↑').replace(/D/g, '↓').replace(/L/g, '←').replace(/R/g, '→')}` : ''}`),
      ];
      for (const f of FACTIONS) {
        const [p, tone] = priceCell(market, f, it);
        const series = priceSeries(history, f, it.index).map((s) => s.price);
        const b = market.books[f].items[it.index];
        lines.push(
          line(
            seg(padEnd(`  vs ${FACTION_LABEL[f]}`, 18)),
            seg(padEnd(`tier ${it.tiers[f] ?? '—'}`, 9), 'muted'),
            seg(padStart(p, 16), tone),
            seg(padStart(b ? pct(b.share, 2) : '', 9), 'muted'),
            seg('  ' + sparkline(series, 28), 'info'),
          ),
        );
      }
      return { lines };
    },
  },

  free: {
    usage: 'free',
    summary: 'Which stratagems are free right now, and for how long.',
    run: (_p, { market }) => ({
      lines: [
        heading('FREE OF CHARGE'),
        muted('  Always: R-2124 Constitution · P-2 Peacemaker · G-12 High Explosive'),
        ...FACTIONS.map((f) =>
          line(
            seg(padEnd(`  vs ${FACTION_LABEL[f]}`, 18)),
            ...market.books[f].free.map((i) => seg(`${ITEMS[i].short} `, 'good')).flatMap((s, k) => [s, seg(`(${freeCyclesLeft(market, f, market.books[f].free[k])}) `, 'muted')]),
          ),
        ),
        muted(`  Rule: ${market.config.free.rule}, ${market.config.free.count} per faction, ${market.config.free.tenure} cycles each, ${market.config.free.cooldown}-cycle cooldown.`),
      ],
    }),
  },

  pending: {
    usage: 'pending',
    summary: 'Loadouts waiting for the next market update.',
    run: (_p, { market }) => {
      const n = pendingCount(market);
      const lines: Line[] = [heading(`PENDING: ${money(n)} LOADOUTS`)];
      for (const f of FACTIONS) {
        const counts = market.pending.counts[f];
        const top = ITEMS.map((it) => ({ it, n: counts[it.index] }))
          .filter((x) => x.n > 0 && x.it.category === 'stratagem')
          .sort((a, b) => b.n - a.n)
          .slice(0, 5);
        lines.push(
          line(
            seg(padEnd(`  ${FACTION_LABEL[f]}`, 14)),
            seg(padStart(money(market.pending.loadouts[f]), 6), 'accent'),
            seg('  top stratagems: ', 'muted'),
            seg(top.map((x) => `${x.it.short} ×${x.n}`).join(', ') || '—'),
          ),
        );
      }
      const recent = market.recent.slice(-5).reverse();
      if (recent.length) {
        lines.push(muted('  latest:'));
        for (const s of recent)
          lines.push(
            line(
              seg(`   ${s.origin.padEnd(6)} `, 'muted'),
              seg(padEnd(FACTION_LABEL[s.faction], 12)),
              seg(s.items.map((i) => ITEMS[i].short).join(', ')),
              seg(`  ${money(s.paid.reduce((a, b) => a + b, 0))} req`, 'accent'),
            ),
          );
      }
      return { lines };
    },
  },

  update: {
    usage: 'update [times]',
    summary: 'Run the price update on everything pending (repeat to keep easing toward targets).',
    run: ({ words }, ctx) => {
      const times = Math.max(1, Math.min(365, num(words[0], 1)));
      let history = ctx.history;
      const lines: Line[] = [];
      for (let k = 0; k < times; k++) {
        const report = updateMarket(ctx.market);
        history = recordHistory(history, ctx.market);
        if (k === times - 1) lines.push(...summarizeReport(report, ctx.market));
      }
      if (times > 1) lines.unshift(muted(`  ran ${times} cycles`));
      return { lines, market: ctx.market, history, effect: 'market-changed' };
    },
  },

  sim: {
    usage: 'sim squads <n> | sim day <n> | sim run <scenario> [--days N]',
    summary: 'Synthetic squads: queue loadouts, queue + update, or run a full scenario on a copy.',
    run: ({ words, flags }, ctx) => {
      const sub = words[0];
      if (sub === 'squads' || sub === 'day') {
        const n = Math.max(1, Math.min(5000, num(words[1], 25)));
        const subs = generateSubmissions(ctx.market, { squads: n, seed: typeof flags.seed === 'string' ? flags.seed : undefined });
        for (const s of subs) submitLoadout(ctx.market, s);
        const lines: Line[] = [line(seg('✔ ', 'good'), seg(`${money(subs.length)} loadouts from ${n} simulated squads queued.`), seg(` Pending: ${money(pendingCount(ctx.market))}.`, 'muted'))];
        if (sub === 'squads') return { lines, market: ctx.market, effect: 'market-changed' };
        const report = updateMarket(ctx.market);
        const history = recordHistory(ctx.history, ctx.market);
        return { lines: [...lines, ...summarizeReport(report, ctx.market)], market: ctx.market, history, effect: 'market-changed' };
      }
      if (sub === 'run') {
        const scenario = scenarioById(words[1] ?? 'baseline');
        if (!scenario) return err(`Unknown scenario. Try one of: ${SCENARIOS.map((s) => s.id).join(', ')}`);
        const r = simulate({ scenario, config: ctx.market.config, days: num(flags.days, scenario.days), seed: num(flags.seed, 1) });
        return {
          lines: [
            heading(`SIMULATION — ${scenario.name.toUpperCase()} (${r.days.length} cycles, ${r.elapsedMs} ms)`),
            muted(`  ${scenario.description}`),
            ...r.health.checks.map((ch) =>
              line(
                seg(`  ${ch.verdict.toUpperCase().padEnd(5)}`, ch.verdict === 'pass' ? 'good' : ch.verdict === 'warn' ? 'warn' : ch.verdict === 'fail' ? 'bad' : 'muted'),
                seg(padEnd(ch.label, 40)),
                seg(ch.value, 'muted'),
              ),
            ),
            muted('  Runs on a copy with your current config; the live market is untouched. Open the Market Lab for charts.'),
          ],
        };
      }
      return err('Usage: sim squads <n> | sim day <n> | sim run <scenario>');
    },
  },

  init: {
    usage: 'init <preset> [--seed N] [--scale X] [--flat P]',
    summary: `Re-initialize the market (${PRESETS.map((p) => p.id).join(', ')}). Wipes history.`,
    run: ({ words, flags }, ctx) => {
      const id = (words[0] ?? '') as PresetId;
      if (!PRESETS.some((p) => p.id === id))
        return { lines: [heading('PRESETS'), ...PRESETS.map((p) => line(seg(padEnd(`  ${p.id}`, 18), 'accent'), seg(p.description, 'muted'))), muted('  usage: init <preset> [--seed N] [--scale X] [--flat P]')] };
      const market = createMarket(id, { seed: num(flags.seed, 1), scale: num(flags.scale, 1), flatPrice: num(flags.flat, 3000) }, ctx.market.config);
      const history = recordHistory(emptyHistory(), market);
      return {
        lines: [line(seg('✔ ', 'good'), seg(`Market re-initialized from "${id}".`), seg(` ${PRESETS.find((p) => p.id === id)!.description}`, 'muted'))],
        market,
        history,
        effect: 'market-replaced',
      };
    },
  },

  config: {
    usage: 'config [list | get <path> | set <path> <value> | reset]',
    summary: 'Inspect or tune the pricing equations live.',
    run: ({ words }, ctx) => {
      const [sub, path, value] = words;
      if (!sub || sub === 'list') {
        const lines: Line[] = [heading(`PRICING CONFIG — algorithm: ${ctx.market.config.algorithm}`)];
        for (const s of PARAM_SPECS)
          if (!s.algorithm || s.algorithm === ctx.market.config.algorithm)
            lines.push(line(seg(padEnd(`  ${s.path}`, 34), 'accent'), seg(padStart(String(getParam(ctx.market.config, s.path)), 8)), seg(`  ${s.description}`, 'muted')));
        lines.push(line(seg(padEnd('  algorithm', 34), 'accent'), seg(padStart(ctx.market.config.algorithm, 8)), seg('  anchored | legacy (the original prototype)', 'muted')));
        lines.push(line(seg(padEnd('  free.rule', 34), 'accent'), seg(padStart(ctx.market.config.free.rule, 8)), seg('  cheapest | least-popular | random-bottom', 'muted')));
        return { lines };
      }
      if (sub === 'get') return path ? { lines: [line(seg(path, 'accent'), ' = ', JSON.stringify(getParam(ctx.market.config, path)) ?? 'undefined')] } : err('config get <path>');
      if (sub === 'reset') {
        ctx.market.config = defaultConfig();
        return { lines: [line(seg('✔ ', 'good'), 'Config reset to defaults.')], market: ctx.market, effect: 'market-changed' };
      }
      if (sub === 'set') {
        if (!path || value === undefined) return err('config set <path> <value>');
        try {
          const before = getParam(ctx.market.config, path);
          ctx.market.config = setParam(ctx.market.config, path, value);
          return { lines: [line(seg('✔ ', 'good'), seg(path, 'accent'), `: ${before} → ${getParam(ctx.market.config, path)}`, seg('  (takes effect at the next update)', 'muted'))], market: ctx.market, effect: 'market-changed' };
        } catch (e) {
          return err((e as Error).message);
        }
      }
      return err('config [list | get <path> | set <path> <value> | reset]');
    },
  },

  algorithm: {
    usage: 'algorithm [anchored|legacy]',
    summary: 'Switch the pricing algorithm.',
    run: ({ words }, ctx) => {
      if (!words[0]) return { lines: [line('Current algorithm: ', seg(ctx.market.config.algorithm, 'accent'))] };
      if (words[0] !== 'anchored' && words[0] !== 'legacy') return err('algorithm must be anchored or legacy');
      ctx.market.config = setParam(ctx.market.config, 'algorithm', words[0]);
      return { lines: [line(seg('✔ ', 'good'), `Pricing algorithm set to ${words[0]}.`)], market: ctx.market, effect: 'market-changed' };
    },
  },

  history: {
    usage: 'history <item> [faction]',
    summary: 'Price history of one item as a sparkline and table.',
    run: ({ words }, { history }) => {
      const f = asFaction(words[words.length - 1]);
      const q = (f ? words.slice(0, -1) : words).join(' ');
      if (!q) return err('history <item> [faction]');
      const it = findItem(q);
      if (typeof it === 'string') return err(it);
      const lines: Line[] = [heading(`${it.name.toUpperCase()} — PRICE HISTORY`)];
      for (const fac of f ? [f] : FACTIONS) {
        const s = priceSeries(history, fac, it.index);
        if (!s.length) continue;
        lines.push(
          line(
            seg(padEnd(`  ${FACTION_LABEL[fac]}`, 14)),
            seg(sparkline(s.map((x) => x.price), 40), 'info'),
            seg(`  ${money(s[0].price)} → ${money(s[s.length - 1].price)}`, 'muted'),
            seg(`  (${s.length} cycles)`, 'muted'),
          ),
        );
      }
      if (lines.length === 1) lines.push(muted('  No history yet — run an update first.'));
      return { lines };
    },
  },

  scenarios: {
    usage: 'scenarios',
    summary: 'List simulation scenarios.',
    run: () => ({
      lines: [heading('SIMULATION SCENARIOS'), ...SCENARIOS.map((s) => line(seg(padEnd(`  ${s.id}`, 18), 'accent'), seg(s.description, 'muted'))), muted('  run one with: sim run <scenario> [--days N]')],
    }),
  },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

/** Runs one console command. `market` in the context may be mutated in place. */
export function runCommand(input: string, ctx: ConsoleContext): CommandResult {
  const trimmed = input.trim().replace(/^market\s+/, '');
  if (!trimmed) return { lines: [] };
  const p = parse(trimmed);
  const name = p.words.shift()!.toLowerCase();
  const cmd = COMMANDS[name];
  if (!cmd) return err(`Unknown command "${name}". Type help.`);
  try {
    return cmd.run(p, ctx);
  } catch (e) {
    return err((e as Error).message);
  }
}

/** Tab-completion candidates for a partial input line. */
export function completeCommand(input: string): string[] {
  const parts = input.trimStart().split(/\s+/);
  if (parts.length <= 1) return COMMAND_NAMES.filter((c) => c.startsWith(parts[0] ?? ''));
  const [cmd, ...rest] = parts;
  const last = rest[rest.length - 1] ?? '';
  const pool: Record<string, string[]> = {
    init: PRESETS.map((p) => p.id),
    sim: ['squads', 'day', 'run', ...SCENARIOS.map((s) => s.id)],
    config: ['list', 'get', 'set', 'reset', ...PARAM_SPECS.map((s) => s.path), 'algorithm', 'free.rule'],
    algorithm: ['anchored', 'legacy'],
    prices: [...FACTIONS, ...CATEGORIES, 'bugs', 'bots', 'squids'],
    help: COMMAND_NAMES,
  };
  return (pool[cmd] ?? []).filter((w) => w.startsWith(last));
}

export function batchPending(market: MarketState): number {
  return batchSize(market.pending);
}
