import { FACTION_LABEL, type Faction, type Item, type StratagemType } from '@engine';

export const req = (n: number) => Math.round(n).toLocaleString('en-US');

/** 1,284 · 12.9K · 1.2M */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return Math.round(n).toLocaleString('en-US');
}

export const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
export const signedPct = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n * 100).toFixed(d)}%`;

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const ARROWS: Record<string, string> = { U: '↑', D: '↓', L: '←', R: '→' };

export const FACTION_COLOR_VAR: Record<Faction, string> = {
  terminids: 'var(--terminids)',
  automatons: 'var(--automatons)',
  illuminate: 'var(--illuminate)',
};

export const FACTION_BLURB: Record<Faction, string> = {
  terminids: 'Swarms, burrowers and Bile Titans. Crowd control and fire are king.',
  automatons: 'Armored walkers, gunships and fabricators. Bring precision and anti-tank.',
  illuminate: 'Overseers, Harvesters and the Voteless horde. Shields up, fire fast.',
};

export const factionName = (f: Faction) => FACTION_LABEL[f];

export function familyColor(item: Item): string {
  if (item.category !== 'stratagem') return 'var(--weapon)';
  return familyOf(item.type!) === 'offensive' ? 'var(--offensive)' : familyOf(item.type!) === 'supply' ? 'var(--supply)' : 'var(--defensive)';
}

export function familyOf(t: StratagemType): 'offensive' | 'supply' | 'defensive' {
  return t === 'orbital' || t === 'eagle' ? 'offensive' : t === 'defensive' ? 'defensive' : 'supply';
}

export const DIVER_COLORS = ['#ffe81f', '#5ee0ff', '#ff8fb1', '#9be564'];
