import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 动态强度

叙事弦 甲
  类型 数值 0..100
  基线 50

叙事弦 乙
  类型 数值 0..100
  基线 50

耦合 甲 → 乙 同向 0.5 + 此刻 * 0
`;

describe('耦合：动态强度（v2.5）', () => {
  it('表达式强度进入 IR 并序列化', () => {
    const r = compileText(WORLD, 'dynamic-coupling.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.couplings[0]?.strengthExpr).toBeDefined();
    const text = serialize(r.ir);
    expect(text).toContain('强度 0.5 + 此刻() * 0');
    const again = compileText(text, 'dynamic-coupling-roundtrip.nro');
    expect(again.ok).toBe(true);
  });

  it('常数强度仍然走静态路径', () => {
    const r = compileText(WORLD.replace('0.5 + 此刻 * 0', '0.5'), 'static-coupling.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.couplings[0]?.strength).toBe(0.5);
    expect(r.ir.couplings[0]?.strengthExpr).toBeUndefined();
  });

  it('延迟也可以是运行期表达式（v2.11）', () => {
    const source = WORLD.replace('0.5 + 此刻 * 0', '0.5 延迟 2 + 此刻 * 0');
    const r = compileText(source, 'dynamic-delay.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.couplings[0]?.delayExpr).toBeDefined();
    const text = serialize(r.ir);
    expect(text).toContain('延迟 2 + 此刻() * 0');
    const staticDelay = compileText(WORLD.replace('0.5 + 此刻 * 0', '0.5 延迟 2'), 'static-delay.nro');
    expect(staticDelay.ok).toBe(true);
    if (staticDelay.ok) expect(staticDelay.ir.couplings[0]?.delay).toBe(2);
  });
});
