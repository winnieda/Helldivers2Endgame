/**
 * Self-contained HTML report for `npm run sim -- --html report.html`: suite matrix, then per
 * run the health checks and two inline-SVG charts. No scripts, no external assets.
 */
import * as fs from 'fs';
import { CATEGORY_LABEL } from '../catalog/catalog';
import { CATEGORIES, FACTIONS } from '../catalog/types';
import type { Verdict } from '../sim/health';
import type { SimResult } from '../sim/simulate';
import { mean } from '../util/math';

const CATEGORY_SERIES = { stratagem: '#3987e5', primary: '#d95926', secondary: '#199e70', throwable: '#c98500' } as const;
const STATUS: Record<Verdict, string> = { pass: '#3fb950', warn: '#fab219', fail: '#f47067', info: '#8b98a5' };
const GLYPH: Record<Verdict, string> = { pass: '✓', warn: '!', fail: '✗', info: 'i' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const compact = (n: number) => (Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(0)}K` : Math.round(n).toLocaleString('en-US'));

function niceMax(v: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= v) ?? 10 * mag;
}

function lineChart(title: string, series: { label: string; color: string; values: number[] }[], ref?: number): string {
  const w = 560;
  const h = 220;
  const pad = { l: 46, r: 96, t: 12, b: 24 };
  const n = series[0]?.values.length ?? 0;
  const max = niceMax(Math.max(ref ?? 0, ...series.flatMap((s) => s.values)) * 1.05);
  const sx = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const grid = ticks.map((t) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${sy(t)}" y2="${sy(t)}" stroke="#1f2830"/><text x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end">${compact(t)}</text>`).join('');
  const lines = series
    .map((s) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
      const last = s.values[s.values.length - 1];
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/><circle cx="${sx(n - 1)}" cy="${sy(last)}" r="4" fill="${s.color}" stroke="#10151a" stroke-width="2"/>`;
    })
    .join('');
  // Direct labels only when they don't collide; the legend always carries identity.
  const ends = series.map((s) => sy(s.values[s.values.length - 1])).sort((a, b) => a - b);
  const fits = ends.every((y, k) => k === 0 || y - ends[k - 1] >= 13);
  const labels = fits ? series.map((s) => `<text x="${sx(n - 1) + 9}" y="${sy(s.values[s.values.length - 1]) + 4}" fill="#b9c3cc">${esc(s.label)}</text>`).join('') : '';
  const refLine = ref !== undefined ? `<line x1="${pad.l}" x2="${w - pad.r}" y1="${sy(ref)}" y2="${sy(ref)}" stroke="#8b98a5" stroke-opacity=".55"/><text x="${w - pad.r - 4}" y="${sy(ref) + 13}" text-anchor="end">target ${compact(ref)}</text>` : '';
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>` : '';
  return `<figure><figcaption>${esc(title)}</figcaption>${legend}<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">${grid}<line x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}" stroke="#2e3a45"/>${refLine}${lines}${labels}<text x="${pad.l}" y="${h - 6}">cycle 1</text><text x="${w - pad.r}" y="${h - 6}" text-anchor="end">cycle ${n}</text></svg></figure>`;
}

export function writeHtmlReport(results: SimResult[], file: string): void {
  const ids = [...new Set(results.flatMap((r) => r.health.checks.filter((c) => c.verdict !== 'info').map((c) => c.id)))];
  const labels = Object.fromEntries(results.flatMap((r) => r.health.checks.map((c) => [c.id, c.label])));
  const matrix = `<table class="matrix"><thead><tr><th>Scenario</th><th>Algorithm</th><th>Seed</th>${ids.map((id) => `<th title="${esc(labels[id])}">${esc(labels[id])}</th>`).join('')}<th>Overall</th></tr></thead><tbody>${results
    .map((r) => {
      const cells = ids.map((id) => {
        const c = r.health.checks.find((x) => x.id === id);
        return c ? `<td style="color:${STATUS[c.verdict]}" title="${esc(c.value)}">${GLYPH[c.verdict]}</td>` : '<td></td>';
      });
      return `<tr><td>${esc(r.scenario.name)}</td><td>${r.config.algorithm}</td><td>${r.seed}</td>${cells.join('')}<td style="color:${STATUS[r.health.verdict]}">${GLYPH[r.health.verdict]} ${r.health.verdict}</td></tr>`;
    })
    .join('')}</tbody></table>`;

  const runs = results
    .map((r) => {
      const level = CATEGORIES.map((c) => ({ label: CATEGORY_LABEL[c], color: CATEGORY_SERIES[c], values: r.days.map((d) => mean(FACTIONS.map((f) => d.median[f][c]))) }));
      const spend = [
        { label: 'Typical loadout', color: CATEGORY_SERIES.stratagem, values: r.days.map((d) => d.typicalLoadout) },
        { label: 'Actually spent', color: CATEGORY_SERIES.primary, values: r.days.map((d) => d.avgSpend) },
      ];
      const checks = r.health.checks
        .map((c) => `<tr><td style="color:${STATUS[c.verdict]}">${GLYPH[c.verdict]} ${c.verdict}</td><td>${esc(c.label)}</td><td>${esc(c.value)}</td><td class="muted">${esc(c.detail)}</td></tr>`)
        .join('');
      return `<section><h2>${esc(r.scenario.name)} <small>${r.scenario.id} · ${r.config.algorithm} · seed ${r.seed} · ${r.days.length} cycles</small></h2><p class="muted">${esc(r.scenario.description)} Expect: ${esc(r.scenario.expectation)}</p><table class="checks">${checks}</table><div class="charts">${lineChart('Median paid price by category (avg of fronts)', level)}${lineChart('Typical loadout vs actual spend', spend, 24000)}</div></section>`;
    })
    .join('');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Endgame market simulation report</title><style>
:root{color-scheme:dark}body{margin:0;padding:24px;background:#07090b;color:#e9edf0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:28px;margin:0 0 4px;letter-spacing:.04em;text-transform:uppercase}h2{font-size:20px;margin:0 0 4px}small,.muted{color:#8b98a5;font-weight:400}
section{background:#10151a;border:1px solid #24303a;padding:16px;margin:16px 0}table{border-collapse:collapse;width:100%}td,th{padding:4px 8px;text-align:left;border-bottom:1px solid #1f2830;vertical-align:top}
th{color:#8b98a5;font-weight:600;font-size:12px}.checks td:first-child{white-space:nowrap}.matrix td{text-align:center;font-weight:700}.matrix td:first-child,.matrix td:nth-child(2){text-align:left;font-weight:400}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:12px}figure{margin:0}figcaption{font-weight:600}
.legend{display:flex;gap:12px;flex-wrap:wrap;color:#b9c3cc;font-size:12px;margin:4px 0}.legend i{display:inline-block;width:14px;height:2px;margin-right:5px;vertical-align:middle}
svg{width:100%;height:auto}svg text{fill:#8b98a5;font-size:11px;font-variant-numeric:tabular-nums}
</style></head><body><h1>Endgame market simulation</h1><p class="muted">${results.length} runs · generated ${new Date().toISOString()}</p><section>${matrix}</section>${runs}</body></html>`;
  fs.writeFileSync(file, html);
}
