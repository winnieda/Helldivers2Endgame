'use client';
import type { ArchetypeId, EconomyRules, MarketConfig, MarketState, SimResult } from '@engine';

export interface SimRequest {
  scenarioId: string;
  config: MarketConfig;
  rules?: Partial<EconomyRules>;
  days?: number;
  squadsPerDay?: number;
  seed?: number;
  population?: Partial<Record<ArchetypeId, number>>;
  /** Start from this market instead of the scenario preset. */
  market?: MarketState;
  control?: boolean;
}

export type WorkerMessage = { type: 'progress'; day: number; total: number } | { type: 'result'; result: SimResult } | { type: 'error'; message: string };

/** Runs a simulation off the main thread. */
export function runSimulation(req: SimRequest, onProgress?: (day: number, total: number) => void): { promise: Promise<SimResult>; cancel: () => void } {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url));
  let settle: { resolve: (r: SimResult) => void; reject: (e: Error) => void } | null = null;
  const promise = new Promise<SimResult>((resolve, reject) => (settle = { resolve, reject }));
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.type === 'progress') onProgress?.(m.day, m.total);
    else {
      worker.terminate();
      if (m.type === 'result') settle?.resolve(m.result);
      else settle?.reject(new Error(m.message));
    }
  };
  worker.onerror = (e) => {
    worker.terminate();
    settle?.reject(new Error(e.message || 'Simulation worker crashed'));
  };
  worker.postMessage(req);
  return {
    promise,
    cancel: () => {
      worker.terminate();
      settle?.reject(new Error('cancelled'));
    },
  };
}
