import type { WorldIR } from '@neurou/core';
import type { RuntimeValue, Universe } from '@neurou/runtime';
import type { TermId } from './terms.js';

export interface ViewSnapshot {
  tick: number;
  phase: string | null;
  phaseProgress: number;
  values: Record<string, RuntimeValue>;
  ended: string | null;
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
