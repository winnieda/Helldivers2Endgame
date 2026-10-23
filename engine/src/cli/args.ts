/** Tiny argv parser: positionals plus --flag, --key value, --key=value, and repeatable --set k=v. */
export interface ParsedArgs {
  _: string[];
  flags: Record<string, string | true>;
  sets: [string, string][];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [], flags: {}, sets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    let [key, value] = a.slice(2).split(/=(.*)/s) as [string, string | undefined];
    if (value === undefined && i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i];
    if (key === 'set' && value) {
      const [k, v] = value.split('=');
      out.sets.push([k, v]);
    } else out.flags[key] = value ?? true;
  }
  return out;
}

export const num = (v: string | true | undefined, fallback: number) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : fallback);

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  yellow: wrap('33'),
  green: wrap('32'),
  red: wrap('31'),
  cyan: wrap('36'),
  magenta: wrap('35'),
};

export const pad = (s: string, n: number) => {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  return s + ' '.repeat(Math.max(0, n - visible.length));
};
export const lpad = (s: string, n: number) => {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  return ' '.repeat(Math.max(0, n - visible.length)) + s;
};
export const money = (n: number) => Math.round(n).toLocaleString('en-US');
