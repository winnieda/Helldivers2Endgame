'use client';
import { useMemo } from 'react';
import {
  AVAILABLE,
  CATEGORY_SINGULAR,
  FACTION_LABEL,
  FACTIONS,
  OWNERSHIP_LABEL,
  popularityMultiple,
  priceSeries,
  quote,
  STRATAGEM_TYPE_LABEL,
  type Item,
} from '@engine';
import { req } from '@/lib/format';
import { FACTION_SERIES } from '@/lib/palette';
import { useApp } from '@/lib/store';
import { LineChart } from '../charts';
import { ArrowCode, FactionEmblem, ItemIcon } from '../icons';
import { Delta, Modal, PriceTag, Req } from '../ui';

export function ItemDetail({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { market, history, version } = useApp();
  const charts = useMemo(() => {
    if (!item) return null;
    const days = history.points.map((p) => p.day);
    const byDay = (f: (typeof FACTIONS)[number], key: 'price' | 'share') => {
      const s = new Map(priceSeries(history, f, item.index).map((x) => [x.day, key === 'price' ? x.price : x.share * 100]));
      return days.map((d) => s.get(d) ?? null);
    };
    const avail = FACTIONS.filter((f) => item.tiers[f]);
    return {
      days,
      price: avail.map((f) => ({ id: f, label: FACTION_LABEL[f], color: FACTION_SERIES[f], values: byDay(f, 'price') })),
      share: avail.map((f) => ({ id: f, label: FACTION_LABEL[f], color: FACTION_SERIES[f], values: byDay(f, 'share') })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, history, version]);

  if (!item) return null;
  const p = market.config.anchored;
  const anchored = market.config.algorithm === 'anchored';

  return (
    <Modal open={!!item} onClose={onClose} title={item.name} wide>
      <div className="flex items-start gap-4 flex-wrap">
        <ItemIcon item={item} size={72} />
        <div className="flex-1 min-w-[220px]">
          <div className="text-muted text-[14px]">
            {item.fullName !== item.name && <span className="text-text-2">{item.fullName} · </span>}
            {item.category === 'stratagem' ? STRATAGEM_TYPE_LABEL[item.type!] + ' stratagem' : CATEGORY_SINGULAR[item.category]} · {item.source}
          </div>
          <div className="text-[13px] text-muted mt-0.5">
            {OWNERSHIP_LABEL[item.ownership]}
            {item.ownership !== 'base' && anchored && ` · observed picks ÷ ${p.ownershipFactor[item.ownership]} (fewer players own it)`}
            {item.cooldown ? ` · ${item.cooldown}s cooldown` : ''}
          </div>
          {item.code && <ArrowCode code={item.code} className="mt-2" />}
          {item.alwaysFree && <div className="mt-2 chip" style={{ color: 'var(--good)', borderColor: 'currentColor' }}>Permanently free</div>}
        </div>
      </div>

      <div className="mt-5 grid sm:grid-cols-3 gap-3">
        {FACTIONS.map((f) => {
          const b = market.books[f].items[item.index];
          const q = quote(market, f, item.index);
          const n = AVAILABLE[f][item.category].length;
          const ratio = b ? b.share * n : 0;
          return (
            <div key={f} className="panel-flat p-4" style={{ borderTop: `2px solid var(--${f})` }}>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 font-display font-bold uppercase tracking-wider">
                  <FactionEmblem faction={f} size={18} /> {FACTION_LABEL[f]}
                </span>
              </div>
              {b ? (
                <>
                  <div className="mt-2 flex items-center justify-between">
                    <PriceTag q={q} size="lg" />
                    <Delta value={b.prevPrice > 0 && !item.alwaysFree ? b.price / b.prevPrice - 1 : 0} className="text-[13px]" />
                  </div>
                  <div className="mt-2 text-[13px] text-muted space-y-0.5">
                    <div>
                      {(b.share * 100).toFixed(2)}% of {item.category === 'stratagem' ? 'stratagem' : CATEGORY_SINGULAR[item.category].toLowerCase()} picks ·{' '}
                      <span className="text-text-2">{ratio.toFixed(2)}× fair share</span>
                    </div>
                    {anchored && !item.alwaysFree && (
                      <div>
                        Heading toward <Req value={b.target} className="text-text-2" size={12} />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="mt-2 text-dim">Not usable against this faction.</div>
              )}
            </div>
          );
        })}
      </div>

      {charts && charts.days.length > 1 ? (
        <div className="mt-6 grid lg:grid-cols-2 gap-6">
          <LineChart title="List price" subtitle="By faction market, per day" x={charts.days} series={charts.price} height={210} zero />
          <LineChart title="Popularity" subtitle="Smoothed share of picks in its category (%)" x={charts.share.length ? charts.days : []} series={charts.share} height={210} yFormat={(v) => `${v.toFixed(1)}%`} zero />
        </div>
      ) : (
        <div className="mt-6 text-muted text-[14px]">{__DEV_TOOLS__ ? 'No history yet — run a few market updates (`sim day 40` then `update`) to see this item’s price move.' : 'No history yet. Prices update once a day; this chart fills in after the first update.'}</div>
      )}

      {anchored && !item.alwaysFree && (
        <div className="mt-6 panel-flat p-4 text-[14px] text-text-2 leading-relaxed">
          <div className="font-display font-bold uppercase tracking-wider text-text mb-1">Why this price</div>
          Each faction market measures how often this {item.category === 'stratagem' ? 'stratagem' : 'weapon'} is picked relative to a fair share of its category. An item at exactly a fair share is worth the{' '}
          {CATEGORY_SINGULAR[item.category].toLowerCase()} baseline of <span className="text-text">{req(p.baseline[item.category])}</span>; at 2× fair share its target is{' '}
          <span className="text-text">{req(p.baseline[item.category] * popularityMultiple(2, p))}</span>, at half it’s <span className="text-text">{req(p.baseline[item.category] * popularityMultiple(0.5, p))}</span>. Targets never
          pass {req(p.baseline[item.category] * p.ceilingMultiple)} or drop under {req(p.baseline[item.category] * p.floorMultiple)}, and prices move at most {Math.round(p.maxStep * 100)}% per day toward them.
        </div>
      )}
    </Modal>
  );
}
