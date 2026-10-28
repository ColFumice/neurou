import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const WORLD = `世界 联动

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 源谱
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.4 0.6
  曲线 甲 乙 0 1
  周期 10

关系谱 从谱
  行 丙 丁
  列 丙 丁
  段 0.3 0.5
  段 0.5 0.7
  曲线 丙 丁 0 1
  周期 20
  相位源 源谱 甲 乙
`;

describe('多矩阵联动：相位源（v2.7）', () => {
  it('解析、IR、序列化保留相位源', () => {
    const r = compileText(WORLD, 'phase-source.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.ir.matrices.find((m) => m.name === '从谱');
    expect(b?.phaseSource).toEqual({ matrix: '源谱', row: '甲', col: '乙' });
    const text = serialize(r.ir);
    expect(text).toContain('相位源 源谱 甲 乙');
    const again = compileText(text, 'phase-source-roundtrip.nro');
    expect(again.ok).toBe(true);
  });

  it('相位源必须指向有曲线的格子', () => {
    const bad = WORLD.replace('相位源 源谱 甲 乙', '相位源 源谱 乙 乙');
    const r = compileText(bad, 'phase-source-bad.nro');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.errors.some((e) => e.code === 'NRO2100')).toBe(true);
  });

  it('相位源不能成环', () => {
    const cyclic = WORLD.replace('周期 10', '周期 10\n  相位源 从谱 丙 丁');
    const r = compileText(cyclic, 'phase-source-cycle.nro');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.errors.some((e) => e.code === 'NRO2100')).toBe(true);
  });
});
