import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVAILABLE, cheapestLoadout, deserializeMarket, type Faction } from '@hd2e/engine';
import { createApi } from '../api';
import { loadConfig } from '../config';
import { AWAY_AFTER_MS, LobbyError, LobbyService, type Session } from '../lobby';
import { MARKET, MarketService } from '../market-service';
import { MemoryStorage } from '../storage';

function setup() {
  const storage = new MemoryStorage();
  const market = new MarketService(storage);
  const published: { channel: string; event: object }[] = [];
  let clock = 1_000_000;
  const lobbies = new LobbyService(storage, market, { publish: async (channel, event) => void published.push({ channel, event }) }, () => clock);
  const as = (s: Session) => ({ memberId: s.memberId, token: s.token });
  return { storage, market, lobbies, published, as, tick: (ms: number) => (clock += ms) };
}

async function rejects(p: Promise<unknown>, status: number, pattern?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof LobbyError, String(e));
    assert.equal(e.status, status, e.message);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });
}

const kit = (f: Faction, m: ReturnType<typeof deserializeMarket>) => cheapestLoadout(f, m);

test('lobbies: create, join by code, the code is the host’s only, names and seats are checked', async () => {
  const { lobbies, as } = setup();
  const host = await lobbies.create('Tomo');
  assert.match(host.view.code ?? '', /^[2-9A-HJKMNP-Z]{6}$/);
  assert.equal(host.view.you, host.session.memberId);

  const lyra = await lobbies.join(host.view.code!.toLowerCase().replace(/(...)/, '$1-'), 'Lyra'); // codes are forgiving about case and dashes
  assert.equal(lyra.view.code, undefined, 'members never see the code');
  assert.equal((await lobbies.view(host.session.lobbyId, as(lyra.session))).code, undefined);
  assert.equal((await lobbies.view(host.session.lobbyId, as(host.session))).members.length, 2);

  await rejects(lobbies.join(host.view.code!, 'lyra'), 409, /goes by that name/);
  await rejects(lobbies.join('ZZZZZZ', 'Quill'), 404);
  await lobbies.join(host.view.code!, 'Quill');
  await lobbies.join(host.view.code!, 'Rook');
  await rejects(lobbies.join(host.view.code!, 'Fifth'), 409, /full/);
  await rejects(lobbies.view(host.session.lobbyId, { memberId: lyra.session.memberId, token: 'wrong' }), 403);
});

test('lobbies: a full mission, with each player on their own loadout and the host running the rest', async () => {
  const { lobbies, market, as, published } = setup();
  const host = await lobbies.create('Tomo');
  const lyra = await lobbies.join(host.view.code!, 'Lyra');
  const id = host.session.lobbyId;

  await rejects(lobbies.act(id, as(lyra.session), { type: 'lobby.start' }), 403, /host/);
  let v = await lobbies.act(id, as(host.session), { type: 'lobby.start' });
  assert.equal(v.campaign?.phase, 'briefing');
  const [d1, d2] = v.members.map((m) => m.diverId);
  assert.deepEqual([d1, d2], ['d1', 'd2']);

  await rejects(lobbies.act(id, as(lyra.session), { type: 'setBriefing', faction: 'automatons' }), 403);
  await lobbies.act(id, as(host.session), { type: 'setBriefing', faction: 'automatons', difficulty: 9 });
  v = await lobbies.act(id, as(host.session), { type: 'beginLoadout' });
  assert.equal(v.campaign?.phase, 'loadout');

  const m = deserializeMarket((await market.doc(MARKET)).body);
  const items = kit('automatons', m);
  await rejects(lobbies.act(id, as(lyra.session), { type: 'setLoadout', diverId: 'd1', items }), 403, /your own/);
  await rejects(lobbies.act(id, as(host.session), { type: 'setLoadout', diverId: 'd2', items }), 403, /your own/, );
  await rejects(lobbies.act(id, as(lyra.session), { type: 'setLoadout', diverId: 'd2', items: [1, 2, 3] }), 400);
  await lobbies.act(id, as(lyra.session), { type: 'setLoadout', diverId: 'd2', items });
  await lobbies.act(id, as(host.session), { type: 'setLoadout', diverId: 'd1', items });
  await lobbies.act(id, as(lyra.session), { type: 'setReady', diverId: 'd2', ready: true });
  await rejects(lobbies.act(id, as(host.session), { type: 'deploy' }), 409, /isn.t ready/);
  await lobbies.act(id, as(host.session), { type: 'setReady', diverId: 'd1', ready: true });
  await rejects(lobbies.act(id, as(lyra.session), { type: 'deploy' }), 403, /host/);
  v = await lobbies.act(id, as(host.session), { type: 'deploy' });
  assert.equal(v.campaign?.phase, 'deployed');
  assert.equal(deserializeMarket((await market.doc(MARKET)).body).pending.loadouts.automatons, 2, 'both loadouts reached the market');

  v = await lobbies.act(id, as(host.session), { type: 'reportPayout', earned: 7200 });
  assert.equal(v.campaign?.phase, 'summary');
  assert.ok(v.campaign!.log[0].divers.every((d) => d.earned === 7200));
  v = await lobbies.act(id, as(host.session), { type: 'advance' });
  assert.equal(v.campaign?.phase, 'loadout');
  assert.equal(v.campaign?.missionInOp, 2);

  // Every change was announced on the lobby's channel, with its version.
  assert.ok(published.length >= 10);
  assert.ok(published.every((p) => p.channel === `/lobbies/${id}`));
  assert.deepEqual(published.at(-1)?.event, { v: v.version });
});

