'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  activeDivers,
  canDeploy,
  CATEGORY_SINGULAR,
  checkLoadout,
  cheapestLoadout,
  ITEMS,
  median,
  randomLoadout,
  SLOT_CATEGORIES,
  STRATAGEM_TYPE_LABEL,
  STRATAGEM_TYPES,
  type Diver,
  type Item,
  type StratagemType,
} from '@engine';
import { DIVER_COLORS, req } from '@/lib/format';
import { useMarketView, type ItemView } from '@/lib/marketView';
import { Check, ItemIcon, ReqIcon } from '../icons';
import { endRun, feedbackUrl } from '@/lib/feedback';
import { lobby } from '@/lib/lobby';
import { useRouter } from 'next/navigation';
import { Meter, Modal, PriceTag, Req } from '../ui';
import { useCampaign } from './useCampaign';

type Sort = 'price-desc' | 'price-asc' | 'popular' | 'name';
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

/** Where a price sits within its category on this front: a quick read instead of a number. */
export function priceBand(list: number, median: number): { label: string; color: string } {
  const r = median > 0 ? list / median : 1;
  if (r >= 1.6) return { label: 'Premium', color: 'var(--bad)' };
  if (r >= 1.15) return { label: 'Pricey', color: '#ff9b57' };
  if (r > 0.85) return { label: 'Average', color: 'var(--text-2)' };
  if (r > 0.5) return { label: 'Cheap', color: '#9be564' };
  return { label: 'Bargain', color: 'var(--good)' };
}

