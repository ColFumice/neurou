import type { IRString, WorldIR } from '@neurou/core';
import type { RuntimeValue, Universe } from '@neurou/runtime';
import type { TermId } from './terms.js';

export interface ViewSnapshot {
  tick: number;
  phase: string | null;
  phaseProgress: number;
  values: Record<string, RuntimeValue>;
  ended: string | null;
}

/** 一根弦离最近一条阈值线有多近：1 = 压在线上，0 = 在量程另一端。 */
export interface TensionInfo {
  tension: number;
  threshold: number;
  kind: 'verge' | 'safe';
  /** 阈值在量程里的位置，0..1 */
  position: number;
}

export function tensionOf(s: IRString, value: unknown): TensionInfo | null {
  if (s.domain.type !== 'number') return null;
  if (typeof value !== 'number') return null;
  if (s.verge === undefined && s.safe === undefined) return null;
  const min = s.domain.min ?? 0;
  const max = s.domain.max ?? 100;
  const range = max - min || 1;
  let best: TensionInfo | null = null;
  const consider = (threshold: number, kind: 'verge' | 'safe'): void => {
    const tension = 1 - Math.min(1, Math.abs(value - threshold) / range);
    if (!best || tension > best.tension) best = { tension, threshold, kind, position: Math.min(1, Math.max(0, (threshold - min) / range)) };
  };
  if (s.verge !== undefined) consider(s.verge, 'verge');
  if (s.safe !== undefined) consider(s.safe, 'safe');
  return best;
}

export interface DisplayCue {
  id: string;
  at: number;
  kind: '台词' | '字幕' | '视觉' | '音频' | '触觉' | '提示';
  text: string;
  signal: string;
  param?: string;
  value?: number;
}

export interface PublishSummary {
  world: string;
  score: number;
  grade: '红' | '绿' | '黄';
  verdict: string;
  total: number;
  endings: Record<string, number>;
  meanTicks: number;
  deadForcings: string[];
  deadSignals: string[];
  unusedActions: string[];
  deadStateRuns: number;
  violations: number;
  notes: string[];
  dimensions: { key: string; label: string; value: number; detail: string; ratio: number }[];
  elapsedMs: number;
  runs: number;
}

export interface TermPopup {
  id: TermId;
  x: number;
  y: number;
  nonce: number;
}

export interface TermCardState {
  id: TermId;
  left: number;
  top: number;
}

export function snapshotOf(u: Universe): ViewSnapshot {
  const vals: Record<string, RuntimeValue> = {};
  for (const s of u.ir.strings) vals[s.id] = u.get(s.id);
  const phase = u.ir.phases[u.state.phaseIndex] ?? null;
  return {
    tick: u.state.tick,
    phase: u.phaseName ?? null,
    phaseProgress: phase ? Math.min(1, u.state.phaseTick / phase.duration) : 0,
    values: vals,
    ended: u.state.ended?.name ?? null,
  };
}

export function numeric(snap: ViewSnapshot, id: string): number {
  const v = snap.values[id];
  return typeof v === 'number' ? v : 0;
}

export function booleanOf(snap: ViewSnapshot, id: string): boolean {
  return snap.values[id] === true;
}

export function stringLabel(world: WorldIR, id: string): string {
  return world.strings.find((s) => s.id === id)?.name ?? id;
}
