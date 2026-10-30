import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { test } from 'node:test';
import { ALWAYS_FREE, AVAILABLE, ITEMS, requireItem } from '../catalog/catalog';
import { CATEGORIES, FACTIONS } from '../catalog/types';
import { runCommand } from '../console/commands';
import { addLoadout, emptyBatch } from '../market/batch';
import { defaultConfig, setParam } from '../market/config';
import { quote } from '../market/free';
import { emptyHistory, migrateHistory, recordHistory } from '../market/history';
import { deserializeMarket, pendingCount, priceLoadout, serializeMarket, submitLoadout, typicalLoadoutCost, updateMarket, validateLoadout, withdrawLoadout } from '../market/market';
import { createMarket, PRESETS } from '../market/presets';
import { popularityForMultiple, popularityMultiple } from '../market/pricing-anchored';

const setFree = (m: ReturnType<typeof createMarket>, count: number) => {
  m.config = setParam(m.config, 'free.count', count);
  for (const f of FACTIONS) m.books[f].free = [];
};

const cheapestLoadout = (m: ReturnType<typeof createMarket>, f: (typeof FACTIONS)[number]) => {
  const pick = (c: (typeof CATEGORIES)[number], n: number) =>
    [...AVAILABLE[f][c]].sort((a, b) => quote(m, f, a.index).price - quote(m, f, b.index).price).slice(0, n).map((i) => i.index);
  return [...pick('stratagem', 4), ...pick('primary', 1), ...pick('secondary', 1), ...pick('throwable', 1)];
};

test('catalog: the three permanently free items exist and are the only always-free ones', () => {
  assert.deepEqual(ALWAYS_FREE.map((i) => i.fullName).sort(), ['G-12 High Explosive', 'P-2 Peacemaker', 'R-2124 Constitution']);
  assert.equal(new Set(ITEMS.map((i) => i.name)).size, ITEMS.length, 'plain names are unique');
  for (const f of FACTIONS) for (const c of CATEGORIES) assert.ok(AVAILABLE[f][c].length > 10, `${f} ${c} has items`);
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length, 'ids are unique');
  assert.ok(ITEMS.filter((i) => i.category === 'stratagem').every((i) => i.code && /^[UDLR]+$/.test(i.code)), 'every stratagem has a code');
});

test('popularity mapping is bounded, monotone and invertible in every category', () => {
  const p = defaultConfig().anchored;
  for (const c of CATEGORIES) {
    const base = p.baseline[c];
    let prev = 0;
    for (let lr = -12; lr <= 12; lr += 0.25) {
      const m = popularityMultiple(Math.exp(lr), p, base);
      assert.ok(m > prev, 'monotone');
      assert.ok(base * m <= p.ceilingPrice && base * m >= p.floorPrice, `${c} bounded by the shared ceiling and floor`);
      if (Math.abs(lr) < 4) assert.ok(Math.abs(Math.log(popularityForMultiple(m, p, base)) - lr) < 1e-6, 'inverse');
      prev = m;
    }
    assert.ok(Math.abs(popularityMultiple(1, p, base) - 1) < 1e-12, 'fair share costs exactly baseline');
  }
});

test('launch prices are at rest: an update with no loadouts changes nothing', () => {
  const m = createMarket('tiers');
  const before = FACTIONS.map((f) => m.books[f].items.map((b) => b?.price));
  updateMarket(m);
  FACTIONS.forEach((f, k) =>
    m.books[f].items.forEach((b, i) => b && !ITEMS[i].alwaysFree && !m.books[f].free.includes(i) && assert.ok(Math.abs(b.price / before[k][i]! - 1) < 1e-9, `${ITEMS[i].name} moved with no data`)),
  );
});

test('ignored gear sinks to the floor and climbs back within days once it is wanted', () => {
  const m = createMarket('tiers');
  setFree(m, 0);
  const f = 'terminids';
  const victim = requireItem('tx-41-sterilizer').index;
  const others = AVAILABLE[f].stratagem.filter((i) => i.index !== victim).map((i) => i.index);
  const rest = (k: number) => [others[k % others.length], others[(k + 7) % others.length], others[(k + 19) % others.length]];
  const day = (withVictim: boolean) => {
    const batch = emptyBatch();
    for (let k = 0; k < 40; k++) {
      const l = [...(withVictim && k % 3 === 0 ? [victim] : [others[(k + 31) % others.length]]), ...rest(k), ...cheapestLoadout(m, f).slice(4)];
      addLoadout(batch, f, l, priceLoadout(m, f, l));
    }
    updateMarket(m, batch);
  };
  for (let d = 0; d < 90; d++) day(false);
  const low = m.books[f].items[victim]!.price;
  assert.ok(low < 15, `unused item reached the 10 floor (got ${low.toFixed(1)})`);
  for (let d = 0; d < 7; d++) day(true);
  assert.ok(m.books[f].items[victim]!.price > 1500, 'climbed back past 1,500 within a week of being wanted');
});

