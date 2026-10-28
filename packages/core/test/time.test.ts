import { describe, expect, it } from 'vitest';
import { compileText } from '../src/index.js';

const WORLD = `世界 时刻测试
叙事弦 钟
  类型 数值 0..100
  基线 0
结局 三拍: 当 此刻 >= 3
`;

describe('此刻：当前拍数内建值', () => {
  it('可作为路径/函数使用并进入结局条件', () => {
    const r = compileText(WORLD, 'time.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expr = r.ir.endings[0]?.guard;
    expect(JSON.stringify(expr)).toContain('此刻');
  });

  it('带括号写法也可编译', () => {
    const r = compileText(WORLD.replace('此刻 >= 3', '此刻() >= 3'), 'time-call.nro');
    expect(r.ok).toBe(true);
  });

  it('带参数会报 NRO2003', () => {
    const r = compileText(WORLD.replace('此刻 >= 3', '此刻(1) >= 3'), 'time-bad.nro');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.errors.some((e) => e.code === 'NRO2003')).toBe(true);
  });
});
