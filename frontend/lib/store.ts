'use client';
/**
 * The single owner of app state; components read it through hooks and write through actions.
 *
 * The market and its price history come from one of two places:
 *  - server mode (NEXT_PUBLIC_API_URL set): the shared market on the API. This store keeps a
 *    cached copy in localStorage, refreshes it on load, on focus and every minute, and sends
 *    deployed loadouts to the server. Changes that can't be delivered wait in an outbox.
 *  - offline mode: the market lives in this browser only.
 * The active campaign and the hall of fame are always kept in this browser.
 */
import { useSyncExternalStore } from 'react';
import {
  createMarket,
  deserializeMarket,
  emptyHistory,
  migrateHistory,
  recordHistory,
  serializeMarket,
  scoreCampaign,
  submitLoadout,
  withdrawLoadout,
  type Campaign,
  type GameMode,
  type MarketHistory,
  type MarketState,
  type Submission,
} from '@engine';
import { ApiError, getDoc, postLoadouts, postWithdrawals, serverMode } from './api';
import { toast } from './toast';

// Server mode caches the server's market under its own keys, so it never overwrites an offline save.
const KEYS = {
  market: serverMode ? 'hd2e:server-market:v1' : 'hd2e:market:v1',
  history: serverMode ? 'hd2e:server-history:v1' : 'hd2e:history:v1',
  campaign: 'hd2e:campaign:v1',
  records: 'hd2e:records:v1',
  outbox: 'hd2e:outbox:v1',
} as const;

/**
 * How often an open tab checks the server's market. Prices change once a day; the check mostly
 * keeps the pending-loadout count fresh. Every check is a request against the CDN's free monthly
 * allowance, so it's kept slow (focusing the tab checks at once).
 */
const REFRESH_MS = 5 * 60_000;

/** History kept in the browser (each cycle is ~8 KB; localStorage holds ~5 MB). */
const HISTORY_CAP = 240;

export interface CampaignRecord {
  id: string;
  mode: GameMode;
  operationName: string;
  finishedAt: number;
  names: string[];
  missions: number;
  operations: number;
  rounds: number;
  earned: number;
  spent: number;
  profit: number;
  winner: string | null;
  reason: string;
}

export interface SyncState {
  mode: 'server' | 'local';
  /** server mode: whether the last attempt to reach the server worked. */
  status: 'connecting' | 'live' | 'offline';
  checkedAt: number | null;
  error: string | null;
  /** Loadout changes waiting to be sent. */
  outbox: number;
}

/** A loadout change the server hasn't confirmed yet. */
interface OutboxEntry {
  kind: 'submit' | 'withdraw';
  submissions: Submission[];
}

export interface AppState {
  ready: boolean;
  /** Bumped on every change, so memoized views can key off it (the market is mutated in place). */
  version: number;
  market: MarketState;
  history: MarketHistory;
  campaign: Campaign | null;
  records: CampaignRecord[];
  sync: SyncState;
}

type Listener = () => void;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

class AppStore {
  private state: AppState;
  private listeners = new Set<Listener>();
  private dirty = new Set<keyof typeof KEYS>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private outbox: OutboxEntry[] = [];
  private etags: { market: string | null; history: string | null } = { market: null, history: null };
  /** The market day the cached history was fetched for. */
  private historyDay = -1;
  private refreshing: Promise<void> | null = null;
  /** Server writes in flight; a refresh landing meanwhile would briefly undo their local effect. */
  private writes = 0;
  static readonly server: AppState = AppStore.fresh(false);

  constructor() {
    this.state = AppStore.server;
  }

  private static fresh(ready: boolean): AppState {
    const market = createMarket('tiers');
    const sync: SyncState = { mode: serverMode ? 'server' : 'local', status: serverMode ? 'connecting' : 'live', checkedAt: null, error: null, outbox: 0 };
    return { ready, version: 0, market, history: recordHistory(emptyHistory(), market), campaign: null, records: [], sync };
  }

