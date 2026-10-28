import { describe, expect, it } from 'vitest';
import { compileText, patchWorldText, setSpectrumBands } from '../src/index.js';

const SOURCE = `世界 谱增删
叙事弦 情绪
  类型 数值 0..1
  基线 0.5

谱 地形
  # 保留注释
  段 0.1 0.5 0.9
  范围 0..1
  插值 平滑
`;

describe('谱：整条替换段值（v2.4.2）', () => {
  it('可增删段并保留段行注释', () => {
    const compiled = compileText(SOURCE, 'spectrum-bands.nro');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const base = compiled.ir;
    const edited = setSpectrumBands(base, '地形', [0.2, 0.8]);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.ir.spectra[0]?.bands).toEqual([0.2, 0.8]);
    const patched = patchWorldText(SOURCE, base, edited.ir);
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.text).toContain('# 保留注释');
    expect(patched.text).toContain('段 0.2 0.8');
    const again = compileText(patched.text, 'spectrum-bands-roundtrip.nro');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.ir.spectra[0]?.bands).toEqual([0.2, 0.8]);
  });

  it('超出范围/空段报错', () => {
    const compiled = compileText(SOURCE, 'spectrum-bands-bad.nro');
    if (!compiled.ok) throw new Error('compile failed');
    expect(setSpectrumBands(compiled.ir, '地形', []).ok).toBe(false);
    expect(setSpectrumBands(compiled.ir, '地形', [0.1, 2]).ok).toBe(false);
  });
});
