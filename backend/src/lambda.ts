/**
 * AWS Lambda entry point. The same code serves both triggers:
 *   - function URL requests (payload format 2.0, the same as an HTTP API), through the same API as
 *     the local server;
 *   - EventBridge schedules with a constant input of { "job": "daily", "args": ["--min-hours", "20"] }.
 *
 * HD2E_STORAGE picks the storage: 's3' (HD2E_BUCKET, optional HD2E_PREFIX) on AWS, or 'file' and
 * 'memory' for tests. With HD2E_FEEDBACK_TOPIC set, feedback is emailed through that SNS topic.
 */
import { gzipSync } from 'zlib';
import { createApi, type Api } from './api';
import { loadConfig } from './config';
import { noPublisher, type Publisher } from './publisher';
import { consoleNotifier, type Notifier } from './feedback';
import { runJob } from './jobs';
import { FileStorage, MemoryStorage, type Storage } from './storage';

export interface HttpEvent {
  rawPath: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

export interface JobEvent {
  job: string;
  args?: string[];
}

export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

/** Responses bigger than this are gzipped when the client accepts it (CloudFront doesn't compress uncached responses). */
const GZIP_OVER = 1024;

let cached: Promise<{ storage: Storage; api: Api; config: ReturnType<typeof loadConfig> }> | null = null;

async function makeStorage(kind: string, dataDir: string): Promise<Storage> {
  if (kind === 'memory') return new MemoryStorage();
  if (kind === 'file') return new FileStorage(dataDir);
  if (kind === 's3') {
    const bucket = process.env.HD2E_BUCKET;
    if (!bucket) throw new Error('HD2E_STORAGE=s3 needs HD2E_BUCKET.');
    // Loaded only here, so the tests and the local server never need the AWS SDK.
    const { S3Storage } = await import('./s3-storage');
    return new S3Storage(bucket, process.env.HD2E_PREFIX ?? '');
  }
  throw new Error(`HD2E_STORAGE=${kind} has no adapter.`);
}

async function makePublisher(): Promise<Publisher> {
  const http = process.env.HD2E_EVENTS_HTTP;
  if (!http) return noPublisher;
  const { AppSyncPublisher } = await import('./events');
  return new AppSyncPublisher(http, process.env.AWS_REGION ?? 'us-east-1');
}

async function makeNotifier(): Promise<Notifier> {
  const topic = process.env.HD2E_FEEDBACK_TOPIC;
  if (!topic) return consoleNotifier;
  const { SnsNotifier } = await import('./sns-notifier');
  return new SnsNotifier(topic);
}

function setup() {
  cached ??= (async () => {
    const config = loadConfig();
    const storage = await makeStorage(process.env.HD2E_STORAGE ?? 'file', config.dataDir);
    return { storage, config, api: createApi({ storage, config, notifier: await makeNotifier(), publisher: await makePublisher() }) };
  })();
  return cached;
}

export async function handler(event: HttpEvent | JobEvent): Promise<HttpResult | { message: string }> {
  const { storage, config, api } = await setup();
  if ('job' in event) return { message: await runJob(event.job, event.args ?? [], { storage, config }) };
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const body = event.body && event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const res = await api({ method: event.requestContext.http.method, path: event.rawPath, headers, body });
  if (res.body.length > GZIP_OVER && /\bgzip\b/.test(headers['accept-encoding'] ?? '')) {
    return { statusCode: res.status, headers: { ...res.headers, 'Content-Encoding': 'gzip' }, body: gzipSync(res.body).toString('base64'), isBase64Encoded: true };
  }
  return { statusCode: res.status, headers: res.headers, body: res.body };
}

/** For tests: forget the cached storage so the next call reads the environment again. */
export function resetForTests(): void {
  cached = null;
}
