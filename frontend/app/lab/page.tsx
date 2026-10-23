'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ARCHETYPES,
  defaultConfig,
  defaultRules,
  FACTIONS,
  getParam,
  PARAM_SPECS,
  SCENARIOS,
  setParam,
  SHARE_SCALE,
  type ArchetypeId,
  type EconomyRules,
  type MarketConfig,
  type MarketHistory,
  type SimResult,
} from '@engine';
import { HealthTable, ResultCharts, VerdictBanner } from '@/components/lab/Results';
import { Modal, SectionTitle } from '@/components/ui';
import { runSimulation } from '@/lib/simClient';
import { store, useApp } from '@/lib/store';
import { toast } from '@/lib/toast';

type Mode = 'anchored' | 'legacy' | 'compare';
const ARCH_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

function historyFromSim(r: SimResult): MarketHistory {
  const now = Date.now();
  return {
    schema: 1,
    catalogIds: r.final.catalogIds,
    points: r.prices.terminids.map((_, d) => ({
      day: d,
      at: now - (r.prices.terminids.length - d) * 86400000,
      loadouts: Object.fromEntries(FACTIONS.map((f) => [f, d > 0 ? Math.round(r.days[d - 1].loadouts / 3) : 0])) as Record<(typeof FACTIONS)[number], number>,
      prices: Object.fromEntries(FACTIONS.map((f) => [f, Array.from(r.prices[f][d])])) as Record<(typeof FACTIONS)[number], number[]>,
      shares: Object.fromEntries(FACTIONS.map((f) => [f, Array.from(r.shares[f][d], (s) => (s < 0 ? -1 : Math.round(s * SHARE_SCALE)))])) as Record<(typeof FACTIONS)[number], number[]>,
      free: Object.fromEntries(FACTIONS.map((f) => [f, d > 0 ? r.days[d - 1].free[f] : []])) as Record<(typeof FACTIONS)[number], number[]>,
    })),
  };
}

function Slider({ label, value, min, max, step, onChange, format = (v: number) => String(v), hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string }) {
  return (
    <label className="block" title={hint}>
      <div className="flex justify-between text-[13px]">
        <span className="text-text-2">{label}</span>
        <span className="tnum text-yellow">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label} />
    </label>
  );
}

