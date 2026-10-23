'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  activeDivers,
  canDeploy,
  CATEGORY_SINGULAR,
  checkLoadout,
  cheapestLoadout,
  FACTION_LABEL,
  ITEMS,
  setLoadout,
  setReady,
  setSlot,
  SLOT_CATEGORIES,
  STRATAGEM_TYPE_LABEL,
  STRATAGEM_TYPES,
  tierScore,
  type Campaign,
  type Diver,
  type Item,
  type StratagemType,
} from '@engine';
import { DIVER_COLORS, req } from '@/lib/format';
import { useMarketView, type ItemView } from '@/lib/marketView';
import { ArrowCode, Check, FactionEmblem, ItemIcon } from '../icons';
import { Delta, Meter, PriceTag, Req, TierBadge } from '../ui';
import { useCampaign } from './useCampaign';

type Sort = 'price-desc' | 'price-asc' | 'popular' | 'tier' | 'name';
const SLOT_LABEL = ['Stratagem 1', 'Stratagem 2', 'Stratagem 3', 'Stratagem 4', 'Primary', 'Secondary', 'Throwable'];
const WEAPON_CLASS_LABEL: Record<string, string> = {
  rifle: 'Assault rifle',
  energy: 'Energy weapon',
  shotgun: 'Shotgun',
  smg: 'SMG',
  marksman: 'Marksman rifle',
  explosive: 'Explosive',
  special: 'Special',
  flame: 'Incendiary',
  pistol: 'Pistol',
  melee: 'Melee',
  frag: 'Explosive',
  fire: 'Incendiary',
  cloud: 'Gas / smoke / stun',
};

function subLabel(item: Item): string {
  if (item.category === 'stratagem') return STRATAGEM_TYPE_LABEL[item.type!];
  if (item.category === 'throwable' && item.weaponClass === 'special') return 'Special';
  return WEAPON_CLASS_LABEL[item.weaponClass ?? ''] ?? CATEGORY_SINGULAR[item.category];
}

/** Soft warnings about slot overlaps HD2 players care about (not rule violations). */
function conflicts(item: Item, d: Diver, slot: number): string | null {
  if (item.category !== 'stratagem') return null;
  const others = d.loadout.filter((idx, s) => idx !== null && s !== slot && s < 4).map((idx) => ITEMS[idx!]);
  if (item.backpack && others.some((o) => o.backpack)) return 'Backpack slot taken';
  if (item.type === 'support' && others.some((o) => o.type === 'support')) return '2nd support weapon';
  if (item.type === 'vehicle' && others.some((o) => o.type === 'vehicle')) return '2nd vehicle';
  return null;
}

function ItemCard({ v, equipped, affordable, need, warn, squad, showTier, faction, onPick }: { v: ItemView; equipped: boolean; affordable: boolean; need: number; warn: string | null; squad: number[]; showTier: boolean; faction: Campaign['faction']; onPick: () => void }) {
  const it = v.item;
  const pop = Math.min(1, v.ratio / 3);
  return (
    <button
      onClick={onPick}
      className={`relative text-left p-3 border transition-all group ${equipped ? 'border-yellow bg-yellow/[0.06] shadow-[0_0_0_1px_var(--yellow),0_0_18px_-6px_var(--yellow-glow)]' : 'border-line bg-panel hover:border-line-2 hover:bg-panel-2'} ${affordable || equipped ? '' : 'opacity-50'}`}
      aria-pressed={equipped}
      title={it.name}
    >
      {equipped && <span className="absolute -top-px -right-px bg-yellow text-yellow-ink text-[10.5px] font-display font-bold tracking-wider px-1.5 py-0.5">EQUIPPED</span>}
      <div className="flex gap-3">
        <ItemIcon item={it} size={46} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight text-[14.5px] line-clamp-2">{it.name}</div>
          <div className="text-[12px] text-muted mt-0.5">{subLabel(it)}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <PriceTag q={v.q} size="sm" />
        <Delta value={v.change} className="text-[12px]" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        {showTier && <TierBadge tier={it.tiers[faction]} title={`u.gg tier vs ${FACTION_LABEL[faction]}`} />}
        <div className="flex-1 h-1 bg-white/5" title={`${(v.share * 100).toFixed(1)}% of picks`}>
          <div className="h-full bg-text-2/60" style={{ width: `${pop * 100}%` }} />
        </div>
        {squad.map((c) => (
          <span key={c} className="w-2 h-2 rounded-full" style={{ background: DIVER_COLORS[c] }} title="A squadmate has this equipped" />
        ))}
      </div>
      {!affordable && !equipped && <div className="mt-1.5 text-[11.5px] text-bad">Need {req(need)} more</div>}
      {warn && !equipped && <div className="mt-1.5 text-[11.5px] text-warn">⚠ {warn}</div>}
      {v.q.rotating && <div className="mt-1.5 text-[11.5px] text-good">Free for {v.freeLeft} more cycle{v.freeLeft === 1 ? '' : 's'}</div>}
    </button>
  );
}

