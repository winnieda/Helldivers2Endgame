import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { gunzipSync } from 'zlib';
import { AVAILABLE, deserializeMarket, quote, type Faction } from '@hd2e/engine';
import { createApi, type ApiRequest } from '../api';
import { loadConfig } from '../config';
import { EMAILS_PER_DAY } from '../feedback';
import { handler, resetForTests } from '../lambda';
import { syncLive } from '../live';
import { MarketService } from '../market-service';
import { ConflictError, FileStorage, MemoryStorage } from '../storage';

const ORIGIN = 'http://localhost:3000';

function setup(opts: { adminToken?: string; openAdmin?: boolean } = {}) {
  const storage = new MemoryStorage();
  const config = loadConfig({}, { openAdmin: opts.openAdmin ?? true, adminToken: opts.adminToken });
  const api = createApi({ storage, config });
  const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
    const req: ApiRequest = { method, path: p, headers: { origin: ORIGIN, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) };
    const res = await api(req);
    return { ...res, json: res.body ? JSON.parse(res.body) : null };
  };
  return { storage, call };
}

/** The cheapest legal loadout on a front: 4 stratagems, primary, secondary, throwable. */
function loadout(faction: Faction) {
  const pick = (c: 'stratagem' | 'primary' | 'secondary' | 'throwable', n: number) => AVAILABLE[faction][c].slice(0, n).map((i) => i.index);
  return { faction, items: [...pick('stratagem', 4), ...pick('primary', 1), ...pick('secondary', 1), ...pick('throwable', 1)] };
}

test('market is created on first read and served with an ETag that revalidates to 304', async () => {
  const { call } = setup();
  const first = await call('GET', '/api/market');
  assert.equal(first.status, 200);
  assert.equal(first.headers['Cache-Control'], 'no-cache');
  assert.equal(deserializeMarket(first.json).day, 0);
  const again = await call('GET', '/api/market', undefined, { 'if-none-match': first.headers.ETag });
  assert.equal(again.status, 304);
  assert.equal(again.body, '');
  const history = await call('GET', '/api/history/');
  assert.equal(history.json.points.length, 1);
});

test('submissions queue up, withdrawals take them back, and the update counts them', async () => {
  const { call } = setup();
  const market = deserializeMarket((await call('GET', '/api/market')).json);
  const l = loadout('automatons');
  const sub = { ...l, paid: l.items.map((i) => quote(market, 'automatons', i).price), mode: 'operations' };

  const queued = await call('POST', '/api/loadouts', { submissions: [sub, sub] });
  assert.deepEqual(queued.json, { accepted: 2, pending: 2 });
  const back = await call('POST', '/api/loadouts/withdraw', { submissions: [sub] });
  assert.deepEqual(back.json, { withdrawn: 1, refused: 0, pending: 1 });

  const before = (await call('GET', '/api/market')).headers.ETag;
  const upd = await call('POST', '/api/admin/update');
  assert.deepEqual(upd.json, { ran: true, day: 1, processed: 1 });
  const after = await call('GET', '/api/market', undefined, { 'if-none-match': before });
  assert.equal(after.status, 200, 'a refresh after the update must see the new day');
  assert.equal(deserializeMarket(after.json).day, 1);
  assert.equal((await call('GET', '/api/history')).json.points.length, 2);

  // The queue was emptied by the update, so a late withdrawal is refused rather than going negative.
  const late = await call('POST', '/api/loadouts/withdraw', { submissions: [sub] });
  assert.deepEqual(late.json, { withdrawn: 0, refused: 1, pending: 0 });
});

