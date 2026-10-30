import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireItem } from '../catalog/catalog';
import {
  randomLoadout,
  advance,
  beginDebrief,
  beginLoadout,
  canDeploy,
  cancelDeploy,
  cheapestLoadout,
  createCampaign,
  deploy,
  finalizeMission,
  nextOperation,
  OPERATION_NAME_COUNT,
  operationName,
  setLoadout,
  setReady,
  setResult,
  setSquadOutcome,
  setSquadPayout,
  setSlot,
} from '../game/campaign';
import { Rng } from '../util/rng';
import { pendingCount, submitLoadout, updateMarket, withdrawLoadout } from '../market/market';
import { createMarket } from '../market/presets';
import { quote } from '../market/free';

const expensive = (m: ReturnType<typeof createMarket>) => {
  const l = cheapestLoadout('automatons', m);
  l[0] = requireItem('eagle-500kg-bomb').index;
  l[1] = requireItem('orbital-laser').index;
  l[4] = requireItem('r-36-eruptor').index;
  return l;
};

function playMission(c: ReturnType<typeof createCampaign>, m: ReturnType<typeof createMarket>, loadout: number[], result: { outcome?: 'extracted' | 'failed'; earned?: number; deaths?: number }) {
  for (const d of c.divers.filter((x) => x.status === 'active')) c = setReady(setLoadout(c, d.id, loadout), d.id, true);
  const { campaign, submissions } = deploy(c, m);
  submissions.forEach((s) => submitLoadout(m, s));
  c = beginDebrief(campaign);
  if (result.outcome) c = setSquadOutcome(c, result.outcome);
  for (const d of c.divers.filter((x) => x.status === 'active')) c = setResult(c, d.id, { ...(result.earned !== undefined ? { earned: result.earned } : {}), deaths: result.deaths ?? 0 });
  return finalizeMission(c);
}

test('operations: buying, earning, the cap and the three-mission operation', () => {
  const m = createMarket('tiers');
  let c = beginLoadout(createCampaign({ mode: 'operations', names: ['Alpha', 'Bravo'], faction: 'automatons', seed: 1 }));
  const kit = expensive(m);
  const cost = kit.reduce((s, i) => s + quote(m, 'automatons', i).price, 0);
  c = playMission(c, m, kit, { outcome: 'extracted', earned: 11000, deaths: 2 });
  assert.equal(c.phase, 'summary');
  assert.equal(c.divers[0].balance, 50000 - cost + 11000);
  assert.equal(pendingCount(m), 2, 'both loadouts reached the market');
  c = advance(c);
  assert.equal(c.phase, 'loadout');
  assert.equal(c.missionInOp, 2);
  c = playMission(c, m, cheapestLoadout('automatons', m), { outcome: 'extracted', earned: 90000 });
  assert.equal(c.divers[0].balance, 50000, 'capped');
  assert.ok(c.log[1].divers[0].wasted > 0);
  c = advance(c);
  c = playMission(c, m, cheapestLoadout('automatons', m), { outcome: 'extracted' });
  // After the third mission the squad decides: keep going or stand down.
  c = advance(c);
  assert.equal(c.phase, 'intermission');
  assert.equal(c.operation, 1);
  const name = c.operationName;
  c = nextOperation(c, new Rng(7));
  assert.equal(c.phase, 'briefing');
  assert.equal(c.operation, 2);
  assert.equal(c.missionInOp, 1);
  assert.notEqual(c.operationName, name);
});

test('operations: the Squad Payout is what every diver earns', () => {
  const m = createMarket('tiers');
  let c = beginLoadout(createCampaign({ mode: 'operations', names: ['Alpha', 'Bravo', 'Charlie'], faction: 'illuminate', seed: 3 }));
  for (const d of c.divers) c = setReady(setLoadout(c, d.id, cheapestLoadout('illuminate', m)), d.id, true);
  c = setSquadPayout(beginDebrief(deploy(c, m).campaign), 12345);
  assert.deepEqual(
    c.divers.map((d) => [d.result?.outcome, d.result?.earned]),
    [['extracted', 12345], ['extracted', 12345], ['extracted', 12345]],
  );
  c = finalizeMission(c);
  assert.ok(c.log[0].divers.every((d) => d.earned === 12345));
});

