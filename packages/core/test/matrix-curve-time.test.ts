import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 曲线时间轴

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 网
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.5 0.7
  曲线 甲 乙 速度 2 相位 0.25 循环 否 0 1
  周期 10
`;

describe('单条曲线速度/相位（v2.15）', () => {
  it('解析/IR/序列化保留曲线级时间轴', () => {
    const r = compileText(WORLD, 'curve-time.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const curve = r.ir.matrices[0]?.curves[0];
    expect(curve?.speed).toBe(2);
    expect(curve?.phase).toBe(0.25);
    const text = serialize(r.ir);
    expect(text).toContain('速度 2');
    expect(text).toContain('相位 0.25');
    expect(compileText(text, 'curve-time-roundtrip.nro').ok).toBe(true);
  });

  it('非法速度报错', () => {
    const r = compileText(WORLD.replace('速度 2', '速度 9'), 'curve-time-bad.nro');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.errors.some((e) => e.code === 'NRO2100')).toBe(true);
  });
});