test('bad submissions are rejected with 400 and change nothing', async () => {
  const { call } = setup();
  const l = loadout('terminids');
  const cases = [
    {},
    { submissions: [] },
    { submissions: [{ ...l, faction: 'cyborgs', paid: [0, 0, 0, 0, 0, 0, 0] }] },
    { submissions: [{ ...l, paid: [0, 0, 0] }] },
    { submissions: [{ ...l, items: [l.items[0], l.items[0], ...l.items.slice(2)], paid: [0, 0, 0, 0, 0, 0, 0] }] },
    { submissions: [{ ...l, paid: [-5, 0, 0, 0, 0, 0, 0] }] },
  ];
  for (const body of cases) {
    const r = await call('POST', '/api/loadouts', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.json.error);
  }
  const bad = await call('POST', '/api/loadouts', undefined, {});
  assert.equal(bad.status, 400);
  const notJson = await createApi({ storage: new MemoryStorage(), config: loadConfig({}, {}) })({ method: 'POST', path: '/api/loadouts', headers: {}, body: '{nope' });
  assert.equal(notJson.status, 400);
  assert.equal(deserializeMarket((await call('GET', '/api/market')).json).pending.loadouts.terminids, 0);
});

test('admin endpoints: token required when set, off when neither token nor open admin', async () => {
  const locked = setup({ adminToken: 'sekrit', openAdmin: false });
  assert.equal((await locked.call('POST', '/api/admin/update')).status, 401);
  assert.equal((await locked.call('POST', '/api/admin/update', undefined, { authorization: 'Bearer nope!!' })).status, 401);
  assert.equal((await locked.call('POST', '/api/admin/update', undefined, { authorization: 'Bearer sekrit' })).status, 200);
  // Behind CloudFront the token travels in X-Admin-Token (CloudFront signs over Authorization).
  assert.equal((await locked.call('POST', '/api/admin/update', undefined, { 'x-admin-token': 'sekrit', authorization: 'AWS4-HMAC-SHA256 ...' })).status, 200);
  assert.equal((await locked.call('POST', '/api/admin/update', undefined, { 'x-admin-token': 'nope!!' })).status, 401);
  const off = setup({ openAdmin: false });
  assert.equal((await off.call('POST', '/api/admin/update')).status, 403);
  // Public routes stay public.
  assert.equal((await off.call('GET', '/api/market')).status, 200);
});

test('console runs terminal commands on the shared market and saves what changed', async () => {
  const { call } = setup();
  const sim = await call('POST', '/api/admin/console', { command: 'sim day 20' });
  assert.equal(sim.json.changed, true);
  assert.equal(deserializeMarket((await call('GET', '/api/market')).json).day, 1);
  const status = await call('POST', '/api/admin/console', { command: 'status' });
  assert.equal(status.json.changed, false);
  assert.ok(status.json.lines.length > 0);
  const init = await call('POST', '/api/admin/console', { command: 'init equal' });
  assert.equal(init.json.changed, true);
  assert.equal(deserializeMarket((await call('GET', '/api/market')).json).day, 0);
  assert.equal((await call('POST', '/api/admin/console', { command: '  ' })).status, 400);
});

test('importing a market replaces it; garbage is refused', async () => {
  const a = setup();
  await a.call('POST', '/api/admin/console', { command: 'sim day 10' });
  const saved = (await a.call('GET', '/api/market')).json;
  const b = setup();
  assert.equal((await b.call('PUT', '/api/admin/market', { market: saved })).json.day, 1);
  assert.equal(deserializeMarket((await b.call('GET', '/api/market')).json).day, 1);
  assert.equal((await b.call('PUT', '/api/admin/market', { market: { hello: 1 } })).status, 400);
});

test('scheduled update skips a market that is still fresh; manual update always runs', async () => {
  const service = new MarketService(new MemoryStorage());
  assert.equal((await service.update({ minHours: 20 })).ran, false);
  assert.equal((await service.update()).ran, true);
  assert.equal((await service.update({ minHours: 20 })).ran, false);
  assert.equal((await service.update({ minHours: 0 })).day, 2);
});

test('concurrent submissions are all kept (conditional writes retry)', async () => {
  const { call } = setup();
  const l = loadout('illuminate');
  const sub = { ...l, paid: [0, 0, 0, 0, 0, 0, 0] };
  await call('GET', '/api/market');
  const results = await Promise.all(Array.from({ length: 4 }, () => call('POST', '/api/loadouts', { submissions: [sub] })));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(deserializeMarket((await call('GET', '/api/market')).json).pending.loadouts.illuminate, 4);
});

