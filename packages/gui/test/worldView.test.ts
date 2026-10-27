import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileText, type WorldIR } from '@neurou/core';
import { Universe } from '@neurou/runtime';
import { collectLanes, laneRange, withCurrentBaselines } from '../src/worldView.js';

function loadTuner(): { ir: WorldIR; universe: Universe } {
  const text = readFileSync(resolve('examples/tuner.nro'), 'utf8');
  const compiled = compileText(text, 'examples/tuner.nro');
  if (!compiled.ok) throw new Error('tuner.nro 编译失败');
  return { ir: compiled.ir, universe: new Universe(compiled.ir, { seed: 7 }) };
}

describe('世界 → 调律台投影', () => {
  it('8 类弦各取第一根数值弦，顺序 = KIND_ORDER', () => {
    const { ir, universe } = loadTuner();
    const lanes = collectLanes(universe, ir);
    expect(lanes.map((lane) => lane.kind)).toEqual([
      '叙事',
      '视觉',
      '动画',
      '物理',
      '控制',
      '空间',
      '认知',
      '关系',
    ]);
    expect(lanes.map((lane) => lane.name)).toEqual([
      '信任',
      '色温',
      '步态',
      '重力',
      '灵敏度',
      '连通',
      '知情',
      '恐惧',
    ]);
    expect(lanes.map((lane) => lane.value)).toEqual([55, 64, 50, 72, 44, 36, 28, 0.58]);
  });

  it('值、阈值都按各自域归一化（关系弦 0..1 也正确）', () => {
    const { ir, universe } = loadTuner();
    const lanes = collectLanes(universe, ir);
    expect(lanes[0]!.norm).toBeCloseTo(0.55, 6);
    expect(lanes[0]!.verge).toBe(25);
    expect(lanes[0]!.vergeNorm).toBeCloseTo(0.25, 6);
    expect(lanes[0]!.safeNorm).toBeCloseTo(0.75, 6);
    expect(lanes[7]!.norm).toBeCloseTo(0.58, 6);
    expect(lanes[7]!.verge).toBe(0.8);
    expect(laneRange(ir.strings[0]!)).toEqual([0, 100]);
  });

  it('运行时值变化后，投影跟着变（不是读 IR 基线）', () => {
    const { ir, universe } = loadTuner();
    universe.inject('信任', 70);
    const lanes = collectLanes(universe, ir);
    expect(lanes[0]!.value).toBe(70);
    expect(lanes[0]!.norm).toBeCloseTo(0.7, 6);
  });

  it('写回冻结：把当拍值写进基线，其它类型弦保持原样', () => {
    const { ir, universe } = loadTuner();
    universe.inject('信任', 63.4567);
    const frozen = withCurrentBaselines(ir, universe);
    const trust = frozen.strings.find((s) => s.id === '信任');
    expect(trust?.baseline).toBe(63.457);
    // 非数值弦不受影响（rain-slice 里才有，tuner 用关系弦的 0..1 数值弦验证量程不同）
    expect(frozen.strings.find((s) => s.id === '色温')?.baseline).toBe(64);
    // 原图不变
    expect(ir.strings.find((s) => s.id === '信任')?.baseline).toBe(55);
  });

  it('没有数值弦的类不会凭空出现 lane', () => {
    const { ir, universe } = loadTuner();
    const empty: WorldIR = {
      ...ir,
      strings: ir.strings.filter((s) => s.kind !== '认知'),
    };
    const lanes = collectLanes(universe, empty);
    expect(lanes.map((lane) => lane.kind)).not.toContain('认知');
    expect(lanes).toHaveLength(7);
  });
});
