'use client';
import { useMemo, useState } from 'react';
import {
  AVAILABLE,
  CATEGORIES,
  CATEGORY_LABEL,
  FACTION_LABEL,
  FACTIONS,
  median,
  pendingCount,
  STRATAGEM_TYPE_LABEL,
  STRATAGEM_TYPES,
  summarizeCategory,
  tierScore,
  typicalLoadoutCost,
  type Category,
  type Faction,
  type Item,
  type StratagemType,
} from '@engine';
import { LineChart, Sparkline } from '@/components/charts';
import { ArrowCode, FactionEmblem, ItemIcon } from '@/components/icons';
import { ItemDetail } from '@/components/market/ItemDetail';
import { openTerminal } from '@/components/terminal';
import { Delta, PriceTag, Req, SectionTitle, Stat } from '@/components/ui';
import { req, timeAgo } from '@/lib/format';
import { useMarketView, type ItemView } from '@/lib/marketView';
import { CATEGORY_SERIES } from '@/lib/palette';
import { useApp } from '@/lib/store';

type SortKey = 'price' | 'change' | 'share' | 'tier' | 'name' | 'target';

export default function MarketPage() {
  const { market, history, ready, version } = useApp();
  const [faction, setFaction] = useState<Faction>('terminids');
  const [category, setCategory] = useState<Category>('stratagem');
  const [type, setType] = useState<StratagemType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'price', dir: -1 });
  const [detail, setDetail] = useState<Item | null>(null);
  const { byCategory } = useMarketView(faction);

  const rows = useMemo(() => {
    let l = [...byCategory[category]];
    if (category === 'stratagem' && type !== 'all') l = l.filter((v) => v.item.type === type);
    const q = query.trim().toLowerCase();
    if (q) l = l.filter((v) => v.item.name.toLowerCase().includes(q) || v.item.source.toLowerCase().includes(q));
    const val: Record<SortKey, (v: ItemView) => number | string> = {
      price: (v) => v.q.list,
      change: (v) => v.change,
      share: (v) => v.share,
      tier: (v) => tierScore(v.item.tiers[faction]),
      name: (v) => v.item.name,
      target: (v) => v.target,
    };
    return l.sort((a, b) => {
      const x = val[sort.key](a);
      const y = val[sort.key](b);
      return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir;
    });
  }, [byCategory, category, type, query, sort, faction]);

  const levels = useMemo(() => {
    const pts = history.points;
    return {
      x: pts.map((p) => p.day),
      series: CATEGORIES.map((c) => ({
        id: c,
        label: CATEGORY_LABEL[c],
        color: CATEGORY_SERIES[c],
        values: pts.map((p) => median(AVAILABLE[faction][c].filter((i) => !i.alwaysFree).map((i) => p.prices[faction]?.[i.index] ?? 0))),
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, faction, version]);

  if (!ready) return <div className="mx-auto max-w-[1400px] px-4 py-24 text-muted font-mono">Connecting to the Galactic Market…</div>;

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'left') => (
    <th className={`px-3 py-2 font-display uppercase tracking-wider text-[12px] font-semibold text-${align}`}>
      <button className={`hover:text-yellow ${sort.key === key ? 'text-yellow' : ''}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))}>
        {label} {sort.key === key ? (sort.dir === -1 ? '↓' : '↑') : ''}
      </button>
    </th>
  );

  const pending = pendingCount(market);
  const free = byCategory.stratagem.filter((v) => v.q.rotating);
  const strat = summarizeCategory(market, faction, 'stratagem');

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10">
      <SectionTitle
        eyebrow={`Market day #${market.day} · updated ${timeAgo(market.updatedAt)}`}
        title="Galactic Market"
        right={
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-[13px] text-muted">{pending} loadout{pending === 1 ? '' : 's'} waiting for tomorrow’s update</span>
            <button className="btn btn-ghost btn-sm font-mono normal-case tracking-normal" onClick={() => openTerminal('update')} title="Prototype only: the live site updates prices automatically once a day">
              <span className="text-[10px] font-sans font-bold px-1 bg-white/10">PROTOTYPE</span> run today’s update
            </button>
          </div>
        }
      />
      <p className="text-text-2 mt-2 max-w-3xl">
        Every enemy front has its own market: gear that shreds bugs can be cheap against bots. Prices follow what the community actually deploys — popular gear climbs, ignored gear gets cheap — and are updated once a
        day.
      </p>

      <div className="mt-6 flex gap-2 flex-wrap">
        {FACTIONS.map((f) => (
          <button
            key={f}
            onClick={() => setFaction(f)}
            className="flex items-center gap-2.5 px-4 py-2.5 border transition-colors"
            style={f === faction ? { borderColor: `var(--${f})`, background: `color-mix(in srgb, var(--${f}) 8%, transparent)` } : { borderColor: 'var(--line)' }}
            aria-pressed={f === faction}
          >
            <FactionEmblem faction={f} size={22} />
            <span className="font-display font-bold uppercase tracking-wider text-[16px]" style={f === faction ? { color: `var(--${f})` } : undefined}>
              {FACTION_LABEL[f]}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={`Average loadout price vs ${FACTION_LABEL[faction]}`} value={<Req value={typicalLoadoutCost(market, faction)} size={20} />} sub="What the average loadout deployed on this front costs at today’s prices" accent />
        <Stat label="Median stratagem" value={<Req value={strat.median} size={20} />} sub={`range ${req(strat.min)} – ${req(strat.max)}`} />
        <Stat label="Free stratagems" value={free.length} sub={free.map((v) => v.item.name).join(' · ')} />
        <Stat label="Loadouts counted" value={market.books[faction].totalLoadouts.toLocaleString()} sub={`${market.books[faction].lastLoadouts} in the last day`} />
      </div>

      <div className="mt-6 grid xl:grid-cols-[1fr_380px] gap-4 items-start">
        <div className="panel min-w-0">
          <div className="tabs px-3">
            {CATEGORIES.map((c) => (
              <button key={c} className="tab" data-on={c === category} onClick={() => setCategory(c)}>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          <div className="px-4 py-3 flex items-center gap-1.5 flex-wrap">
            {category === 'stratagem' &&
              (['all', ...STRATAGEM_TYPES] as const).map((t) => (
                <button key={t} className="chip chip-toggle" data-on={type === t} onClick={() => setType(t)}>
                  {t === 'all' ? 'All' : STRATAGEM_TYPE_LABEL[t]}
                </button>
              ))}
            <span className="flex-1" />
            <input className="field !w-56 !py-1.5" placeholder="Search name or warbond…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search items" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead className="text-muted border-y border-line bg-black/20">
                <tr>
                  {header('name', 'Item')}
                  {header('price', 'Price', 'right')}
                  {header('change', 'Since yesterday', 'right')}
                  <th className="px-3 py-2 font-display uppercase tracking-wider text-[12px] font-semibold text-left">Trend</th>
                  {header('share', 'Popularity')}
                  {market.config.algorithm === 'anchored' && header('target', 'Heading to', 'right')}
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.item.index} className="border-b border-line/60 hover:bg-white/[0.03] cursor-pointer" onClick={() => setDetail(v.item)}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <ItemIcon item={v.item} size={34} />
                        <div className="min-w-0">
                          <div className="font-semibold truncate max-w-[300px]">{v.item.name}</div>
                          <div className="text-[12px] text-muted flex items-center gap-2">
                            {v.item.category === 'stratagem' ? STRATAGEM_TYPE_LABEL[v.item.type!] : v.item.source}
                            {v.item.code && <ArrowCode code={v.item.code} size="sm" />}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <PriceTag q={v.q} />
                      {v.q.rotating && <div className="text-[11.5px] text-good">{v.freeLeft} day{v.freeLeft === 1 ? '' : 's'} left</div>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-[13px]">
                      <Delta value={v.change} />
                    </td>
                    <td className="px-3 py-2">
                      <Sparkline values={v.trend} />
                    </td>
                    <td className="px-3 py-2 min-w-[130px]">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-white/5">
                          <div className="h-full bg-text-2/70" style={{ width: `${Math.min(100, (v.ratio / 3) * 100)}%` }} />
                        </div>
                        <span className="tnum text-[12.5px] text-muted">{(v.share * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                    {market.config.algorithm === 'anchored' && (
                      <td className="px-3 py-2 text-right tnum text-[13px] text-muted">{v.item.alwaysFree ? '—' : req(v.target)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4 xl:sticky xl:top-[74px] min-w-0">
          <div className="panel p-4">
            {levels.x.length > 1 ? (
              <LineChart title={`Price levels vs ${FACTION_LABEL[faction]}`} subtitle="Median list price of paid gear, per day" x={levels.x} series={levels.series} height={220} zero />
            ) : (
              <div>
                <div className="font-display font-bold uppercase tracking-wider">Price levels</div>
                <p className="text-[13.5px] text-muted mt-2">
                  No price history yet. Deploy some squads, or let synthetic squads play: run <button className="font-mono text-yellow hover:underline" onClick={() => openTerminal('sim day 40')}>sim day 40</button> a few times in the terminal.
                </p>
              </div>
            )}
          </div>
          <div className="panel p-4 text-[13.5px] text-text-2">
            <div className="font-display font-bold uppercase tracking-wider text-text mb-1">How to read this</div>
            <ul className="space-y-1.5 list-disc pl-4 marker:text-dim">
              <li>
                <span className="text-text">Popularity</span> is the smoothed share of picks; the bar fills at 3× a fair share.
              </li>
              <li>
                <span className="text-text">Heading to</span> is the price the algorithm is steering toward. Prices move at most {Math.round(market.config.anchored.maxStep * 100)}% per day.
              </li>
              <li>
                <span style={{ color: 'var(--bad)' }}>▲</span> pricier · <span style={{ color: 'var(--good)' }}>▼</span> cheaper than yesterday.
              </li>
            </ul>
          </div>
        </div>
      </div>
      <ItemDetail item={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
