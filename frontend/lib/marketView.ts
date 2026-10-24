'use client';
import { useMemo } from 'react';
import { AVAILABLE, CATEGORIES, freeCyclesLeft, ITEMS, quote, SHARE_SCALE, type Category, type Faction, type Item, type Quote } from '@engine';
import { useApp } from './store';

export interface ItemView {
  item: Item;
  q: Quote;
  /** Fractional change of the list price since the previous day. */
  change: number;
  share: number;
  /** Popularity relative to a fair share of the category (1 = exactly average). */
  ratio: number;
  target: number;
  /** Recent list prices, oldest first (for sparklines). */
  trend: number[];
  freeLeft: number;
}

/** Per-faction view of every item, recomputed only when the store changes. */
export function useMarketView(faction: Faction, trendLength = 30): { views: Map<number, ItemView>; byCategory: Record<Category, ItemView[]> } {
  const { market, history, version } = useApp();
  return useMemo(() => {
    const views = new Map<number, ItemView>();
    const points = history.points.slice(-trendLength);
    const book = market.books[faction];
    for (const c of CATEGORIES) {
      const pool = AVAILABLE[faction][c];
      for (const it of pool) {
        const b = book.items[it.index]!;
        const trend = points.map((p) => p.prices[faction]?.[it.index] ?? -1).filter((v) => v >= 0);
        views.set(it.index, {
          item: it,
          q: quote(market, faction, it.index),
          change: b.prevPrice > 0 && !it.alwaysFree ? b.price / b.prevPrice - 1 : 0,
          share: b.share,
          ratio: b.share * pool.length,
          target: b.target,
          trend,
          freeLeft: freeCyclesLeft(market, faction, it.index),
        });
      }
    }
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, AVAILABLE[faction][c].map((i) => views.get(i.index)!)])) as Record<Category, ItemView[]>;
    return { views, byCategory };
    // version tracks in-place market mutations
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, history, version, faction, trendLength]);
}

/** Biggest movers across all faction markets since yesterday. */
export function useMovers(limit = 16) {
  const { market, version } = useApp();
  return useMemo(() => {
    const out: { item: Item; faction: Faction; price: number; change: number }[] = [];
    for (const f of ['terminids', 'automatons', 'illuminate'] as Faction[]) {
      market.books[f].items.forEach((b, i) => {
        if (!b || ITEMS[i].alwaysFree || b.prevPrice <= 0) return;
        out.push({ item: ITEMS[i], faction: f, price: quote(market, f, i).list, change: b.price / b.prevPrice - 1 });
      });
    }
    return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, version, limit]);
}

export const shareFromHistory = (v: number) => v / SHARE_SCALE;
