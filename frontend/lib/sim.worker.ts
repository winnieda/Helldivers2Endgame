import { defaultRules, scenarioById, simulate } from '@engine';
import type { SimRequest, WorkerMessage } from './simClient';

const post = (m: WorkerMessage) => (globalThis as unknown as { postMessage: (m: WorkerMessage) => void }).postMessage(m);

globalThis.onmessage = (e: MessageEvent<SimRequest>) => {
  const req = e.data;
  try {
    const base = scenarioById(req.scenarioId);
    if (!base) throw new Error(`Unknown scenario ${req.scenarioId}`);
    const scenario = req.population ? { ...base, population: req.population } : base;
    const total = req.days ?? scenario.days;
    const result = simulate({
      scenario,
      config: req.config,
      rules: { ...defaultRules(), ...req.rules },
      days: req.days,
      squadsPerDay: req.squadsPerDay,
      seed: req.seed,
      market: req.market,
      control: req.control,
      onDay: (d) => {
        if (d.day % 3 === 0 || d.day === total) post({ type: 'progress', day: d.day, total });
      },
    });
    post({ type: 'result', result });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
  }
};
