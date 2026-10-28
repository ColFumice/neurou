import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 周期测试

叙事弦 潮位
  类型 数值 0..100
  基线 20

关系谱 潮汐
  行 岸边 深海
  列 岸边 深海
  段 0.2 0.7
  段 0.4 0.1
  曲线 岸边 深海 0.1 0.5 0.9
  周期 40
`;

describe('关系谱：周期（v2.4）', () => {
  it('解析、IR 与序列化保留周期', () => {
    const r = compileText(WORLD, 'period.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.matrices[0]?.period).toBe(40);
    const text = serialize(r.ir);
    expect(text).toContain('周期 40');
    const again = compileText(text, 'period-roundtrip.nro');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.ir.matrices[0]?.period).toBe(40);
  });

  it('非正周期报 NRO2100', () => {
    const r = compileText(WORLD.replace('周期 40', '周期 0'), 'period-bad.nro');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.errors.some((e) => e.code === 'NRO2100')).toBe(true);
  });
});
