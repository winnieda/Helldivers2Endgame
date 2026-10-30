/**
 * Live war data from the community API (https://github.com/helldivers-2/api). Each endpoint is
 * stored as 'live/<name>' = { fetchedAt, source, data }, and 'live/manifest' records how the last
 * sync went. A failed fetch keeps the previous good copy. The API allows 5 requests per 10 s, so
 * requests are spaced out and a 429 waits for Retry-After.
 */
import type { Storage } from './storage';

export const LIVE_BASE = 'https://api.helldivers2.dev';

export const LIVE_ENDPOINTS: Record<string, string> = {
  war: '/api/v1/war',
  assignments: '/api/v1/assignments',
  'planet-events': '/api/v1/planet-events',
  dispatches: '/api/v1/dispatches',
  planets: '/api/v1/planets',
  steam: '/api/v1/steam',
};

export interface LiveResult {
  ok: boolean;
  status: number;
  bytes: number;
  error?: string;
}

export interface LiveManifest {
  fetchedAt: string;
  results: Record<string, LiveResult>;
}

export interface SyncOptions {
  contact: string;
  only?: string[];
  spacingMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function syncLive(storage: Storage, opts: SyncOptions): Promise<LiveManifest> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? wait;
  const spacing = opts.spacingMs ?? 2200;
  const headers = {
    'X-Super-Client': 'hd2galacticmarket',
    'X-Super-Contact': opts.contact,
    'User-Agent': 'hd2galacticmarket/0.1 (+https://hd2galacticmarket.com)',
    Accept: 'application/json',
  };
  const names = Object.keys(LIVE_ENDPOINTS).filter((n) => !opts.only || opts.only.includes(n));
  const results: Record<string, LiveResult> = {};

  for (const [i, name] of names.entries()) {
    if (i > 0) await sleep(spacing);
    const source = LIVE_BASE + LIVE_ENDPOINTS[name];
    let result: LiveResult = { ok: false, status: 0, bytes: 0 };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await doFetch(source, { headers, signal: AbortSignal.timeout(60_000) });
        const text = await res.text();
        if (res.status === 429 && attempt < 3) {
          await sleep(1000 * (Number(res.headers.get('retry-after')) || 10));
          continue;
        }
        if (!res.ok) {
          result = { ok: false, status: res.status, bytes: text.length, error: text.slice(0, 200) };
          break;
        }
        JSON.parse(text); // refuse to store anything that isn't JSON
        await storage.put(`live/${name}`, `{"fetchedAt":${JSON.stringify(new Date().toISOString())},"source":${JSON.stringify(source)},"data":${text}}`);
        result = { ok: true, status: res.status, bytes: text.length };
        break;
      } catch (e) {
        result = { ok: false, status: 0, bytes: 0, error: (e as Error).message };
        if (attempt < 3) await sleep(3000);
      }
    }
    results[name] = result;
  }

  // A partial sync (`only`) keeps the other endpoints' last results.
  const prev = await storage.get('live/manifest');
  const before = prev ? (JSON.parse(prev.body) as LiveManifest).results : {};
  const manifest: LiveManifest = { fetchedAt: new Date().toISOString(), results: { ...before, ...results } };
  await storage.put('live/manifest', JSON.stringify(manifest));
  return manifest;
}
