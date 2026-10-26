import type { IREffect, IRString, WorldIR } from '@neurou/core';
import { preferenceOf, wellnessOf } from '@neurou/core';
import { Universe } from './engine.js';
import { asNumber, evalExpr } from './eval.js';

/** 确定性随机数（mulberry32）。同一 seed 必须得到同一局。 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[this.int(arr.length)];
  }
}

export type ModelKind = 'random' | 'greedy' | 'learner';

export interface Policy {
  readonly kind: ModelKind;
  beginRun?(episode: number): void;
  choose(u: Universe, rng: Rng): string | undefined;
  observe?(key: string, action: string | undefined, reward: number, nextKey: string): void;
  stateKey?(u: Universe): string;
}

// ---------- 玩家模型 ----------

export class RandomPolicy implements Policy {
  readonly kind = 'random' as const;
  choose(u: Universe, rng: Rng): string | undefined {
    const acts = u.availableActions();
    if (acts.length === 0) return undefined;
    if (rng.next() < 0.1) return undefined; // 偶尔什么都不做
    return rng.pick(acts)?.id;
  }
}

export class GreedyPolicy implements Policy {
  readonly kind = 'greedy' as const;
  choose(u: Universe, rng: Rng): string | undefined {
    const acts = u.availableActions();
    if (acts.length === 0) return undefined;
    if (rng.next() < 0.05) return rng.pick(acts)?.id;
    let best: string | undefined;
    let bestScore = -Infinity;
    for (const a of acts) {
      const score = scoreEffects(u, a.effects, 0) + rng.next() * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = a.id;
      }
    }
    return best;
  }
}

interface QEntry {
  key: string;
  action: string | undefined;
}

/**
 * 学习型玩家：同一状态桶下用 ε-greedy 学「哪个动作让整体健康度上升」。
 * 它不是要模拟真人，只是给创作者一条「这个世界学得会吗」的下限曲线。
 */
export class LearnerPolicy implements Policy {
  readonly kind = 'learner' as const;
  private readonly q = new Map<string, number>();
  private epsilon = 0.3;
  private last: QEntry | undefined;
  private readonly actions: string[];

  constructor(private readonly ir: WorldIR) {
    this.actions = ir.rules.filter((r) => r.kind === 'action').map((r) => r.id);
  }

  beginRun(episode: number): void {
    this.epsilon = Math.max(0.08, 0.3 * Math.pow(0.97, episode));
    this.last = undefined;
  }

  stateKey(u: Universe): string {
    const parts: string[] = [];
    for (const s of this.ir.strings) {
      const v = u.get(s.id);
      parts.push(`${s.id}=${bucket(s, v)}`);
    }
    return parts.join('|');
  }

  choose(u: Universe, rng: Rng): string | undefined {
    const avail = u.availableActions().map((a) => a.id);
    if (avail.length === 0) return undefined;
    const key = this.stateKey(u);
    let action: string | undefined;
    if (rng.next() < this.epsilon) {
      action = rng.pick(avail);
    } else {
      let best = -Infinity;
      for (const a of avail) {
        const q = this.q.get(`${key}::${a}`) ?? 0;
        if (q > best) {
          best = q;
          action = a;
        }
      }
    }
    this.last = { key, action };
    return action;
  }

  observe(_key: string, action: string | undefined, reward: number, nextKey: string): void {
    if (!this.last) return;
    const { key, action: a } = this.last;
    const full = `${key}::${a ?? '∅'}`;
    const old = this.q.get(full) ?? 0;
    let nextBest = 0;
    for (const candidate of this.actions) {
      const q = this.q.get(`${nextKey}::${candidate}`) ?? 0;
      if (q > nextBest) nextBest = q;
    }
    const updated = old + 0.2 * (reward + 0.9 * nextBest - old);
    this.q.set(full, updated);
    void action;
  }

  get tableSize(): number {
    return this.q.size;
  }
}

