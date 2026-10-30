import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { createEngine } from '../src/index.js';

const SOURCE = `世界 自动化
  版本 0.1

叙事弦 信任
  类型 数值 0..100
  基线 50

音频端口 潮声
  参数 强度 信任
  自动化 0 0.5 1
`;

describe('音频端口自动化（v6.15）', () => {
  it('自动化曲线进入 IR 并按拍采样', () => {
    const compiled = compileText(SOURCE, 'automation.nro');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.ir.ports?.[0]?.automation).toEqual([0, 0.5, 1]);
    const engine = createEngine(compiled.ir, { seed: 1 });
    const at0 = engine.observe().ports['port:音频:潮声']?.automation;
    expect(at0).toBeCloseTo(0, 5);
    engine.step();
    const at1 = engine.observe().ports['port:音频:潮声']?.automation;
    expect(at1).toBeCloseTo(0.125, 5);
    engine.step();
    const at2 = engine.observe().ports['port:音频:潮声']?.automation;
    expect(at2).toBeCloseTo(0.25, 5);
  });

  it('自动化只允许音频端口且值在 0..1', () => {
    const badKind = SOURCE.replace('音频端口', '视觉端口');
    expect(compileText(badKind, 'automation-bad-kind.nro').ok).toBe(false);
    const badValue = SOURCE.replace('0 0.5 1', '0 1.4');
    expect(compileText(badValue, 'automation-bad-value.nro').ok).toBe(false);
  });
});