test('permanently free gear stays free through any amount of demand', () => {
  const m = createMarket('tiers');
  const constitution = requireItem('r-2124-constitution').index;
  for (let day = 0; day < 40; day++) {
    const batch = emptyBatch();
    for (const f of FACTIONS) for (let k = 0; k < 200; k++) addLoadout(batch, f, cheapestLoadout(m, f), new Array(7).fill(0));
    updateMarket(m, batch);
  }
  for (const f of FACTIONS) for (const it of ALWAYS_FREE) assert.equal(quote(m, f, it.index).price, 0, `${it.name} free vs ${f}`);
  assert.equal(m.books.terminids.items[constitution]!.price, 0);
});

test('anchored prices never leave their soft band, even under extreme one-sided demand', () => {
  const m = createMarket('equal');
  const target = requireItem('cqc-1-one-true-flag').index;
  for (let day = 0; day < 200; day++) {
    const batch = emptyBatch();
    for (const f of FACTIONS) {
      const l = cheapestLoadout(m, f);
      if (!l.slice(0, 4).includes(target) && m.books[f].items[target]) l[0] = target;
      for (let k = 0; k < 300; k++) addLoadout(batch, f, l, priceLoadout(m, f, l));
    }
    updateMarket(m, batch);
  }
  const p = m.config.anchored;
  for (const f of FACTIONS)
    for (const c of CATEGORIES)
      for (const it of AVAILABLE[f][c]) {
        if (it.alwaysFree) continue;
        const price = m.books[f].items[it.index]!.price;
        assert.ok(price <= p.ceilingPrice + 1, `${it.name} under ceiling`);
        assert.ok(price >= p.floorPrice - 1, `${it.name} over floor`);
      }
  assert.ok(m.books.terminids.items[target]!.price > p.baseline.stratagem * 2, 'spammed item became expensive');
});

test('equal start with perfectly even true demand is a fixed point', () => {
  const m = createMarket('equal');
  // Less-owned gear is observed less often for the same true demand (the ownership correction).
  const own = m.config.anchored.ownershipFactor;
  m.config = setParam(m.config, 'free.count', 0);
  for (const f of FACTIONS) m.books[f].free = [];
  const before = m.books.automatons.items.map((b) => b?.price);
  for (let day = 0; day < 10; day++) {
    const batch = emptyBatch();
    for (const f of FACTIONS) {
      for (const c of CATEGORIES) for (const it of AVAILABLE[f][c]) batch.counts[f][it.index] += 50 * own[it.ownership];
      batch.loadouts[f] += 50;
    }
    updateMarket(m, batch);
  }
  m.books.automatons.items.forEach((b, i) => b && !ITEMS[i].alwaysFree && assert.ok(Math.abs(b.price / before[i]! - 1) < 0.02, ITEMS[i].name));
});

test('four rotating free stratagems per faction, each free for its tenure', () => {
  const m = createMarket('tiers');
  const seen = new Set<number>();
  const streak = new Map<number, number>();
  for (let day = 0; day < 30; day++) {
    for (const f of FACTIONS) {
      assert.equal(m.books[f].free.length, 4);
      for (const i of m.books[f].free) assert.equal(ITEMS[i].category, 'stratagem');
    }
    for (const i of [...streak.keys()]) if (!m.books.terminids.free.includes(i)) streak.delete(i);
    for (const i of m.books.terminids.free) {
      seen.add(i);
      streak.set(i, (streak.get(i) ?? 0) + 1);
      assert.ok(streak.get(i)! <= m.config.free.tenure, 'free for at most its tenure in a row');
    }
    updateMarket(m, emptyBatch());
  }
  assert.ok(seen.size >= 8, 'rotation happens');
});

