import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { sampleMatrixCurve, Universe } from '../src/index.js';

const WORLD = `世界 阶跃矩阵

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 阶梯网
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.4 0.6
  曲线 甲 乙 0 1 2
  插值 阶跃
  周期 10
`;

describe('阶跃采样（v2.9）', () => {
  it('按平台保持，不插值', () => {
    const bands = [0, 1, 2];
    expect(sampleMatrixCurve({ bands }, 0.1, '阶跃')).toBe(0);
    expect(sampleMatrixCurve({ bands }, 0.4, '阶跃')).toBe(1);
    expect(sampleMatrixCurve({ bands }, 0.9, '阶跃')).toBe(2);
    expect(sampleMatrixCurve({ bands }, 1, '阶跃')).toBe(2);
  });

  it('运行时快照保留阶跃元数据', () => {
    const r = compileText(WORLD, 'step-runtime.nro');
    if (!r.ok) throw new Error('compile failed');
    const u = new Universe(r.ir, { seed: 1 });
    expect(u.state.matrices?.['阶梯网']?.interpolation).toBe('阶跃');
  });
});
