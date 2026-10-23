/** Styled console output shared by the shell CLI (ANSI) and the in-browser terminal (CSS). */
export type Tone = 'default' | 'muted' | 'good' | 'bad' | 'warn' | 'accent' | 'heading' | 'info';

export interface Seg {
  t: string;
  c?: Tone;
}

export type Line = Seg[];

export const seg = (t: string, c?: Tone): Seg => ({ t, c });
export const line = (...parts: (Seg | string)[]): Line => parts.map((p) => (typeof p === 'string' ? { t: p } : p));
export const blank = (): Line => [];
export const heading = (t: string): Line => [{ t, c: 'heading' }];
export const muted = (t: string): Line => [{ t, c: 'muted' }];

export const money = (n: number) => Math.round(n).toLocaleString('en-US');
export const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
export const signedPct = (n: number, d = 1) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(d)}%`;

export const padEnd = (s: string, n: number) => (s.length >= n ? s.slice(0, Math.max(0, n - 1)) + (s.length > n ? '…' : ' ') : s + ' '.repeat(n - s.length));
export const padStart = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

const SPARK = '▁▂▃▄▅▆▇█';
export function sparkline(values: number[], width = 32): string {
  if (!values.length) return '';
  const step = Math.max(1, Math.ceil(values.length / width));
  const pts: number[] = [];
  for (let i = 0; i < values.length; i += step) pts.push(values[Math.min(values.length - 1, i + step - 1)]);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  return pts.map((v) => SPARK[hi === lo ? 3 : Math.round(((v - lo) / (hi - lo)) * (SPARK.length - 1))]).join('');
}

export function changeTone(delta: number): Tone {
  return delta > 0.0005 ? 'bad' : delta < -0.0005 ? 'good' : 'muted';
}

const ANSI: Record<Tone, string> = {
  default: '',
  muted: '\x1b[2m',
  good: '\x1b[32m',
  bad: '\x1b[31m',
  warn: '\x1b[33m',
  accent: '\x1b[93m',
  heading: '\x1b[1;93m',
  info: '\x1b[36m',
};

export function toAnsi(lines: Line[], color = true): string {
  return lines.map((l) => l.map((s) => (color && s.c && ANSI[s.c] ? `${ANSI[s.c]}${s.t}\x1b[0m` : s.t)).join('')).join('\n');
}

export function toPlain(lines: Line[]): string {
  return toAnsi(lines, false);
}