function bucket(s: IRString, v: unknown): string {
  if (s.domain.type === 'number') {
    const n = typeof v === 'number' ? v : 0;
    if (s.verge !== undefined && s.safe !== undefined) {
      const lo = Math.min(s.verge, s.safe);
      const hi = Math.max(s.verge, s.safe);
      if (n < lo) return 'a';
      if (n > hi) return 'c';
      return 'b';
    }
    const min = s.domain.min ?? 0;
    const max = s.domain.max ?? 100;
    const t = max > min ? (n - min) / (max - min) : 0.5;
    return String(Math.min(4, Math.max(0, Math.floor(t * 5))));
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Set) return `s${Math.min(3, v.size)}`;
  return String(v ?? '∅');
}

export function scoreEffects(u: Universe, effects: readonly IREffect[], depth = 0): number {
  let score = 0;
  for (const e of effects) {
    if (e.k === 'apply') {
      if (depth > 3) continue;
      const chord = u.chords.get(e.chord);
      if (chord) score += scoreEffects(u, chord.effects, depth + 1);
      continue;
    }
    const s = u.strings.get(e.id);
    if (!s) continue;
    if (s.domain.type === 'number') {
      const cur = u.number(e.id);
      const raw = asNumber(evalExpr(e.value, u.state));
      const next = e.k === 'set' ? raw : e.k === 'add' ? cur + raw : cur - raw;
      const delta = next - cur;
      const pref = preferenceOf(s);
      const range =
        s.domain.min !== undefined && s.domain.max !== undefined && s.domain.max > s.domain.min
          ? s.domain.max - s.domain.min
          : 100;
      score += (pref === 0 ? 0 : pref) * (delta / range);
    } else if (s.domain.type === 'set' && (e.k === 'add' || e.k === 'sub')) {
      score += e.k === 'add' ? 0.08 : -0.08;
    }
  }
  return score;
}

/** 世界当前的整体健康度（0..1），只统计「有明确好坏方向」的数值弦。 */
export function wellness(u: Universe): number {
  let total = 0;
  let n = 0;
  for (const s of u.ir.strings) {
    if (s.domain.type !== 'number') continue;
    if (preferenceOf(s) === 0) continue;
    total += wellnessOf(s, u.number(s.id));
    n++;
  }
  return n === 0 ? 0.5 : total / n;
}

// ---------- 单局 ----------

export interface RunSummary {
  model: ModelKind;
  ending: string;
  ticks: number;
  deadStates: number;
  violations: number;
  cues: number;
  firedForcings: string[];
  firedSignals: string[];
  usedActions: string[];
  signature: string;
}

export interface RunOptions {
  maxTicks: number;
  seed: number;
  model: ModelKind;
  learner?: LearnerPolicy;
}

export function runOnce(ir: WorldIR, opts: RunOptions): RunSummary {
  const u = new Universe(ir, { seed: opts.seed, log: false });
  const rng = new Rng(opts.seed ^ 0x9e3779b9);
  const policy: Policy =
    opts.model === 'learner' ? (opts.learner ?? new LearnerPolicy(ir)) : opts.model === 'greedy' ? new GreedyPolicy() : new RandomPolicy();
  let key = policy.stateKey?.(u) ?? '';
  let guardTicks = 0;
  while (!u.ended && u.state.tick < opts.maxTicks) {
    guardTicks++;
    if (guardTicks > opts.maxTicks * 4 + 10) break;
    const actionId = policy.choose(u, rng);
    if (actionId) u.act(actionId);
    const before = wellness(u);
    u.tick();
    const after = wellness(u);
    const reward = (after - before) * 10 + (u.ended ? 1 : 0);
    const nextKey = policy.stateKey?.(u) ?? '';
    policy.observe?.(key, actionId, reward, nextKey);
    key = nextKey;
  }

  const ending = u.state.ended ? u.state.ended.name : '超时';
  return {
    model: opts.model,
    ending,
    ticks: u.state.tick,
    deadStates: u.stats.deadStates,
    violations: u.stats.violations,
    cues: u.stats.cueCount,
    firedForcings: [...u.stats.forcingFired],
    firedSignals: [...u.stats.signalFired],
    usedActions: [...u.stats.actionUsed.keys()],
    signature: signatureOf(u),
  };
}

