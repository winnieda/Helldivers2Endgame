#!/usr/bin/env node
/**
 * Local API server for development: the same API the Lambda will run, with documents stored as
 * JSON files in data/server/.
 *
 *   npm run dev -w backend                    # http://127.0.0.1:8787
 *   npm run dev -w backend -- --schedule      # also run the scheduled jobs (see below)
 *
 * Env: HD2E_PORT (8787), HD2E_HOST (127.0.0.1), HD2E_DATA_DIR, HD2E_ADMIN_TOKEN (unset: admin
 * calls are open, which is why the server only listens on 127.0.0.1 by default), HD2E_CORS_ORIGINS,
 * HD2E_CONTACT, HD2E_LIVE_MINUTES (30), HD2E_UPDATE_HOURS (24).
 */
import * as http from 'http';
import * as zlib from 'zlib';
import { createApi } from './api';
import { loadConfig } from './config';
import { runJob } from './jobs';
import { FileStorage } from './storage';

const MAX_BODY = 4 * 1024 * 1024;

const config = loadConfig(process.env, { openAdmin: !process.env.HD2E_ADMIN_TOKEN });
const storage = new FileStorage(config.dataDir);
const api = createApi({ storage, config });
const port = Number(process.env.HD2E_PORT) || 8787;
const host = process.env.HD2E_HOST || '127.0.0.1';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]));
  let out;
  try {
    out = await api({ method: req.method ?? 'GET', path: url.pathname, headers, body: await readBody(req) });
  } catch (e) {
    out = { status: 413, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: (e as Error).message }) };
  }
  let body: Buffer = Buffer.from(out.body);
  const resHeaders: Record<string, string> = { ...out.headers };
  if (body.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding']))) {
    body = zlib.gzipSync(body);
    resHeaders['Content-Encoding'] = 'gzip';
  }
  res.writeHead(out.status, resHeaders);
  res.end(body);
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${url.pathname} ${out.status} ${Date.now() - started}ms`);
});

server.listen(port, host, () => {
  console.log(`Market API on http://${host}:${port}  (data: ${config.dataDir})`);
  if (host !== '127.0.0.1' && !config.adminToken) console.warn('Warning: admin endpoints are open to your network. Set HD2E_ADMIN_TOKEN.');
  console.log(config.adminToken ? 'Admin endpoints need the HD2E_ADMIN_TOKEN bearer token.' : 'Admin endpoints are open (local only). Set HD2E_ADMIN_TOKEN to lock them.');
});

/**
 * --schedule stands in for the AWS schedules: live war data every HD2E_LIVE_MINUTES, and a market
 * update once the market is HD2E_UPDATE_HOURS old. Off by default, so prices only move when you
 * run `update` yourself.
 */
if (process.argv.includes('--schedule')) {
  const liveMinutes = Number(process.env.HD2E_LIVE_MINUTES) || 30;
  const updateHours = Number(process.env.HD2E_UPDATE_HOURS) || 24;
  const safely = (job: string, args: string[] = []) => () =>
    runJob(job, args, { storage, config })
      .then((msg) => console.log(`[schedule] ${msg}`))
      .catch((e) => console.error(`[schedule] ${job} failed:`, (e as Error).message));
  console.log(`Schedule on: live data every ${liveMinutes} min, market update when ${updateHours} h old.`);
  safely('sync-live')();
  setInterval(safely('sync-live'), liveMinutes * 60_000);
  setInterval(safely('daily', ['--min-hours', String(updateHours)]), 10 * 60_000);
}
