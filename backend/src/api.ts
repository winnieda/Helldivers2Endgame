/**
 * The HTTP API as one plain function: request in, response out. The local server (server.ts)
 * and the Lambda entry (lambda.ts) are thin adapters around it.
 *
 *   GET  /api/health
 *   GET  /api/market                    serialized market (ETag; send If-None-Match for a 304)
 *   GET  /api/history                   price history, one point per market day
 *   GET  /api/live/<name>               live war data synced from api.helldivers2.dev
 *   POST /api/loadouts                  { submissions }  queue deployed loadouts
 *   POST /api/loadouts/withdraw         { submissions }  take cancelled deploys back out
 *   POST /api/feedback                  { kind, from, version?, questions?, payload }  the feedback form
 *   GET  /api/config                    where browsers subscribe to lobby notices (or null: poll)
 *   POST /api/lobbies                   { name }  create a lobby; returns { lobby, session }
 *   POST /api/lobbies/join              { code, name }  join (or take your seat back)
 *   GET  /api/lobbies/<id>              the lobby, for a member (X-Lobby-Member, X-Lobby-Token)
 *   POST /api/lobbies/<id>/act          { action }  a campaign action or a lobby.* action
 *   POST /api/admin/update              run the daily price update now
 *   POST /api/admin/console             { command }  run a ship-terminal market command
 *   PUT  /api/admin/market              { market, history? }  replace the market (import)
 *   POST /api/admin/sync-live           { only? }  fetch live war data now
 */
import { timingSafeEqual } from 'crypto';
import { deserializeMarket, FACTIONS, ITEMS, migrateHistory, SLOT_CATEGORIES, validateLoadout, type Faction, type Submission } from '@hd2e/engine';
import type { Config } from './config';
import { noPublisher, type Publisher } from './publisher';
import { LobbyError, LobbyService } from './lobby';
import { consoleNotifier, recordFeedback, type Feedback, type FeedbackKind, type FeedbackQuestion, type FeedbackValue, type Notifier } from './feedback';
import { LIVE_ENDPOINTS, syncLive } from './live';
import { HISTORY, MARKET, MarketService } from './market-service';
import { etagOf, type Storage, type Stored } from './storage';

export interface ApiRequest {
  method: string;
  path: string;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  body?: string;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Api = (req: ApiRequest) => Promise<ApiResponse>;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_SUBMISSIONS = 50;
const MAX_PRICE = 1_000_000;
const MAX_FEEDBACK = 16_000;
const FEEDBACK_KINDS: FeedbackKind[] = ['detailed', 'brief', 'skipped'];

function parseJson(body: string | undefined): Record<string, unknown> {
  if (!body) return {};
  try {
    const v = JSON.parse(body);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Body must be a JSON object.');
}

/** Checks the shape of client-sent loadouts; the engine then checks they are legal. */
function parseSubmissions(body: Record<string, unknown>): Submission[] {
  const list = body.submissions;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SUBMISSIONS) throw new HttpError(400, `submissions must be a list of 1-${MAX_SUBMISSIONS} loadouts.`);
  const slots = SLOT_CATEGORIES.length;
  return list.map((raw, i) => {
    const s = raw as Record<string, unknown>;
    const bad = (what: string) => new HttpError(400, `submissions[${i}]: ${what}`);
    if (!FACTIONS.includes(s.faction as Faction)) throw bad('unknown faction.');
    const items = s.items;
    const paid = s.paid;
    if (!Array.isArray(items) || items.length !== slots || !items.every((x) => Number.isInteger(x) && x >= 0 && x < ITEMS.length)) throw bad(`items must be ${slots} catalog indices.`);
    if (!Array.isArray(paid) || paid.length !== slots || !paid.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= MAX_PRICE)) throw bad(`paid must be ${slots} prices.`);
    const problems = validateLoadout(s.faction as Faction, items as number[]);
    if (problems.length) throw bad(problems.map((x) => x.message).join(' '));
    const mode = s.mode === 'operations' || s.mode === 'blitz' ? s.mode : undefined;
    return { faction: s.faction as Faction, items: items as number[], paid: (paid as number[]).map(Math.round), origin: 'player', mode };
  });
}

