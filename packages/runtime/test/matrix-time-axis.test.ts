import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { Universe } from '../src/index.js';

const WORLD = `世界 时间轴

叙事弦 潮位
  类型 数值 0..100
  基线 20

关系谱 潮汐
  行 岸边 深海
  列 岸边 深海
  段 0.2 0.7
  段 0.4 0.1
  曲线 岸边 深海 0.1 0.5 0.9
  插值 平滑
  循环 是
  周期 10
  速度 2
  相位 0.25

结局 时: 当 谱位("潮汐") > 0.4
`;

describe('谱位：周期/速度/相位的时间轴（v2.6）', () => {
  it('运行期时间轴位置推进并触发结局', () => {
    const r = compileText(WORLD, 'matrix-time-axis.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = new Universe(r.ir, { seed: 1 });
    for (let i = 0; i < 4 && !u.state.ended; i++) u.tick();
    expect(u.state.ended?.name).toBe('时');
  });
});
