#!/usr/bin/env node
/**
 * Market console for the shell, backed by a JSON file database (default: data/market.json).
 * Same commands as the in-browser ship terminal:
 *
 *   npm run market -- status
 *   npm run market -- init tiers
 *   npm run market -- sim squads 100      # queue synthetic loadouts
 *   npm run market -- update              # run the price update
 *   npm run market -- prices bots strat
 *   npm run market -- config set anchored.elasticityUp 1.1
 *   npm run market -- export-csv out/     # prototype-style per-category price CSVs
 *
 * The file can be imported into the web app (terminal: `import`) and vice versa (`export`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { CATEGORIES, FACTIONS } from '../catalog/types';
import { AVAILABLE, ITEMS } from '../catalog/catalog';
import { runCommand } from '../console/commands';
import { toAnsi } from '../console/format';
import { emptyHistory, migrateHistory, recordHistory, type MarketHistory } from '../market/history';
import { deserializeMarket, serializeMarket } from '../market/market';
import { createMarket } from '../market/presets';
import type { MarketState } from '../market/types';
import { parseArgs } from './args';

const ROOT = path.resolve(__dirname, '../../..');
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(typeof args.flags.db === 'string' ? args.flags.db : path.join(ROOT, 'data', 'market.json'));
const historyPath = dbPath.replace(/\.json$/, '') + '.history.json';

interface Db {
  market: MarketState;
  history: MarketHistory;
}

function load(): Db {
  if (!fs.existsSync(dbPath)) {
    const market = createMarket('tiers');
    return { market, history: recordHistory(emptyHistory(), market) };
  }
  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  // Accept both the CLI's split files and a browser export ({ market, history }).
  const market = deserializeMarket(raw.market ?? raw);
  const history = raw.history ? migrateHistory(raw.history) : fs.existsSync(historyPath) ? migrateHistory(JSON.parse(fs.readFileSync(historyPath, 'utf8'))) : emptyHistory();
  return { market, history };
}

function save(db: Db): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, serializeMarket(db.market));
  fs.writeFileSync(historyPath, JSON.stringify(db.history));
}

function exportCsv(db: Db, dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FACTIONS)
    for (const c of CATEGORIES) {
      const items = AVAILABLE[f][c];
      const rows = [items.map((i) => `"${i.name}"`).join(',')];
      for (const p of db.history.points) rows.push(items.map((i) => p.prices[f][i.index]).join(','));
      fs.writeFileSync(path.join(dir, `${f}_${c}_prices.csv`), rows.join('\n'));
    }
  console.log(`Wrote ${FACTIONS.length * CATEGORIES.length} CSVs (one row per market cycle) to ${dir}`);
}

function main(): void {
  const db = load();
  const words = args._;
  if (words[0] === 'export-csv') return exportCsv(db, words[1] ?? path.join(ROOT, 'data', 'csv'));
  if (words[0] === 'where') return console.log(dbPath);
  if (words[0] === 'items') {
    for (const it of ITEMS) console.log(`${it.id.padEnd(36)} ${it.name}`);
    return;
  }
  const input = words.length ? words.join(' ') + Object.entries(args.flags).filter(([k]) => k !== 'db').map(([k, v]) => ` --${k}${v === true ? '' : ` ${v}`}`).join('') : 'status';
  const result = runCommand(input, { market: db.market, history: db.history });
  console.log(toAnsi(result.lines, process.stdout.isTTY && !process.env.NO_COLOR));
  if (result.market || result.history) {
    save({ market: result.market ?? db.market, history: result.history ?? db.history });
    console.log(`\x1b[2msaved ${path.relative(process.cwd(), dbPath)}\x1b[0m`);
  } else if (!fs.existsSync(dbPath)) save(db);
}

main();