test('CORS: allowed origins get headers and preflights; others do not', async () => {
  const { call } = setup();
  const pre = await call('OPTIONS', '/api/loadouts');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['Access-Control-Allow-Origin'], ORIGIN);
  assert.match(pre.headers['Access-Control-Expose-Headers'], /ETag/);
  const other = await call('GET', '/api/health', undefined, { origin: 'https://evil.example' });
  assert.equal(other.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

test('file storage: atomic writes, conditional puts, nested keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd2e-'));
  const s = new FileStorage(dir);
  const tag = await s.put('live/war', '{"a":1}', null);
  await assert.rejects(s.put('live/war', '{"a":2}', null), ConflictError);
  await assert.rejects(s.put('live/war', '{"a":2}', '"stale"'), ConflictError);
  await s.put('live/war', '{"a":3}', tag);
  assert.equal((await s.get('live/war'))!.body, '{"a":3}');
  assert.equal(await s.get('missing'), null);
  await assert.rejects(s.put('../escape', '{}'));
  fs.rmSync(dir, { recursive: true });
});

test('live sync stores each feed, keeps the old copy on failure, and sends the contact headers', async () => {
  const storage = new MemoryStorage();
  const seen: Record<string, string>[] = [];
  let failWar = false;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    seen.push(init!.headers as Record<string, string>);
    if (url.endsWith('/war') && failWar) return new Response('down', { status: 503 });
    return new Response(JSON.stringify({ from: url }), { status: 200 });
  }) as typeof fetch;
  const opts = { contact: 'test@example.com', fetch: fakeFetch, sleep: async () => {} };

  const m1 = await syncLive(storage, opts);
  assert.equal(Object.values(m1.results).filter((r) => r.ok).length, 6);
  assert.equal(seen[0]['X-Super-Client'], 'hd2galacticmarket');
  assert.equal(seen[0]['X-Super-Contact'], 'test@example.com');
  const war1 = (await storage.get('live/war'))!.body;
  assert.match(JSON.parse(war1).data.from, /\/api\/v1\/war$/);

  failWar = true;
  const m2 = await syncLive(storage, { ...opts, only: ['war'] });
  assert.equal(m2.results.war.ok, false);
  assert.equal(m2.results.war.status, 503);
  assert.equal(m2.results.planets.ok, true, 'a partial sync keeps the other feeds in the manifest');
  assert.equal((await storage.get('live/war'))!.body, war1, 'a failed fetch keeps the last good copy');

  const api = createApi({ storage, config: loadConfig({}, {}) });
  const got = await api({ method: 'GET', path: '/api/live/war', headers: {} });
  assert.equal(got.status, 200);
  assert.equal((await api({ method: 'GET', path: '/api/live/secrets', headers: {} })).status, 404);
});