/** Checks the feedback form's fields: short keys, plain values, a bounded size. */
function parseFeedback(body: Record<string, unknown>, raw: string | undefined): Feedback {
  if ((raw?.length ?? 0) > MAX_FEEDBACK) throw new HttpError(413, 'Feedback is too long.');
  if (!FEEDBACK_KINDS.includes(body.kind as FeedbackKind)) throw new HttpError(400, `kind must be one of ${FEEDBACK_KINDS.join(', ')}.`);
  const out: Feedback = { at: Date.now(), from: typeof body.from === 'string' ? body.from.slice(0, 120) : '', kind: body.kind as FeedbackKind };
  if (typeof body.version === 'string' && body.version) out.version = body.version.slice(0, 80);
  if (body.questions !== undefined) {
    if (!Array.isArray(body.questions) || body.questions.length > 40) throw new HttpError(400, 'questions must be a list of up to 40 questions.');
    out.questions = body.questions.map((raw, i): FeedbackQuestion => {
      const q = raw as Record<string, unknown>;
      if (typeof q?.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(q.id) || typeof q.text !== 'string' || !q.text.trim()) throw new HttpError(400, `questions[${i}] needs an id and text.`);
      const kind = q.kind === 'scale' || q.kind === 'choice' || q.kind === 'text' ? q.kind : undefined;
      return { id: q.id, text: q.text.slice(0, 300), ...(kind ? { kind } : {}) };
    });
  }
  if (body.payload === undefined) return out;
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) throw new HttpError(400, 'payload must be an object.');
  const entries = Object.entries(body.payload);
  if (entries.length > 40) throw new HttpError(400, 'payload has too many fields.');
  const payload: Record<string, FeedbackValue> = {};
  for (const [k, v] of entries) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(k)) throw new HttpError(400, `payload field "${k.slice(0, 40)}" is not allowed.`);
    if (!(v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) throw new HttpError(400, `payload.${k} must be text, a number or true/false.`);
    payload[k] = v;
  }
  return { ...out, payload };
}

