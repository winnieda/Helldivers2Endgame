/**
 * The shared market, kept in storage as two documents: 'market' (prices, pending queue, config)
 * and 'history' (one snapshot per market day, for charts). Every change is a read-modify-write
 * that is retried if another writer changed the market in between.
 */
import {
  createMarket,
  deserializeMarket,
  emptyHistory,
  migrateHistory,
  pendingCount,
  recordHistory,
  runCommand,
  serializeMarket,
  submitLoadout,
  updateMarket,
  withdrawLoadout,
  type Line,
  type MarketHistory,
  type MarketState,
  type Submission,
} from '@hd2e/engine';
import { ConflictError, type Storage, type Stored } from './storage';

export const MARKET = 'market';
export const HISTORY = 'history';
const RETRIES = 5;

interface Snapshot {
  market: MarketState;
  history: MarketHistory;
  marketTag: string;
}

interface Change<T> {
  result: T;
  /** Set when the market should be saved (it may be a new object, e.g. after `init`). */
  market?: MarketState;
  history?: MarketHistory;
}

export class MarketService {
  constructor(private storage: Storage) {}

  /** The stored document, creating the launch-day market on first use. */
  async doc(key: typeof MARKET | typeof HISTORY): Promise<Stored> {
    const found = await this.storage.get(key);
    if (found) return found;
    await this.read();
    return (await this.storage.get(key))!;
  }

  private async read(): Promise<Snapshot> {
    let m = await this.storage.get(MARKET);
    if (!m) {
      const market = createMarket('tiers');
      try {
        await this.storage.put(MARKET, serializeMarket(market), null);
        await this.storage.put(HISTORY, JSON.stringify(recordHistory(emptyHistory(), market)));
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
      m = (await this.storage.get(MARKET))!;
    }
    const h = await this.storage.get(HISTORY);
    const market = deserializeMarket(m.body);
    const history = h ? migrateHistory(JSON.parse(h.body)) : recordHistory(emptyHistory(), market);
    return { market, history, marketTag: m.etag };
  }

  private async change<T>(fn: (s: Snapshot) => Change<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const s = await this.read();
      const out = fn(s);
      if (!out.market && !out.history) return out.result;
      try {
        // The market write is the conditional one: if it wins, this change is the next one in line.
        await this.storage.put(MARKET, serializeMarket(out.market ?? s.market), s.marketTag);
        if (out.history) await this.storage.put(HISTORY, JSON.stringify(out.history));
        return out.result;
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt >= RETRIES) throw e;
      }
    }
  }

  /** Queues deployed loadouts for the next update. Throws on an invalid loadout (nothing is saved). */
  submit(subs: Submission[]): Promise<{ accepted: number; pending: number }> {
    return this.change(({ market }) => {
      for (const s of subs) submitLoadout(market, { ...s, at: Date.now() });
      return { result: { accepted: subs.length, pending: pendingCount(market) }, market };
    });
  }

  /** Takes cancelled deploys back out of the queue; ones an update already counted are refused. */
  withdraw(subs: Submission[]): Promise<{ withdrawn: number; refused: number; pending: number }> {
    return this.change(({ market }) => {
      const withdrawn = subs.filter((s) => withdrawLoadout(market, s)).length;
      return { result: { withdrawn, refused: subs.length - withdrawn, pending: pendingCount(market) }, market: withdrawn ? market : undefined };
    });
  }

  /**
   * Runs one market day. A scheduled run passes `minHours` so a retried or doubled trigger can't
   * run two days back to back; a manual run always goes ahead.
   */
  update(opts: { minHours?: number } = {}): Promise<{ ran: boolean; day: number; processed: number }> {
    return this.change<{ ran: boolean; day: number; processed: number }>(({ market, history }) => {
      const ageHours = (Date.now() - market.updatedAt) / 3_600_000;
      if (opts.minHours !== undefined && ageHours < opts.minHours) return { result: { ran: false, day: market.day, processed: 0 } };
      const processed = pendingCount(market);
      updateMarket(market);
      return { result: { ran: true, day: market.day, processed }, market, history: recordHistory(history, market) };
    });
  }

  /** Runs a market console command (the ship terminal's commands) against the shared market. */
  console(command: string): Promise<{ lines: Line[]; changed: boolean }> {
    return this.change(({ market, history }) => {
      const res = runCommand(command, { market, history });
      const changed = !!(res.market || res.history);
      return { result: { lines: res.lines, changed }, market: changed ? res.market ?? market : undefined, history: res.history };
    });
  }

  /** Replaces the whole market (an imported save). */
  replace(market: MarketState, history?: MarketHistory): Promise<{ day: number }> {
    return this.change(() => ({ result: { day: market.day }, market, history: history ?? recordHistory(emptyHistory(), market) }));
  }
}