test('feedback is saved, emailed with the subject tag, checked, and capped per day', async () => {
  const storage = new MemoryStorage();
  const sent: { subject: string; text: string }[] = [];
  let failing = false;
  const notifier = {
    send: async (subject: string, text: string) => {
      if (failing) throw new Error('SNS is down');
      sent.push({ subject, text });
    },
  };
  const api = createApi({ storage, config: loadConfig({}, { openAdmin: true }), notifier });
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await api({ method: 'POST', path: '/api/feedback', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, json: JSON.parse(res.body) };
  };

  const questions = [
    { id: 'rating', text: 'How much did you enjoy this session? (1 = not at all, 5 = loved it)', kind: 'scale' },
    { id: 'improved', text: 'Did this improve the experience compared to playing normally?', kind: 'choice' },
    { id: 'text', text: 'Other thoughts, or a bug to report', kind: 'text' },
  ];
  const brief = await post(
    { kind: 'brief', from: 'operation', version: '2026-10-29.abc1234', questions, context: { 'Play mode': 'Online lobby', 'Squad size': 3, Contributing: true }, payload: { rating: 4, improved: null, text: 'Loved the market.\nMore please' } },
    {
      'cloudfront-viewer-country': 'SE',
      'cloudfront-viewer-city': 'Stockholm',
      'cloudfront-viewer-address': '203.0.113.7:51234',
      'cloudfront-is-mobile-viewer': 'false',
      'cloudfront-is-tablet-viewer': 'false',
      'cloudfront-is-desktop-viewer': 'true',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
    },
  );
  assert.equal(brief.status, 200);
  assert.deepEqual(brief.json, { saved: true, emailed: true });
  assert.equal(sent[0].subject, '[H2E Feedback Email] Brief - 4/5 - from operation');
  const body = sent[0].text;
  assert.match(body, /^BRIEF FEEDBACK FORM$/m);
  assert.match(body, /^Where: after finishing an operation \(all three missions\) \(from=operation\)$/m);
  assert.match(body, /^Build: 2026-10-29\.abc1234$/m);
  // Context the form didn't ask for: what the site knew, plus country, device, browser and language from the request.
  assert.match(body, /^CONTEXT \(not on the form; gathered automatically\)\n   Play mode: Online lobby\n   Squad size: 3\n   Contributing: yes\n   Country: Sweden \(SE\)\n   Device: Desktop\n   Browser: Chrome on Windows\n   Language: sv-SE$/m);
  assert.doesNotMatch(body, /Stockholm|203\.0\.113/, 'nothing finer than the country is used');
  // Every question is spelled out, answered or not, with scales shown out of 5.
  assert.match(body, /^1\. How much did you enjoy this session\? \(1 = not at all, 5 = loved it\)\n   4 \/ 5$/m);
  assert.match(body, /^2\. Did this improve the experience compared to playing normally\?\n   \(no answer\)$/m);
  assert.match(body, /^3\. Other thoughts, or a bug to report\n   Loved the market\.\n   More please$/m);
  assert.match(sent[0].text, /Saved as feedback\/\d{4}-\d\d-\d\d\/\S+ in the data bucket\./);

  // Skips are saved for the counts but not emailed; a failed email still saves the entry.
  assert.deepEqual((await post({ kind: 'skipped', from: 'summary' })).json, { saved: true, emailed: false });
  failing = true;
  assert.deepEqual((await post({ kind: 'detailed', payload: { overall: 5 } })).json, { saved: true, emailed: false });
  failing = false;

  for (const bad of [{ kind: 'rant' }, { kind: 'brief', payload: [1] }, { kind: 'brief', payload: { nested: { a: 1 } } }, { kind: 'brief', payload: { 'bad key!': 1 } }, { kind: 'brief', questions: [{ id: 'x' }] }, 'not json']) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await post({ kind: 'brief', payload: { text: 'x'.repeat(20_000) } })).status, 413);

  // The failed email above used a slot too, so this fills the day's cap exactly.
  for (let i = 0; i < EMAILS_PER_DAY - 2; i++) assert.equal((await post({ kind: 'brief', payload: { rating: 3 } })).json.emailed, true);
  assert.deepEqual((await post({ kind: 'brief', payload: { rating: 3 } })).json, { saved: true, emailed: false });
  assert.equal(sent.length, EMAILS_PER_DAY - 1);
});

test('lambda: HTTP events go through the API and job events run jobs', async () => {
  process.env.HD2E_STORAGE = 'memory';
  resetForTests();
  const res = (await handler({ rawPath: '/api/market', headers: { Origin: ORIGIN }, requestContext: { http: { method: 'GET' } } })) as { statusCode: number; headers: Record<string, string> };
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], ORIGIN);
  const job = (await handler({ job: 'daily' })) as { message: string };
  assert.match(job.message, /day #1/);
  const skipped = (await handler({ job: 'daily', args: ['--min-hours', '20'] })) as { message: string };
  assert.match(skipped.message, /Skipped/);
  // Big responses are gzipped for clients that accept it.
  const zipped = (await handler({ rawPath: '/api/market', headers: { 'Accept-Encoding': 'gzip, br' }, requestContext: { http: { method: 'GET' } } })) as { headers: Record<string, string>; body: string; isBase64Encoded?: boolean };
  assert.equal(zipped.headers['Content-Encoding'], 'gzip');
  assert.equal(zipped.isBase64Encoded, true);
  assert.equal(deserializeMarket(gunzipSync(Buffer.from(zipped.body, 'base64')).toString('utf8')).day, 1);
  delete process.env.HD2E_STORAGE;
  resetForTests();
});
