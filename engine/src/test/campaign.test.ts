import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireItem } from '../catalog/catalog';
import {
  advance,
  beginDebrief,
  beginLoadout,
  canDeploy,
  cancelDeploy,
  cheapestLoadout,
  createCampaign,
  deploy,
  finalizeMission,
  setLoadout,
  setReady,
  setResult,
  setSquadOutcome,
  setSlot,
} from '../game/campaign';
import { pendingCount, submitLoadout } from '../market/market';
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
  assert.equal(c.divers[0].balance, 50000 - cost - 500 + 11000);
  assert.equal(pendingCount(m), 2, 'both loadouts reached the market');
  c = advance(c);
  assert.equal(c.phase, 'loadout');
  assert.equal(c.missionInOp, 2);
  c = playMission(c, m, cheapestLoadout('automatons', m), { outcome: 'extracted', earned: 90000 });
  assert.equal(c.divers[0].balance, 50000, 'capped');
  assert.ok(c.log[1].divers[0].wasted > 0);
  c = advance(c);
  c = playMission(c, m, cheapestLoadout('automatons', m), { outcome: 'extracted' });
  c = advance(c);
  assert.equal(c.phase, 'briefing');
  assert.equal(c.operation, 2);
});

test('operations: going below zero is bankruptcy; run ends when everyone is out', () => {
  const m = createMarket('tiers');
  let c = beginLoadout(createCampaign({ mode: 'operations', names: ['Solo'], faction: 'terminids', seed: 2, rules: { startingBalance: 600 } }));
  c = playMission(c, m, cheapestLoadout('terminids', m), { outcome: 'failed', deaths: 4 });
  assert.equal(c.divers[0].status, 'bankrupt');
  assert.equal(c.phase, 'over');
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
  const back = cancelDeploy(campaign, m);
  assert.equal(back.phase, 'loadout');
  assert.equal(back.divers[0].balance, 1000);
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
