import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { Universe } from '../src/index.js';

const WORLD = `世界 曲线时间轴

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 网
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.5 0.7
  曲线 甲 乙 速度 2 相位 0.25 循环 否 0 1
  周期 10
`;

describe('曲线级时间轴 runtime（v2.15）', () => {
  it('速度/相位映射到曲线本地位置后再 clamp', () => {
    const r = compileText(WORLD, 'curve-time-runtime.nro');
    if (!r.ok) throw new Error('compile failed');
    const u = new Universe(r.ir, { seed: 1 });
    // 本地位置 = 0.25*2 + 0.25 = 0.75 → 0.75
    expect(u.getMatrixCell('网', '甲', '乙', 0.25)).toBeCloseTo(0.75);
    // 0.75*2+0.25 = 1.75；曲线非循环 → clamp 到 1
    expect(u.getMatrixCell('网', '甲', '乙', 0.75)).toBe(1);
  });
});