  private load(): void {
    if (this.loaded || typeof window === 'undefined') return;
    this.loaded = true;
    const next = AppStore.fresh(true);
    try {
      const m = read<object>(KEYS.market);
      if (m) next.market = deserializeMarket(m);
      const h = read<MarketHistory>(KEYS.history);
      next.history = h ? migrateHistory(h) : recordHistory(emptyHistory(), next.market);
      next.campaign = read<Campaign>(KEYS.campaign);
      next.records = read<CampaignRecord[]>(KEYS.records) ?? [];
      this.outbox = read<OutboxEntry[]>(KEYS.outbox) ?? [];
      next.sync = { ...next.sync, outbox: this.outbox.length };
    } catch (e) {
      console.warn('Could not load saved state, starting fresh.', e);
    }
    if (serverMode) {
      // Show the cached copy straight away if there is one; otherwise wait for the server.
      next.ready = read(KEYS.market) !== null;
      this.state = next;
      this.watchServer();
    } else {
      this.state = next;
      if (!read(KEYS.market)) {
        this.dirty.add('market');
        this.dirty.add('history');
        this.flushSoon();
      }
    }
    window.addEventListener('storage', (e) => {
      if (!e.key || !Object.values(KEYS).includes(e.key as (typeof KEYS)[keyof typeof KEYS])) return;
      // Another tab changed something: reload it.
      this.loaded = false;
      this.load();
      this.emit();
    });
  }

  get = (): AppState => {
    this.load();
    return this.state;
  };

