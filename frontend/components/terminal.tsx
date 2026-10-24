'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  completeCommand,
  deserializeMarket,
  FACTION_LABEL,
  heading,
  ITEMS,
  line,
  migrateHistory,
  muted,
  runCommand,
  scenarioById,
  seg,
  serializeMarket,
  type Line,
  type MarketHistory,
} from '@engine';
import { store } from '@/lib/store';
import { runSimulation } from '@/lib/simClient';
import { toast } from '@/lib/toast';

type Listener = (cmd?: string) => void;
const openers = new Set<Listener>();
/** Opens the terminal from anywhere, optionally pre-typing a command. */
export function openTerminal(cmd?: string): void {
  openers.forEach((fn) => fn(cmd));
}

const HISTORY_KEY = 'hd2e:terminal-history';
const BANNER: Line[] = [
  heading('SUPER EARTH SHIP MANAGEMENT TERMINAL — ENDGAME MARKET CONSOLE'),
  muted('Prices only move when an operator runs `update`. Every deployed loadout waits in the pending queue until then.'),
  line(seg('Try: ', 'muted'), seg('status', 'accent'), seg(' · ', 'muted'), seg('prices bots strat', 'accent'), seg(' · ', 'muted'), seg('sim squads 50', 'accent'), seg(' · ', 'muted'), seg('update', 'accent'), seg(' · ', 'muted'), seg('help', 'accent')),
];

const EXTRA_HELP: Line[] = [
  heading('TERMINAL-ONLY COMMANDS'),
  line(seg('clear'.padEnd(44), 'accent'), seg('Clear the screen (Ctrl+L).', 'muted')),
  line(seg('export'.padEnd(44), 'accent'), seg('Download the market + history as JSON (works with `npm run market -- --db file`).', 'muted')),
  line(seg('import'.padEnd(44), 'accent'), seg('Load a market JSON exported here or written by the CLI.', 'muted')),
  line(seg('campaign'.padEnd(44), 'accent'), seg('Status of the active campaign.', 'muted')),
  line(seg('open <play|market|lab|manual>'.padEnd(44), 'accent'), seg('Jump to a page.', 'muted')),
  line(seg('reset-all --yes'.padEnd(44), 'accent'), seg('Erase everything this prototype saved in the browser.', 'muted')),
];

const TONE_CLASS: Record<string, string> = {
  default: 'text-text',
  muted: 'text-muted',
  good: 'text-good',
  bad: 'text-bad',
  warn: 'text-warn',
  accent: 'text-yellow',
  heading: 'text-yellow font-bold',
  info: 'text-info',
};

