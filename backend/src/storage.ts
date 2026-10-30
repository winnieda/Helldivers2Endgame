/**
 * Document storage for the API. Every piece of shared state is one JSON document under a key
 * ('market', 'history', 'live/war', ...). Writes can be conditional on the ETag the writer read,
 * so two writers can't silently overwrite each other. FileStorage backs the local server; an S3
 * adapter (S3 supports If-Match on PutObject) slots in behind the same interface for AWS.
 */
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface Stored {
  body: string;
  etag: string;
}

export class ConflictError extends Error {
  constructor(key: string) {
    super(`"${key}" changed while it was being updated.`);
  }
}

export interface Storage {
  get(key: string): Promise<Stored | null>;
  /**
   * Writes `body` and returns its new ETag. With `ifMatch`, the write only happens if the stored
   * ETag still equals it (null: only if the key doesn't exist yet); otherwise ConflictError.
   */
  put(key: string, body: string, ifMatch?: string | null): Promise<string>;
}

export const etagOf = (body: string): string => `"${createHash('sha1').update(body).digest('hex').slice(0, 24)}"`;

function checkMatch(key: string, current: Stored | null, ifMatch: string | null | undefined): void {
  if (ifMatch === undefined) return;
  if (ifMatch === null ? current !== null : current?.etag !== ifMatch) throw new ConflictError(key);
}

export class MemoryStorage implements Storage {
  private docs = new Map<string, Stored>();

  async get(key: string): Promise<Stored | null> {
    return this.docs.get(key) ?? null;
  }

  async put(key: string, body: string, ifMatch?: string | null): Promise<string> {
    checkMatch(key, this.docs.get(key) ?? null, ifMatch);
    const etag = etagOf(body);
    this.docs.set(key, { body, etag });
    return etag;
  }
}

export class FileStorage implements Storage {
  /** Serializes writes per key within this process (the ETag check covers other processes). */
  private locks = new Map<string, Promise<unknown>>();

  constructor(private dir: string) {}

  private file(key: string): string {
    if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(key) || key.includes('..')) throw new Error(`Bad storage key "${key}".`);
    return path.join(this.dir, `${key}.json`);
  }

  async get(key: string): Promise<Stored | null> {
    try {
      const body = await fs.readFile(this.file(key), 'utf8');
      return { body, etag: etagOf(body) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  put(key: string, body: string, ifMatch?: string | null): Promise<string> {
    const run = async () => {
      checkMatch(key, await this.get(key), ifMatch);
      const file = this.file(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      // Write then rename, so a reader never sees half a document.
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, file);
      return etagOf(body);
    };
    const next = (this.locks.get(key) ?? Promise.resolve()).then(run, run);
    this.locks.set(key, next.catch(() => {}));
    return next;
  }
}
