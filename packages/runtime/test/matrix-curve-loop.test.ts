import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { Universe } from '../src/index.js';

const WORLD = `世界 曲线循环覆盖

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 网
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.5 0.7
  曲线 甲 乙 循环 否 0 1
  循环 是
  周期 10
`;

describe('单条曲线循环覆盖 runtime（v2.14）', () => {
  it('曲线级 循环 否 覆盖矩阵级 循环 是', () => {
    const r = compileText(WORLD, 'curve-loop-runtime.nro');
    if (!r.ok) throw new Error('compile failed');
    const u = new Universe(r.ir, { seed: 1 });
    expect(u.state.matrices?.['网']?.curves[0]?.loop).toBe(false);
    // 矩阵整体循环是，但曲线不循环：1.25 夹到 1（返回最后一段 1），而不是回绕到 0.25。
    expect(u.getMatrixCell('网', '甲', '乙', 1.25)).toBe(1);
  });
});
