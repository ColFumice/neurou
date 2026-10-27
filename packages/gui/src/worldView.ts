import { KIND_ORDER, type WorldIR } from '@neurou/core';
import type { Universe } from '@neurou/runtime';
import { clamp, type Lane } from './stringMath.js';

/**
 * 世界 ↔ 调律台的投影层。
 *
 * 逻辑与 React 无关，放在这里是为了能单测：
 *   - `collectLanes`：把 WorldIR + 运行时值投影成 8 根弦；
 *   - `withCurrentBaselines`：写回前把当拍值冻结成新基线。
 */

const DEFAULT_RANGE: [number, number] = [0, 100];

export function laneRange(string: WorldIR['strings'][number]): [number, number] {
  if (string.domain.type !== 'number') return DEFAULT_RANGE;
  return [string.domain.min ?? DEFAULT_RANGE[0], string.domain.max ?? DEFAULT_RANGE[1]];
}

/**
 * 每类弦取第一根数值弦：值 → 归一化基线，阈值 → 归一化共振点。
 * lanes 的顺序 = KIND_ORDER，调律台左侧标签用世界里的弦名。
 */
export function collectLanes(universe: Universe, ir: WorldIR): Lane[] {
  const lanes: Lane[] = [];
  for (const kind of KIND_ORDER) {
    const string = ir.strings.find((s) => s.kind === kind && s.domain.type === 'number');
    if (!string) continue;
    const [min, max] = laneRange(string);
    const span = max - min || 1;
    const raw = universe.get(string.id);
    const value = typeof raw === 'number' ? raw : min;
    const norm = clamp((value - min) / span, 0, 1);
    const lane: Lane = { kind, id: string.id, name: string.name, value, min, max, norm };
    if (string.verge !== undefined) {
      lane.verge = string.verge;
      lane.vergeNorm = clamp((string.verge - min) / span, 0, 1);
    }
    if (string.safe !== undefined) {
      lane.safe = string.safe;
      lane.safeNorm = clamp((string.safe - min) / span, 0, 1);
    }
    lanes.push(lane);
  }
  return lanes;
}

/**
 * 写回时把「这一拍的运行时值」冻结成新的基线：调律台调的是世界的初值，
 * 刷新后世界从这里开始。只改数值弦；其它类型的基线保持原样。
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
