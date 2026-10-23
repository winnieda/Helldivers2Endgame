'use client';
/**
 * The whole prototype lives in this browser: the "global" market, its price history, the
 * active campaign and finished-campaign records are all kept in localStorage. This store is
 * the single owner of that state; components read it through hooks and write through actions.
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
  type Campaign,
  type GameMode,
  type MarketHistory,
  type MarketState,
} from '@engine';

const KEYS = {
  market: 'hd2e:market:v1',
  history: 'hd2e:history:v1',
  campaign: 'hd2e:campaign:v1',
  records: 'hd2e:records:v1',
} as const;

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

export interface AppState {
  ready: boolean;
  /** Bumped on every change, so memoized views can key off it (the market is mutated in place). */
  version: number;
  market: MarketState;
  history: MarketHistory;
  campaign: Campaign | null;
  records: CampaignRecord[];
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
  static readonly server: AppState = AppStore.fresh(false);

  constructor() {
    this.state = AppStore.server;
  }

  private static fresh(ready: boolean): AppState {
    const market = createMarket('tiers');
    return { ready, version: 0, market, history: recordHistory(emptyHistory(), market), campaign: null, records: [] };
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
    } catch (e) {
      console.warn('Could not load saved state, starting fresh.', e);
    }
    this.state = next;
    if (!read(KEYS.market)) {
      this.dirty.add('market');
      this.dirty.add('history');
      this.flushSoon();
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
      if (k === 'history') {
        let h = { ...s.history, points: s.history.points.slice(-HISTORY_CAP) };
        // If storage is full, keep dropping the oldest cycles until it fits.
        while (!write(KEYS.history, JSON.stringify(h)) && h.points.length > 10) h = { ...h, points: h.points.slice(Math.floor(h.points.length / 4)) };
      }
    }
    this.dirty.clear();
  }

  // ---------------------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------------------

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

  /** Wipes everything this prototype saved in the browser. */
  resetAll(): void {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
    const market = createMarket('tiers');
    this.set({ market, history: recordHistory(emptyHistory(), market), campaign: null, records: [] }, ['market', 'history', 'campaign', 'records']);
  }
}

export const store = new AppStore();

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => store.flush());
}
