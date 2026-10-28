import { describe, expect, it } from 'vitest';
import { compileText, serialize } from '../src/index.js';

const SPECTRUM = `世界 阶跃谱

叙事弦 甲
  类型 数值 0..100
  基线 50

谱 阶梯
  段 0 1 2
  范围 0..2
  插值 阶跃
`;

const MATRIX = `世界 阶跃矩阵

叙事弦 甲
  类型 数值 0..100
  基线 50

关系谱 阶梯网
  行 甲 乙
  列 甲 乙
  段 0.2 0.5
  段 0.4 0.6
  曲线 甲 乙 0 1 2
  插值 阶跃
  周期 10
`;

describe('阶跃插值（v2.9）', () => {
  it('谱/关系谱都能解析并序列化 阶跃', () => {
    const s = compileText(SPECTRUM, 'step-spectrum.nro');
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.ir.spectra[0]?.interpolation).toBe('阶跃');
    const m = compileText(MATRIX, 'step-matrix.nro');
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.ir.matrices[0]?.interpolation).toBe('阶跃');
    const text = serialize(m.ir);
    expect(text).toContain('插值 阶跃');
  });

  it('单条曲线可覆盖矩阵级插值（v2.12）', () => {
    const source = MATRIX.replace('  曲线 甲 乙 0 1 2\n', '  曲线 甲 乙 插值 阶跃 0 1 2\n');
    const r = compileText(source, 'curve-step-override.nro');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ir.matrices[0]?.curves[0]?.interpolation).toBe('阶跃');
    const text = serialize(r.ir);
    expect(text).toContain('曲线 甲 乙 插值 阶跃 0 1 2');
  });
});