test('lobbies: dropped players — away status, the host covering, taking a seat back, host takeover', async () => {
  const { lobbies, as, tick, published } = setup();
  const host = await lobbies.create('Tomo');
  const lyra = await lobbies.join(host.view.code!, 'Lyra');
  const id = host.session.lobbyId;
  await lobbies.act(id, as(host.session), { type: 'lobby.start' });
  await lobbies.act(id, as(host.session), { type: 'beginLoadout' });

  // Check-ins keep Lyra here without notifying anyone.
  const before = published.length;
  tick(30_000);
  await lobbies.act(id, as(lyra.session), { type: 'lobby.hello' });
  assert.equal(published.length, before, 'check-ins are quiet');

  // Lyra goes quiet: she shows as away and the host may ready her diver.
  tick(AWAY_AFTER_MS + 1);
  await lobbies.act(id, as(host.session), { type: 'lobby.hello' });
  const v = await lobbies.view(id, as(host.session));
  assert.deepEqual(v.members.map((m) => [m.name, m.online]), [['Tomo', true], ['Lyra', false]]);
  await lobbies.act(id, as(host.session), { type: 'setReady', diverId: 'd2', ready: false });

  // On a new device (token lost) she takes her seat back by name; the old token stops working.
  const again = await lobbies.join(host.view.code!, 'Lyra');
  assert.equal(again.session.memberId, lyra.session.memberId);
  await rejects(lobbies.view(id, as(lyra.session)), 403);
  assert.equal((await lobbies.view(id, as(again.session))).members.find((m) => m.name === 'Lyra')?.diverId, 'd2');

  // The host can't take over while Lyra is present, but Lyra can claim host once the host is away.
  await rejects(lobbies.act(id, as(again.session), { type: 'lobby.claimHost' }), 409, /still here/);
  tick(AWAY_AFTER_MS + 1);
  await lobbies.act(id, as(again.session), { type: 'lobby.hello' });
  const claimed = await lobbies.act(id, as(again.session), { type: 'lobby.claimHost' });
  assert.equal(claimed.hostId, again.session.memberId);
  assert.ok(claimed.code, 'the new host gets the code');
});