test('operation names: hundreds of thousands of them, never a repeated word', () => {
  assert.ok(OPERATION_NAME_COUNT > 500_000, `${OPERATION_NAME_COUNT} names`);
  const rng = new Rng(11);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const n = operationName(rng);
    assert.match(n, /^Operation \S/);
    const words = n.replace('Operation ', '').split(/ of | /);
    assert.equal(new Set(words).size, words.length, n);
    seen.add(n);
  }
  assert.ok(seen.size > 1900, `only ${seen.size} distinct names in 2000 draws`);
});

test('operations: one failed mission ends the run; reinforcements cost nothing', () => {
  const m = createMarket('tiers');
  let c = beginLoadout(createCampaign({ mode: 'operations', names: ['Solo'], faction: 'terminids', seed: 2 }));
  c = playMission(c, m, cheapestLoadout('terminids', m), { outcome: 'extracted', earned: 0, deaths: 6 });
  assert.equal(c.divers[0].balance, 50000, 'free loadout + 6 reinforcements leaves the balance untouched');
  assert.equal(c.phase, 'summary');
  c = playMission(advance(c), m, cheapestLoadout('terminids', m), { outcome: 'failed' });
  assert.equal(c.phase, 'over');
  assert.match(c.endedReason ?? '', /failed/);
});

test('cannot deploy unaffordable or invalid loadouts; cancel refunds and withdraws', () => {
  const m = createMarket('tiers');
  let c = beginLoadout(createCampaign({ mode: 'operations', names: ['A'], faction: 'automatons', seed: 3, rules: { startingBalance: 1000 } }));
  c = setReady(setLoadout(c, 'd1', expensive(m)), 'd1', true);
  assert.equal(canDeploy(c, m).ok, false);
  c = setSlot(setLoadout(c, 'd1', cheapestLoadout('automatons', m)), 'd1', 6, null);
  assert.match(canDeploy(c, m).reasons[0], /empty/);
  c = setReady(setLoadout(c, 'd1', cheapestLoadout('automatons', m)), 'd1', true);
  const { campaign, submissions } = deploy(c, m);
  submissions.forEach((s) => submitLoadout(m, s));
  assert.equal(pendingCount(m), 1);
  const { campaign: back, withdrawals } = cancelDeploy(campaign);
  assert.equal(back.phase, 'loadout');
  assert.equal(back.divers[0].balance, 1000);
  assert.ok(withdrawals.every((s) => withdrawLoadout(m, s)));
  assert.equal(pendingCount(m), 0);
  // Once an update has counted it, a withdrawal is refused instead of driving the queue negative.
  submissions.forEach((s) => submitLoadout(m, s));
  updateMarket(m);
  assert.equal(withdrawLoadout(m, withdrawals[0]), false);
  assert.equal(pendingCount(m), 0);
});

test('budget blitz: earn more than you spend or you are out; last diver standing wins', () => {
  const m = createMarket('tiers');
  let c = beginLoadout(createCampaign({ mode: 'blitz', names: ['Cheap', 'Spendy'], faction: 'automatons', seed: 4 }));
  c = setReady(setLoadout(c, 'd1', cheapestLoadout('automatons', m)), 'd1', true);
  c = setReady(setLoadout(c, 'd2', expensive(m)), 'd2', true);
  const { campaign } = deploy(c, m);
  c = beginDebrief(campaign);
  c = setResult(c, 'd1', { earned: 9000 });
  c = setResult(c, 'd2', { earned: 9000 });
  c = finalizeMission(c);
  assert.equal(c.divers[0].status, 'active');
  assert.equal(c.divers[1].status, 'eliminated');
  assert.equal(c.phase, 'over');
  assert.equal(c.winnerId, 'd1');
});

test('random loadouts are valid and always affordable', () => {
  const m = createMarket('tiers');
  for (const limit of [0, 3000, 15000, 50000]) {
    for (let k = 0; k < 40; k++) {
      const l = randomLoadout('illuminate', m, limit);
      const c = setLoadout(beginLoadout(createCampaign({ mode: 'operations', names: ['R'], faction: 'illuminate', seed: k, rules: { startingBalance: limit } })), 'd1', l);
      assert.ok(canDeploy(setReady(c, 'd1', true), m).ok, `limit ${limit}`);
    }
  }
});
