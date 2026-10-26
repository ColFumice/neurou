import type { WorldIR } from '@neurou/core';
import { simulate } from '@neurou/runtime';
import type { PublishSummary } from './types.js';

interface Request {
  ir: WorldIR;
  world: string;
  runs: number;
  maxTicks: number;
  seed: number;
}

const ctx = self as unknown as {
  postMessage: (value: PublishSummary | { error: string }) => void;
  onmessage: ((ev: MessageEvent<Request>) => void) | null;
};

ctx.onmessage = (ev) => {
  const { ir, world, runs, maxTicks, seed } = ev.data;
  try {
    const started = performance.now();
    const result = simulate(ir, { runs, maxTicks, seed, models: ['random', 'greedy', 'learner'] });
    const elapsedMs = performance.now() - started;
    const summary: PublishSummary = {
      world,
      score: result.health.score,
      grade: result.health.grade,
      verdict: result.health.verdict,
      total: result.overall.runs,
      endings: result.overall.endings,
      meanTicks: result.overall.meanTicks,
      deadForcings: result.overall.deadForcings,
      deadSignals: result.overall.deadSignals,
      unusedActions: result.overall.unusedActions,
      deadStateRuns: result.overall.deadStateRuns,
      violations: result.overall.violations,
      notes: result.health.notes,
      dimensions: result.health.dimensions.map((d) => ({
        key: d.key,
        label: d.label,
        value: d.value,
        detail: d.detail,
        ratio: d.ratio,
      })),
      elapsedMs,
      runs: result.overall.runs,
    };
    ctx.postMessage(summary);
  } catch (err) {
    ctx.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