  getServer = (): AppState => AppStore.server;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private set(patch: Partial<AppState>, keys: (keyof typeof KEYS)[]): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    if (keys.includes('outbox')) this.state.sync = { ...this.state.sync, outbox: this.outbox.length };
    keys.forEach((k) => this.dirty.add(k));
    this.flushSoon();
    this.emit();
  }

  private flushSoon(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 120);
  }

  flush(): void {
    const s = this.state;
    for (const k of this.dirty) {
      if (k === 'market') write(KEYS.market, serializeMarket(s.market));
      if (k === 'campaign') {
        if (s.campaign) write(KEYS.campaign, JSON.stringify(s.campaign));
        else localStorage.removeItem(KEYS.campaign);
      }
      if (k === 'records') write(KEYS.records, JSON.stringify(s.records.slice(0, 60)));
      if (k === 'outbox') write(KEYS.outbox, JSON.stringify(this.outbox));
      if (k === 'history') {
        let h = { ...s.history, points: s.history.points.slice(-HISTORY_CAP) };
        // If storage is full, keep dropping the oldest cycles until it fits.
        while (!write(KEYS.history, JSON.stringify(h)) && h.points.length > 10) h = { ...h, points: h.points.slice(Math.floor(h.points.length / 4)) };
      }
    }
    this.dirty.clear();
  }

  // ---------------------------------------------------------------------------------------
  // Server sync
  // ---------------------------------------------------------------------------------------

  private watching = false;

  private watchServer(): void {
    void this.refresh();
    // load() runs again when another tab saves; the listeners only need adding once.
    if (this.watching) return;
    this.watching = true;
    window.addEventListener('focus', () => void this.refresh());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void this.refresh());
    setInterval(() => document.visibilityState === 'visible' && void this.refresh(), REFRESH_MS);
  }

  private setSync(patch: Partial<SyncState>, extra: Partial<AppState> = {}, keys: (keyof typeof KEYS)[] = []): void {
    this.set({ ...extra, sync: { ...this.state.sync, ...patch } }, keys);
  }

  /**
   * Fetches the shared market (server mode). Unchanged documents cost a 304 and are not re-read.
   * History only gains a point when the market day changes, so it is fetched on the first refresh,
   * after a new day, and after admin changes (which reset its ETag).
   */
  refresh = (): Promise<void> => {
    if (!serverMode) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        await this.sendOutbox();
        const m = await getDoc('/api/market');
        const patch: Partial<AppState> = { ready: true };
        const keys: (keyof typeof KEYS)[] = [];
        const market = m.etag === null || m.etag !== this.etags.market ? deserializeMarket(m.text) : null;
        if (this.writes === 0 && market) {
          patch.market = market;
          this.etags.market = m.etag;
          keys.push('market');
        }
        const day = (market ?? this.state.market).day;
        if (this.etags.history === null || day !== this.historyDay) {
          const h = await getDoc('/api/history');
          if (h.etag === null || h.etag !== this.etags.history) {
            patch.history = migrateHistory(JSON.parse(h.text));
            keys.push('history');
          }
          this.etags.history = h.etag;
          this.historyDay = day;
        }
        this.setSync({ status: 'live', checkedAt: Date.now(), error: null }, patch, keys);
      } catch (e) {
        this.setSync({ status: 'offline', checkedAt: Date.now(), error: (e as Error).message }, { ready: true });
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  };

  /** Delivers queued loadout changes in order; stops at the first one the server can't take yet. */
  private async sendOutbox(): Promise<void> {
    while (this.outbox.length) {
      const entry = this.outbox[0];
      try {
        if (entry.kind === 'submit') await postLoadouts(entry.submissions);
        else await postWithdrawals(entry.submissions);
      } catch (e) {
        // Unreachable or a server fault: keep it for the next try. Anything else won't ever succeed.
        if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) throw e;
        toast('A loadout was not counted', (e as Error).message, 'warn');
      }
      this.outbox.shift();
      this.set({}, ['outbox']);
    }
  }

  private queue(entry: OutboxEntry): void {
    this.outbox.push(entry);
    this.set({}, ['outbox']);
    this.etags.market = null; // the next refresh must replace the optimistic local copy
    void this.refresh();
  }

  // ---------------------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------------------

  /** Queues deployed loadouts for the next market update (locally, and on the server). */
  submitLoadouts(submissions: Submission[]): void {
    if (!submissions.length) return;
    // Applied locally at once so the queue count moves; in server mode the next refresh confirms it.
    this.mutateMarket((m) => submissions.forEach((s) => submitLoadout(m, s)));
    if (serverMode) this.queue({ kind: 'submit', submissions });
  }

  /** Takes cancelled deploys back out of the queue. Returns false if some were already counted. */
  withdrawLoadouts(submissions: Submission[]): boolean {
    if (!submissions.length) return true;
    let all = true;
    this.mutateMarket((m) => submissions.forEach((s) => (all = withdrawLoadout(m, s) && all)));
    // The server makes its own check, so a withdrawal is sent even if the cached copy refused it.
    if (serverMode) this.queue({ kind: 'withdraw', submissions });
    return all;
  }

  /** Runs `fn` against the server (an admin change), then pulls the result. */
  async serverChange<T>(fn: () => Promise<T>): Promise<T> {
    this.writes++;
    try {
      return await fn();
    } finally {
      this.writes--;
      this.etags.market = null;
      this.etags.history = null;
      await this.refresh();
    }
  }

  /** Mutate the market in place (engine functions do), then notify. */
  mutateMarket(fn: (m: MarketState) => void, opts: { record?: boolean } = {}): void {
    const s = this.get();
    fn(s.market);
    const history = opts.record ? recordHistory(s.history, s.market) : s.history;
    this.set({ market: s.market, history }, opts.record ? ['market', 'history'] : ['market']);
  }

  replaceMarket(market: MarketState, history?: MarketHistory): void {
    this.set({ market, history: history ?? recordHistory(emptyHistory(), market) }, ['market', 'history']);
  }

  setHistory(history: MarketHistory): void {
    this.set({ history }, ['history']);
  }

  setCampaign(campaign: Campaign | null): void {
    this.set({ campaign }, ['campaign']);
  }

  /** Stores a finished campaign in the hall of fame and clears it. */
  archiveCampaign(c: Campaign): void {
    const score = scoreCampaign(c);
    const winner = c.winnerId ? c.divers.find((d) => d.id === c.winnerId)?.name ?? null : null;
    const record: CampaignRecord = {
      id: c.id,
      mode: c.mode,
      operationName: c.operationName,
      finishedAt: Date.now(),
      names: c.divers.map((d) => d.name),
      missions: score.missions,
      operations: score.operationsCompleted,
      rounds: score.roundsSurvived,
      earned: score.totalEarned,
      spent: score.totalSpent,
      profit: score.profit,
      winner,
      reason: c.endedReason ?? '',
    };
    const records = [record, ...this.get().records.filter((r) => r.id !== c.id)];
    this.set({ records, campaign: null }, ['records', 'campaign']);
  }

  /** Wipes everything this prototype saved in the browser (server mode: the cached market too). */
  resetAll(): void {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
    this.outbox = [];
    const market = createMarket('tiers');
    this.set({ market, history: recordHistory(emptyHistory(), market), campaign: null, records: [] }, ['market', 'history', 'campaign', 'records', 'outbox']);
    if (serverMode) {
      this.etags = { market: null, history: null };
      void this.refresh();
    }
  }
}

export const store = new AppStore();

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => store.flush());
}
