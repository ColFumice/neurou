import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { Universe } from '../src/index.js';

const WORLD = `世界 时刻测试
叙事弦 钟
  类型 数值 0..100
  基线 0
结局 三拍: 当 此刻 >= 3
`;

describe('此刻：运行时拍数', () => {
  it('随 tick 前进，结局在第三拍触发', () => {
    const r = compileText(WORLD, 'time.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = new Universe(r.ir, { seed: 1 });
    expect(u.state.ended).toBeNull();
    for (let i = 0; i < 5 && !u.state.ended; i++) u.tick();
    expect(u.state.ended?.name).toBe('三拍');
  });
});
