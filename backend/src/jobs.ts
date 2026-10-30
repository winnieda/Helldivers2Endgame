#!/usr/bin/env node
/**
 * The scheduled jobs, runnable by hand. On AWS each one becomes an EventBridge schedule that
 * invokes the Lambda with { "job": "<name>", "args": [...] }.
 *
 *   npm run job -w backend -- daily [--min-hours 20]       run the market update
 *   npm run job -w backend -- sync-live [war planets ...]  fetch live war data
 *   npm run job -w backend -- console "sim day 360" [--repeat 100]
 */
import { loadConfig, type Config } from './config';
import { syncLive } from './live';
import { MarketService } from './market-service';
import { FileStorage, type Storage } from './storage';

export const JOBS = ['daily', 'sync-live', 'console'] as const;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const plain = (args: string[]) => args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

/** Runs one job and returns a one-line summary. */
export async function runJob(job: string, args: string[], deps: { storage: Storage; config: Config }): Promise<string> {
  const service = new MarketService(deps.storage);
  if (job === 'daily') {
    const minHours = flag(args, 'min-hours');
    const r = await service.update({ minHours: minHours === undefined ? undefined : Number(minHours) });
    return r.ran ? `Market day #${r.day} is live (${r.processed} loadouts counted).` : `Skipped: market day #${r.day} is newer than ${minHours} h.`;
  }
  if (job === 'sync-live') {
    const only = plain(args);
    const m = await syncLive(deps.storage, { contact: deps.config.contact, only: only.length ? only : undefined });
    const failed = Object.entries(m.results).filter(([, r]) => !r.ok);
    return `Live data synced: ${Object.keys(m.results).length - failed.length} ok${failed.length ? `, failed: ${failed.map(([n, r]) => `${n} (${r.status || r.error})`).join(', ')}` : ''}.`;
  }
  if (job === 'console') {
    const command = plain(args).join(' ');
    if (!command) throw new Error('Usage: console "<market command>" [--repeat N]');
    const repeat = Math.max(1, Number(flag(args, 'repeat')) || 1);
    let last = '';
    for (let i = 0; i < repeat; i++) {
      const r = await service.console(command);
      last = r.lines.map((l) => l.map((s) => s.t).join('')).join('\n');
    }
    return repeat > 1 ? `Ran "${command}" ${repeat} times. Last output:\n${last}` : last;
  }
  throw new Error(`Unknown job "${job}". Jobs: ${JOBS.join(', ')}`);
}

if (require.main === module) {
  const [job, ...args] = process.argv.slice(2);
  const config = loadConfig();
  runJob(job ?? '', args, { storage: new FileStorage(config.dataDir), config })
    .then((msg) => console.log(msg))
    .catch((e) => {
      console.error((e as Error).message);
      process.exit(1);
    });
}
