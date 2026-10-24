'use client';
/*
 * Hand-rolled SVG charts (no chart library, offline, cheap to render):
 *  - 2px lines, ≥8px end dots with a 2px surface ring, solid hairline grid
 *  - legend for ≥2 series, direct end labels when they don't collide (never nudged)
 *  - crosshair that snaps to the nearest X and lists every series; keyboard arrows work too
 *  - a table view twin for every chart
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { compact } from '@/lib/format';
import { CHART } from '@/lib/palette';

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0];
  if (hi === lo) hi = lo + 1;
  const span = hi - lo;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

interface LineChartProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  x: number[];
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  /** Force the y-axis to include zero. */
  zero?: boolean;
  yDomain?: [number, number];
  markers?: { x: number; label: string }[];
  /** Horizontal reference line, e.g. a design target. */
  reference?: { y: number; label: string };
  xLabel?: string;
  className?: string;
}

export function LineChart({ title, subtitle, x, series, height = 240, yFormat = compact, xFormat = (v) => `#${v}`, zero, yDomain, markers = [], reference, xLabel = 'Day', className = '' }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const multi = series.length > 1;

  const pad = { l: 46, r: multi ? 96 : 16, t: 12, b: 26 };
  const w = Math.max(width, 200);
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const { lo, hi, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    if (reference) all.push(reference.y);
    let lo = yDomain?.[0] ?? (all.length ? Math.min(...all) : 0);
    let hi = yDomain?.[1] ?? (all.length ? Math.max(...all) : 1);
    if (zero) lo = Math.min(0, lo);
    if (hi - lo < 1e-9) hi = lo + 1;
    const padding = (hi - lo) * 0.06;
    if (!yDomain) {
      hi += padding;
      if (!zero) lo -= padding;
    }
    const ticks = niceTicks(lo, hi, 4);
    return { lo: Math.min(lo, ticks[0]), hi: Math.max(hi, ticks[ticks.length - 1]), ticks };
  }, [series, zero, yDomain, reference]);

  const x0 = x[0] ?? 0;
  const x1 = x[x.length - 1] ?? 1;
  const sx = useCallback((v: number) => pad.l + ((v - x0) / Math.max(1e-9, x1 - x0)) * iw, [pad.l, x0, x1, iw]);
  const sy = useCallback((v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih, [pad.t, ih, lo, hi]);
  const xTicks = niceTicks(x0, x1, Math.max(2, Math.min(8, Math.floor(iw / 80)))).filter((v) => v >= x0 && v <= x1);

  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${sx(x[i]).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  // Direct end labels unless they'd collide (then the legend + tooltip carry identity).
  const ends = series.map((s) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null && Number.isFinite(s.values[i]!)) return { i, v: s.values[i]! };
    return null;
  });
  const endYs = ends.map((e) => (e ? sy(e.v) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  const labelsFit = multi && series.length <= 4 && endYs.every((y, k) => k === 0 || y - endYs[k - 1] >= 13);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - box.left + pad.l;
    let best = 0;
    let bestD = Infinity;
    x.forEach((xv, i) => {
      const d = Math.abs(sx(xv) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(x.length - 1, (h ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? x.length) - 1));
    else if (e.key === 'Escape') setHover(null);
  };

  const tip = hover !== null ? hover : null;
  const tipX = tip !== null ? sx(x[tip]) : 0;

  return (
    <div className={className}>
      {(title || multi) && (
        <div className="mb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              {title && <div className="font-display font-bold uppercase tracking-wider text-[15px]">{title}</div>}
              {subtitle && <div className="text-[12.5px] text-muted">{subtitle}</div>}
            </div>
            <button className="shrink-0 text-[11.5px] uppercase tracking-wider text-muted hover:text-yellow font-display font-semibold border border-line px-1.5 py-0.5" onClick={() => setTable((t) => !t)} aria-pressed={table}>
              {table ? 'Chart' : 'Table'}
            </button>
          </div>
          {multi && (
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5">
              {series.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2">
                  <span className="inline-block w-3.5 h-[2px] rounded" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {table ? (
        <DataTable x={x} series={series} yFormat={yFormat} xFormat={xFormat} xLabel={xLabel} />
      ) : (
        <div ref={ref} className="relative" style={{ height }}>
          {width > 0 && (
            <svg width={w} height={height} className="block outline-none" tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)} role="img" aria-label={typeof title === 'string' ? title : 'line chart'}>
              {ticks.map((t) => (
                <g key={t}>
                  <line className="chart-grid" x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} />
                  <text className="chart-label" x={pad.l - 8} y={sy(t)} dy="0.32em" textAnchor="end">
                    {yFormat(t)}
                  </text>
                </g>
              ))}
              <line className="chart-axis" x1={pad.l} x2={w - pad.r} y1={pad.t + ih} y2={pad.t + ih} />
              {xTicks.map((t) => (
                <text key={t} className="chart-label" x={sx(t)} y={height - 8} textAnchor="middle">
                  {xFormat(t)}
                </text>
              ))}
              {reference && (
                <g>
                  <line x1={pad.l} x2={w - pad.r} y1={sy(reference.y)} y2={sy(reference.y)} stroke={CHART.muted} strokeOpacity={0.55} strokeWidth={1} />
                  <text className="chart-label" x={w - pad.r - 4} y={sy(reference.y) + 13} textAnchor="end">
                    {reference.label}
                  </text>
                </g>
              )}
              {markers.map((m) => (
                <g key={`${m.x}-${m.label}`}>
                  <line x1={sx(m.x)} x2={sx(m.x)} y1={pad.t} y2={pad.t + ih} stroke={CHART.muted} strokeOpacity={0.5} strokeWidth={1} />
                  <text className="chart-label" x={sx(m.x) + 4} y={pad.t + 10}>
                    {m.label}
                  </text>
                </g>
              ))}
              {paths.map((d, k) => (
                <path key={series[k].id} d={d} fill="none" stroke={series[k].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {ends.map((e, k) =>
                e ? (
                  <g key={series[k].id}>
                    <circle cx={sx(x[e.i])} cy={sy(e.v)} r={4} fill={series[k].color} stroke={CHART.surface} strokeWidth={2} />
                    {labelsFit && (
                      <text x={sx(x[e.i]) + 9} y={sy(e.v)} dy="0.32em" fontSize={11.5} fill={CHART.text2} style={{ fontFamily: 'var(--font-body)' }}>
                        {series[k].label.length > 12 ? series[k].label.slice(0, 11) + '…' : series[k].label}
                      </text>
                    )}
                  </g>
                ) : null,
              )}
              {tip !== null && (
                <g pointerEvents="none">
                  <line x1={tipX} x2={tipX} y1={pad.t} y2={pad.t + ih} stroke={CHART.text2} strokeOpacity={0.5} strokeWidth={1} />
                  {series.map((s) =>
                    s.values[tip] !== null && Number.isFinite(s.values[tip]!) ? <circle key={s.id} cx={tipX} cy={sy(s.values[tip]!)} r={4} fill={s.color} stroke={CHART.surface} strokeWidth={2} /> : null,
                  )}
                </g>
              )}
              <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
            </svg>
          )}
          {tip !== null && width > 0 && (
            <div
              className="absolute pointer-events-none panel-flat px-3 py-2 text-[12.5px] z-10 shadow-xl"
              style={{ top: 8, left: tipX + 14 + 170 > w ? tipX - 14 - 170 : tipX + 14, width: 170 }}
            >
              <div className="text-muted mb-1">
                {xLabel} {xFormat(x[tip])}
              </div>
              {series.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="inline-block w-3 h-[2px] shrink-0" style={{ background: s.color }} />
                  <span className="font-semibold tnum text-text">{s.values[tip] === null ? '—' : yFormat(s.values[tip]!)}</span>
                  <span className="text-muted truncate">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DataTable({ x, series, yFormat, xFormat, xLabel }: { x: number[]; series: LineSeries[]; yFormat: (v: number) => string; xFormat: (v: number) => string; xLabel: string }) {
  const step = Math.max(1, Math.ceil(x.length / 40));
  const rows = x.map((v, i) => i).filter((i) => i % step === 0 || i === x.length - 1);
  return (
    <div className="max-h-[260px] overflow-auto border border-line">
      <table className="w-full text-[12.5px] tnum">
        <thead className="sticky top-0 bg-panel-2">
          <tr>
            <th className="text-left px-2 py-1 text-muted font-semibold">{xLabel}</th>
            {series.map((s) => (
              <th key={s.id} className="text-right px-2 py-1 text-muted font-semibold">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i} className="border-t border-line">
              <td className="px-2 py-0.5 text-text-2">{xFormat(x[i])}</td>
              {series.map((s) => (
                <td key={s.id} className="px-2 py-0.5 text-right">
                  {s.values[i] === null ? '—' : yFormat(s.values[i]!)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tiny trend line: de-emphasis hue with the current value as an accent dot. */
export function Sparkline({ values, width = 84, height = 24, color = CHART.muted, accent = 'var(--yellow)' }: { values: number[]; width?: number; height?: number; color?: string; accent?: string }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [2 + (i / (values.length - 1)) * (width - 6), 3 + (1 - (v - lo) / span) * (height - 6)] as const);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden className="block">
      <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={accent} />
    </svg>
  );
}

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  detail?: string;
}

/** Scatter with a nearest-point hover layer (no pinpoint targets). */
export function ScatterChart({ title, subtitle, points, legend, height = 280, xLabel, yLabel, yFormat = compact, xFormat = (v: number) => v.toFixed(1) }: { title?: ReactNode; subtitle?: ReactNode; points: ScatterPoint[]; legend?: { label: string; color: string }[]; height?: number; xLabel: string; yLabel: string; yFormat?: (v: number) => string; xFormat?: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 50, r: 14, t: 10, b: 34 };
  const w = Math.max(width, 200);
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xt = niceTicks(Math.min(...xs, 0), Math.max(...xs, 1), 6);
  const yt = niceTicks(0, Math.max(...ys, 1) * 1.05, 4);
  const sx = (v: number) => pad.l + ((v - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * iw;
  const sy = (v: number) => pad.t + ih - ((v - yt[0]) / (yt[yt.length - 1] - yt[0] || 1)) * ih;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - box.left + pad.l;
    const py = e.clientY - box.top + pad.t;
    let best = -1;
    let bestD = 30 * 30;
    points.forEach((p, i) => {
      const d = (sx(p.x) - px) ** 2 + (sy(p.y) - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best >= 0 ? best : null);
  };
  const h = hover !== null ? points[hover] : null;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          {title && <div className="font-display font-bold uppercase tracking-wider text-[15px]">{title}</div>}
          {subtitle && <div className="text-[12.5px] text-muted">{subtitle}</div>}
        </div>
        {legend && legend.length > 1 && (
          <div className="flex gap-3 flex-wrap">
            {legend.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={w} height={height} className="block" role="img" aria-label={typeof title === 'string' ? title : 'scatter chart'}>
            {yt.map((t) => (
              <g key={t}>
                <line className="chart-grid" x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} />
                <text className="chart-label" x={pad.l - 8} y={sy(t)} dy="0.32em" textAnchor="end">
                  {yFormat(t)}
                </text>
              </g>
            ))}
            {xt.map((t) => (
              <text key={t} className="chart-label" x={sx(t)} y={pad.t + ih + 14} textAnchor="middle">
                {xFormat(t)}
              </text>
            ))}
            <line className="chart-axis" x1={pad.l} x2={w - pad.r} y1={pad.t + ih} y2={pad.t + ih} />
            <text className="chart-label" x={pad.l + iw / 2} y={height - 3} textAnchor="middle">
              {xLabel}
            </text>
            <text className="chart-label" transform={`translate(11 ${pad.t + ih / 2}) rotate(-90)`} textAnchor="middle">
              {yLabel}
            </text>
            {points.map((p, i) => (
              <circle key={p.id} cx={sx(p.x)} cy={sy(p.y)} r={hover === i ? 5.5 : 4} fill={p.color} stroke={CHART.surface} strokeWidth={2} opacity={hover === null || hover === i ? 1 : 0.55} />
            ))}
            <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {h && (
          <div className="absolute pointer-events-none panel-flat px-3 py-2 text-[12.5px] z-10" style={{ left: Math.min(sx(h.x) + 12, w - 200), top: Math.max(0, sy(h.y) - 50), width: 190 }}>
            <div className="font-semibold text-text">{h.label}</div>
            <div className="tnum">
              <span className="font-semibold">{yFormat(h.y)}</span> <span className="text-muted">{yLabel.toLowerCase()}</span>
            </div>
            <div className="tnum text-muted">
              {xLabel}: {xFormat(h.x)}
            </div>
            {h.detail && <div className="text-muted">{h.detail}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