test('lobbies: kick, lock, a new code, leaving, and starting over after the campaign', async () => {
  const { lobbies, market, as } = setup();
  const host = await lobbies.create('Tomo');
  const lyra = await lobbies.join(host.view.code!, 'Lyra');
  const troll = await lobbies.join(host.view.code!, 'Troll');
  const id = host.session.lobbyId;

  await rejects(lobbies.act(id, as(lyra.session), { type: 'lobby.kick', memberId: troll.session.memberId }), 403);
  await lobbies.act(id, as(host.session), { type: 'lobby.kick', memberId: troll.session.memberId });
  await assert.rejects(lobbies.view(id, as(troll.session)), (e: unknown) => e instanceof LobbyError && e.reason === 'kicked');

  await lobbies.act(id, as(host.session), { type: 'lobby.lock', locked: true });
  await rejects(lobbies.join(host.view.code!, 'Troll2'), 403, /locked/);
  await lobbies.act(id, as(host.session), { type: 'lobby.lock', locked: false });

  const fresh = await lobbies.act(id, as(host.session), { type: 'lobby.newCode' });
  assert.notEqual(fresh.code, host.view.code);
  await rejects(lobbies.join(host.view.code!, 'Troll3'), 404, /code/);
  const quill = await lobbies.join(fresh.code!, 'Quill');

  // Before the first mission the host can take everyone back to the lobby room.
  await lobbies.act(id, as(host.session), { type: 'lobby.start' });
  assert.equal((await lobbies.act(id, as(host.session), { type: 'lobby.reset' })).campaign, null);

  // A seat left mid-campaign can be filled by someone new.
  await lobbies.act(id, as(host.session), { type: 'lobby.start' });
  await lobbies.act(id, as(lyra.session), { type: 'lobby.leave' });
  const late = await lobbies.join(fresh.code!, 'Late');
  assert.equal((await lobbies.view(id, as(late.session))).members.find((m) => m.name === 'Late')?.diverId, 'd2');
  await rejects(lobbies.join(fresh.code!, 'TooLate'), 409, /no free seat/);

  // Once a mission has been played, only a finished campaign can be left behind.
  await lobbies.act(id, as(host.session), { type: 'beginLoadout' });
  const m = deserializeMarket((await market.doc(MARKET)).body);
  for (const s of [host.session, late.session, quill.session]) {
    const d = (await lobbies.view(id, as(s))).members.find((x) => x.id === s.memberId)!.diverId!;
    await lobbies.act(id, as(s), { type: 'setLoadout', diverId: d, items: kit('terminids', m) });
    await lobbies.act(id, as(s), { type: 'setReady', diverId: d, ready: true });
  }
  await lobbies.act(id, as(host.session), { type: 'deploy' });
  await lobbies.act(id, as(host.session), { type: 'reportPayout', earned: 5000 });
  await rejects(lobbies.act(id, as(host.session), { type: 'lobby.reset' }), 409);
  await lobbies.act(id, as(host.session), { type: 'standDown' });
  const reset = await lobbies.act(id, as(host.session), { type: 'lobby.reset' });
  assert.equal(reset.campaign, null);

  // The host leaving hands the lobby to someone still here.
  const after = await lobbies.act(id, as(host.session), { type: 'lobby.leave' });
  assert.notEqual(after.hostId, host.session.memberId);
});

test('lobby API: routes, member headers, ETags and error reasons', async () => {
  const storage = new MemoryStorage();
  const api = createApi({ storage, config: loadConfig({}, { openAdmin: true }) });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await api({ method, path, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, headers: res.headers, json: res.body ? JSON.parse(res.body) : null };
  };
  assert.deepEqual((await call('GET', '/api/config')).json, { events: null });
  const created = await call('POST', '/api/lobbies', { name: 'Tomo' });
  assert.equal(created.status, 200);
  const { lobbyId, memberId, token } = created.json.session;
  const auth = { 'x-lobby-member': memberId, 'x-lobby-token': token };
  const got = await call('GET', `/api/lobbies/${lobbyId}`, undefined, auth);
  assert.equal(got.json.members[0].name, 'Tomo');
  assert.equal((await call('GET', `/api/lobbies/${lobbyId}`, undefined, { ...auth, 'if-none-match': got.headers.ETag })).status, 304);
  const started = await call('POST', `/api/lobbies/${lobbyId}/act`, { action: { type: 'lobby.start' } }, auth);
  assert.equal(started.json.campaign.phase, 'briefing');
  assert.equal((await call('POST', `/api/lobbies/${lobbyId}/act`, { action: { type: 'nonsense' } }, auth)).status, 400);
  const stranger = await call('GET', `/api/lobbies/${lobbyId}`, undefined, { 'x-lobby-member': 'mnobody', 'x-lobby-token': 'x' });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.json.reason, 'not-member');
  assert.equal((await call('GET', '/api/lobbies/lnope123456')).json.reason, 'gone');
  assert.ok(AVAILABLE.terminids.stratagem.length > 0);
});