test('loadout validation enforces the seven-slot rules', () => {
  const m = createMarket('tiers');
  const ok = cheapestLoadout(m, 'terminids');
  assert.deepEqual(validateLoadout('terminids', ok), []);
  const dup = [...ok];
  dup[1] = dup[0];
  assert.ok(validateLoadout('terminids', dup).some((p) => /already equipped/.test(p.message)));
  const wrong = [...ok];
  wrong[4] = ok[0];
  assert.ok(validateLoadout('terminids', wrong).some((p) => /can't go in/.test(p.message)));
  assert.ok(validateLoadout('terminids', ok.slice(0, 6)).length > 0);
  assert.ok(validateLoadout('illuminate', [...ok.slice(0, 3), requireItem('td-110-maelstrom').index, ...ok.slice(4)]).some((p) => /isn't available/.test(p.message)));
});

test('console "pending clear" discards queued loadouts without moving prices', () => {
  const m = createMarket('tiers');
  const l = cheapestLoadout(m, 'terminids');
  const sub = { faction: 'terminids' as const, items: l, paid: priceLoadout(m, 'terminids', l), origin: 'manual' as const };
  submitLoadout(m, sub);
  submitLoadout(m, sub);
  const before = m.books.terminids.items.map((b) => b?.price);
  const res = runCommand('pending clear', { market: m, history: emptyHistory() });
  assert.equal(res.effect, 'market-changed');
  assert.equal(pendingCount(res.market!), 0);
  assert.equal(res.market!.recent.length, 0);
  assert.deepEqual(res.market!.books.terminids.items.map((b) => b?.price), before);
  // A deploy cancelled after the clear finds nothing to take back, and the counts stay at zero.
  assert.equal(withdrawLoadout(res.market!, sub), false);
  assert.equal(pendingCount(res.market!), 0);
});

test('serialize → deserialize round-trips the market and pending queue', () => {
  const m = createMarket('random', { seed: 9 });
  const l = cheapestLoadout(m, 'illuminate');
  submitLoadout(m, { faction: 'illuminate', items: l, paid: priceLoadout(m, 'illuminate', l), origin: 'manual' });
  updateMarket(m);
  submitLoadout(m, { faction: 'illuminate', items: l, paid: priceLoadout(m, 'illuminate', l), origin: 'manual' });
  const back = deserializeMarket(serializeMarket(m));
  assert.equal(back.day, m.day);
  assert.equal(back.pending.loadouts.illuminate, 1);
  for (const f of FACTIONS) {
    assert.deepEqual(back.books[f].free, m.books[f].free);
    m.books[f].items.forEach((b, i) => b && assert.ok(Math.abs(back.books[f].items[i]!.price - b.price) < 0.01));
  }
  const h = recordHistory(recordHistory(emptyHistory(), createMarket('tiers')), m);
  assert.equal(migrateHistory(JSON.parse(JSON.stringify(h))).points.length, 2);
});

test('every preset produces a sane starting market', () => {
  for (const p of PRESETS) {
    const m = createMarket(p.id, { seed: 4 });
    for (const f of FACTIONS) {
      const typical = typicalLoadoutCost(m, f);
      assert.ok(typical > 5000 && typical < 60000, `${p.id} typical loadout ${typical}`);
    }
  }
});

test('legacy algorithm reproduces the Python prototype exactly', () => {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test-fixtures/legacy.json'), 'utf8'));
  const free = AVAILABLE.terminids.primary.find((i) => i.alwaysFree)!;
  // Prototype item 0 had price 0, so map it to the Constitution; order doesn't matter to the math.
  const items = [free, ...AVAILABLE.terminids.primary.filter((i) => i !== free)];
  assert.equal(items.length, fixture.items);
  for (const c of fixture.cases) {
    const cfg = defaultConfig();
    cfg.algorithm = 'legacy';
    const m = createMarket('flat', {}, cfg);
    items.forEach((it, k) => Object.assign(m.books.terminids.items[it.index]!, { price: c.prices[k], share: c.ema[k] }));
    const batch = emptyBatch();
    batch.loadouts.terminids = 1;
    items.forEach((it, k) => (batch.counts.terminids[it.index] = c.picks[k]));
    updateMarket(m, batch);
    items.forEach((it, k) => {
      assert.equal(m.books.terminids.items[it.index]!.price, c.expectedPrices[k], `price of item ${k}`);
      assert.ok(Math.abs(m.books.terminids.items[it.index]!.share - c.expectedEma[k]) < 1e-12, `ema of item ${k}`);
    });
  }
});
