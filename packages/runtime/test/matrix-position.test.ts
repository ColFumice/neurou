import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { Universe } from '../src/index.js';

const WORLD = `世界 矩阵位置

叙事弦 信任
  类型 数值 0..100
  基线 50

关系谱 潮
  行 甲
  列 乙
  段 0.1
  周期 8
  速度 2
  相位 0.25
`;

describe('矩阵运行期位置 API（v3.2）', () => {
  it('返回周期/速度/相位参与后的 0..1 位置', () => {
    const r = compileText(WORLD, 'matrix-position.nro');
    if (!r.ok) throw new Error('compile failed');
    const u = new Universe(r.ir, { seed: 1 });
    expect(u.getMatrixPosition('潮')).toBeCloseTo(0.25);
    u.tick();
    u.tick();
    expect(u.getMatrixPosition('潮')).toBeCloseTo(0.75);
  });

  it('未知矩阵返回 undefined', () => {
    const r = compileText(WORLD, 'matrix-position-unknown.nro');
    if (!r.ok) throw new Error('compile failed');
    const u = new Universe(r.ir, { seed: 1 });
    expect(u.getMatrixPosition('不存在')).toBeUndefined();
  });
});
