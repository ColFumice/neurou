import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { evalExpr, Universe } from '../src/index.js';

const WORLD = `世界 动态值

叙事弦 信任
  类型 数值 0..100
  基线 50

叙事弦 情绪
  类型 数值 0..100
  基线 20

关系谱 网
  行 信任 情绪
  列 信任 情绪
  段 0.2 0.5
  段 0.5 0.7
  动态 信任 情绪 信任 / 100 + 0.1
`;

const QUERY = () => ({
  k: 'call' as const,
  fn: '查关系谱',
  args: [
    { k: 'const' as const, v: '网' },
    { k: 'const' as const, v: '信任' },
    { k: 'const' as const, v: '情绪' },
  ],
});

describe('关系谱动态值 runtime（v2.19）', () => {
  it('读取动态格时实时求值，字符串变化后跟着变', () => {
    const r = compileText(WORLD, 'matrix-dynamic-runtime.nro');
    if (!r.ok) throw new Error('compile failed');
    const u = new Universe(r.ir, { seed: 1 });
    expect(evalExpr(QUERY(), u.state)).toBeCloseTo(0.6);
    u.inject('信任', 80);
    expect(evalExpr(QUERY(), u.state)).toBeCloseTo(0.9);
    expect(u.getMatrixCell('网', '信任', '情绪')).toBeCloseTo(0.9);
  });

  it('快照恢复保留动态表达式', () => {
    const r = compileText(WORLD, 'matrix-dynamic-snapshot.nro');
    if (!r.ok) throw new Error('compile failed');
    const u = new Universe(r.ir, { seed: 1 });
    u.inject('信任', 70);
    const restored = new Universe(r.ir, { seed: 1 });
    restored.restore(u.snapshot());
    expect(evalExpr(QUERY(), restored.state)).toBeCloseTo(0.8);
  });
});
