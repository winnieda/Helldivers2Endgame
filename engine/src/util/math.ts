export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function sum(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s;
}

export function mean(xs: ArrayLike<number>): number {
  return xs.length ? sum(xs) / xs.length : 0;
}

export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs: readonly number[]) => quantile(xs, 0.5);

export function geoMean(xs: readonly number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += Math.log(Math.max(x, 1e-9));
  return Math.exp(s / xs.length);
}

/** Average ranks (1-based), ties share the mean rank. */
export function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export const spearman = (a: readonly number[], b: readonly number[]) => pearson(ranks(a), ranks(b));

/** exp(Shannon entropy): the "effective number" of equally-used options. */
export function effectiveCount(weights: ArrayLike<number>): number {
  const total = sum(weights);
  if (!(total > 0)) return 0;
  let h = 0;
  for (let i = 0; i < weights.length; i++) {
    const p = weights[i] / total;
    if (p > 0) h -= p * Math.log(p);
  }
  return Math.exp(h);
}

/** Least-squares slope of ys against 0..n-1. */
export function slope(ys: readonly number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i] - my);
    den += (i - mx) ** 2;
  }
  return num / den;
}

export const round = (x: number, step = 1) => Math.round(x / step) * step;

/** Builds a fully-typed record from a list of keys. */
export function recordOf<K extends string, V>(keys: readonly K[], fn: (k: K) => V): Record<K, V> {
  const out = {} as Record<K, V>;
  for (const k of keys) out[k] = fn(k);
  return out;
}
