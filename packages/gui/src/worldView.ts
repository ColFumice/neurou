import { KIND_ORDER, type IRString, type StringKind, type WorldIR } from '@neurou/core';
import type { Universe } from '@neurou/runtime';
import { clamp, type Lane } from './stringMath.js';

/**
 * 世界 ↔ 调律台的投影层。
 *
 * 逻辑与 React 无关，放在这里是为了能单测：
 *   - `numericStringsByKind`：世界里的数值弦按 8 类分组（同类可以有多根）；
 *   - `collectLanes`：把选中的弦 + 运行时值投影成界面上的弦；
 *   - `withCurrentBaselines`：写回前把当拍值冻结成新基线。
 */

const DEFAULT_RANGE: [number, number] = [0, 100];

export function laneRange(string: IRString): [number, number] {
  if (string.domain.type !== 'number') return DEFAULT_RANGE;
  return [string.domain.min ?? DEFAULT_RANGE[0], string.domain.max ?? DEFAULT_RANGE[1]];
}

/** 世界里的数值弦按类分组，保持声明顺序（同类多根时用作 ArrowLeft/Right 的候选表）。 */
export function numericStringsByKind(ir: WorldIR): Record<StringKind, IRString[]> {
  const groups = Object.fromEntries(KIND_ORDER.map((kind) => [kind, [] as IRString[]])) as Record<
    StringKind,
    IRString[]
  >;
  for (const string of ir.strings) {
    if (string.domain.type !== 'number') continue;
    groups[string.kind].push(string);
  }
  return groups;
}

function laneOf(universe: Universe, string: IRString): Lane {
  const [min, max] = laneRange(string);
  const span = max - min || 1;
  const raw = universe.get(string.id);
  const value = typeof raw === 'number' ? raw : min;
  const norm = clamp((value - min) / span, 0, 1);
  const lane: Lane = { kind: string.kind, id: string.id, name: string.name, value, min, max, norm };
  if (string.verge !== undefined) {
    lane.verge = string.verge;
    lane.vergeNorm = clamp((string.verge - min) / span, 0, 1);
  }
  if (string.safe !== undefined) {
    lane.safe = string.safe;
    lane.safeNorm = clamp((string.safe - min) / span, 0, 1);
  }
  return lane;
}

/**
 * 每类弦显示**选中的那一根**（默认第一根）：值 → 归一化基线，阈值 → 归一化共振点。
 * lanes 顺序 = KIND_ORDER；缺类的世界自然少几根。
 */
export function collectLanes(
  universe: Universe,
  ir: WorldIR,
  selected: Partial<Record<StringKind, number>> = {},
): Lane[] {
  const groups = numericStringsByKind(ir);
  const lanes: Lane[] = [];
  for (const kind of KIND_ORDER) {
    const candidates = groups[kind];
    if (candidates.length === 0) continue;
    const index = ((selected[kind] ?? 0) % candidates.length + candidates.length) % candidates.length;
    lanes.push(laneOf(universe, candidates[index]!));
  }
  return lanes;
}

/**
 * 写回时把「这一拍的运行时值」冻结成新的基线：调律台调的是世界的初值，
 * 刷新后世界从这里开始。只改数值弦；其它类型的基线保持原样。
 * 注意：同类多根弦时，所有候选都会冻结（不只界面上选中的那根）。
 */
export function withCurrentBaselines(ir: WorldIR, universe: Universe): WorldIR {
  return {
    ...ir,
    strings: ir.strings.map((string) => {
      if (string.domain.type !== 'number') return string;
      const raw = universe.get(string.id);
      if (typeof raw !== 'number') return string;
      const baseline = Math.round(raw * 1000) / 1000;
      return baseline === string.baseline ? string : { ...string, baseline };
    }),
  };
}