export function Armory() {
  const { campaign: c, apply, app, deploySquad } = useCampaign();
  const divers = useMemo(() => (c ? activeDivers(c) : []), [c]);
  const [diverId, setDiverId] = useState(divers[0]?.id ?? 'd1');
  const [slot, setActiveSlot] = useState(0);
  const [type, setType] = useState<StratagemType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('price-desc');
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [showTiers, setShowTiers] = useState(true);
  const faction = c?.faction ?? 'terminids';
  const { byCategory, views } = useMarketView(faction);

  useEffect(() => {
    if (c && !divers.some((d) => d.id === diverId)) setDiverId(divers[0]?.id ?? 'd1');
  }, [c, divers, diverId]);

  const diver = divers.find((d) => d.id === diverId) ?? divers[0];
  const category = SLOT_CATEGORIES[slot];
  const check = c && diver ? checkLoadout(c, diver, app.market) : null;
  const remaining = check ? check.limit - check.total : 0;

  const list = useMemo(() => {
    let l = [...byCategory[category]];
    if (category === 'stratagem' && type !== 'all') l = l.filter((v) => v.item.type === type);
    const q = query.trim().toLowerCase();
    if (q) l = l.filter((v) => v.item.name.toLowerCase().includes(q));
    const by: Record<Sort, (a: ItemView, b: ItemView) => number> = {
      'price-desc': (a, b) => b.q.price - a.q.price || b.q.list - a.q.list,
      'price-asc': (a, b) => a.q.price - b.q.price || a.q.list - b.q.list,
      popular: (a, b) => b.share - a.share,
      tier: (a, b) => tierScore(b.item.tiers[faction]) - tierScore(a.item.tiers[faction]) || b.q.price - a.q.price,
      name: (a, b) => a.item.name.localeCompare(b.item.name),
    };
    return l.sort(by[sort]);
  }, [byCategory, category, type, query, sort, faction]);

  if (!c || !diver || !check) return null;

  const currentInSlot = diver.loadout[slot];
  const priceOf = (idx: number | null) => (idx === null ? 0 : views.get(idx)?.q.price ?? 0);

  const pick = (it: Item) => {
    if (it.category === 'stratagem') {
      const at = diver.loadout.indexOf(it.index);
      if (at >= 0 && at < 4) {
        apply((x) => setSlot(x, diver.id, at, null));
        setActiveSlot(at);
        return;
      }
      const target = SLOT_CATEGORIES[slot] === 'stratagem' ? slot : diver.loadout.findIndex((v, s) => s < 4 && v === null);
      const s = target >= 0 ? target : 0;
      apply((x) => setSlot(x, diver.id, s, it.index));
      const nextEmpty = diver.loadout.findIndex((v, k) => k !== s && v === null);
      if (nextEmpty >= 0) setActiveSlot(nextEmpty);
    } else {
      const s = SLOT_CATEGORIES.indexOf(it.category);
      apply((x) => setSlot(x, diver.id, s, diver.loadout[s] === it.index ? null : it.index));
      const nextEmpty = diver.loadout.findIndex((v, k) => k !== s && v === null);
      if (nextEmpty >= 0) setActiveSlot(nextEmpty);
    }
  };

  const squadDots = (idx: number) => c.divers.filter((d) => d.id !== diver.id && d.status === 'active' && d.loadout.includes(idx)).map((d) => d.color);
  const deployGate = canDeploy(c, app.market);
  const isOps = c.mode === 'operations';

  return (
    <div className="rise">
      {/* Squad tabs */}
      <div className="flex gap-2 flex-wrap">
        {divers.map((d) => {
          const chk = checkLoadout(c, d, app.market);
          const on = d.id === diver.id;
          return (
            <button
              key={d.id}
              onClick={() => setDiverId(d.id)}
              className={`flex items-center gap-3 px-4 py-2.5 border transition-colors ${on ? 'border-yellow bg-yellow/[0.06]' : 'border-line bg-panel hover:border-line-2'}`}
              aria-pressed={on}
            >
              <span className="w-2.5 h-8" style={{ background: DIVER_COLORS[d.color] }} />
              <span className="text-left">
                <span className="block font-display font-bold uppercase tracking-wider text-[15px] leading-tight">{d.name}</span>
                <span className="block text-[12px] text-muted tnum">
                  {req(chk.total)} / {isOps ? req(d.balance) : req(chk.limit)}
                </span>
              </span>
              <span className={`w-6 h-6 grid place-items-center border ${d.ready ? 'bg-good border-good text-black' : chk.ok ? 'border-line-2 text-transparent' : 'border-bad/60 text-bad'}`} title={d.ready ? 'Ready' : chk.ok ? 'Not ready' : chk.problems[0]?.message}>
                {d.ready ? <Check size={13} /> : chk.ok ? '' : '!'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid xl:grid-cols-[400px_1fr] gap-4 items-start">
        {/* Loadout */}
        <div className="panel panel-accent xl:sticky xl:top-[70px] xl:max-h-[calc(100vh-150px)] xl:overflow-y-auto">
          <div className="px-5 pt-4 pb-3 border-b border-line flex items-center justify-between">
            <div>
              <div className="eyebrow">Loadout · vs {FACTION_LABEL[faction]}</div>
              <div className="h-display text-[26px]" style={{ color: DIVER_COLORS[diver.color] }}>
                {diver.name}
              </div>
            </div>
            <FactionEmblem faction={faction} size={32} />
          </div>
          <div className="p-3 space-y-1.5">
            {SLOT_LABEL.map((label, s) => {
              const idx = diver.loadout[s];
              const it = idx !== null ? ITEMS[idx] : null;
              const v = idx !== null ? views.get(idx) : undefined;
              const on = s === slot;
              return (
                <div
                  key={s}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveSlot(s)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setActiveSlot(s)}
                  className={`flex items-center gap-3 px-2.5 py-1.5 border cursor-pointer transition-colors ${on ? 'border-yellow/80 bg-yellow/[0.05]' : 'border-line/70 hover:border-line-2'} ${s === 4 ? 'mt-2.5' : ''}`}
                >
                  {it ? <ItemIcon item={it} size={34} /> : <span className="w-[34px] h-[34px] border border-dashed border-line-2 grid place-items-center text-dim text-xl">+</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wider text-muted font-display font-semibold">{label}</div>
                    <div className={`truncate text-[14px] ${it ? 'font-semibold' : 'text-dim'}`}>{it ? it.name : `Choose a ${CATEGORY_SINGULAR[SLOT_CATEGORIES[s]].toLowerCase()}`}</div>
                    {it?.code && <ArrowCode code={it.code} size="sm" className="mt-0.5" />}
                  </div>
                  {v && <PriceTag q={v.q} size="sm" />}
                  {it && (
                    <button
                      className="text-muted hover:text-bad px-1 text-lg leading-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        apply((x) => setSlot(x, diver.id, s, null));
                      }}
                      aria-label={`Remove ${it.name}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-5 py-4 border-t border-line space-y-2 text-[14px]">
            <div className="flex justify-between">
              <span className="text-muted">Loadout cost</span>
              <Req value={check.total} className="font-semibold" />
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{isOps ? 'Balance' : 'Round spending cap'}</span>
              <Req value={check.limit} />
            </div>
            <Meter value={check.total} max={check.limit} />
            <div className="flex justify-between">
              <span className="text-muted">{isOps ? 'Left after purchase' : 'Headroom'}</span>
              <Req value={remaining} className={remaining < 0 ? 'text-bad font-semibold' : 'font-semibold'} />
            </div>
            {!isOps && <div className="text-[12.5px] text-muted">To survive this round you must earn more than {req(check.total)} plus reinforcements.</div>}
            {check.problems.filter((p) => !/empty/.test(p.message)).map((p) => (
              <div key={p.message} className="text-[13px] text-bad">
                ✖ {p.message}
              </div>
            ))}
          </div>
          <div className="px-5 pb-5 flex flex-wrap gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => apply((x) => setLoadout(x, diver.id, cheapestLoadout(faction, app.market)))} title="Fill every slot with the cheapest option (usually completely free)">
              Cheapest kit
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const cheap = cheapestLoadout(faction, app.market);
                const used = new Set(diver.loadout.filter((v) => v !== null));
                const next = diver.loadout.map((v, s) => {
                  if (v !== null) return v;
                  if (s < 4) {
                    const pickFree = byCategory.stratagem.filter((x) => x.q.free && !used.has(x.item.index)).map((x) => x.item.index)[0] ?? cheap[s];
                    used.add(pickFree);
                    return pickFree;
                  }
                  return cheap[s];
                });
                apply((x) => setLoadout(x, diver.id, next));
              }}
            >
              Fill empty with free
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => apply((x) => setLoadout(x, diver.id, new Array(7).fill(null)))}>
              Clear
            </button>
            <button
              className={`btn ${diver.ready ? 'btn-ghost' : 'btn-primary'} ml-auto`}
              disabled={!check.ok}
              onClick={() => {
                apply((x) => setReady(x, diver.id, !diver.ready));
                const next = divers.find((d) => d.id !== diver.id && !d.ready);
                if (!diver.ready && next) setDiverId(next.id);
              }}
            >
              {diver.ready ? 'Unready' : 'Ready up'}
            </button>
          </div>
        </div>

        {/* Picker */}
        <div className="panel min-w-0">
          <div className="px-5 pt-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="eyebrow">Armory · {SLOT_LABEL[slot]}</div>
              <div className="h-display text-[28px]">{category === 'stratagem' ? 'Stratagems' : CATEGORY_SINGULAR[category] + ' weapons'}</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input className="field !w-48 !py-1.5" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search items" />
              <select className="field !w-auto !py-1.5" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
                <option value="price-desc">Price ↓</option>
                <option value="price-asc">Price ↑</option>
                <option value="popular">Most popular</option>
                <option value="tier">u.gg tier</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>
          <div className="px-5 mt-3 flex items-center gap-1.5 flex-wrap">
            {category === 'stratagem' &&
              (['all', ...STRATAGEM_TYPES] as const).map((t) => (
                <button key={t} className="chip chip-toggle" data-on={type === t} onClick={() => setType(t)}>
                  {t === 'all' ? 'All' : STRATAGEM_TYPE_LABEL[t]}
                </button>
              ))}
            <span className="flex-1" />
            <button className="chip chip-toggle" data-on={affordableOnly} onClick={() => setAffordableOnly((a) => !a)}>
              Affordable only
            </button>
            <button className="chip chip-toggle" data-on={showTiers} onClick={() => setShowTiers((a) => !a)} title="Show u.gg tier ratings (for reference — prices come from the market, not the tier list)">
              Tiers
            </button>
          </div>
          <div className="p-5 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
            {list
              .filter((v) => !affordableOnly || v.q.price - priceOf(category === 'stratagem' ? null : currentInSlot) <= remaining || diver.loadout.includes(v.item.index))
              .map((v) => {
                const equipped = diver.loadout.includes(v.item.index);
                const replacing = category === 'stratagem' ? priceOf(diver.loadout[slot]) : priceOf(currentInSlot);
                const need = v.q.price - replacing - remaining;
                return (
                  <ItemCard
                    key={v.item.index}
                    v={v}
                    equipped={equipped}
                    affordable={need <= 0}
                    need={need}
                    warn={conflicts(v.item, diver, slot)}
                    squad={squadDots(v.item.index)}
                    showTier={showTiers}
                    faction={faction}
                    onPick={() => pick(v.item)}
                  />
                );
              })}
          </div>
        </div>
      </div>

      {/* Deploy bar */}
      <div className="sticky bottom-0 z-30 mt-4">
        <div className="panel panel-accent px-5 py-3 flex items-center gap-4 flex-wrap" style={{ background: 'rgba(12,16,20,0.97)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            {divers.map((d) => (
              <span key={d.id} className="inline-flex items-center gap-1.5 text-[13.5px]">
                <span className={`w-4 h-4 grid place-items-center border ${d.ready ? 'bg-good border-good text-black' : 'border-line-2'}`}>{d.ready && <Check size={10} />}</span>
                <span style={{ color: DIVER_COLORS[d.color] }}>{d.name}</span>
              </span>
            ))}
          </div>
          <div className="flex-1 text-[13px] text-muted truncate">{deployGate.ok ? 'All Helldivers ready. Prices lock in when you deploy.' : deployGate.reasons[0]}</div>
          <button className="btn btn-primary btn-lg" disabled={!deployGate.ok} onClick={deploySquad}>
            Deploy squad
          </button>
        </div>
      </div>
    </div>
  );
}