function ItemCard({ v, median, equipped, affordable, need, warn, squad, onPick }: { v: ItemView; median: number; equipped: boolean; affordable: boolean; need: number; warn: string | null; squad: number[]; onPick: () => void }) {
  const it = v.item;
  const band = v.q.free ? { label: v.q.rotating ? `Free · ${v.freeLeft} day${v.freeLeft === 1 ? '' : 's'}` : 'Always free', color: 'var(--good)' } : priceBand(v.q.list, median);
  const note = warn && !equipped ? <span className="text-warn">⚠ {warn}</span> : !affordable && !equipped ? <span className="text-bad">Need {req(need)} more</span> : null;
  return (
    <button
      onClick={onPick}
      className={`relative text-left p-3 border transition-all group ${equipped ? 'border-yellow bg-yellow/[0.06] shadow-[0_0_0_1px_var(--yellow),0_0_18px_-6px_var(--yellow-glow)]' : 'border-line bg-panel hover:border-line-2 hover:bg-panel-2'} ${affordable || equipped ? '' : 'opacity-50'}`}
      aria-pressed={equipped}
      title={it.fullName}
    >
      {equipped && <span className="absolute -top-px -right-px bg-yellow text-yellow-ink text-[10.5px] font-display font-bold tracking-wider px-1.5 py-0.5">EQUIPPED</span>}
      <div className="flex gap-3">
        <ItemIcon item={it} size={46} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight text-[14.5px] line-clamp-2 pr-2">{it.name}</div>
          <div className="text-[12px] text-muted mt-0.5 flex items-center gap-1.5 min-w-0">
            <span className="truncate">{note ?? subLabel(it)}</span>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {v.q.free ? (
          <span className="h-display text-[26px] leading-none text-good">FREE</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-display font-bold text-[26px] leading-none tnum">
            <ReqIcon size={24} />
            {req(v.q.price)}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          {squad.map((c) => (
            <span key={c} className="w-2 h-2 rounded-full" style={{ background: DIVER_COLORS[c] }} title="A squadmate has this equipped" />
          ))}
          <span className="font-display font-bold uppercase tracking-wider text-[13px]" style={{ color: band.color }} title={v.q.free ? undefined : `Compared with the median ${CATEGORY_SINGULAR[it.category].toLowerCase()} price on this front`}>
            {band.label}
          </span>
        </span>
      </div>
    </button>
  );
}

export function Armory() {
  const router = useRouter();
  // Warm the feedback page so leaving the run shows it immediately.
  useEffect(() => {
    router.prefetch("/feedback/");
  }, [router]);
  const { campaign: c, act, app, inLobby, isHost, myDiverId, canControl, lobbyView } = useCampaign();
  const divers = useMemo(() => (c ? activeDivers(c) : []), [c]);
  // In a lobby each player starts on their own Helldiver.
  const [chosen, setDiverId] = useState<string | null>(null);
  const diverId = chosen ?? myDiverId ?? divers[0]?.id ?? 'd1';
  const [slot, setActiveSlot] = useState(0);
  const [type, setType] = useState<StratagemType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('price-desc');
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  const faction = c?.faction ?? 'terminids';
  const { byCategory, views } = useMarketView(faction);
  const medians = useMemo(
    () => Object.fromEntries(Object.entries(byCategory).map(([k, l]) => [k, median(l.filter((x) => !x.item.alwaysFree).map((x) => x.q.list))])) as Record<string, number>,
    [byCategory],
  );

  useEffect(() => {
    if (c && chosen && !divers.some((d) => d.id === chosen)) setDiverId(null);
  }, [c, divers, chosen]);

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
      name: (a, b) => a.item.name.localeCompare(b.item.name),
    };
    return l.sort(by[sort]);
  }, [byCategory, category, type, query, sort]);

  if (!c || !diver || !check) return null;

  const currentInSlot = diver.loadout[slot];
  const priceOf = (idx: number | null) => (idx === null ? 0 : views.get(idx)?.q.price ?? 0);
  const editable = canControl(diver.id);
  const memberOf = (id: string) => lobbyView?.members.find((m) => m.diverId === id);
  const hostName = lobbyView?.members.find((m) => m.host)?.name ?? 'the host';
  const setSlot = (s: number, index: number | null) => void act({ type: 'setSlot', diverId: diver.id, slot: s, index });

  const pick = (it: Item) => {
    if (!editable) return;
    if (it.category === 'stratagem') {
      const at = diver.loadout.indexOf(it.index);
      if (at >= 0 && at < 4) {
        setSlot(at, null);
        setActiveSlot(at);
        return;
      }
      const target = SLOT_CATEGORIES[slot] === 'stratagem' ? slot : diver.loadout.findIndex((v, s) => s < 4 && v === null);
      const s = target >= 0 ? target : 0;
      setSlot(s, it.index);
      const nextEmpty = diver.loadout.findIndex((v, k) => k !== s && v === null);
      if (nextEmpty >= 0) setActiveSlot(nextEmpty);
    } else {
      const s = SLOT_CATEGORIES.indexOf(it.category);
      setSlot(s, diver.loadout[s] === it.index ? null : it.index);
      const nextEmpty = diver.loadout.findIndex((v, k) => k !== s && v === null);
      if (nextEmpty >= 0) setActiveSlot(nextEmpty);
    }
  };

  const squadDots = (idx: number) => c.divers.filter((d) => d.id !== diver.id && d.status === 'active' && d.loadout.includes(idx)).map((d) => d.color);
  const deployGate = canDeploy(c, app.market);
  const isOps = c.mode === 'operations';

  return (
    <div className="rise">
      {/* Squad row: who's ready on the left, the squad's decisions on the right */}
      <div className="sticky top-[58px] z-30 -mx-4 px-4 py-2.5 flex items-center gap-3 flex-wrap border-b border-line" style={{ background: 'rgba(7,9,11,0.95)' }}>
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
                <span className="block font-display font-bold uppercase tracking-wider text-[15px] leading-tight">
                  {d.name}
                  {inLobby && d.id === myDiverId && <span className="ml-1.5 text-[11px] text-yellow">You</span>}
                  {inLobby && !memberOf(d.id)?.online && <span className="ml-1.5 text-[11px] text-warn" title="This player has gone quiet or left; the host can ready their Helldiver">Away</span>}
                </span>
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
        <div className="flex-1 min-w-[160px] text-[13px] text-muted text-right">
          {deployGate.ok ? (isHost ? 'All Helldivers ready. Prices lock in when you deploy.' : `All Helldivers ready. Waiting for ${hostName} to deploy the squad.`) : deployGate.reasons[0]}
        </div>
        {isHost && (
          <>
            <button className="btn btn-danger" onClick={() => setConfirmAbandon(true)}>
              Abandon mission
            </button>
            <button className="btn btn-primary btn-lg" disabled={!deployGate.ok} onClick={() => setConfirmDeploy(true)}>
              Deploy squad
            </button>
          </>
        )}
      </div>

      <div className="mt-4 grid xl:grid-cols-[460px_1fr] gap-4 items-start">
        {/* Loadout */}
        <div className="panel panel-accent xl:sticky xl:top-[140px] xl:max-h-[calc(100vh-160px)] xl:overflow-y-auto">
          <div className="px-5 pt-4 pb-3 border-b border-line">
            <div className="h-display text-[26px]" style={{ color: DIVER_COLORS[diver.color] }}>
              {diver.name}
            </div>
            {!editable && <div className="text-[13px] text-muted">Another player’s loadout. You’ll see their picks as they make them.</div>}
            {inLobby && editable && diver.id !== myDiverId && <div className="text-[13px] text-warn">This player is away, so you can pick and ready for them.</div>}
          </div>
          <div className="px-5 py-4 border-b border-line space-y-2 text-[14px]">
            <div className="flex justify-between items-center">
              <span className="text-muted">Loadout cost</span>
              <span className="inline-flex items-center gap-1 tnum font-semibold text-bad">
                −<ReqIcon size={14} />
                {req(check.total)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">{isOps ? 'Balance Left' : 'Headroom'}</span>
              <Req value={remaining} className={remaining < 0 ? 'text-bad font-semibold' : 'font-semibold'} />
            </div>
            <Meter value={check.total} max={check.limit} />
            {!isOps && <div className="text-[12.5px] text-muted">To survive this round you must earn more than {req(check.total)}.</div>}
            {check.problems.filter((p) => !/empty/.test(p.message)).map((p) => (
              <div key={p.message} className="text-[13px] text-bad">
                ✖ {p.message}
              </div>
            ))}
                      <div className="flex flex-wrap items-center gap-1.5 pt-2">
              <button className="btn btn-ghost btn-sm" disabled={!editable} onClick={() => void act({ type: 'setLoadout', diverId: diver.id, items: randomLoadout(faction, app.market, check.limit) })} title="Random equipment that this Helldiver can afford">
                Random kit
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!editable}
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
                  void act({ type: 'setLoadout', diverId: diver.id, items: next });
                }}
              >
                Fill empty with free
              </button>
              <button className="btn btn-ghost btn-sm" disabled={!editable} onClick={() => void act({ type: 'setLoadout', diverId: diver.id, items: new Array(7).fill(null) })}>
                Clear
              </button>
              <button
                className={`btn ${diver.ready ? 'btn-ghost' : 'btn-primary'} ml-auto`}
                disabled={!check.ok || !editable}
                onClick={() => {
                  void act({ type: 'setReady', diverId: diver.id, ready: !diver.ready });
                  // On a shared device, move on to the next Helldiver who isn't ready.
                  const next = divers.find((d) => d.id !== diver.id && !d.ready);
                  if (!inLobby && !diver.ready && next) setDiverId(next.id);
                }}
              >
                {diver.ready ? 'Unready' : 'Ready up'}
              </button>
            </div>
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
                  </div>
                  {v && <PriceTag q={v.q} size="sm" />}
                  {it && editable && (
                    <button
                      className="text-muted hover:text-bad px-1 text-lg leading-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSlot(s, null);
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
                    median={medians[v.item.category]}
                    warn={conflicts(v.item, diver, slot)}
                    squad={squadDots(v.item.index)}
                    onPick={() => pick(v.item)}
                  />
                );
              })}
          </div>
        </div>
      </div>

      <Modal open={confirmDeploy} onClose={() => setConfirmDeploy(false)} wide>
        <div className="space-y-2.5">
          {divers.map((d) => {
            const chk = checkLoadout(c, d, app.market);
            return (
              <div key={d.id} className="flex items-center gap-4 px-4 py-3 border border-line bg-black/20 min-h-[80px]">
                <span className="w-1.5 self-stretch shrink-0" style={{ background: DIVER_COLORS[d.color] }} />
                <div className="w-[120px] shrink-0 min-w-0 font-display font-bold uppercase tracking-wider text-[17px] truncate" style={{ color: DIVER_COLORS[d.color] }}>
                  {d.name}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                  {d.loadout.map((idx, k) => (idx === null ? null : <ItemIcon key={k} item={ITEMS[idx]} size={46} />))}
                </div>
                <span className="inline-flex items-center gap-1 tnum font-display font-bold text-[20px] text-bad shrink-0">
                  −<ReqIcon size={16} />
                  {req(chk.total)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button data-autofocus className="btn btn-ghost" onClick={() => setConfirmDeploy(false)}>
            Back to the armory
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setConfirmDeploy(false);
              void act({ type: 'deploy' });
            }}
          >
            Lock in Purchases and Begin Mission!
          </button>
        </div>
      </Modal>
      <Modal open={confirmAbandon} onClose={() => setConfirmAbandon(false)} title="Are you certain?">
        <p className="text-text-2 text-[15.5px]">
          You can’t resume an abandoned operation.{' '}
          {c.log.length === 0 ? 'No missions have been played yet, so nothing is recorded and nothing is sent to the Price Database.' : 'The campaign ends here and goes into the hall of fame as it stands.'}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button data-autofocus className="btn btn-ghost" onClick={() => setConfirmAbandon(false)}>
            Stay in the fight
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              setConfirmAbandon(false);
              // In a lobby: back to the lobby room if nothing was played, otherwise the campaign ends for everyone.
              if (inLobby) void (c.log.length === 0 ? lobby.lobbyAct({ type: 'lobby.reset' }) : act({ type: 'standDown', reason: 'The squad abandoned the operation.' }));
              else endRun(c);
              router.push(feedbackUrl('abandon'));
            }}
          >
            Abandon mission
          </button>
        </div>
      </Modal>
    </div>
  );
}