export function Terminal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(BANNER);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setPast(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const fn: Listener = (cmd) => {
      setOpen(true);
      if (cmd !== undefined) setInput(cmd);
      setTimeout(() => inputRef.current?.focus(), 30);
    };
    openers.add(fn);
    return () => {
      openers.delete(fn);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && t !== inputRef.current;
      if ((e.key === '`' || e.key === '~') && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((o) => {
          if (!o) setTimeout(() => inputRef.current?.focus(), 30);
          return !o;
        });
      } else if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, open]);

  const print = useCallback((ls: Line[]) => setLines((prev) => [...prev, ...ls].slice(-600)), []);

  const execute = useCallback(
    async (raw: string) => {
      const cmd = raw.trim();
      print([line(seg('hd2e@ses-endgame', 'good'), seg(':~$ ', 'muted'), seg(cmd))]);
      if (!cmd) return;
      setPast((p) => {
        const next = [...p.filter((x) => x !== cmd), cmd].slice(-80);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        return next;
      });
      const [word, ...rest] = cmd.replace(/^market\s+/, '').split(/\s+/);

      if (word === 'clear') return setLines([]);
      if (word === 'exit' || word === 'close') return setOpen(false);
      if (word === 'help' && rest.length === 0) {
        const res = runCommand('help', { market: store.get().market, history: store.get().history });
        return print([...res.lines, ...EXTRA_HELP]);
      }
      if (word === 'open') {
        const page = rest[0] ?? '';
        const routes: Record<string, string> = { play: '/play/', market: '/market/', lab: '/lab/', manual: '/manual/', home: '/' };
        if (!routes[page]) return print([line(seg(`✖ open what? ${Object.keys(routes).join(' | ')}`, 'bad'))]);
        router.push(routes[page]);
        return print([muted(`  → ${routes[page]}`)]);
      }
      if (word === 'export') {
        const s = store.get();
        const blob = new Blob([JSON.stringify({ market: JSON.parse(serializeMarket(s.market)), history: s.history })], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `hd2e-market-day${s.market.day}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        return print([line(seg('✔ ', 'good'), seg(`Exported market day #${s.market.day} with ${s.history.points.length} history points.`))]);
      }
      if (word === 'import') {
        fileRef.current?.click();
        return print([muted('  Choose a market JSON file…')]);
      }
      if (word === 'reset-all') {
        if (rest[0] !== '--yes') return print([line(seg('This erases the market, its history, the active campaign and the hall of fame. Run ', 'warn'), seg('reset-all --yes', 'accent'), seg(' to confirm.', 'warn'))]);
        store.resetAll();
        return print([line(seg('✔ ', 'good'), seg('Everything wiped. The market is back to the tier-list launch state.'))]);
      }
      if (word === 'campaign') {
        const c = store.get().campaign;
        if (!c) return print([muted('  No active campaign. Start one on the Deploy page (open play).')]);
        return print([
          heading(`${c.operationName.toUpperCase()} — ${c.mode === 'operations' ? 'OPERATIONS' : 'BUDGET BLITZ'}`),
          muted(`  phase ${c.phase} · ${c.mode === 'operations' ? `operation ${c.operation}, mission ${c.missionInOp}/3` : `round ${c.round}`} · vs ${FACTION_LABEL[c.faction]} · difficulty ${c.difficulty}`),
          ...c.divers.map((d) =>
            line(
              seg(`  ${d.name.padEnd(16)}`),
              seg(d.status.padEnd(11), d.status === 'active' ? 'good' : 'bad'),
              seg(c.mode === 'operations' ? `${d.balance.toLocaleString()} req` : `profit ${d.stats.profit.toLocaleString()}`, 'accent'),
              seg(`  ${d.loadout.filter((i) => i !== null).map((i) => ITEMS[i!].name).join(', ')}`, 'muted'),
            ),
          ),
        ]);
      }
      if (word === 'sim' && rest[0] === 'run') {
        const id = rest[1] ?? 'baseline';
        const scenario = scenarioById(id);
        if (!scenario) return print([line(seg(`✖ Unknown scenario "${id}". Try: scenarios`, 'bad'))]);
        const daysFlag = cmd.match(/--days[ =](\d+)/);
        setBusy(true);
        print([muted(`  Simulating "${scenario.name}" in the background with your current pricing config…`)]);
        try {
          const r = await runSimulation({ scenarioId: id, config: store.get().market.config, days: daysFlag ? +daysFlag[1] : undefined }).promise;
          print([
            heading(`SIMULATION — ${scenario.name.toUpperCase()} (${r.days.length} days, ${r.elapsedMs} ms)`),
            ...r.health.checks.map((ch) =>
              line(seg(`  ${ch.verdict.toUpperCase().padEnd(5)}`, ch.verdict === 'pass' ? 'good' : ch.verdict === 'warn' ? 'warn' : ch.verdict === 'fail' ? 'bad' : 'muted'), seg(ch.label.padEnd(40)), seg(ch.value, 'muted')),
            ),
            muted('  The live market was not touched. Open the Market Lab (open lab) for charts.'),
          ]);
        } catch (e) {
          print([line(seg(`✖ ${(e as Error).message}`, 'bad'))]);
        } finally {
          setBusy(false);
        }
        return;
      }

      const s = store.get();
      const res = runCommand(cmd, { market: s.market, history: s.history });
      print(res.lines);
      if (res.effect === 'market-replaced' && res.market) store.replaceMarket(res.market, res.history);
      else if (res.market || res.history) {
        store.mutateMarket(() => {});
        if (res.history) store.setHistory(res.history);
      }
      if (word === 'update' || (word === 'sim' && rest[0] === 'day')) toast('Market updated', `Day #${store.get().market.day} prices are live.`, 'good');
    },
    [print, router],
  );

  const onImport = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const market = deserializeMarket(raw.market ?? raw);
      const history: MarketHistory | undefined = raw.history ? migrateHistory(raw.history) : undefined;
      store.replaceMarket(market, history);
      print([line(seg('✔ ', 'good'), seg(`Imported market day #${market.day} from ${file.name}.`))]);
      toast('Market imported', file.name, 'good');
    } catch (e) {
      print([line(seg(`✖ Import failed: ${(e as Error).message}`, 'bad'))]);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !busy) {
      const v = input;
      setInput('');
      setCursor(null);
      void execute(v);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = cursor === null ? past.length - 1 : Math.max(0, cursor - 1);
      if (past[i] !== undefined) {
        setCursor(i);
        setInput(past[i]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cursor === null) return;
      const i = cursor + 1;
      if (i >= past.length) {
        setCursor(null);
        setInput('');
      } else {
        setCursor(i);
        setInput(past[i]);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const options = completeCommand(input);
      if (options.length === 1) {
        const parts = input.split(/\s+/);
        parts[parts.length - 1] = options[0];
        setInput(parts.join(' ') + ' ');
      } else if (options.length > 1) print([muted('  ' + options.slice(0, 30).join('  '))]);
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onImport(f);
          e.target.value = '';
        }}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[70]"
        style={{ transform: open ? 'translateY(0)' : 'translateY(105%)', visibility: open ? 'visible' : 'hidden', transition: open ? 'transform 0.2s ease-out' : 'transform 0.2s ease-out, visibility 0s linear 0.2s' }}
        aria-hidden={!open}
      >
        <div className="mx-auto max-w-[1400px] px-2 sm:px-4">
          <div className="border border-line-2 border-b-0 shadow-[0_-20px_60px_rgba(0,0,0,0.6)]" style={{ background: 'rgba(5,8,10,0.97)' }}>
            <div className="hazard-thin" />
            <div className="flex items-center justify-between px-4 py-2 border-b border-line">
              <div className="font-mono text-[13px] text-yellow tracking-wide">SHIP MANAGEMENT TERMINAL · SES ENDGAME</div>
              <div className="flex items-center gap-3 text-[12px] text-muted font-mono">
                <span className="hidden sm:inline">↑↓ history · Tab complete · Esc close</span>
                <button className="text-muted hover:text-yellow text-lg leading-none" onClick={() => setOpen(false)} aria-label="Close terminal">
                  ×
                </button>
              </div>
            </div>
            <div ref={scrollRef} className="h-[44vh] overflow-y-auto px-4 py-3 font-mono text-[13.5px] leading-[1.45] whitespace-pre" onClick={() => inputRef.current?.focus()}>
              {lines.map((l, i) => (
                <div key={i} className="min-h-[1.45em]">
                  {l.map((s, k) => (
                    <span key={k} className={TONE_CLASS[s.c ?? 'default']}>
                      {s.t}
                    </span>
                  ))}
                </div>
              ))}
              <div className="flex items-center">
                <span className="text-good">hd2e@ses-endgame</span>
                <span className="text-muted">:~$&nbsp;</span>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  className="flex-1 bg-transparent outline-none text-text caret-yellow"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Terminal command"
                  disabled={busy}
                />
                {busy && <span className="text-warn blink">working…</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
