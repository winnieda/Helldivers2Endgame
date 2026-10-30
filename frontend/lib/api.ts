/**
 * Client for the market API (backend/). With NEXT_PUBLIC_API_URL set the shared market lives on
 * the server; without it the site runs offline and keeps the market in this browser. "/" means the
 * API is on the site's own origin (CloudFront sends /api/* to it), which is how the live site runs.
 */
import type { Line, Submission } from '@engine';

const CONFIGURED = process.env.NEXT_PUBLIC_API_URL ?? '';
export const API_URL = CONFIGURED.replace(/\/+$/, '');
export const serverMode = CONFIGURED !== '';

const TOKEN_KEY = 'hd2e:admin-token';

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the server couldn't be reached at all. */
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function adminToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode: the token just won't persist
  }
}

/** Hex SHA-256 of a request body. CloudFront signs requests to the API's Lambda, and Lambda needs the body's hash for that. */
async function sha256(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // plain-http dev setups: the local server doesn't need it
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function request(path: string, init: RequestInit & { admin?: boolean; body?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set('Content-Type', 'application/json');
    const hash = await sha256(init.body);
    if (hash) headers.set('X-Amz-Content-Sha256', hash);
  }
  const token = init.admin ? adminToken() : null;
  // Not Authorization: CloudFront replaces that header when it signs the request.
  if (token) headers.set('X-Admin-Token', token);
  let res: Response;
  try {
    // no-cache: the browser may reuse its copy, but only after the server confirms it's current.
    res = await fetch(API_URL + path, { ...init, headers, cache: init.method && init.method !== 'GET' ? 'no-store' : 'no-cache' });
  } catch {
    throw new ApiError(0, `Can't reach the market server${API_URL ? ` (${API_URL})` : ''}.`);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  return res;
}

const send = async <T>(method: string, path: string, body?: unknown, admin = false): Promise<T> =>
  (await request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), admin })).json() as Promise<T>;

/** A shared document as text, with the ETag that identifies its version. */
export async function getDoc(path: '/api/market' | '/api/history'): Promise<{ etag: string | null; text: string }> {
  const res = await request(path);
  return { etag: res.headers.get('ETag'), text: await res.text() };
}

export const postLoadouts = (submissions: Submission[]) => send<{ accepted: number; pending: number }>('POST', '/api/loadouts', { submissions });

export const postWithdrawals = (submissions: Submission[]) => send<{ withdrawn: number; refused: number; pending: number }>('POST', '/api/loadouts/withdraw', { submissions });

export const postFeedback = (entry: { from: string; kind: string; version: string; payload?: Record<string, unknown> }) => send<{ saved: boolean; emailed: boolean }>('POST', '/api/feedback', entry);

export const adminConsole = (command: string) => send<{ lines: Line[]; changed: boolean }>('POST', '/api/admin/console', { command }, true);

export const adminReplaceMarket = (market: unknown, history?: unknown) => send<{ day: number }>('PUT', '/api/admin/market', { market, history }, true);
