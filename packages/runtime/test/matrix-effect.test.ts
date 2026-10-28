import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { evalExpr, Universe } from '../src/index.js';

const WORLD = `世界 矩阵写

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 网
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.5 0.7

力迫 推
  效果
    关系谱 网 甲 乙 += 0.3

结局 成: 当 查关系谱("网", "甲", "乙") >= 0.7
`;

describe('效果写关系谱 runtime（v2.17）', () => {
  it('效果改动矩阵标量，同拍结局能读到新值', () => {
    const r = compileText(WORLD, 'matrix-effect-runtime.nro');
    if (!r.ok) throw new Error('compile failed');
    const u = new Universe(r.ir, { seed: 1 });
    u.tick();
    expect(u.state.matrices?.['网']?.values[0]?.[1]).toBeCloseTo(0.8);
    expect(u.state.ended?.name).toBe('成');
    expect(evalExpr({ k: 'call', fn: '查关系谱', args: [
      { k: 'const', v: '网' },
      { k: 'const', v: '甲' },
      { k: 'const', v: '乙' },
    ] }, u.state)).toBeCloseTo(0.8);
  });
});
