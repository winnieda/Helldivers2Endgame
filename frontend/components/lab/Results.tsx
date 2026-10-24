'use client';
import { useMemo, useState } from 'react';
import {
  AVAILABLE,
  CATEGORIES,
  CATEGORY_LABEL,
  FACTION_LABEL,
  FACTIONS,
  ITEMS,
  mean,
  type Algorithm,
  type Faction,
  type SimResult,
} from '@engine';
import { compact, req } from '@/lib/format';
import { ALGORITHM_SERIES, CATEGORY_SERIES, FACTION_SERIES } from '@/lib/palette';
import { LineChart, ScatterChart } from '../charts';
import { FactionEmblem, ItemIcon, StatusIcon } from '../icons';
import { Verdict } from '../ui';

const VERDICT_COLOR = { pass: '#3fb950', warn: '#fab219', fail: '#f47067', info: '#8b98a5' } as const;

function avgFactions(r: SimResult, pick: (f: Faction) => number[]): number[] {
  const series = FACTIONS.map(pick);
  return series[0].map((_, i) => mean(series.map((s) => s[i])));
}

export function HealthTable({ results }: { results: SimResult[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const ids = results[0].health.checks.map((c) => c.id);
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead className="text-muted text-left border-b border-line">
          <tr>
            <th className="px-4 py-2 font-display uppercase tracking-wider text-[12px]">Check</th>
            {results.map((r) => (
              <th key={r.config.algorithm} className="px-4 py-2 font-display uppercase tracking-wider text-[12px]">
                {results.length > 1 ? (r.config.algorithm === 'anchored' ? 'Anchored (new)' : 'Legacy (prototype)') : 'Result'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const checks = results.map((r) => r.health.checks.find((c) => c.id === id));
            const first = checks[0]!;
            return (
              <tr key={id} className="border-b border-line/60 align-top cursor-pointer hover:bg-white/[0.02]" onClick={() => setOpen(open === id ? null : id)}>
                <td className="px-4 py-2.5">
                  <div className="font-semibold">{first.label}</div>
                  {open === id && <div className="text-[12.5px] text-muted mt-1 max-w-[380px]">{first.detail}</div>}
                </td>
                {checks.map((c, k) => (
                  <td key={k} className="px-4 py-2.5">
                    {c ? (
                      <>
                        <Verdict verdict={c.verdict} />
                        <div className="text-[12.5px] text-text-2 mt-0.5 tnum">{c.value}</div>
                      </>
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-2 text-[12px] text-muted">Click a check for what it measures.</div>
    </div>
  );
}

export function ResultCharts({ results }: { results: SimResult[] }) {
  const primary = results.find((r) => r.config.algorithm === 'anchored') ?? results[0];
  const compare = results.length > 1;
  const [faction, setFaction] = useState<Faction>('automatons');
  const x = primary.days.map((d) => d.day);
  const markers = (primary.scenario.events ?? []).map((e) => ({ x: e.day, label: e.label.length > 28 ? e.label.slice(0, 27) + '…' : e.label }));

  const charts = useMemo(() => {
    const levelSeries = CATEGORIES.map((c) => ({
      id: c,
      label: CATEGORY_LABEL[c],
      color: CATEGORY_SERIES[c],
      values: avgFactions(primary, (f) => primary.days.map((d) => d.median[f][c])),
    }));
    const compareSeries = results.map((r) => ({
      id: r.config.algorithm,
      label: r.config.algorithm === 'anchored' ? 'Anchored' : 'Legacy',
      color: ALGORITHM_SERIES[r.config.algorithm as Algorithm],
      values: avgFactions(r, (f) => r.days.map((d) => d.median[f].stratagem)),
    }));
    const spend = [
      { id: 'typical', label: 'Average loadout price', color: CATEGORY_SERIES.stratagem, values: primary.days.map((d) => d.typicalLoadout) },
      { id: 'spent', label: 'Actually spent', color: CATEGORY_SERIES.primary, values: primary.days.map((d) => d.avgSpend) },
    ];
    const free = CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], color: CATEGORY_SERIES[c], values: primary.days.map((d) => d.freeUptake[c] * 100) }));
    const vol = results.map((r) => ({
      id: r.config.algorithm,
      label: r.config.algorithm === 'anchored' ? 'Anchored' : 'Legacy',
      color: ALGORITHM_SERIES[r.config.algorithm as Algorithm],
      values: r.days.map((d) => d.volatility * 100),
    }));
    return { levelSeries, compareSeries, spend, free, vol };
  }, [results, primary]);

  const finalIdx = primary.prices[faction].length - 1;
  const scatter = AVAILABLE[faction].stratagem
    .filter((i) => !i.alwaysFree)
    .map((i) => ({
      id: String(i.index),
      x: primary.strength[faction][i.index],
      y: primary.prices[faction][finalIdx][i.index],
      label: i.name,
      color: FACTION_SERIES[faction],
      detail: `u.gg tier ${i.tiers[faction]}`,
    }));
  const ranked = [...scatter].sort((a, b) => b.y - a.y);

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="panel p-4">
          {compare ? (
            <LineChart title="Stratagem price level: new vs prototype" subtitle="Median stratagem price, averaged over the three fronts" x={x} series={charts.compareSeries} markers={markers} zero />
          ) : (
            <LineChart title="Price level by category" subtitle="Median price of paid gear, averaged over the three fronts" x={x} series={charts.levelSeries} markers={markers} zero />
          )}
        </div>
        <div className="panel p-4">
          <LineChart
            title="Average loadout price vs what divers spent"
            subtitle="Average = community picks at full list price; spent is capped by income"
            x={x}
            series={charts.spend}
            reference={{ y: 24000, label: '24k design target' }}
            markers={markers}
            zero
          />
        </div>
        <div className="panel p-4">
          <LineChart title="Free gear uptake" subtitle="Share of picks that cost nothing (%)" x={x} series={charts.free} yFormat={(v) => `${v.toFixed(0)}%`} yDomain={[0, 100]} markers={markers} />
        </div>
        <div className="panel p-4">
          <LineChart title="Daily price movement" subtitle="Popularity-weighted average move per day (%)" x={x} series={charts.vol} yFormat={(v) => `${v.toFixed(1)}%`} markers={markers} zero />
        </div>
      </div>

      <div className="panel p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div className="text-[13px] text-muted">End state of the {compare ? 'anchored ' : ''}run</div>
          <div className="flex flex-wrap gap-1">
            {FACTIONS.map((f) => (
              <button key={f} className="chip chip-toggle" data-on={f === faction} onClick={() => setFaction(f)}>
                <FactionEmblem faction={f} size={13} /> {FACTION_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
          <ScatterChart
            title={`Does the meta cost more? (vs ${FACTION_LABEL[faction]})`}
            subtitle="Each dot is a stratagem: true strength in the simulation (u.gg tier ± hidden noise) against its final price"
            points={scatter}
            xLabel="True strength (tier points)"
            yLabel="Price"
            height={300}
          />
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            {[
              { t: 'Most expensive', l: ranked.slice(0, 8) },
              { t: 'Cheapest', l: ranked.slice(-8).reverse() },
            ].map((col) => (
              <div key={col.t}>
                <div className="font-display font-bold uppercase tracking-wider text-muted mb-1">{col.t}</div>
                {col.l.map((p) => {
                  const it = ITEMS[+p.id];
                  return (
                    <div key={p.id} className="flex items-center gap-2 py-1 border-t border-line/50">
                      <ItemIcon item={it} size={22} />
                      <span className="flex-1 truncate">{it.name}</span>
                      <span className="tnum text-text-2">{compact(p.y)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function VerdictBanner({ results }: { results: SimResult[] }) {
  return (
    <div className={`grid gap-3 ${results.length > 1 ? 'sm:grid-cols-2' : ''}`}>
      {results.map((r) => {
        const v = r.health.verdict;
        const counts = r.health.checks.reduce<Record<string, number>>((m, c) => ((m[c.verdict] = (m[c.verdict] ?? 0) + 1), m), {});
        return (
          <div key={r.config.algorithm} className="panel p-5 flex items-center gap-4" style={{ borderColor: VERDICT_COLOR[v] }}>
            <span className="w-12 h-12 grid place-items-center border-2" style={{ color: VERDICT_COLOR[v], borderColor: VERDICT_COLOR[v] }}>
              <StatusIcon verdict={v} size={24} />
            </span>
            <div className="flex-1">
              <div className="eyebrow">
                {r.scenario.name} · {r.config.algorithm === 'anchored' ? 'anchored (new)' : 'legacy (prototype)'} · {r.days.length} days · {r.elapsedMs} ms
              </div>
              <div className="h-display text-[30px]" style={{ color: VERDICT_COLOR[v] }}>
                {v === 'pass' ? 'Market healthy' : v === 'warn' ? 'Healthy with warnings' : 'Something went wrong'}
              </div>
              <div className="text-[13px] text-muted">
                {counts.pass ?? 0} pass · {counts.warn ?? 0} warn · {counts.fail ?? 0} fail · final average loadout price {req(r.days[r.days.length - 1]?.typicalLoadout ?? 0)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