export function createApi(deps: { storage: Storage; config: Config; service?: MarketService; notifier?: Notifier; publisher?: Publisher; lobbies?: LobbyService }): Api {
  const { storage, config } = deps;
  const service = deps.service ?? new MarketService(storage);
  const notifier = deps.notifier ?? consoleNotifier;
  const lobbies = deps.lobbies ?? new LobbyService(storage, service, deps.publisher ?? noPublisher);
  const member = (req: ApiRequest) => ({ memberId: req.headers['x-lobby-member'], token: req.headers['x-lobby-token'] });

  // X-Admin-Token, because CloudFront replaces Authorization when it signs requests to the Lambda.
  // A bearer token still works against the local server.
  const requireAdmin = (req: ApiRequest) => {
    if (config.adminToken) {
      const given = Buffer.from(req.headers['x-admin-token'] ?? (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
      const want = Buffer.from(config.adminToken);
      if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(401, 'Admin token required.');
    } else if (!config.openAdmin) {
      throw new HttpError(403, 'Admin endpoints are off: no HD2E_ADMIN_TOKEN is configured.');
    }
  };

  const json = (status: number, value: unknown): ApiResponse => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(value) });

  // Shared documents are always revalidated, so a refresh can never show a stale market day.
  const doc = (req: ApiRequest, d: Stored): ApiResponse => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: d.etag };
    if (req.headers['if-none-match'] === d.etag) return { status: 304, headers, body: '' };
    return { status: 200, headers, body: d.body };
  };

  async function route(req: ApiRequest): Promise<ApiResponse> {
    const { method, path } = req;
    const p = path.replace(/\/+$/, '') || '/';

    if (p === '/api/health' && method === 'GET') return json(200, { ok: true, time: new Date().toISOString() });
    if (p === '/api/market' && method === 'GET') return doc(req, await service.doc(MARKET));
    if (p === '/api/history' && method === 'GET') return doc(req, await service.doc(HISTORY));

    const live = p.match(/^\/api\/live\/([a-z-]+)$/);
    if (live && method === 'GET') {
      if (live[1] !== 'manifest' && !LIVE_ENDPOINTS[live[1]]) throw new HttpError(404, `No live feed "${live[1]}".`);
      const d = await storage.get(`live/${live[1]}`);
      if (!d) throw new HttpError(404, `"${live[1]}" hasn't been synced yet.`);
      return doc(req, d);
    }

    if (p === '/api/loadouts' && method === 'POST') return json(200, await service.submit(parseSubmissions(parseJson(req.body))));
    if (p === '/api/loadouts/withdraw' && method === 'POST') return json(200, await service.withdraw(parseSubmissions(parseJson(req.body))));
    if (p === '/api/config' && method === 'GET') return json(200, { events: config.events ?? null });
    if (p === '/api/lobbies' && method === 'POST') {
      const { view, session } = await lobbies.create(parseJson(req.body).name);
      return json(200, { lobby: view, session });
    }
    if (p === '/api/lobbies/join' && method === 'POST') {
      const body = parseJson(req.body);
      const { view, session } = await lobbies.join(body.code, body.name);
      return json(200, { lobby: view, session });
    }
    const lobby = p.match(/^\/api\/lobbies\/([a-z0-9]+)(\/act)?$/);
    if (lobby && method === 'GET' && !lobby[2]) {
      const view = JSON.stringify(await lobbies.view(lobby[1], member(req)));
      return doc(req, { body: view, etag: etagOf(view) });
    }
    if (lobby && method === 'POST' && lobby[2]) return json(200, await lobbies.act(lobby[1], member(req), parseJson(req.body).action));
    if (p === '/api/feedback' && method === 'POST') return json(200, await recordFeedback(storage, notifier, parseFeedback(parseJson(req.body), req.body)));

    if (p.startsWith('/api/admin/')) {
      requireAdmin(req);
      const body = parseJson(req.body);
      if (p === '/api/admin/update' && method === 'POST') return json(200, await service.update());
      if (p === '/api/admin/console' && method === 'POST') {
        if (typeof body.command !== 'string' || !body.command.trim()) throw new HttpError(400, 'command must be a non-empty string.');
        return json(200, await service.console(body.command));
      }
      if (p === '/api/admin/market' && method === 'PUT') {
        try {
          const market = deserializeMarket(body.market as object);
          const history = body.history ? migrateHistory(body.history as never) : undefined;
          return json(200, await service.replace(market, history));
        } catch (e) {
          throw new HttpError(400, `Not a market save: ${(e as Error).message}`);
        }
      }
      if (p === '/api/admin/sync-live' && method === 'POST') {
        const only = Array.isArray(body.only) ? body.only.filter((x): x is string => typeof x === 'string') : undefined;
        return json(200, await syncLive(storage, { contact: config.contact, only }));
      }
    }
    throw new HttpError(404, `No route ${method} ${p}.`);
  }

  return async (req) => {
    const origin = req.headers.origin;
    const allowed = origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin));
    const cors: Record<string, string> = allowed
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-None-Match, X-Admin-Token, X-Amz-Content-Sha256, X-Lobby-Member, X-Lobby-Token',
          'Access-Control-Expose-Headers': 'ETag',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        }
      : { Vary: 'Origin' };
    if (req.method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
    let res: ApiResponse;
    try {
      res = await route(req);
    } catch (e) {
      if (e instanceof HttpError) res = json(e.status, { error: e.message });
      else if (e instanceof LobbyError) res = json(e.status, { error: e.message, ...(e.reason ? { reason: e.reason } : {}) });
      else {
        console.error(e);
        res = json(500, { error: 'Internal error.' });
      }
    }
    return { ...res, headers: { ...res.headers, ...cors } };
  };
}