function signatureOf(u: Universe): string {
  const parts: string[] = [];
  for (const s of u.ir.strings) {
    const v = u.get(s.id);
    if (typeof v === 'number') {
      const min = s.domain.type === 'number' ? (s.domain.min ?? 0) : 0;
      const max = s.domain.type === 'number' ? (s.domain.max ?? 100) : 100;
      const t = max > min ? (v - min) / (max - min) : 0;
      parts.push(`${s.id}:${Math.round(t * 4)}`);
    } else if (v instanceof Set) {
      parts.push(`${s.id}:${Math.min(3, v.size)}`);
    } else {
      parts.push(`${s.id}:${String(v)}`);
    }
  }
  return parts.join(',');
}

// ---------- 批量 ----------

export interface SimOptions {
  runs: number;
  maxTicks: number;
  models: ModelKind[];
  seed: number;
}

export interface ModelStats {
  model: ModelKind | 'overall';
  runs: number;
  endings: Record<string, number>;
  meanTicks: number;
  medianTicks: number;
  stdevTicks: number;
  entropy: number;
  distinctOutcomes: number;
  liveForcings: string[];
  deadForcings: string[];
  liveSignals: string[];
  deadSignals: string[];
  usedActions: string[];
  unusedActions: string[];
  deadStateRuns: number;
  violations: number;
  cues: number;
  attractors: { signature: string; count: number }[];
}

export interface HealthDimension {
  key: string;
  label: string;
  value: number;
  /** 0..1 的达成度 */
  ratio: number;
  detail: string;
}

export interface HealthReport {
  score: number;
  grade: '红' | '绿' | '黄';
  verdict: string;
  dimensions: HealthDimension[];
  notes: string[];
}

export interface BatchResult {
  ir: WorldIR;
  runs: RunSummary[];
  models: ModelStats[];
  overall: ModelStats;
  health: HealthReport;
  options: SimOptions;
  elapsedMs: number;
}

const ALL_MODELS: ModelKind[] = ['random', 'greedy', 'learner'];

export function simulate(ir: WorldIR, opts: Partial<SimOptions> = {}): BatchResult {
  const options: SimOptions = {
    runs: opts.runs ?? 2000,
    maxTicks: opts.maxTicks ?? 120,
    models: opts.models ?? ALL_MODELS,
    seed: opts.seed ?? 1,
  };
  const started = Date.now();
  const runs: RunSummary[] = [];
  const learner = options.models.includes('learner') ? new LearnerPolicy(ir) : undefined;
  const perModel = Math.max(1, Math.floor(options.runs / options.models.length));

  for (const model of options.models) {
    for (let i = 0; i < perModel; i++) {
      learner?.beginRun(i);
      runs.push(
        runOnce(ir, {
          model,
          maxTicks: options.maxTicks,
          seed: options.seed + i * 7919 + model.length * 104729,
          learner,
        }),
      );
    }
  }

  const allForcings = ir.rules.filter((r) => r.kind === 'forcing').map((r) => r.name);
  const allSignals = ir.signals.map((s) => s.name);
  const allActions = ir.rules.filter((r) => r.kind === 'action').map((r) => r.name);

  const models = options.models.map((m) => summarize(runs.filter((r) => r.model === m), m, allForcings, allSignals, allActions));
  const overall = summarize(runs, 'overall', allForcings, allSignals, allActions);
  const health = diagnose(overall, ir);

  return {
    ir,
    runs,
    models,
    overall,
    health,
    options,
    elapsedMs: Date.now() - started,
  };
}