export default function LabPage() {
  const { market, ready } = useApp();
  const [scenarioId, setScenarioId] = useState('baseline');
  const [mode, setMode] = useState<Mode>('anchored');
  const [days, setDays] = useState(120);
  const [squads, setSquads] = useState(60);
  const [seed, setSeed] = useState(1);
  const [mix, setMix] = useState<Record<ArchetypeId, number>>(() => ({ regular: 40, meta: 20, thrifty: 15, niche: 10, loyalist: 10, chaos: 5 }));
  const [config, setConfig] = useState<MarketConfig>(defaultConfig());
  const [earnScale, setEarnScale] = useState(1);
  const [reinforce, setReinforce] = useState(250);
  const [showParams, setShowParams] = useState(false);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<SimResult[] | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const cancelRef = useRef<(() => void)[]>([]);
  const initialized = useRef(false);

  useEffect(() => {
    if (ready && !initialized.current) {
      initialized.current = true;
      setConfig(structuredClone(market.config));
    }
  }, [ready, market.config]);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const pickScenario = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id)!;
    setScenarioId(id);
    setDays(s.days);
    setSquads(s.squadsPerDay);
    setMix(Object.fromEntries(ARCH_IDS.map((a) => [a, s.population[a] ?? 0])) as Record<ArchetypeId, number>);
  };

  const run = async () => {
    const base = defaultRules();
    const rules: Partial<EconomyRules> = { reinforcementCost: reinforce, earningsByDifficulty: base.earningsByDifficulty.map((e) => Math.round(e * earnScale)) };
    const algos: MarketConfig['algorithm'][] = mode === 'compare' ? ['legacy', 'anchored'] : [mode];
    setRunning({ done: 0, total: days * algos.length });
    const progress = new Map<string, number>();
    const jobs = algos.map((algorithm) => {
      const job = runSimulation({ scenarioId, config: { ...config, algorithm }, rules, days, squadsPerDay: squads, seed, population: mix }, (d) => {
        progress.set(algorithm, d);
        setRunning({ done: [...progress.values()].reduce((a, b) => a + b, 0), total: days * algos.length });
      });
      return job;
    });
    cancelRef.current = jobs.map((j) => j.cancel);
    try {
      const res = await Promise.all(jobs.map((j) => j.promise));
      setResults(res);
    } catch (e) {
      if ((e as Error).message !== 'cancelled') toast('Simulation failed', (e as Error).message, 'bad');
    } finally {
      setRunning(null);
    }
  };

  const setP = (path: string, v: number) => {
    try {
      setConfig((c) => setParam(c, path, v));
    } catch (e) {
      toast('Bad value', (e as Error).message, 'bad');
    }
  };

  const anchoredResult = results?.find((r) => r.config.algorithm === 'anchored') ?? results?.[0];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10">
      <SectionTitle eyebrow="Pricing test bench" title="Market Lab" />
      <p className="text-text-2 mt-2 max-w-3xl">
        Rule-based squads of simulated Helldivers (no AI — just budgets, preferences and dice) play months of operations against a copy of the market. Tune the pricing equations, run a scenario, and the
        health checks tell you if prices did anything unwanted. Your live market is never touched unless you apply the result.
      </p>

      <div className="mt-6 grid xl:grid-cols-[380px_1fr] gap-4 items-start">
        {/* Controls */}
        <div className="space-y-4 xl:sticky xl:top-[74px] xl:max-h-[calc(100vh-90px)] xl:overflow-y-auto pr-1 min-w-0">
          <div className="panel p-4">
            <div className="font-display font-bold uppercase tracking-wider mb-2">Scenario</div>
            <div className="space-y-1.5 max-h-[270px] overflow-y-auto pr-1">
              {SCENARIOS.map((s) => (
                <button key={s.id} onClick={() => pickScenario(s.id)} className={`w-full text-left px-3 py-2 border transition-colors ${s.id === scenarioId ? 'border-yellow bg-yellow/[0.06]' : 'border-line hover:border-line-2'}`}>
                  <div className={`font-display font-bold uppercase tracking-wider text-[14px] ${s.id === scenarioId ? 'text-yellow' : ''}`}>{s.name}</div>
                  <div className="text-[12px] text-muted leading-snug">{s.description}</div>
                </button>
              ))}
            </div>
            <div className="text-[12.5px] text-text-2 mt-3">
              <span className="text-muted">Healthy looks like:</span> {scenario.expectation}
            </div>
          </div>

          <div className="panel p-4 space-y-3">
            <div className="font-display font-bold uppercase tracking-wider">Run</div>
            <div className="grid grid-cols-3 gap-1">
              {(['anchored', 'legacy', 'compare'] as Mode[]).map((m) => (
                <button key={m} className={`py-2 border text-[13px] font-display font-bold uppercase tracking-wider ${m === mode ? 'border-yellow text-yellow bg-yellow/[0.06]' : 'border-line text-muted hover:text-text'}`} onClick={() => setMode(m)}>
                  {m === 'anchored' ? 'Anchored' : m === 'legacy' ? 'Prototype' : 'Compare'}
                </button>
              ))}
            </div>
            <Slider label="Market cycles (days)" value={days} min={20} max={300} step={10} onChange={setDays} />
            <Slider label="Squads per day" value={squads} min={2} max={300} step={1} onChange={setSquads} format={(v) => `${v} (${v * 12} loadouts)`} />
            <Slider label="Random seed" value={seed} min={1} max={50} step={1} onChange={setSeed} />
            {running ? (
              <div>
                <div className="h-2 bg-yellow/10">
                  <div className="h-full bg-yellow transition-[width]" style={{ width: `${(running.done / running.total) * 100}%` }} />
                </div>
                <div className="flex justify-between mt-2 text-[13px] text-muted">
                  <span>Simulating… {Math.round((running.done / running.total) * 100)}%</span>
                  <button className="text-bad hover:underline" onClick={() => cancelRef.current.forEach((c) => c())}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn-primary btn-lg w-full" onClick={run}>
                Run simulation
              </button>
            )}
          </div>

          <div className="panel p-4 space-y-2.5">
            <div className="font-display font-bold uppercase tracking-wider">Playerbase</div>
            {ARCH_IDS.map((a) => (
              <Slider key={a} label={ARCHETYPES[a].label} value={mix[a]} min={0} max={100} step={1} onChange={(v) => setMix((m) => ({ ...m, [a]: v }))} hint={ARCHETYPES[a].description} />
            ))}
            <div className="pt-2 border-t border-line space-y-2.5">
              <Slider label="Mission earnings" value={earnScale} min={0.4} max={1.6} step={0.05} onChange={setEarnScale} format={(v) => `${Math.round(v * 11000).toLocaleString()} at D9`} />
              <Slider label="Reinforcement cost" value={reinforce} min={0} max={1500} step={50} onChange={setReinforce} />
            </div>
          </div>

          <div className="panel p-4">
            <button className="w-full flex items-center justify-between font-display font-bold uppercase tracking-wider" onClick={() => setShowParams((s) => !s)}>
              Pricing equations <span className="text-muted">{showParams ? '−' : '+'}</span>
            </button>
            {showParams && (
              <div className="mt-3 space-y-2.5">
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfig(defaultConfig())}>
                    Defaults
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfig(structuredClone(store.get().market.config))}>
                    Load live config
                  </button>
                </div>
                {PARAM_SPECS.filter((s) => s.algorithm !== 'legacy' || mode !== 'anchored')
                  .filter((s) => s.algorithm !== 'anchored' || mode !== 'legacy')
                  .map((s) => (
                    <Slider
                      key={s.path}
                      label={`${s.algorithm === 'legacy' ? '[proto] ' : ''}${s.label}`}
                      value={getParam(config, s.path) as number}
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      onChange={(v) => setP(s.path, v)}
                      hint={s.description}
                    />
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4 min-w-0">
          {results ? (
            <>
              <VerdictBanner results={results} />
              <HealthTable results={results} />
              <ResultCharts results={results} />
              <div className="panel p-4 flex items-center gap-3 flex-wrap">
                <div className="text-[13.5px] text-text-2 flex-1 min-w-[260px]">Happy with these settings? Push them to the live market used by the Deploy page and the terminal.</div>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    store.mutateMarket((m) => {
                      m.config = { ...structuredClone(config), algorithm: anchoredResult!.config.algorithm };
                    });
                    toast('Live pricing updated', 'The next `update` uses these parameters.', 'good');
                  }}
                >
                  Use these parameters live
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmApply(true)}>
                  Replace live market with this end state
                </button>
              </div>
            </>
          ) : (
            <div className="panel p-10 text-center">
              <div className="h-display text-[34px]">No simulation yet</div>
              <p className="text-muted mt-2 max-w-xl mx-auto">
                Pick a scenario and hit <span className="text-yellow">Run simulation</span>. A four-month run with sixty squads a day takes a few seconds and runs in the background. Use <span className="text-yellow">Compare</span>{' '}
                to race the new anchored algorithm against the original Python prototype’s algorithm.
              </p>
            </div>
          )}
        </div>
      </div>

      <Modal open={confirmApply} onClose={() => setConfirmApply(false)} title="Replace the live market?">
        <p className="text-text-2">
          The live market and its price history are replaced with the simulation’s end state ({anchoredResult?.days.length} cycles of {anchoredResult?.scenario.name}). Handy for testing the game against a matured
          market. Your active campaign keeps going.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setConfirmApply(false)}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (anchoredResult) {
                store.replaceMarket(structuredClone(anchoredResult.final), historyFromSim(anchoredResult));
                toast('Market replaced', `Now at cycle #${anchoredResult.final.day}.`, 'good');
              }
              setConfirmApply(false);
            }}
          >
            Replace
          </button>
        </div>
      </Modal>
    </div>
  );
}
