import { describe, expect, it } from 'vitest';
import { compileText } from '@neurou/core';
import { createEngine } from '../src/index.js';

function source(strings = 32, ports = 8): string {
  const lines = ['世界 大世界单测', '  版本 0.1', ''];
  for (let index = 0; index < strings; index += 1) {
    lines.push(`叙事弦 弦${index}`, '  类型 数值 0..100', `  基线 ${30 + (index % 40)}`, '');
  }
  for (let index = 0; index < strings; index += 1) {
    lines.push(`耦合 弦${index} → 弦${(index + 1) % strings} 同向 0.04`, '');
  }
  for (let index = 0; index < ports; index += 1) {
    lines.push(`视觉端口 视${index}`, `  参数 强度 弦${index}`, '  后处理 暗角 0.4 颗粒 0.2 色偏 0.1', '');
  }
  for (let index = 0; index < ports; index += 1) {
    lines.push(`音频端口 声${index}`, `  参数 强度 弦${(index + 1) % strings}`, '  自动化 0.2 0.5 0.8 0.5', '');
  }
  return lines.join('\n');
}

describe('大世界基准结构（v6.17）', () => {
  it('32 弦 / 16 端口可编译并推进', () => {
    const compiled = compileText(source(), 'large-unit.nro');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.ir.strings).toHaveLength(32);
    expect(compiled.ir.ports).toHaveLength(16);
    const engine = createEngine(compiled.ir, { seed: 1 });
    for (let index = 0; index < 100; index += 1) engine.step();
    const frame = engine.observe();
    expect(Object.keys(frame.ports)).toHaveLength(16);
    expect(Object.values(frame.ports).filter((port) => port.post).length).toBe(8);
    expect(Object.values(frame.ports).filter((port) => port.automation !== undefined).length).toBe(8);
  });
});