function summarize(
  runs: RunSummary[],
  model: ModelKind | 'overall',
  allForcings: string[],
  allSignals: string[],
  allActions: string[],
): ModelStats {
  const endingCounts: Record<string, number> = {};
  for (const r of runs) endingCounts[r.ending] = (endingCounts[r.ending] ?? 0) + 1;
  const ticks = runs.map((r) => r.ticks).sort((a, b) => a - b);
  const mean = ticks.length ? ticks.reduce((a, b) => a + b, 0) / ticks.length : 0;
  const median = ticks.length ? ticks[Math.floor(ticks.length / 2)]! : 0;
  const variance = ticks.length ? ticks.reduce((a, b) => a + (b - mean) ** 2, 0) / ticks.length : 0;
  const distinct = Object.keys(endingCounts).length;
  const entropy = normalizedEntropy(Object.values(endingCounts));
  const liveForcings = new Set(runs.flatMap((r) => r.firedForcings));
  const liveSignals = new Set(runs.flatMap((r) => r.firedSignals));
  const usedActions = new Set(runs.flatMap((r) => r.usedActions));
  const attractorCounts = new Map<string, number>();
  for (const r of runs) attractorCounts.set(r.signature, (attractorCounts.get(r.signature) ?? 0) + 1);
  const attractors = [...attractorCounts.entries()]
    .map(([signature, count]) => ({ signature, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    model,
    runs: runs.length,
    endings: endingCounts,
    meanTicks: round(mean),
    medianTicks: median,
    stdevTicks: round(Math.sqrt(variance)),
    entropy: round(entropy),
    distinctOutcomes: distinct,
    liveForcings: allForcings.filter((f) => liveForcings.has(f)),
    deadForcings: allForcings.filter((f) => !liveForcings.has(f)),
    liveSignals: allSignals.filter((s) => liveSignals.has(s)),
    deadSignals: allSignals.filter((s) => !liveSignals.has(s)),
    usedActions: allActions.filter((a) => usedActions.has(a)),
    unusedActions: allActions.filter((a) => !usedActions.has(a)),
    deadStateRuns: runs.filter((r) => r.deadStates > 0).length,
    violations: runs.reduce((a, r) => a + r.violations, 0),
    cues: runs.reduce((a, r) => a + r.cues, 0),
    attractors,
  };
}

/** 归一化熵：所有局落在同一个结局时为 0，均匀铺开时为 1。 */
function normalizedEntropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0 || counts.length <= 1) return 0;
  let h = 0;
  for (const c of counts) {
    const p = c / total;
    h -= p * Math.log(p);
  }
  return Math.min(1, h / Math.log(counts.length));
}

/**
 * 音准仪：把「这个世界会不会散架/好不好玩」拆成可计算的维度。
 *
 * 绿区是 60–85，不是 100——100 分意味着所有模拟都收敛到同一个结果，
 * 那是一个精确但没有意外的世界。
 */
export function diagnose(overall: ModelStats, ir: WorldIR): HealthReport {
  const notes: string[] = [];
  const dims: HealthDimension[] = [];

  const hardDefects = overall.violations;
  const hardPenalty = hardDefects > 0 ? Math.min(40, 12 + Math.log2(hardDefects + 1) * 8) : 0;
  dims.push({
    key: 'axioms',
    label: '公理与硬缺陷',
    value: hardDefects,
    ratio: hardDefects === 0 ? 1 : 0,
    detail: hardDefects === 0 ? '没有规则把世界推到自相矛盾' : `${hardDefects} 次公理违反`,
  });
  if (hardDefects > 0) notes.push('有公理被触发规则破坏——先修这个，其他分数都不可信。');

  const deadStateRatio = overall.runs > 0 ? overall.deadStateRuns / overall.runs : 0;
  const deadPenalty = deadStateRatio * 20;
  dims.push({
    key: 'agency',
    label: '玩家能动性',
    value: round(deadStateRatio * 100),
    ratio: 1 - deadStateRatio,
    detail: deadStateRatio === 0 ? '任何时刻都有可做的事' : `${round(deadStateRatio * 100)}% 的局出现「无事可做」`,
  });
  if (deadStateRatio > 0.1) notes.push('超过一成的局里玩家无动作可选——这是操作空间归零的早期信号。');

  const totalRules = ir.rules.length;
  const forceRatio = totalRules > 0 ? overall.liveForcings.length / Math.max(1, ir.rules.filter((r) => r.kind === 'forcing').length) : 1;
  const signalRatio = ir.signals.length > 0 ? overall.liveSignals.length / ir.signals.length : 1;
  const actionTotal = ir.rules.filter((r) => r.kind === 'action').length;
  const actionRatio = actionTotal > 0 ? overall.usedActions.length / actionTotal : 1;
  const liveness = (forceRatio + signalRatio + actionRatio) / 3;
  dims.push({
    key: 'liveness',
    label: '规则活性',
    value: round(liveness * 100),
    ratio: liveness,
    detail: `力迫 ${overall.liveForcings.length}/${ir.rules.filter((r) => r.kind === 'forcing').length} · 信号 ${overall.liveSignals.length}/${ir.signals.length} · 动作 ${overall.usedActions.length}/${actionTotal}`,
  });
  if (overall.deadForcings.length > 0) notes.push(`这些力迫在所有模拟里从未触发：${overall.deadForcings.join('、')}。`);
  if (overall.deadSignals.length > 0) notes.push(`这些信号从未被玩家感知到：${overall.deadSignals.join('、')}。`);
  if (overall.unusedActions.length > 0) notes.push(`这些动作没有被任何模型选中：${overall.unusedActions.join('、')}。`);

  dims.push({
    key: 'variety',
    label: '结局的分歧',
    value: round(overall.entropy * 100),
    ratio: overall.entropy,
    detail: `${overall.distinctOutcomes} 种结局（含超时）· 归一化熵 ${round(overall.entropy * 100)}%`,
  });
  if (overall.distinctOutcomes <= 1) notes.push('所有模拟都落在同一个结局——回路没有把世界推向分歧。');

  const cv = overall.meanTicks > 0 ? overall.stdevTicks / overall.meanTicks : 0;
  const spread = Math.min(1, cv * 2);
  dims.push({
    key: 'pace',
    label: '节奏的离散',
    value: round(cv * 100),
    ratio: spread,
    detail: `平均 ${overall.meanTicks} 拍 · 标准差 ${overall.stdevTicks}`,
  });

  dims.push({
    key: 'attractors',
    label: '吸引子集中度',
    value: overall.attractors[0]?.count ?? 0,
    ratio: overall.attractors[0] ? 1 - overall.attractors[0].count / Math.max(1, overall.runs) : 1,
    detail: overall.attractors[0]
      ? `最常见的终局占 ${round((overall.attractors[0].count / Math.max(1, overall.runs)) * 100)}%`
      : '没有可识别的终局',
  });

  // 满分被刻意压在 85 以下：一个「哪里都对」的世界不该拿满分。
  const base =
    5 +
    (1 - deadStateRatio) * 14 +
    forceRatio * 10 +
    signalRatio * 7 +
    actionRatio * 4 +
    overall.entropy * 30 +
    spread * 8 +
    (overall.attractors[0] ? (1 - overall.attractors[0].count / Math.max(1, overall.runs)) * 4 : 0);

  const score = Math.max(0, Math.min(100, Math.round(base - hardPenalty - deadPenalty)));
  const grade: HealthReport['grade'] = score < 60 ? '红' : score <= 85 ? '绿' : '黄';
  let verdict: string;
  if (grade === '红') verdict = '这个世界还站不稳：先处理硬缺陷与死局，再谈好玩。';
  else if (grade === '绿') verdict = '这个世界站得住，而且有分歧；可以发布了，但还有可调的空间。';
  else verdict = '太均衡了——所有路径都被磨平了。100 分的世界没有意外，试着松开一个阈值。';

  if (score > 85) notes.push('音准偏高：结局太可控，玩家可能感觉「怎么走都一样」。');

  return { score, grade, verdict, dimensions: dims, notes };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
